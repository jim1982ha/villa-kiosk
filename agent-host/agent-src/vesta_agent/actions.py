"""Requests for action, the person who approves them, and their execution.

The model never executes anything. It can only ask (the `ha_call_service`
tool it sees creates an approval request). The code then:

  1. checks the call against the policy (layer 2), before any button is sent;
  2. stores the exact action with a random id, its hash, the role it needs and
     an expiry, and sends Approve / Refuse under a plain-words message;
  3. on a press, reads the Telegram id of the person who pressed (never the
     group), checks the role, the expiry, that the id was not used, that the
     action is the one approved (hash), and the policy again;
  4. executes through ha-mcp, reads the state back, and edits the message
     with who decided and what the villa now says.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from vesta_shared.message_format import ROLE_WORDS
from vesta_shared.ha_client import error_chars, error_short_chars
from vesta_shared import automation_words as AW  # an automation in words: one writer

from . import button_data
from .approvals import WHILE_EMPTY, note as approval_note
from .policy import NOT_REGISTERED, Decision, Person, Policy, action_hash
from .routing import Routing
from vesta_shared.occupancy import OCCUPIED
from .state import State

log = logging.getLogger("vesta.actions")

EXPECT = {
    ("light", "turn_on"): "on", ("light", "turn_off"): "off",
    ("switch", "turn_on"): "on", ("switch", "turn_off"): "off",
    ("fan", "turn_on"): "on", ("fan", "turn_off"): "off",
    ("lock", "lock"): "locked", ("lock", "unlock"): "unlocked",
    ("cover", "open_cover"): "open", ("cover", "close_cover"): "closed",
    ("automation", "turn_on"): "on", ("automation", "turn_off"): "off",
    ("input_boolean", "turn_on"): "on", ("input_boolean", "turn_off"): "off",
}
# Home Assistant's own words for a device on its way (a lock, a cover, a valve): read again, not "not confirmed"
ON_ITS_WAY = {"locking", "unlocking", "opening", "closing"}
VERB = {
    "turn_on": "Turn on", "turn_off": "Turn off", "lock": "Lock", "unlock": "Unlock",
    "open_cover": "Open", "close_cover": "Close", "set_cover_position": "Set the position of",
    "set_temperature": "Set the temperature of", "set_hvac_mode": "Set the mode of", "press": "Press",
}


def related_entities(pack, reader, entity_ids: list[str]) -> set[str] | None:
    """What these ids stand for: the members of a group (its entity_id attribute, read from Home Assistant now) and the
    other entities of the same device (the knowledge pack). An owner-only device behind a wrapper is found this way.
    None: what they hold cannot be told — _wrap_check then asks the owner, never acts on its own.

    ⚠️ UNKNOWN IS NOT EMPTY, FROM EITHER SOURCE (architecture review 17, 2026-10-10: Home Assistant not answering;
    architecture review 5, 2026-10-13: the pack). With no pack — its build failed at start — or an id the last build
    never saw (a device added since 01:30), the same-device check found nothing, and a "direct" rule could switch the
    plug behind an owner-only siren with no Approve."""
    if pack is None:
        log.warning("No knowledge pack yet: what %s shares a device with is unknown, the owner is asked",
                    ", ".join(entity_ids))
        return None
    seen = {r["entity_id"] for r in pack.rows()} | set(pack.unclassified)
    if set(entity_ids) - seen:
        log.warning("%s not in the knowledge pack yet: the owner is asked", ", ".join(sorted(set(entity_ids) - seen)))
        return None
    # every entity of the same device, classified or not (2026-10-13: an owner-only siren the pack does not classify
    # had no device in it, and the plug feeding it hid nothing)
    out = {e for eid in entity_ids for e in pack.entities_of_device(pack.device_id_of(eid))}
    try:
        for _eid, st in (reader.states(entity_ids) or {}).items():
            members = ((st or {}).get("attributes") or {}).get("entity_id")
            if isinstance(members, list):
                out |= {str(m).lower() for m in members}
    except Exception:  # noqa: BLE001
        # a slow Home Assistant made a light group look as if it hid nothing (review 17)
        log.warning("What %s holds could not be read from Home Assistant: the owner is asked", ", ".join(entity_ids))
        return None
    return out

@dataclass
class Outgoing:
    chats: list[int]            # every chat the request goes to (routing rule 3): its copies are one thread
    text: str
    keyboard: dict | None = None
    approval_id: str | None = None
    to: str | None = None       # the role it goes to its chats for ("owner"), for the heading; None: the chat's own
    status: str = ""            # where it stands, under the line at the bottom (layout.py): replaced by the decision


#: The same verbs once done: the request's body after it is approved ("Opened Bedroom3 Curtain.").
PAST = {"Turn on": "Turned on", "Turn off": "Turned off", "Lock": "Locked", "Unlock": "Unlocked", "Open": "Opened",
        "Close": "Closed", "Press": "Pressed", "Run the scene": "Ran the scene", "Run the script": "Ran the script"}
#: ...and on their way: what an approved request says while the device is still moving (a curtain takes its time)
PROGRESS = {"Turn on": "Turning on", "Turn off": "Turning off", "Lock": "Locking", "Unlock": "Unlocking",
            "Open": "Opening", "Close": "Closing"}


#: The devices that take their time and say nothing on the way: a curtain reads "closed" until it has finished opening.
SLOW_DOMAINS = {"cover", "valve"}


def outcome(decision: Decision, result: dict) -> str:
    """Where an action carried out stands: "done", "moving" (a device on its way — it said so, "unlocking", or it is one
    that takes its time and says nothing until it arrives) or "failed".

    ⚠️ ONE ANSWER (architecture review scan 3, 2026-10-19): the approval decided "moving" from the VERB — an approved
    light that read "off" after "Turn on" was "Approved: on its way", "Turning on…", followed 90 s, then "failed";
    a direct action answered the raw "Not confirmed: … I will not retry by myself" for a curtain still moving."""
    if result.get("ok"):
        return "done"
    bad = result.get("unconfirmed") or []
    if bad and VERB.get(decision.service) in PROGRESS and (
            decision.domain in SLOW_DOMAINS or any(s in ON_ITS_WAY for _, s in bad)):
        return "moving"
    return "failed"


def _ids(entity_id: Any) -> str:
    """An action's devices for the log, as the request named them (a string, a list, or nothing)."""
    if not entity_id:
        return "-"
    return entity_id if isinstance(entity_id, str) else ", ".join(map(str, entity_id))


def plain(decision: Decision, names: Callable[[str], str]) -> str:
    """The action in plain words: every device (name and room), every parameter. Never an entity id. ⚠️ NO "(final
    state: on)" (owner, 2026-10-29: "improve the content … to something more user friendly"): every verb the rules accept
    already says it (a toggle is refused: Policy.check_service)."""
    verb, target, extra = _words(decision, names)
    return f"{verb} {target}{extra}?"


def done_words(decision: Decision, names: Callable[[str], str], result: dict, settled: bool = True) -> str:
    """What happened, in one sentence: the body of an approved request (owner, 2026-10-10: "Opened Bedroom3 Curtain."
    — never "Not confirmed: … I will not retry by myself" under it). A device that did not reach the state asked for is
    said plainly in its place: the message never claims what did not happen."""
    verb, target, extra = _words(decision, names)
    if result.get("failed"):
        return f"{verb} {target}{extra}: the villa's system refused it, nothing was done."
    bad = result.get("unconfirmed") or []
    if bad and not settled and verb in PROGRESS:
        # ⚠️ NOT YET IS NOT "DID NOT" (owner, 2026-10-10: "the curtain is actually well opened"): a curtain reads "closed"
        # until it has finished moving — it opened 40 s after the agent said it had not. The agent looks again (app)
        return f"{PROGRESS[verb]} {target}{extra}…"
    if bad and len(decision.entity_ids) == 1:
        return f"{target} did not {verb.lower()}: it reads {bad[0][1]}."
    if bad:
        return f"{verb} {target}{extra}: not done for " + "; ".join(f"{n} (reads {s})" for n, s in bad) + "."
    done = PAST.get(verb)
    return f"{done} {target}{extra}." if done else f"Done: {verb[0].lower()}{verb[1:]} {target}{extra}."


def _words(decision: Decision, names: Callable[[str], str]) -> tuple[str, str, str]:
    """(verb, target, parameters) of an action, in plain words: one reading for the request and its result."""
    # an automation by its own name in apostrophes (vesta_shared.automation_words, architecture review round 11,
    # card 3: "Turn on the automation Critical --- Pool leak")
    who = [AW.quoted(names(e), e) if decision.domain == "automation" else names(e) for e in decision.entity_ids]
    if len(who) > 1:
        target = f"{len(who)} devices: " + "; ".join(who)
    else:
        target = who[0] if who else "?"
    verb = VERB.get(decision.service, decision.service.replace("_", " ").capitalize())
    if decision.domain == "automation":
        target = f"the automation {target}"
    if decision.domain == "scene":
        verb = "Run the scene"
    if decision.domain == "script":
        verb = "Run the script"
    extra = ""
    if decision.data:
        extra = " with " + ", ".join(f"{k} = {json.dumps(v, ensure_ascii=False, default=str)}" for k, v in sorted(decision.data.items()))
    return verb, target, extra


class Actions:
    def __init__(self, policy_loader: Callable[[], Policy], state: State,
                 writer_factory: Callable[[], Any], names: Callable[[str], str] | None = None,
                 related: Callable[[list[str]], set[str]] | None = None,
                 executed: Callable[[str, str, list[str]], None] | None = None,
                 tablet_keeps: Callable[[], bool] = lambda: False, villa_now: Callable[[], str] = lambda: "unknown"):
        self.policy_loader = policy_loader
        # executed(domain, service, entity_ids): told of every execution, whatever the path (siren.py)
        self.on_executed = executed or (lambda *a: None)
        self.state = state
        self.writer_factory = writer_factory
        self.names = names or (lambda e: e)
        # related(ids) -> every entity these ids stand for: group members, other entities of the same device.
        # An owner-only or excluded entity hidden behind a wrapper (a light group, a template cover) is caught here.
        self.related = related or (lambda ids: set())
        # a request no Telegram chat may approve can still wait on the tablet, with its buttons (the Kiosk keeps VESTA's
        # messages: ticket 22 of "One inbox", owner 2026-10-29: "if no Telegram is available but Kiosk is opened…")
        self.tablet_keeps = tablet_keeps
        # the villa empty or not NOW (vesta_shared.occupancy.now: the Kiosk's pick, read live): a request asked only
        # while the villa is empty (`while_empty`, the siren's gate) is read against it at the press
        self.villa_now = villa_now

    def occupied(self) -> bool:
        """Someone is in the villa now, by its "empty" sensor. Only a reading that says so: unknown is not occupied."""
        try:
            return self.villa_now() == OCCUPIED
        except Exception:  # noqa: BLE001 — unread is "cannot tell"
            return False

    def _wrap_check(self, policy: Policy, d: Decision) -> Decision:
        if not d.allowed:
            return d
        related = self.related(d.entity_ids)
        if related is None:
            # Home Assistant could not say what these hold: what cannot be checked is the owner's to approve
            d.required_role, d.direct = "owner", False
            return d
        hidden = set(related) - set(d.entity_ids)
        if hidden & policy.excluded:
            d.allowed, d.reason = False, "It includes an excluded device."
        elif hidden & policy.owners_alone:
            # a wrapper of the siren too: a plug or a group on its device, a scene that sets it (its entity_id members)
            d.required_role, d.direct = "owner", False
        return d

    # ------------------------------------------------------------------ ask
    def request(self, domain: str, service: str, entity_id: Any, data: dict | None,
                requester: Person | None, origin_chat: int | None, while_empty: bool = False) -> tuple[str, Outgoing | None]:
        """Returns (answer for the model, message to send or None). `while_empty`: asked because the villa is empty
        (the siren's gate) — someone in it before the press, it is withdrawn (decide; approvals.Approvals.expire)."""
        policy = self.policy_loader()
        d = self._wrap_check(policy, policy.check_service(domain, service, entity_id, data))
        base = {"domain": domain, "service": service, "entity_id": entity_id, "data": data,
                "requester": requester.telegram_id if requester else None}
        if not d.allowed:
            self.state.log("refused", dict(base, reason=d.reason))
            # ⚠️ A REFUSAL IS IN THE LOG TOO (owner, 2026-10-18, "turn off the TV"): it was only in the agent's own
            # records, so the log read "ha_search, then a request for the screen switch" and nobody could tell that
            # the TV itself had been asked first and refused by the villa's rules
            log.info("Refused %s.%s on %s, asked by %s: %s", domain, service, _ids(entity_id),
                     requester.name if requester else "a job", d.reason)
            return f"Refused by the agent's rules: {d.reason}", None
        # ⚠️ `direct` SKIPS THE BUTTON ONLY FOR A PERSON'S OWN REQUEST: a registered
        # person, writing in a chat. A scheduled job, an alert, a skill (no requester)
        # still asks; so does anything an owner-only device hides behind (_wrap_check
        # raised it to "owner").
        if (d.direct and d.required_role == "any" and requester is not None and origin_chat is not None
                and policy.member(requester.telegram_id, origin_chat) is not None):      # one answer: policy.member
            result = self.execute(d)
            self.state.log("direct", dict(base, by=requester.name, ok=result["ok"]))
            log.info("Direct %s.%s on %s, asked by %s: %s", d.domain, d.service, ", ".join(d.entity_ids),
                     requester.name, result["text"])
            # what happened, as an approved request says it (done_words, outcome): "Opening Bedroom3 Curtain…" for a
            # curtain on its way, never "Not confirmed: … I will not retry by myself"
            said = done_words(d, self.names, result, settled=outcome(d, result) != "moving")
            return f"Executed without approval (the agent's rule for {d.domain}.{d.service} is direct). Result: {said}", None
        targets = Routing(policy).approver_chats(d.required_role, origin_chat)
        if not targets and self.tablet_keeps():
            pass                                   # it waits on the tablet alone (approvals.ask keeps it there)
        elif d.required_role == "owner" and not targets:
            self.state.log("refused", dict(base, reason="no chat where the owner can approve"))
            return ("Refused: no chat in People where the owner can approve it (an owner's private chat, or a group "
                    "listed for the owner only; a group listed for both roles acts as the facility manager)."), None
        elif not targets:
            self.state.log("refused", dict(base, reason="no chat to ask in"))
            return "Refused: no chat to ask in.", None
        text = plain(d, self.names)
        action = {"domain": d.domain, "service": d.service, "entity_ids": d.entity_ids, "data": d.data, "plain": text,
                  **({WHILE_EMPTY: True} if while_empty else {})}
        aid = self.state.new_approval(action, d.action_hash(), d.required_role or "owner",
                                      int(targets[0]) if targets else int(origin_chat or 0),
                                      requester.telegram_id if requester else None, policy.approval_ttl_minutes)
        # the roles in their one set of words (message_format.ROLE_WORDS; owner, 2026-10-17)
        owner, fm = (f"the {ROLE_WORDS[r].lower()}" for r in ("owner", "fm"))
        who = owner if d.required_role == "owner" else f"{owner} or {fm}"
        self.state.log("requested", dict(base, approval=aid, required_role=d.required_role))
        msg = Outgoing([int(c) for c in targets],
                       # the action as its body, where it stands as its status — replaced by the decision when pressed
                       # (owner, 2026-10-10: every message of the agent's in the same layout, the asker's chat included)
                       # who asked, under the action: a request may reach chats the asker is not in (owner, 2026-10-29)
                       f"{text}\nAsked by {requester.name}." if requester else text,
                       {"inline_keyboard": [[{"text": "Approve", "callback_data": button_data.make(button_data.APPROVAL, aid, "y")},
                                             {"text": "Refuse", "callback_data": button_data.make(button_data.APPROVAL, aid, "n")}]]}, aid,
                       to="owner" if d.required_role == "owner" or origin_chat is None else None,
                       status=approval_note("pending", who=who, minutes=policy.approval_ttl_minutes))
        return (f"Approval requested from {who} (buttons sent). Nothing happens until a person approves. "
                f"Do not say it is done."), msg

    # ------------------------------------------------------------------ decide
    def decide(self, aid: str, presser_id: int | None, approve: bool, now: datetime | None = None,
               chat: int | None = None, name: str | None = None) -> dict:
        """Returns {'toast': str for the presser only, 'state': the request's new state or None when the press changed
        nothing, 'by': who decided, 'why': what the rules said, 'executed': bool} — and once approved its 'body' (what
        happened) and 'follow' (a device still on its way). The words every copy then shows are approvals.note's."""
        now = now or datetime.now(timezone.utc)
        policy = self.policy_loader()
        person = policy.member(presser_id, chat, name)        # pressed in a listed group: its role (policy.member)
        ap = self.state.approval(aid)
        if not ap:
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "unknown id"})
            return {"toast": "This request does not exist.", "state": None, "executed": False}
        if person is None:
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "not a registered person or anonymous"})
            return {"toast": NOT_REGISTERED, "state": None, "executed": False}
        from .approvals import toast                         # one table of a request's states and their words
        if ap["status"] != "pending":
            return {"toast": toast(ap["status"]), "state": None, "executed": False}
        if datetime.fromisoformat(ap["expires_at"]) < now:
            expired = self.state.expire_approval(aid)
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "expired"})
            return {"toast": toast("expired"), "state": "expired" if expired else None, "executed": False}
        if not policy.role_can_approve(person.role, ap["required_role"]):
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": f"role {person.role}"})
            return {"toast": "Only the owner can approve this." if ap["required_role"] == "owner" else "You cannot approve this.",
                    "state": None, "executed": False}
        act = ap["action"]
        if approve and act.get(WHILE_EMPTY) and self.occupied():
            # ⚠️ NEVER ON AN APPROVE PRESSED AFTER SOMEONE CAME HOME (owner's Telegram, 2026-10-31 00:19): the siren was
            # asked on the villa as it read at the alert — the owner arriving home, the "empty" sensor off 3 seconds
            # later; the request stayed pressable for 15 minutes
            if self.state.withdraw_approval(aid):
                self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "villa no longer empty"})
                return {"toast": toast("withdrawn"), "state": "withdrawn", "executed": False}
            return {"toast": "Already decided.", "state": None, "executed": False}
        if not approve:
            if self.state.claim_approval(aid, "refused", person.telegram_id, now, name=person.name):
                self.state.log("refused_by_person", {"approval": aid, "by": person.name})
                return {"toast": "Refused.", "state": "refused", "by": person.name, "executed": False}
            return {"toast": "Already decided.", "state": None, "executed": False}
        # the policy may have changed since the request: check again, and the action must be the one approved
        d = self._wrap_check(policy, policy.check_service(act["domain"], act["service"], act["entity_ids"], act["data"]))
        if not d.allowed or d.action_hash() != ap["action_hash"] or \
                action_hash(act["domain"], act["service"], act["entity_ids"], act["data"]) != ap["action_hash"]:
            # "blocked", never "failed" (architecture review 20): nothing was tried — the AI is told so
            self.state.claim_approval(aid, "blocked", person.telegram_id, now, name=person.name)
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": d.reason or "action changed"})
            return {"toast": "Refused by the agent's rules.", "state": "blocked", "why": d.reason or "the action changed",
                    "executed": False}
        if not policy.role_can_approve(person.role, d.required_role):
            return {"toast": "Only the owner can approve this.", "state": None, "executed": False}
        if not self.state.claim_approval(aid, "approved", person.telegram_id, now, name=person.name):
            return {"toast": "Already decided.", "state": None, "executed": False}
        self.state.log("approved", {"approval": aid, "by": person.name, "role": person.role})
        result = self.execute(d)
        # the body says what happened, the status who approved it and when (owner, 2026-10-10). A device still on its way
        # is recorded "moving", never "failed" (architecture review 19: the AI read "failed" for a curtain that opened):
        # approvals.Approvals follows it and writes the one verdict — done or failed — with the message's last words
        state = outcome(d, result)
        moving = state == "moving"
        self.state.finish_approval(aid, state, result)
        said = "Done." if result["ok"] else "Approved: on its way." if moving else \
            "The villa's system refused it." if result.get("failed") else "Sent, not confirmed."
        return {"toast": said, "state": state, "by": person.name,
                "body": done_words(d, self.names, result, settled=not moving), "executed": True, "result": result,
                "follow": d if moving else None}

    def recheck(self, d: Decision, final: bool = False) -> str | None:
        """An approved action whose device was still on its way, read again: what the request says now — done, or (when
        `final`) not done — or None while it is still moving."""
        expect = EXPECT.get((d.domain, d.service))
        try:
            st = self.writer_factory().states(d.entity_ids) or {}
        except Exception:  # noqa: BLE001 — not readable now: looked at again, or said as not confirmed at the end
            st = {}
        bad = [(self.names(e), (st.get(e) or {}).get("state")) for e in d.entity_ids if (st.get(e) or {}).get("state") != expect]
        if not bad:
            return done_words(d, self.names, {"ok": True})
        return done_words(d, self.names, {"ok": False, "unconfirmed": bad}) if final else None

    # ------------------------------------------------------------------ execute
    def execute(self, d: Decision) -> dict:
        writer = self.writer_factory()
        data = dict(d.data)
        if d.entity_ids:
            data["entity_id"] = list(d.entity_ids)     # always a list: no comma-joined string reaches Home Assistant
        try:
            writer.call_service(d.domain, d.service, data)
        except Exception as e:  # noqa: BLE001
            self.state.log("failed", {"domain": d.domain, "service": d.service, "entities": d.entity_ids, "error": str(e)[:error_chars()]})
            log.warning("Approved %s.%s on %s failed: %s", d.domain, d.service, ", ".join(d.entity_ids) or "-", str(e)[:error_chars()])
            return {"ok": False, "failed": True,
                    "text": "The villa's system refused or failed. Nothing confirmed."}
        self.state.log("executed", {"domain": d.domain, "service": d.service, "entities": d.entity_ids, "data": d.data})
        try:
            self.on_executed(d.domain, d.service, list(d.entity_ids))
        except Exception:  # noqa: BLE001 — a failed hook never undoes what Home Assistant did
            log.exception("after an execution")
        expect = EXPECT.get((d.domain, d.service))
        if not d.entity_ids or not expect:
            return {"ok": True, "text": "Sent."}
        # One device: ha-mcp already waited for its new state. Several: it could not
        # (see McpClient.call_service), so the read-back gives them a few seconds. ⚠️ A device still on its way
        # ("unlocking": a lock that has not finished) is read again too (architecture review 5): it read "Not
        # confirmed: … reads unlocking" for a lock that opened a second later.
        for attempt in range(5):
            if attempt:
                time.sleep(1)
            try:
                st = writer.states(d.entity_ids)
            except Exception:  # noqa: BLE001
                st = {}
            rows = [(e, (st.get(e) or {}).get("state")) for e in d.entity_ids]
            bad = [(e, s) for e, s in rows if s != expect]
            if not bad or (len(d.entity_ids) == 1 and not any(s in ON_ITS_WAY for _, s in bad)):
                break
        self.state.log("readback", {"entities": d.entity_ids, "expect": expect, "states": dict(rows)})
        if not bad:
            return {"ok": True, "text": f"Done: {', '.join(self.names(e) for e, _ in rows)} {expect}."}
        return {"ok": False, "unconfirmed": [(self.names(e), s) for e, s in bad],
                "text": "Not confirmed: " + ", ".join(f"{self.names(e)} reads {s}" for e, s in bad) + ". I will not retry by myself."}

    # ------------------------------------------------------------------ system
    def system(self, domain: str, service: str, entity_id: str, data: dict | None = None, siren: str | None = None) -> bool:
        """A call the code makes for itself (the agent's heartbeat helper). Listed in policy.system_actions only — or the
        stop of `siren`, the one the agent turned on (siren.py)."""
        policy = self.policy_loader()
        d = policy.check_service(domain, service, entity_id, data, system=True, siren=siren)
        if not d.allowed:
            self.state.log("refused", {"system": True, "domain": domain, "service": service, "entity": entity_id, "reason": d.reason})
            return False
        try:
            self.writer_factory().call_service(domain, service, dict(d.data, entity_id=entity_id))
            self.state.log("executed", {"system": True, "domain": domain, "service": service, "entity": entity_id})
            return True
        except Exception as e:  # noqa: BLE001
            self.state.log("failed", {"system": True, "domain": domain, "service": service, "error": str(e)[:error_short_chars()]})
            return False
