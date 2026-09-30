"""The only tools the model has. Built fresh for every run, around the person speaking.

- The Home Assistant read tools named in policy.yaml, each proxied through the
  agent's own read-only HA MCP client. A tool the server has and the policy
  does not name does not exist here. A tool the server marks destructive is
  refused and logged, whatever the policy says.
- `ha_call_service`: asks for an approval. It never executes.
- `create_ticket`: a fault in the VESTA Kiosk's Facility records, no approval
  (a record, not a physical action); marked "By VESTA Agent" by the Kiosk.
- `read_skill`, `run_skill_script`: the skills, with each script's arguments
  checked against the skill's own skill.yaml. No shell exists.
- `send_message`: to the owner or FM chat of policy.yaml only.
- Web search is Claude's own WebSearch tool (runner.py), when policy.yaml allows it.

Answers longer than a tool answer may carry are split into parts, and the model
is told it holds part N of M.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from claude_agent_sdk import create_sdk_mcp_server, tool

from . import __version__
from .policy import Person, Policy
from .runner import WEB_SEARCH
from .skills import FILE_NAME, Skills, ToolError, run_script, validate_script_args

SERVER = "vesta"
log = logging.getLogger("vesta.tools")
# agent_status: the records worth telling a person about, and the fields of each (never a chat id or a token)
STATUS_KINDS = ("critical_event", "ladder", "executed", "requested", "approved", "refused_by_person", "failed",
                "action_failed", "send_failed", "code_script_failed", "script_refused", "pack", "ticket_skipped")
STATUS_FIELDS = ("rule", "phase", "handled", "incident", "by", "reply", "tool", "ticket", "entity", "service",
                 "skill", "script", "reason", "error", "code", "entities")
PART_CHARS = 60_000          # about 15,000 tokens: under the SDK's 25,000-token cut of a tool answer

# Arguments of the Home Assistant read tools that are pinned by code. ha_get_logs can read other add-ons'
# container logs (source "supervisor"), which may print secrets: only the logbook and the system log are allowed.
READ_ARG_RULES: dict[str, dict[str, set]] = {
    "ha_get_logs": {"source": {"logbook", "system"}},
}
READ_ARG_FORBIDDEN: dict[str, set] = {
    "ha_get_logs": {"slug"},
}

_SECRET_PATTERNS = [
    re.compile(r"mcp_[A-Za-z0-9_-]{8,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"),
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),                 # a Telegram bot token
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),  # a JWT (Home Assistant tokens)
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{12,}"),
]
_SECRET_KV = re.compile(r"(?i)(\\?\"?(?:access_token|refresh_token|token|api_key|apikey|password|passwd|secret|webhook_id|client_secret)\\?\"?\s*[:=]\s*\\?\"?)([^\"\\,}&\s]{4,})")


def scrub(text: str, extra: list[str] | None = None) -> str:
    """Remove secrets from anything the model is about to read."""
    if not text:
        return text
    for sec in extra or []:
        if sec and len(sec) >= 8:
            text = text.replace(sec, "[redacted]")
    for p in _SECRET_PATTERNS:
        text = p.sub("[redacted]", text)
    return _SECRET_KV.sub(lambda m: m.group(1) + "[redacted]", text)


SKILL_PREFACE = """[How to run this skill inside VESTA]
You have no shell. Run a script only with the tool run_skill_script(skill, script, args).
The code adds --pack, --store and --zone itself: never pass them, nor --fixture-dir, --role, --confirmed or --from.
Output files: give --out a plain file name (e.g. week.json); the file lands in the agent's out folder and can be
passed by name to another script or attached with send_message.
Any action on the villa (light, lock, siren, automation...) is ha_call_service: it only ASKS a person, who approves
with a button. A task for the facility manager is create_ticket. The concierge's propose/execute/readback commands
and the desk's siren/reply/intake/tick commands are done by the code, not by you. Ignore the parts of the text
below that tell you to run them.
[End of the VESTA note]

"""


class Parts:
    """Long answers served in parts, so nothing is cut without the model knowing."""

    def __init__(self):
        self.cache: dict[str, str] = {}

    def serve(self, key: str, text: str | None, part: int) -> str:
        if text is not None:
            self.cache[key] = text
        text = self.cache.get(key, "")
        if len(text) <= PART_CHARS:
            return text
        n = (len(text) + PART_CHARS - 1) // PART_CHARS
        part = max(1, min(part, n))
        chunk = text[(part - 1) * PART_CHARS: part * PART_CHARS]
        more = f" Call the same tool with the same arguments and vesta_part={part + 1} for the next part." if part < n else " This is the last part."
        return f"[Part {part} of {n}: the answer was too long for one reply.{more}]\n{chunk}"


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "is_error": True}


class Toolbox:
    def __init__(self, *, settings, policy: Policy, reader, actions, skills: Skills,
                 send: Callable[..., Awaitable[Any]], server_tools: list[dict], state,
                 ticket: Callable[..., Awaitable[str]] | None = None):
        self.s = settings
        self.policy = policy
        self.reader = reader
        self.actions = actions
        self.skills = skills
        self.send = send
        self.ticket = ticket
        self.server_tools = {t["name"]: t for t in server_tools}
        self.state = state
        self.parts = Parts()

    def _secrets(self) -> list[str]:
        return self.s.secrets()

    # ------------------------------------------------------------------ names
    def model_tool_names(self, include_web: bool) -> list[str]:
        names = [f"mcp__{SERVER}__{n}" for n in self.read_tool_names()]
        names += [f"mcp__{SERVER}__{n}" for n in ("ha_call_service", "read_skill", "run_skill_script", "send_message",
                                                  "agent_status")]
        if self.ticket:
            names.append(f"mcp__{SERVER}__create_ticket")
        if include_web:
            names.append(WEB_SEARCH)
        return names

    def read_tool_names(self) -> list[str]:
        out = []
        for n in self.policy.ha_read_tools:
            t = self.server_tools.get(n)
            if not t:
                continue          # named in the policy, absent from the server: reported at start, never guessed
            if (t.get("annotations") or {}).get("destructiveHint"):
                self.state.log("tool_denied", {"tool": n, "reason": "server marks it destructive"})
                continue
            out.append(n)
        return out

    # ------------------------------------------------------------------ build
    def tool_objects(self, person: Person | None, chat_id: int | None, include_web: bool) -> list:
        tools = [self._proxy(n) for n in self.read_tool_names()]
        tools += [self._call_service(person, chat_id), self._read_skill(), self._run_script(), self._send(),
                  self._status()]
        if self.ticket:
            tools.append(self._ticket())
        return tools

    def server(self, person: Person | None, chat_id: int | None, include_web: bool):
        return create_sdk_mcp_server(name=SERVER, version=__version__, tools=self.tool_objects(person, chat_id, include_web))

    def _proxy(self, name: str):
        t = self.server_tools[name]
        schema = json.loads(json.dumps(t.get("inputSchema") or {"type": "object", "properties": {}}))
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})["vesta_part"] = {
            "type": "integer", "minimum": 1, "description": "Part of a long answer to read (1 by default)."}
        desc = (t.get("description") or name)[:4000]

        @tool(name, desc, schema)
        async def handler(args: dict) -> dict:
            args = dict(args or {})
            part = int(args.pop("vesta_part", 1) or 1)
            if name not in self.read_tool_names():
                self.state.log("tool_denied", {"tool": name})
                return _err(f"{name} is not allowed.")
            known = set(((t.get("inputSchema") or {}).get("properties") or {}).keys())
            unknown = [k for k in args if k not in known] + [k for k in args if k in READ_ARG_FORBIDDEN.get(name, set())]
            if unknown:
                self.state.log("tool_arg_refused", {"tool": name, "args": sorted(set(unknown))})
                return _err(f"Argument not allowed for {name}: {', '.join(sorted(set(unknown)))}.")
            for k, allowed_values in READ_ARG_RULES.get(name, {}).items():
                if k in args and args[k] not in allowed_values:
                    self.state.log("tool_arg_refused", {"tool": name, "arg": k, "value": str(args[k])[:40]})
                    return _err(f"{k} must be one of: {', '.join(sorted(allowed_values))}.")
            key = hashlib.sha256(json.dumps([name, args], sort_keys=True, default=str).encode()).hexdigest()
            if part > 1 and key in self.parts.cache:
                return _ok(self.parts.serve(key, None, part))
            try:
                res = await asyncio.to_thread(self.reader.mcp.call_raw, name, args)
            except Exception as e:  # noqa: BLE001
                return _err(f"Home Assistant did not answer ({type(e).__name__}).")
            blocks = res.get("content") or []
            images = [b for b in blocks if b.get("type") == "image"]
            text = scrub("".join(b.get("text", "") for b in blocks if b.get("type") == "text"), self._secrets())
            out = {"content": ([{"type": "text", "text": self.parts.serve(key, text, part)}] if text else []) + images}
            if res.get("isError"):
                out["is_error"] = True
            return out
        return handler

    def _call_service(self, person: Person | None, chat_id: int | None):
        schema = {"type": "object", "properties": {
            "domain": {"type": "string"}, "service": {"type": "string"},
            "entity_id": {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]},
            "data": {"type": "object"}}, "required": ["domain", "service"]}

        @tool("ha_call_service",
              "Ask for an action on the villa (e.g. light turn_on, lock lock). Usually this does NOT execute: it sends the "
              "request with Approve and Refuse buttons to the person allowed to approve it. A service the villa marks direct "
              "runs at once when the person writing to you asked for it; the answer says which happened and the result. "
              "Name every entity explicitly; use absolute states, never toggle. The villa's rules may refuse the request: "
              "say so plainly.", schema)
        async def handler(args: dict) -> dict:
            answer, msg = await asyncio.to_thread(self.actions.request, args.get("domain", ""), args.get("service", ""),
                                                  args.get("entity_id"), args.get("data") or {}, person, chat_id)
            if msg:
                await self.send(msg.chat_id, msg.text, keyboard=msg.keyboard, approval_id=msg.approval_id)
            return _ok(answer)
        return handler

    def _ticket(self):
        schema = {"type": "object", "properties": {
            "title": {"type": "string", "description": "What is wrong, in plain words, one line."},
            "entity_id": {"type": "string", "description": "The device concerned, optional."},
            "note": {"type": "string", "description": "What to check, optional."}},
            "required": ["title"]}

        @tool("create_ticket", "Record a fault for the facility manager in the villa's Facility records (the VESTA Kiosk). "
                               "It does not act on anything. Use it for a job someone must do.", schema)
        async def handler(args: dict) -> dict:
            title = str(args.get("title") or "").strip()
            if not title:
                return _err("A ticket needs a title.")
            ent = str(args.get("entity_id") or "").strip() or None
            if ent and not re.match(r"^[a-z_]+\.[a-z0-9_]+$", ent):
                return _err(f"{ent} is not an entity id.")
            try:
                tid = await self.ticket(title=title[:200], entity_id=ent, note=str(args.get("note") or "")[:2000] or None)
            except Exception as e:  # noqa: BLE001
                return _err(f"The Kiosk did not record the ticket ({type(e).__name__}).")
            self.state.log("executed", {"tool": "create_ticket", "ticket": tid, "entity": ent})
            return _ok("Recorded.")
        return handler

    def status_report(self, hours: int = 24, now: datetime | None = None) -> dict:
        """What the agent itself did: its scheduled jobs, the alerts it followed, the buttons pressed, the
        actions asked and done, the failures. Read from its own records only; it changes nothing."""
        now = now or datetime.now(timezone.utc)
        since = now - timedelta(hours=hours)
        jobs = []
        for k, slot in sorted(self.state.kv_prefix("job:").items(), key=lambda kv: kv[1]):
            try:
                if datetime.fromisoformat(slot) >= since:
                    jobs.append({"job": k[4:], "ran_at": slot})
            except ValueError:
                continue
        counts: dict[str, int] = {}
        cost = 0.0
        events = []
        for c in self.state.calls_since(since.isoformat()):
            counts[c["kind"]] = counts.get(c["kind"], 0) + 1
            try:
                d = json.loads(c["detail"] or "{}")
            except ValueError:
                d = {}
            if c["kind"] == "run" and isinstance(d.get("cost_usd"), (int, float)):
                cost += d["cost_usd"]
            if c["kind"] in STATUS_KINDS:
                events.append({"at": c["at"], "what": c["kind"], **{k: v for k, v in d.items() if k in STATUS_FIELDS}})
        incidents = []
        if os.path.exists(self.s.store_path):
            try:
                from vesta_shared.store import Store
                st = Store(self.s.store_path)
                for i in st.incidents(open_only=False):
                    if (i.get("opened_at") or "") >= since.isoformat() or not i.get("closed_at"):
                        incidents.append({k: i.get(k) for k in ("id", "rule_id", "entity_id", "opened_at", "state",
                                                                 "reply", "assignee", "closed_at")})
            except Exception as e:  # noqa: BLE001 — a status answer never fails on the store
                incidents.append({"error": type(e).__name__})
        return {"since": since.isoformat(), "until": now.isoformat(), "scheduled_jobs": jobs,
                "counts": counts, "ai_cost_usd": round(cost, 3), "events": events[-60:],
                "incidents": incidents[-40:]}

    def _status(self):
        schema = {"type": "object", "properties": {
            "hours": {"type": "integer", "description": "How far back, in hours (default 24, at most 168)."}}}

        @tool("agent_status", "What YOU (the VESTA Agent) did recently: scheduled jobs run, alerts followed, "
                              "buttons pressed, tickets, actions asked or done, failures, AI cost. Read-only. "
                              "Use it for 'what did you do last night?'. Times are UTC.", schema)
        async def handler(args: dict) -> dict:
            try:
                hours = max(1, min(168, int(args.get("hours") or 24)))
            except (TypeError, ValueError):
                return _err("hours must be a whole number.")
            return _ok(scrub(json.dumps(self.status_report(hours), default=str), self._secrets()))
        return handler

    def _read_skill(self):
        @tool("read_skill", "Read the full instructions of one of your skills before doing its job.",
              {"type": "object", "properties": {"skill": {"type": "string"}}, "required": ["skill"]})
        async def handler(args: dict) -> dict:
            sk = args.get("skill", "")
            skill = self.skills.get(sk)
            if skill is None:
                return _err(f"No skill {sk}. Your skills: {', '.join(self.skills.all()) or 'none'}.")
            scripts = sorted(skill.scripts)
            try:
                with open(skill.skill_md, encoding="utf-8") as f:
                    body = f.read()
            except OSError:
                return _err(f"The skill {sk} could not be read.")
            return _ok(SKILL_PREFACE + f"Scripts you may run for this skill: {', '.join(scripts) or 'none'}.\n\n" + body)
        return handler

    def _run_script(self):
        schema = {"type": "object", "properties": {
            "skill": {"type": "string"}, "script": {"type": "string"},
            "args": {"type": "array", "items": {"type": "string"}},
            "vesta_part": {"type": "integer", "minimum": 1}}, "required": ["skill", "script"]}

        @tool("run_skill_script", "Run one of a skill's scripts with its arguments and get its JSON output. "
                                  "The code adds --pack, --store and --zone.", schema)
        async def handler(args: dict) -> dict:
            sk, sc = args.get("skill", ""), args.get("script", "")
            skill = self.skills.get(sk)
            try:
                final = validate_script_args(skill, sk, sc, list(args.get("args") or []), self.s.out_dir)
            except ToolError as e:
                self.state.log("script_refused", {"skill": sk, "script": sc, "args": args.get("args"), "reason": str(e)})
                return _err(str(e))
            code, out, err = await asyncio.to_thread(run_script, self.s, skill, sc, final)
            if code not in (0, 2):
                out = (out + "\n" + err).strip()
                last = scrub(err.strip().splitlines()[-1] if err.strip() else "", self._secrets())
                log.warning("Skill %s: %s failed (exit %s)%s", sk, sc, code, f": {last[:300]}" if last else "")
            out = scrub(out, self._secrets())
            self.state.log("script", {"skill": sk, "script": sc, "args": final, "exit": code})
            key = hashlib.sha256(json.dumps([sk, sc, final]).encode()).hexdigest()
            text = self.parts.serve(key, out, int(args.get("vesta_part") or 1))
            return _ok(text) if code in (0, 2) else _err(text or f"The script failed (exit {code}).")
        return handler

    def _send(self):
        schema = {"type": "object", "properties": {
            "to": {"type": "string", "enum": ["owner", "fm"]}, "text": {"type": "string"},
            "attachment": {"type": "string", "description": "A file name in the out folder (an HTML report page), optional."}},
            "required": ["to", "text"]}

        @tool("send_message", "Send a message to the owner chat or the facility manager chat. Use it for scheduled "
                              "reports and digests. In a conversation, just answer: your reply is sent for you.", schema)
        async def handler(args: dict) -> dict:
            to = args.get("to")
            chat = self.policy.chats.get(to or "")
            if not chat:
                return _err(f"No {to} chat is configured.")
            att = args.get("attachment")
            path = None
            if att:
                if not FILE_NAME.match(att) or not os.path.exists(os.path.join(self.s.out_dir, att)):
                    return _err(f"{att} is not a file in the out folder.")
                path = os.path.join(self.s.out_dir, att)
            await self.send(int(chat), args.get("text", ""), document=path)
            self.state.log("sent", {"to": to, "chars": len(args.get("text", "")), "attachment": att})
            return _ok("Sent.")
        return handler
