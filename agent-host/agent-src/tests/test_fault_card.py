"""A Cockpit fault card's fields, one table (fault_card.py): given what the agent wants a fault to say (Problems.card)
and what the Kiosk holds (kiosk.fault_of), the single write that makes it say it. Pure: no Kiosk. Synthetic; ids
invented."""
from __future__ import annotations

from vesta_agent.fault_card import changes, write
from vesta_agent.kiosk import fault_of


def card(**k) -> dict:
    """What Problems.card says of an open alert's fault, nothing special about it."""
    return {"open": True, "title": "Pump did not run", "number": 5, "priority": "P2", "origin": "alert",
            "check": "minutes", "pattern": None, "since": None, "closes_at": None, "monitored_until": None,
            "expected": None, "confirms_by": None, "not_watched": False, "entity_id": "switch.example_pump",
            "todo": "Check the breaker.", **k}


def fault(**k) -> dict:
    """An open fault as the Kiosk holds it, saying all `card()` says."""
    return {"id": "va-1", "title": "Pump did not run", "status": "open", "entityId": "switch.example_pump",
            "alertNumber": 5, "alertPriority": "P2", "origin": "alert", "check": "minutes",
            "note": "What to do: Check the breaker.",
            "updates": [{"at": "2026-11-20T04:00:00Z", "status": "open", "photoIds": [], "title": "Pump did not run"}],
            **k}


def written(want: dict, t: dict) -> dict | None:
    """The fault as the one write leaves it; None when nothing is written."""
    ch = changes(want, fault_of(t))
    return write(ch)(t) if ch else None


def test_a_fault_that_says_what_is_wanted_gets_no_write():
    assert written(card(), fault()) is None


def test_each_field_follows_what_is_wanted_in_one_write():
    t = written(card(number=6, priority="P1", closes_at="2026-11-20T05:00:00+00:00", expected="Runs only when in.",
                     monitored_until="2026-11-20T06:40:00+00:00", entity_id="lock.example", todo="Lock it."), fault())
    assert (t["alertNumber"], t["alertPriority"], t["closesAt"], t["expected"], t["monitoredUntil"], t["entityId"],
            t["note"]) == (6, "P1", "2026-11-20T05:00:00+00:00", "Runs only when in.", "2026-11-20T06:40:00+00:00",
                           "lock.example", "What to do: Lock it.")
    assert t["updates"] == fault()["updates"]                     # fields only: its story is not this table's


def test_a_line_no_longer_wanted_is_taken_away_and_a_tag_no_longer_said_is_kept():
    t = written(card(number=None, origin=None, check=None, closes_at=None, expected=None, todo=None),
                fault(closesAt="2026-11-20T05:00:00+00:00", expected="Runs only when in."))
    assert "closesAt" not in t and "expected" not in t
    assert (t["alertNumber"], t["origin"], t["check"], t["note"]) == (5, "alert", "minutes", "What to do: Check the breaker.")


def test_an_open_fault_is_never_being_confirmed():
    t = written(card(confirms_by="2026-11-20T06:00:00+00:00"), fault(confirmsBy="2026-11-20T06:00:00+00:00"))
    assert "confirmsBy" not in t


def test_what_a_person_wrote_stays_theirs():
    # their note, and their title: the duration the agent words goes with it
    person = fault(note="Part ordered, due Monday", titlePattern="Pump did not run for {since}",
                   since="2026-11-20T00:00:00Z", updates=[{"at": "2026-11-20T04:10:00Z", "status": "open",
                                                           "photoIds": [], "kind": "retitled", "by": "Owner"}])
    t = written(card(pattern="Pump did not run for {since}", since="2026-11-20T00:00:00Z"), person)
    assert t["note"] == "Part ordered, due Monday" and "titlePattern" not in t and "since" not in t


def test_the_agents_title_carries_its_duration():
    t = written(card(pattern="Pump did not run for 3h", since="2026-11-20T01:00:00Z"), fault())
    assert (t["titlePattern"], t["since"]) == ("Pump did not run for 3h", "2026-11-20T01:00:00Z")


def test_a_closed_fault_says_only_its_watch():
    closed = fault(status="resolved", confirmsBy="2026-11-20T06:00:00+00:00")
    # its watch over, nothing watched after: the date goes, "not watched" comes; an open fault's lines are not written
    t = written(card(open=False, confirms_by=None, not_watched=True, closes_at="2026-11-20T05:00:00+00:00",
                     number=9), closed)
    assert "confirmsBy" not in t and t["notWatched"] is True
    assert "closesAt" not in t and t["alertNumber"] == 5
    assert written(card(open=False, confirms_by="2026-11-20T06:00:00+00:00"), closed) is None


def test_the_write_reads_the_fault_again_as_it_stands():
    # read open, closed by a person before the write lands: an open fault's lines are left
    ch = changes(card(closes_at="2026-11-20T05:00:00+00:00", todo="Lock it."), fault_of(fault()))
    assert set(ch) == {"closesAt", "note"}
    assert write(ch)(fault(status="resolved")) is None
    # a person wrote the note meanwhile: theirs
    assert write(ch)(fault(note="On it — Wayan"))["note"] == "On it — Wayan"
