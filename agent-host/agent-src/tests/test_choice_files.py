"""The owner's choice files of the Knowledge tab, one table (vesta_shared.choice_files; architecture review round 6,
2026-10-30): every row is written only when its check passes, recorded in Page changes, undoable, and read into the
pack by KnowledgePack.load — so a file added to the table cannot miss one of the places that used to be wired by hand."""
from __future__ import annotations

import os

import pytest
from helpers import settings
from vesta_agent.history import History
from vesta_agent.ui.changes import TEXT_KINDS, PageFiles, Refused, undoable
from vesta_shared.choice_files import BY_KIND, CHOICES
from vesta_shared.knowledge_pack import KnowledgePack, build_pack

#: one valid set of choices per row (an invented device): a row added to the table without one fails below
SAMPLE = {"kinds": {"example_pump": "motor"},
          "links": {"example_pump": {"schedule": "schedule.example_pump_hours"}}}


def test_every_row_has_a_sample_and_a_pack_method():
    assert set(SAMPLE) == set(BY_KIND)
    assert all(callable(getattr(KnowledgePack, c.apply, None)) for c in CHOICES)


@pytest.mark.parametrize("c", CHOICES, ids=lambda c: c.kind)
def test_a_choice_file_is_checked_recorded_undoable_and_read_with_the_pack(tmp_path, monkeypatch, c):
    s = settings(str(tmp_path))
    os.makedirs(s.data_dir, exist_ok=True)
    os.makedirs(s.config_dir, exist_ok=True)
    files = PageFiles(s, History(s.history_path))
    target = {"kind": c.kind}
    assert c.kind in TEXT_KINDS

    # checked: a text its module refuses is never written
    with pytest.raises(Refused):
        files.text_change("Knowledge", "broken", target, "a: [")
    assert not os.path.exists(s.choice_path(c.kind))

    # written where the agent reads it, recorded, undoable
    text = c.module.text_of(SAMPLE[c.kind])
    files.text_change("Knowledge", "set", target, text)
    with open(s.choice_path(c.kind), encoding="utf-8") as f:
        assert f.read() == text
    assert c.chosen(s.config_dir) == SAMPLE[c.kind]
    row = files.history.rows(1)[0]
    assert row["target"] == target and undoable(row)

    # read with the pack: its choices handed to the pack's method for them
    seen = {}
    monkeypatch.setattr(KnowledgePack, c.apply, lambda self, chosen: seen.setdefault(c.kind, chosen))
    with open(s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack({"entities": []}, []).to_json())
    KnowledgePack.load(s.pack_path, s.config_dir)
    assert seen == {c.kind: SAMPLE[c.kind]}

    # Undo puts it back as it was (no file)
    files.undo(row["id"])
    assert not os.path.exists(s.choice_path(c.kind))
