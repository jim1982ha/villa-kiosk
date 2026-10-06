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

The alert buttons (alert_buttons.py) and the Kiosk's tickets (tickets.py) are their own modules (architecture
review, 2026-10-07): this one carries a result out with them.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Awaitable, Callable

from .routing import Origin, Routing

from .outcome_words import clean_summary, ticket_title  # noqa: F401 — the words of a record, shared with tickets.py

log = logging.getLogger("vesta.outcome")


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
    def __init__(self, *, policy: Callable, state, send: Callable[..., Awaitable], actions, reader, tickets, buttons,
                 out_dir: str = ""):
        self.policy = policy
        self.state = state
        self.send = send                # delivery.Delivery.send — the message id, or None when nothing arrived
        self.actions = actions
        self.reader = reader
        self.tickets = tickets          # tickets.Tickets: ticket, ticket.resolve
        self.buttons = buttons          # alert_buttons.AlertButtons: the alert's buttons, settle
        self.out_dir = out_dir

    # ------------------------------------------------------------------ carry out
    async def carry_out(self, res: dict, skill_name: str | None = None, origin: Origin | None = None) -> dict:
        """Do what the script decided. Returns what was done, for the caller's answer and the tests."""
        done = {"sent": 0, "not_sent": 0, "tickets": 0, "resolved": 0, "unrouted": 0}
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
                    kb = self.buttons.keyboard(iid, chat, skill_name)
            doc = None
            att = item.get("attachment")
            if att:
                from .skills import FILE_NAME
                path = os.path.join(self.out_dir, str(att))
                if FILE_NAME.match(str(att)) and self.out_dir and os.path.isfile(path):
                    doc = path
                else:
                    log.warning("Skill %s attached %r, which is not a file of the out folder: sent without it", skill_name, att)
            mid = await self.send(chat, text, keyboard=kb, document=doc, origin=origin)
            if not mid:
                done["not_sent"] += 1                         # delivery.py: refused, or Telegram off
                continue
            if kb:
                # every message with this incident's buttons, in every chat: all of them settle together
                self.buttons.remember(iid, chat, mid, text)
            chats.add(chat)
            done["sent"] += 1
        for s in res.get("settle") or []:
            if isinstance(s, dict) and str(s.get("incident_id") or "").isdigit():
                await self.buttons.settle(int(s["incident_id"]), str(s.get("note") or ""))
        pol = self.policy()
        if gate_prompt and pol.siren_entity:
            # its own domain's turn_on (a switch or a siren entity: policy.SIREN_DOMAINS)
            answer, msg = await asyncio.to_thread(self.actions.request, pol.siren_entity.split(".")[0], "turn_on",
                                                  pol.siren_entity, {}, None, None)
            head = gate_prompt
            if msg:
                await self.send(msg.chat_id, head + "\n\n" + msg.text, keyboard=msg.keyboard, approval_id=msg.approval_id,
                                origin=origin)
            elif route.target("owner"):
                await self.send(route.target("owner"), head + f"\n\nThe siren cannot be requested: {answer}", origin=origin)
        for a in res.get("actions") or []:
            kind = (a or {}).get("action")
            try:
                if kind == "ticket":
                    if await self.tickets.create(a.get("summary", ""), a.get("entity_id") or None,
                                                a.get("note") or None, a.get("task_id")):
                        done["tickets"] += 1
                elif kind == "ticket.resolve":
                    if await self.tickets.resolve(a):
                        done["resolved"] += 1
                elif kind == "snapshot.get":
                    photo = await camera_photo(self.reader, a.get("entity_id"))
                    if photo:
                        for chat in chats:
                            await self.send(chat, f"Snapshot, incident #{a.get('incident_id')}", photo=photo, origin=origin)
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": skill_name})
                    log.warning("Skill %s asked for an action this agent does not know: %s", skill_name, kind)
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": type(e).__name__})
                log.warning("action %s failed (%s)", kind, type(e).__name__)
        return done
