"""Run the front-end rules that decide what the villa IS, in CI.

⚠️ THE NODE SUITES ARE NOT A GATE, AND UNTIL NOW NOTHING SAID SO. `tests/*` is
gitignored with exactly three exceptions (`tests/py`, `tests/qa`,
`tests/consistency`), so `tests/badge_placement_test.ts` and its siblings are
absent on a fresh clone — and CI runs only `pytest tests/py`, `mypy --strict`
and the offline checks. Those suites are local developer feedback, which is a
fine thing to be; they are just not what stops a regression reaching `main`.

`tests/consistency/villa_rules.ts` is tracked, so this file can run it. That is
the same shape `test_consistency_parity.py` already uses for `kiosk_view.ts`.

What it covers, none of which was executed before: `selectableDeviceIds` (21
callers in src/, zero assertions), `SWITCH_PURPOSE_HINTS` (one table deciding
the badge colour AND the 3D glyph — two adapters, so a real seam, held by
nothing), and the empty-seed rule that this repo has already shipped a bug
against ("stale entities I can't get rid of").
"""

import os
import shutil
import subprocess

import pytest

from conftest import REPO_ROOT

HARNESS = os.path.join(REPO_ROOT, "tests", "consistency")
REGISTER = os.path.join(HARNESS, "register.mjs")
SUITE = os.path.join(HARNESS, "villa_rules.ts")


def _run():
    node = shutil.which("node")
    if node is None:                                    # pragma: no cover
        pytest.skip("node is not installed; the TypeScript half cannot run")
    return subprocess.run([node, "--import", REGISTER, SUITE],
                          cwd=REPO_ROOT, capture_output=True, text=True,
                          timeout=180)


def test_the_suite_is_present_and_tracked():
    """⚠️ ITS ABSENCE MUST NOT LOOK LIKE A PASS. A suite living outside the
    three tracked directories vanishes on a fresh clone, and a test that
    silently skipped would report green for a gate that is not there."""
    assert os.path.exists(SUITE), SUITE
    tracked = subprocess.run(
        ["git", "ls-files", "tests/consistency/villa_rules.ts"],
        cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
    assert tracked, (
        "villa_rules.ts is not tracked, so CI on a fresh clone would not have "
        "it — put it under tests/consistency/, tests/py/ or tests/qa/")


def test_the_villa_rules_hold():
    result = _run()
    assert result.returncode == 0, (
        "the front-end villa rules failed:\n%s\n%s"
        % (result.stdout[-4000:], result.stderr[-2000:]))


def test_the_suite_actually_asserted_something():
    """⚠️ A SUITE THAT ASSERTS NOTHING IS THE FAILURE MODE THIS REPLACES.

    `test:consistency` — the only other node suite reachable from CI — prints a
    fixture view and asserts nothing; its real gate is the parity comparison in
    `test_consistency_parity.py`. This one carries its own assertions, so the
    thing to guard is that they ran at all rather than that the process exited
    0 having done nothing.
    """
    result = _run()
    passes = result.stdout.count("\nok    ") + result.stdout.count("ok    ")
    assert passes >= 25, (
        "expected the villa-rules suite to make many assertions; counted %d.\n%s"
        % (passes, result.stdout[-2000:]))
    assert "ALL PASS" in result.stdout
