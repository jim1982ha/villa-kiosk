"""The owner's folder: it exists, it explains itself, and it is never clobbered."""
from agent.workspace import README, prepare


def test_it_writes_a_readme_the_owner_can_read(tmp_path):
    assert prepare(tmp_path) == tmp_path
    text = (tmp_path / "README.md").read_text()
    assert "This folder is yours" in text
    # It must say where the SETTINGS live, since that is the question an owner
    # arrives with and the answer is not in this folder.
    assert "Configuration" in text


def test_it_NEVER_touches_anything_the_owner_put_there(tmp_path):
    """⚠️ THE WHOLE POINT OF IT BEING THEIRS. An add-on that rewrites a folder
    it advertises as the owner's is an add-on that eats work."""
    mine = tmp_path / "electrical"
    mine.mkdir()
    (mine / "standby.md").write_text("my own skill, do not touch")
    prepare(tmp_path)
    assert (mine / "standby.md").read_text() == "my own skill, do not touch"


def test_a_missing_mapping_is_NAMED_not_silently_skipped(tmp_path, capsys):
    """⚠️ THE DEFECT THAT PROMPTED THIS MODULE. The manifest mapped no folder at
    all, so the place ticket 27 tells owners to edit did not exist. If that ever
    regresses, the add-on says so in its own log rather than starting as though
    everything were fine."""
    assert prepare(tmp_path / "not-mounted") is None
    assert "missing its `addon_config` mapping" in capsys.readouterr().out


def test_the_readme_is_rewritten_when_it_is_stale(tmp_path):
    (tmp_path / "README.md").write_text("an old edition")
    prepare(tmp_path)
    assert (tmp_path / "README.md").read_text() == README


def test_an_unchanged_readme_is_not_rewritten(tmp_path):
    """A folder somebody is watching should not report a change on every
    restart of the add-on."""
    prepare(tmp_path)
    before = (tmp_path / "README.md").stat().st_mtime_ns
    prepare(tmp_path)
    assert (tmp_path / "README.md").stat().st_mtime_ns == before


def test_a_read_only_folder_does_not_stop_the_add_on(tmp_path):
    import os
    root = tmp_path / "ro"
    root.mkdir()
    os.chmod(root, 0o500)
    try:
        assert prepare(root) == root      # must not raise
    finally:
        os.chmod(root, 0o700)


# ── the starter Skills ─────────────────────────────────────────────────────

def test_the_starter_skills_are_copied_in_on_a_fresh_folder(tmp_path):
    from agent.workspace import SHIPPED_SKILLS, seed_skills
    n = seed_skills(tmp_path)
    assert n >= 5, "a starter set of one is not a starter set"
    assert (tmp_path / "water" / "unexpected-flow.md").exists()
    # Every shipped file landed, in its own department folder.
    shipped = {f"{p.parent.name}/{p.name}" for p in SHIPPED_SKILLS.glob("*/*.md")}
    landed = {f"{p.parent.name}/{p.name}" for p in tmp_path.glob("*/*.md")}
    assert shipped == landed


def test_they_are_copied_ONCE_and_a_deletion_stays_deleted(tmp_path):
    """⚠️ AN ADD-ON THAT RESTORES ITS OWN FILES EVERY RESTART EATS EDITS. "I
    deleted that and it came back" is the complaint the hard rule's
    prefer-an-empty-default note exists to prevent, arriving by another road."""
    from agent.workspace import seed_skills
    seed_skills(tmp_path)
    victim = tmp_path / "water" / "unexpected-flow.md"
    victim.unlink()
    assert seed_skills(tmp_path) == 0
    assert not victim.exists(), "a deleted starter Skill came back"


def test_an_owners_edit_is_never_overwritten(tmp_path):
    from agent.workspace import seed_skills
    mine = tmp_path / "water" / "unexpected-flow.md"
    mine.parent.mkdir(parents=True)
    mine.write_text("my own version")
    seed_skills(tmp_path)
    assert mine.read_text() == "my own version"


def test_not_one_starter_skill_names_a_device_or_a_threshold(tmp_path):
    """⚠️ THE FIRST HARD RULE, APPLIED TO PROSE. These ship to every install, so
    a device name, an entity id or a number tuned to one property would be one
    villa's configuration shipped to all of them. `tests/hard-rules.py` scans
    them once tracked; this is the readable half of the same check."""
    import re
    from agent.workspace import SHIPPED_SKILLS

    entity = re.compile(r"\b(sensor|switch|light|binary_sensor|climate|lock|cover)\.[a-z0-9_]{3,}")
    for path in SHIPPED_SKILLS.glob("*/*.md"):
        text = path.read_text()
        assert not entity.search(text), f"{path.name} names an entity id"
        # A bare number with a unit is the shape of a tuned threshold.
        assert not re.search(r"\b\d+\s*(kWh|W|°C|°F|litres|L/min|%)\b", text), \
            f"{path.name} carries a tuned number"


def test_every_starter_skill_states_what_it_does_NOT_cover(tmp_path):
    """Ticket 29's rule, and the reason Coverage can ever be honest: a Skill
    that does not state its edges makes the property look more watched than it
    is."""
    from agent.workspace import SHIPPED_SKILLS
    for path in SHIPPED_SKILLS.glob("*/*.md"):
        text = path.read_text()
        assert "## What it does not cover" in text, f"{path.name} claims no edges"
        assert "enabled: true" in text, f"{path.name} has no enabled flag"


def test_prepare_finds_the_folder_under_either_name(tmp_path, monkeypatch):
    """Supervisor mounts it at /config in the container; the File editor shows
    it as /addon_configs/<slug>. Both are the same folder."""
    import agent.workspace as ws
    monkeypatch.setattr(ws, "WORKSPACE_CANDIDATES", (tmp_path / "nope", tmp_path))
    assert ws.find_workspace() == tmp_path
