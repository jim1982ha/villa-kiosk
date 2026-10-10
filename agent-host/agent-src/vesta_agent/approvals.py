"""An approval request from start to end: asked, shown in every chat it is for, decided by a press, its device followed
until it gets there, expired when nobody answers — and what the AI is told of all that before it answers.

⚠️ ONE HOME (architecture review 19, 2026-10-10). The request's life was spread over seven modules (actions, outcome, app,
tools, incident_thread, state, the AI's prompt), and the day's defects all sat between them: a curtain still moving was
recorded "failed" while its message said "Opened" — and the AI then said it had failed; a follow-up lost at a restart
left "Opening…" for good; an expired request kept its buttons for days; the AI saw only two hours of requests when one
may wait 24. Here one record (state.approvals, its status: pending → moving → done / failed, refused, expired) decides
what every copy says and what the AI is told. actions.py keeps the rules (may this be asked, may this person approve)
and the call to Home Assistant; incident_thread.py keeps the copies; layout.py how they read.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from .notice import when
from .policy import Decision

log = logging.getLogger("vesta.approvals")

#: A device still on its way after an approval (a curtain says "closed" until it has finished moving): looked at this
#: often, for this long; then the request says done or not done. A restart takes it up again (resume).
FOLLOW_EVERY_S, FOLLOW_FOR_S = 5, 90
#: How far back the AI is told of decided requests (the waiting ones, whatever their age, until they expire).
DECIDED_FOR = timedelta(hours=2)

_APPROVED = "Approved by {by} on {time}."
#: ⚠️ ONE TABLE OF A REQUEST'S STATES (architecture review 20, 21): their words were written in four places and "failed"
#: meant three things — the villa's rules refused it at the press (nothing tried), Home Assistant refused it, or the device
#: never got there — told to the AI as "failed by JM"; then the notes under the request were still written in actions.py
#: and here, twice each. state → (what the AI is told, after "by <name> on <time>"; the press's toast when it comes after
#: this state; the note every copy shows under its line — `note()`).
STATES: dict[str, tuple[str, str, str]] = {
    "pending": ("waiting for approval", "Still waiting.", ""),
    "approved": ("approved, its result not recorded yet", "Already approved.", _APPROVED),
    "moving": ("approved; the device was still on its way", "Already approved: on its way.", _APPROVED),
    "done": ("approved, and done", "Already approved and done.", _APPROVED),
    "failed": ("approved, but it did not happen", "Already approved; it did not happen.", _APPROVED),
    "blocked": ("pressed, but the villa's rules no longer allowed it: nothing was tried", "No longer allowed.",
                "No longer allowed: {why}."),
    "refused": ("refused", "Already refused.", "Refused by {by} on {time}. Nothing was done."),
    "expired": ("expired: nobody answered in time", "Expired. Ask again.", "Expired on {time}: nothing was done."),
    "unknown": ("approved; the agent restarted before it could see the result", "Already approved.", _APPROVED),
    # nobody received it (architecture review 21): never "waiting" — no chat had its buttons
    "undelivered": ("never delivered: no chat received it, nothing is waiting", "Never delivered.", ""),
}


def note(state: str, by: str = "", why: str = "", time: str = "{time}") -> str:
    """What every copy of a request says under its line once it is in `state` ("{time}": now, filled when shown)."""
    return STATES[state][2].format(by=by or "someone", why=why or "the villa's rules changed", time=time)


def toast(state: str) -> str:
    """The press's answer when the request is already in `state`."""
    return STATES.get(state, ("", f"Already {state}.", ""))[1]


def approval_thread(approval_id: str) -> str:
    """The thread of an approval request: its copies in every chat it was sent to, settled together by a press, as an
    incident's are (owner, 2026-10-10: one mechanism for every message that has copies in several chats)."""
    return f"approval-{approval_id}"


class Approvals:
    def __init__(self, *, state, policy: Callable, actions, thread, post: Callable[..., Awaitable], timezone_name: str,
                 safe: Callable[[Awaitable], Awaitable]):
        self.state, self.policy, self.actions, self.thread = state, policy, actions, thread
        self.post = post                # posting.Poster.post: the one way a message is put in a chat
        self.tz, self._safe = timezone_name, safe
        # a request "approved" before this moment, still without its outcome, was cut by a stop (resume)
        self.started = datetime.now(timezone.utc)
        self._watching: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ asked and shown
    async def ask(self, msg, head: str = "", origin=None) -> int:
        """An approval request (actions.request's Outgoing) in every chat it is for, each copy one message of the same
        thread: a press in one settles them all. `head`: why it is asked (the intrusion), kept when the body changes.
        Returns how many chats have it.

        ⚠️ NONE IS "UNDELIVERED", NEVER "WAITING" (architecture review 21): recorded pending before the sends, a request
        no chat received was told to the AI as waiting until it expired — "it is waiting for your approval", no button
        anywhere.

        ⚠️ THE ALERTS' MECHANISM, NOT A SECOND ONE (owner, 2026-10-10): its copies are kept and settled as an incident's
        are (incident_thread.py), under the heading every message of the agent's carries — in the asking chat too."""
        n = 0
        for chat in msg.chats:
            if await self.post(chat, msg.text, status=msg.status, lead=head, roles={msg.to} if msg.to else (),
                               keyboard=msg.keyboard, thread=approval_thread(msg.approval_id), origin=origin):
                n += 1
        if not n:
            self.state.undeliver_approval(msg.approval_id)
            log.warning("approval %s: no chat received it", msg.approval_id)
        return n

    def shown_in(self, approval_ids, chat: int) -> bool:
        """Is one of these requests shown in `chat`? Then it is the answer there (app._converse sends no other)."""
        return any(int(chat) in self.thread.shown(approval_thread(a)) for a in approval_ids)

    # ------------------------------------------------------------------ a press
    async def press(self, p) -> None:
        """Approve / Refuse pressed (app's Press): the person's rights and the rules are checked again (actions.decide),
        every copy says what was decided, by whom and when, and a device still moving is followed."""
        aid, yn = p.parts
        ap = self.state.approval(aid)
        key = approval_thread(aid)
        if ap and ap["chat_id"] != p.chat and p.chat not in self.thread.shown(key):
            self.state.log("press_refused", {"approval": aid, "by": p.presser, "reason": "button pressed from another chat"})
            return await p.toast("This button belongs to another chat.")
        out = await asyncio.to_thread(self.actions.decide, aid, p.presser, yn == "y", chat=p.chat,
                                      name=p.q.get("from_first"))
        await p.toast(out["toast"])
        if not out.get("state"):
            return
        if p.mid and p.chat not in self.thread.shown(key):
            # a request sent before 0.12.128 has no thread: the pressed message is its one copy
            from .layout import legacy
            await self.thread.post(key, p.chat, int(p.mid), legacy(str(p.msg.get("text") or "")), buttons=True)
        await self.thread.close(key, note(out["state"], out.get("by", ""), out.get("why", "")), out.get("body"))
        if out.get("follow"):
            self._watch(aid, out["follow"])

    # ------------------------------------------------------------------ a device still on its way
    def _watch(self, aid: str, decision: Decision) -> None:
        task = asyncio.create_task(self._safe(self._follow(aid, decision)))
        self._watching.add(task)
        task.add_done_callback(self._watching.discard)

    async def idle(self) -> None:
        """Until every device being followed has its verdict (tests, a clean stop)."""
        while self._watching:
            await asyncio.gather(*list(self._watching))

    async def _follow(self, aid: str, decision: Decision) -> None:
        """Read the device again until it gets there (or FOLLOW_FOR_S passes); then the record and every copy say the same
        thing: done, or not done."""
        waited = 0.0
        while waited < FOLLOW_FOR_S:
            await asyncio.sleep(FOLLOW_EVERY_S)
            waited += FOLLOW_EVERY_S
            body = await asyncio.to_thread(self.actions.recheck, decision)
            if body:
                return await self._settle(aid, "done", body)
        await self._settle(aid, "failed", await asyncio.to_thread(self.actions.recheck, decision, True))

    async def _settle(self, aid: str, status: str, body: str) -> None:
        # ⚠️ ONE VERDICT (architecture review 19): the record said "failed" at the first reading while the message,
        # rewritten later, said "Opened" — and the AI, reading the record, told the owner it had failed
        self.state.finish_approval(aid, status, {"ok": status == "done", "text": body})
        await self.thread.rewrite(approval_thread(aid), body)

    async def resume(self) -> None:
        """At start: a request still "moving" (its device was being followed when the agent stopped) is followed again —
        never left saying "Opening…" for good; one "approved" before this start with no outcome (the agent stopped while
        carrying it out) is ended by reading its device now, or said unknown (architecture review 20); one decided whose
        copies still carry their buttons says so in every chat.

        ⚠️ WHENEVER IT WAS APPROVED (architecture review 21): only a request approved more than 2 minutes before was
        ended — one approved in the seconds before an update came back 40 s later, under that limit, and nothing looks
        again: its buttons stayed for good. Before this start, no one can still be carrying it out."""
        for ap in self.state.approvals_in("moving"):
            self._watch(ap["id"], self._decision(ap))
        for ap in self.state.approvals_in("approved"):
            if ap.get("decided_at") and datetime.fromisoformat(ap["decided_at"]) < self.started:
                # its copies may still carry the buttons (the press stopped before them): who approved it, and what is
                # known now — the device in the state asked for is done, anything else is said unknown, never "failed"
                body = await asyncio.to_thread(self.actions.recheck, self._decision(ap))
                status = "done" if body else "unknown"
                said = body or "The agent restarted before it could see the result: check the device."
                self.state.finish_approval(ap["id"], status, {"ok": bool(body), "text": said})
                await self.thread.close(approval_thread(ap["id"]),
                                        note(status, ap.get("decided_name"), time=self._at(ap["decided_at"])), said)
        # decided, but stopped before its copies said so (the press's own task cut by the stop): they say it now, their
        # buttons gone — a copy already settled is left as it is (IncidentThread.close)
        for ap in self.state.approvals_decided_since((self.started - timedelta(days=1)).isoformat()):
            if ap["status"] in ("approved", "moving", "undelivered") or not ap.get("decided_at"):
                continue
            key = approval_thread(ap["id"])
            if any(r.get("buttons") and not r.get("settled") for r in self.thread.shown(key).values()):
                await self.thread.close(key, note(ap["status"], ap.get("decided_name"), time=self._at(ap["decided_at"])))

    @staticmethod
    def _decision(ap: dict) -> Decision:
        a = ap["action"]
        return Decision(True, "", ap["required_role"], a.get("domain", ""), a.get("service", ""),
                        list(a.get("entity_ids") or []), dict(a.get("data") or {}))

    # ------------------------------------------------------------------ nobody answered
    async def expire(self, now: datetime | None = None) -> int:
        """Every request past its time that nobody answered says so, in every chat, and loses its buttons (before, only a
        press after the time did: a request kept "Waiting for approval" and its buttons for days). Only an expiry that was
        recorded is announced: a press that claimed the request first keeps its own outcome. Returns how many."""
        now = now or datetime.now(timezone.utc)
        n = 0
        for ap in self.state.approvals_in("pending"):
            if datetime.fromisoformat(ap["expires_at"]) <= now and self.state.expire_approval(ap["id"]):
                await self.thread.close(approval_thread(ap["id"]), note("expired"))
                n += 1
        return n

    # ------------------------------------------------------------------ what the AI is told
    def now(self, now: datetime | None = None) -> str:
        """The requests as they stand now, for the AI before it answers: every one still waiting, whatever its age, and
        those DECIDED in the last two hours, whenever they were asked — what became of each, by whom, when.

        ⚠️ NEVER FROM ITS MEMORY (owner, 2026-10-10): asked again for the curtain, the AI answered "Approval request already
        sent 22 min ago" — it remembered asking, never learnt it had been approved. A press goes to the agent, not to the
        conversation: the agent says what is waiting and what was decided (review 20: by the decision's time — a request
        asked three hours before and approved now was in neither list)."""
        now = now or datetime.now(timezone.utc)
        waiting = [a for a in self.state.approvals_in("pending") if datetime.fromisoformat(a["expires_at"]) > now]
        decided = self.state.approvals_decided_since((now - DECIDED_FOR).isoformat())[:5]
        lines = [f"- waiting: {a['action'].get('plain', '?')} (asked {self._at(a['created_at'])})" for a in waiting] \
            or ["- nothing is waiting for approval"]
        for a in decided:
            words = STATES.get(a["status"], (a["status"], ""))[0]
            who = [f"by {a['decided_name']}"] if a.get("decided_name") and a["status"] != "expired" else []
            when_ = [f"on {self._at(a['decided_at'])}"] if a.get("decided_at") else []
            lines.append(f"- {a['action'].get('plain', '?')} — {words} ({' '.join(who + when_)})")
        return ("[Requests for approval, checked just now; answer from this, never from memory. An action asked now is "
                "a new request: call ha_call_service for it, whatever was asked before]\n" + "\n".join(lines))

    def _at(self, iso: str) -> str:
        return when(datetime.fromisoformat(iso), self.tz)
