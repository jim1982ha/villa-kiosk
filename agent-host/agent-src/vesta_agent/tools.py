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
import time
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, NamedTuple

from claude_agent_sdk import create_sdk_mcp_server, tool
from vesta_shared import read_guard, retention
from vesta_shared.limits import limit
from vesta_shared.messaging import no_platform_name
from vesta_shared.offline import held_since
from vesta_shared.timeutil import villa_time

from . import __version__, script_run, status, tool_access
from .policy import ROLE_WORDS, Person, Policy
from .kiosk import KioskError, fault_note_chars, fault_title_chars
from .redact import scrub  # noqa: F401 — callers import it from here too
from .routing import Origin, Routing
from .outcome import has_work
from .runner import WEB_SEARCH, step
from .skills import FILE_NAME, Skills, ToolError, validate_script_args

SERVER = "vesta"
#: An entity id's shape: what a read's subject may keep of the AI's arguments (Toolbox._read_about)
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def save_max_bytes() -> int:
    return limit("ai.save_file_bytes", 65536, unit="bytes", group="ai", lo=1024, hi=10485760,
                 says="The largest file the AI may save for a skill to read (a report's sentences, notes).",
                 reached="The save is refused; the AI is told the most it may write.", told="ai")


log = logging.getLogger("vesta.tools")


def part_chars() -> int:
    """One part of a long tool answer: about 15,000 tokens, under the SDK's 25,000-token cut of a tool answer."""
    return limit("ai.tool_answer_chars", 60000, unit="characters", group="ai", lo=5000, hi=90000,
                 says="How much of one tool's answer the AI receives at once (the AI's own tools cut near 100,000).",
                 reached="The rest is served as part 2, 3…, only if the AI asks for it.", told="ai")


def ai_read_defaults(name: str, args: dict, known: set) -> dict:
    """The AI's read with the villa's limits where it gives none: how many rows a page holds, how far back a read
    goes, and the fewest rows it may ask for — values the villa's system would otherwise choose (ha-mcp's own
    defaults: 100 readings, 100 figures, 50 logbook lines, 10 search results, 24 hours, 30 days). Only an argument the
    tool declares."""
    a = dict(args)

    def unset(k: str) -> bool:
        return k in known and a.get(k) in (None, "")
    if name == "ha_get_history":
        stats = a.get("source") == "statistics"
        if unset("limit"):
            a["limit"] = (limit("ai.statistics_rows", 100, unit="figures", group="ai", lo=1, hi=1000,
                                says="Hourly or daily figures the AI receives in one statistics read when it does "
                                     "not ask for a number.",
                                reached="The AI gets the OLDEST figures of the period and is told more exist; it is "
                                        "not made to read on.", told="ai")
                          if stats else
                          limit("ai.history_rows", 100, unit="readings", group="ai", lo=1, hi=1000,
                                says="Readings of a device the AI receives in one history read when it does not ask "
                                     "for a number.",
                                reached="The AI gets the NEWEST readings and is told more exist; it is not made to "
                                        "read on: a week can be answered from its last hours.", told="ai"))
        if "limit" in known and a.get("limit") is not None:
            least = limit("ai.history_min_rows", 1, unit="rows", group="ai", lo=1, hi=1000,
                          says="The fewest readings or figures the AI may ask for in one read.",
                          reached="A smaller number asked for is raised to this one.", told="")
            try:
                if int(a["limit"]) < least:
                    a["limit"] = least
            except (TypeError, ValueError):
                pass
        if unset("start_time"):
            if stats:
                days = limit("ai.statistics_default_days", 30, unit="days", group="ai", lo=1, hi=3650,
                             says="How far back a statistics read of the AI goes when it names no start.",
                             reached="Older figures are not read.", told="ai")
                a["start_time"] = f"{days * 24}h"
            else:
                hours = limit("ai.history_default_hours", 24, unit="hours", group="ai", lo=1, hi=240,
                              says="How far back a history read of the AI goes when it names no start.",
                              reached="Older readings are not read.", told="ai")
                a["start_time"] = f"{hours}h"
    elif name == "ha_get_logs" and (a.get("source") or "logbook") == "logbook" and unset("limit"):
        a["limit"] = limit("ai.logbook_rows", 50, unit="lines", group="ai", lo=1, hi=500,
                           says="Logbook lines the AI receives in one read when it does not ask for a number (the "
                                "villa's system gives 500 at most).",
                           reached="The AI gets the newest lines and is told more exist; it is not made to read on.",
                           told="ai")
    elif name == "ha_search" and unset("limit"):
        a["limit"] = limit("ai.search_results", 10, unit="results", group="ai", lo=1, hi=200,
                           says="Devices the AI's search returns when it does not ask for a number.",
                           reached="Further matches are not listed; the AI is told more exist.", told="ai")
    return a

# What the AI's reads may ask of the villa's system: vesta_shared.read_guard, the one guard for every caller.

SKILL_PREFACE = """[How to run this skill inside VESTA]
You have no shell. Run a script only with the tool run_skill_script(skill, script, args).
The code adds --pack, --store and --zone itself: never pass them, nor --fixture-dir, --role, --confirmed or --from.
Output files: give --out a plain file name (e.g. week.json); the file lands in the agent's out folder and can be
passed by name to another script or attached with send_message.
Any action on the villa (light, lock, siren, automation...) is ha_call_service: it only ASKS a person, who approves
with a button. A task for the facility manager is create_ticket (in a chat it is only offered, with a button). The desk's siren/reply/intake/tick commands are
done by the code, not by you. Ignore the parts of the text below that tell you to run them.
[End of the VESTA note]

"""



ASLEEP_NOTE = ("Unavailable by design (VESTA Kiosk › Advanced Settings › Asleep between reports): it sleeps between "
               "its reports, so \"unavailable\" is not a fault. What it reads is its last state before \"unavailable\" "
               "(its history).")


def with_asleep(text: str, is_asleep) -> str:
    """A read tool's answer with every record of a device unavailable by design marked so (ASLEEP_NOTE) — the AI never
    tells a person that a sleeping door contact is lost (vesta_shared.asleep, owner 2026-10-21)."""
    if not text or '"entity_id"' not in text:
        return text
    try:
        body = json.loads(text)
    except ValueError:
        return text
    hit = []

    def mark(x):
        if isinstance(x, list):
            return [mark(v) for v in x]
        if isinstance(x, dict):
            out = {k: mark(v) for k, v in x.items()}
            if isinstance(x.get("entity_id"), str) and is_asleep(x["entity_id"]):
                out["unavailable_by_design"] = ASLEEP_NOTE
                hit.append(1)
            return out
        return x
    marked = mark(body)
    return json.dumps(marked, ensure_ascii=False) if hit else text


#: What the AI is told beside a state's own last_changed (with_held_since)
HELD_NOTE = ("when this state really began, read from the history: a restart of the villa's system resets "
             "last_changed, so say this time, never last_changed")
HELD_OVER_NOTE = "in this state since before the history read: say \"since before\" this time"


def with_held_since(text: str, history, now: datetime) -> str:
    """A read tool's answer with, on each state record (a state read, a search, a device's entities), since when it REALLY is in that state (`in_state_since`,
    vesta_shared.offline.held_since: one history read for them all), when that is not its last_changed.

    ⚠️ A RESTART IS NOT WHEN A DOOR WAS UNLOCKED (villa, 2026-10-26): the weekly report's headline said "the Master
    Bedroom door has been unlocked since Sunday 13:29", the restart of the villa's system, of a door unlocked since
    Saturday 18:25 — the AI read last_changed, which every restart resets."""
    if not text or '"last_changed"' not in text:
        return text
    try:
        body = json.loads(text)
    except ValueError:
        return text
    records: list[tuple[str, dict]] = []

    def find(x, key=None):
        if isinstance(x, list):
            for v in x:
                find(v)
        elif isinstance(x, dict):
            eid = x.get("entity_id") or (key if isinstance(key, str) and "." in key else None)
            if eid and "state" in x and x.get("last_changed"):
                records.append((eid, x))
            for k, v in x.items():
                find(v, k)
    find(body)
    most = limit("ai.state_since_entities", 20, unit="entities", group="ai", lo=1, hi=100,
                 says="How many devices of one state read the AI is told since when each really is in its state "
                      "(read from the history, past a restart of the villa's system).",
                 reached="A larger read gives the AI the villa's system's own last-changed times only.", told="")
    if not records or len(records) > most:
        return text
    held = {}
    for eid, r in records:
        t = villa_time(r["last_changed"], "UTC")
        if t is not None:
            held[eid] = (str(r.get("state")), t)
    over: set[str] = set()
    real = held_since(history, held, now, over)
    hit = False
    for eid, r in records:
        if eid in real and eid in held and real[eid] < held[eid][1]:
            r["in_state_since"] = real[eid].isoformat()
            r["in_state_since_note"] = HELD_OVER_NOTE if eid in over else HELD_NOTE
            hit = True
    return json.dumps(body, ensure_ascii=False) if hit else text


def without_hidden(text: str, hidden: "set[str] | Callable[[str], bool]") -> str:
    """A read tool's answer without the entities hidden in the villa's system: every record naming one, and every bare
    id of one in a list, dropped wherever it sits; an answer that IS one hidden entity's record says it is hidden.

    ⚠️ HIDDEN IS IGNORED BY THE AGENT, THE AI'S SEARCH TOO (owner, 2026-10-18): the Rules page says hidden devices are
    left out of "what the AI is told", but the AI's own search listed them — asked "turn off the TV", it offered
    three, two of them hidden by the owner.
    ⚠️ EVERY READ TOOL, NOT THE SEARCH ALONE (architecture review scan 3, 2026-10-19): the overview and a state read,
    both on by default, still listed the hidden TV."""
    if not hidden or not text:
        return text
    try:
        body = json.loads(text)
    except ValueError:
        return text
    # `hidden`: the ids, or a test of one (a guest's: profiles.Reads.hides — every device the guest's tablet hides)
    hide = hidden if callable(hidden) else hidden.__contains__

    def named(v) -> bool:
        return isinstance(v, str) and hide(v)

    def gone(v) -> bool:
        return (isinstance(v, dict) and named(v.get("entity_id"))) or named(v)

    def drop(x):
        if isinstance(x, list):
            return [drop(v) for v in x if not gone(v)]
        if isinstance(x, dict):
            return {k: drop(v) for k, v in x.items() if not (named(k) and isinstance(v, dict)) and not gone(v)}
        return x
    if isinstance(body, dict) and (named(body.get("entity_id"))
                                   or (isinstance(body.get("data"), dict) and named(body["data"].get("entity_id")))):
        return json.dumps({"error": "This device is hidden in the villa's system: the agent leaves it out."})
    return json.dumps(drop(body), ensure_ascii=False)


class Parts:
    """Long answers served in parts, so nothing is cut without the model knowing."""

    def __init__(self):
        self.cache: dict[str, str] = {}

    def serve(self, key: str, text: str | None, part: int) -> str:
        if text is not None:
            self.cache[key] = text
        text = self.cache.get(key, "")
        size = part_chars()
        if len(text) <= size:
            return text
        n = (len(text) + size - 1) // size
        part = max(1, min(part, n))
        chunk = text[(part - 1) * size: part * size]
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
    # the web searches the run makes (runner's guard adds each query): the run's scripts are told (run_skill_script)
    searched: list | None = None


class Toolbox:
    def __init__(self, *, settings, policy: Policy, reader, actions, skills: Skills,
                 ask: Callable[..., Awaitable[int]], server_tools: list[dict], state,
                 ticket: Callable[..., Awaitable[str]] | None = None,
                 carry_out: Callable[..., Awaitable[dict]] | None = None,
                 start_job: Callable[..., Awaitable[str]] | None = None,
                 allowed: set[str] | None = None, invoked: str | None = None, inv: str | None = None,
                 searched: list | None = None, villa_devices: Callable[[], Awaitable[dict | None]] | None = None):
        self.s = settings
        # the VESTA Kiosk's villa model, entity → {type, category} (kiosk.Kiosk.villa_devices): what a guest may read is
        # judged on it (profiles.Reads); None when there is no Kiosk
        self.villa_devices = villa_devices
        self._role: str | None = None             # who asks this run (tool_objects): a guest reads what the tablet shows
        # the skill the person's "/command" called for in this turn (intake.gate): the only command skill it may use
        self.invoked = invoked
        self.inv = inv                 # the investigation this run belongs to (fault_offers: one offer each)
        self.policy = policy
        self.reader = reader
        self.actions = actions
        self.skills = skills
        # ⚠️ ONE WAY OUT (owner, 2026-10-10: each message to every chat of its role): an approval request goes through
        # approvals.Approvals.ask, a message through Outcome.carry_out — never a send of this class's own
        self.ask = ask
        self.ticket = ticket
        self.carry_out = carry_out
        self.start_job = start_job
        self.server_tools = {t["name"]: t for t in server_tools}
        self.state = state
        self.parts = Parts()
        # this run's web searches, in order (runner.make_guard adds them) — an investigation's own list, shared by its
        # page follow-up and a Continue (app.toolbox), so the page knows every search made for it
        self.searched: list[str] = searched if searched is not None else []
        # ⚠️ A PICTURE THE AI LOOKED AT IS SHOWN TO THE PERSON TOO (2026-10-06). ha_get_camera_image shows it to the
        # AI only: asked "show me the living room camera", it looked, wrote "here's the current view", and the chat
        # got text. A send_message(camera=) option (0.12.57) was not used by the model either. The reply carries
        # them (app.converse): (base64, mime), in the order looked at, each picture once.
        self.photos: list[tuple[str, str]] = []
        self.sent = 0                  # messages send_message delivered in this run (an answer may be one: a page)
        self.attached: list[str] = []  # the files those messages carried (a command skill's page: command_request.Request.carried)
        self.pages: dict[str, int] = {}  # each of those files → the message it went with, in the asker's chat
        self.offered: list[str] = []   # the faults offered in this run (tools._ticket in a chat)
        self.read: list[str] = []      # the villa's reading tools this run used, each once (command_offers: after_reading)
        # what those reads were about, each once: {tool, entities (named "House Pump (sensor.x)" where the pack names
        # them, else the id), period (in words, or None)} — the subject a command offer keeps (command_offers.subject)
        self.about: list[dict] = []
        # the approval requests this run sent: one shown in the asker's chat is the answer there (app._converse)
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
        self._role = person.role if person else None
        tools = [self._proxy(n) for n in self._read_names]
        for key, build in (("read_skill", self._read_skill), ("run_skill_script", lambda: self._run_script(origin)),
                           ("send_message", lambda: self._send(origin)), ("save_file", self._save_file),
                           ("ha_call_service", lambda: self._call_service(person, chat_id)),
                           ("agent_status", self._status)):
            if self._on(key):
                tools.append(build())
        if origin and origin.is_conversation and person is not None and self.start_job and self._on("start_job"):
            # a person asking, in a chat: never a job (even one started from a chat), so no job starts another
            tools.append(self._start_job(chat_id, person.role, person.name))
        if self.ticket and self._on("create_ticket"):
            tools.append(self._ticket(origin.chat if origin and origin.is_conversation else None))
        return tools

    def for_run(self, person: Person | None, origin: Origin | None) -> "Kit":
        """This run's tools: the SDK server, the names it may call and the built tools — all read off the same list."""
        tools = self.tool_objects(person, origin)
        names = {f"mcp__{SERVER}__{t.name}" for t in tools} | ({WEB_SEARCH} if self.include_web else set())
        return Kit(create_sdk_mcp_server(name=SERVER, version=__version__, tools=tools), names, tools, self.searched)

    def _proxy(self, name: str):
        t = self.server_tools[name]
        schema = json.loads(json.dumps(t.get("inputSchema") or {"type": "object", "properties": {}}))
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})["vesta_part"] = {
            "type": "integer", "minimum": 1, "description": "Part of a long answer to read (1 by default)."}
        desc = (t.get("description") or name)[:limit(
            "ai.tool_description_chars", 4000, unit="characters", group="ai", lo=500, hi=20000,
            says="How much of the villa's reading tool's own explanation of each tool the AI is given.",
            reached="The end of the explanation (where its paging advice often is) is not given.", told="")]

        @tool(name, desc, schema)
        async def handler(args: dict) -> dict:
            args = dict(args or {})
            part = int(args.pop("vesta_part", 1) or 1)
            if name not in self._read_names:
                self.state.log("tool_denied", {"tool": name})
                return _err(f"{name} is not allowed.")
            known = set(((t.get("inputSchema") or {}).get("properties") or {}).keys())
            reads = await self._reads()
            if reads is False:
                return _err("The villa's devices cannot be checked for this person just now: answer without reading them.")
            if why := read_guard.refused(name, args, known, reads):
                self.state.log("tool_arg_refused", {"tool": name, "args": sorted(args)[:10], "why": why[:120]})
                return _err(why)
            args = ai_read_defaults(name, args, known)        # the villa's limits where the AI gives none
            key = hashlib.sha256(json.dumps([name, args], sort_keys=True, default=str).encode()).hexdigest()
            if part > 1 and key in self.parts.cache:
                return _ok(self.parts.serve(key, None, part))
            t0 = time.monotonic()
            try:
                res = await asyncio.to_thread(self.reader.mcp.call_raw, name, args)
            except Exception:  # noqa: BLE001
                return _err("The villa's system did not answer.")
            finally:
                # who called the villa's system, and for how long: the AI's own calls, beside its scripts' lines
                # (retro, 2026-10-15: ha-mcp's log names the request, never the caller)
                log.info("AI: %s %s took %.1f s", name, status.step_summary(**step(name, args))[:100], time.monotonic() - t0)
            blocks = res.get("content") or []
            images = [b for b in blocks if b.get("type") == "image"]
            for b in images:
                photo = (b.get("data"), b.get("mimeType") or "image/jpeg")
                if photo[0] and photo not in self.photos:
                    self.photos.append(photo)
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            if name in read_guard.RESULT_KEEP:              # only what the guard hands on (an integration's state)
                try:
                    text = json.dumps(read_guard.kept(name, json.loads(text)), ensure_ascii=False)
                except (TypeError, ValueError):
                    text = ""                              # not the answer the guard knows: nothing of it
            text = scrub(text, self._secrets())
            text = without_hidden(text, self._hidden())       # every read tool, never the search alone
            if reads is not None:
                text = without_hidden(text, reads.hides)      # and what the asker's tablet hides (a guest's)
            text = with_asleep(text, self._asleep())
            if not res.get("isError") and name != "ha_get_history":   # a history's rows are moments already
                from vesta_shared.ha_client import McpClient
                text = await asyncio.to_thread(with_held_since, text, McpClient(session=self.reader.mcp).history,
                                               datetime.now(timezone.utc))
            facts = await asyncio.to_thread(self._history_facts, args, text) \
                if name == "ha_get_history" and not res.get("isError") else None
            if facts is not None:
                text = facts                                # the period worked out: what the AI answers from
            elif not res.get("isError") and name in ("ha_get_history", "ha_get_logs"):
                # ⚠️ OLDER THAN THE DETAIL KEPT (owner, 2026-10-20): said in the answer, with the long-term figures of
                # that part — the AI never reads "no change" where the villa's system no longer keeps any
                text = await asyncio.to_thread(self._older_part, name, args, text)
            out = {"content": ([{"type": "text", "text": self.parts.serve(key, text, part)}] if text else []) + images}
            if res.get("isError"):
                out["is_error"] = True
            else:
                if name not in self.read:
                    self.read.append(name)
                self._read_about(name, args)
            return out
        return handler

    def _history_facts(self, args: dict, text: str) -> str | None:
        """A history read answered with the facts of its WHOLE period (a skill's `reads_history`: investigate's
        timeline), in place of the readings the villa's system sent — None when no skill reads histories, or the read
        is of long-term figures (source statistics: already the whole period).

        ⚠️ NEVER THE NEWEST 100 AS THE PERIOD (owner, 2026-10-20: "I never want to see wrong responses"). The AI got
        the House Pump's 100 newest readings of 8,700 — 15 minutes at rest — and said it "alternated between 0 and
        1.2 W" all afternoon, while it started every few minutes at 750-1,100 W. The period and the devices are the
        villa's system's own answer (its reading of "12h", "yesterday"); the skill's command reads every change in it.
        When it cannot, the AI is told to say so: never the sample as a fallback."""
        if args.get("source") == "statistics":
            return None
        sk = next((s for s in self.skills.all().values() if s.reads_history), None)
        if sk is None:
            return None
        try:
            outer = json.loads(text)
        except ValueError:
            return None
        body = outer.get("data") if isinstance(outer, dict) and isinstance(outer.get("data"), dict) else outer
        if not isinstance(body, dict) or body.get("source") not in (None, "history"):
            return None
        per = body.get("period") or {}
        ids = [e["entity_id"] for e in body.get("entities") or [] if isinstance(e, dict) and e.get("entity_id")]
        if not ids or not per.get("start") or not per.get("end"):
            return None
        from . import script_run
        ans = script_run.run_command(self.s, self.state, sk, sk.reads_history,
                                     {"entities": ",".join(ids), "start": str(per["start"]), "end": str(per["end"])},
                                     by=script_run.AI)
        lines = (ans.result() or {}).get("lines") if ans.ok else None
        if not lines:
            return json.dumps({"error": f"The history of {', '.join(ids)} could not be worked out just now "
                                        f"({ans.error or 'no answer'}). Say you could not read it; never answer from a "
                                        "part of it."}, ensure_ascii=False)
        return (f"[Worked out by the {sk.name} skill from EVERY recorded change of {per['start']} to {per['end']}, "
                "the whole period you asked for, compared with the days before: answer from these lines and name the "
                "period. Lines flagged ⟵ are unusual against the device's own normal.]\n" + "\n".join(map(str, lines)))

    def _read_about(self, name: str, args: dict) -> None:
        """What a read of the villa was about, kept once (self.about): its devices and period only, never a value read
        or anything else the AI sent."""
        ids, period = status.read_subject(name, args)
        ids = [e for e in ids if ENTITY_ID.match(e)]          # an entity id's shape only: nothing else the AI wrote
        if not ids:
            return
        pack = self._pack()

        def named(e: str) -> str:
            n = pack.name_of(e) if pack is not None else None
            return f"{n} ({e})" if n and n != e else e
        row = {"tool": name, "entities": [named(e) for e in ids], "period": period}
        if row not in self.about:
            self.about.append(row)

    def _older_part(self, name: str, args: dict, text: str) -> str:
        days = self._detailed_days()
        if name == "ha_get_logs":
            return retention.ai_logbook_answer(args, text, days)
        from vesta_shared.ha_client import McpClient
        return retention.ai_history_answer(McpClient(session=self.reader.mcp), args, text, days)

    def _pack(self):
        """The knowledge pack, with the Kiosk's devices unavailable by design (KnowledgePack.load), read once per run;
        None before it is built."""
        if "_pack_read" not in self.__dict__:
            from vesta_shared.knowledge_pack import KnowledgePack
            self.__dict__["_pack_read"] = KnowledgePack.read(self.s.pack_path)
        return self.__dict__["_pack_read"]

    def _detailed_days(self) -> float | None:
        """How many days of detailed history the villa's system holds (the knowledge pack's measure)."""
        pack = self._pack()
        return pack.detailed_days if pack else None

    def _asleep(self):
        """Is an entity unavailable by design (the Kiosk's list, each listed one's whole device: the pack)?"""
        pack = self._pack()
        return pack.is_asleep if pack is not None else (lambda e: False)

    async def _reads(self):
        """What this run's asker may read (profiles.Reads), read once per run: None for everything, False when their
        profile limits it and the Kiosk's villa model, which the limit is judged on, cannot be read."""
        if "_reads_got" in self.__dict__:
            return self.__dict__["_reads_got"]
        from vesta_shared import occupancy
        from vesta_shared.profiles import Reads
        # only a guest's run is held to a profile (the facility manager's tools are tool_access.fm's, everywhere)
        reads = Reads.for_role(self._role) if self._role == tool_access.GUEST else None
        if reads is not None:
            devices = await self.villa_devices() if self.villa_devices else None
            if devices is None:
                reads = False
            else:
                pack = self._pack()
                # who is home, in any form: the villa's "empty" sensor and every presence or occupancy reading
                people = {r["entity_id"] for r in (pack.rows() if pack else [])
                          if r.get("device_class") in ("occupancy", "presence")} | {occupancy.sensor(self.s.pack_path) or ""}
                reads = Reads.for_role(self._role, devices, people - {""})
        self.__dict__["_reads_got"] = reads
        return reads

    def _hidden(self) -> set[str]:
        """The entities hidden in the villa's system (the knowledge pack's)."""
        pack = self._pack()
        return set(pack.hidden) if pack else set()

    def _call_service(self, person: Person | None, chat_id: int | None):
        schema = {"type": "object", "properties": {
            "domain": {"type": "string"}, "service": {"type": "string"},
            "entity_id": {"anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}]},
            "data": {"type": "object"}}, "required": ["domain", "service"]}

        @tool("ha_call_service",
              "Ask for an action on the villa (e.g. light turn_on, lock lock). Usually this does NOT execute: it sends the "
              "request with Approve and Refuse buttons to the person allowed to approve it. A service the villa marks direct "
              "runs at once when the person writing to you asked for it; the answer says which happened and the result. "
              "Name every entity explicitly; use absolute states, never toggle. Act on the device the person named "
              "through its OWN entity (a TV is its media_player, a lamp its light) — never a part or a feature of it in "
              "its place (a screen switch, the plug feeding it): turning the screen off is not turning the TV off. "
              "The agent's rules may refuse the request: say so plainly, and never ask for something else instead. "
              "Call it for EVERY action asked now, even one asked before: whether a request is waiting "
              "or was decided is in the requests line in front of the message, never in your memory of the conversation.",
              schema)
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
                    answer = ("The request, with its Approve and Refuse buttons, is now in this chat and says everything. "
                              "Your written reply will NOT be shown this time. If the person asked something else as "
                              "well, answer only that, with send_message (to=here); otherwise do nothing more.")
            return _ok(answer)
        return handler

    def _ticket(self, offer_in: int | None = None):
        """`offer_in`: the chat of a person being answered — there the fault is only OFFERED, with a button under the
        answer (app._converse) that creates it when a person presses. ⚠️ THE ENGINE DECIDES, NOT THE AI (owner,
        2026-10-11): asked "what happened to the pump", the AI answered with "Ticket created for the facility manager"
        — twice in one day, nobody had asked. A scheduled job or an alert has nobody to press: it creates at once."""
        schema = {"type": "object", "properties": {
            "title": {"type": "string", "description": "What is wrong, in plain words, one line."},
            "entity_id": {"type": "string", "description": "The device concerned, optional."},
            "note": {"type": "string", "description": "What to check, optional."}},
            "required": ["title"]}
        offered = self.offered
        what = ("Offer a fault for the facility manager: a button under your answer creates it in the villa's Facility "
                "records (the VESTA Kiosk) if the person presses it. One per answer. It acts on nothing."
                if offer_in is not None else
                "Record a fault for the facility manager in the villa's Facility records (the VESTA Kiosk). "
                "It does not act on anything. Use it for a job someone must do.")

        @tool("create_ticket", what, schema)
        async def handler(args: dict) -> dict:
            title = str(args.get("title") or "").strip()
            if not title:
                return _err("A ticket needs a title.")
            ent = str(args.get("entity_id") or "").strip() or None
            if ent and not re.match(r"^[a-z_]+\.[a-z0-9_]+$", ent):
                return _err(f"{ent} is not an entity id.")
            note = str(args.get("note") or "")[:fault_note_chars()] or None
            if offer_in is not None:
                if offered:
                    return _err("A fault is already offered under this answer: put everything in that one's note.")
                offered.append(self.state.new_ticket_offer(offer_in, title[:fault_title_chars()], ent, note, self.inv))
                return _ok("Offered, NOT created: a button under your answer lets the person create it. Never say it "
                           "was created; you may say they can create it with the button.")
            try:
                await self.ticket(title=title[:fault_title_chars()], entity_id=ent, note=note)
            except KioskError as e:
                # the Kiosk's own words, so the person hears why (not "KioskError")
                return _err(f"The Kiosk did not record the ticket: {e}.")
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
        most = limit("ai.status_hours", 168, unit="hours", group="ai", lo=24, hi=8760,
                     says="How far back the AI may look at what the agent itself did (\"what did you do last night?\").",
                     reached="A longer look back is shortened to this; the AI's tool says the most.", told="ai")
        default = min(most, limit("ai.status_default_hours", 24, unit="hours", group="ai", lo=1, hi=8760,
                                  says="How far back the AI looks at what the agent itself did when the question says "
                                       "no period.",
                                  reached="Earlier records are read only when the question asks for them.", told=""))
        schema = {"type": "object", "properties": {
            "hours": {"type": "integer", "description": f"How far back, in hours (default {default}, at most {most})."}}}

        @tool("agent_status", "What YOU (the VESTA Agent) did recently: scheduled jobs run, alerts followed, "
                              "buttons pressed, tickets, actions asked or done, failures, AI cost. Read-only. "
                              "Use it for 'what did you do last night?'. Times are UTC.", schema)
        async def handler(args: dict) -> dict:
            try:
                hours = max(1, min(most, int(args.get("hours") or default)))
            except (TypeError, ValueError):
                return _err("hours must be a whole number.")
            return _ok(scrub(json.dumps(self.status_report(hours), default=str), self._secrets()))
        return handler

    def gated(self, skill) -> str | None:
        """Why this run may not use `skill`: a skill only its command starts (skills.Skill.command), not called for."""
        if skill is not None and skill.command and skill.name != self.invoked:
            return (f"The {skill.name} skill runs only when the person writes /{skill.command} with their question. "
                    f"Answer without it; you may tell them to write /{skill.command} for that.")
        return None

    def _read_skill(self):
        @tool("read_skill", "Read the full instructions of one of your skills before doing its job.",
              {"type": "object", "properties": {"skill": {"type": "string"}}, "required": ["skill"]})
        async def handler(args: dict) -> dict:
            sk = args.get("skill", "")
            skill = self.skills.get(sk)
            if skill is None:
                return _err(f"No skill {sk}. Your skills: {', '.join(self.skills.all()) or 'none'}.")
            if self.gated(skill):
                return _err(self.gated(skill))
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
            # the settings it names, with their values now (limits_tab.fill_named): the guide writes no number
            try:
                from .ui.limits_tab import LimitsTab, fill_named
                # beside the loop, never in it: the first reading parses the source (review K: a second of nothing)
                names = await asyncio.to_thread(lambda: LimitsTab(self.s, None).names(sk))
                body = fill_named(body, names)
            except Exception:  # noqa: BLE001 — the guide as written, never no guide
                log.exception("The %s skill's settings could not be filled into its guide", sk)
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
            if self.gated(skill):
                self.state.log("script_refused", {"skill": sk, "script": sc, "args": args.get("args"), "reason": "command"})
                return _err(self.gated(skill))
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
                    return _err(f"This command is the {job} report's own. {tool_access.start_job_off('this person')} "
                                "Say so plainly; do not try another way.")
                return _err(f"Asked for in a chat, this is the {job} job: call start_job with name {job}. "
                            "It runs with its own brain and limit and sends its result to this chat.")
            try:
                final = validate_script_args(skill, sk, sc, status.script_args(args.get("args") or []), self.s.out_dir)
            except ToolError as e:
                self.state.log("script_refused", {"skill": sk, "script": sc, "args": args.get("args"), "reason": str(e)})
                return _err(str(e))
            key = hashlib.sha256(json.dumps([sk, sc, final]).encode()).hexdigest()
            part = int(args.get("vesta_part") or 1)
            if part > 1 and key in self.parts.cache:
                # ⚠️ THE NEXT PART OF THE SAME RUN, NOT A NEW RUN: running it again would carry its
                # tickets and messages out a second time.
                return _ok(self.parts.serve(key, None, part))
            # ⚠️ A SCRIPT KNOWS THE WEB WAS USED (owner, 2026-10-11: "include the sources, when web_search tool is used"):
            # the investigation page refuses to be made without the pages behind what the AI read on the web
            run_s = replace(self.s, web_searches=json.dumps(self.searched[:limit(
                "ai.web_searches_kept", 20, unit="searches", group="ai", lo=1, hi=200,
                says="Web searches of one answer handed to a skill's page as its sources.",
                reached="Later searches are not listed among the page's sources.", told="")])
                            if self.searched else "",
                            web_search_on="1" if self.include_web else "", asker=(origin.role if origin else None) or "")
            ans = await asyncio.to_thread(script_run.run, run_s, self.state, skill, sc, final, by=script_run.AI)
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

    def _start_job(self, chat_id: int, role: str | None, name: str | None = None):
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
            answer = await self.start_job(str(args.get("name") or ""), chat_id, role, by=name)
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
            most = save_max_bytes()
            if not isinstance(content, str) or len(content.encode("utf-8")) > most:
                return _err(f"The content must be text of at most {most // 1024} KB.")
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
        per_language = {"type": "object", "additionalProperties": {"type": "string"}}
        schema = {"type": "object", "properties": {
            "to": {"type": "string", "enum": targets},
            "text": {"anyOf": [{"type": "string"}, per_language], "description": "The message; for a role whose people "
                     "read several languages, one version per language: {\"German\": \"…\", \"French\": \"…\"}."},
            "title": {"type": "string", "description": "A report's title, exactly as its script printed it (its "
                      "\"title\"): the agent writes it at the top, and who the message is for under it."},
            "attachment": {"anyOf": [{"type": "string"}, per_language], "description": "A file name in the out folder "
                           "(an HTML report page), optional; one per language like text when each language has its page."}},
            "required": ["to", "text"]}
        if origin and origin.holds:
            desc = ("Send a message, with a file attached if needed (an HTML report page), to=here: the chat of the "
                    "person you are answering, or the chat this job was asked for in. Nothing goes to another chat. "
                    "A plain answer needs no tool: your reply is sent for you.")
        else:
            langs = {r: [lang.name for lang, _chats in Routing(self.policy).readers(r)] for r in ROLE_WORDS}
            desc = ("Send a message, with a file attached if needed. to=owner / to=fm: every chat of the owner or of "
                    "the facility manager (the People list), for scheduled reports and digests. "
                    + " ".join(f"The {ROLE_WORDS[r].lower()}'s people read {' and '.join(ls)}"
                               + (": text is then one version per language, each sent to the people who read it."
                                  if len(ls) > 1 else ".") for r, ls in langs.items() if ls))
        @tool("send_message", desc, schema)
        async def handler(args: dict) -> dict:
            to = args.get("to")
            route = Routing(self.policy)
            # a model that writes a destination it was not offered is held to the asker's chat by routing
            if not route.target(to, origin):
                return _err(f"Nobody is listed as {to} in People: nothing was sent.")
            copies = route.versions(to, origin, args.get("text", ""), args.get("attachment"))
            if isinstance(copies, str):
                return _err(copies)
            for _lang, _text, att in copies:
                if att and (not FILE_NAME.match(att) or not os.path.exists(os.path.join(self.s.out_dir, att))):
                    return _err(f"{att} is not a file in the out folder.")
            if self.carry_out is None:
                return _err("Messages cannot be sent from here.")
            # every chat of its role (of its language), with the heading of a message sent on its own: the one way out
            # (outcome.py). The AI's words never name the platform (TurnReply's rule 9, for what it sends itself)
            items = [{"to": to, "text": no_platform_name(text), **({"language": lang} if lang else {}),
                      **({"attachment": att} if att else {}),
                      **({"title": str(args["title"])} if args.get("title") else {})} for lang, text, att in copies]
            done = await self.carry_out({"send": items}, None, origin, self.s.out_dir)
            mid = done.get("sent")
            atts = [att for _l, _t, att in copies if att]
            self.state.log("sent" if mid else "send_refused", {"to": to, "chars": sum(len(t) for _l, t, _a in copies),
                                                               "attachment": atts[0] if len(atts) == 1 else atts or None,
                                                               **({"languages": [lg for lg, _t, _a in copies]}
                                                                  if len(copies) > 1 else {})})
            if not mid:
                # ⚠️ NEVER "Sent." FOR WHAT DID NOT ARRIVE (architecture review, 2026-10-06): the AI then told the
                # person "the report is in your chat"
                return _err("Telegram did not take this message: nothing was sent. Say so plainly; do not retry in a loop.")
            self.sent += 1
            for att in dict.fromkeys(atts):
                self.attached.append(att)
                here = (done.get("messages") or {}).get(origin.chat) if origin else None
                if isinstance(here, int) and not isinstance(here, bool):
                    self.pages[att] = here
            return _ok("Sent.")
        return handler
