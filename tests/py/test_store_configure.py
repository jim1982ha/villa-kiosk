"""`store.configure()` must relocate EVERY store, not six of them.

⚠️ NO TEST CALLED THIS FUNCTION AT ALL until an architecture review found it.
Its docstring promised "point every store at a different directory"; its
implementation rewrote `*_FILE` names in its own module namespace only. Six
constants moved and twenty did not — concerns, audit, budget, the journal,
flag types, the villa memory, the learned playbook tree, the review queues and
the 0600 credentials file all kept writing to /data.

The suite had already learned the defect and routed around it: 24 files
monkeypatch individual path constants, and `test_subject_identity.py` says why
out loud ("the path constants are derived at import time, so patching the root
alone still writes to /data"). That workaround is correct for a single test;
what it cannot do is fail when a NEW store forgets to join.
"""

import importlib
import io
import os
import pkgutil
import re
import sys

import pytest

from conftest import REPO_ROOT

from vesta.adapters import store

#: Every module in the package, imported so `configure`'s walk can see it.
#: The walk is over LOADED modules by design (see its docstring), so a test
#: that imported only a handful would prove far less than it appears to.
def _import_everything():
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    names = []
    for mod in pkgutil.walk_packages([root], prefix="vesta."):
        if ".llm." in mod.name:
            continue          # optional provider SDKs, not present in CI
        try:
            importlib.import_module(mod.name)
            names.append(mod.name)
        except Exception:
            pass              # a module with an unmet optional dep is not our subject
    return names


def _path_constants():
    """Every loaded `vesta.*` constant that holds a path into the data root."""
    found = []
    for name, module in list(sys.modules.items()):
        if not (name == "vesta" or name.startswith("vesta.")) or module is None:
            continue
        for attr, value in list(vars(module).items()):
            if attr.endswith(store._PATH_SUFFIXES) and isinstance(value, str):
                found.append((name, attr, value))
    return found


def test_configure_moves_every_store(tmp_path, monkeypatch):
    _import_everything()
    before = _path_constants()
    rooted = [(m, a, v) for m, a, v in before if v == "/data" or v.startswith("/data/")]
    assert len(rooted) >= 20, (
        "expected the package to hold many /data-rooted constants; found %d — "
        "has the naming convention changed?" % len(rooted))

    new_root = str(tmp_path / "srv")
    try:
        store.configure(data_dir=new_root)
        after = dict(((m, a), v) for m, a, v in _path_constants())
        stragglers = [
            "%s.%s = %s" % (m, a, after[(m, a)])
            for m, a, _ in rooted
            if not str(after.get((m, a), "")).startswith(new_root)
        ]
        assert not stragglers, (
            "configure() left %d store(s) writing to /data:\n  %s"
            % (len(stragglers), "\n  ".join(stragglers)))
    finally:
        store.configure(data_dir="/data")


def test_the_credentials_file_is_not_left_behind(tmp_path):
    """⚠️ THE SHARPEST CASE. secrets.py carried a comment warning that a
    captured copy "would keep writing secrets to the old root" — and then, on
    the next line, captured one. It is the 0600 file."""
    from vesta.adapters import secrets

    new_root = str(tmp_path / "srv")
    try:
        store.configure(data_dir=new_root)
        assert secrets.SECRETS_FILE.startswith(new_root), secrets.SECRETS_FILE
    finally:
        store.configure(data_dir="/data")


def test_configure_is_reversible_and_ignores_an_empty_root():
    """Startup-only, but it must not corrupt state when handed nothing."""
    before = store.DATA_DIR
    store.configure(data_dir="")
    assert store.DATA_DIR == before


def test_no_store_roots_itself_on_a_bare_literal():
    """A late import must follow too.

    `configure`'s walk covers modules already loaded; a module imported AFTER
    it derives its own paths from DATA_DIR at import. Both halves only hold if
    no constant hardcodes the root, so this pins the source.
    """
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    offenders = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith(".py"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            if rel == os.path.join("adapters", "store.py"):
                continue      # the one module allowed to name the root
            src = io.open(full, encoding="utf-8").read()
            for m in re.finditer(r'^([A-Z_]+(?:FILE|PATH|ROOT|DIR))\s*(?::[^=]+)?=\s*"(/data[^"]*)"',
                                 src, re.M):
                offenders.append("%s: %s = %s" % (rel, m.group(1), m.group(2)))
    assert not offenders, (
        "these constants hardcode the data root, so store.configure() cannot "
        "reach them on a late import:\n  " + "\n  ".join(offenders))
