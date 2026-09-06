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

#: Every node oracle, now that they live somewhere a clone has.
#:
#: ⚠️ NINE OF THESE WERE AT `tests/<name>_test.ts` AND GITIGNORED (2.956.0), so
#: `npm run test:placement` and its eight siblings were `ERR_MODULE_NOT_FOUND`
#: on a fresh clone — while four module headers named one of them as the gate
#: their import-freedom exists to serve. `tests/consistency/` is tracked and is
#: reached from here, which is what makes them gates rather than local habits.
ORACLES = tuple(sorted(
    f for f in os.listdir(HARNESS) if f.endswith("_test.ts")
)) + ("villa_rules.ts",)


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


@pytest.mark.parametrize("oracle", ORACLES)
def test_every_node_oracle_passes(oracle):
    """⚠️ CI RUNS THESE NOW. They were local developer feedback and nothing said
    so — `test_villa_rules`'s own docstring is where the repository first
    admitted it. Ten suites, one parametrised gate."""
    node = shutil.which("node")
    if node is None:                                    # pragma: no cover
        pytest.skip("node is not installed; the TypeScript half cannot run")
    result = subprocess.run([node, "--import", REGISTER,
                             os.path.join(HARNESS, oracle)],
                            cwd=REPO_ROOT, capture_output=True, text=True,
                            timeout=180)
    assert result.returncode == 0, (
        "%s failed:\n%s\n%s" % (oracle, result.stdout[-4000:],
                                 result.stderr[-2000:]))


def test_every_oracle_is_tracked():
    """A suite outside the three tracked directories is absent on a clone and
    absent from CI, which is how nine of these spent a day looking like gates."""
    out = subprocess.run(["git", "ls-files", "tests/consistency"],
                         cwd=REPO_ROOT, capture_output=True, text=True).stdout
    tracked = {os.path.basename(line) for line in out.splitlines()}
    missing = sorted(set(ORACLES) - tracked)
    assert not missing, (
        "these oracles are not tracked, so CI on a fresh clone would not have "
        "them: %s" % missing)


def test_the_npm_scripts_point_at_tracked_files():
    """⚠️ THE OTHER HALF. A script naming a gitignored path is a command that
    only works on the machine that wrote it."""
    import json
    import re

    with open(os.path.join(REPO_ROOT, "package.json"), encoding="utf-8") as fh:
        scripts = json.load(fh).get("scripts", {})
    out = subprocess.run(["git", "ls-files"], cwd=REPO_ROOT,
                         capture_output=True, text=True).stdout.splitlines()
    tracked = set(out)
    broken = []
    for name, body in scripts.items():
        if not name.startswith("test:"):
            continue
        for path in re.findall(r"(tests/[\w./-]+\.(?:ts|mjs))", body):
            if path not in tracked:
                broken.append("%s -> %s" % (name, path))
    assert not broken, (
        "npm scripts naming untracked files — ERR_MODULE_NOT_FOUND on a fresh "
        "clone:\n  " + "\n  ".join(broken))
