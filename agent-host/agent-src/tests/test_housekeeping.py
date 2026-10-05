"""What the agent keeps, and for how long (settings.keep; owner, 2026-10-06).

Before 0.6.41 nothing was deleted: every run, every record, every AI transcript, every
file in the out folder and every day of device figures grew for the life of the villa.
Each kind is driven here with one row or file just past its limit and one just inside.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timedelta, timezone

from helpers import settings
from vesta_agent import housekeeping
from vesta_agent.policy import KEEP, Policy, problems
from vesta_agent.state import State

NOW = datetime(2026, 10, 6, 3, 0, tzinfo=timezone.utc)
KEEP_DEFAULT = {k: d for k, (d, _, _) in KEEP.items()}


def at(days):
    return (NOW - timedelta(days=days)).isoformat()


def old_file(path, days):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("x")
    t = NOW.timestamp() - days * 86400
    os.utime(path, (t, t))


def test_each_kind_is_trimmed_at_its_own_limit(tmp_path):
    s = settings(str(tmp_path))
    for d in (s.data_dir, s.out_dir, s.claude_dir):
        os.makedirs(d, exist_ok=True)
    st = State(s.state_path)
    rows = [("run", 401), ("run", 399), ("refused", 91), ("voice", 89)]
    st.db.executemany("insert into calls(at, kind, detail) values(?,?,'{}')", [(at(d), k) for k, d in rows])
    st.db.executemany(
        "insert into approvals(id, created_at, expires_at, status, required_role, chat_id, action_hash, action)"
        " values(?,?,?,?, 'owner', 1, 'h', '{}')",
        [("old-done", at(91), at(91), "done"), ("old-pending", at(91), at(91), "pending"), ("new", at(5), at(5), "refused")])
    st.db.commit()
    old_file(os.path.join(s.claude_dir, "projects", "-work", "old.jsonl"), 31)
    old_file(os.path.join(s.claude_dir, "projects", "-work", "new.jsonl"), 29)
    old_file(os.path.join(s.claude_dir, "settings.json"), 400)            # the CLI's own settings: never touched
    old_file(os.path.join(s.out_dir, "events", "old.json"), 91)
    old_file(os.path.join(s.out_dir, "report-new.html"), 10)
    db = sqlite3.connect(s.store_path)
    db.execute("create table features(day text, entity_id text, family text, name text, value real, meta text)")
    db.executemany("insert into features values(?, 'sensor.x', 'power', 'kwh', 1, null)",
                   [((NOW - timedelta(days=d)).date().isoformat(),) for d in (800, 700)])
    db.commit(); db.close()

    gone = housekeeping.tidy(s, st, KEEP_DEFAULT, now=NOW)

    kinds = sorted((r["kind"], r["at"][:10]) for r in st.calls())
    assert kinds == [("run", at(399)[:10]), ("voice", at(89)[:10])], kinds
    assert sorted(r[0] for r in st.db.execute("select id from approvals")) == ["new", "old-pending"]
    assert os.listdir(os.path.join(s.claude_dir, "projects", "-work")) == ["new.jsonl"]
    assert os.path.exists(os.path.join(s.claude_dir, "settings.json"))
    assert not os.path.exists(os.path.join(s.out_dir, "events"))          # emptied, then removed
    assert os.path.exists(os.path.join(s.out_dir, "report-new.html"))
    left = [r[0] for r in sqlite3.connect(s.store_path).execute("select day from features")]
    assert left == [(NOW - timedelta(days=700)).date().isoformat()]
    assert gone == {"runs": 1, "records": 2, "conversations": 1, "files": 1, "daily_figures": 1}


def test_the_limits_are_the_villas_and_a_bad_one_keeps_its_default():
    p = Policy({"settings": {"keep": {"runs_days": 60, "files_days": 3}}})
    assert p.keep["runs_days"] == 60 and p.keep["files_days"] == KEEP["files_days"][0]
    assert any("settings.keep.files_days" in x for x in problems({"settings": {"keep": {"files_days": 3}}}))
    assert any("Unknown settings.keep.forever" in x for x in problems({"settings": {"keep": {"forever": 1}}}))
    assert not problems({"settings": {"keep": {"runs_days": 60}}})
    assert Policy({}).keep == KEEP_DEFAULT


def test_the_agent_tidies_at_start_and_every_night():
    import inspect
    from vesta_agent.app import Vesta
    assert "self.tidy()" in inspect.getsource(Vesta.rebuild_pack)
    assert "self.tidy()" in inspect.getsource(Vesta.main)


def test_no_stale_retention_promise_is_left_in_the_parameters():
    from vesta_shared.params import BEHAVIOUR_DEFAULTS
    assert not [k for k in BEHAVIOUR_DEFAULTS if "retention" in k]


def test_saving_the_rules_form_keeps_the_villas_limits():
    # the form has no keep fields: before 0.6.41 a save rewrote settings without them
    from vesta_agent.ui.policy_doc import apply_form, to_form
    import yaml
    text = "settings:\n  profile: auto\n  keep:\n    runs_days: 60\n"
    form = to_form(text)
    form["settings"]["profile"] = "economy"
    out = yaml.safe_load(apply_form(text, form))
    assert out["settings"]["keep"] == {"runs_days": 60} and out["settings"]["profile"] == "economy"
