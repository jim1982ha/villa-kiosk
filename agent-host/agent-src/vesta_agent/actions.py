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

from . import button_data
from .policy import NOT_REGISTERED, Decision, Person, Policy, action_hash
from .routing import Routing
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


@dataclass
class Outgoing:
    chat_id: int
    text: str
    keyboard: dict | None = None
    approval_id: str | None = None


def plain(decision: Decision, names: Callable[[str], str]) -> str:
    """The action in plain words: every device (name and room), every parameter. Never an entity id."""
    who = [names(e) for e in decision.entity_ids]
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
    state = EXPECT.get((decision.domain, decision.service))
    tail = f" (final state: {state})" if state else ""
    return f"{verb} {target}{extra}{tail}?"


class Actions:
    def __init__(self, policy_loader: Callable[[], Policy], state: State,
                 writer_factory: Callable[[], Any], names: Callable[[str], str] | None = None,
                 related: Callable[[list[str]], set[str]] | None = None,
                 executed: Callable[[str, str, list[str]], None] | None = None):
        self.policy_loader = policy_loader
        # executed(domain, service, entity_ids): told of every execution, whatever the path (siren.py)
        self.on_executed = executed or (lambda *a: None)
        self.state = state
        self.writer_factory = writer_factory
        self.names = names or (lambda e: e)
        # related(ids) -> every entity these ids stand for: group members, other entities of the same device.
        # An owner-only or excluded entity hidden behind a wrapper (a light group, a template cover) is caught here.
        self.related = related or (lambda ids: set())

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
        elif hidden & policy.owner_only:
            d.required_role = "owner"
        return d

    # ------------------------------------------------------------------ ask
    def request(self, domain: str, service: str, entity_id: Any, data: dict | None,
                requester: Person | None, origin_chat: int | None) -> tuple[str, Outgoing | None]:
        """Returns (answer for the model, message to send or None)."""
        policy = self.policy_loader()
        d = self._wrap_check(policy, policy.check_service(domain, service, entity_id, data))
        base = {"domain": domain, "service": service, "entity_id": entity_id, "data": data,
                "requester": requester.telegram_id if requester else None}
        if not d.allowed:
            self.state.log("refused", dict(base, reason=d.reason))
            return f"Refused by the villa's rules: {d.reason}", None
        # ⚠️ `direct` SKIPS THE BUTTON ONLY FOR A PERSON'S OWN REQUEST: a registered
        # person, writing in a chat. A scheduled job, an alert, a skill (no requester)
        # still asks; so does anything an owner-only device hides behind (_wrap_check
        # raised it to "owner").
        if (d.direct and d.required_role == "any" and requester is not None
                and requester.telegram_id in policy.people and origin_chat is not None):
            result = self.execute(d)
            self.state.log("direct", dict(base, by=requester.name, ok=result["ok"]))
            log.info("Direct %s.%s on %s, asked by %s: %s", d.domain, d.service, ", ".join(d.entity_ids),
                     requester.name, result["text"])
            return (f"Executed without approval (this villa's rule for {d.domain}.{d.service} is direct). "
                    f"Result: {result['text']}"), None
        target_chat = Routing(policy).approver_chat(d.required_role, origin_chat)
        if d.required_role == "owner" and not target_chat:
            self.state.log("refused", dict(base, reason="no owner chat configured"))
            return "Refused: no owner chat is configured in policy.yaml.", None
        if not target_chat:
            self.state.log("refused", dict(base, reason="no chat to ask in"))
            return "Refused: no chat to ask in.", None
        text = plain(d, self.names)
        action = {"domain": d.domain, "service": d.service, "entity_ids": d.entity_ids, "data": d.data, "plain": text}
        aid = self.state.new_approval(action, d.action_hash(), d.required_role or "owner", int(target_chat),
                                      requester.telegram_id if requester else None, policy.approval_ttl_minutes)
        who = "the owner" if d.required_role == "owner" else "the owner or the facility manager"
        self.state.log("requested", dict(base, approval=aid, required_role=d.required_role))
        msg = Outgoing(int(target_chat),
                       f"{text}\nOnly {who} can approve. Expires in {policy.approval_ttl_minutes} min.",
                       {"inline_keyboard": [[{"text": "Approve", "callback_data": button_data.make(button_data.APPROVAL, aid, "y")},
                                             {"text": "Refuse", "callback_data": button_data.make(button_data.APPROVAL, aid, "n")}]]}, aid)
        return (f"Approval requested from {who} (buttons sent). Nothing happens until a person approves. "
                f"Do not say it is done."), msg

    # ------------------------------------------------------------------ decide
    def decide(self, aid: str, presser_id: int | None, approve: bool, now: datetime | None = None) -> dict:
        """Returns {'toast': str for the presser only, 'edit': str or None, 'executed': bool}."""
        now = now or datetime.now(timezone.utc)
        policy = self.policy_loader()
        person = policy.person(presser_id)
        ap = self.state.approval(aid)
        if not ap:
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "unknown id"})
            return {"toast": "This request does not exist.", "edit": None, "executed": False}
        if person is None:
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "not a registered person or anonymous"})
            return {"toast": NOT_REGISTERED, "edit": None, "executed": False}
        if ap["status"] != "pending":
            return {"toast": f"Already {ap['status']}.", "edit": None, "executed": False}
        if datetime.fromisoformat(ap["expires_at"]) < now:
            self.state.expire_approval(aid)
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": "expired"})
            return {"toast": "Expired. Ask again.", "edit": f"{ap['action']['plain']}\nExpired, nothing was done.", "executed": False}
        if not policy.role_can_approve(person.role, ap["required_role"]):
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": f"role {person.role}"})
            return {"toast": "Only the owner can approve this." if ap["required_role"] == "owner" else "You cannot approve this.",
                    "edit": None, "executed": False}
        act = ap["action"]
        stamp = datetime.now().astimezone().strftime("%H:%M")
        if not approve:
            if self.state.claim_approval(aid, "refused", person.telegram_id, now):
                self.state.log("refused_by_person", {"approval": aid, "by": person.name})
                return {"toast": "Refused.", "edit": f"{act['plain']}\nRefused by {person.name} at {stamp}. Nothing was done.",
                        "executed": False}
            return {"toast": "Already decided.", "edit": None, "executed": False}
        # the policy may have changed since the request: check again, and the action must be the one approved
        d = self._wrap_check(policy, policy.check_service(act["domain"], act["service"], act["entity_ids"], act["data"]))
        if not d.allowed or d.action_hash() != ap["action_hash"] or \
                action_hash(act["domain"], act["service"], act["entity_ids"], act["data"]) != ap["action_hash"]:
            self.state.claim_approval(aid, "failed", person.telegram_id, now)
            self.state.log("press_refused", {"approval": aid, "by": presser_id, "reason": d.reason or "action changed"})
            return {"toast": "Refused by the villa's rules.", "edit": f"{act['plain']}\nNo longer allowed: {d.reason or 'the action changed'}.",
                    "executed": False}
        if not policy.role_can_approve(person.role, d.required_role):
            return {"toast": "Only the owner can approve this.", "edit": None, "executed": False}
        if not self.state.claim_approval(aid, "approved", person.telegram_id, now):
            return {"toast": "Already decided.", "edit": None, "executed": False}
        self.state.log("approved", {"approval": aid, "by": person.name, "role": person.role})
        result = self.execute(d)
        self.state.finish_approval(aid, "done" if result["ok"] else "failed", result)
        edit = f"{act['plain']}\nApproved by {person.name} at {stamp}. {result['text']}"
        return {"toast": "Done." if result["ok"] else "Sent, not confirmed.", "edit": edit, "executed": True,
                "result": result}

    # ------------------------------------------------------------------ execute
    def execute(self, d: Decision) -> dict:
        writer = self.writer_factory()
        data = dict(d.data)
        if d.entity_ids:
            data["entity_id"] = list(d.entity_ids)     # always a list: no comma-joined string reaches Home Assistant
        try:
            writer.call_service(d.domain, d.service, data)
        except Exception as e:  # noqa: BLE001
            self.state.log("failed", {"domain": d.domain, "service": d.service, "entities": d.entity_ids, "error": str(e)[:300]})
            log.warning("Approved %s.%s on %s failed: %s", d.domain, d.service, ", ".join(d.entity_ids) or "-", str(e)[:300])
            return {"ok": False, "text": f"Home Assistant refused or failed ({type(e).__name__}). Nothing confirmed."}
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
        return {"ok": False, "text": "Not confirmed: " + ", ".join(f"{self.names(e)} reads {s}" for e, s in bad) + ". I will not retry by myself."}

    # ------------------------------------------------------------------ system
    def system(self, domain: str, service: str, entity_id: str, data: dict | None = None) -> bool:
        """A call the code makes for itself (the agent's heartbeat helper). Listed in policy.system_actions only."""
        policy = self.policy_loader()
        d = policy.check_service(domain, service, entity_id, data, system=True)
        if not d.allowed:
            self.state.log("refused", {"system": True, "domain": domain, "service": service, "entity": entity_id, "reason": d.reason})
            return False
        try:
            self.writer_factory().call_service(domain, service, dict(d.data, entity_id=entity_id))
            self.state.log("executed", {"system": True, "domain": domain, "service": service, "entity": entity_id})
            return True
        except Exception as e:  # noqa: BLE001
            self.state.log("failed", {"system": True, "domain": domain, "service": service, "error": str(e)[:200]})
            return False
