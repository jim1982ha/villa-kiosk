"""Both atomic-write helpers must fsync BEFORE os.replace.

⚠️ THIS PINS A SENTENCE THAT WAS FALSE FOR THE LIFE OF THE FILE. `write_json`
in `adapters/store.py` documented its duplication of the proxy's `atomic_write`
by claiming "the MECHANISM ... is reproduced exactly: same directory, fsync
before replace, temp file removed on failure". The proxy's copy never called
fsync at all, so the two implementations differed in the one property that
matters on a wall tablet that loses power: os.replace is atomic against a
READER, but the rename can reach the disk while the bytes it points at are
still in the page cache.

There is no way to assert this through either interface — a successful write
looks identical either way — so this reads the source, with prose stripped so
a COMMENT saying "fsync" can never satisfy it.
"""

import io
import os
import re

from conftest import REPO_ROOT, strip_prose

PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
STORE = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "adapters", "store.py")


def _body(path: str, name: str) -> str:
    """The source of one top-level `def`, comments and docstrings blanked."""
    code = strip_prose(io.open(path, encoding="utf-8").read())
    start = re.search(r"^(?:async )?def %s\b" % re.escape(name), code, re.M)
    assert start, "%s not found in %s" % (name, os.path.basename(path))
    rest = code[start.end():]
    nxt = re.search(r"^(?:async )?def ", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


HELPERS = [
    (PROXY, "atomic_write"),
    (PROXY, "atomic_write_async"),
    (STORE, "write_text"),
]


def test_every_atomic_helper_fsyncs():
    for path, name in HELPERS:
        body = _body(path, name)
        assert "os.fsync" in body, (
            "%s does not fsync — a power cut can leave the replaced file "
            "pointing at unwritten bytes" % name)


def test_fsync_comes_before_replace():
    """Order is the whole point: fsync AFTER the rename guarantees nothing."""
    for path, name in HELPERS:
        body = _body(path, name)
        assert "os.fsync" in body, "%s does not fsync at all" % name
        assert body.index("os.fsync") < body.index("os.replace"), (
            "%s fsyncs after os.replace, which is too late" % name)


def test_store_docstring_no_longer_claims_an_untrue_parity():
    """The docstring may describe the shared mechanism only while it holds.

    Guards the direction this was fixed in: the proxy gained the fsync. If a
    future edit removes it again, the two tests above go red — and this one
    exists so nobody 'fixes' them by deleting the claim instead.
    """
    src = io.open(STORE, encoding="utf-8").read()
    assert "fsync before" in src.replace("\n    ", " ")
