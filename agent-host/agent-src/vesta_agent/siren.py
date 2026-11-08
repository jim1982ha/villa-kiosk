"""The siren, its whole life in one place: when VESTA asks for it, how (pictures first), when the request is withdrawn,
who hears of an intrusion when it cannot be asked, and its automatic stop.

  always_owners(owner_only, siren)   what only the owner may approve: the siren always (policy.owners_alone asks it)
  Request.gate(siren_gate, …)        a script's gate (vesta_shared.result.siren) carried out (outcome.Outcome hands it)
  withdrawn_now(action, occupied)    a request asked while the villa was empty, someone in it now: withdrawn (at the
                                     press, actions.decide; at every pass, approvals.expire)
  Siren.executed / tick / watch      whatever turned it on, it stops by itself after the villa's minutes

⚠️ THE OWNER'S RULE (owner, 2026-10-31: "a guarantee that VESTA never turns the siren on without asking"): VESTA never
sounds the siren itself, it only ASKS the owner (an Approve press); never asks while someone is in the villa; and a
request already waiting is withdrawn the moment someone is. tests/test_siren_request.py proves each on this module.

⚠️ ONE PLACE (architecture review round 13, card 5, 2026-11-01): "should VESTA ask for the siren now, and how" was
answered in pieces by five parts of the program — 31 Oct 00:19, arriving home, the owner was asked to sound the siren on
himself and told "Look at the snapshot" with no snapshot; the fix touched five places.

⚠️ ONE OWNER FOR A SAFETY DEVICE (architecture review 6, 2026-10-07). The stop was scheduled only after an Approve
press (app.handle_callback → after_execution): a villa whose rules run the siren's turn_on `direct` turned it on
with no stop at all; and the stop was a bare timer in memory, which a restart forgot. Now every execution goes past
`executed` (actions.py calls it), which records WHEN it must stop (state.py); `watch` stops it at that time — a
restart reads the time back.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from vesta_shared.message_format import ROLES
from vesta_shared.messaging import SIREN_TITLE

log = logging.getLogger("vesta")
CHECK_EVERY_S = 5.0

#: The mark of a request asked only while the villa is empty (the siren's request, Request.gate): withdrawn once
#: someone is in it, at the press and at every pass (withdrawn_now).
WHILE_EMPTY = "while_empty"


def always_owners(owner_only: set[str], siren_entity: str | None) -> set[str]:
    """What only the owner may approve: the owner-only list, and the configured siren whatever that list says.

    ⚠️ THE SIREN IS ALWAYS ASKED, AND ALWAYS THE OWNER'S (owner, 2026-10-31): a villa whose switch.turn_on was "direct",
    the siren not in owner_only_entities, turned it on at a registered person's word with no Approve; an "any" rule let
    the facility manager approve it."""
    return set(owner_only) | ({siren_entity} if siren_entity else set())


def withdrawn_now(action: dict, occupied: Callable[[], bool]) -> bool:
    """A request asked only while the villa is empty (WHILE_EMPTY) with someone in it now: withdrawn, never sounded.
    `occupied` is read only for such a request.

    ⚠️ NEVER ON AN APPROVE PRESSED AFTER SOMEONE CAME HOME (owner's Telegram, 2026-10-31 00:19): the siren was asked on
    the villa as it read at the alert — the owner arriving home, the "empty" sensor off 3 seconds later; the request
    stayed pressable for 15 minutes."""
    return bool((action or {}).get(WHILE_EMPTY)) and bool(occupied())


class Request:
    """The siren's request for an intrusion (a script's `siren_gate`), start to end. `actions`: actions.Actions (who is
    home, the request itself); `ask`: approvals.Approvals.ask; `post`: posting.Poster.post (the warning).

    ⚠️ ONE STORY, NO PICTURE MESSAGES (owner, 2026-11-07: "delete every redundant old piece"): the presence guard's
    alerts are visits now, and only a visit offers the siren (the alert desk's visit_siren); its pictures go into the
    visit's sheet. The "Camera snapshot" messages sent before a request of the old alerts went with them."""

    def __init__(self, *, policy: Callable, state, actions, ask: Callable[..., Awaitable[int]] | None,
                 post: Callable[..., Awaitable], visits=None):
        self.policy, self.state, self.actions, self.ask = policy, state, actions, ask
        self.post = post
        # visit.Visits: a visit's request is part of its one story (its card, its sheet, a line of its Status)
        self.visits = visits

    async def gate(self, gate: dict, origin=None, rang=()) -> dict:
        """Carry out a script's gate: {asked: bool, why: what kept it from being asked ("" when asked), warned: the
        chats told of the intrusion by the warning itself}. An unarmed gate does nothing. `rang`: the chats where this
        result just sent the visit's card again (it rang there already: the question is put on it quietly)."""
        out = {"asked": False, "why": "", "warned": set()}
        prompt = gate.get("prompt") if isinstance(gate, dict) and gate.get("armed") else None
        if not prompt:
            return out
        siren = self.policy().siren_entity
        if not siren:
            # no siren to ask for: the warning itself goes to the gate's people (it was dropped before, 0.12.80)
            out["why"] = "no siren is chosen"
            out["warned"] = await self._warn(gate, origin, "")
            return out
        if await asyncio.to_thread(self.actions.occupied):
            # ⚠️ READ AGAIN JUST BEFORE ASKING (owner's Telegram, 2026-10-31 00:19): the desk read the villa empty at the
            # alert; someone in it now, the siren is not asked — the alerts themselves went as usual
            self.state.log("siren_not_asked", {"reason": "someone came home"})
            log.info("The siren was not asked: someone is home")
            out["why"] = "someone is home"
            return out
        # its own domain's turn_on (a switch or a siren entity: policy.SIREN_DOMAINS), never run here: only ASKED, of the
        # owner (always_owners), and only while the villa is empty (WHILE_EMPTY: withdrawn once someone is in it)
        answer, msg = await asyncio.to_thread(self.actions.request, siren.split(".")[0], "turn_on", siren, {}, None,
                                              None, True)
        if msg and self.ask is None:
            answer, msg = "no way to ask for an approval here (built without the approvals)", None
        head = prompt
        visit = int(gate["visit"]) if str(gate.get("visit") or "").isdigit() and self.visits is not None else None
        replies: dict[int, int] = {}
        if msg and visit is not None:
            # ⚠️ A VISIT'S REQUEST IS PART OF ITS ONE STORY (owner, 2026-11-06, 18:35: six "Camera snapshot" messages, then
            # the request, beside the visit's card): the cameras that showed nothing lately go into the visit's sheet
            await self.visits.snap(visit, gate.get("cameras"))
            replies = {c: m for c in msg.chats if (m := self.visits.card(visit, c))}
            if msg.chats and set(replies) >= set(msg.chats) and isinstance(gate.get("buttons"), dict):
                # ⚠️ THE QUESTION ON THE ALERT ITSELF (owner, 2026-11-08, visit #154: the card, then a separate "Approval
                # request" replying to it, each ringing): every owner chat shows the visit's card, so the question is
                # two buttons on it there (visit.Visits.offered) — the approval itself unchanged: only an owner's own
                # press on it sounds the siren (actions.decide), silence or expiry never; a facility manager's copy and
                # the tablet never carry it
                await self.visits.offered(visit, msg.approval_id, str(gate.get("offered") or ""),
                                          gate.get("offered_in") if isinstance(gate.get("offered_in"), dict) else None,
                                          chats=list(msg.chats), buttons=gate["buttons"],
                                          waiting=str(gate.get("waiting") or ""),
                                          waiting_in=gate.get("waiting_in") if isinstance(gate.get("waiting_in"), dict)
                                          else None, rang=set(rang))
                out["asked"] = True
                return out
            # a chat of the owner's without the visit's card: the question a message of its own, a reply to the card
            # where there is one
            if gate.get("seen") and msg.chats and set(replies) >= set(msg.chats):
                head = f"{prompt} {gate['seen']}"
        # ⚠️ THE INTRUSION IS SAID, WHATEVER BECOMES OF THE REQUEST (architecture review 21): its words travel only as
        # the siren request's lead — a request no owner chat received showed them nowhere
        if msg and not await self.ask(msg, head=head, origin=origin, **({"reply_to": replies} if replies else {})):
            answer, msg = "no chat of the owner's received the request", None
        if msg:
            out["asked"] = True
            if visit is not None:
                await self.visits.offered(visit, msg.approval_id, str(gate.get("offered") or ""),
                                          gate.get("offered_in") if isinstance(gate.get("offered_in"), dict) else None)
            return out
        out["why"] = answer
        out["warned"] = await self._warn(gate, origin, f"The siren cannot be requested: {answer}")
        return out

    async def _warn(self, gate: dict, origin, said: str) -> set[int]:
        """The intrusion warning itself, when the siren cannot be asked (none chosen, or the request reached nobody), in
        every chat of the gate's people (`to`, the skill's word: the owner and the facility manager), each chat once
        with the roles it is for. `said`: why the siren is not asked (its status), "" with no siren chosen.

        ⚠️ ONE ANSWER TO "WHO HEARS OF IT" (architecture review round 13, card 5): with no siren chosen the warning went
        to the owner and the facility manager; with a siren chosen but its request unsendable, to the owner only (the
        facility manager only when no owner chat took it) — the same intrusion told to different people."""
        from .routing import Routing
        route = Routing(self.policy())
        chats: dict[int, set[str]] = {}
        for role in [r for r in (gate.get("to") or ("owner",)) if r in ROLES]:
            for chat in route.target(role, origin):
                chats.setdefault(int(chat), set()).add(role)
        told: set[int] = set()
        for chat, roles in chats.items():
            if await self.post(chat, gate["prompt"], status=said, roles=roles, origin=origin,
                               title=SIREN_TITLE if said else None,
                               keep=True if not (origin and getattr(origin, "holds", False)) else None):
                told.add(chat)
        if not told:
            self.state.log("siren_warning_unsent", {"to": list(gate.get("to") or ("owner",))})
            log.warning("The intrusion warning reached no chat (%s)", said or "no siren chosen")
        return told


class Siren:
    def __init__(self, policy: Callable, state, actions, tell_owner: Callable[[str], Awaitable[None]]):
        self.policy, self.state, self.actions, self.tell_owner = policy, state, actions, tell_owner

    def executed(self, domain: str, service: str, entity_ids: list[str], now: datetime | None = None) -> None:
        """Any execution on the villa (actions.py): when it turned the configured siren on, its stop is due in the
        villa's minutes. Recorded whether or not the read-back confirmed it: a stop of a silent siren costs nothing."""
        pol = self.policy()
        if not pol.siren_entity or service != "turn_on" or domain != pol.siren_entity.split(".")[0] \
                or pol.siren_entity not in (entity_ids or []):
            return
        at = (now or datetime.now(timezone.utc)) + timedelta(minutes=pol.siren_auto_off_min)
        self.state.set_siren_stop(at.isoformat(), pol.siren_entity)
        log.info("Siren on: it stops by itself at %s (%s min)", at.isoformat(timespec="seconds"), pol.siren_auto_off_min)

    async def tick(self, now: datetime | None = None) -> bool:
        """Stop the siren if its time has come; True when it was due."""
        due = self.state.siren_stop()
        if not due or datetime.fromisoformat(due) > (now or datetime.now(timezone.utc)):
            return False
        # ⚠️ THE RULES READ BEFORE THE STOP IS FORGOTTEN (architecture review 17): cleared first, a reading that failed
        # lost it for good — the siren was never switched off, even after a restart
        pol = self.policy()
        # ⚠️ THE SIREN THAT WAS TURNED ON (architecture review 18): the rules' siren may have changed since, or the rules
        # may not have been readable — the stop is for the one that sounds
        entity = self.state.siren_stopping() or pol.siren_entity
        self.state.set_siren_stop(None)
        if not entity:
            return True
        ok = await asyncio.to_thread(self.actions.system, entity.split(".")[0], "turn_off", entity, siren=entity)
        await self.tell_owner("Siren switched off." if ok else "The siren could not be switched off: check it now.")
        return True

    async def watch(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 — a failed check is tried again at the next one
                log.exception("siren check failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=CHECK_EVERY_S)
            except asyncio.TimeoutError:
                pass
