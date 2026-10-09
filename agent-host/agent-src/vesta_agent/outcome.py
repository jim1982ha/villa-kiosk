"""What a skill script decided, carried out: one module, whoever ran the script.

A skill script prints its decision in the standard form; this module does it:

  send:       [{to: here | owner | fm, text, incident_id?, keyboard?: true, attachment?: <a file of the out folder>}]
              keyboard = the alert buttons of the message's incident_id
  (a skill builds these with vesta_shared/result.py: the shape there, the words in the skill)
  actions:    ticket {summary, entity_id?, note?, task_id?} · ticket.resolve {task_id | ticket_id, note?}
              snapshot.get {entity_id, incident_id}
  siren_gate: {armed, prompt, to}  → an Approve / Refuse request to the owner for the policy's siren; with no
              siren configured, the prompt itself to `to`
  incident_id                  → the incident of the result (a message without its own)
  settle:     [{incident_id, note}]  → before this result's messages: every message still carrying that incident's buttons, in every chat,
              loses them and shows the note ("{time}": the villa's time now)
  ha_messages [{incident_id, text, context}]  → Home Assistant's own messages of that automation run (its
              telegram_sent events, same context) are rewritten as `text` and become the incident's messages

⚠️ ONE MESSAGE PER INCIDENT PER CHAT (owner, 2026-10-09). A message with an incident_id replaces that incident's
earlier messages in its chat (alert_buttons.AlertButtons.replace), whoever sent them; two messages of one result
for the same incident and chat (the owner and the FM sharing a chat) send only one — the one with the buttons.

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
from typing import Awaitable, Callable

from .routing import Origin, Routing

from .outcome_words import clean_summary, ticket_title  # noqa: F401 — the words of a record, shared with tickets.py
from vesta_shared.messaging import incident_tag

#: How long Home Assistant's telegram_sent may trail its own vesta_critical_event (both come from one run, the
#: message first; the socket hands them over in order, so this is a margin, not a wait that normally happens).
HA_SENT_WAIT_S = (0.5, 1.0, 2.0)

log = logging.getLogger("vesta.outcome")


#: What a script result can ask the engine to carry out — the keys carry_out reads. ⚠️ ONE LIST
#: (architecture review, 0.12.38): the model's run_skill_script tool kept its own copy, so a key added here
#: would be carried out on schedule and silently skipped when the model ran the same script.
CARRIED_KEYS = ("send", "actions", "siren_gate", "settle", "ha_messages")


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
                 thread, out_dir: str = ""):
        self.policy = policy
        self.state = state
        self.send = send                # delivery.Delivery.send — the message id, or None when nothing arrived
        self.actions = actions
        self.reader = reader
        self.tickets = tickets          # tickets.Tickets: ticket, ticket.resolve
        self.buttons = buttons          # alert_buttons.AlertButtons: an alert's buttons
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        self.out_dir = out_dir

    # ------------------------------------------------------------------ carry out
    async def carry_out(self, res: dict, skill_name: str | None = None, origin: Origin | None = None,
                        folder: str | None = None) -> dict:
        """Do what the script decided. Returns what was done, for the caller's answer and the tests. `folder`: the run's
        own (config.Settings.in_folder), where its attachments are; the out folder itself without one."""
        done = {"sent": 0, "not_sent": 0, "tickets": 0, "resolved": 0, "unrouted": 0}
        if not isinstance(res, dict) or not res:
            return done
        route = Routing(self.policy())
        gate = res.get("siren_gate") or {}
        gate_prompt = gate.get("prompt") if gate.get("armed") else None
        sent: set[tuple[int, str]] = set()
        chats: set[int] = set()
        pol = self.policy()
        items = list(res.get("send") or [])
        if gate_prompt and not pol.siren_entity:
            # no siren to ask for: the warning itself goes to the gate's people (it was dropped before, 0.12.80)
            items += [{"to": to, "text": gate_prompt} for to in gate.get("to") or ("owner",)]
        # Home Assistant's own messages first: the desk's messages below then replace them where both land
        for h in res.get("ha_messages") or []:
            await self.adopt_ha(h)
        # ⚠️ SETTLED BEFORE THIS RESULT'S MESSAGES ARE POSTED (architecture review 12, 2026-10-09): "Need help" sends the
        # owner a new message with the buttons; settled after it, that message lost them the moment it arrived
        for s in res.get("settle") or []:
            if isinstance(s, dict) and str(s.get("incident_id") or "").isdigit():
                await self.thread.close(int(s["incident_id"]), str(s.get("note") or ""))
        items = self._one_per_incident(items, route, origin)
        for item in items:
            text = (item or {}).get("text") or ""
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
            # ⚠️ ITS INCIDENT AS A FIELD (review 7): it was read out of the wording ("#N"), so a reworded reminder
            # lost its buttons. A message with the buttons and no incident of its own is the result's incident's.
            iid = item.get("incident_id") or (res.get("incident_id") if item.get("keyboard") else None)
            if item.get("keyboard") and skill_name and iid:
                kb = self.buttons.keyboard(iid, chat, skill_name)
            doc = None
            att = item.get("attachment")
            if att:
                from .skills import FILE_NAME
                where = folder or self.out_dir
                path = os.path.join(where, str(att))
                if FILE_NAME.match(str(att)) and where and os.path.isfile(path):
                    doc = path
                else:
                    log.warning("Skill %s attached %r, which is not a file of the out folder: sent without it", skill_name, att)
            mid = await self.send(chat, text, keyboard=kb, document=doc, origin=origin)
            if not mid:
                done["not_sent"] += 1                         # delivery.py: refused, or Telegram off
                continue
            if iid:
                # the incident's message in this chat now: the earlier one there goes
                await self.thread.post(int(iid), chat, mid, text, buttons=bool(kb))
            chats.add(chat)
            done["sent"] += 1
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
                            await self.send(chat, f"{incident_tag(a.get('incident_id'))} · Snapshot", photo=photo, origin=origin)
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": skill_name})
                    log.warning("Skill %s asked for an action this agent does not know: %s", skill_name, kind)
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": type(e).__name__})
                log.warning("action %s failed (%s)", kind, type(e).__name__)
        return done

    @staticmethod
    def _one_per_incident(items: list, route: Routing, origin) -> list:
        """Of several messages for one incident landing in one chat (the owner and the FM share a chat), the one
        with the buttons — else the last. Any other message is kept as it is."""
        best: dict[tuple, int] = {}
        for n, it in enumerate(items):
            iid = (it or {}).get("incident_id")
            chat = route.target((it or {}).get("to"), origin) if iid else None
            if not chat:
                continue
            k = (chat, int(iid))
            if k not in best or it.get("keyboard") or not items[best[k]].get("keyboard"):
                best[k] = n
        keep = set(best.values())
        return [it for n, it in enumerate(items)
                if not (it or {}).get("incident_id") or not route.target(it.get("to"), origin) or n in keep]

    async def adopt_ha(self, h: dict) -> int:
        """Home Assistant's messages of one automation run become incident messages (outcome key ha_messages)."""
        ctx, iid, text = (h or {}).get("context"), (h or {}).get("incident_id"), (h or {}).get("text") or ""
        if not (ctx and str(iid or "").isdigit() and text):
            return 0
        found = self.state.ha_sent(ctx)
        for wait in HA_SENT_WAIT_S:
            if found:
                break
            await asyncio.sleep(wait)
            found = self.state.ha_sent(ctx)
        for chat, mid in found:
            await self.thread.adopt(int(iid), chat, mid, text)
        if not found:
            log.info("Incident #%s: no Home Assistant message of its run to take over", iid)
        return len(found)
