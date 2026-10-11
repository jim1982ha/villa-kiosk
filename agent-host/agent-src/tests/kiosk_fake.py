"""The in-memory stand-in for vesta_agent.kiosk.Kiosk: the VESTA Kiosk's Facility records, as the agent uses them.

One stand-in (architecture review, 2026-10-07): two near-identical ones recorded tickets differently. Held to the
real Kiosk's methods and parameters by tests/test_fakes.py.

    tickets   [(title, entity_id)]   ids t1, t2 …     notes   [note], in the same order     resolved   [ticket id]
    reopened  [(ticket id, title)]   a resolved ticket open again (its problem came back)
    closed_by_hand   ids a person resolved in the Kiosk itself     known   ids the Kiosk has from before
    titles    {ticket id: title} as the Kiosk shows it — a test sets one to play a person renaming it
    agent_titles   {ticket id: title} the agent last gave it        readings   [(ticket id, title)] under a person's title
"""
from __future__ import annotations


class FakeKiosk:
    enabled = True

    def __init__(self):
        self.tickets, self.notes, self.resolved, self.reopened = [], [], [], []
        self.closed_by_hand, self.known = set(), set()
        self.titles: dict[str, str] = {}             # a ticket's title as it is now (update_ticket changes it)
        self.agent_titles: dict[str, str] = {}       # the title the agent last gave it (Kiosk.agent_title)
        self.readings: list[tuple[str, str]] = []    # the agent's readings under a title a person wrote
        self.closed_meta: dict[str, dict] = {}       # a ticket closed by hand: {by, resolved_at}, as the Kiosk records it
        self.info = {"contract": 1}

    async def check(self) -> bool:
        return True

    async def heartbeat(self, status=None) -> None:
        pass

    async def heartbeats(self, stop, status=lambda: None) -> None:
        await stop.wait()

    async def add_ticket(self, title, entity_id=None, note=None) -> str:
        self.tickets.append((title, entity_id))
        self.notes.append(note)
        self.titles[f"t{len(self.tickets)}"] = self.agent_titles[f"t{len(self.tickets)}"] = title
        return f"t{len(self.tickets)}"

    async def resolve_ticket(self, tid, note=None) -> bool:
        self.resolved.append(tid)
        return True

    async def reopen_ticket(self, tid, title, note=None) -> bool:
        if tid in self.resolved:
            self.resolved.remove(tid)
        self.closed_by_hand.discard(tid)
        self.reopened.append((tid, title))
        if not self._person_titled(tid):
            self.titles[tid] = title
        self.agent_titles[tid] = title
        return True

    def _person_titled(self, tid) -> bool:
        return tid in self.agent_titles and self.titles.get(tid) != self.agent_titles[tid]

    async def held_tickets(self) -> dict[str, dict]:
        return {t: {"status": s, "title": self.titles.get(t, ""), "agent_title": self.agent_titles.get(t),
                    "resolved_at": "", "by": "", **self.closed_meta.get(t, {})}
                for t, s in (await self.ticket_states()).items()}

    async def update_ticket(self, tid, title) -> bool:
        if tid not in self.titles or self.agent_titles.get(tid, self.titles[tid]) == title[:200] or tid in self.resolved:
            return False
        if self._person_titled(tid):
            self.readings.append((tid, title[:200]))
        else:
            self.titles[tid] = title[:200]
        self.agent_titles[tid] = title[:200]
        return True

    async def ticket_states(self) -> dict[str, str]:
        ids = [f"t{i + 1}" for i in range(len(self.tickets))] + sorted(self.known)
        return {t: "resolved" if t in self.resolved or t in self.closed_by_hand else "open" for t in ids}
