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


def _ph(at, eid="binary_sensor.example_motion", **more):
    return {"path": f"/media/vesta/{at}.jpg", "camera_name": eid.split(".")[1], "entity_id": eid,
            "at": f"2026-11-07T11:{at}:00+00:00", **more}


def test_a_visits_photos_are_one_list_the_strongest_first_then_oldest_first_the_pictures_marked():
    # #148: the person in the Parking photo dropped out of the sheet while the tablet and "All photos" each had their
    # own order; one list now, read by the desk, the sheet, the picture and the album alike
    door = "binary_sensor.example_door"
    v = {"strongest": {"entity_id": door},
         "photos": [_ph("50"), _ph("52"), _ph("54", door), _ph("55"), _ph("57", door), _ph("58"), {"path": "x"}]}
    got = VS.ordered(VS.photos_of(v), 3)
    assert [p["at"][14:16] for p in got] == ["54", "50", "52", "55", "57", "58"], got
    assert got[0]["lead"] and [p["at"][14:16] for p in got if p["onSheet"]] == ["54", "57", "58"], got
    assert VS.off_sheet(got) == 3
    # the siren's snapshots join the same order; an older list ordered again keeps it
    snap = {"path": "/out/visits/1/cam.jpg", "label": "Cam", "at": "2026-11-07T11:51:00+00:00", "own": True}
    again = VS.ordered(got + [snap], 3)
    assert [p["at"][14:16] for p in again] == ["54", "50", "51", "52", "55", "57", "58"]
    assert VS.ordered(VS.ordered(got), 3) == got
    assert VS.ordered([]) == [] and VS.ordered([snap], 9)[0]["onSheet"]


def test_the_sheet_draws_the_tiles_the_list_marks(monkeypatch):
    from vesta_agent import sheet
    drawn = []
    monkeypatch.setattr(sheet, "_inside", lambda path, roots: drawn.append(path) and None)
    door = "binary_sensor.example_door"
    photos = VS.ordered(VS.photos_of({"strongest": {"entity_id": door},
                                      "photos": [_ph("50"), _ph("52"), _ph("54", door), _ph("58")]}), 2)
    assert sheet.build(photos, 2, "UTC") is None
    assert drawn == [p["path"] for p in photos if p["onSheet"]] == ["/media/vesta/54.jpg", "/media/vesta/58.jpg"]
