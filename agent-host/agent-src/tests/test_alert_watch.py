"""A closed alert's watch, one owner (vesta_shared.alert_watch; architecture review, 2026-10-26: "a closed alert says
'it did not come back' when it did"). Every close goes through one operation that carries or drops the watch, and every
reader asks it: the desk's closing words and its reopening of the same number, the Cockpit's confirmsBy, the "(watch)"
title, the watch's last word. Driven through the desk (close → time → event), never by seeding a close's notes — except
for the records older versions already wrote. Invented entities."""
from __future__ import annotations

import importlib.util
import os
from datetime import datetime, timedelta, timezone

import pytest

from helpers import STARTER_SKILLS
from villa_timeline import TimelineVilla
from vesta_agent.incidents import Incidents
from vesta_shared import alert_watch as W
from vesta_shared.params import VillaParams
from vesta_shared.problems import Problems
from vesta_shared.store import Notes, Store

spec = importlib.util.spec_from_file_location("desk_watch", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)
SILENT = "critical_internet---villa_silent|agent"


def door(phase="opened", started=1, **extra):
    """The villa's own alert on a door left unlocked (its rule names its bad states: the desk can read it again)."""
    rule = "automation.example_door"
    return {"blueprint": "critical_condition", "rule_id": rule, "incident_id": f"{rule}-{started}", "phase": phase,
            "severity": "critical", "label": "Door unlocked", "entities": ["lock.example_door"],
            "summary": "Door unlocked", "mode": "state", "bad_states": ["unlocked"], **extra}


def watchdog():
    """An alert the desk cannot read again: no claim, no bad states."""
    return {"blueprint": "critical_schedule", "rule_id": "automation.example_pump_watchdog",
            "incident_id": "automation.example_pump_watchdog-1", "phase": "opened", "severity": "critical",
            "label": "Pump overdue", "entities": ["switch.example_pump"], "summary": "Pump overdue"}


def seen(store, iid, now):
    """What each reader says of closed `iid` at `now`: (until, the Cockpit's confirmsBy, the "(watch)" title)."""
    task = store.last_task(f"incident:{iid}")
    return (W.until(store.incident(iid)), task and Problems(store).confirms_by(task, now=now),
            Incidents(store.path).watching(iid, now))


def closing_words(res):
    return [s["note"] for s in res.get("settle") or []]


def test_the_villa_back_online_is_never_told_it_did_not_come_back_when_it_did(tmp_path):
    # the probe of the review: the villa silent, back at 08:47 (#1 closed "back online"), silent again at 08:50 — a NEW
    # number, #2; four hours later #1 said "Closed on …: it did not come back within 4h."
    store = Store(str(tmp_path / "s.sqlite"))
    store.beat("ha_events", T0.isoformat())
    desk.tick(store, T0 + timedelta(minutes=40))                                # silent: #1 opens
    desk.tick(store, T0 + timedelta(minutes=45))                                # carried as every open alert
    store.beat("ha_events", (T0 + timedelta(minutes=46)).isoformat())
    closed = desk.tick(store, T0 + timedelta(minutes=47))                       # back online: #1 closes
    (first,) = store.incidents(open_only=False)
    assert first["closed_at"] and not any("Watch" in s["status"] for s in closed["send"]), closed["send"]
    assert W.until(first) is None and not Incidents(store.path).watching(first["id"], T0 + timedelta(minutes=50))
    store.beat("ha_events", (T0 + timedelta(minutes=50)).isoformat())
    desk.tick(store, T0 + timedelta(minutes=90))                                # silent again: a new number
    assert [(i["key"], bool(i["closed_at"])) for i in store.incidents(open_only=False)] == [(SILENT, True),
                                                                                         (SILENT, False)]
    said = []
    for minutes in range(95, 60 * 30, 60):                                      # every look for a day and more
        res = desk.tick(store, T0 + timedelta(minutes=minutes))
        said += [s for s in res.get("settle") or [] if s["incident_id"] == first["id"]]
        assert first["id"] not in res["watch_over"]
    assert said == []


def test_a_close_older_versions_watched_ends_without_saying_it_did_not_come_back(tmp_path):
    # a villa-silent close written by an older desk, with the watch every open alert carried: its alert came back as
    # #2 during that watch — the watch ends, nothing false is said, and its title stops being "(watch)"
    store = Store(str(tmp_path / "s.sqlite"))
    first = store.new_incident(SILENT, "critical_internet---villa_silent", "agent", "P1", {"message": "x"}, T0.isoformat())
    store.note(first, {Notes.WATCH_MINUTES: 240.0}, state="recovered", closed_at=(T0 + timedelta(minutes=47)).isoformat())
    store.new_incident(SILENT, "critical_internet---villa_silent", "agent", "P1", {"message": "x"},
                       (T0 + timedelta(minutes=90)).isoformat())
    assert Incidents(store.path).watching(first, T0 + timedelta(hours=2))      # as it was written
    res = desk.tick(store, T0 + timedelta(hours=5))
    assert res["watch_over"] == [] and not [s for s in res.get("settle") or [] if s["incident_id"] == first]
    assert not Incidents(store.path).watching(first, T0 + timedelta(hours=5))
    # one that did not come back is told, as before
    other = store.new_incident("door|lock.example_door", "automation.example_door", "lock.example_door", "P2",
                               {"message": "x"}, T0.isoformat())
    store.note(other, {Notes.WATCH_MINUTES: 240.0}, state="resolved", closed_at=(T0 + timedelta(hours=2)).isoformat())
    res = desk.tick(store, T0 + timedelta(hours=6, minutes=1))
    assert res["watch_over"] == [other]
    assert closing_words(res) == ["Closed on {time}: it did not come back within 4h."]


def test_a_close_is_watched_until_its_watch_ends_and_an_alert_within_it_is_the_same_number(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = desk.intake(store, door(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, door(phase="resolved"), T0 + timedelta(minutes=20))
    close = T0 + timedelta(minutes=20)
    assert closing_words(res) == ["Cleared on {time}. Watch 4h."]
    until, confirms, watching = seen(store, iid, close + timedelta(hours=1))
    assert until == close + timedelta(hours=4) and confirms == until.isoformat() and watching
    # back a minute before the watch ends: the same number, "Back again"
    back = desk.intake(store, door(started=2), until - timedelta(minutes=1), occupancy_reader=lambda: "occupied")
    assert back["decision"] == "reopened" and back["incident_id"] == iid
    desk.intake(store, door(phase="resolved", started=2), until)
    again = W.until(store.incident(iid))
    assert again == until + timedelta(hours=4)
    # its watch over: said once, at the moment it ended; an alert after it is a new number
    res = desk.tick(store, again + timedelta(minutes=1))
    assert res["watch_over"] == [iid] and closing_words(res) == ["Closed on {time}: it did not come back within 4h."]
    assert seen(store, iid, again + timedelta(minutes=1)) == (again, None, False)
    new = desk.intake(store, door(started=3), again + timedelta(minutes=2), occupancy_reader=lambda: "occupied")
    assert new["decision"] == "new" and new["incident_id"] != iid


@pytest.mark.parametrize("hours", [0, 4])
def test_telegram_the_cockpit_and_the_title_say_one_watch_whatever_reopen_hours(tmp_path, hours):
    params = VillaParams(defaults={**desk.DEFAULTS, "reopen_hours": hours})
    wait = desk.DEFAULTS["clear_minutes"]
    watch = timedelta(hours=hours)
    said = desk.lasting(hours * 3600)

    # the villa's own all-clear: watched for reopen_hours, and with 0 not at all — nowhere
    store = Store(str(tmp_path / f"v{hours}.sqlite"))
    iid = desk.intake(store, door(), T0, params, occupancy_reader=lambda: "occupied")["incident_id"]
    res = desk.intake(store, door(phase="resolved"), T0 + timedelta(minutes=20), params)
    close = T0 + timedelta(minutes=20)
    assert closing_words(res) == ["Cleared on {time}." + (f" Watch {said}." if hours else "")]
    until, confirms, watching = seen(store, iid, close + timedelta(minutes=1))
    assert (until, confirms, watching) == ((close + watch, (close + watch).isoformat(), True) if hours
                                           else (None, None, False))
    back = desk.intake(store, door(started=2), close + timedelta(minutes=1), params, occupancy_reader=lambda: "occupied")
    assert (back["incident_id"] == iid) is bool(hours)

    # a Done on an alert the desk reads again: watched at least its wait, "VESTA will monitor it for 10min"
    store = Store(str(tmp_path / f"d{hours}.sqlite"))
    iid = desk.intake(store, door(), T0, params, occupancy_reader=lambda: "occupied")["incident_id"]
    done = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), params, name="JM")
    close = T0 + timedelta(minutes=5)
    length = max(watch, timedelta(minutes=wait))
    assert [s["status"] for s in done["send"] if s["stage"] == "closed"] == [
        f"Done on {{time}} (JM), VESTA will monitor it for {desk.lasting(wait * 60)}."]
    assert seen(store, iid, close + timedelta(minutes=1)) == (close + length, (close + length).isoformat(), True)
    lock = TimelineVilla(**{"lock.example_door": ("locked", close)})
    read = desk.tick(store, close + timedelta(minutes=wait, seconds=1), params, client=lock)
    assert [s["status"] for s in read["send"] if s["stage"] == "closed"] == [
        f"Done (JM). Checked after {desk.lasting(wait * 60)}: right." + (f" Watch {said}." if hours else "")]

    # a Done on an alert the desk cannot read again: watched for reopen_hours, and with 0 not at all
    store = Store(str(tmp_path / f"n{hours}.sqlite"))
    iid = desk.intake(store, watchdog(), T0, params, occupancy_reader=lambda: "occupied")["incident_id"]
    done = desk.reply(store, iid, "done", "fm", T0 + timedelta(minutes=5), params, name="JM")
    close = T0 + timedelta(minutes=5)
    assert [s["status"] for s in done["send"] if s["stage"] == "closed"] == [
        "Done on {time} (JM)." + (f" Watch {said}." if hours else "")]
    assert seen(store, iid, close + timedelta(minutes=1)) == ((close + watch, (close + watch).isoformat(), True)
                                                              if hours else (None, None, False))


def test_a_close_in_the_cockpit_is_watched_from_the_terms_the_desk_carried(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = desk.intake(store, door(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    desk.tick(store, T0 + timedelta(minutes=5))                                 # the desk carries its terms
    task = store.last_task(f"incident:{iid}")
    at = T0 + timedelta(minutes=6)
    Problems(store).closed_in_kiosk(task["id"], "Closed in the Cockpit (JM)", at=at.isoformat())
    until = at + timedelta(minutes=W.length(desk.terms(), read_again=True))
    assert seen(store, iid, at + timedelta(minutes=1)) == (until, until.isoformat(), True)
    assert W.awaiting_read(store.incident(iid))                                 # the desk reads it again after its wait


def test_a_watch_an_older_desk_carried_still_reads(tmp_path):
    # formats outlive their writer: an open incident of an older desk carried only its length (no terms) — a close in
    # the Cockpit keeps that length, and a closed one keeps being watched, reopened and confirmed by it
    store = Store(str(tmp_path / "s.sqlite"))
    iid = desk.intake(store, door(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    store.note(iid, {Notes.WATCH_MINUTES: 90.0})
    task = store.last_task(f"incident:{iid}")
    Problems(store).closed_in_kiosk(task["id"], "Closed in the Cockpit (JM)", at=T0.isoformat())
    assert seen(store, iid, T0 + timedelta(minutes=1)) == (T0 + timedelta(minutes=90),
                                                         (T0 + timedelta(minutes=90)).isoformat(), True)
    assert W.reopens(store.incident(iid), T0 + timedelta(minutes=89))
    assert not W.reopens(store.incident(iid), T0 + timedelta(minutes=91))


def test_a_watch_nobody_ended_is_watched_as_long_as_the_desk_leaves_it(tmp_path, monkeypatch):
    # the "(watch)" title kept a day typed in the engine; the desk leaves a watch after alerts.late_close_days
    store = Store(str(tmp_path / "s.sqlite"))
    iid = desk.intake(store, door(), T0, occupancy_reader=lambda: "occupied")["incident_id"]
    desk.intake(store, door(phase="resolved"), T0)
    until = W.until(store.incident(iid))
    assert Incidents(store.path).watching(iid, until + timedelta(hours=23))
    assert not Incidents(store.path).watching(iid, until + timedelta(days=2))
    limits = tmp_path / "limits.yaml"
    limits.write_text("alerts.late_close_days: 3\n")
    monkeypatch.setenv("VESTA_LIMITS", str(limits))
    assert Incidents(store.path).watching(iid, until + timedelta(days=2))
