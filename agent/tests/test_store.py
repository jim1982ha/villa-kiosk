"""State under /data: files, because a villa has no tooling to inspect a db."""
import json

import pytest

from agent.store import Store


def test_a_round_trip(tmp_path):
    s = Store(tmp_path)
    s.put("incidents", {"open": 2})
    assert s.get("incidents") == {"open": 2}


def test_reading_what_was_never_written_is_the_default_not_a_crash(tmp_path):
    s = Store(tmp_path)
    assert s.get("nothing") is None
    assert s.get("nothing", default={}) == {}


def test_the_root_is_configurable_so_a_test_never_touches_slash_data(tmp_path):
    a, b = Store(tmp_path / "a"), Store(tmp_path / "b")
    a.put("k", {"which": "a"})
    assert b.get("k") is None


def test_a_half_written_file_can_never_be_read(tmp_path):
    """⚠️ ATOMIC, BECAUSE THE POWER GOES OFF IN A VILLA. A plain open-and-write
    leaves a truncated JSON file when the add-on is killed mid-write, and every
    later start reads it and fails. Write a tempfile, then rename."""
    s = Store(tmp_path)
    s.put("k", {"v": 1})
    target = tmp_path / "k.json"
    # Nothing but the finished file is left behind.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["k.json"]
    assert json.loads(target.read_text()) == {"v": 1}


def test_an_unreadable_file_yields_the_default_rather_than_taking_the_layer_down(tmp_path):
    s = Store(tmp_path)
    (tmp_path / "k.json").write_text("{ truncated")
    assert s.get("k", default={"safe": True}) == {"safe": True}


def test_a_key_cannot_escape_the_root(tmp_path):
    """A key is a name, not a path. `../../etc/passwd` is a bug, not a feature."""
    s = Store(tmp_path)
    with pytest.raises(ValueError):
        s.put("../escape", {})
    with pytest.raises(ValueError):
        s.get("nested/key")


def test_appending_to_a_journal(tmp_path):
    s = Store(tmp_path)
    s.append("events", {"n": 1})
    s.append("events", {"n": 2})
    assert s.get("events") == [{"n": 1}, {"n": 2}]


def test_the_journal_is_bounded_so_a_villa_disk_cannot_fill(tmp_path):
    s = Store(tmp_path)
    for n in range(10):
        s.append("events", {"n": n}, keep=3)
    kept = s.get("events")
    assert [e["n"] for e in kept] == [7, 8, 9]
