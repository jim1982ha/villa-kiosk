"""Where a visit stands, decided once (vesta_shared.visit_state): the villa's record as read now x the incident as VESTA
last saw it x the event's phase -> what VESTA does. The engine's read (app.Vesta._visit_now) and the desk's tick
(visits_over) read the record through the same function. Synthetic: every id invented."""
from __future__ import annotations

import pytest

from vesta_shared import visit_state as VS

VID = "automation.example-1"
OPEN = {"state": "open", "attributes": {"id": VID, "owner": "vesta", "seq": 2, "steps": [{"seq": 1}]}}
CLOSED = {"state": "closed", "attributes": {"id": VID, "owner": "villa", "seq": 3, "steps": [{"seq": 1}, {"seq": 3}],
                                            "closed": {"why": "quiet", "at": "2026-11-07T07:16:00+00:00"}}}
LATER = {"state": "open", "attributes": {"id": "automation.example-2"}}


@pytest.mark.parametrize("row,over,steps", [(OPEN, False, [{"seq": 1, "x": 1}]), (CLOSED, True, [{"seq": 1}, {"seq": 3}]),
                                            (LATER, True, [{"seq": 1, "x": 1}]), ({}, False, [{"seq": 1, "x": 1}])],
                         ids=["open", "closed", "a later visit", "unread"])
def test_the_record_read_now_decides_the_visit_on_the_event_path_and_the_tick_alike(row, over, steps):
    event = {"steps": [{"seq": 1, "x": 1}], "owner": "pending"}
    now = VS.now_of(row, VID)
    v = VS.seen({**event, **({"now": now} if now is not None else {})})
    assert VS.over(v) is over and v["steps"] == steps, v
    assert (VS.ended_on(event, row, VID) is not None) is over
    if row is OPEN:
        assert v["owner"] == "vesta", "who holds it: the record's"


AWAY, HERE = {VS.AWAY: True}, {}
TABLE = [
    # visit over?, its open incident's notes, a closed incident's notes, phase -> kind, away, villa told
    (False, None, None, "opened", VS.NEW, False, True),
    (True, None, None, "opened", VS.NEW, True, False),          # #138, #143: over before VESTA heard it
    (False, HERE, None, "step", VS.STEP, False, True),
    (True, HERE, None, "step", VS.STEP, False, True),           # VESTA up: its own close follows the step
    (True, AWAY, None, "step", VS.STEP, True, False),           # #140: a replayed step of a visit recorded closed
    (False, None, HERE, "step", VS.LATE, False, True),          # a person's close crossed the villa's: told as taken
    (True, None, HERE, "step", VS.LATE, False, False),
    (True, None, AWAY, "step", VS.LATE, True, False),
    (True, HERE, None, "resolved", VS.CLOSE, False, True),
    (True, AWAY, None, "resolved", VS.CLOSE, True, True),
    (True, None, HERE, "resolved", VS.LATE, False, True),       # its close said again
    (True, None, AWAY, "resolved", VS.LATE, True, False),       # #141, #143: changes nothing seen
]


@pytest.mark.parametrize("ended,open_notes,late_notes,phase,kind,away,tell", TABLE)
def test_every_event_of_a_visit_is_one_transition(ended, open_notes, late_notes, phase, kind, away, tell):
    v = {"closed": {"why": "quiet"}} if ended else {}
    got = VS.transition(v, open_notes, late_notes, phase)
    assert (got.kind, got.away, got.tell) == (kind, away, tell), got


def test_a_visit_ends_at_the_villas_moment_an_answer_at_its_press():
    quiet = VS.ending({"closed": {"why": "quiet", "at": "2026-11-07T07:16:00+00:00"}})
    assert quiet.at.isoformat() == "2026-11-07T07:16:00+00:00" and quiet.why == "quiet"
    pressed = VS.ending({"closed": {"why": "answered", "who": "Jm"},
                         "answered": {"option": "done", "at": "2026-11-07T08:53:55+00:00"}})
    assert pressed.at.isoformat() == "2026-11-07T08:53:55+00:00" and pressed.who == "Jm"
    assert VS.ending({}).at is None, "open: closed now, after its quiet"
