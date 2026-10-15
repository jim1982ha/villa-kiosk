"""One pretend villa for the agent's tests: each entity's timeline, from which every read Home Assistant answers — its
states, its history, "not found" — is worked out the way the real one answers it.

⚠️ ONE STAND-IN, NOT FIVE (architecture review, 2026-10-15): the alert desk's tests, the "closed is not over" tests, the
fault steps and the comes-back tests each wrote their own, and each learnt a read only when a test broke on it — on
the day "back for 10 minutes" started reading the history, two of them had to learn `history` and the others would have
raised on any path that needed it. Synthetic villa; ids invented.

A timeline is given per entity as keyword arguments, in any of three shapes:
    lock.door=[(T0, "unlocked"), (T1, "locked")]   its states, each from its moment
    lock.door=("unlocked", T0)                       one state, since T0
    lock.door="unlocked"                             one state, since a moment nobody knows (no last_changed)
"""
from __future__ import annotations

from datetime import datetime

from vesta_shared.ha_client import HABase


def history_rows(timeline: list[tuple[datetime | None, str]], start: datetime, end: datetime) -> list[dict]:
    """[start, end) of a timeline as Home Assistant's history answers it: the state carried over from before `start`,
    stamped at `start`, then each change. A state from a moment nobody knows is never history."""
    known = sorted(((t, s) for t, s in timeline if t is not None), key=lambda r: r[0])
    before = [(t, s) for t, s in known if t <= start]
    rows = [{"state": before[-1][1], "last_changed": start.isoformat()}] if before else []
    return rows + [{"state": s, "last_changed": t.isoformat()} for t, s in known if start < t < end]


class TimelineVilla(HABase):
    def __init__(self, *, now: datetime | None = None, names: dict[str, str] | None = None, gone=(), **timeline):
        self.now = now
        self.names = dict(names or {})
        self.gone = set(gone)                               # entities Home Assistant answers "not found" for
        self.timeline: dict[str, list[tuple[datetime | None, str]]] = {}
        for eid, tl in timeline.items():
            self.timeline[eid] = (list(tl) if isinstance(tl, list) else [(tl[1], tl[0])] if isinstance(tl, tuple)
                                  else [(None, str(tl))])

    def _name(self, eid: str) -> str:
        return self.names.get(eid) or eid.split(".", 1)[1]

    def states(self, entity_ids=None):
        out = {}
        for eid in (self.timeline if entity_ids is None else entity_ids):
            rows = [(t, s) for t, s in self.timeline.get(eid, []) if t is None or self.now is None or t <= self.now]
            if eid in self.gone or not rows:
                continue
            t, s = rows[-1]
            out[eid] = {"entity_id": eid, "state": s, "attributes": {"friendly_name": self._name(eid)},
                        **({"last_changed": t.isoformat()} if t is not None else {})}
        return out

    def history(self, entity_ids, start, end):
        return {eid: history_rows(self.timeline.get(eid, []), start, end) for eid in entity_ids}

    def not_found(self, entity_ids):
        return {e for e in entity_ids if e in self.gone}
