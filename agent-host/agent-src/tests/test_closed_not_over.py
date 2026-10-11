"""Closed is not over (architecture review 25, 2026-10-11).

The villa, that night: the Laundry door's fault closed in the Kiosk while the door was still unlocked — nothing watched
it again; and Telegram refused one person's chat — only the VESTA Agent page knew. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk25", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
OWNER, FM, FM2 = 111, 222, 333


def run(c):
    return asyncio.run(c)


class Villa:
    """Home Assistant's states: {entity: (state, since)}."""
    def __init__(self, **now):
        self.now = now

    def states(self, ids):
        return {e: {"state": s, "last_changed": t.isoformat(), "attributes": {"friendly_name": e.split(".")[1]}}
                for e, (s, t) in self.now.items() if e in ids}


def door(store, legacy=False, **extra):
    ev = {"blueprint": "critical_condition", "rule_id": "automation.door", "incident_id": "automation.door-1",
          "phase": "opened", "severity": "critical", "label": "Door", "entities": ["lock.door"], "summary": "Door unlocked",
          **({} if legacy else {"mode": "state", "bad_states": ["unlocked"]}), **extra}
    return desk.intake(store, ev, T0, mode_reader=lambda: "x")["incident_id"]


# ---------------------------------------------------------------------- 1 · closed while still bad
def test_a_close_on_a_door_still_unlocked_reopens_it_still_there_and_the_desk_watches_it(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = door(store)
    desk.reply(store, iid, "Done", "fm", T0 + timedelta(minutes=5))
    villa = Villa(**{"lock.door": ("unlocked", T0 - timedelta(hours=1))})
    out = desk.tick(store, T0 + timedelta(minutes=20), client=villa)
    assert out["not_quiet"] == [iid]
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["stage"] == "still" and fm["status"].endswith("still open. VESTA keeps watching it.")
    # "still there", never "back again" (review 25)
    assert [a for a in out["actions"] if a["action"] in ("ticket.reopen", "ticket")]
    assert all(a.get("note") != "Back again." for a in out["actions"])
    # locked later: the desk itself closes it — Home Assistant's rule no longer watches it
    villa.now["lock.door"] = ("locked", T0 + timedelta(minutes=30))
    assert desk.tick(store, T0 + timedelta(minutes=45), client=villa)["cleared"] == [iid]


def test_a_close_the_desk_cannot_check_says_so_with_what_the_device_reads(tmp_path):
    # the Laundry door: its alert predates the rules' bad states — the check was dropped without a word
    store = Store(str(tmp_path / "s.sqlite"))
    iid = door(store, legacy=True)
    (task,) = store.tasks("open")
    Problems(store).closed_in_kiosk(task["id"])
    out = desk.tick(store, datetime.now(timezone.utc) + timedelta(minutes=11),
                    client=Villa(**{"lock.door": ("unlocked", T0)}))
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"] == "Closed in the Kiosk. Note: VESTA cannot check this one; door reads unlocked."
    assert fm["stage"] == "closed" and store.incident(iid)["closed_at"]


def test_a_rule_silent_for_twelve_hours_is_watched_by_the_desk(tmp_path):
    # a blueprint reload cancels the rule's run without an "abandoned": the desk waited for an all-clear for ever
    store = Store(str(tmp_path / "s.sqlite"))
    iid = door(store)
    villa = Villa(**{"lock.door": ("locked", T0 + timedelta(hours=1))})
    assert not desk.tick(store, T0 + timedelta(hours=6), client=villa).get("cleared")      # Home Assistant's still
    assert desk.tick(store, T0 + timedelta(hours=13), client=villa)["cleared"] == [iid]


# ---------------------------------------------------------------------- 2 · a person's reopening in the Kiosk
def test_a_fault_a_person_reopens_in_the_kiosk_stays_open_and_the_facility_manager_is_asked(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    iid = st.new_incident("automation.door|lock.door", "automation.door", "lock.door", "P2", {"message": "Door unlocked"})
    tid, _ = pb.open_task("incident", iid, "automation.door", "lock.door", "Door unlocked")
    st.set_task_uid(tid, "t-door")
    pb.close_incident(iid, "resolved", datetime.now(timezone.utc).isoformat(), "Cleared")   # the agent closed it
    k.known = ["t-door"]
    k.closed_meta["t-door"] = {"reopened_by": "Owner", "reopened_at": "2099-01-01T00:00:00.000Z"}   # its "Reopen fault"
    run(v.tickets.repair())
    run(v.tickets.repair())
    assert "t-door" not in k.resolved                                                        # never undone
    assert st.task(tid)["status"] == "open" and st.task(tid)["reopened_by"] == "Owner"
    assert st.incident(iid)["closed_at"] is None
    out = desk.tick(st, datetime.now(timezone.utc))
    (fm,) = [s for s in out["send"] if s["to"] == "fm"]
    assert fm["status"] == "Reopened in the Kiosk by Owner on {time}: please look again." and fm["keyboard"]


# ---------------------------------------------------------------------- 3 · a settled copy says "Closed"
def test_a_copy_settled_after_its_incident_closed_is_headed_closed(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, skills=["alert-desk"])
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "automation.r", "lock.a", "P2", {"message": "Door unlocked"})
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Door unlocked", "incident_id": iid, "keyboard": True,
                                       "stage": "new"}]}, "alert-desk"))
    assert "Incident: New #" in v.tg.sent[-1][1]
    st.update_incident(iid, closed_at=datetime.now(timezone.utc).isoformat(), state="resolved")
    run(v.outcome.carry_out({"settle": [{"incident_id": iid, "note": "Cleared in Home Assistant on {time}."}]}))
    assert f"Incident: Closed #{iid}" in v.tg.edits[-1][2]


# ---------------------------------------------------------------------- 5 · a person Telegram refuses
def test_an_alert_no_facility_manager_received_goes_to_the_owner_at_once_and_the_owner_is_told_who(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"}]}, skills=["alert-desk"])
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "automation.r", "lock.a", "P2", {"message": "Door unlocked"})
    st.update_incident(iid, state="asked", asked_at=datetime.now(timezone.utc).isoformat())
    v.tg.refuse.add(f"blocked {FM}")                                   # Fabien never pressed Start
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Door unlocked", "incident_id": iid, "keyboard": True,
                                       "stage": "new"}]}, "alert-desk"))
    told = [t for c, t, _ in v.tg.sent if c == OWNER]
    assert any("Fabien cannot be reached on Telegram" in t and "press Start" in t for t in told)
    assert json.loads(st.incident(iid)["payload"])["unreached"]
    out = desk.tick(st, datetime.now(timezone.utc))
    assert out["escalated"] == [iid] and st.incident(iid)["state"] == "escalated"
    (owner,) = [s for s in out["send"] if s["to"] == "owner"]
    assert owner["status"].startswith("Not delivered to the facility manager") and owner["keyboard"]
    # told once: a second refused message says nothing more
    n = len([c for c, _, _ in v.tg.sent if c == OWNER])
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Another"}]}))
    assert len([c for c, _, _ in v.tg.sent if c == OWNER]) == n


def test_telegram_switched_off_is_never_taken_for_a_refused_person(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"}]}, skills=["alert-desk"])
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "automation.r", "lock.a", "P2", {"message": "Door unlocked"})
    v.tg.refuse.add("send")                                            # a network blip, not a refusal
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": "Door unlocked", "incident_id": iid, "keyboard": True}]},
                            "alert-desk"))
    assert "unreached" not in json.loads(st.incident(iid)["payload"])


# ---------------------------------------------------------------------- 6, 7 · counted in one pass, each run its words
def test_each_run_keeps_its_own_words_and_the_counts_are_one_pass(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = store.new_incident("k", "automation.r", "x.a", "P2", {"message": "First words"}, at=T0.isoformat())
    store.update_incident(iid, closed_at=(T0 + timedelta(hours=1)).isoformat())
    store.reopen_incident(iid, (T0 + timedelta(hours=2)).isoformat(), message="First words")
    store.update_incident(iid, payload=json.dumps({"message": "Latest words"}))
    runs = [o for o in store.incident_occurrences() if o["id"] == iid]
    assert [json.loads(o["payload"])["message"] for o in runs] == ["First words", "Latest words"]
    assert store.incident_counts(T0.isoformat()) == {"automation.r": 2}
    assert store.count_incidents("automation.r", (T0 + timedelta(minutes=90)).isoformat()) == 1
    # a run older than the kept days goes at the next reopening
    store.update_incident(iid, closed_at=(T0 + timedelta(days=50)).isoformat())
    store.reopen_incident(iid, (T0 + timedelta(days=50, hours=1)).isoformat())
    runs = [o["opened_at"] for o in store.incident_occurrences() if o["id"] == iid]
    assert len(runs) == 2 and runs[0] == (T0 + timedelta(hours=2)).isoformat()         # the first run, 50 days old, gone


def test_a_night_fault_a_person_reopens_is_theirs_until_they_close_it(tmp_path):
    # its finding closed (the night no longer sees it): without the person's mark, the next repair cleared it again
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-X", "sensor.pump", "power", "2026-10-07", "P3", "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.pump", "Pump weak")
    st.set_task_uid(tid, "t-pump")
    pb.close_finding(st.finding(fid), "2026-10-08", "Cleared")
    k.known = ["t-pump"]
    k.closed_meta["t-pump"] = {"reopened_by": "Owner", "reopened_at": "2099-01-01T00:00:00.000Z"}
    run(v.tickets.repair())
    run(v.tickets.repair())
    assert st.task(tid)["status"] == "open" and "t-pump" not in k.resolved
