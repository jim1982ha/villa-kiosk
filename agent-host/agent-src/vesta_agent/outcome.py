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
from typing import TYPE_CHECKING, Awaitable, Callable

from .incident_thread import approval_thread
from .routing import Origin, Routing
from .outcome_words import clean_summary, ticket_title  # noqa: F401 — the words of a record, shared with tickets.py
from vesta_shared.messaging import incident_tag

if TYPE_CHECKING:
    from .actions import Outgoing

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
                 thread, notices=None, out_dir: str = ""):
        self.policy = policy
        self.state = state
        self.send = send                # delivery.Delivery.send — the message id, or None when nothing arrived
        self.actions = actions
        self.reader = reader
        self.tickets = tickets          # tickets.Tickets: ticket, ticket.resolve
        self.buttons = buttons          # alert_buttons.AlertButtons: an alert's buttons
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        self.notices = notices          # notice.Notices: the heading of every message the agent sends on its own
        self.out_dir = out_dir

    # ------------------------------------------------------------------ carry out
    async def carry_out(self, res: dict, skill_name: str | None = None, origin: Origin | None = None,
                        folder: str | None = None, skip: list[int] | tuple = ()) -> dict:
        """Do what the script decided. Returns what was done, for the caller's answer and the tests. `folder`: the run's
        own (config.Settings.in_folder), where its attachments are; the out folder itself without one. `skip`: chats
        already told (the owner told of a refused key is not told twice in the chat that just read it)."""
        done = {"sent": 0, "not_sent": 0, "tickets": 0, "resolved": 0, "unrouted": 0}
        if not isinstance(res, dict) or not res:
            return done
        route = Routing(self.policy())
        gate = res.get("siren_gate") or {}
        gate_prompt = gate.get("prompt") if gate.get("armed") else None
        chats: set[int] = set()
        pol = self.policy()
        items = list(res.get("send") or [])
        if gate_prompt and not pol.siren_entity:
            # no siren to ask for: the warning itself goes to the gate's people (it was dropped before, 0.12.80)
            items += [{"to": to, "text": gate_prompt} for to in gate.get("to") or ("owner",)]
        # one result's messages are ONE notice of its incident: one history line, its chats together (notice.py)
        noticed: dict[int, tuple[str | None, list[tuple[int, frozenset]]]] = {}

        def notice(iid, stage, chat, roles=frozenset()):
            st, chs = noticed.get(int(iid), (stage, []))
            noticed[int(iid)] = (st or stage, chs + [(chat, frozenset(roles))])
        # Home Assistant's own messages first: the desk's messages below then replace them where both land
        for h in res.get("ha_messages") or []:
            for chat in await self.adopt_ha(h, skill_name):
                notice(h["incident_id"], h.get("stage"), chat)
        # ⚠️ SETTLED BEFORE THIS RESULT'S MESSAGES ARE POSTED (architecture review 12, 2026-10-09): "Need help" sends the
        # owner a new message with the buttons; settled after it, that message lost them the moment it arrived
        for s in res.get("settle") or []:
            if isinstance(s, dict) and str(s.get("incident_id") or "").isdigit():
                await self.thread.close(int(s["incident_id"]), str(s.get("note") or ""))
        pairs, unrouted = self._deliveries(items, route, origin)
        pairs = [p for p in pairs if p[0] not in {int(x) for x in skip}]
        for item in unrouted:
            done["unrouted"] += 1
            self.state.log("send_unrouted", {"to": item.get("to"), "skill": skill_name})
            log.info("A message for %r had nowhere to go (nobody of that role in People)", item.get("to"))
        for chat, item, roles in pairs:
            text = item.get("text") or ""
            kb = None
            # ⚠️ ITS INCIDENT AS A FIELD (review 7): it was read out of the wording ("#N"), so a reworded reminder
            # lost its buttons. A message with the buttons and no incident of its own is the result's incident's.
            iid = item.get("incident_id") or (res.get("incident_id") if item.get("keyboard") else None)
            # ⚠️ EVERY MESSAGE ABOUT AN OPEN ALERT HAS ITS BUTTONS, IN EVERY CHAT (owner, 2026-10-10: "the user shall not
            # have to type to reply anything"): the owner's group got the reminder of incident #9 with "Reply Done" and no
            # button — the buttons came only where the skill asked for them. Decided here, for every skill's message.
            if skill_name and iid and (item.get("keyboard") or self.buttons.open(iid)):
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
            # the incident's message in this chat now: the earlier one there goes
            mid = await self._post(chat, text, roles=roles, incident=int(iid) if iid else None, keyboard=kb, document=doc,
                                   thread=int(iid) if iid else None, origin=origin)
            if not mid:
                done["not_sent"] += 1                         # delivery.py: refused, or Telegram off
                continue
            if iid:
                notice(iid, item.get("stage"), chat, roles)
            chats.add(chat)
            done["sent"] += 1
        if self.notices:
            for iid, (stage, chs) in noticed.items():
                self.notices.record(iid, stage, chs)
        if gate_prompt and pol.siren_entity:
            # its own domain's turn_on (a switch or a siren entity: policy.SIREN_DOMAINS)
            answer, msg = await asyncio.to_thread(self.actions.request, pol.siren_entity.split(".")[0], "turn_on",
                                                  pol.siren_entity, {}, None, None)
            if msg:
                await self.ask(msg, head=gate_prompt, origin=origin)
            else:
                for chat in route.target("owner"):
                    await self._post(chat, gate_prompt + f"\n\nThe siren cannot be requested: {answer}", roles={"owner"},
                                     origin=origin)
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
                        # its own thread: a newer snapshot of the incident replaces the older one in each chat
                        for chat in chats:
                            await self._post(chat, f"{incident_tag(a.get('incident_id'))} · Snapshot", photo=photo, plain=True,
                                             thread=f"snapshot-{a.get('incident_id')}", origin=origin)
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": skill_name})
                    log.warning("Skill %s asked for an action this agent does not know: %s", skill_name, kind)
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": type(e).__name__})
                log.warning("action %s failed (%s)", kind, type(e).__name__)
        return done

    async def ask(self, msg: Outgoing, head: str = "", origin: Origin | None = None) -> int:
        """An approval request (actions.request's Outgoing) in every chat it is for, each copy one message of the same
        thread: a press in one settles them all (app._press_approval). Returns how many chats have it.

        ⚠️ THE ALERTS' MECHANISM, NOT A SECOND ONE (owner, 2026-10-10): an approval for the owner now reaches every
        owner chat, and its copies are kept and settled as an incident's are (incident_thread.py)."""
        text = f"{head}\n\n{msg.text}" if head else msg.text
        n = 0
        for chat in msg.chats:
            # under its heading, as everything the agent sends on its own — not in the chat it was asked from: there it
            # is part of the answer to the person who asked
            if await self._post(chat, text, roles={msg.to} if msg.to else (), keyboard=msg.keyboard,
                                thread=approval_thread(msg.approval_id), plain=chat == msg.asked_in, origin=origin):
                n += 1
        return n

    async def _post(self, chat: int, text: str, *, roles=(), incident: int | None = None, keyboard: dict | None = None,
                    document: str | None = None, photo=None, thread: int | str | None = None, plain: bool = False,
                    origin: Origin | None = None) -> int | None:
        """ONE WAY A MESSAGE IS PUT IN A CHAT (architecture review 18): its heading — who it is for (`roles`, every role
        it was sent for there), the incident and its history (notice.Notices) — unless it answers the person who asked,
        in their chat, or is `plain`; then the send; then its `thread` (an incident, an approval, a snapshot): the
        earlier copy in this chat goes. Three sends in this module did part of this by hand (the siren's warning and
        the approvals had no heading, a snapshot piled up). The message id, or None when nothing arrived."""
        if self.notices and not plain and not (origin and origin.holds and chat == origin.chat):
            text = self.notices.compose(chat, text, incident, roles)
        mid = await self.send(chat, text, keyboard=keyboard, document=document, photo=photo, origin=origin)
        if mid and thread is not None:
            await self.thread.post(thread, chat, mid, text, buttons=bool(keyboard))
        return mid

    @staticmethod
    def _deliveries(items: list, route: Routing, origin) -> tuple[list[tuple[int, dict, frozenset]], list[dict]]:
        """Each message in every chat it goes to, as (chat, message, the roles it goes there for), and the messages that
        go nowhere. One copy per chat: of several messages for one incident landing in one chat (a chat listed with both
        roles), the one with the buttons — else the last; of the same text twice, the first.

        ⚠️ THE ROLES ARE MERGED, NEVER DROPPED (architecture review 18): the copy kept for a group listed for the owner AND
        the facility manager was headed "For:" the owner's people only, and its history named only them."""
        pairs: list[tuple[int, dict]] = []
        unrouted: list[dict] = []
        for it in items:
            it = it or {}
            chats = route.target(it.get("to"), origin)
            if not chats:
                unrouted.append(it)
            pairs += [(int(c), it) for c in chats]
        best: dict[tuple, int] = {}
        roles: dict[tuple, set] = {}
        for n, (chat, it) in enumerate(pairs):
            iid = it.get("incident_id")
            k = ("incident", chat, int(iid)) if iid else ("text", chat, it.get("text") or "")
            roles.setdefault(k, set()).update({it["to"]} if it.get("to") in ("owner", "fm") else set())
            if k not in best or (iid and (it.get("keyboard") or not pairs[best[k]][1].get("keyboard"))):
                best[k] = n
        kept = sorted((n, k) for k, n in best.items())
        return [(pairs[n][0], pairs[n][1], frozenset(roles[k])) for n, k in kept], unrouted

    async def adopt_ha(self, h: dict, skill_name: str | None = None) -> list[int]:
        """Home Assistant's messages of one automation run become incident messages (outcome key ha_messages)."""
        ctx, iid, text = (h or {}).get("context"), (h or {}).get("incident_id"), (h or {}).get("text") or ""
        if not (ctx and str(iid or "").isdigit() and text):
            return []
        found = self.state.ha_sent(ctx)
        for wait in HA_SENT_WAIT_S:
            if found:
                break
            await asyncio.sleep(wait)
            found = self.state.ha_sent(ctx)
        for chat, mid in found:
            # Home Assistant's own alert, taken over: the incident's text, the earlier messages' times, its buttons
            kb = self.buttons.keyboard(int(iid), chat, skill_name) if skill_name and self.buttons.open(iid) else None
            shown = self.notices.compose(chat, text, int(iid)) if self.notices else text
            await self.thread.adopt(int(iid), chat, mid, shown, keyboard=kb)
        if not found:
            log.info("Incident #%s: no Home Assistant message of its run to take over", iid)
        return [chat for chat, _ in found]
