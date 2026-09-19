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
