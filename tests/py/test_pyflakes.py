"""No undefined names anywhere in the backend. Found by /dry-audit 2026-08-27.

⚠️ THE INSTANCE THIS PAYS FOR: `supervisor-proxy.py`'s concerns-for-the-briefing
helper ended in `except Exception: _log(...)` — and `_log` did not exist. The
one arm whose comment promised "a briefing must not fail for this" was the one
arm that raised, from v2.696.0 until this pin, and nothing could see it because
the happy path never enters the except block and Python resolves names at USE,
not at import. A NameError in an error handler is the exact shape a test of the
handler's happy path stays green through — `feedback_pin-the-caller`, one level
down: the caller existed, the NAME did not.

⚠️ UNDEFINED NAMES ONLY, DELIBERATELY. pyflakes also reports unused imports,
and three of those in this tree are deliberate and documented at their own
line: two module imports whose IMPORT is the point (`analysis.modules`
registers the analysis modules as a side effect, in `pipeline.py` and in the
proxy — each carries a `noqa: F401` and a comment saying why) and one
`from ..text import name_of as name_of` re-export in `narrate/style.py` that
other modules import from `style` by design. A pin on the unused-import class
would either fail on those three forever or need an exemption list that this
narrow class does not: an undefined name has no legitimate form.

⚠️ THE SELF-TEST IS THE VACUOUS-PASS GUARD. A checker invoked wrongly returns
no messages and reports health forever — four counters in this project read 0
for the exact case they existed to measure. So the suite first proves the
instrument fires on a snippet KNOWN to contain an undefined name, then believes
its silence about the tree.
"""

from __future__ import annotations

import os
from typing import List

import pytest

pyflakes_api = pytest.importorskip(
    "pyflakes.api", reason="pyflakes is the instrument; without it this "
    "pin cannot run and must say so rather than pass")
from pyflakes.messages import UndefinedName  # noqa: E402
from pyflakes.reporter import Reporter  # noqa: E402

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")


class _Collector(Reporter):
    """Keeps every flake message; ignores the stream arguments entirely."""

    def __init__(self) -> None:
        self.messages: List[object] = []

    def unexpectedError(self, filename, msg):  # noqa: N802 (pyflakes API)
        raise AssertionError(f"pyflakes could not read {filename}: {msg}")

    def syntaxError(self, filename, msg, lineno, offset, text):  # noqa: N802
        raise AssertionError(f"syntax error in {filename}:{lineno}: {msg}")

    def flake(self, message) -> None:
        self.messages.append(message)


def _backend_files() -> List[str]:
    """Every .py on DISK, not `git ls-files` — a new file is covered before it
    is staged, which is the direction `feedback_stage-before-gating` records
    this repo getting wrong with a tracked-only scan."""
    out: List[str] = []
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        out.extend(os.path.join(root, f) for f in files if f.endswith(".py"))
    return sorted(out)


def test_the_instrument_fires() -> None:
    """A snippet with a known undefined name MUST produce an UndefinedName."""
    collector = _Collector()
    pyflakes_api.check("def f():\n    return _no_such_name\n",
                       "<self-test>", collector)
    assert any(isinstance(m, UndefinedName) for m in collector.messages), (
        "pyflakes did not flag a known undefined name — the checker is being "
        "invoked wrongly and every other assertion here is vacuous")


def test_no_undefined_names_in_the_backend() -> None:
    files = _backend_files()
    # Vacuous-pass guard on the other side: an empty file set is a moved tree,
    # not a clean one.
    assert len(files) > 50, f"only {len(files)} backend files found — wrong root?"
    findings: List[str] = []
    for path in files:
        collector = _Collector()
        with open(path, encoding="utf-8") as handle:
            pyflakes_api.check(handle.read(), path, collector)
        findings.extend(
            f"{os.path.relpath(path, REPO_ROOT)}:{m.lineno}: "
            f"undefined name {m.message_args[0]!r}"
            for m in collector.messages if isinstance(m, UndefinedName))
    assert not findings, (
        "undefined name(s) in the backend — each is a NameError waiting on "
        "the code path that reaches it:\n  " + "\n  ".join(findings))
