"""The VESTA Agent, one process: Home Assistant's events in, Telegram and the Kiosk out.

What comes in (ha_events.py, one listen-only Home Assistant websocket):
  vesta_critical_event                  the alert desk (the skills' `on_event`)
  telegram_text / _command / _callback  what Home Assistant receives on the villa
                                        bot: messages and button presses for the agent
What goes out: Telegram messages (telegram.py, send only), Kiosk heartbeat and
Facility tickets (kiosk.py), and — only after a person presses Approve — a service
call through the HA MCP sidecar (actions.py).

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

from . import runner
from .actions import Actions
from .config import STARTER_DIR
from .ha_events import HaEvents
from .kiosk import Kiosk, KioskError
from .policy import Person, Policy
from .scheduler import Scheduler
from .skills import Skills, run_command, script_env
from .state import State
from .telegram import Telegram, TelegramError
from .tools import Toolbox, scrub

log = logging.getLogger("vesta")

LANG = {"en": "English", "fr": "French", "id": "Indonesian", "de": "German", "es": "Spanish", "it": "Italian", "nl": "Dutch"}
LADDER = [("Done", "done"), ("Not found", "not_found"), ("Need help", "need_help"), ("Mute", "mute")]
#: Commands the agent answers. Any other command belongs to Home Assistant's automations.
OWN_COMMANDS = {"/ask", "/new", "/whoami"}


def _now_local(tz: str) -> datetime:
    return datetime.now(ZoneInfo(tz))


def _clean_summary(s: str) -> str:
    """No rule codes for a human."""
    return re.sub(r"^\s*\[[^\]]{2,80}\]\s*", "", s or "").strip()


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
        self.skills = skills or Skills(settings.skills_dir, os.path.join(STARTER_DIR, "skills"))
        self._policy: Policy | None = None
        self._policy_mtime = None
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
        self.server_tools: list[dict] = []
        self.bot_username: str | None = None
        self._locks: dict[int, asyncio.Lock] = {}
        self._names: dict[str, str] = {}
        self._names_mtime = None

    # ------------------------------------------------------------------ policy and names
    def policy(self) -> Policy:
        try:
            m = os.path.getmtime(self.s.policy_path)
        except OSError:
            m = None
        if self._policy is None or m != self._policy_mtime:
            self._policy = Policy.load(self.s.policy_path)
            self._policy_mtime = m
        return self._policy

    def name_of(self, entity_id: str) -> str:
        try:
            m = os.path.getmtime(self.s.pack_path)
        except OSError:
            m = None
        if m != self._names_mtime:
            self._names = {}
            try:
                with open(self.s.pack_path, encoding="utf-8") as f:
                    pack = json.load(f)
                for rows in (pack.get("families") or {}).values():
                    for r in rows:
                        if r.get("entity_id") and r.get("name"):
                            self._names[r["entity_id"]] = r["name"]
            except (OSError, ValueError):
                pass
            self._names_mtime = m
        return self._names.get(entity_id) or _pretty(entity_id)

    def related_entities(self, entity_ids: list[str]) -> set[str]:
        """What these ids stand for: the members of a group (its entity_id attribute) and the other entities
        of the same device (knowledge pack). An owner-only device behind a wrapper is found this way."""
        out: set[str] = set()
        try:
            with open(self.s.pack_path, encoding="utf-8") as f:
                pack = json.load(f)
            by_device: dict[str, set[str]] = {}
            dev_of: dict[str, str] = {}
            for rows in (pack.get("families") or {}).values():
                for r in rows:
                    if r.get("device_id"):
                        by_device.setdefault(r["device_id"], set()).add(r["entity_id"])
                        dev_of[r["entity_id"]] = r["device_id"]
            for e in entity_ids:
                if e in dev_of:
                    out |= by_device.get(dev_of[e], set())
        except (OSError, ValueError):
            pass
        try:
            for _eid, st in (self.reader.states(entity_ids) or {}).items():
                members = ((st or {}).get("attributes") or {}).get("entity_id")
                if isinstance(members, list):
                    out |= {str(m).lower() for m in members}
        except Exception:  # noqa: BLE001
            pass
        return out

    def toolbox(self) -> Toolbox:
        return Toolbox(settings=self.s, policy=self.policy(), reader=self.reader, actions=self.actions,
                       skills=self.skills, send=self.send, server_tools=self.server_tools, state=self.state,
                       ticket=self.create_ticket if self.kiosk.enabled else None)

    def lock(self, chat_id: int) -> asyncio.Lock:
        return self._locks.setdefault(int(chat_id), asyncio.Lock())

    # ------------------------------------------------------------------ sending
    async def send(self, chat_id: int, text: str, keyboard: dict | None = None, approval_id: str | None = None,
                   document: str | None = None, photo_b64=None) -> int | None:
        if self.tg is None:
            self.state.log("send_skipped", {"chat": chat_id, "reason": "Telegram is off (telegram_takeover false)"})
            return None
        try:
            mid = await self.tg.send(int(chat_id), text, keyboard=keyboard, document=document, photo_b64=photo_b64)
        except TelegramError as e:
            log.warning("send failed: %s", e)
            self.state.log("send_failed", {"chat": chat_id, "error": str(e)})
            return None
        self.state.remember_message(chat_id, mid)
        if approval_id and mid:
            self.state.set_approval_message(approval_id, mid)
        return mid

    async def create_ticket(self, title: str, entity_id: str | None = None, note: str | None = None) -> str:
        return await self.kiosk.add_ticket(title, entity_id=entity_id, note=note)

    # ------------------------------------------------------------------ start
    async def start(self):
        for p, blocking in self.s.problems():
            (log.error if blocking else log.warning)("Setting missing: %s", p)
        copied = self.skills.seed()
        if copied:
            log.info("Starter skills copied to the skills folder (first start): %s", ", ".join(copied))
        names = sorted(self.skills.all())
        log.info("Skills: %s", ", ".join(names) or "none")
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
            except KioskError as e:
                log.warning("VESTA Kiosk: %s", e)
        await self.refresh_server_tools()
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
            log.warning("Skill %s: %s failed (exit %s)", skill.name, command.split()[0], code)
            return {}
        try:
            res = json.loads(out or "{}")
        except ValueError:
            return {}
        return res if isinstance(res, dict) else {}

    async def run_code_job(self, skill, command: str, timeout: int = 900, values: dict | None = None) -> None:
        res = await asyncio.to_thread(self.code_command, skill, command, values, timeout)
        await self._safe(self.dispatch(res, skill))

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
        await asyncio.to_thread(self.build_pack)
        await self.refresh_server_tools()

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
        handled = False
        for sk in self.skills.all().values():
            cmd = sk.on_event.get("critical_event")
            if cmd:
                handled = True
                await self.run_code_job(sk, cmd, 300, {"event": path})
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
        if self.bot_username:
            text = re.sub(rf"@{re.escape(self.bot_username)}", "", text, flags=re.I).strip()
        if not text:
            return
        await self.converse(cid, person, text, chat_role=pol.chat_role(cid) or "private")

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
                f"Your skills: {skills or 'none'}. Read a skill with read_skill before doing its job.\n" + pol.summary() + "\n"
                f"Villa time zone: {self.s.timezone}. Today: {_now_local(self.s.timezone):%A %d %B %Y, %H:%M}.")

    async def converse(self, cid: int, person: Person | None, text: str, chat_role: str = "private",
                       resume: str | None = "auto", is_continue: bool = False):
        async with self.lock(cid):
            if resume == "auto":
                resume = self._resume_for(cid)
            lang = LANG.get(person.language, person.language) if person else "English"
            if is_continue:
                prompt = "Continue exactly where you stopped. Do not repeat what you already wrote."
            else:
                prompt = (f"Message from {person.name} (role {person.role}, writes in {lang}) in the {chat_role} chat:\n"
                          f"\"\"\"{text}\"\"\"\nAnswer in {lang}, short.")
            if not self.server_tools:
                await self.refresh_server_tools()
            tb = self.toolbox()
            include_web = self.s.web_search
            server = tb.server(person, cid, include_web)
            allowed = set(tb.model_tool_names(include_web))
            res = await runner.run(self.s, self.system_prompt(), prompt, server, allowed, self.state,
                                   who=f"{person.name if person else 'system'}@{cid}", resume=resume)
            if res.session_id:
                self.state.set_session(cid, res.session_id)
            answer = res.text
            if res.error and not answer:
                answer = "The VESTA Agent could not answer this time. Try again in a moment."
            keyboard = None
            if res.stopped_at_limit and res.session_id:
                cont = self.state.new_continuation(cid, res.session_id, person.telegram_id if person else None)
                answer = (answer + "\n\n" if answer else "") + \
                    f"Stopped: this answer reached the {self.s.reply_limit_usd:g} USD limit per reply."
                keyboard = {"inline_keyboard": [[{"text": "Continue", "callback_data": f"c:{cont}"}]]}
            if answer or keyboard:
                await self.send(cid, answer or "…", keyboard=keyboard)

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
            cont = self.state.use_continuation(data[2:], cid)
            if not cont:
                return await toast("Already continued.")
            await toast("Continuing.")
            return await self.converse(cid, person, "", chat_role=pol.chat_role(cid) or "private",
                                       resume=cont["session_id"], is_continue=True)
        if data.startswith("i:"):
            return await self._ladder_press(q, cid, data, presser, toast)
        await toast("Unknown button.")

    async def _ladder_press(self, q: dict, cid: int, data: str, presser, toast):
        pol = self.policy()
        person = pol.person(presser)
        if person is None:
            return await toast("You are not registered with the VESTA Agent.")
        try:
            _, iid, opt = data.split(":")
            int(iid)
        except ValueError:
            return await toast("Unknown button.")
        options = {b: a for a, b in LADDER}
        if opt not in options:
            return await toast("Unknown button.")
        skill_name = self.state.get(f"inc:{iid}:{cid}")
        skill = self.skills.get(skill_name) if skill_name else None
        if skill is None or not skill.on_reply:
            self.state.log("press_refused", {"incident": iid, "by": presser, "reason": "not sent to this chat, or its skill is gone"})
            return await toast("This button belongs to another chat.")
        if opt == "mute" and person.role != "owner":
            from vesta_shared.store import Store
            inc = Store(self.s.store_path).incident(int(iid)) or {}
            if inc.get("severity") in ("P1", "P2"):
                self.state.log("press_refused", {"incident": iid, "by": presser, "reason": "mute of a P1/P2 is owner only"})
                return await toast("Only the owner can mute a P1 or P2 alert.")
        label = options[opt]
        await toast(f"{label}: noted.")
        self.state.log("ladder", {"incident": iid, "by": person.name, "reply": label})
        await self.run_code_job(skill, skill.on_reply, 120, {"incident": iid, "text": label, "role": person.role})

    async def after_execution(self, ap: dict):
        """The siren switches itself off after a few minutes (alert-desk rules)."""
        pol = self.policy()
        act = ap["action"]
        if pol.siren_entity and act["domain"] == "switch" and act["service"] == "turn_on" and pol.siren_entity in act["entity_ids"]:
            minutes = int(pol.raw.get("siren_auto_off_min", 3))

            async def off():
                await asyncio.sleep(minutes * 60)
                ok = await asyncio.to_thread(self.actions.system, "switch", "turn_off", pol.siren_entity)
                owner = pol.chats.get("owner")
                if owner:
                    await self.send(owner, "Siren switched off." if ok else "The siren could not be switched off: check it now.")
            asyncio.create_task(off())

    # ------------------------------------------------------------------ what a script decided
    async def dispatch(self, res: dict, skill=None):
        """Carry out a script's standard output: `send` items, then `actions`.

        send:    {to: owner|fm, text, keyboard?: true (the Done / Not found / Need help / Mute ladder)}
        actions: ticket {summary, entity_id?, note?, task_id?} · ticket.resolve {task_id}
                 snapshot.get {entity_id, incident_id} · the siren gate (`siren_gate` key)
        Every write goes through the policy or the Kiosk's own rules; nothing here acts on a device."""
        if not res:
            return
        pol = self.policy()
        gate = res.get("siren_gate") or {}
        gate_prompt = gate.get("prompt") if gate.get("armed") else None
        sent_to: set[int] = set()
        for item in res.get("send") or []:
            if gate_prompt and item.get("text") == gate_prompt:
                continue
            chat = pol.chats.get(item.get("to") or "")
            if not chat:
                continue
            text = item.get("text") or ""
            kb = None
            if item.get("keyboard") and skill is not None:
                m = re.search(r"#(\d+)", text)
                iid = res.get("incident_id") or (int(m.group(1)) if m else None)
                if iid:
                    kb = {"inline_keyboard": [[{"text": a, "callback_data": f"i:{iid}:{b}"} for a, b in LADDER]]}
                    self.state.put(f"inc:{iid}:{chat}", skill.name)
            await self.send(chat, text, keyboard=kb)
            sent_to.add(chat)
        if gate_prompt and pol.siren_entity:
            answer, msg = self.actions.request("switch", "turn_on", pol.siren_entity, {}, None, pol.chats.get("owner"))
            owner = pol.chats.get("owner")
            if msg:
                await self.send(msg.chat_id, gate_prompt.split(" Reply ")[0] + "\n\n" + msg.text,
                                keyboard=msg.keyboard, approval_id=msg.approval_id)
            elif owner:
                await self.send(owner, gate_prompt.split(" Reply ")[0] + f"\n\nThe siren cannot be requested: {answer}")
        for a in res.get("actions") or []:
            kind = a.get("action")
            try:
                if kind == "ticket":
                    await self._ticket_action(a)
                elif kind == "ticket.resolve":
                    await self._ticket_resolve(a)
                elif kind == "snapshot.get":
                    blocks = await asyncio.to_thread(self.reader.tool_content, "ha_get_camera_image", {"entity_id": a.get("entity_id")})
                    img = next((b for b in blocks if b.get("type") == "image"), None)
                    if img:
                        for chat in sent_to:
                            await self.send(chat, f"Snapshot, incident #{a.get('incident_id')}", photo_b64=(img.get("data"), img.get("mimeType")))
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": getattr(skill, "name", None)})
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": type(e).__name__})
                log.warning("action %s failed (%s)", kind, type(e).__name__)

    async def _ticket_action(self, a: dict) -> None:
        if not self.kiosk.enabled:
            self.state.log("ticket_skipped", {"reason": "no Kiosk configured", "summary": a.get("summary", "")[:80]})
            return
        tid = await self.kiosk.add_ticket(_clean_summary(a.get("summary", ""))[:200], entity_id=a.get("entity_id") or None,
                                          note=a.get("note") or None)
        if a.get("task_id"):
            from vesta_shared.store import Store
            Store(self.s.store_path).set_task_uid(int(a["task_id"]), tid)
        self.state.log("executed", {"tool": "ticket", "ticket": tid})

    async def _ticket_resolve(self, a: dict) -> None:
        from vesta_shared.store import Store
        task = Store(self.s.store_path).task(int(a.get("task_id") or 0)) if a.get("task_id") else None
        uid = (task or {}).get("todo_uid") or a.get("ticket_id")
        if uid and self.kiosk.enabled:
            await self.kiosk.resolve_ticket(uid, note=a.get("note"))

    # ------------------------------------------------------------------ scheduled model jobs
    def _language_of(self, role: str) -> str:
        for p in self.policy().people.values():
            if p.role == role:
                return LANG.get(p.language, p.language)
        return "English"

    async def run_model_job(self, skill, prompt: str, name: str) -> None:
        try:
            prompt = prompt.format(fm_language=self._language_of("fm"), owner_language=self._language_of("owner"))
        except (KeyError, IndexError, ValueError):
            pass                        # a prompt with other braces is used as written
        if not self.server_tools:
            await self.refresh_server_tools()
        tb = self.toolbox()
        server = tb.server(None, None, False)
        allowed = set(tb.model_tool_names(False))
        res = await runner.run(self.s, self.system_prompt(), prompt, server, allowed, self.state, who=f"job:{name}")
        log.info("job %s done (cost %s USD%s)", name, res.cost_usd, ", stopped at the reply limit" if res.stopped_at_limit else "")

    async def housekeeping(self) -> None:
        if not self.server_tools and _now_local(self.s.timezone).minute % 10 == 0:
            await self.refresh_server_tools()

    async def _safe(self, coro):
        try:
            await coro
        except Exception:  # noqa: BLE001
            log.exception("task failed")

    # ------------------------------------------------------------------ main
    async def main(self, stop: asyncio.Event):
        await self.start()
        self.state.prune_own_messages()
        tasks = [asyncio.create_task(Scheduler(self.s, self.skills, self.state, self.run_code_job, self.run_model_job,
                                               self.rebuild_pack, self.housekeeping).run(stop))]
        if self.s.ha_url and self.s.ha_token:
            events = HaEvents(self.s.ha_url, self.s.ha_token, self.on_ha_event, self.beat, headers=self.cf_headers)
            tasks.append(asyncio.create_task(events.run(stop)))
        if self.kiosk.enabled:
            tasks.append(asyncio.create_task(self.kiosk.heartbeats(stop)))
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
