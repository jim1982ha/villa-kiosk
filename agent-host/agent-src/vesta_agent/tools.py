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

WHICH of these exist for one run is tool_access.py's answer (`allowed`): what is switched on, for the
person's role in a chat, or the skill's own list for a report. A tool not in it is not built at all.

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
from datetime import datetime
from typing import Any, Awaitable, Callable, NamedTuple

from claude_agent_sdk import create_sdk_mcp_server, tool

from . import __version__, script_run, status, tool_access
from .policy import Person, Policy
from .redact import scrub  # noqa: F401 — callers import it from here too
from .routing import Origin, Routing
from .outcome import has_work
from .runner import WEB_SEARCH
from .skills import FILE_NAME, Skills, ToolError, validate_script_args

SERVER = "vesta"
SAVE_MAX = 64 * 1024
log = logging.getLogger("vesta.tools")
PART_CHARS = 60_000          # about 15,000 tokens: under the SDK's 25,000-token cut of a tool answer

# Arguments of the Home Assistant read tools that are pinned by code. ha_get_logs can read other add-ons'
# container logs (source "supervisor"), which may print secrets: only the logbook and the system log are allowed.
READ_ARG_RULES: dict[str, dict[str, set]] = {
    "ha_get_logs": {"source": {"logbook", "system"}},
}
READ_ARG_FORBIDDEN: dict[str, set] = {
    "ha_get_logs": {"slug"},
}

SKILL_PREFACE = """[How to run this skill inside VESTA]
You have no shell. Run a script only with the tool run_skill_script(skill, script, args).
The code adds --pack, --store and --zone itself: never pass them, nor --fixture-dir, --role, --confirmed or --from.
Output files: give --out a plain file name (e.g. week.json); the file lands in the agent's out folder and can be
passed by name to another script or attached with send_message.
Any action on the villa (light, lock, siren, automation...) is ha_call_service: it only ASKS a person, who approves
with a button. A task for the facility manager is create_ticket. The desk's siren/reply/intake/tick commands are
done by the code, not by you. Ignore the parts of the text below that tell you to run them.
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


class Kit(NamedTuple):
    """One run's tools as built: the SDK server, the names the guard allows, the tool objects themselves (a test's
    stand-in AI calls those, so it can only use what the run was really given — architecture review 14)."""
    server: Any
    names: set[str]
    tools: list


class Toolbox:
    def __init__(self, *, settings, policy: Policy, reader, actions, skills: Skills,
                 ask: Callable[..., Awaitable[int]], server_tools: list[dict], state,
                 ticket: Callable[..., Awaitable[str]] | None = None,
                 carry_out: Callable[..., Awaitable[dict]] | None = None,
                 start_job: Callable[..., Awaitable[str]] | None = None,
                 allowed: set[str] | None = None):
        self.s = settings
        self.policy = policy
        self.reader = reader
        self.actions = actions
        self.skills = skills
        # ⚠️ ONE WAY OUT (owner, 2026-10-10: each message to every chat of its role): an approval request goes through
        # Outcome.ask, a message through Outcome.carry_out — never a send of this class's own
        self.ask = ask
        self.ticket = ticket
        self.carry_out = carry_out
        self.start_job = start_job
        self.server_tools = {t["name"]: t for t in server_tools}
        self.state = state
        self.parts = Parts()
        # ⚠️ A PICTURE THE AI LOOKED AT IS SHOWN TO THE PERSON TOO (2026-10-06). ha_get_camera_image shows it to the
        # AI only: asked "show me the living room camera", it looked, wrote "here's the current view", and the chat
        # got text. A send_message(camera=) option (0.12.57) was not used by the model either. The reply carries
        # them (app.converse): (base64, mime), in the order looked at, each picture once.
        self.photos: list[tuple[str, str]] = []
        # the approval requests this run sent: the answer that says "awaiting approval" goes when one is decided
        self.approvals: list[str] = []
        # ⚠️ tool_access DECIDES, THIS CLASS BUILDS (architecture review, 2026-10-06): allowed_for's answer — through
        # turn.Terms — is the whole list — every tool below is built only when it is in it, and the
        # names the SDK may call are read off the built tools (for_run), so the two can never differ.
        # None: everything switched on (tests, the start log).
        self.allowed = allowed if allowed is not None else tool_access.switched_on(policy, server_tools)
        self._read_names = self._read_tools()

    def _on(self, key: str) -> bool:
        return key in self.allowed

    def _secrets(self) -> list[str]:
        return self.s.secrets()

    # ------------------------------------------------------------------ names
    @property
    def include_web(self) -> bool:
        return self._on("web_search")

    def read_tool_names(self) -> list[str]:
        """The Home Assistant tools this run reads with, in policy.yaml's order."""
        return list(self._read_names)

    def _read_tools(self) -> list[str]:
        out = []
        for n in self.policy.ha_read_tools:
            t = self.server_tools.get(n)
            if not t or n not in self.allowed:
                continue          # named in the policy, absent from the server: reported at start, never guessed
            if not tool_access.readable(t):
                # ⚠️ ONLY WHAT THE SERVER MARKS READ-ONLY (0.6.42), checked again where the tool is built: the last
                # guard before a Home Assistant call, with tool_access's own test (not a copy of it)
                self.state.log("tool_denied", {"tool": n, "reason": "the server does not mark it read-only"})
                continue
            out.append(n)
        return out

    def lacks(self, skill) -> list[dict]:
        """The tools this skill uses that THIS run does not have (tool_access.unavailable, against its own tools)."""
        return tool_access.unavailable(self.policy, list(self.server_tools.values()) or None, skill, self.allowed)

    # ------------------------------------------------------------------ build
    def tool_objects(self, person: Person | None, origin: Origin | None) -> list:
        """The AI's tools for one occasion: `origin` says who is asking (routing.Origin; None: a scheduled
        job or an alert hook), `person` who they are. What each tool allows follows from it, in routing."""
        chat_id = origin.chat if origin else None
        tools = [self._proxy(n) for n in self._read_names]
        for key, build in (("read_skill", self._read_skill), ("run_skill_script", lambda: self._run_script(origin)),
                           ("send_message", lambda: self._send(origin)), ("save_file", self._save_file),
                           ("ha_call_service", lambda: self._call_service(person, chat_id)),
                           ("agent_status", self._status)):
            if self._on(key):
                tools.append(build())
        if origin and origin.is_conversation and person is not None and self.start_job and self._on("start_job"):
            # a person asking, in a chat: never a job (even one started from a chat), so no job starts another
            tools.append(self._start_job(chat_id, person.role))
        if self.ticket and self._on("create_ticket"):
            tools.append(self._ticket())
        return tools

    def for_run(self, person: Person | None, origin: Origin | None) -> "Kit":
        """This run's tools: the SDK server, the names it may call and the built tools — all read off the same list."""
        tools = self.tool_objects(person, origin)
        names = {f"mcp__{SERVER}__{t.name}" for t in tools} | ({WEB_SEARCH} if self.include_web else set())
        return Kit(create_sdk_mcp_server(name=SERVER, version=__version__, tools=tools), names, tools)

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
            if name not in self._read_names:
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
            for b in images:
                photo = (b.get("data"), b.get("mimeType") or "image/jpeg")
                if photo[0] and photo not in self.photos:
                    self.photos.append(photo)
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
            if msg and not await self.ask(msg):
                answer += " But the request with its Approve button could not be delivered in Telegram: nobody has it."
            elif msg:
                self.approvals.append(msg.approval_id)
                if chat_id is not None and int(chat_id) in msg.chats:
                    # ⚠️ NO ECHO OF THE REQUEST (owner, 2026-10-10: "Approval request sent… Waiting for approval." under
                    # the request itself "is redundant"): the request in this chat already says it all
                    answer = ("The request, with its Approve and Refuse buttons, is now in this chat and says everything: "
                              "do not announce it or repeat it. Reply with an empty answer, unless the person asked "
                              "something else as well; then answer only that.")
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
                await self.ticket(title=title[:200], entity_id=ent, note=str(args.get("note") or "")[:2000] or None)
            except Exception as e:  # noqa: BLE001
                return _err(f"The Kiosk did not record the ticket ({type(e).__name__}).")
            # recorded once, by tickets.create (architecture review 16: logged here too, each ticket counted twice)
            return _ok("Recorded.")
        return handler

    def status_report(self, hours: int = 24, now: datetime | None = None) -> dict:
        from .scheduler import job_label
        return status.report(self.state, self.s.store_path, hours, now,
                             label=lambda k: job_label(k, self.skills.all()))

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
            scripts = []
            for name, spec in sorted(skill.scripts.items()):
                if spec.commands is None:
                    if spec.runnable():
                        scripts.append(name)
                    continue
                cmds = spec.runnable_commands()
                if cmds:
                    scripts.append(f"{name} ({', '.join(cmds)})")
            off = [n for n, spec in sorted(skill.scripts.items()) if spec.any_off]
            try:
                with open(skill.skill_md, encoding="utf-8") as f:
                    body = f.read()
            except OSError:
                return _err(f"The skill {sk} could not be read.")
            # ⚠️ IT WORKS WITHOUT THEM, AND KNOWS IT (owner, 2026-10-10): what this skill uses that THIS run lacks — by the
            # villa's switches or by who asked — is said, so the AI adapts and tells the person what is missing.
            # Until 0.6.112 it refused the whole skill, judged on the villa's switches and not on the run's own tools.
            lacks = self.lacks(skill)
            return _ok(SKILL_PREFACE + f"Scripts you may run for this skill: {', '.join(scripts) or 'none'}."
                       + (f" Switched off for this villa: some commands of {', '.join(off)}." if off else "")
                       + (" You do not have these tools here: " + " ".join(b["why"] for b in lacks) +
                          " Do the skill without them, and say in one short sentence what that leaves out." if lacks else "")
                       + "\n\n" + body)
        return handler

    def _run_script(self, origin: Origin | None):
        schema = {"type": "object", "properties": {
            "skill": {"type": "string"}, "script": {"type": "string"},
            "args": {"type": "array", "items": {"type": "string"}},
            "vesta_part": {"type": "integer", "minimum": 1}}, "required": ["skill", "script"]}

        @tool("run_skill_script", "Run one of a skill's scripts with its arguments and get its JSON output. "
                                  "The code adds --pack, --store and --zone.", schema)
        async def handler(args: dict) -> dict:
            sk, sc = args.get("skill", ""), args.get("script", "")
            skill = self.skills.get(sk)
            job = (skill.scripts[sc].job_only.get(str((args.get("args") or [""])[0])) if sc in skill.scripts else None) \
                if skill and origin and origin.is_conversation else None
            if job:
                # ⚠️ A REPORT ASKED FOR IN A CHAT RUNS AS ITS JOB (owner, 2026-10-01): made here, inside the
                # conversation, it used the chat's brain and limit, and the AI followed the job's own steps
                # to the fm chat — the group that asked got "Done" (villa, 2026-10-01 17:31).
                self.state.log("script_refused", {"skill": sk, "script": sc, "args": args.get("args"), "reason": f"job {job}"})
                if not (self.start_job and self._on("start_job")):
                    # the redirect only where start_job IS one of this run's tools (architecture review 14): with it
                    # switched off for this person, the AI was sent to a tool it did not have
                    return _err(f"This command is the {job} report's own, and starting reports from a chat is switched off "
                                "for this person here. Say so plainly; do not try another way.")
                return _err(f"Asked for in a chat, this is the {job} job: call start_job with name {job}. "
                            "It runs with its own brain and limit and sends its result to this chat.")
            try:
                final = validate_script_args(skill, sk, sc, list(args.get("args") or []), self.s.out_dir)
            except ToolError as e:
                self.state.log("script_refused", {"skill": sk, "script": sc, "args": args.get("args"), "reason": str(e)})
                return _err(str(e))
            key = hashlib.sha256(json.dumps([sk, sc, final]).encode()).hexdigest()
            part = int(args.get("vesta_part") or 1)
            if part > 1 and key in self.parts.cache:
                # ⚠️ THE NEXT PART OF THE SAME RUN, NOT A NEW RUN: running it again would carry its
                # tickets and messages out a second time.
                return _ok(self.parts.serve(key, None, part))
            ans = await asyncio.to_thread(script_run.run, self.s, self.state, skill, sc, final, by=script_run.AI)
            out = ans.text()
            if ans.ok and self.carry_out:
                # ⚠️ THE SAME RESULT AS ON SCHEDULE (owner, 2026-10-01): its tickets are created and its
                # messages sent to their chats; the model still answers the person itself.
                res = ans.result()
                if has_work(res):                                   # outcome.CARRIED_KEYS: carry_out's own list
                    done = await self.carry_out(res, sk, origin, self.s.out_dir)
                    lost = f", {done['not_sent']} could not be delivered" if done.get("not_sent") else ""
                    out = (f"[Carried out by the VESTA Agent: {done['sent']} message(s) sent{lost}, {done['tickets']} "
                           f"ticket(s) created, {done['resolved']} closed. Do not send or create them again.]\n") + out
            text = self.parts.serve(key, out, part)
            return _ok(text) if ans.ok else _err(text or f"The script failed (exit {ans.code}).")
        return handler

    def _start_job(self, chat_id: int, role: str | None):
        from .skills import ai_jobs
        jobs = [(sk, j) for sk, j in ai_jobs(self.skills.all()) if j.get("on_request")]
        names = [j["name"] for _, j in jobs] or ["none"]
        listing = "; ".join(f"{j['name']}: {j.get('description') or sk.description}" for sk, j in jobs) or "none"
        schema = {"type": "object", "properties": {"name": {"type": "string", "enum": names}}, "required": ["name"]}

        @tool("start_job", "Start one of the skills' jobs because the person asked for it (for example a weekly or "
                           "monthly report). It runs as on schedule, with its own model and spending limit, and "
                           "sends its result to this chat when ready. Do not do the job yourself. Call it EVERY time "
                           "a person asks, even if you started it earlier in this conversation: it answers itself "
                           "whether that job is still running. Never say a job is running without calling it. Jobs: "
                           + listing,
              schema)
        async def handler(args: dict) -> dict:
            answer = await self.start_job(str(args.get("name") or ""), chat_id, role)
            self.state.log("job_requested", {"job": args.get("name"), "answer": answer[:80]})
            return _ok(answer)
        return handler

    def _save_file(self):
        schema = {"type": "object", "properties": {
            "name": {"type": "string", "description": "A file name in the out folder, ending .json, .txt or .md."},
            "content": {"type": "string"}}, "required": ["name", "content"]}

        @tool("save_file", "Save a text or JSON file in your out folder, for a skill's script to read as an input "
                           "(for example the sentences a report asks you to write: notes.json). It writes nowhere else "
                           "and cannot overwrite a file a script made.", schema)
        async def handler(args: dict) -> dict:
            name, content = str(args.get("name") or ""), args.get("content")
            if not FILE_NAME.match(name) or not name.endswith((".json", ".txt", ".md")):
                return _err("A plain file name ending .json, .txt or .md.")
            if not isinstance(content, str) or len(content.encode("utf-8")) > SAVE_MAX:
                return _err(f"The content must be text of at most {SAVE_MAX // 1024} KB.")
            if name.endswith(".json"):
                try:
                    json.loads(content)
                except ValueError as e:
                    return _err(f"Not valid JSON: {e}")
            path = os.path.join(self.s.out_dir, name)
            # ⚠️ ONLY ITS OWN FILES: a file a script wrote (facts.json, a report page) is that script's
            # output; the model saving over it would put its own figures in a report.
            # by its place in the run's folder (architecture review 14): by name alone, the model's notes.json of one
            # run let it overwrite a script's notes.json in another
            key = f"{self.s.run_folder}/{name}" if self.s.run_folder else name
            if os.path.exists(path) and not self.state.saved_by_model(key):
                return _err(f"{name} was made by a script: choose another name.")
            os.makedirs(self.s.out_dir, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            self.state.mark_saved_by_model(key)
            self.state.log("saved_file", {"name": name, "bytes": len(content)})
            return _ok(f"Saved {name}.")
        return handler

    def _send(self, origin: Origin | None):
        # ⚠️ "HERE" IS THE CHAT A PERSON ASKED IN. Without it a report asked for in the group went to the
        # fm chat (a private chat on the villa) and the group got only "report sent" (2026-09-30). Which
        # destinations are offered, and where each lands, is routing's answer (Routing.offered / target).
        targets = Routing.offered(origin)
        schema = {"type": "object", "properties": {
            "to": {"type": "string", "enum": targets}, "text": {"type": "string"},
            "attachment": {"type": "string", "description": "A file name in the out folder (an HTML report page), optional."}},
            "required": ["to", "text"]}
        if origin and origin.holds:
            desc = ("Send a message, with a file attached if needed (an HTML report page), to=here: the chat of the "
                    "person you are answering, or the chat this job was asked for in. Nothing goes to another chat. "
                    "A plain answer needs no tool: your reply is sent for you.")
        else:
            desc = ("Send a message, with a file attached if needed. to=owner / to=fm: every chat of the owner or of "
                    "the facility manager (the People list), for scheduled reports and digests.")
        @tool("send_message", desc, schema)
        async def handler(args: dict) -> dict:
            to = args.get("to")
            # a model that writes a destination it was not offered is held to the asker's chat by routing
            if not Routing(self.policy).target(to, origin):
                return _err(f"Nobody is listed as {to} in People: nothing was sent.")
            att = args.get("attachment")
            if att and (not FILE_NAME.match(att) or not os.path.exists(os.path.join(self.s.out_dir, att))):
                return _err(f"{att} is not a file in the out folder.")
            if self.carry_out is None:
                return _err("Messages cannot be sent from here.")
            # every chat of its role, with the heading of a message sent on its own: the one way out (outcome.py)
            item = {"to": to, "text": args.get("text", ""), **({"attachment": att} if att else {})}
            done = await self.carry_out({"send": [item]}, None, origin, self.s.out_dir)
            mid = done.get("sent")
            self.state.log("sent" if mid else "send_refused", {"to": to, "chars": len(args.get("text", "")), "attachment": att})
            if not mid:
                # ⚠️ NEVER "Sent." FOR WHAT DID NOT ARRIVE (architecture review, 2026-10-06): the AI then told the
                # person "the report is in your chat"
                return _err("Telegram did not take this message: nothing was sent. Say so plainly; do not retry in a loop.")
            return _ok("Sent.")
        return handler
