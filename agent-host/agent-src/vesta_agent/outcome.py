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
earlier messages in its chat (incident_thread.IncidentThread.post), whoever sent them; two messages of one result
for the same incident and chat (the owner and the FM sharing a chat) send only one — the one with the buttons
(routing.Routing.deliveries). ⚠️ WHATEVER WROTE IT (architecture review, 2026-10-19): the villa's own message of the
step, taken over in a chat (ha_messages: its number, heading and buttons), IS the desk's copy there — the desk's
message of the same step is not sent to that chat. A P1 rang the owner's group twice: the rule's message edited,
then deleted for an identical one of the desk's.

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
from datetime import datetime, timezone
from typing import Awaitable, Callable

from vesta_shared.result import FAULTS_CHANGED

from . import layout
from .notice import when
from vesta_shared.message_format import PRESSED_STAGE, ROLES
from .incidents import Incidents
from .posting import Poster
from .routing import Origin, Routing


#: How long Home Assistant's telegram_sent may trail its own vesta_critical_event (both come from one run, the
#: message first; the socket hands them over in order, so this is a margin, not a wait that normally happens).
HA_SENT_WAIT_S = (0.5, 1.0, 2.0)

log = logging.getLogger("vesta.outcome")

#: The title of "the siren cannot be requested", above "To:" (message_format: the one layout).
SIREN_TITLE = "Siren request"


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
                 thread, notices=None, out_dir: str = "", timezone_name: str = "UTC", poster=None, ask=None, incidents=None):
        self.policy = policy
        self.state = state
        self.actions = actions
        self.reader = reader
        self.tickets = tickets          # tickets.Tickets: ticket, ticket.resolve
        self.buttons = buttons          # alert_buttons.AlertButtons: an alert's buttons
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident
        # incidents.Incidents: the alert desk's incidents (one marked unreached); built from the tickets' store when alone
        self.incidents = incidents or (Incidents(tickets.store_path) if getattr(tickets, "store_path", None) else None)
        self.notices = notices          # notice.Notices: the heading of every message the agent sends on its own
        self.out_dir = out_dir
        # an approval request is approvals.Approvals' (the siren's gate asks through it), handed in at construction
        self.ask: Callable[..., Awaitable[int]] | None = ask
        # putting one message in one chat (posting.py), shared with the approvals; built from `send` (delivery.Delivery.send)
        # and the parts above when alone
        self.poster = poster or Poster(send=send, thread=thread, notices=notices, timezone_name=timezone_name)

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
        # one history line per kind of notice this result sent (owner, 2026-10-11: "Escalated … to Jim, Fabien" — Fabien
        # had only been told his own "Need help" was passed on): {(incident, stage): chats}
        noticed: dict[tuple[int, str | None], list[tuple[int, frozenset]]] = {}

        def notice(iid, stage, chat, roles=frozenset()):
            noticed.setdefault((int(iid), stage), []).append((chat, frozenset(roles)))
        pairs, unrouted = route.deliveries(items, origin)
        pairs = [p for p in pairs if p[0] not in {int(x) for x in skip}]

        def incident_of(item):
            return item.get("incident_id") or (res.get("incident_id") if item.get("keyboard") else None)
        # who each notice is for (notice.Notices.audiences): its incident's "To:", its step's own roles, a report's
        going, told, sent_to = self.notices.audiences(pairs, incident_of) if self.notices else ({}, {}, {})
        # incident → where this result showed it, the last one last: (chat, its step, the roles its "To:" named)
        posted: dict[int, list[tuple[int, str | None, set]]] = {}
        asked: dict[int, list[tuple[int, bool]]] = {}   # incident → (chat, reached) of the facility manager's, with buttons
        # the villa's own messages first (its rule's alert in the group), taken over as the incident's copy there — the
        # roles it is about are the step's, else its priority's, never the chat's (notice.Notices.went_to)
        adopted: set[tuple[int, int, str | None]] = set()        # (incident, chat, step) shown by a taken-over copy
        for h in res.get("ha_messages") or []:
            hid, stage = int(h.get("incident_id") or 0), h.get("stage")
            for chat, roles in await self.adopt_ha(h, skill_name, going.get(hid), told.get((hid, stage))):
                notice(hid, stage, chat, roles)
                posted.setdefault(hid, []).append((chat, stage, going.get(hid) or roles))
                adopted.add((hid, chat, stage))
        # ⚠️ ONE COPY PER CHAT, WHATEVER WROTE IT (architecture review, 2026-10-19): the desk's message of a step a chat
        # already shows as the villa's own, taken over, is not sent there — that copy has the number, the heading and
        # the buttons, and `sync` below keeps every copy equal. Decided here, not in routing: what adoption showed is
        # known only once Telegram answered, and routing's roles (audiences) are what the taken-over copy says
        kept = []
        for chat, item, roles in pairs:
            iid = incident_of(item)
            if iid and (int(iid), chat, item.get("stage")) in adopted:
                chats.add(chat)                                       # this result's snapshot goes there too
                if item.get("first_in_line"):
                    asked.setdefault(int(iid), []).append((chat, True))  # the people asked to answer have it
                continue
            kept.append((chat, item, roles))
        pairs = kept
        # ⚠️ SETTLED BEFORE THIS RESULT'S MESSAGES ARE POSTED (architecture review 12, 2026-10-09): "Need help" sends the
        # owner a new message with the buttons; settled after it, that message lost them the moment it arrived
        for s in res.get("settle") or []:
            if isinstance(s, dict) and str(s.get("incident_id") or "").isdigit():
                await self.thread.close(int(s["incident_id"]), str(s.get("note") or ""), mark=s.get("mark"))
        for item in unrouted:
            done["unrouted"] += 1
            self.state.log("send_unrouted", {"to": item.get("to"), "skill": skill_name})
            log.info("A message for %r had nowhere to go (nobody of that role in People)", item.get("to"))
        for chat, item, roles in pairs:
            text = item.get("text") or ""
            kb = None
            # ⚠️ ITS INCIDENT AS A FIELD (review 7): it was read out of the wording ("#N"), so a reworded reminder
            # lost its buttons. A message with the buttons and no incident of its own is the result's incident's.
            iid = incident_of(item)
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
            mid = await self.poster.post(chat, text, status=item.get("status") or "", roles=roles,
                                   incident=int(iid) if iid else None, keyboard=kb, document=doc,
                                   thread=int(iid) if iid else None, origin=origin, stage=item.get("stage"),
                                   mark=item.get("mark"), also=going.get(int(iid)) if iid else sent_to.get(id(item)),
                                   title=item.get("title"), told=told.get((int(iid), item.get("stage"))) if iid else None)
            # the people the skill asked to answer (result.message first_in_line) — the skill's, never a role named here
            if iid and kb and item.get("first_in_line"):
                asked.setdefault(int(iid), []).append((chat, bool(mid)))
            if not mid:
                done["not_sent"] += 1                         # delivery.py: refused, or Telegram off
                continue
            if iid:
                notice(iid, item.get("stage"), chat, roles or (self.notices.roles_of(int(iid)) if self.notices else ()))
                posted.setdefault(int(iid), []).append((chat, item.get("stage"), going.get(int(iid))))
            chats.add(chat)
            done["sent"] += 1
            done.setdefault("messages", {})[chat] = mid          # each chat's message: a page's buttons go under it
        if self.notices:
            for (iid, stage), chs in noticed.items():
                self.notices.record(iid, stage, chs)
        # ⚠️ ONE INCIDENT, ONE PICTURE (owner, 2026-10-11): a reminder went to the facility manager only, and the group's
        # copy kept "(new)" and the first alert — every other copy now shows what was just sent, quietly
        for iid, shown_in in posted.items():
            last_chat, last_stage, last_also = shown_in[-1]
            latest = (self.thread.shown(iid).get(last_chat) or {})
            # ⚠️ EACH CHAT ITS OWN STEPS (owner, 2026-10-18, #55): a step to the facility manager alone re-posted the
            # owner's group copy with it — a chat none of whose roles this step went to keeps its own words (`quiet`)
            # and takes only the heading: the title word and "To:" are the incident's, the same in every copy
            # (architecture review, 2026-10-19)
            stepped = set().union(*[r for (i, _st), r in told.items() if i == iid] or [set()])
            elsewhere = {c for c, _rec in self.thread.state.incident_chats(iid)
                         if self.notices and not self.notices.concerns(c, stepped)}
            # this result's own steps of the incident: its bottom line says them, the history above them never
            steps_now = sum(1 for (i, st) in noticed if i == iid and st != PRESSED_STAGE)   # a press records none
            # each chat's heading as the copy just sent was headed, the chat's own steps listed (notice.heading: one)
            head_for = (lambda c, i=iid, st=last_stage, al=last_also, n=steps_now:
                        self.notices.heading(c, i, stage=st, also=al, before=n)) if self.notices else None
            if latest.get("parts"):
                await self.thread.sync(iid, layout.of(latest), skip={c for c, _s, _a in shown_in}, quiet=elsewhere,
                                       head_for=head_for, keyboard=(
                    lambda c, i=iid: self.buttons.keyboard(i, c, skill_name)) if skill_name and self.buttons.open(iid) else None)
        # ⚠️ AN ALERT NOBODY ASKED TO ANSWER RECEIVED (architecture review 25): Telegram refused every chat of the people
        # first in line (a person who never pressed Start) — the alert desk hands it on at its next tick, never 45
        # minutes later. Only a REFUSED chat counts: Telegram switched off is not "unreachable". Who is first in line is
        # the skill's word (first_in_line, architecture review 2026-10-15), not a role this engine knows
        refused = set(self.state.unreachable())
        for iid, tried in asked.items():
            if not any(ok for _, ok in tried) and all(chat in refused for chat, _ in tried):
                if self.incidents is not None:
                    self.incidents.unreached(iid)
                log.warning("Incident #%s: no chat of the people asked to answer received it — handed on", iid)
        if gate_prompt and pol.siren_entity:
            # its own domain's turn_on (a switch or a siren entity: policy.SIREN_DOMAINS)
            answer, msg = await asyncio.to_thread(self.actions.request, pol.siren_entity.split(".")[0], "turn_on",
                                                  pol.siren_entity, {}, None, None)
            if msg and self.ask is None:
                answer, msg = "no way to ask for an approval here (Outcome built without the approvals)", None
            # ⚠️ THE INTRUSION IS SAID, WHATEVER BECOMES OF THE REQUEST (architecture review 21): its words travel only as
            # the siren request's lead — a request no owner chat received showed them nowhere
            if msg and not await self.ask(msg, head=gate_prompt, origin=origin):
                answer, msg = "no chat of the owner's received the request", None
            if not msg:
                said = f"The siren cannot be requested: {answer}"
                # every chat of the first role, in the roles' order, that receives it: the owner's, else the facility
                # manager's (message_format.ROLES — never the two written out again here)
                for role in ROLES:
                    if any([bool(await self.poster.post(chat, gate_prompt, status=said, roles={role}, origin=origin,
                                                        title=SIREN_TITLE)) for chat in route.target(role)]):
                        break
        # ⚠️ ONE HAND MOVES THE CARDS (architecture review, 2026-10-15): a script's fault actions were carried out here,
        # and the repair worked the same cards out from the tasks — two routes, a 2-day "redo the close" window for when
        # the first failed, and a person's Done that could meet the agent's close. A fault about a task is now the
        # repair's (tickets.repair: Problems.card, at once); only a fault with no task (a chat's) is made here.
        faults_moved = bool(res.get(FAULTS_CHANGED))
        for a in res.get("actions") or []:
            kind = (a or {}).get("action")
            try:
                if kind in ("ticket", "ticket.resolve", "ticket.reopen") and (kind != "ticket" or a.get("task_id")):
                    faults_moved = True
                elif kind == "ticket":
                    if await self.tickets.create(a.get("summary", ""), a.get("entity_id") or None, a.get("note") or None):
                        done["tickets"] += 1
                elif kind == "snapshot.get":
                    photo = await camera_photo(self.reader, a.get("entity_id"))
                    if photo:
                        # its own thread: a newer snapshot of the incident replaces the older one in each chat; under the
                        # heading of every message the agent sends on its own (owner, 2026-10-10: "all formatted the same")
                        iid = int(a["incident_id"]) if str(a.get("incident_id") or "").isdigit() else None
                        for chat in chats:
                            await self.poster.post(chat, "Camera snapshot", incident=iid, photo=photo,
                                             thread=f"snapshot-{a.get('incident_id')}", origin=origin)
                else:
                    self.state.log("action_ignored", {"action": kind, "skill": skill_name})
                    log.warning("Skill %s asked for an action this agent does not know: %s", skill_name, kind)
            except Exception as e:  # noqa: BLE001
                self.state.log("action_failed", {"action": kind, "error": f"{type(e).__name__}: {str(e)[:200]}"})
                log.warning("action %s failed (%s: %s)", kind, type(e).__name__, e)
        if faults_moved:
            try:
                moved = await self.tickets.repair()
                done["tickets"] += moved.get("created", 0) + moved.get("reopened", 0)
                done["resolved"] += moved.get("resolved", 0)
            except Exception as e:  # noqa: BLE001 — the next repair (5 minutes) does it
                log.warning("The Kiosk's faults could not be brought up to date (%s: %s)", type(e).__name__, e)
        return done

    async def adopt_ha(self, h: dict, skill_name: str | None = None, also=None, told=None) -> list[tuple[int, set[str]]]:
        """Home Assistant's messages of one automation run become incident messages (outcome key ha_messages). `also`:
        the roles the incident's other messages of this result go to; `told`: those of this same step. Returns each
        chat taken over with the roles the copy there is about (notice.Notices.went_to)."""
        ctx, iid, text = (h or {}).get("context"), (h or {}).get("incident_id"), (h or {}).get("text") or ""
        if not (ctx and str(iid or "").isdigit() and text):
            return []
        found = self.state.ha_sent(ctx)
        for wait in HA_SENT_WAIT_S:
            if found:
                break
            await asyncio.sleep(wait)
            found = self.state.ha_sent(ctx)
        out = []
        for chat, mid in found:
            # Home Assistant's own alert, taken over: the incident's text, the earlier messages' times, its buttons
            kb = self.buttons.keyboard(int(iid), chat, skill_name) if skill_name and self.buttons.open(iid) else None
            # "{time}" in its status: the villa's time now, as every message of the agent's writes it
            status = (h.get("status") or "").replace("{time}", when(datetime.now(timezone.utc), self.poster.tz))
            # ⚠️ "TO:" FOLLOWS THE PRIORITY (owner, 2026-10-17, reversing 2026-10-16's #43 knowingly): the rule's own
            # message is about the roles this step goes to, else those its priority reaches — never the roles of the
            # chat the rule posts in (a P3's message in the owner's group read "To: Owner")
            roles = self.notices.went_to(int(iid), chat, told, also) if self.notices else set(told or ())
            if self.notices:
                status = self.notices.bottom(h.get("stage"), roles, status, incident=int(iid))
            p = layout.parts(body=text, status=status,
                             head=self.notices.heading(chat, int(iid), stage=h.get("stage"), also=also) if self.notices else "")
            await self.thread.adopt(int(iid), chat, mid, p, keyboard=kb)
            # ⚠️ TAKEN OVER, IT IS THE AGENT'S (2026-10-17): a press is handled only on the agent's own messages, and this
            # one carries its Done / Need help — never remembered, a press on the rule's first copy was left unanswered
            self.state.remember_message(chat, mid)
            out.append((chat, roles))
        if not found:
            log.info("Incident #%s: no Home Assistant message of its run to take over", iid)
        return out
