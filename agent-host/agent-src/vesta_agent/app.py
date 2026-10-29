"""The VESTA Agent, one process: Home Assistant's events in, Telegram and the Kiosk out.

What comes in (ha_events.py, one listen-only Home Assistant websocket):
  vesta_critical_event                  the alert desk (the skills' `on_event`)
  telegram_text / _command / _callback  what Home Assistant receives on the villa
                                        bot: messages and button presses for the agent
  telegram_attachment                   a voice message: the skill that handles
                                        `voice_message` prepares its audio and its
                                        plan, transcriber.py writes it out (Whisper
                                        directly, or Home Assistant's speech-to-text)
What goes out: Telegram messages (telegram.py, send only), Kiosk heartbeat and
Facility tickets (kiosk.py), and — only after a person presses Approve — a service
call through the HA MCP sidecar (actions.py). And one read that HA MCP cannot do:
a voice message's audio to Home Assistant's speech-to-text (/api/stt), which
changes nothing in the villa, and the Whisper app asked directly (no token).

Runs without the model (code only, zero tokens): alert intake, the 5-minute chase,
the ladder buttons (Done / Need help), approvals, execution and
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
import threading
import time
import dataclasses
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import button_data, intake, press, requests_box, script_run, tablet, tool_access
from .press import Press
from .ai_jobs import AiJobs
from .chat_facts import ChatFacts
from .chat_jobs import ChatJobs
from .in_progress import FAILED, InProgress
from .incidents import Incidents
from .siren import Siren
from .actions import Actions, related_entities
from .api_errors import NEEDS_THE_OWNER
from .delivery import Delivery
from .config import STARTER_DIR
from .ha_events import CONTEXT_KEY, REGISTRY_EVENTS, HaEvents
from . import layout
from .approvals import Approvals
from .posting import Poster
from .translation import Translations, alert_names, incident_names, names_seconds, villa_names
from .villa_messages import VillaMessages
from .incident_thread import IncidentThread

from .housekeeping import tidy
from .kiosk import Kiosk, KioskError, message_timeout_s
from .kiosk_messages import KioskMessages
from .alert_buttons import AlertButtons
from .outcome import Outcome
from .voice import TelegramAudio, Voice
from .transcriber import villa_entity_ids
from .tickets import Tickets
from .places import tab, where
from .policy import NOT_REGISTERED, Person, Policy, problems as policy_problems
from .routing import Origin, Routing
from .scheduler import Scheduler, every as scheduler_every
from .command_offers import CommandOffers
from .command_request import Request, Requests
from vesta_shared.limits import limit
from vesta_shared.messaging import SIREN_TITLE
from .fault_offers import FaultOffers
from .skills import SEEDED, Skills, script_env
from .state import State
from .telegram import Telegram, TelegramError
from .tools import Toolbox, scrub
from .turn import Turns
from .turn_reply import TurnReply
from .notice import TAKEN_STAGE, Notices, note_step

log = logging.getLogger("vesta")

from .policy import Language  # noqa: E402 — one list, also the VESTA Agent page's menu
#: Commands the agent answers. Any other command belongs to Home Assistant's automations.
def _now_local(tz: str) -> datetime:
    return datetime.now(ZoneInfo(tz))


def _pretty(entity_id: str) -> str:
    obj = entity_id.split(".", 1)[-1]
    return obj.replace("_", " ").strip().capitalize()




def pack_needs_build(path: str) -> bool:
    """Build the knowledge pack at start: none yet, unreadable, built before it kept Home Assistant's devices, or by
    older rules (knowledge_pack.PACK_RULES: hidden entities still in it).

    ⚠️ A FORMAT CHANGE CARRIES ITS MIGRATION (0.6.108): an older pack has no devices, and the reports would list
    sensors instead of devices until the 01:30 rebuild."""
    from vesta_shared.knowledge_pack import PACK_RULES, KnowledgePack
    pack = KnowledgePack.read(path)
    return pack is None or not pack.devices or pack.rules < PACK_RULES


#: How often the agent reads the VESTA Kiosk's faults (one closed in the Cockpit settles its alert's messages).
KIOSK_EVERY_S = 300


def photo_max_bytes() -> int:
    """The largest photo the AI is shown: the Anthropic API takes an image of at most 5 MB."""
    return limit("telegram.photo_bytes", 5242880, unit="bytes", group="ai", lo=102400, hi=5242880,
                 says="The largest photo a person sends that the AI looks at (the AI takes 5 MB at most).",
                 reached="The photo is not looked at; the person is asked to send it again or describe it.",
                 told="person")


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
        # one reading of the villa's devices at a time (the night's, the start's, one after a registry change)
        self._pack_lock = threading.Lock()
        self._devices_due: float | None = None
        self._devices_task: asyncio.Task | None = None
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
        # what runs, for whom, what it promised, whether its result arrived — and what a stop cut (in_progress.py)
        self.work = InProgress(self.state, settings.timezone)
        # a tablet's conversation (tablet.py, ticket 21 of "One inbox"): Delivery's second sink, and the inbox it is asked in
        self.tablet = tablet.Tablet(self.kiosk, self.state)
        self.delivery = Delivery(self.tg, self.state, self.policy, self.work, tablet=self.tablet)
        self.delivery.on_unreachable = self._tell_unreachable
        # what is happening for a chat beyond its conversation, told to the AI with each message there (chat_facts.py)
        named = Incidents(settings.store_path)
        self.chat_facts = ChatFacts(self.state, self.work, settings.timezone, closed=named.closed, name=named.name)
        self.actions = Actions(self.policy, self.state, self.writer_factory, names=self.name_of,
                               related=lambda ids: related_entities(self.pack(), self.reader, ids),
                               executed=lambda *a: self.siren.executed(*a), tablet_keeps=lambda: self.kiosk.enabled)
        self.siren = Siren(self.policy, self.state, self.actions, self._tell_owner_siren)
        # a script's result carried out (outcome.py), with the alert buttons and the Kiosk's tickets as their own modules
        # what each chat shows of an incident (incident_thread.py), and an alert's buttons and their press
        self.thread = IncidentThread(self.state, settings.timezone, edit=(self.delivery.edit if self.tg else None),
                                     delete=(self.delivery.delete if self.tg else None))
        self.buttons = AlertButtons(state=self.state, skills=self.skills, store_path=settings.store_path,
                                    thread=self.thread, run_job=self.run_code_job, facts=self.chat_facts)
        self.tickets = Tickets(kiosk=self.kiosk, state=self.state, store_path=settings.store_path,
                               settle_alert=self.thread.close, timezone=settings.timezone,
                               story=lambda iid: self.notices.story(iid), restate_alert=self._alert_taken,
                               rechecked=lambda: {r for sk in self.skills.all().values() for r in sk.rechecks},
                               nightly_at=self.nightly_at)
        # a fault offered in a chat, start to end (fault_offers.py, review 32)
        self.requests = Requests(self.state, self.skills)   # a command skill's request, its turns (command_request.py)
        self.fault_offers = FaultOffers(self.state, self.delivery, self.tickets,
                                        lambda chat: self.s.in_folder(f"chats/{chat}").out_dir, facts=self.chat_facts)
        # a voice message's words (voice.py): the skill prepares the audio and the plan, transcriber.py runs it
        self.voice = Voice(self.s, self.skills, self.code_command, self.delivery.send, self.state, self.cf_headers,
                           entity_ids=lambda: villa_entity_ids(self.reader))
        # the heading of every message the agent sends on its own (notice.py): who it is for, the incident, its history
        incidents = Incidents(settings.store_path)        # the alert desk's incidents, as the engine reads them
        self.notices = Notices(self.state, self.policy, settings.timezone, name=incidents.name,
                               closed=incidents.closed, runs=incidents.runs, reaches=incidents.reaches,
                               watching=incidents.watching)
        self.thread.name = incidents.name                    # "#9-P2" in a pointer, as the title names it
        self.thread.retitle = self.notices.retitle           # a settled copy of a closed incident is headed "Closed"
        self.thread.reheading = self.notices.heading         # a replaced status: every earlier step listed again
        self.thread.language = self.notices.lang             # each chat's Status in its own language (owner, 2026-10-23)
        self.thread.restatus = self.notices.restatus
        # putting one message in one chat (posting.py): the alerts and the approval requests both use it
        # an alert card's own words in each chat's language, learnt once per sentence pattern (translation.py)
        self.translations = Translations(self.state, skills=self.skills, settings=settings,
                                         names=lambda iid: incident_names(
                                             self.pack(), ents := incidents.entities(iid), self.state.entity_names(ents)),
                                         thread=self.thread)
        self.thread.translate = self.translations.draw
        self._villa_tasks: set[asyncio.Task] = set()
        self.villa_messages = VillaMessages(self.state, self.translations, lambda chat: self.notices.lang(chat),
                                            self.delivery.edit, names=lambda: villa_names(self.pack(), self.state.all_entity_names()))
        # every message written on Telegram is also kept for the tablet, in the background (kiosk_messages.py): the thread
        # keeps an alert's, an approval's and a snapshot's, the poster a note sent on its own
        self.messages = KioskMessages(self.kiosk, message_timeout_s)
        self.thread.mirror = self.messages.keep
        self.poster = Poster(send=self.delivery.send, thread=self.thread, notices=self.notices,
                             timezone_name=settings.timezone, edit=self.delivery.edit, translations=self.translations,
                             mirror=self.messages.keep)
        # a job asked for in a chat, start to end (chat_jobs.py); what it tells a chat goes titled, through the poster
        self.chat_jobs = ChatJobs(self.delivery, self._safe, self.work, facts=self.chat_facts, poster=self.poster)
        # an approval request from start to end (approvals.py); the siren's gate asks through it too
        self.approvals = Approvals(state=self.state, policy=self.policy, actions=self.actions, thread=self.thread,
                                   post=self.poster.post, timezone_name=settings.timezone, safe=self._safe,
                                   edit=self.delivery.edit, tablet_keeps=lambda: self.kiosk.enabled)
        self.outcome = Outcome(policy=self.policy, state=self.state, send=self.delivery.send, actions=self.actions,
                               reader=self.reader, tickets=self.tickets, buttons=self.buttons, thread=self.thread,
                               notices=self.notices, out_dir=settings.out_dir, timezone_name=settings.timezone,
                               poster=self.poster, ask=self.approvals.ask, incidents=incidents)
        self.server_tools: list[dict] = []
        # the reports (ai_jobs.py): run, made without the AI, started from a chat
        # one AI turn, decided once: its tools by who asks, its brain, limit, record and folder (turn.py)
        self.turns = Turns(settings, self.state, self.policy, server_tools=self._server_tools, toolbox=self.toolbox,
                           system_prompt=self.system_prompt, tell_owner=self._tell_owner, safe=self._safe)
        self.jobs = AiJobs(settings, self.state, self.policy, self.skills, self.delivery, self.chat_jobs, self.outcome,
                           turns=self.turns, safe=self._safe)
        # a command skill a reply names, offered as a button and run as if typed (command_offers.py)
        self.command_offers = CommandOffers(self.state, self.skills, self.gate, self.handle_message, self.delivery)
        self.turn_reply = TurnReply(jobs=self.jobs, state=self.state, fault_offers=self.fault_offers,
                                    approvals=self.approvals, command_offers=self.command_offers)
        self.bot_username: str | None = None
        self._locks: dict[int, asyncio.Lock] = {}
        self._kiosk_read = 0.0            # when the Kiosk's faults were last read (housekeeping)
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
        """The knowledge pack, read again when a rebuild changes it, the Kiosk's list beside it or the owner's device
        kinds change (None until it is built)."""
        from vesta_shared.asleep import path_beside
        from vesta_shared.knowledge_pack import KnowledgePack

        def mtime(path):
            try:
                return os.path.getmtime(path)
            except (OSError, TypeError):
                return None
        m = (mtime(self.s.pack_path), mtime(path_beside(self.s.pack_path)), mtime(self.s.asset_kinds_path))
        if m != self._pack_mtime:
            self._pack, self._pack_mtime = KnowledgePack.read(self.s.pack_path, self.s.asset_kinds_path), m
        return self._pack

    def name_of(self, entity_id: str) -> str:
        pack = self.pack()
        return (pack.name_of(entity_id) if pack else None) or _pretty(entity_id)

    def toolbox(self, allowed: set[str] | None = None, settings=None, request: Request | None = None) -> Toolbox:
        """`allowed`: what the AI may use this time (turn.Terms.tools); None: everything switched on. `settings`: the
        run's own (config.Settings.in_folder: its files' folder); the agent's without one. `request`: the command
        skill's request this turn answers (command_request.py): its skill, its id, its web searches so far."""
        return Toolbox(settings=settings or self.s, policy=self.policy(), reader=self.reader, actions=self.actions,
                       skills=self.skills, ask=self.approvals.ask, server_tools=self.server_tools, state=self.state,
                       ticket=self.tickets.create if self.kiosk.enabled else None,
                       carry_out=self.outcome.carry_out, start_job=self.jobs.start, allowed=allowed,
                       invoked=request.name if request else None, inv=request.inv if request else None,
                       searched=request.searched if request else None)

    def lock(self, chat_id: int) -> asyncio.Lock:
        return self._locks.setdefault(int(chat_id), asyncio.Lock())

    # ------------------------------------------------------------------ start
    async def start(self):
        for p, blocking in self.s.problems():
            (log.error if blocking else log.warning)("Setting missing: %s", p)
        first = not os.path.exists(os.path.join(self.skills.dir, SEEDED))
        copied = self.skills.seed()
        if copied:
            log.info("Starter skills copied to the skills folder (%s): %s",
                     "first start" if first else "new in this version", ", ".join(copied))
            if not first:
                from . import __version__
                from .history import History
                for name in copied:
                    History(self.s.history_path).record("Release", f"{name} added by engine {__version__} (a new starter skill)",
                                                        {"kind": "release", "skill": name}, None, None)
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
        # a device still being followed when the agent stopped (an approved curtain): followed again (approvals.py)
        await self._safe(self.approvals.resume())
        # a job asked for in a chat that the stop cut: its waiting message says so (chat_jobs.py)
        await self._safe(self.chat_jobs.recover())
        for sk in self.skills.all().values():
            without = tool_access.unavailable(self.policy(), self.server_tools or None, sk)
            if without:
                # it works without them (owner, 2026-10-10: who asks decides, never the skill)
                log.info("Skill %s works without: %s", sk.name, " ".join(b["why"] for b in without))
        await asyncio.to_thread(self.migrate_asset_kinds)
        if pack_needs_build(self.s.pack_path):
            await asyncio.to_thread(self.build_pack)
        else:
            # ⚠️ A RESTART READS THE DEVICES AGAIN (owner, 2026-10-21): what changed while the agent was stopped (an
            # entity unhidden, a device deleted) waited for 01:30; read in the background, the start is not held up
            self.devices_changed(0)
        pol = self.policy()
        # People rows with no person but a group still answer its members (policy.member): only an empty list is "nobody"
        if not pol.destinations:
            log.warning("People is empty: the agent answers nobody and posts nowhere. In each chat to use, send /whoami "
                        "to the bot and add the ids in %s.", where("people"))
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
    def code_command(self, skill, command: str, values: dict | None = None, timeout: int | None = None) -> dict:
        """A command the skill declares (a code job, a hook): its decision, or {} when it failed (script_run.py)."""
        return script_run.run_command(self.s, self.state, skill, command, values, timeout=timeout).result()

    async def run_code_job(self, skill, command: str, timeout: int | None = None, values: dict | None = None,
                           origin: Origin | None = None) -> dict:
        ans = await asyncio.to_thread(script_run.run_command, self.s, self.state, skill, command, values, timeout=timeout)
        if not ans.ok:
            # a scheduled run's end row says the script stopped (in_progress.InProgress.verdict): the Overview's
            # "Scheduled jobs run" read the claim and said "run at 02:00" of a night check that stopped at once
            self.work.verdict(FAILED, f"{command.split()[0] if command.split() else '?'} stopped: {ans.error or 'no output'}"[:limit(
                "jobs.failure_line_chars", 160, unit="characters", group="text", lo=40, hi=2000,
                says="The longest line saying why a scheduled job stopped (Overview › Scheduled jobs run).",
                reached="The rest of the line is cut.", told="")])
        res = ans.result()
        # faults changed (the night check rewrote its findings, a recheck closed one): carry_out brings the Kiosk's in line
        await self._safe(self.outcome.carry_out(res, skill.name, origin))
        return res

    def migrate_asset_kinds(self) -> dict[str, str] | None:
        """The device kinds a villa typed into its old helper (asset_kinds.OLD_HELPER), moved ONCE into the file the
        page writes (vesta_shared.asset_kinds.migrate), and recorded in Page changes; the helper is never read after.

        ⚠️ THE OWNER'S VALUE IS KEPT (owner, 2026-10-28: the picker replaces the text box): a kind set there before this
        version stays the device's kind, now shown and changed on the page. A villa's system that does not answer
        writes nothing: the next start tries again, never an empty file that would drop the owner's value."""
        from vesta_shared import asset_kinds

        def state():
            if asset_kinds.OLD_HELPER in self.reader.not_found([asset_kinds.OLD_HELPER]):
                return None
            return (self.reader.states([asset_kinds.OLD_HELPER]).get(asset_kinds.OLD_HELPER) or {}).get("state")
        try:
            done = asset_kinds.migrate(self.s.asset_kinds_path, state)
        except Exception as e:  # noqa: BLE001 — the villa's system not readable now: tried again at the next start
            log.warning("The device kinds set in the villa's system could not be read (%s): tried again at the next "
                        "start", type(e).__name__)
            return None
        if not done or not done[0]:
            return None
        kinds, text = done
        from .history import History
        from .places import where
        History(self.s.history_path).record(
            "Release", f"{where('kinds')}: {len(kinds)} set in the villa's system before, kept here", {"kind": "kinds"},
            None, text)
        log.info("Device kinds moved from %s to %s: %s", asset_kinds.OLD_HELPER, self.s.asset_kinds_path,
                 ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))
        return kinds

    def build_pack(self) -> dict:
        with self._pack_lock:
            return self._build_pack()

    def _build_pack(self) -> dict:
        p = subprocess.run([sys.executable, "-m", "vesta_shared.build_pack", "--out", self.s.pack_path,
                            "--store", self.s.store_path, "--zone", self.s.timezone],
                           cwd=self.s.out_dir, env=script_env(self.s), capture_output=True, text=True, timeout=limit(
                               "pack.build_timeout_s", 900, unit="seconds", group="run", lo=60, hi=7200,
                               says="How long the nightly reading of the villa's devices (the skills' list of what "
                                    "exists) may take.",
                               reached="It stops; the skills keep yesterday's list and the failure is logged.",
                               told="person"))
        ok = p.returncode == 0
        kept = limit("errors.pack_stderr_chars", 400, unit="characters", group="keep", lo=100, hi=20000,
                     says="How much of the device list's own error output is kept when it fails.",
                     reached="Only its end is kept.", told="")
        self.state.log("pack", {"ok": ok, "stderr": scrub((p.stderr or "")[-kept:], self.s.secrets()) if not ok else ""})
        log.info("Knowledge pack %s", "built" if ok else "FAILED (see the state log)")
        try:
            return json.loads(p.stdout or "{}")
        except ValueError:
            return {}

    async def rebuild_pack(self) -> None:
        """The engine's nightly job (scheduler.pack_at): the knowledge pack, the tool list, any
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
    def kiosk_answered(self, answer: dict) -> None:
        """The Kiosk's answer to a heartbeat: its list of devices unavailable by design (vesta_shared.asleep) and the
        villa's maintenance mode (vesta_shared.maintenance), kept beside the knowledge pack for every check — a Kiosk
        that does not say one leaves the kept one as it is."""
        from vesta_shared import asleep, maintenance
        ids = asleep.told(answer)
        if ids is not None and asleep.save(self.s.pack_path, ids):
            log.info("The VESTA Kiosk's devices unavailable by design: %s", ", ".join(ids) or "none")
        # the villa's maintenance mode, the Kiosk's switch (vesta_shared.maintenance): the alert desk reads it
        mm = maintenance.told(answer)
        if mm is not None and maintenance.save(self.s.pack_path, mm):
            log.info("The VESTA Kiosk's maintenance mode: %s", "on, only P1 alerts are taken up" if mm else "off")

    def devices_changed(self, settle: float | None = None) -> None:
        """The villa's devices changed (ha_events.REGISTRY_EVENTS): read them again once they have been still for
        `settle` seconds (a rename of ten entities is one reading, not ten)."""
        if settle is None:
            settle = limit("pack.registry_settle_s", 60, unit="seconds", group="run", lo=0, hi=3600,
                           says="How long after the last change to the villa's devices (hidden, renamed, added, "
                                "deleted) the agent reads them again.",
                           reached="Each further change waits this long again; one reading follows the last.", told="")
        self._devices_due = time.monotonic() + settle
        if self._devices_task is None or self._devices_task.done():
            self._devices_task = asyncio.create_task(self._devices_when_still())

    async def _devices_when_still(self) -> None:
        while self._devices_due is not None and time.monotonic() < self._devices_due:
            await asyncio.sleep(max(0.0, self._devices_due - time.monotonic()))
        self._devices_due = None
        log.info("The villa's devices changed: reading them again")
        await self._safe(asyncio.to_thread(self.build_pack))

    async def on_ha_event(self, event_type: str, data: dict) -> None:
        if event_type in REGISTRY_EVENTS:
            return self.devices_changed()
        if event_type == "vesta_critical_event":
            return await self.on_critical(data)
        if event_type == "vesta_message":
            # the villa's own message, in each chat's language afterwards (owner, 2026-10-24); never awaited by the villa
            # beside the socket, never inside it: its telegram_sent may still be on the way
            task = asyncio.create_task(self._safe(self.villa_messages.on_message(data, data.get(CONTEXT_KEY))))
            self._villa_tasks.add(task)
            task.add_done_callback(self._villa_tasks.discard)
            return None
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
        await self._alert_names(event)
        handled = False
        for sk in self.skills.all().values():
            cmd = sk.on_event.get("critical_event")
            if cmd:
                handled = True
                res = await self.run_code_job(sk, cmd, limit(
                    "alerts.hook_timeout_s", 300, unit="seconds", group="run", lo=30, hi=3600,
                    says="How long a skill may take to handle one alert of the villa's own VESTA automations.",
                    reached="That handling stops and counts as failed; the villa's own alert was already sent.",
                    told="person"), {"event": path})
                log.info("Alert handled by %s: %s%s", sk.name, res.get("decision") or "no decision",
                         f", incident #{res['incident_id']}" if res.get("incident_id") else "")
        if not handled:
            log.warning("Alert received but no skill handles critical events (alert-desk deleted?)")
        self.state.log("critical_event", {"rule": event.get("rule_id"), "phase": event.get("phase"), "handled": handled})

    async def _alert_names(self, event: dict) -> None:
        """The alert's devices as the villa's system names them now, kept for its card's translation (translation.py:
        a name is a value, never words to translate). ⚠️ BOUNDED (names_seconds), NEVER FATAL: the card goes on with
        the names kept before and the knowledge pack's."""
        ents = event.get("entities")
        ents = str(ents).split(",") if isinstance(ents, str) else ents if isinstance(ents, list) else []
        ents = [e.strip() for e in ents if isinstance(e, str) and "." in e]
        if not ents:
            return
        try:
            names = await asyncio.wait_for(asyncio.to_thread(alert_names, self.reader, ents), timeout=names_seconds())
            self.state.note_entity_names(names)
        except Exception as e:  # noqa: BLE001 — a timeout too: the names already known are used
            log.info("The alert's device names could not be read from the villa's system (%s): the names already "
                     "known are used", type(e).__name__)

    def beat(self) -> None:
        from vesta_shared.store import Store
        Store(self.s.store_path).beat("ha_events", datetime.now(timezone.utc).isoformat())

    # ------------------------------------------------------------------ messages
    def gate(self, event_type: str, m: dict, person: Person | None = None) -> intake.Intake:
        """What the agent does with this message, by the villa's rules now (intake.gate): a message that arrived, and
        the one a command offer's button stands for (command_offers.py) — judged by the same rule. `person`: a tablet's
        profile, as the Kiosk stamped it (tablet.py)."""
        on = self.skills.commands()
        return intake.gate(event_type, m, self.policy(), self.bot_username, self.state.is_own_message, on,
                           {c: s for c, s in self.skills.commands(include_off=True).items() if c not in on}, person=person)

    async def on_tablet(self, ask: dict) -> None:
        """A question typed on a tablet (tablet.Tablet.listen): it enters where a Telegram message does — the gate, so
        /investigate, /proposal and /new work as there — in its profile's own conversation, as that profile's role."""
        profile = ask.get("profile")
        person, chat = tablet.person_of(profile), tablet.chat_of(profile)
        if person is None or chat is None:
            log.warning("A question from the tablet names no profile this agent answers (%s): not answered", profile)
            return
        if isinstance(ask.get("press"), dict):
            # one of VESTA's buttons pressed there: its short answer goes back to that tablet, under the button
            pressed = ask["press"]

            async def toast(text: str):
                await self.tablet.answer(chat, ask.get("seq"), text)
            return await self._safe(self._pressed(
                f"{pressed.get('kind')}:{pressed.get('id')}", chat, self.policy().member(chat, chat), toast,
                lambda who, parts: press.from_tablet(chat, who, parts, toast, name=person.name)))
        # a spoken question (ticket 23 of "One inbox", hold to talk): read as a voice note, its audio the tablet's
        spoken = isinstance(ask.get("voice"), str) and bool(ask["voice"])
        event_type, m = tablet.as_message(chat, person, str(ask.get("text") or ""), spoken=spoken)
        await self._safe(self.handle_message(event_type, m, person=person,
                                             audio=self.tablet.spoken(chat, ask) if spoken else None))

    async def handle_message(self, event_type: str, m: dict, about: str | None = None, person: Person | None = None,
                             audio=None):
        """A Telegram message, as Home Assistant fired it (fields checked live on 2026-09-30): intake.py decides.
        `about`: what the answer a command offer was under had read (command_offers.subject) — given by the press only,
        never read from an event. `person`: a tablet's profile (on_tablet), never read from an event. `audio`: a voice
        message's audio when it is not a Telegram file (voice.AudioSource: a question spoken on the tablet)."""
        got = self.gate(event_type, m, person)
        from_id = m.get("user_id")
        if got.action != "drop":
            # ⚠️ THE START OF THE TIMELINE (owner, 2026-10-09: the log must cover "the moment the message to request a
            # report is sent / read by the agent" until the report is shown): when the message reached the agent
            if tablet.profile_of(got.chat):
                # a tablet's question is no Telegram event, whatever shape the gate reads it in
                log.info("Message received in the tablet's conversation (%s)", tablet.profile_of(got.chat))
            else:
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
        if got.action == "command_off":
            cmd = (self.skills.all(include_off=True).get(got.invoked).command if got.invoked else "") or ""
            await self.delivery.send(got.chat, f"The {got.invoked} skill is switched off on this villa ({tab('skills')}). "
                                               f"Write your question without /{cmd}.")
            return
        if got.action == "new":
            self.state.set_session(got.chat, None)
            await self.delivery.send(got.chat, "New conversation.")
            return
        # the person waits from now: "typing…" while the message is read (a photo fetched, a voice transcribed) and
        # answered, until the answer goes (delivery.Delivery.hold — the one "typing…" of every wait)
        held = self.delivery.hold(got.chat)
        try:
            text, spoken = got.text, None
            if got.voice_file is not None:
                heard = await self.voice.transcribe(got.chat, got.person,
                                                    audio or TelegramAudio(self.tg, got.voice_file))
                text = intake.without_mention(heard.text if heard else None, self.bot_username)
                spoken = heard.language if heard else None
            image = None
            if got.photo_file is not None:
                image = await self._photo(got.chat, got.photo_file, str(m.get("file_mime_type") or "image/jpeg"))
                if image is None:
                    return
            if got.invoked and not text and image is None:
                # the example is the skill's own (skill.yaml usage): no device of any villa in the engine
                sk = self.skills.get(got.invoked)
                cmd = sk.command if sk else got.invoked
                await self.delivery.send(got.chat, f"Write your question after /{cmd}" +
                                         (f", for example: {sk.usage}" if sk and sk.usage else "") + ".")
                return
            if not text and image is None:
                return
            await self.converse(got.chat, got.person, text, voice=got.voice_file is not None, image=image, held=held,
                                invoked=got.invoked, spoken=spoken, about=about if got.invoked else None)
        finally:
            held()

    async def _photo(self, chat: int, file_id: str, mime: str) -> tuple[str, str] | None:
        """A photo a person sent, ready for the AI (base64, mime); None — and the person told why — when it cannot be."""
        import base64
        if self.tg is None or not file_id:
            return None
        try:
            data = await self.tg.download(file_id, limit=photo_max_bytes())
        except TelegramError as e:
            log.warning("A photo could not be fetched from Telegram: %s", e)
            await self.delivery.send(chat, "This photo could not be fetched from Telegram, or it is too large "
                                           f"(over {photo_max_bytes() // 1_000_000} MB). Send it again, or describe it.")
            return None
        log.info("Photo received in chat %s (%d KB)", chat, len(data) // 1024)
        return base64.b64encode(data).decode("ascii"), mime

    def _resume_for(self, chat_id: int) -> str | None:
        sid, last = self.state.session(chat_id)
        return intake.resume_for(sid, last, self.s.conversation_reset, self.s.timezone)

    def system_prompt(self) -> str:
        pol = self.policy()
        everyone = self.skills.all()
        skills = "; ".join(f"{n} ({sk.description})" if sk.description else n for n, sk in everyone.items() if not sk.command)
        # ⚠️ NOT CHOSEN BY THE AI (owner, 2026-10-11): a skill with a command is used only when the person writes it
        by_command = ", ".join(f"{n} (/{sk.command})" for n, sk in everyone.items() if sk.command)
        return (self.s.instructions() + "\n\n" +
                # ⚠️ BOTH PLACES (ticket 21 of "One inbox"): a tablet's conversation shows text as Telegram does
                "Telegram and the villa's wall tablet show your text exactly as written: plain text only, no Markdown "
                "(no ** or #, no tables); "
                "a list is lines starting with '- '.\n"
                "Only the text you write after your LAST tool call reaches the person: write your whole answer there, "
                "once. Text written before a tool call is never sent, and never send your answer with send_message too.\n" +
                "When asked to produce, check or run something, do it again now with your tools: never answer from an "
                "earlier attempt in this conversation. Skills, data and fixes change between messages.\n" +
                f"Your skills: {skills or 'none'}. Read a skill with read_skill before doing its job — for each new "
                "message, the skill whose description matches it, even when this conversation already talked about the "
                "subject.\n" +
                (f"Skills used ONLY when the person writes their command, never otherwise: {by_command}.\n"
                 if by_command else "") + pol.summary() + "\n"
                # ⚠️ NO CLOCK HERE (2026-10-09): the time changed these instructions every minute, so a resumed chat
                # re-sent its whole conversation at full price instead of reading it from the prompt cache (about a
                # tenth of the price). The date and time ride on each message instead (runner.run).
                f"Villa time zone: {self.s.timezone}. The current villa date and time head each message.")

    async def converse(self, cid: int, person: Person | None, text: str,
                       resume: str | None = "auto", is_continue: bool = False, voice: bool = False,
                       image: tuple[str, str] | None = None, held=None, invoked: str | None = None,
                       request: Request | None = None, spoken: str | None = None, about: str | None = None):
        """`about`: what the answer whose button started this request had read (command_offers.subject), told to the AI
        with the question: a command starts a fresh conversation. `image`: a photo the person sent (base64, mime), `text` its caption: the AI looks at it. `held`: the chat's
        "typing…" taken when the message arrived (handle_message), carried on until the answer goes. `invoked`: the
        command skill the person's "/command" called (a new request); `request`: the one a Continue continues.
        `spoken`: the language Whisper said it heard a voice message in (transcriber.Heard), said beside it; None
        when it did not say (the villa's Whisper never does: instructions.md rule 6 then reads the words)."""
        if request is None and not is_continue:
            request = self.requests.begin(invoked)
        # what they asked, kept until it is answered: a restart in between is said at the next start (chat_jobs)
        asked = ("Continue" if is_continue else text or ("a photo" if image else "a voice message" if voice else "…"))
        async with self.delivery.typing(cid, held=held) as answered, self.chat_jobs.answering(cid, asked):
            await self._converse(cid, person, text, resume, is_continue, voice, answered, image, request, spoken,
                                 about)

    async def _converse(self, cid, person, text, resume, is_continue, voice, answered, image=None,
                        request: Request | None = None, spoken: str | None = None, about: str | None = None):
        async with self.lock(cid):
            self.chat_jobs.turn(cid)                         # a job started now belongs to this turn (chat_jobs.py)
            if resume == "auto":
                # ⚠️ A COMMAND'S SKILL STARTS A FRESH CONVERSATION (owner, 2026-10-11, 20:00): "/investigation" in a chat
                # that already held the morning's answer about the same pump was answered from it in 19 s — no reading
                # at all, no page. With nothing earlier to lean on, the only way to answer is to do the skill's work.
                resume = None if request and not is_continue else self._resume_for(cid)
            lang = Language.of(person.language).name if person else "English"
            if is_continue:
                prompt = "Continue exactly where you stopped. Do not repeat what you already wrote."
            else:
                # ⚠️ THE LANGUAGE OF THE ANSWER IS THE SKILL'S RULE (owner, 2026-10-05): the
                # engine says which language is saved for the person, never "answer in it".
                said = ("a photo (attached: look at it) with this message" if image and text else
                        "a photo (attached: look at it), with no message" if image else
                        (f"a voice message, as transcribed (spoken in {Language.name_of(spoken)})" if spoken else
                         "a voice message, as transcribed") if voice else "a message")
                # ⚠️ WHERE IT WAS WRITTEN, AND HOW THAT PLACE SHOWS THE ANSWER: a tablet's conversation (tablet.WHERE) is
                # no Telegram chat (ticket 21 of "One inbox")
                where = tablet.WHERE if tablet.profile_of(cid) else self.policy().chat_label(cid)
                prompt = (f"{said[0].upper() + said[1:]} from {person.name if person else 'someone'} (role "
                          f"{person.role if person else '?'}; language saved for them: {lang}) in the {where}:\n"
                          f"\"\"\"{text}\"\"\"")
            # a skill only its command starts (skills.Skill.command): this turn's request, or — for a Continue — the one
            # its button carries (state.new_continuation): its id, its offers, its web searches (command_request.py)
            sk = request.skill if request else None
            if sk is not None and not is_continue:
                prompt = (f"{person.name if person else 'The person'} wrote /{sk.command}: this is a request for the "
                          f"{sk.name} skill. Read it with read_skill and follow it.\n\n{prompt}")
                if about:
                    # ⚠️ A FOLLOW-UP'S SUBJECT (review, 2026-10-23): pressed under "and why did it keep starting?", the
                    # fresh conversation had only those words — what the answer it came from read is said with them
                    prompt += (f"\nThe question follows an answer that read these devices (and periods); it is about "
                               f"them unless it names others:\nabout: {about}")
            told_at = None
            if not is_continue:
                checked = await asyncio.to_thread(self.before_answer)
                # ⚠️ WHAT THIS CHAT HAS, AS FACTS, WITH EVERY MESSAGE (owner, 2026-10-23): the digest a job had sent at
                # 14:40 was promised again at 14:50 as "on its way" — the AI read only its own transcript. What is being
                # prepared here now (or that nothing is) and what reached this chat since the AI's last answer here
                # (chat_facts.py: a report's end, an alert's step, a button pressed) head the message
                told_at = datetime.now(timezone.utc)
                here = self.chat_facts.now(cid)
                prompt = "\n\n".join(p for p in (checked, here, prompt) if p)
            pol = self.policy()
            # what this person may make the AI use here, the chat's brain and limit, its folder: turn.py decides
            asked = None if is_continue else (f"[photo] {text}".strip() if image else text)
            began = time.monotonic()
            # a request's own brain and limit, if its skill names them (turn.Turns.chat)
            res = await self.turns.chat(person, cid, prompt, resume=resume, asked=asked, image=image, request=request)
            if res.session_id:
                self.state.set_session(cid, res.session_id)
                if told_at is not None:
                    self.chat_facts.told(cid, told_at)       # what reached the chat until this message is behind it
            log.info("Answered %s in chat %s (%s, %.0f s)%s", person.name if person else "system", cid,
                     f"{res.cost_usd:.3f} USD" if isinstance(res.cost_usd, (int, float)) else "cost unknown",
                     time.monotonic() - began, f", error {res.error}" if res.error else "")
            if sk is not None and sk.deliver and not (res.problem or res.error or res.stopped_at_limit):
                res = await self._delivered(request, cid, person, res, asked or "")
            # what the person receives — text, buttons, offers carried: turn_reply.py decides, in its order
            reply = await self.turn_reply.compose(
                cid, res, asked=text or "", page=sk.deliver.get("page") if sk is not None else None,
                may_start_job=lambda: tool_access.may_start_job(pol, self.server_tools, person, cid),
                is_continue=is_continue, person_id=person.telegram_id if person else None, request=request)
            answered()                                       # "typing…" ends: the answer is going out
            # the camera pictures the AI looked at go with it (Toolbox.photos)
            mid = await self.delivery.reply(cid, reply.text, keyboard=reply.keyboard, photos=res.photos)
            self.fault_offers.delivered(reply.offered, mid)
            # a request this answer told of, shown in another chat: each of its steps rewrites this answer (approvals.py)
            self.approvals.answered(res.approvals, cid, mid, reply.text)
            await self.chat_jobs.replied(cid, mid)            # this turn's jobs: their waiting message, their "typing…"

    async def _delivered(self, request: Request, cid: int, person, res, asked: str):
        """⚠️ WHAT A COMMAND SKILL'S ANSWER CARRIES, CHECKED — NEVER LEFT TO THE AI (owner, 2026-10-11: "make sure this
        always trigger the full use of the skill — HTML report in the response and buttons to create and cancel a
        ticket creation"). skill.yaml `deliver`: the page the answer must have sent (missing: the AI is sent back to it
        once, then the person is told), and a fault always offered — one per investigation `inv` (fault_offers)."""
        sk, inv = request.skill, request.inv
        page, account = sk.deliver.get("page"), sk.deliver.get("fault_offer")
        if page and page not in res.attached:
            log.info("Chat %s: /%s answered without %s: the AI is sent back to make it", cid, sk.command, page)
            again = await self.turns.chat(
                person, cid, f"Your answer has not sent {page}: every /{sk.command} answer carries it. Make it now and send "
                             f"it with send_message (attachment {page}), as the {sk.name} skill says. Write nothing else.",
                resume=res.session_id, request=request)
            # ⚠️ THE FOLLOW-UP'S OWN OUTCOME GOES ON (review 32): its stop at the limit (Continue) and its problem (no
            # credit is not "the page could not be made") — every field by its rule (TurnResult.then)
            res = res.then(again)
            if again.session_id:
                self.state.set_session(cid, again.session_id)
            if page not in res.attached and not (res.problem or res.error or res.stopped_at_limit):
                log.warning("Chat %s: /%s still without %s", cid, sk.command, page)
                res = dataclasses.replace(res, text=((res.text or res.earlier or "").strip() + "\n\n" +
                                                     "The report page could not be made this time.").strip())
        if account and inv:
            self.fault_offers.ensure(cid, inv, account, asked, float(inv))
            res = dataclasses.replace(res, offered=max(res.offered, 1))
        return res

    def before_answer(self) -> str:
        """What each skill's `before_answer` check says now (skills.Skill.before_answer: its script's "text"), for the
        AI to have in front of it before it answers. A check that fails is said to have failed, never left out
        silently: the AI must not answer as if it had seen it."""
        out = []
        for sk in self.skills.all().values():
            if not sk.before_answer:
                continue
            ans = script_run.run_command(self.s, self.state, sk, sk.before_answer, timeout=limit(
                "chat.status_check_timeout_s", 60, unit="seconds", group="run", lo=5, hi=600,
                says="How long a skill's check before each chat answer (the villa's status) may take.",
                reached="The AI is told the check could not run just now, and says so if asked.", told="ai"))
            text = (ans.result() or {}).get("text") if ans.ok else None
            if text:
                out.append(f"[Checked just now by the {sk.name} skill; answer from this, never from memory]\n{text}")
            else:
                out.append(f"[The {sk.name} skill's check could not run just now: say so if asked about it]")
        if self.policy().act_enabled:
            out.append(self.approvals.now())
        return "\n\n".join(out)

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

        await self._pressed(data, cid, pol.member(presser, cid, q.get("from_first")), toast,
                            lambda person, parts: press.from_telegram(q, cid, person, parts, toast))

    async def _pressed(self, data: str, chat: int, person: Person | None, toast, make) -> None:
        """A press, wherever it was made (`make(person, parts)`: press.from_telegram, press.from_tablet), handed to its
        kind's handler. ⚠️ ONE TABLE OF BUTTON KINDS (button_data.py): each kind's handler below; who must be
        registered, once — a tablet's press goes through exactly what a Telegram press does (ticket 22 of "One inbox")."""
        kind, parts = button_data.read(data)
        handle = {button_data.APPROVAL: self.approvals.press, button_data.CONTINUE: self._press_continue,
                  button_data.ALERT: self._press_alert, button_data.REPORT: self._press_report,
                  button_data.TICKET: self._press_ticket, button_data.COMMAND: self.command_offers.press,
                  button_data.DECLINE: self.command_offers.decline}.get(kind)
        if handle is None:
            return await toast("Unknown button.")
        # a listed group's member presses with its role (Policy.member); a tablet's profile as the Kiosk stamped it
        if kind in button_data.FOR_PEOPLE_ONLY and person is None:
            return await toast(NOT_REGISTERED)
        await handle(make(person, parts))

    async def _press_continue(self, p: "Press") -> None:
        cont = self.state.use_continuation(p.parts[0], p.chat, p.presser)
        if not cont:
            return await p.toast("Already continued.")
        if cont.get("not_yours"):
            return await p.toast("Only the person who asked can continue this answer.")
        await p.toast("Continuing.")
        await self.converse(p.chat, p.person, "", resume=cont["session_id"], is_continue=True,
                            request=self.requests.resume(cont.get("invoked"), cont.get("inv")))

    async def _press_ticket(self, p: "Press") -> None:
        await self.fault_offers.press(p)

    async def _press_alert(self, p: "Press") -> None:
        # the presser as this chat knows them (Policy.member: one person may be both owner and fm, each with its name)
        await self.buttons.press(p.chat, p.parts, p.person, p.toast, name=p.person.name, pressed=p.mid,
                                 anywhere=p.place == press.TABLET)

    async def _press_report(self, p: "Press") -> None:
        if not tool_access.may_start_job(self.policy(), self.server_tools, p.person, p.chat):
            return await p.toast(tool_access.start_job_off())
        problem, name = p.parts
        # the pressed message stands for the report until it arrives (chat_jobs.py)
        said = self.jobs.start_without_ai(name, problem, p.chat, waiting_mid=int(p.mid) if p.mid else None,
                                          by=p.person.name)
        await p.toast(said)
        if p.mid:
            # the message itself says so, its buttons gone: a toast alone is easily missed ("nothing happened")
            # where it stands, under the line at the bottom, as every update of a message (layout.py). The answer the
            # buttons came with is its body whole: an answer of the AI's, never cut apart at a line of its own (review 21)
            await self.delivery.edit(p.chat, p.mid, layout.render(layout.parts(body=p.words, status=said)))

    async def _server_tools(self) -> list[dict]:
        """HA MCP's tool list, read again when the agent has none yet."""
        if not self.server_tools:
            await self.refresh_server_tools()
        return self.server_tools

    async def _alert_taken(self, iid: int, note: str) -> int:
        """Someone took incident `iid` on in the Kiosk: every copy says so, then the step joins its history — listed in
        every later "Status:" (its close included), never twice beside the status saying it now."""
        langs = getattr(note, "langs", None) or None    # kiosk_words.Words: each chat's copy in its language
        shown = await self.thread.restate(iid, note, note_in=langs)
        note_step(self.state, iid, TAKEN_STAGE, note, langs)
        return shown

    async def _tell_owner_siren(self, text: str) -> None:
        await self.outcome.carry_out({"send": [{"to": "owner", "text": text, "title": SIREN_TITLE}]})

    async def _tell_unreachable(self, chat: int, error: str) -> None:
        """⚠️ TOLD ON TELEGRAM, ONCE (architecture review 25): only the VESTA Agent page named a person Telegram refuses —
        Fabien never pressed Start and missed every message meant for him. Said to the owner's chats (never to the
        refused one) the first time; again only once it was reached in between."""
        names = [e.name for e in self.policy().entries if e.telegram_id == int(chat)]
        if not names:
            return
        who = " / ".join(dict.fromkeys(names))
        fix = (f"they open a private chat with @{self.bot_username or 'the bot'} and press Start (or send /start) once"
               if chat > 0 else "add the bot to the group again, or put the group's new id in People")
        await self.outcome.carry_out({"send": [{"to": "owner", "title": "Not reachable on Telegram", "text": f"{who} cannot be reached on Telegram: Telegram "
                                                f"refuses the agent's messages. Until {fix}, their messages go nowhere."}]},
                                     skip=[int(chat)])
        log.info("Told the owner that chat %s cannot be reached", chat)

    # ------------------------------------------------------------------ scheduled model jobs
    async def _tell_owner(self, problem: str | None, already_told: list[int]) -> None:
        """No credit, a refused key: every reply and report stops until the owner acts. Told in the owner
        chat at most every 12 hours per kind, and not again in a chat that was just told."""
        text = NEEDS_THE_OWNER.get(problem or "")
        if not text or not Routing(self.policy()).target("owner"):
            return
        now = datetime.now(timezone.utc)
        last = self.state.owner_told(problem)
        again = limit("notices.owner_repeat_hours", 12, unit="hours", group="text", lo=1, hi=168,
                      says="How often the owner is told again that the AI cannot answer (no credit, a refused key).",
                      reached="Not told again before this many hours.", told="")
        if last and now - datetime.fromisoformat(last) < timedelta(hours=again):
            return
        self.state.mark_owner_told(problem, now.isoformat())
        await self.outcome.carry_out({"send": [{"to": "owner", "title": "The AI cannot answer", "text": text}]},
                                     skip=already_told)

    async def housekeeping(self) -> None:
        if not self.server_tools and _now_local(self.s.timezone).minute % 10 == 0:
            await self.refresh_server_tools()
        # ⚠️ A FAULT CLOSED IN THE KIOSK REACHES TELEGRAM WITHIN 5 MINUTES (owner, 2026-10-10: "will a Close in the cockpit
        # also act on the Telegram notifications?"): the Kiosk was read at start, at 01:30 and after the night check
        # only — an alert closed in the Cockpit kept its buttons in every chat for hours
        if self.kiosk.enabled and time.monotonic() - self._kiosk_read >= KIOSK_EVERY_S:
            self._kiosk_read = time.monotonic()
            await self._safe(self.tickets.repair())
        # a request for approval nobody answered says so, in every chat, and loses its buttons (approvals.py)
        await self._safe(self.approvals.expire())
        # a copy Telegram did not take the last change of (a network blip): tried again (incident_thread.py)
        await self._safe(self.thread.catch_up())

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
        # ⚠️ A TEST SAYS IT IS ONE (owner, 2026-10-13): "Only the owner answers proposals" to the owner's own test — and
        # had it passed, the answer would have been recorded. A script that writes its own records reads VESTA_ASKER
        # "page" and checks without writing.
        ans = script_run.run(dataclasses.replace(self.s, asker=script_run.PAGE), self.state, skill, script, final,
                             by=script_run.PAGE)
        return {"ok": ans.ok, "exit": ans.code, "verdict": ans.verdict, "verdict_words": ans.verdict_words, "seconds": ans.seconds,
                "output": ans.stdout[:limit("page.try_output_chars", 60000, unit="characters", group="text", lo=1000, hi=1000000,
                                            says="How much of a script's output Skills › Try shows.",
                                            reached="The rest of the output is not shown on the page.")],
                "error": ans.error}

    def nightly_at(self) -> str | None:
        """When the job a skill marks `kiosk: nightly_check` runs ("02:00"), None without one: the Kiosk's Next check
        (kiosk_cadence) and how long a fault the night check closed is watched (Tickets._next_night)."""
        return next((j["when"] for sk in self.skills.all().values() for j in sk.schedule
                     if j.get("kiosk") == "nightly_check"), None)

    def kiosk_cadence(self) -> dict | None:
        """This agent's timing for the Kiosk's heartbeat (agent-contract.json `heartbeat.cadence`): how often its code
        jobs look (the scheduler's tick) and when the job a skill marks `kiosk: nightly_check` runs — read at each beat,
        so a changed schedule or a skill switched off shows at the next one; `lastLookAt`, when that tick last started
        (the card's Next check counts from it). None without a nightly job: the Kiosk then says no number rather
        than a wrong one."""
        nightly = self.nightly_at()
        if not nightly:
            return None
        look = getattr(getattr(self, "scheduler", None), "last_look", None)
        return {"checkMinutes": int(scheduler_every().total_seconds() // 60), "nightlyAt": nightly,
                **({"lastLookAt": look.astimezone(timezone.utc).isoformat(timespec="seconds")} if look else {})}

    async def _safe(self, coro):
        try:
            await coro
        except Exception:  # noqa: BLE001
            log.exception("task failed")

    # ------------------------------------------------------------------ main
    async def main(self, stop: asyncio.Event):
        await self.start()
        await self._safe(self.tidy())
        self.scheduler = Scheduler(self.s, self.skills, self.state, self.run_code_job, self.jobs.run,
                                   self.rebuild_pack, self.housekeeping, self.work)
        tasks = [asyncio.create_task(self.scheduler.run(stop))]
        if self.s.ha_url and self.s.ha_token:
            events = HaEvents(self.s.ha_url, self.s.ha_token, self.on_ha_event, self.beat, headers=self.cf_headers)
            tasks.append(asyncio.create_task(events.run(stop)))
        if self.kiosk.enabled:
            tasks.append(asyncio.create_task(self.kiosk.heartbeats(stop, cadence=self.kiosk_cadence,
                                                                   answered=self.kiosk_answered)))
            # the tablets' questions (tablet.py): collected from the Kiosk, which never calls the agent
            tasks.append(asyncio.create_task(self.tablet.listen(stop, self.on_tablet)))
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
