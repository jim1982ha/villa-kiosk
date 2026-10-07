"""The in-memory stand-in for vesta_agent.kiosk.Kiosk: the VESTA Kiosk's Facility records, as the agent uses them.

One stand-in (architecture review, 2026-10-07): two near-identical ones recorded tickets differently. Held to the
real Kiosk's methods and parameters by tests/test_fakes.py.

    tickets   [(title, entity_id)]   ids t1, t2 …     notes   [note], in the same order     resolved   [ticket id]
    closed_by_hand   ids a person resolved in the Kiosk itself     known   ids the Kiosk has from before
"""
from __future__ import annotations


class FakeKiosk:
    enabled = True

    def __init__(self):
        self.tickets, self.notes, self.resolved = [], [], []
        self.closed_by_hand, self.known = set(), set()
        self.titles: dict[str, str] = {}             # a ticket's title as it is now (update_ticket changes it)
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
        self.titles[f"t{len(self.tickets)}"] = title
        return f"t{len(self.tickets)}"

    async def resolve_ticket(self, tid, note=None) -> bool:
        self.resolved.append(tid)
        return True

    async def held_tickets(self) -> dict[str, dict]:
        return {t: {"status": s, "title": self.titles.get(t, "")} for t, s in (await self.ticket_states()).items()}

    async def update_ticket(self, tid, title) -> bool:
        if tid not in self.titles or self.titles[tid] == title[:200] or tid in self.resolved:
            return False
        self.titles[tid] = title[:200]
        return True

    async def ticket_states(self) -> dict[str, str]:
        ids = [f"t{i + 1}" for i in range(len(self.tickets))] + sorted(self.known)
        return {t: "resolved" if t in self.resolved or t in self.closed_by_hand else "open" for t in ids}
