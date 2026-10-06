"""What a skill script decided, carried out: one module, whoever ran the script.

A skill script prints its decision in the standard form; this module does it:

  send:       [{to: here | owner | fm, text, keyboard?: true, attachment?: <a file of the out folder>}]
              keyboard = the alert buttons
  actions:    ticket {summary, entity_id?, note?, task_id?} · ticket.resolve {task_id | ticket_id, note?}
              snapshot.get {entity_id, incident_id}
  siren_gate: {armed, prompt}  → an Approve / Refuse request to the owner for the policy's siren
  incident_id                  → which incident the alert buttons belong to
  settle:     [{incident_id, note}]  → every message carrying that incident's buttons, in every chat,
              loses them and shows the note ("{time}": the villa's time now)

⚠️ ONE PATH FOR EVERY CALLER (owner, 2026-10-01). Before, only the scheduler and the
Home Assistant hooks carried a result out; a script the model ran in a chat had its
tickets and messages dropped, and a task it stored never became a Kiosk ticket (the
night run then saw it as already open). Now the scheduler, the hooks, the alert
buttons and the model's run_skill_script all call carry_out().

The alert buttons (Done / Not found / Need help / Mute) live here too: they are put
on a message by carry_out and pressed back into the skill's on_reply by press().
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

from vesta_shared.problems import CLEARED, Problems

from .routing import JOB, Origin, Routing

log = logging.getLogger("vesta.outcome")

LADDER = [("Done", "done"), ("Not found", "not_found"), ("Need help", "need_help"), ("Mute", "mute")]


def clean_summary(s: str) -> str:
    """No rule codes for a human."""
    return re.sub(r"^\s*\[[^\]]{2,80}\]\s*", "", s or "").strip()


def ticket_title(s: str) -> str:
    """A Facility record's title: no rule code, and no leading emoji or symbol (the 🚨 of an alert)."""
    s = (s or "").strip().splitlines()[0] if (s or "").strip() else ""
    s = re.sub(r"^[^\w(\"'\[]+", "", s)          # 🚨 before the rule code, or alone
    return re.sub(r"^[^\w(\"']+", "", clean_summary(s)).strip()


#: What a script result can ask the engine to carry out — the keys carry_out reads. ⚠️ ONE LIST
#: (architecture review, 0.12.38): the model's run_skill_script tool kept its own copy, so a key added here
#: would be carried out on schedule and silently skipped when the model ran the same script.
CARRIED_KEYS = ("send", "actions", "siren_gate", "settle")


def has_work(res) -> bool:
    """Whether a script's result asks for anything carry_out does."""
    return isinstance(res, dict) and any(res.get(k) for k in CARRIED_KEYS)



async def camera_photo(reader, entity_id) -> tuple[str, str] | None:
    """What a camera shows now, as (base64, mime) for Telegram's sendPhoto; None when it gave no image.
    The alert desk's snapshot (a chat reply carries the pictures the AI looked at: tools.Toolbox.photos)."""
    if not str(entity_id or "").startswith("camera."):
        return None
    blocks = await asyncio.to_thread(reader.tool_content, "ha_get_camera_image", {"entity_id": entity_id})
    img = next((b for b in blocks if b.get("type") == "image" and b.get("data")), None)
    return (img["data"], img.get("mimeType") or "image/jpeg") if img else None

class Outcome:
    def __init__(self, *, policy: Callable, state, store_path: str, timezone: str, send: Callable[..., Awaitable],
                 out_dir: str = "",
                 kiosk, actions, reader, skills, run_job: Callable[..., Awaitable] | None = None,
                 edit: Callable[..., Awaitable] | None = None):
        self.policy = policy
        self.state = state
        self.store_path = store_path
        self.out_dir = out_dir
        self.tz = timezone
        self.send = send
        self.kiosk = kiosk
        self.actions = actions
        self.reader = reader
        self.skills = skills
        self.run_job = run_job          # (skill, command, timeout, values, origin) -> result: the on_reply hook
        self.edit = edit

    def _store(self):
        from vesta_shared.store import Store
        return Store(self.store_path)

    # ------------------------------------------------------------------ carry out
    async def carry_out(self, res: dict, skill_name: str | None = None, origin: Origin | None = None) -> dict:
        """Do what the script decided. Returns what was done, for the caller's answer and the tests."""
        done = {"sent": 0, "tickets": 0, "resolved": 0, "unrouted": 0}
        if not isinstance(res, dict) or not res:
            return done
        route = Routing(self.policy())
        gate = res.get("siren_gate") or {}
        gate_prompt = gate.get("prompt") if gate.get("armed") else None
        sent: set[tuple[int, str]] = set()
        chats: set[int] = set()
        for item in res.get("send") or []:
            text = (item or {}).get("text") or ""
            if gate_prompt and text == gate_prompt:
                continue                                     # sent below, as the owner's approval request
            chat = route.target(item.get("to"), origin)
            if not chat:
                done["unrouted"] += 1
                self.state.log("send_unrouted", {"to": item.get("to"), "skill": skill_name})
                log.info("A message for %r had nowhere to go (no chat set for it)", item.get("to"))
                continue
            if (chat, text) in sent:
                continue                                     # rule 4: owner and fm share this chat
            sent.add((chat, text))
            kb = None
            if item.get("keyboard") and skill_name:
                m = re.search(r"#(\d+)", text)
                iid = res.get("incident_id") or (int(m.group(1)) if m else None)
                if iid:
                    kb = {"inline_keyboard": [[{"text": a, "callback_data": f"i:{iid}:{b}"} for a, b in LADDER]]}
                    self.state.set_alert_skill(iid, chat, skill_name)
            doc = None
            att = item.get("attachment")
            if att:
                from .skills import FILE_NAME
                path = os.path.join(self.out_dir, str(att))
                if FILE_NAME.match(str(att)) and self.out_dir and os.path.isfile(path):
                    doc = path
                else:
                    log.warning("Skill %s attached %r, which is not a file of the out folder: sent without it", skill_name, att)
            mid = await self.send(chat, text, keyboard=kb, document=doc, from_job=bool(origin and origin.kind == JOB))
            if kb and mid:
                # every message with this incident's buttons, in every chat: all of them settle together
                self.state.remember_alert_message(iid, chat, mid, text)
            chats.add(chat)
            done["sent"] += 1
        for s in res.get("settle") or []:
            if isinstance(s, dict) and str(s.get("incident_id") or "").isdigit():
                await self.settle(int(s["incident_id"]), str(s.get("note") or ""))
        pol = self.policy()
        if gate_prompt and pol.siren_entity:
            # its own domain's turn_on (a switch or a siren entity: policy.SIREN_DOMAINS)
            answer, msg = await asyncio.to_thread(self.actions.request, pol.siren_entity.split(".")[0], "turn_on",
                                                  pol.siren_entity, {}, None, None)
            head = gate_prompt
            if msg:
                await self.send(msg.chat_id, head + "\n\n" + msg.text, keyboard=msg.keyboard, approval_id=msg.approval_id)
            elif route.target("owner"):
                await self.send(route.target("owner"), head + f"\n\nThe siren cannot be requested: {answer}")
        for a in res.get("actions") or []:
            kind = (a or {}).get("action")
            try:
                if kind == "ticket":
                    if await self.create_ticket(a.get("summary", ""), a.get("entity_id") or None,
                                                a.get("note") or None, a.get("task_id")):
                        done["tickets"] += 1
                elif kind == "ticket.resolve":
                    if await self._resolve(a):
                        done["resolved"] += 1
                elif kind == "snapshot.get":
                    photo = await camera_photo(self.reader, a.get("entity_id"))
                    if photo:
                        for chat in chats:
                            await self.send(chat, f"Snapshot, incident #{a.get('incident_id')}", photo_b64=photo)
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": skill_name})
                    log.warning("Skill %s asked for an action this agent does not know: %s", skill_name, kind)
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": type(e).__name__})
                log.warning("action %s failed (%s)", kind, type(e).__name__)
        return done

    # ------------------------------------------------------------------ tickets
    async def create_ticket(self, title: str, entity_id: str | None = None, note: str | None = None,
                            task_id: int | None = None) -> str | None:
        """A fault in the Kiosk's Facility records. With a task_id, the task remembers its ticket."""
        if not self.kiosk.enabled:
            self.state.log("ticket_skipped", {"reason": "no Kiosk configured", "summary": (title or "")[:80]})
            return None
        tid = await self.kiosk.add_ticket(ticket_title(title)[:200], entity_id=entity_id, note=note)
        log.info("Kiosk ticket %s created: %s", tid, ticket_title(title)[:80])
        if task_id:
            self._store().set_task_uid(int(task_id), tid)
        self.state.log("executed", {"tool": "ticket", "ticket": tid, "entity": entity_id})
        return tid

    async def _resolve(self, a: dict) -> bool:
        task = self._store().task(int(a.get("task_id") or 0)) if a.get("task_id") else None
        uid = (task or {}).get("todo_uid") or a.get("ticket_id")
        if uid and self.kiosk.enabled and await self.kiosk.resolve_ticket(uid, note=a.get("note")):
            log.info("Kiosk ticket %s resolved", uid)
            return True
        return False

    async def repair_tickets(self) -> int:
        """The open tasks and the Kiosk's tickets agree (at each start and each night, owner, 2026-10-01):
          - a task whose ticket a person resolved in the Kiosk is closed, with the incident it came from
            (vesta_shared.problems decides; here only the Kiosk is read and the alert's messages settled);
          - a task that outlived its finding or incident is closed, its ticket resolved;
          - an open task without its ticket gets one (a task stored while the Kiosk was off, or by a
            script whose result was dropped).
        ⚠️ Without the first two the Kiosk's Cockpit only ever grew: 22 "Open fault" for problems gone."""
        if not self.kiosk.enabled:
            return 0
        store = self._store()
        problems = Problems(store)
        try:
            states = await self.kiosk.ticket_states()
        except Exception as e:  # noqa: BLE001 — the next start or night tries again
            log.warning("The Kiosk's tickets could not be read (%s)", type(e).__name__)
            return 0
        closed = cleared = 0
        for t in problems.open_tasks():
            uid = t.get("todo_uid")
            if uid and states.get(uid) == "resolved":
                iid = problems.closed_in_kiosk(t["id"])
                if iid:
                    await self.settle(iid, "Closed in the VESTA Kiosk, {time}.")
                closed += 1
            elif problems.source_gone(t):
                problems.close(t["id"], CLEARED)
                if uid and states.get(uid) not in (None, "resolved"):
                    await self.kiosk.resolve_ticket(uid, note="Cleared: the check no longer sees it.")
                cleared += 1
        if closed or cleared:
            log.info("Kiosk tickets reconciled: %d task(s) closed in the Kiosk, %d cleared with their ticket", closed, cleared)
        made = 0
        for t in problems.open_tasks():
            if t.get("todo_uid"):
                continue
            try:
                check = problems.check_of(t)
                if await self.create_ticket(problems.title_of(t), t.get("entity_id") or None,
                                            f"Check: {check}" if check else None, t["id"]):
                    made += 1
            except Exception as e:  # noqa: BLE001 — the next start or night tries again
                log.warning("A missing Kiosk ticket could not be created (%s)", type(e).__name__)
                break
        if made:
            log.info("Kiosk tickets created for %d open task(s) that had none", made)
        return made

    # ------------------------------------------------------------------ the alert buttons
    async def settle(self, iid: int, note: str) -> int:
        """Every message carrying incident `iid`'s buttons — the alert in each chat it went to, and each
        reminder — loses them and shows `note` (who did what, when). Returns how many were edited.

        ⚠️ ALL OF THEM, NOT THE ONE PRESSED (owner, 2026-10-01): a P1 goes to the owner's chat and the
        facility manager's, and a reminder repeats it; pressed in one, the others kept buttons that
        only answered "already closed"."""
        note = note.replace("{time}", datetime.now(ZoneInfo(self.tz)).strftime("%H:%M"))
        n = 0
        for chat, mid, text in self.state.alert_messages(iid):
            if self.edit and note:
                await self.edit(chat, mid, f"{text.rstrip()}\n\n{note}"[:4096])
                n += 1
            self.state.forget_alert_message(iid, chat, mid)
        return n

    async def press(self, q: dict, chat: int, data: str, person, toast: Callable[[str], Awaitable]) -> None:
        """Done / Not found / Need help / Mute on an alert: the skill's on_reply decides, answering `here`."""
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
        skill_name = self.state.alert_skill(iid, chat)
        skill = self.skills.get(skill_name) if skill_name else None
        if skill is None or not skill.on_reply:
            self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "not sent to this chat, or its skill is gone"})
            return await toast("This button belongs to another chat.")
        if opt == "mute" and person.role != "owner":
            inc = self._store().incident(int(iid)) or {}
            if inc.get("severity") in ("P1", "P2"):
                self.state.log("press_refused", {"incident": iid, "by": person.telegram_id, "reason": "mute of a P1/P2 is owner only"})
                return await toast("Only the owner can mute a P1 or P2 alert.")
        label = options[opt]
        await toast(f"{label}: noted.")
        self.state.log("ladder", {"incident": iid, "by": person.name, "reply": label})
        log.info("Button %s on incident #%s pressed by %s", label, iid, person.name)
        # the buttons go, and the message says who did what, when: nobody presses twice,
        # and the chat itself shows the incident was handled
        await self.settle(int(iid), f"{label} — {person.name}, {{time}}")
        if self.run_job:
            await self.run_job(skill, skill.on_reply, 120, {"incident": iid, "text": label, "role": person.role},
                               Origin(chat))
