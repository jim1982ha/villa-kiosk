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

from .incident_thread import approval_thread
from .notice import when
from .policy import Decision

log = logging.getLogger("vesta.approvals")

#: A device still on its way after an approval (a curtain says "closed" until it has finished moving): looked at this
#: often, for this long; then the request says done or not done. A restart takes it up again (resume).
FOLLOW_EVERY_S, FOLLOW_FOR_S = 5, 90
#: How far back the AI is told of decided requests (the waiting ones, whatever their age, until they expire).
DECIDED_FOR = timedelta(hours=2)
EXPIRED = "Expired on {time}: nothing was done."


class Approvals:
    def __init__(self, *, state, policy: Callable, actions, thread, post: Callable[..., Awaitable], timezone_name: str,
                 safe: Callable[[Awaitable], Awaitable]):
        self.state, self.policy, self.actions, self.thread = state, policy, actions, thread
        self.post = post                # outcome.Outcome._post: the one way a message is put in a chat
        self.tz, self._safe = timezone_name, safe
        self._watching: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ asked and shown
    async def ask(self, msg, head: str = "", origin=None) -> int:
        """An approval request (actions.request's Outgoing) in every chat it is for, each copy one message of the same
        thread: a press in one settles them all. `head`: why it is asked (the intrusion), kept when the body changes.
        Returns how many chats have it.

        ⚠️ THE ALERTS' MECHANISM, NOT A SECOND ONE (owner, 2026-10-10): its copies are kept and settled as an incident's
        are (incident_thread.py), under the heading every message of the agent's carries — in the asking chat too."""
        n = 0
        for chat in msg.chats:
            if await self.post(chat, msg.text, status=msg.status, lead=head, roles={msg.to} if msg.to else (),
                               keyboard=msg.keyboard, thread=approval_thread(msg.approval_id), origin=origin):
                n += 1
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
        if not out.get("note"):
            return
        if p.mid and p.chat not in self.thread.shown(key):
            # a request sent before 0.12.128 has no thread: the pressed message is its one copy
            from .layout import legacy
            await self.thread.post(key, p.chat, int(p.mid), legacy(str(p.msg.get("text") or "")), buttons=True)
        await self.thread.close(key, out["note"], out.get("body"))
        if out.get("follow"):
            self._watch(aid, out["follow"])

    # ------------------------------------------------------------------ a device still on its way
    def _watch(self, aid: str, decision: Decision) -> None:
        task = asyncio.create_task(self._safe(self._follow(aid, decision)))
        self._watching.add(task)
        task.add_done_callback(self._watching.discard)

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
        """At start: every request still "moving" (its device was being followed when the agent stopped) is followed
        again — never left saying "Opening…" for good."""
        for ap in self.state.approvals_in("moving"):
            a = ap["action"]
            self._watch(ap["id"], Decision(True, "", ap["required_role"], a.get("domain", ""), a.get("service", ""),
                                           list(a.get("entity_ids") or []), dict(a.get("data") or {})))

    # ------------------------------------------------------------------ nobody answered
    async def expire(self, now: datetime | None = None) -> int:
        """Every request past its time that nobody answered says so, in every chat, and loses its buttons (before, only a
        press after the time did: a request kept "Waiting for approval" and its buttons for days). Returns how many."""
        now = now or datetime.now(timezone.utc)
        n = 0
        for ap in self.state.approvals_in("pending"):
            if datetime.fromisoformat(ap["expires_at"]) <= now:
                self.state.expire_approval(ap["id"])
                await self.thread.close(approval_thread(ap["id"]), EXPIRED)
                n += 1
        return n

    # ------------------------------------------------------------------ what the AI is told
    def now(self, now: datetime | None = None) -> str:
        """The requests as they stand now, for the AI before it answers: every one still waiting, whatever its age, and
        the ones decided lately — by whom, when — as the messages say them.

        ⚠️ NEVER FROM ITS MEMORY (owner, 2026-10-10): asked again for the curtain, the AI answered "Approval request already
        sent 22 min ago" — it remembered asking, never learnt it had been approved. A press goes to the agent, not to the
        conversation: the agent says what is waiting and what was decided."""
        now = now or datetime.now(timezone.utc)
        waiting = [a for a in self.state.approvals_in("pending") if datetime.fromisoformat(a["expires_at"]) > now]
        decided = [a for a in self.state.approvals_since((now - DECIDED_FOR).isoformat()) if a["status"] != "pending"][:5]
        lines = [f"- waiting: {a['action'].get('plain', '?')} (asked {self._at(a['created_at'])})" for a in waiting] \
            or ["- nothing is waiting for approval"]
        words = {"moving": "approved, the device still on its way", "approved": "approved"}
        for a in decided:
            by = f" by {a['decided_name']}" if a.get("decided_name") else ""
            at = f" on {self._at(a['decided_at'])}" if a.get("decided_at") else ""
            lines.append(f"- {words.get(a['status'], a['status'])}{by}{at}: {a['action'].get('plain', '?')}")
        return ("[Requests for approval, checked just now; answer from this, never from memory. An action asked now is "
                "a new request: call ha_call_service for it, whatever was asked before]\n" + "\n".join(lines))

    def _at(self, iso: str) -> str:
        return when(datetime.fromisoformat(iso), self.tz)
