"""The VESTA Agent, one process: Home Assistant's events in, Telegram and the Kiosk out.

What comes in (ha_events.py, one listen-only Home Assistant websocket):
  vesta_critical_event                  the alert desk (the skills' `on_event`)
  telegram_text / _command / _callback  what Home Assistant receives on the villa
                                        bot: messages and button presses for the agent
  telegram_attachment                   a voice message: the skill that handles
                                        `voice_message` prepares its audio, Home
                                        Assistant's speech-to-text turns it into text
What goes out: Telegram messages (telegram.py, send only), Kiosk heartbeat and
Facility tickets (kiosk.py), and — only after a person presses Approve — a service
call through the HA MCP sidecar (actions.py). And one read that HA MCP cannot do:
a voice message's audio to Home Assistant's speech-to-text (/api/stt), which
changes nothing in the villa.

Runs without the model (code only, zero tokens): alert intake, the 5-minute chase,
the ladder buttons (Done / Not found / Need help / Mute), approvals, execution and
read-back, the knowledge pack, the night's checks. With the model: conversations,
and the scheduled jobs that need words (the skills' `prompt:` jobs).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

from . import ai_down, button_data, intake, requests_box, script_run, tool_access
from .ai_jobs import AiJobs
from .chat_jobs import ChatJobs
from .siren import Siren
from .actions import Actions
from .api_errors import AI_DOWN, FOR_PERSON, NEEDS_THE_OWNER
from .delivery import Delivery
from .config import STARTER_DIR
from .ha_events import CONTEXT_KEY, HaEvents
from .incident_thread import IncidentThread
from vesta_shared.result import FAULTS_CHANGED
from .housekeeping import tidy
from .kiosk import Kiosk, KioskError
from .alert_buttons import AlertButtons
from .outcome import Outcome
from .voice import Voice
from .tickets import Tickets
from .policy import NOT_REGISTERED, Person, Policy, problems as policy_problems
from .routing import Origin, Routing
from .scheduler import Scheduler
from .skills import Skills, script_env
from .state import State
from .telegram import Telegram, TelegramError
from .tools import Toolbox, scrub
from .turn import Turns

log = logging.getLogger("vesta")

from .policy import LANGUAGES as LANG  # noqa: E402 — one list, also the VESTA Agent page's menu
#: Commands the agent answers. Any other command belongs to Home Assistant's automations.
def _now_local(tz: str) -> datetime:
    return datetime.now(ZoneInfo(tz))


def _pretty(entity_id: str) -> str:
    obj = entity_id.split(".", 1)[-1]
    return obj.replace("_", " ").strip().capitalize()


@dataclass
class Press:
    """A press on one of the agent's buttons, as its handler gets it."""
    q: dict
    chat: int
    mid: int | None
    msg: dict
    presser: int | None
    person: Person | None
    parts: list[str]
    toast: Callable[[str], Awaitable]


def pack_needs_build(path: str) -> bool:
    """Build the knowledge pack at start: none yet, unreadable, or built before it kept Home Assistant's devices.

    ⚠️ A FORMAT CHANGE CARRIES ITS MIGRATION (0.6.108): an older pack has no devices, and the reports would list
    sensors instead of devices until the 01:30 rebuild."""
    from vesta_shared.knowledge_pack import KnowledgePack
    pack = KnowledgePack.read(path)
    return pack is None or not pack.devices


class Vesta:
    def __init__(self, settings, telegram: Telegram | None = None, reader=None, writer_factory=None,
                 kiosk: Kiosk | None = None, skills: Skills | None = None):
        from vesta_shared.ha_client import McpClient  # noqa: WPS433

        self.s = settings
        self.state = State(settings.state_path)
        # the skills the villa switched off (policy.yaml skills_off) are not loaded: no schedule, no hook, not read
        self.skills = skills or Skills(settings.skills_dir, os.path.join(STARTER_DIR, "skills"),
                                       off=lambda: self.policy().skills_off)
        self._policy: Policy | None = None
        self.reader = reader or McpClient(settings.ha_mcp_url, settings.timezone, write=False)
        self.writer_factory = writer_factory or (lambda: McpClient(settings.ha_mcp_url, settings.timezone, write=True))
        if telegram is not None:
            self.tg = telegram
        elif settings.telegram_enabled and settings.telegram_bot_token:
            self.tg = Telegram(settings.telegram_bot_token)
        else:
            self.tg = None
        cf = {}
        if settings.cf_access_id and settings.cf_access_secret:
            cf = {"CF-Access-Client-Id": settings.cf_access_id, "CF-Access-Client-Secret": settings.cf_access_secret}
        self.cf_headers = cf
        self.kiosk = kiosk if kiosk is not None else Kiosk(settings.kiosk_url, settings.kiosk_token, cf)
        # everything that reaches a chat, and whether it did (delivery.py)
        self.delivery = Delivery(self.tg, self.state, self.policy)
        self.chat_jobs = ChatJobs(self.delivery, self._safe)     # a job asked for in a chat, start to end
        self.actions = Actions(self.policy, self.state, self.writer_factory, names=self.name_of, related=self.related_entities,
                               executed=lambda *a: self.siren.executed(*a))
        self.siren = Siren(self.policy, self.state, self.actions, self._tell_owner_text)
        # a script's result carried out (outcome.py), with the alert buttons and the Kiosk's tickets as their own modules
        # what each chat shows of an incident (incident_thread.py), and an alert's buttons and their press
        self.thread = IncidentThread(self.state, settings.timezone, edit=(self.delivery.edit if self.tg else None),
                                     delete=(self.delivery.delete if self.tg else None))
        self.buttons = AlertButtons(state=self.state, skills=self.skills, store_path=settings.store_path,
                                    thread=self.thread, run_job=self.run_code_job)
        self.tickets = Tickets(kiosk=self.kiosk, state=self.state, store_path=settings.store_path,
                               settle_alert=self.thread.close)
        # a voice message's words (voice.py): the skill prepares the audio, Home Assistant reads it
        self.voice = Voice(self.s, self.tg, self.skills, self.code_command, self.delivery.send, self.state, self.cf_headers)
        self.outcome = Outcome(policy=self.policy, state=self.state, send=self.delivery.send, actions=self.actions,
                               reader=self.reader, tickets=self.tickets, buttons=self.buttons, thread=self.thread,
                               out_dir=settings.out_dir)
        self.server_tools: list[dict] = []
        # the reports (ai_jobs.py): run, made without the AI, started from a chat
        # one AI turn, decided once: its tools by who asks, its brain, limit, record and folder (turn.py)
        self.turns = Turns(settings, self.state, self.policy, server_tools=self._server_tools, toolbox=self.toolbox,
                           system_prompt=self.system_prompt, tell_owner=self._tell_owner, safe=self._safe)
        self.jobs = AiJobs(settings, self.state, self.policy, self.skills, self.delivery, self.chat_jobs, self.outcome,
                           turns=self.turns, safe=self._safe)
        self.bot_username: str | None = None
        self._locks: dict[int, asyncio.Lock] = {}
        self._pack = None
        self._pack_mtime = None

    # ------------------------------------------------------------------ policy and names
    def policy(self) -> Policy:
        """policy.yaml (Settings.policy, the one cache of it); what is wrong in it logged once per change."""
        pol = self.s.policy()
        if pol is not self._policy:
            self._policy = pol
            for p in policy_problems(pol.raw):
                log.warning("policy.yaml: %s", p)
        return pol

    def pack(self):
        """The knowledge pack, read again when the nightly rebuild changes it (None until it is built)."""
        from vesta_shared.knowledge_pack import KnowledgePack
        try:
            m = os.path.getmtime(self.s.pack_path)
        except OSError:
            m = None
        if m != self._pack_mtime:
            self._pack, self._pack_mtime = KnowledgePack.read(self.s.pack_path), m
        return self._pack

    def name_of(self, entity_id: str) -> str:
        pack = self.pack()
        return (pack.name_of(entity_id) if pack else None) or _pretty(entity_id)

    def related_entities(self, entity_ids: list[str]) -> set[str]:
        """What these ids stand for: the members of a group (its entity_id attribute) and the other entities
        of the same device (knowledge pack). An owner-only device behind a wrapper is found this way."""
        out: set[str] = set()
        pack = self.pack()
        rows = pack.rows() if pack else []
        devices = {r["device_id"] for r in rows if r.get("device_id") and r["entity_id"] in entity_ids}
        out |= {r["entity_id"] for r in rows if r.get("device_id") in devices}
        try:
            for _eid, st in (self.reader.states(entity_ids) or {}).items():
                members = ((st or {}).get("attributes") or {}).get("entity_id")
                if isinstance(members, list):
                    out |= {str(m).lower() for m in members}
        except Exception:  # noqa: BLE001
            pass
        return out

    def toolbox(self, allowed: set[str] | None = None, settings=None) -> Toolbox:
        """`allowed`: what the AI may use this time (turn.Terms.tools); None: everything switched on. `settings`: the
        run's own (config.Settings.in_folder: its files' folder); the agent's without one."""
        return Toolbox(settings=settings or self.s, policy=self.policy(), reader=self.reader, actions=self.actions,
                       skills=self.skills, send=self.delivery.send, server_tools=self.server_tools, state=self.state,
                       ticket=self.tickets.create if self.kiosk.enabled else None,
                       carry_out=self.outcome.carry_out, start_job=self.jobs.start, allowed=allowed)

    def lock(self, chat_id: int) -> asyncio.Lock:
        return self._locks.setdefault(int(chat_id), asyncio.Lock())

    # ------------------------------------------------------------------ start
    async def start(self):
        for p, blocking in self.s.problems():
            (log.error if blocking else log.warning)("Setting missing: %s", p)
        copied = self.skills.seed()
        if copied:
            log.info("Starter skills copied to the skills folder (first start): %s", ", ".join(copied))
        try:
            updated, kept = self.skills.update_starters()
        except OSError as e:
            updated, kept = [], []
            log.error("Starter skills could not be updated (%s): the ones in the skills folder stay as they are",
                      type(e).__name__)
        if updated:
            log.info("Starter skills updated to this version (never edited here): %s", ", ".join(updated))
            from . import __version__
            from .history import History
            for name in updated:
                History(self.s.history_path).record("Release", f"{name} updated to engine {__version__} (never edited here)",
                                                    {"kind": "release", "skill": name}, None, None)
        for name in kept:
            log.warning("Starter skill %s: this version brings changes, but yours was edited, so it is kept. "
                        "The new version is in skills/.starter/%s to compare.", name, name)
        names = sorted(self.skills.all())
        log.info("Skills: %s", ", ".join(names) or "none")
        from .skills import ai_jobs
        renamed = self.state.rename_job_runs({f"{sk.name}:{j['when']}": j["name"] for sk, j in ai_jobs(self.skills.all())})
        if renamed:
            log.info("Records: %s AI runs from before jobs had names now carry their job's name", renamed)
        if self.tg:
            try:
                me = await self.tg.open()
                self.bot_username = me.get("username")
                log.info("Telegram: sending as @%s (Home Assistant receives; the agent reads its events)", self.bot_username)
            except TelegramError as e:
                log.error("Telegram: %s", e)
        else:
            log.info("Telegram: off (the app's setting \"Agent replies on Telegram\" is off): nothing is sent")
        if self.kiosk.enabled:
            try:
                await self.kiosk.check()
                log.info("VESTA Kiosk: agreement %s", self.kiosk.info.get("contract"))
                await self._safe(self.tickets.repair())
            except KioskError as e:
                log.warning("VESTA Kiosk: %s", e)
        await self.refresh_server_tools()
        for sk in self.skills.all().values():
            without = tool_access.unavailable(self.policy(), self.server_tools or None, sk)
            if without:
                # it works without them (owner, 2026-10-10: who asks decides, never the skill)
                log.info("Skill %s works without: %s", sk.name, " ".join(b["why"] for b in without))
        if pack_needs_build(self.s.pack_path):
            await asyncio.to_thread(self.build_pack)
        pol = self.policy()
        if not pol.people:
            log.warning("policy.yaml has no people yet: the agent answers nobody. Ask each person to send /whoami "
                        "to the bot and copy the ids from this log into the agent's policy.yaml.")
        log.info("Acting on the villa is %s", "ON" if pol.act_enabled else "OFF (informs only)")

    async def refresh_server_tools(self):
        try:
            self.server_tools = await asyncio.to_thread(self.reader.mcp.list_tools)
        except Exception as e:  # noqa: BLE001
            log.error("HA MCP tools/list failed (%s): Home Assistant tools unavailable until it answers", type(e).__name__)
            return
        names = {t["name"] for t in self.server_tools}
        info = getattr(self.reader.mcp, "server_info", None) or {}
        try:
            # for the page (which holds no token): Rules › AI tools draws its switches from it
            tool_access.save_list(self.s.data_dir, self.server_tools,
                                  " ".join(str(x) for x in (info.get("name"), info.get("version")) if x))
        except OSError as e:
            log.warning("The HA MCP tool list could not be saved for the VESTA Agent page (%s)", type(e).__name__)
        pol = self.policy()
        missing = [n for n in pol.ha_read_tools if n not in names]
        if missing:
            log.warning("Named in policy.yaml but absent from HA MCP: %s", ", ".join(missing))
        destructive = [t["name"] for t in self.server_tools if t["name"] in pol.ha_read_tools
                       and (t.get("annotations") or {}).get("destructiveHint")]
        if destructive:
            log.error("HA MCP marks these allowlisted tools destructive, they stay refused: %s", ", ".join(destructive))
        log.info("HA MCP: %d tools on the server, %d shown to the model", len(names), len(self.toolbox().read_tool_names()))

    # ------------------------------------------------------------------ code-run scripts
    def code_command(self, skill, command: str, values: dict | None = None, timeout: int = 900) -> dict:
        """A command the skill declares (a code job, a hook): its decision, or {} when it failed (script_run.py)."""
        return script_run.run_command(self.s, self.state, skill, command, values, timeout=timeout).result()

    async def run_code_job(self, skill, command: str, timeout: int = 900, values: dict | None = None,
                           origin: Origin | None = None) -> dict:
        res = await asyncio.to_thread(self.code_command, skill, command, values, timeout)
        await self._safe(self.outcome.carry_out(res, skill.name, origin))
        if res.get(FAULTS_CHANGED):
            # the night check rewrote its findings: their open faults in the Kiosk say what is wrong now
            await self._safe(self.tickets.repair())
        return res

    def build_pack(self) -> dict:
        p = subprocess.run([sys.executable, "-m", "vesta_shared.build_pack", "--out", self.s.pack_path,
                            "--store", self.s.store_path, "--zone", self.s.timezone],
                           cwd=self.s.out_dir, env=script_env(self.s), capture_output=True, text=True, timeout=900)
        ok = p.returncode == 0
        self.state.log("pack", {"ok": ok, "stderr": scrub((p.stderr or "")[-400:], self.s.secrets()) if not ok else ""})
        log.info("Knowledge pack %s", "built" if ok else "FAILED (see the state log)")
        try:
            return json.loads(p.stdout or "{}")
        except ValueError:
            return {}

    async def rebuild_pack(self) -> None:
        """The engine's nightly job (scheduler.PACK_AT): the knowledge pack, the tool list, any
        open task still without its Kiosk ticket, and what the agent keeps (housekeeping.tidy)."""
        await asyncio.to_thread(self.build_pack)
        await self.refresh_server_tools()
        await self._safe(self.tickets.repair())
        await self._safe(self.tidy())

    async def tidy(self) -> None:
        keep = self.policy().keep
        gone = await asyncio.to_thread(tidy, self.s, self.state, keep)
        log.info("Housekeeping (settings.keep): removed %s", ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in gone.items()))

    # ------------------------------------------------------------------ Home Assistant's events
    async def on_ha_event(self, event_type: str, data: dict) -> None:
        if event_type == "vesta_critical_event":
            return await self.on_critical(data)
        if event_type == "telegram_sent":
            # Home Assistant's own message: kept by its run's context, for the incident that run raises
            ctx, chat, mid = data.get(CONTEXT_KEY), data.get("chat_id"), data.get("message_id")
            if ctx and chat is not None and mid is not None:
                self.state.note_ha_sent(str(ctx), int(chat), int(mid))
            return None
        bot = data.get("bot") or {}
        if bot.get("username"):
            self.bot_username = bot["username"]
        if event_type == "telegram_callback":
            return await self.handle_callback(data)
        return await self.handle_message(event_type, data)

    async def on_critical(self, event: dict) -> None:
        os.makedirs(os.path.join(self.s.out_dir, "events"), exist_ok=True)
        path = os.path.join(self.s.out_dir, "events", f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(event, f)
        log.info("Alert received: %s — %s (%s)", event.get("phase") or "?", event.get("label") or event.get("rule_id"),
                 event.get("blueprint") or "no blueprint")
        handled = False
        for sk in self.skills.all().values():
            cmd = sk.on_event.get("critical_event")
            if cmd:
                handled = True
                res = await self.run_code_job(sk, cmd, 300, {"event": path})
                log.info("Alert handled by %s: %s%s", sk.name, res.get("decision") or "no decision",
                         f", incident #{res['incident_id']}" if res.get("incident_id") else "")
        if not handled:
            log.warning("Alert received but no skill handles critical events (alert-desk deleted?)")
        self.state.log("critical_event", {"rule": event.get("rule_id"), "phase": event.get("phase"), "handled": handled})

    def beat(self) -> None:
        from vesta_shared.store import Store
        Store(self.s.store_path).beat("ha_events", datetime.now(timezone.utc).isoformat())

    # ------------------------------------------------------------------ messages
    async def handle_message(self, event_type: str, m: dict):
        """A Telegram message, as Home Assistant fired it (fields checked live on 2026-09-30): intake.py decides."""
        got = intake.gate(event_type, m, self.policy(), self.bot_username, self.state.is_own_message)
        from_id = m.get("user_id")
        if got.action != "drop":
            # ⚠️ THE START OF THE TIMELINE (owner, 2026-10-09: the log must cover "the moment the message to request a
            # report is sent / read by the agent" until the report is shown): when the message reached the agent
            log.info("Message received in chat %s (%s)", got.chat, event_type)
        if got.action == "drop":
            if got.why:
                self.state.log("ignored", {"reason": got.why, "chat": got.chat})
            return
        if got.action == "whoami":
            await self.delivery.send(got.chat, f"Your Telegram id: {from_id}. This chat id: {got.chat}.")
            log.info("whoami: person %s (%s) in chat %s", from_id, m.get("from_first"), got.chat)
            return
        if got.action == "unregistered":
            log.info("Unregistered sender: id %s (%s) in chat %s", from_id, m.get("from_first"), got.chat)
            self.state.log("unknown_sender", {"telegram_id": from_id, "chat": got.chat})
            if not got.group:
                await self.delivery.send(got.chat, f"{NOT_REGISTERED} Your Telegram id is {from_id}.")
            return
        if got.action == "new":
            self.state.set_session(got.chat, None)
            await self.delivery.send(got.chat, "New conversation.")
            return
        text = got.text
        if got.voice_file is not None:
            text = intake.without_mention(await self.voice.transcribe(got.chat, got.person, got.voice_file),
                                          self.bot_username)
        if not text:
            return
        await self.converse(got.chat, got.person, text, chat_role=self.policy().chat_role(got.chat) or "private",
                            voice=got.voice_file is not None)

    def _resume_for(self, chat_id: int) -> str | None:
        sid, last = self.state.session(chat_id)
        return intake.resume_for(sid, last, self.s.conversation_reset, self.s.timezone)

    def system_prompt(self) -> str:
        pol = self.policy()
        skills = "; ".join(f"{n} ({sk.description})" if sk.description else n for n, sk in self.skills.all().items())
        return (self.s.instructions() + "\n\n" +
                "Telegram shows your text exactly as written: plain text only, no Markdown (no ** or #, no tables); "
                "a list is lines starting with '- '.\n" +
                "When asked to produce, check or run something, do it again now with your tools: never answer from an "
                "earlier attempt in this conversation. Skills, data and fixes change between messages.\n" +
                f"Your skills: {skills or 'none'}. Read a skill with read_skill before doing its job.\n" + pol.summary() + "\n"
                # ⚠️ NO CLOCK HERE (2026-10-09): the time changed these instructions every minute, so a resumed chat
                # re-sent its whole conversation at full price instead of reading it from the prompt cache (about a
                # tenth of the price). The date and time ride on each message instead (runner.run).
                f"Villa time zone: {self.s.timezone}. The current villa date and time head each message.")

    async def converse(self, cid: int, person: Person | None, text: str, chat_role: str = "private",
                       resume: str | None = "auto", is_continue: bool = False, voice: bool = False):
        async with self.delivery.typing(cid) as answered:
            await self._converse(cid, person, text, chat_role, resume, is_continue, voice, answered)

    async def _converse(self, cid, person, text, chat_role, resume, is_continue, voice, answered):
        async with self.lock(cid):
            self.chat_jobs.turn(cid)                         # a job started now belongs to this turn (chat_jobs.py)
            if resume == "auto":
                resume = self._resume_for(cid)
            lang = LANG.get(person.language, person.language) if person else "English"
            if is_continue:
                prompt = "Continue exactly where you stopped. Do not repeat what you already wrote."
            else:
                # ⚠️ THE LANGUAGE OF THE ANSWER IS THE SKILL'S RULE (owner, 2026-10-05): the
                # engine says which language is saved for the person, never "answer in it".
                said = "a voice message, as transcribed" if voice else "a message"
                prompt = (f"{said.capitalize()} from {person.name if person else 'someone'} (role "
                          f"{person.role if person else '?'}; language saved for them: {lang}) in the {chat_role} chat:\n"
                          f"\"\"\"{text}\"\"\"\nAnswer short.")
            pol = self.policy()
            # what this person may make the AI use here, the chat's brain and limit, its folder: turn.py decides
            res = await self.turns.chat(person, cid, prompt, resume=resume, asked=None if is_continue else text)
            if res.session_id:
                self.state.set_session(cid, res.session_id)
            log.info("Answered %s in chat %s (%s)%s", person.name if person else "system", cid,
                     f"{res.cost_usd:.3f} USD" if isinstance(res.cost_usd, (int, float)) else "cost unknown",
                     f", error {res.error}" if res.error else "")
            answer = res.text
            if res.problem or res.error:
                # ⚠️ NEVER THE RAW ERROR (owner, 2026-10-06): the reason in plain words (api_errors); the owner was
                # told by the turn when no retry can help (no credit, a refused key)
                said = FOR_PERSON.get(res.problem or "unknown", FOR_PERSON["unknown"])
                answer = f"{answer}\n\n{said}" if answer else said
            keyboard = None
            if res.problem in AI_DOWN and not is_continue and tool_access.may_start_job(pol, self.server_tools, person, cid):
                # the AI cannot answer: a report asked for is still made from its figures (ai_down.py decides)
                off = ai_down.offer(text, res.problem, self.jobs.without_ai_able())
                if off.start:
                    answer += "\n\n" + self.jobs.start_without_ai(off.start["name"], res.problem, cid)
                elif off.buttons:
                    answer += "\n\nA report can still be made without the AI, from its figures and charts:"
                    keyboard = ai_down.keyboard(res.problem, off.buttons)
            if res.stopped_at_limit and res.session_id:
                cont = self.state.new_continuation(cid, res.session_id, person.telegram_id if person else None)
                answer = (answer + "\n\n" if answer else "") + \
                    f"Stopped: this answer reached the {res.limit_usd:g} USD limit per reply."
                keyboard = {"inline_keyboard": [[{"text": "Continue", "callback_data": button_data.make(button_data.CONTINUE, cont)}]]}
            answered()                                       # "typing…" ends: the answer is going out
            # the camera pictures the AI looked at go with it (Toolbox.photos)
            mid = await self.delivery.reply(cid, answer, keyboard=keyboard, photos=res.photos)
            await self.chat_jobs.replied(cid, mid)            # this turn's jobs: their waiting message, their "typing…"

    # ------------------------------------------------------------------ button presses
    async def handle_callback(self, q: dict):
        """A button press, as Home Assistant fired it. Only presses on the agent's OWN messages are handled:
        a press on a Home Assistant message (the gate button) is its automation's, and is left alone —
        not even answered, so Home Assistant's own answer is the one the person sees."""
        msg = q.get("message") or {}
        cid = q.get("chat_id") or (msg.get("chat") or {}).get("id")
        mid = msg.get("message_id")
        if not self.state.is_own_message(cid, mid):
            return
        cid = int(cid)
        data = q.get("data") or ""
        presser = q.get("user_id")
        qid = q.get("id")
        pol = self.policy()

        async def toast(text: str):
            await self.delivery.toast(qid, text)

        # ⚠️ ONE TABLE OF BUTTON KINDS (button_data.py): each kind's handler below; who must be registered, once
        kind, parts = button_data.read(data)
        handle = {button_data.APPROVAL: self._press_approval, button_data.CONTINUE: self._press_continue,
                  button_data.ALERT: self._press_alert, button_data.REPORT: self._press_report}.get(kind)
        if handle is None:
            return await toast("Unknown button.")
        person = pol.person(presser)
        if kind in button_data.FOR_PEOPLE_ONLY and person is None:
            return await toast(NOT_REGISTERED)
        await handle(Press(q, cid, mid, msg, presser, person, parts, toast))

    async def _press_approval(self, p: "Press") -> None:
        aid, yn = p.parts
        ap = self.state.approval(aid)
        if ap and ap["chat_id"] != p.chat:
            self.state.log("press_refused", {"approval": aid, "by": p.presser, "reason": "button pressed from another chat"})
            return await p.toast("This button belongs to another chat.")
        out = await asyncio.to_thread(self.actions.decide, aid, p.presser, yn == "y")
        await p.toast(out["toast"])
        if out.get("edit") and p.mid:
            await self.delivery.edit(p.chat, p.mid, out["edit"])

    async def _press_continue(self, p: "Press") -> None:
        cont = self.state.use_continuation(p.parts[0], p.chat, p.presser)
        if not cont:
            return await p.toast("Already continued.")
        if cont.get("not_yours"):
            return await p.toast("Only the person who asked can continue this answer.")
        await p.toast("Continuing.")
        await self.converse(p.chat, p.person, "", chat_role=self.policy().chat_role(p.chat) or "private",
                            resume=cont["session_id"], is_continue=True)

    async def _press_alert(self, p: "Press") -> None:
        await self.buttons.press(p.q, p.chat, p.parts, p.person, p.toast)

    async def _press_report(self, p: "Press") -> None:
        if not tool_access.may_start_job(self.policy(), self.server_tools, p.person, p.chat):
            return await p.toast("Starting a report is not switched on for you here.")
        problem, name = p.parts
        # the pressed message stands for the report until it arrives (chat_jobs.py)
        said = self.jobs.start_without_ai(name, problem, p.chat, waiting_mid=int(p.mid) if p.mid else None)
        await p.toast(said)
        if p.mid:
            # the message itself says so, its buttons gone: a toast alone is easily missed ("nothing happened")
            await self.delivery.edit(p.chat, p.mid, f"{p.msg.get('text') or ''}\n\n{said}".strip())

    async def _server_tools(self) -> list[dict]:
        """HA MCP's tool list, read again when the agent has none yet."""
        if not self.server_tools:
            await self.refresh_server_tools()
        return self.server_tools

    async def _tell_owner_text(self, text: str) -> None:
        owner = Routing(self.policy()).target("owner")
        if owner:
            await self.delivery.send(owner, text)

    # ------------------------------------------------------------------ scheduled model jobs
    async def _tell_owner(self, problem: str | None, already_told: int | None) -> None:
        """No credit, a refused key: every reply and report stops until the owner acts. Told in the owner
        chat at most every 12 hours per kind, and not again in a chat that was just told."""
        text = NEEDS_THE_OWNER.get(problem or "")
        owner = Routing(self.policy()).target("owner") if text else None
        if not owner:
            return
        now = datetime.now(timezone.utc)
        last = self.state.owner_told(problem)
        if last and now - datetime.fromisoformat(last) < timedelta(hours=12):
            return
        self.state.mark_owner_told(problem, now.isoformat())
        if int(owner) != int(already_told or 0):
            await self.delivery.send(owner, text)

    async def housekeeping(self) -> None:
        if not self.server_tools and _now_local(self.s.timezone).minute % 10 == 0:
            await self.refresh_server_tools()

    # ------------------------------------------------------------------ the VESTA Agent page's requests
    async def on_request(self, req: dict) -> dict:
        """What the page asks of the running agent (requests_box.py): it has no Home Assistant access itself."""
        if req.get("kind") == "refresh_tools":
            await self.refresh_server_tools()
            return {"ok": bool(self.server_tools), "tools": len(self.server_tools)}
        if req.get("kind") == "try":
            try:
                skill, script, args = requests_box.try_of(req)
            except ValueError as e:
                return {"ok": False, "error": str(e)}
            return await asyncio.to_thread(self.try_command, skill, script, args)
        return {"ok": False, "error": "Unknown request."}

    def try_command(self, skill_name: str, script: str, args: list[str]) -> dict:
        """Skills › Offline Test: one command on the live villa, its arguments checked as when the AI asks, run
        and judged as every run (script_run.py) — and NOT carried out: its messages and tickets are shown in the
        answer, never sent or recorded. A switched-off skill can be tried: that is how its owner finds out."""
        from .skills import ToolError, take_run_file, validate_script_args
        skill = self.skills.all(include_off=True).get(skill_name)
        # a report run's file chosen on the page is copied in first (skills.take_run_file): the test runs in out/ itself
        args = [take_run_file(self.s.out_dir, a) for a in args]
        try:
            final = validate_script_args(skill, skill_name, script, args, self.s.out_dir)
        except ToolError as e:
            return {"ok": False, "error": str(e)}
        ans = script_run.run(self.s, self.state, skill, script, final, by=script_run.PAGE)
        return {"ok": ans.ok, "exit": ans.code, "verdict": ans.verdict, "verdict_words": ans.verdict_words, "seconds": ans.seconds,
                "output": ans.stdout[:60_000], "error": ans.error}

    async def _safe(self, coro):
        try:
            await coro
        except Exception:  # noqa: BLE001
            log.exception("task failed")

    # ------------------------------------------------------------------ main
    async def main(self, stop: asyncio.Event):
        await self.start()
        await self._safe(self.tidy())
        tasks = [asyncio.create_task(Scheduler(self.s, self.skills, self.state, self.run_code_job, self.jobs.run,
                                               self.rebuild_pack, self.housekeeping).run(stop))]
        if self.s.ha_url and self.s.ha_token:
            events = HaEvents(self.s.ha_url, self.s.ha_token, self.on_ha_event, self.beat, headers=self.cf_headers)
            tasks.append(asyncio.create_task(events.run(stop)))
        if self.kiosk.enabled:
            tasks.append(asyncio.create_task(self.kiosk.heartbeats(stop)))
        tasks.append(asyncio.create_task(requests_box.serve(self.s.data_dir, self.on_request, stop)))
        tasks.append(asyncio.create_task(self.siren.watch(stop)))     # stops the siren on time, after a restart too
        await stop.wait()
        log.info("Stopping")
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.tg:
            await self.tg.close()


async def _run(settings) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # pragma: no cover
            pass
    blocking = [p for p, b in settings.problems() if b]
    if blocking:
        for p in blocking:
            log.error("Setting missing: %s", p)
        log.error("The VESTA Agent is waiting: fill the host's Configuration tab, save, and restart the app.")
        await stop.wait()
        return
    await Vesta(settings).main(stop)
    log.info("Stopped")


def main():
    from . import config

    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = config.load()
    if s.log_level == "debug":
        logging.getLogger().setLevel(logging.DEBUG)
    sys.path.insert(0, s.shared_dir)
    asyncio.run(_run(s))


if __name__ == "__main__":
    main()
