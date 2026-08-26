"""Every Python file must PARSE under the oldest interpreter that runs it.

⚠️ THE INSTANCE THIS PAYS FOR (2026-08-27): `test_ui_consistency.py` held a
multi-line expression inside an f-string — legal since Python 3.12 (PEP 701),
a SyntaxError on the 3.11 CI runner. The local gate ran a 3.12 venv and stayed
green; CI failed at COLLECTION, which killed every test in the file, and the
error surfaced only when the owner tried to deploy. A grammar gap between the
venv and CI is invisible to every suite that runs in the venv, by construction.

⚠️ A REAL 3.11 INTERPRETER OR A LOUD SKIP — NEVER `ast.feature_version`. That
flag is documented best-effort and was CHECKED against the exact defect above:
`ast.parse(bad, feature_version=(3, 11))` accepts it. A pin built on it would
pass while measuring nothing, which is this suite's most-recorded failure
shape. So: if a `python3.11` binary exists (it does on the dev machine, and CI
*is* 3.11 so pytest itself enforces the grammar there), compile every file
under it; otherwise skip with a sentence, so "not checked" never reads as
"clean".

⚠️ WHY 3.11 SPECIFICALLY: it is the version CI's workflow installs. If CI
moves, move `TARGET` — the assertion below that the self-test snippet FAILS is
what will notice if the moved target makes the whole check moot.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
from typing import List

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TARGET = "python3.11"
_interp = shutil.which(TARGET)

pytestmark = pytest.mark.skipif(
    _interp is None,
    reason=f"no {TARGET} on PATH — the grammar gate cannot run here; CI runs "
           f"{TARGET} natively and enforces it at collection")

#: A snippet that is valid 3.12 (PEP 701) and a SyntaxError on 3.11 — the
#: exact shape of the shipped defect. The self-test proves the interpreter
#: really applies the old grammar before the sweep's silence is believed.
_KNOWN_BAD = "x = f\"{sorted({'a','b',\n 'c'} - s)}\"\n"

_CHECKER = r"""
import sys
fail = False
for path in sys.argv[1:]:
    try:
        with open(path, encoding="utf-8") as h:
            compile(h.read(), path, "exec")
    except SyntaxError as e:
        print(f"{path}:{e.lineno}: {e.msg}")
        fail = True
sys.exit(1 if fail else 0)
"""


def _files() -> List[str]:
    out: List[str] = []
    for pattern in ("tests/py/*.py", "rootfs/usr/bin/**/*.py",
                    "tests/evals/**/*.py"):
        out.extend(p for p in glob.glob(os.path.join(REPO_ROOT, pattern),
                                        recursive=True)
                   if "__pycache__" not in p)
    return sorted(set(out))


def test_the_old_grammar_is_really_applied() -> None:
    """The 3.11 interpreter MUST reject the known-bad snippet."""
    probe = subprocess.run(
        [_interp, "-c", f"compile({_KNOWN_BAD!r}, '<probe>', 'exec')"],
        capture_output=True, text=True)
    assert probe.returncode != 0 and "SyntaxError" in probe.stderr, (
        f"{TARGET} accepted a PEP 701 f-string — either TARGET has moved past "
        f"3.11 and this gate checks nothing, or the probe is broken:\n"
        f"{probe.stderr}")


def test_every_python_file_parses_under_3_11() -> None:
    files = _files()
    assert len(files) > 100, f"only {len(files)} files found — wrong root?"
    result = subprocess.run([_interp, "-c", _CHECKER, *files],
                            capture_output=True, text=True)
    assert result.returncode == 0, (
        "file(s) that will fail CI's interpreter at collection:\n"
        + result.stdout)
