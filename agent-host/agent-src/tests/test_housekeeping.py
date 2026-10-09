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
        [("old-done", at(91), at(91), "done"), ("old-pending", at(91), at(91), "pending"), ("new", at(5), at(5), "refused"),
         ("waiting", at(91), at(-1), "pending")])
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
    from vesta_agent.history import History
    h = History(s.history_path)
    h.record("Rules", "old", {"kind": "policy"}, "a", "b", at=at(91))
    h.record("Rules", "recent", {"kind": "policy"}, "a", "b", at=at(89))
    for name, days in (("old-skill-20260601", 91), ("new-skill-20261001", 10)):
        d = os.path.join(s.skills_dir, ".trash", name)
        os.makedirs(d)
        os.utime(d, (NOW.timestamp() - days * 86400,) * 2)

    gone = housekeeping.tidy(s, st, KEEP_DEFAULT, now=NOW)

    kinds = sorted((r["kind"], r["at"][:10]) for r in st.calls())
    assert kinds == [("run", at(399)[:10]), ("voice", at(89)[:10])], kinds
    # an approval nobody pressed goes once it has long expired (architecture review 16: it stayed forever); one
    # still within its time stays, however old
    assert sorted(r[0] for r in st.db.execute("select id from approvals")) == ["new", "waiting"]
    assert os.listdir(os.path.join(s.claude_dir, "projects", "-work")) == ["new.jsonl"]
    assert os.path.exists(os.path.join(s.claude_dir, "settings.json"))
    assert not os.path.exists(os.path.join(s.out_dir, "events"))          # emptied, then removed
    assert os.path.exists(os.path.join(s.out_dir, "report-new.html"))
    left = [r[0] for r in sqlite3.connect(s.store_path).execute("select day from features")]
    assert left == [(NOW - timedelta(days=700)).date().isoformat()]
    assert [r["what"] for r in h.rows()] == ["recent"]                     # the page's changes: the records' limit
    assert os.listdir(os.path.join(s.skills_dir, ".trash")) == ["new-skill-20261001"]
    assert gone == {"runs": 1, "records": 3, "conversations": 1, "files": 1, "daily_figures": 1, "page changes": 1,
                    "skills in the trash": 1}



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
    # the thresholds are each skill's own now (settings.yaml / rules.yaml `behaviour:`, architecture review 7)
    import glob
    import yaml
    from helpers import STARTER_SKILLS
    from vesta_shared import skill_settings
    keys = [k for d in glob.glob(os.path.join(STARTER_SKILLS, "*")) for f in ("settings.yaml", "rules.yaml")
            for k in skill_settings.behaviour(skill_settings.load(d, f))]
    assert keys and not [k for k in keys if "retention" in k]


def test_saving_the_rules_form_keeps_the_villas_limits():
    # the form has no keep fields: before 0.6.41 a save rewrote settings without them
    from vesta_agent.ui.policy_doc import apply_form, to_form
    import yaml
    text = "settings:\n  profile: auto\n  keep:\n    runs_days: 60\n"
    form = to_form(text)
    form["settings"]["profile"] = "economy"
    out = yaml.safe_load(apply_form(text, form))
    assert out["settings"]["keep"] == {"runs_days": 60} and out["settings"]["profile"] == "economy"


def test_a_skill_trashed_today_is_kept_whatever_the_age_of_its_files(tmp_path):
    # owner, 2026-10-06 (DRY): the trash is trimmed by the same helper and limit as the out folder; its folders are
    # judged whole, by the day they went there (skills.to_trash), not file by file
    from vesta_agent.skills import TRASH, to_trash
    s = settings(str(tmp_path))
    old = os.path.join(s.skills_dir, "pool-care")
    os.makedirs(os.path.join(old, "scripts"))
    for f in ("SKILL.md", "scripts/x.py"):
        open(os.path.join(old, f), "w").close()
        os.utime(os.path.join(old, f), (1, 1))                  # 1970: older than any limit
    os.utime(old, (1, 1))
    to_trash(s.skills_dir, old, "pool-care")
    gone = housekeeping.tidy(s, State(s.state_path), KEEP_DEFAULT)
    (kept,) = os.listdir(os.path.join(s.skills_dir, TRASH))
    assert kept.startswith("pool-care-") and gone["skills in the trash"] == 0
    assert sorted(os.listdir(os.path.join(s.skills_dir, TRASH, kept))) == ["SKILL.md", "scripts"]
