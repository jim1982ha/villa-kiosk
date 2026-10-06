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
import re
import signal
import subprocess
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from . import requests_box, runner, tool_access
from .actions import Actions
from .api_errors import FOR_PERSON, NEEDS_THE_OWNER, for_job
from .config import STARTER_DIR
from .ha_events import HaEvents
from .housekeeping import tidy
from .job_notices import JobNotices
from .kiosk import Kiosk, KioskError
from .outcome import Outcome
from .policy import Person, Policy, problems as policy_problems
from .routing import CONVERSATION, JOB, Origin, Routing
from .scheduler import Scheduler
from .skills import Skills, run_command, script_env
from .speech import speech_to_text
from .state import State
from .telegram import Telegram, TelegramError
from .tools import Toolbox, scrub

log = logging.getLogger("vesta")

from .policy import LANGUAGES as LANG  # noqa: E402 — one list, also the VESTA Agent page's menu
#: Commands the agent answers. Any other command belongs to Home Assistant's automations.
OWN_COMMANDS = {"/ask", "/new", "/whoami"}
PHOTOS_PER_REPLY = 4              # the camera pictures a reply carries, the last ones looked at


def _now_local(tz: str) -> datetime:
    return datetime.now(ZoneInfo(tz))


_MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def plain_text(s: str) -> str:
    """What Telegram shows as written: the bot sends plain text, so Markdown the model
    writes anyway (**bold**, # headings, `code`, [links](url)) would appear raw."""
    if not s:
        return s
    s = _MD_LINK.sub(r"\1 (\2)", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s, flags=re.S)
    s = re.sub(r"(?<!\w)__(.+?)__(?!\w)", r"\1", s, flags=re.S)
    s = re.sub(r"`{1,3}([^`]*)`{1,3}", r"\1", s)
    s = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", s)
    return s


def _pretty(entity_id: str) -> str:
    obj = entity_id.split(".", 1)[-1]
    return obj.replace("_", " ").strip().capitalize()


def _command_name(cmd: str, bot_username: str | None) -> tuple[str, bool]:
    """('/ask', addressed) from '/ask' or '/ask@TheBot'. A command naming another bot is not ours."""
    name, _, target = (cmd or "").partition("@")
    if target:
        return name.lower(), bool(bot_username) and target.lower() == bot_username.lower()
    return name.lower(), True


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
        self.actions = Actions(self.policy, self.state, self.writer_factory, names=self.name_of, related=self.related_entities)
        self.outcome = Outcome(policy=self.policy, state=self.state, store_path=settings.store_path, out_dir=settings.out_dir,
                               timezone=settings.timezone, send=self.send, kiosk=self.kiosk, actions=self.actions,
                               reader=self.reader, skills=self.skills, run_job=self.run_code_job,
                               edit=(self.tg.edit if self.tg else None))
        self.server_tools: list[dict] = []
        self.bot_username: str | None = None
        self._locks: dict[int, asyncio.Lock] = {}
        # The "being prepared" message of a job asked for in a chat (job_notices.py decides, this file sends).
        self._job_notices = JobNotices()
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
        row = next((r for r in pack.rows() if r["entity_id"] == entity_id), None) if pack else None
        return (row or {}).get("name") or _pretty(entity_id)

    def related_entities(self, entity_ids: list[str]) -> set[str]:
        """What these ids stand for: the members of a group (its entity_id attribute) and the other entities
        of the same device (knowledge pack). An owner-only device behind a wrapper is found this way."""
        out: set[str] = set()
        rows = self.pack().rows() if self.pack() else []
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

    def toolbox(self, allowed: set[str] | None = None) -> Toolbox:
        """`allowed`: what the AI may use this time (tool_access); None: everything switched on."""
        return Toolbox(settings=self.s, policy=self.policy(), reader=self.reader, actions=self.actions,
                       skills=self.skills, send=self.send, server_tools=self.server_tools, state=self.state,
                       ticket=self.outcome.create_ticket if self.kiosk.enabled else None,
                       carry_out=self.outcome.carry_out, start_job=self.start_job, allowed=allowed)

    def lock(self, chat_id: int) -> asyncio.Lock:
        return self._locks.setdefault(int(chat_id), asyncio.Lock())

    # ------------------------------------------------------------------ sending
    async def send(self, chat_id: int, text: str, keyboard: dict | None = None, approval_id: str | None = None,
                   document: str | None = None, photo_b64=None, from_job: bool = False) -> int | None:
        """`from_job`: sent by a job asked for in a chat — its result replaces the chat's "being prepared"
        message, whatever form it takes (a page, the daily digest's text: owner, 2026-10-04, "all report
        messages")."""
        if self.tg is None:
            self.state.log("send_skipped", {"chat": chat_id, "reason": "Telegram is off (telegram_takeover false)"})
            log.info("Telegram off: a message for chat %s was not sent", chat_id)
            return None
        text = plain_text(text)
        try:
            mid = await self.tg.send(int(chat_id), text, keyboard=keyboard, document=document, photo_b64=photo_b64)
            if from_job and mid:
                await self._job_notice_step(int(chat_id), self._job_notices.result(int(chat_id)))
        except TelegramError as e:
            log.warning("send failed: %s", e)
            self.state.log("send_failed", {"chat": chat_id, "error": str(e)})
            return None
        self.state.remember_message(chat_id, mid)
        log.info("Sent to chat %s (%s)%s%s%s", chat_id, Routing(self.policy()).label(chat_id),
                 " with buttons" if keyboard else "", " and a file" if document else "",
                 " and a photo" if photo_b64 else "")
        if approval_id and mid:
            self.state.set_approval_message(approval_id, mid)
        return mid

    async def _job_notice_step(self, chat_id: int, step) -> None:
        """Carry out what job_notices.py decided about a "being prepared" message."""
        if step is None or self.tg is None:
            return
        what, mid, job = step
        if what == "delete":
            await self.tg.delete(chat_id, mid)
        else:
            await self.tg.edit(chat_id, mid, f"The {job} job ended without a result this time. Ask again in a moment.")

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
            log.info("Telegram: off (telegram_takeover is false): nothing is sent")
        if self.kiosk.enabled:
            try:
                await self.kiosk.check()
                log.info("VESTA Kiosk: agreement %s", self.kiosk.info.get("contract"))
                await self._safe(self.outcome.repair_tickets())
            except KioskError as e:
                log.warning("VESTA Kiosk: %s", e)
        await self.refresh_server_tools()
        for sk in self.skills.all().values():
            stop = tool_access.blockers(self.policy(), self.server_tools or None, sk)
            if stop:
                log.warning("Skill %s is not working: %s", sk.name, " ".join(b["why"] for b in stop))
        if not os.path.exists(self.s.pack_path):
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
            # for the page (which holds no token): Rules → What the AI can use draws its switches from it
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
        try:
            code, out, err = run_command(self.s, skill, command, values, timeout)
        except (KeyError, ValueError, IndexError) as e:
            log.error("Skill %s: the command %r cannot be filled (%s)", skill.name, command, type(e).__name__)
            return {}
        if code not in (0, 2):
            self.state.log("code_script_failed", {"skill": skill.name, "command": command.split()[0],
                                                  "stderr": scrub(err[-800:], self.s.secrets())})
            last = scrub(err.strip().splitlines()[-1] if err.strip() else "", self.s.secrets())
            log.warning("Skill %s: %s failed (exit %s)%s", skill.name, command.split()[0], code,
                        f": {last[:300]}" if last else "")
            return {}
        try:
            res = json.loads(out or "{}")
        except ValueError:
            return {}
        return res if isinstance(res, dict) else {}

    async def run_code_job(self, skill, command: str, timeout: int = 900, values: dict | None = None,
                           origin: Origin | None = None) -> dict:
        res = await asyncio.to_thread(self.code_command, skill, command, values, timeout)
        await self._safe(self.outcome.carry_out(res, skill.name, origin))
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
        await self._safe(self.outcome.repair_tickets())
        await self._safe(self.tidy())

    async def tidy(self) -> None:
        keep = self.policy().keep
        gone = await asyncio.to_thread(tidy, self.s, self.state, keep)
        log.info("Housekeeping (settings.keep): removed %s", ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in gone.items()))

    # ------------------------------------------------------------------ Home Assistant's events
    async def on_ha_event(self, event_type: str, data: dict) -> None:
        if event_type == "vesta_critical_event":
            return await self.on_critical(data)
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
        """A Telegram message, as Home Assistant fired it (fields checked live on 2026-09-30)."""
        try:
            cid = int(m.get("chat_id"))
        except (TypeError, ValueError):
            return
        is_group = cid < 0              # Telegram: groups negative, private chats positive; no type field
        voice = event_type == "telegram_attachment"
        if voice and not str(m.get("file_mime_type") or "").startswith("audio/"):
            return                      # a photo or a file: nothing the agent does with it
        pol = self.policy()
        from_id = m.get("user_id")
        if event_type == "telegram_command":
            cmd, addressed = _command_name(m.get("command") or "", self.bot_username)
            if not addressed or cmd not in OWN_COMMANDS:
                return                  # a command for Home Assistant's automations or another bot
            args = " ".join(str(a) for a in (m.get("args") or []))
        else:
            cmd, args = "", ""
        text = (args if cmd else (m.get("text") or "")).strip()
        if is_group and pol.chats and pol.chat_role(cid) is None:
            self.state.log("ignored", {"reason": "group not listed in policy.yaml", "chat": cid})
            return                      # never leaveChat: the villa bot is Home Assistant's too
        if cmd == "/whoami":
            await self.send(cid, f"Your Telegram id: {from_id}. This chat id: {cid}.")
            log.info("whoami: person %s (%s) in chat %s", from_id, m.get("from_first"), cid)
            return
        if is_group and not pol.chats:
            return                      # chat ids not filled yet: in a group, only /whoami is answered
        person = pol.person(from_id)
        if is_group:
            mention = bool(self.bot_username) and f"@{self.bot_username}".lower() in text.lower()
            replied = self.state.is_own_message(cid, m.get("reply_to_message_id"))
            if not (cmd or mention or replied):
                return                  # people talking to each other: not for the agent, dropped by code
        if person is None:
            log.info("Unregistered sender: id %s (%s) in chat %s", from_id, m.get("from_first"), cid)
            self.state.log("unknown_sender", {"telegram_id": from_id, "chat": cid})
            if not is_group:
                await self.send(cid, f"You are not registered with the VESTA Agent. Your Telegram id is {from_id}.")
            return
        if not is_group and pol.chats and int(cid) not in pol.people:
            return
        if cmd == "/new":
            self.state.set_session(cid, None)
            await self.send(cid, "New conversation.")
            return
        if voice:
            # in a group, only a voice message that replies to the agent reaches here (no mention possible)
            text = await self.transcribe(cid, person, str(m.get("file_id") or ""))
        if self.bot_username:
            text = re.sub(rf"@{re.escape(self.bot_username)}", "", text or "", flags=re.I).strip()
        if not text:
            return
        await self.converse(cid, person, text, chat_role=pol.chat_role(cid) or "private", voice=voice)

    async def transcribe(self, cid: int, person: Person, file_id: str) -> str | None:
        """A voice message's words, or None (the person is told why).

        ⚠️ THE SKILL DECIDES, THE ENGINE ONLY CARRIES (owner, 2026-10-05: everything tuned
        per villa lives in the skills, so a villa's skills copied to another work the same).
        The skill whose `on_event.voice_message` hook runs decodes the audio and chooses the
        speech-to-text and the language; the engine fetches the file and sends the skill's
        WAV to Home Assistant, because it holds the token and a skill script never does."""
        hook = next(((sk, sk.on_event["voice_message"]) for sk in self.skills.all().values()
                     if "voice_message" in sk.on_event), None)
        if not self.tg:
            log.info("Voice message in chat %s not read: Telegram takeover is off", cid)
            return None
        if not hook:
            await self.send(cid, "Voice messages are not set up here: no skill handles them.")
            return None
        folder = os.path.join(self.s.out_dir, "voice")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%f}.ogg")
        wav = None
        try:
            try:
                audio = await self.tg.download(file_id)
            except TelegramError as e:
                log.warning("Voice message in chat %s: %s", cid, e)
                await self.send(cid, "This voice message could not be fetched from Telegram.")
                return None
            with open(path, "wb") as f:
                f.write(audio)
            sk, cmd = hook
            res = await asyncio.to_thread(self.code_command, sk, cmd, {"audio": path, "language": person.language}, 120)
            st = res.get("stt") if isinstance(res.get("stt"), dict) else None
            if not st:
                await self.send(cid, str(res.get("error") or "This voice message could not be prepared."))
                return None
            wav = st.get("wav")
            text, why = await speech_to_text(self.s.ha_url, self.s.ha_token, st, self.cf_headers)
            log.info("Voice message in chat %s: %s s, %s (%s)%s", cid, st.get("seconds"), st.get("entity"),
                     st.get("language"), f": {why}" if why else "")
            self.state.log("voice", {"chat": cid, "seconds": st.get("seconds"), "stt": st.get("entity"),
                                     "language": st.get("language"), "ok": bool(text), "why": why})
            if not text:
                await self.send(cid, "I could not make out this voice message. Try again, or write it.")
            return text
        finally:
            for f in (path, wav):        # a voice is the person's: kept no longer than it takes to read it
                if f and os.path.dirname(os.path.abspath(f)) == os.path.abspath(folder):
                    try:
                        os.remove(f)
                    except OSError:
                        pass

    def _resume_for(self, chat_id: int) -> str | None:
        sid, last = self.state.session(chat_id)
        if not sid or not last:
            return None
        rule = self.s.conversation_reset
        last_dt = datetime.fromisoformat(last)
        now = datetime.now(timezone.utc)
        if rule == "never":
            return sid
        if rule == "after_8h_silence":
            return sid if now - last_dt < timedelta(hours=8) else None
        local = now.astimezone(ZoneInfo(self.s.timezone))
        cut = datetime.combine(local.date(), time(4, 0), tzinfo=local.tzinfo)
        if local < cut:
            cut -= timedelta(days=1)
        return sid if last_dt >= cut.astimezone(timezone.utc) else None

    def system_prompt(self) -> str:
        pol = self.policy()
        skills = "; ".join(f"{n} ({sk.description})" if sk.description else n for n, sk in self.skills.all().items())
        return (self.s.instructions() + "\n\n" +
                "Telegram shows your text exactly as written: plain text only, no Markdown (no ** or #, no tables); "
                "a list is lines starting with '- '.\n" +
                "When asked to produce, check or run something, do it again now with your tools: never answer from an "
                "earlier attempt in this conversation. Skills, data and fixes change between messages.\n" +
                f"Your skills: {skills or 'none'}. Read a skill with read_skill before doing its job.\n" + pol.summary() + "\n"
                f"Villa time zone: {self.s.timezone}. Today: {_now_local(self.s.timezone):%A %d %B %Y, %H:%M}.")

    async def converse(self, cid: int, person: Person | None, text: str, chat_role: str = "private",
                       resume: str | None = "auto", is_continue: bool = False, voice: bool = False):
        async with self.lock(cid):
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
            if not self.server_tools:
                await self.refresh_server_tools()
            pol = self.policy()
            # what this person may make the AI use here (Rules → What the AI can use)
            tb = self.toolbox(tool_access.allowed_for_person(pol, self.server_tools, person.role if person else None, cid))
            server = tb.server(person, Origin(cid, CONVERSATION))
            allowed = set(tb.model_tool_names())
            res = await runner.run(self.s, self.system_prompt(), prompt, server, allowed, self.state,
                                   who=f"{person.name if person else 'system'}@{cid}", resume=resume,
                                   asked=None if is_continue else text)
            if res.session_id:
                self.state.set_session(cid, res.session_id)
            log.info("Answered %s in chat %s (%s)%s", person.name if person else "system", cid,
                     f"{res.cost_usd:.3f} USD" if isinstance(res.cost_usd, (int, float)) else "cost unknown",
                     f", error {res.error}" if res.error else "")
            answer = res.text
            if res.problem or res.error:
                # ⚠️ NEVER THE RAW ERROR (owner, 2026-10-06): the reason in plain words (api_errors), and the
                # owner told when no retry can help (no credit, a refused key)
                said = FOR_PERSON.get(res.problem or "unknown", FOR_PERSON["unknown"])
                answer = f"{answer}\n\n{said}" if answer else said
                await self._safe(self._tell_owner(res.problem, cid))
            keyboard = None
            if res.stopped_at_limit and res.session_id:
                cont = self.state.new_continuation(cid, res.session_id, person.telegram_id if person else None)
                answer = (answer + "\n\n" if answer else "") + \
                    f"Stopped: this answer reached the {self.s.reply_limit_usd:g} USD limit per reply."
                keyboard = {"inline_keyboard": [[{"text": "Continue", "callback_data": f"c:{cont}"}]]}
            photos = tb.photos[-PHOTOS_PER_REPLY:]
            if photos and answer and not keyboard:
                # the pictures it looked at, the answer as the last one's caption
                for photo in photos[:-1]:
                    await self.send(cid, "", photo_b64=photo)
                mid = await self.send(cid, answer, photo_b64=photos[-1])
                if not mid:
                    mid = await self.send(cid, answer + "\n\n(The camera picture could not be sent.)")
                await self._job_notice_step(cid, self._job_notices.replied(cid, mid))
            elif answer or keyboard:
                for photo in photos:
                    await self.send(cid, "", photo_b64=photo)
                mid = await self.send(cid, answer or "…", keyboard=keyboard)
                await self._job_notice_step(cid, self._job_notices.replied(cid, mid))

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
            if self.tg and qid:
                await self.tg.answer_callback(str(qid), text)

        if data.startswith("a:"):
            try:
                _, aid, yn = data.split(":")
            except ValueError:
                return await toast("Unknown button.")
            ap = self.state.approval(aid)
            if ap and ap["chat_id"] != cid:
                self.state.log("press_refused", {"approval": aid, "by": presser, "reason": "button pressed from another chat"})
                return await toast("This button belongs to another chat.")
            out = await asyncio.to_thread(self.actions.decide, aid, presser, yn == "y")
            await toast(out["toast"])
            if out.get("edit") and mid and self.tg:
                await self.tg.edit(cid, mid, out["edit"])
            if out.get("executed") and ap:
                await self.after_execution(ap)
            return
        if data.startswith("c:"):
            person = pol.person(presser)
            if person is None:
                return await toast("You are not registered with the VESTA Agent.")
            cont = self.state.use_continuation(data[2:], cid, presser)
            if not cont:
                return await toast("Already continued.")
            if cont.get("not_yours"):
                return await toast("Only the person who asked can continue this answer.")
            await toast("Continuing.")
            return await self.converse(cid, person, "", chat_role=pol.chat_role(cid) or "private",
                                       resume=cont["session_id"], is_continue=True)
        if data.startswith("i:"):
            return await self.outcome.press(q, cid, data, pol.person(presser), toast)
        await toast("Unknown button.")

    async def after_execution(self, ap: dict):
        """The siren switches itself off after a few minutes (alert-desk rules)."""
        pol = self.policy()
        act = ap["action"]
        siren_domain = pol.siren_entity.split(".")[0] if pol.siren_entity else None
        if pol.siren_entity and act["domain"] == siren_domain and act["service"] == "turn_on" and pol.siren_entity in act["entity_ids"]:
            minutes = pol.siren_auto_off_min

            async def off():
                await asyncio.sleep(minutes * 60)
                ok = await asyncio.to_thread(self.actions.system, siren_domain, "turn_off", pol.siren_entity)
                owner = Routing(pol).target("owner")
                if owner:
                    await self.send(owner, "Siren switched off." if ok else "The siren could not be switched off: check it now.")
            asyncio.create_task(off())

    # ------------------------------------------------------------------ scheduled model jobs
    def _language_of(self, role: str) -> str:
        for p in self.policy().people.values():
            if p.role == role:
                return LANG.get(p.language, p.language)
        return "English"

    async def run_model_job(self, skill, job: dict, origin: Origin | None = None) -> None:
        """An AI job of a skill: its model and spending limit are policy.yaml's settings.jobs[name].

        ⚠️ NOT SET, NOT RUN (owner, 2026-10-01): a job policy.yaml does not name has no agreed cost, so it
        is skipped and the log says so (the VESTA Agent page offers to add it). When the limit stops it,
        the skill's `on_limit` code step still finishes the work (a report is sent with what is done)."""
        name = job["name"]
        cfg = self.policy().jobs.get(name)
        if cfg is None:
            log.warning("AI job %s (skill %s) is not set in policy.yaml: it does not run. "
                        "VESTA Agent page → Rules → AI jobs → Add them.", name, skill.name)
            self.state.log("job_not_set", {"job": name, "skill": skill.name})
            if origin:
                await self.send(origin.chat, f"The {name} job is not set up yet (VESTA Agent page → Rules → AI jobs), "
                                             "so it cannot run.")
            return
        prompt = job["prompt"]
        try:
            prompt = prompt.format(fm_language=self._language_of("fm"), owner_language=self._language_of("owner"))
        except (KeyError, IndexError, ValueError):
            pass                        # a prompt with other braces is used as written
        if origin:
            # where it all goes is routing's (Origin JOB holds every message to that chat); the AI is only told
            # it was asked for, so it does not write "as scheduled"
            prompt += "\n\nThis was asked for in a chat, not on schedule."
        if not self.server_tools:
            await self.refresh_server_tools()
        pol = self.policy()
        stop = tool_access.blockers(pol, self.server_tools or None, skill)
        if stop:
            # ⚠️ NOT WORKING, AND SAID (0.6.42): a report whose skill needs a tool switched off does not run
            why = " ".join(b["why"] for b in stop)
            log.warning("AI job %s (skill %s) did not run: %s", name, skill.name, why)
            self.state.log("job_blocked", {"job": name, "skill": skill.name, "tools": [b["tool"] for b in stop]})
            to = Routing(pol).target("here" if origin else (job.get("to") or "owner"), origin)
            if to:
                await self.send(to, f"The {name} report did not run. {why} (VESTA Agent page)")
            return
        started = datetime.now(timezone.utc).isoformat()
        # a report gets only the tools its skill lists (skill.yaml `tools`), among those switched on
        tb = self.toolbox(tool_access.allowed_for_job(pol, self.server_tools, skill))
        server = tb.server(None, origin)
        allowed = set(tb.model_tool_names())
        log.info("AI job %s started (%s, limit %g USD)%s", name, cfg["profile"], cfg["limit_usd"],
                 " on request" if origin else "")
        res = await runner.run(self.s, self.system_prompt(), prompt, server, allowed, self.state, who=f"job:{name}",
                               limit_usd=cfg["limit_usd"], profile=cfg["profile"])
        if res.problem or (res.error and not res.text):
            # before 0.6.41 a failed job logged "done" and nobody was told: the report simply never came
            problem = res.problem or "unknown"
            log.warning("AI job %s did not run: %s", name, problem)
            to = Routing(self.policy()).target("here" if origin else (job.get("to") or "owner"), origin)
            if to:
                await self.send(to, for_job(name, problem))
            await self._safe(self._tell_owner(problem, to))
            return
        log.info("AI job %s done (%s USD%s)", name, res.cost_usd,
                 ", stopped at its limit" if res.stopped_at_limit else "")
        if res.stopped_at_limit and job.get("on_limit"):
            to = "here" if origin else (job.get("to") or "owner")
            await self.run_code_job(skill, job["on_limit"], 300,
                                    {"to": to, "started": started, "limit": f"{cfg['limit_usd']:g}"}, origin)

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
            await self.send(owner, text)

    async def start_job(self, name: str, chat: int) -> str:
        """A job a skill marks on_request, started from a chat: it runs as itself (its model, its limit)."""
        from .skills import ai_jobs
        found = [(sk, j) for sk, j in ai_jobs(self.skills.all()) if j["name"] == name and j.get("on_request")]
        if not found:
            return f"There is no job {name} that can be started from a chat."
        if name not in self.policy().jobs:
            return f"The {name} job is not set up yet (VESTA Agent page → Rules → AI jobs): it cannot run."
        sk, job = found[0]
        self._job_notices.started(int(chat), name)
        asyncio.create_task(self._safe(self._requested_job(sk, job, int(chat))))
        return f"Started {name}: the result will be sent here when it is ready (a few minutes)."

    async def _requested_job(self, skill, job: dict, chat: int) -> None:
        """A job asked for in a chat. If it ends without sending its page, its "being prepared" message
        says so instead of promising a report that will not come."""
        try:
            await self.run_model_job(skill, job, Origin(chat, JOB))
        finally:
            await self._job_notice_step(chat, self._job_notices.ended(chat, job["name"]))

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
            return await asyncio.to_thread(self.try_command, str(req.get("skill") or ""), str(req.get("script") or ""),
                                           [str(a) for a in req.get("args") or []])
        return {"ok": False, "error": "Unknown request."}

    def try_command(self, skill_name: str, script: str, args: list[str]) -> dict:
        """Skills → Try a command: one command, checked exactly as when the AI asks for it, run on the live villa —
        and NOT carried out: its messages and tickets are shown in the answer, never sent or recorded."""
        from .skills import ToolError, run_script, validate_script_args
        skill = self.skills.all(include_off=True).get(skill_name)
        try:
            final = validate_script_args(skill, skill_name, script, args, self.s.out_dir)
        except ToolError as e:
            return {"ok": False, "error": str(e)}
        started = datetime.now(timezone.utc)
        code, out, err = run_script(self.s, skill, script, final)
        took = (datetime.now(timezone.utc) - started).total_seconds()
        self.state.log("script_tried", {"skill": skill_name, "script": script, "args": final, "exit": code})
        log.info("UI: tried %s %s %s (exit %s, %.1f s)", skill_name, script, " ".join(args), code, took)
        last = err.strip().splitlines()[-1] if err.strip() else ""
        return {"ok": code in (0, 2), "exit": code, "seconds": round(took, 1),
                "output": scrub(out, self.s.secrets())[:60_000],
                "error": scrub(last, self.s.secrets()) if code not in (0, 2) else None}

    async def _safe(self, coro):
        try:
            await coro
        except Exception:  # noqa: BLE001
            log.exception("task failed")

    # ------------------------------------------------------------------ main
    async def main(self, stop: asyncio.Event):
        await self.start()
        await self._safe(self.tidy())
        tasks = [asyncio.create_task(Scheduler(self.s, self.skills, self.state, self.run_code_job, self.run_model_job,
                                               self.rebuild_pack, self.housekeeping).run(stop))]
        if self.s.ha_url and self.s.ha_token:
            events = HaEvents(self.s.ha_url, self.s.ha_token, self.on_ha_event, self.beat, headers=self.cf_headers)
            tasks.append(asyncio.create_task(events.run(stop)))
        if self.kiosk.enabled:
            tasks.append(asyncio.create_task(self.kiosk.heartbeats(stop)))
        tasks.append(asyncio.create_task(requests_box.serve(self.s.data_dir, self.on_request, stop)))
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
