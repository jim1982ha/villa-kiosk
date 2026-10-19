"""Architecture review 6: closing an incident or a finding closes what it owes — decided by its state, in one place
(vesta_shared.problems), not by each skill remembering to."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from vesta_shared.problems import CLEARED, DONE, STILL_THERE, Problems
from vesta_shared.result import faults_changed
from vesta_shared.store import Incident, Store

NOW = "2026-10-07T12:00:00+00:00"


def _incident_with_task(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    iid = store.new_incident("k", "rule.example", "lock.example_door", "P2", {"message": "unlocked"}, at=NOW)
    tid, _ = Problems(store).open_task("incident", iid, "rule.example", "lock.example_door", "Door unlocked")
    return store, iid, tid


@pytest.mark.parametrize("state,closes_as", [
    (Incident.DONE, DONE), (Incident.RESOLVED, CLEARED),          # a person answered / Home Assistant cleared it
    (Incident.RECOVERED, None),                                   # the fault is still there: its task stays
])
def test_an_incident_closed_in_a_state_closes_its_task_only_when_that_state_ends_the_problem(tmp_path, state, closes_as):
    store, iid, tid = _incident_with_task(tmp_path)
    actions = Problems(store).close_incident(iid, state, NOW, "why", reply="x")
    inc = store.incident(iid)
    assert inc["state"] == state and inc["closed_at"] == NOW and inc["reply"] == "x"
    task = store.task(tid)
    if closes_as:
        # a fault action carries only what is read (architecture review, 2026-10-19): its close's words are the task's
        assert task["status"] == closes_as and actions == [faults_changed()] and task["close_note"] == "why"
    else:
        assert task["status"] == "open" and actions == []
    # and the nightly reconcile agrees with what was decided here
    assert Problems(store).source_gone(task) == bool(closes_as)


def test_a_finding_no_longer_seen_closes_with_its_task_and_its_fault(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    fid, _ = store.raise_finding("PM-X", "sensor.example", "power", "2026-10-06", "P3", "Pump weak", {})
    tid, _ = Problems(store).open_task("finding", fid, "PM-X", "sensor.example", "Pump weak")
    actions = Problems(store).close_finding(store.finding(fid), "2026-10-07", "Cleared: the nightly check no longer sees it.")
    assert store.finding(fid)["status"] == "closed" and store.task(tid)["status"] == CLEARED
    assert actions == [faults_changed()]
    assert store.task(tid)["close_note"] == "Cleared: the nightly check no longer sees it."


class _F:
    """A finding as the night check makes it (rules.Finding's shape)."""
    def __init__(self, rule_id, entity_id, severity="P3", summary="x", change_pct=None):
        self.rule_id, self.entity_id, self.family, self.severity, self.summary = rule_id, entity_id, "power", severity, summary
        self.detail, self.check, self.day = ({"change_pct": change_pct} if change_pct is not None else {}), "look", ""

    def as_dict(self):
        return {"rule_id": self.rule_id, "entity_id": self.entity_id, "family": self.family, "severity": self.severity,
                "summary": self.summary, "detail": self.detail, "check": self.check, "day": self.day}


def test_the_nights_ledger_list_in_list_out(tmp_path):
    # architecture review 7: what a night does with its findings, without a night check or a fixture folder
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"S-POWER", "S-GONE"}, event_rules={"E-RUN"}, worsened_step=15)
    n1 = pb.record_night([_F("S-POWER", "a", "P2", change_pct=-20), _F("S-GONE", "b"), _F("E-RUN", "c", "P4")],
                         "2026-10-06", **rules)
    assert {d["rule_id"] for d in n1["new"]} == {"S-POWER", "S-GONE", "E-RUN"}
    assert [store.task(t)["entity_id"] for t in n1["task_ids"]] == ["a", "b"]             # P2 and P3 only
    assert store.finding(next(d["id"] for d in n1["new"] if d["rule_id"] == "E-RUN"))["status"] == "closed"
    n2 = pb.record_night([_F("E-RUN", "c", "P4")], "2026-10-07", **rules)
    assert "muted" not in n2                                        # nothing is silenced any more (owner, 2026-10-10)
    # not seen tonight: closed with its task and fault
    assert sorted(c["rule_id"] for c in n2["closed"]) == ["S-GONE", "S-POWER"]
    assert sorted(n2["resolved"]) == sorted(n1["task_ids"])


def test_a_still_open_finding_that_worsened_is_news_again(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"S-POWER"}, event_rules=set(), worsened_step=15)
    pb.record_night([_F("S-POWER", "a", change_pct=-20)], "2026-10-06", **rules)
    same = pb.record_night([_F("S-POWER", "a", change_pct=-25)], "2026-10-07", **rules)
    worse = pb.record_night([_F("S-POWER", "a", change_pct=-40)], "2026-10-08", **rules)
    assert not same["new"] and not same["still_open"][0].get("worsened")
    assert worse["still_open"][0]["worsened"] is True


def test_the_same_night_run_again_tells_an_event_once(tmp_path):
    # an event finding closes the night it fires; the same night run again (the page's Try) is not news twice
    store = Store(str(tmp_path / "s.sqlite"))
    rules = dict(state_rules=set(), event_rules={"E-RUN"}, worsened_step=15)
    first = Problems(store).record_night([_F("E-RUN", "c", "P3")], "2026-10-07", **rules)
    again = Problems(store).record_night([_F("E-RUN", "c", "P3")], "2026-10-07", **rules)
    assert len(first["new"]) == 1 and again["new"] == [] and again["task_ids"] == []


def test_mute_leftovers_close_and_an_edited_skill_still_runs(tmp_path):
    # architecture review 19: a fault muted before 0.12.132 stayed open in the Cockpit for good, and a night check the villa
    # edited before still calls Mute's helpers — both must go on working without Mute
    store, iid, tid = _incident_with_task(tmp_path)
    store.update_incident(iid, state="muted", closed_at=NOW)
    assert Problems(store).source_gone(store.task(tid))                       # the repair closes it and its fault
    assert store.is_muted("r", "e") is False and store.mutes() == [] and store.mute("r", "e", NOW, "owner") is None
    old_call = Problems(store).record_night([], "2026-10-07", NOW, state_rules=set(), event_rules=set(), worsened_step=15)
    assert old_call["new"] == []


def test_a_device_offline_every_night_is_the_same_problem_again_not_a_new_one(tmp_path):
    # architecture review 22: offline at 02:00, back by noon (recheck.py closes it), offline again the next night — a new
    # finding, task and Kiosk fault every morning, a "new" digest line, never "it keeps happening"
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)
    first = pb.record_night([_F("PM-UNAVAILABLE", "switch.plug", "P2", summary="Plug offline")], "2026-10-07", **rules)
    (fid,) = [d["id"] for d in first["new"]]
    for n, day in enumerate(("2026-10-08", "2026-10-09"), start=1):
        pb.close_finding(store.finding(fid), day, "Cleared: back online.")              # back by noon
        night = pb.record_night([_F("PM-UNAVAILABLE", "switch.plug", "P2", summary="Plug offline")], day, **rules)
        assert night["new"] == [] and [d["id"] for d in night["again"]] == [fid] and night["again"][0]["again"] == n
        # architecture review 23: the Kiosk fault says it too — its title is the task's
        # architecture review 24: its own task and Kiosk fault open again, titled with how often — never a new one
        (back,) = night["task_ids"]
        assert pb.card(store.task(back))["title"] == f"Plug offline (again: {n + 1} times in 7 days)"
        assert store.task(back)["status"] == "open" and len(store.tasks(None)) == 1
        # ...and so does what every reader shows: listed as of the day it came back, never "still open since the 7th"
        (row,) = pb.since(day)["new"]
        assert row["title"] == f"Plug offline (again: {n + 1} times in 7 days)" and row["since"] == day
    # a week and more later: a new problem again
    pb.close_finding(store.finding(fid), "2026-10-09", "Cleared: back online.")
    later = pb.record_night([_F("PM-UNAVAILABLE", "switch.plug", "P2")], "2026-10-20", **rules)
    assert [d["id"] for d in later["new"]] != [fid] and later["again"] == []


def test_a_fault_closed_by_hand_the_time_before_never_hides_it_when_it_comes_back(tmp_path):
    # architecture review 23: closed in the Kiosk while still offline, back two nights later — the Kiosk showed it open,
    # the digest, the weekly page and the AI said nothing was open
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)
    first = pb.record_night([_F("PM-UNAVAILABLE", "switch.plug", "P2")], "2026-10-07", **rules)
    pb.closed_in_kiosk(first["task_ids"][0])                                              # closed by hand
    assert pb.open_problems() == []                                                    # handled: not listed
    pb.close_finding(store.finding(first["new"][0]["id"]), "2026-10-08", "Cleared: back online.")
    pb.record_night([_F("PM-UNAVAILABLE", "switch.plug", "P2")], "2026-10-09", **rules)
    assert [p["source"] for p in pb.open_problems()] == [f"finding:{first['new'][0]['id']}"]


def test_an_open_problem_that_never_had_a_fault_gets_one_and_a_hand_closed_one_stays_quiet(tmp_path):
    # villa, 2026-10-14: a sensor offline for five days was open every night and never in the Cockpit — its finding
    # opened before it had a task, and a task was asked for only when a finding was new or came back
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)
    store.raise_finding("PM-UNAVAILABLE", "sensor.a", "a", "2026-10-09", "P3", "A offline for 39 h.", {})  # no task
    night = pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3", summary="A offline for 63 h.")], "2026-10-10", **rules)
    (tid,) = night["task_ids"]
    assert store.task(tid)["entity_id"] == "sensor.a" and store.task(tid)["summary"] == "A offline for 63 h."
    assert pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3")], "2026-10-11", **rules)["task_ids"] == []  # once
    # ⚠️ RE-PINNED (owner, architecture review 2026-10-19: one rule for a close while the problem is still there). It
    # pinned "a person's close silences a still-true problem" for good; now the close holds until the source is read
    # again its skill's settle time after the close, still bad — then the task opens again, saying why
    pb.closed_in_kiosk(tid)
    closed_at = datetime.fromisoformat(store.task(tid)["done_at"])
    soon = (closed_at + timedelta(minutes=9)).isoformat()
    assert pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3")], "2026-10-12", at=soon, settle_minutes=10,
                           **rules)["task_ids"] == []                                      # read too soon: it holds
    later = (closed_at + timedelta(minutes=10)).isoformat()
    assert pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3")], "2026-10-12", at=later, settle_minutes=10,
                           **rules)["task_ids"] == [tid]
    assert (store.task(tid)["status"], store.task(tid)["reopen_note"]) == ("open", STILL_THERE)
    assert pb.card(store.task(tid))["reopen_note"] == "Still there after the close."
    # a skill that names no settle time leaves a person's close as it is
    pb.closed_in_kiosk(tid)
    assert pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3")], "2026-10-12", at="2099-01-01T00:00:00+00:00",
                           **rules)["task_ids"] == []
    # a severity without a fault gets none
    store.raise_finding("PM-UNAVAILABLE", "sensor.b", "b", "2026-10-09", "P4", "B.", {})
    assert pb.record_night([_F("PM-UNAVAILABLE", "sensor.a", "P3"), _F("PM-UNAVAILABLE", "sensor.b", "P4")],
                           "2026-10-13", **rules)["task_ids"] == []


def test_unseen_names_an_open_problem_with_no_fault_and_no_persons_close(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)
    # whatever a run of nights does, it leaves none
    for day, fs in [("2026-10-06", [_F("PM-UNAVAILABLE", "a", "P2"), _F("PM-UNAVAILABLE", "b", "P3"), _F("PM-UNAVAILABLE", "c", "P4")]),
                    ("2026-10-07", [_F("PM-UNAVAILABLE", "a", "P2")]),
                    ("2026-10-08", [_F("PM-UNAVAILABLE", "a", "P2"), _F("PM-UNAVAILABLE", "b", "P3")])]:
        pb.record_night(fs, day, **rules)
        assert pb.unseen() == [], day
    # a person's close keeps it quiet: not unseen
    pb.closed_in_kiosk(store.open_task("PM-UNAVAILABLE", "a")["id"])
    assert pb.unseen() == []
    # its task cleared while the problem is still open — nothing would ever show it: named
    pb.close(store.open_task("PM-UNAVAILABLE", "b")["id"], CLEARED)
    assert [f["entity_id"] for f in pb.unseen()] == ["b"]


def test_an_event_finding_is_never_counted_again(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules=set(), event_rules={"E-RUN"}, worsened_step=15)
    pb.record_night([_F("E-RUN", "c", "P3")], "2026-10-07", **rules)
    # review 30: its fault stays open a night; fired again meanwhile, it is the same open problem — never counted twice
    second = pb.record_night([_F("E-RUN", "c", "P3")], "2026-10-08", **rules)
    assert second["new"] == [] and len(second["still_open"]) == 1
    assert len(pb.record_night([], "2026-10-09", **rules)["closed"]) == 1               # a quiet night: it closes
    assert len(pb.record_night([_F("E-RUN", "c", "P3")], "2026-10-12", **rules)["new"]) == 1


def test_a_night_run_twice_after_its_problem_was_cleared_gives_it_its_fault_back(tmp_path):
    # architecture review, 2026-10-15 (Timmerflotte_2623: its finding OPEN, its task CLEARED by the agent, no card in the
    # Cockpit for days): the recheck clears a problem, then the same night is run again — the day's row reopens in
    # place (store.raise_finding) and no pass looked at its task
    store = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(store)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)

    class F:
        rule_id, entity_id, family, severity, summary, check, day = "PM-UNAVAILABLE", "sensor.x", "x", "P3", "X offline for 20 h", "look", ""

        def __init__(self):
            self.detail = {}

        def as_dict(self):
            return {k: getattr(self, k) for k in ("rule_id", "entity_id", "family", "severity", "summary", "detail", "check", "day")}
    (task,) = pb.record_night([F()], "2026-10-09", **rules)["task_ids"]
    pb.close_finding(store.open_finding("PM-UNAVAILABLE", "sensor.x"), "2026-10-10", "Cleared: back online.")
    rerun = pb.record_night([F()], "2026-10-09", **rules)
    assert rerun["task_ids"] == [task]
    assert store.task(task)["status"] == "open" and pb.unseen() == []


def test_a_night_check_edited_before_0_12_267_still_runs_and_still_moves_its_faults(tmp_path):
    # owner rule: a starter skill edited on a villa is kept by updates — the engine keeps reading its older shapes. The
    # lines below are the old nightly.py's and recheck.py's own (0.12.266), unpacking record_night / record
    import asyncio
    from helpers import make_agent
    from kiosk_fake import FakeKiosk
    from vesta_shared import result
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": 222, "name": "JM", "role": "fm"}]}, kiosk=k)
    store = Store(v.s.store_path)
    rules = dict(state_rules={"PM-UNAVAILABLE"}, event_rules=set(), worsened_step=15)

    def old_nightly(findings, day):
        night = Problems(store).record_night(findings, day, **rules,
                                             resolved_note="Cleared: the nightly check no longer sees it.")
        new, still_open, closed, tasks = night["new"], night["still_open"], night["closed"], night["tasks"]
        resolved = night["resolve_actions"]
        res = {"tasks_to_create": tasks, "tasks_resolved": [a["task_id"] for a in resolved], "resolve_actions": resolved,
               "reopen_actions": night["reopen_actions"]}
        actions = [result.fault(t["todo_summary"], task_id=t["task_id"], check=t.get("check"), entity_id=t.get("entity_id"))
                   for t in res["tasks_to_create"]]
        actions += res["resolve_actions"] + res.get("reopen_actions", [])
        asyncio.run(v.outcome.carry_out({"actions": actions}, "preventive-maintenance"))
        return actions

    def old_recheck(findings, day):
        rec = Problems(store).record(findings, day, **rules)
        return [result.fault(t["todo_summary"], task_id=t["task_id"], check=t.get("check"), entity_id=t.get("entity_id"))
                for t in rec["tasks"]] + rec["reopen_actions"]

    made = old_nightly([_F("PM-UNAVAILABLE", "switch.plug", "P2", summary="Plug offline")], "2026-10-07")
    assert [a["action"] for a in made] == ["ticket"] and k.tickets == [("Plug offline", "switch.plug")]
    gone = old_nightly([], "2026-10-08")
    assert [(a["action"], a["note"]) for a in gone] == [("ticket.resolve", "Cleared: the nightly check no longer sees it.")]
    assert k.resolved == ["t1"]
    back = old_nightly([_F("PM-UNAVAILABLE", "switch.plug", "P2", summary="Plug offline")], "2026-10-09")
    assert [a["action"] for a in back] == ["ticket.reopen"] and back[0]["title"].endswith("(again: 2 times in 7 days)")
    assert [t for t, _ in k.reopened] == ["t1"] and len(k.tickets) == 1           # its one fault, open again
    assert [a["action"] for a in old_recheck([_F("PM-UNAVAILABLE", "sensor.other", "P3")], "2026-10-09")] == ["ticket"]
