"""Every repo path a CI step names must exist in the tree.

⚠️ THIS FILE EXISTS BECAUSE THE TYPE GATE CHECKED NOTHING FOR MONTHS AND
NOTHING SAID SO (/dry-audit, 2026-09-01). `.github/workflows/ci.yaml` ran
`mypy --strict rootfs/usr/bin/reports`; TASK-115 step 3c deleted that directory
and moved the package to `vesta/adapters` + `vesta/brief`, and the workflow was
not repointed. mypy then exited 2 with "Cannot read file" — so the gate was not
merely lenient, it was ABSENT, and `--strict` on the Python backend is one of
only two automated gates this project has beyond the security suite.

⚠️ IT IS THE SHAPE dry-audit PART 5 EXISTS FOR: a rule whose two halves live in
different files, in different languages, joined by nothing but a string literal
— here a YAML scalar and a directory. Its siblings cover the store envelope,
the nginx routes, the modal shell, the consistency parity and several wire
contracts; the workflow was the one contract of that shape with nothing
watching it. A path that drifts is silent by construction, because the step that would
have complained is the step that stopped running.

⚠️ AND IT IS `feedback_moving-files-silences-guards` IN ITS MOST LITERAL FORM.
The restructure that moved the package is the same restructure that silenced
`test_docs_current`. Moving files is this repo's recurring way of switching a
guard off, and the guard never announces it.
"""

from __future__ import annotations

import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
WORKFLOWS = os.path.join(REPO_ROOT, ".github", "workflows")

#: ⚠️ DERIVED, NEVER LISTED — the same rule prose.sh states about its own
#: scope. Hardcoding `(rootfs|src|tests)` is how the first version of the
#: managed-prose probe went blind to two real top-level directories while
#: reporting all clear. A top-level directory added tomorrow is covered on the
#: day it is created.
def _top_level_dirs() -> set[str]:
    return {
        name
        for name in os.listdir(REPO_ROOT)
        if os.path.isdir(os.path.join(REPO_ROOT, name)) and not name.startswith(".git")
    }


def _run_steps() -> list[tuple[str, str]]:
    """(workflow filename, run: body) for every step that runs a command."""
    steps: list[tuple[str, str]] = []
    for path in sorted(glob.glob(os.path.join(WORKFLOWS, "*.y*ml"))):
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        # `run: cmd` and `run: |` blocks alike — take the scalar or the block
        # body up to the next key at the same or lower indentation.
        for match in re.finditer(r"^(\s*)run:\s*(\|[-+]?\s*)?(.*)$", source, re.M):
            indent, block, inline = match.groups()
            if not block:
                steps.append((os.path.basename(path), inline))
                continue
            tail = source[match.end():].split("\n")
            body = []
            for line in tail:
                if line.strip() and not line.startswith(indent + " "):
                    break
                body.append(line)
            steps.append((os.path.basename(path), "\n".join(body)))
    return steps


def _cited_paths() -> set[tuple[str, str, str]]:
    """(workflow, step body, repo-relative path) for every path a step names."""
    tops = _top_level_dirs()
    if not tops:
        return set()
    # ⚠️ THE TRAILING-SLASH FORM COUNTS. The offline job greps `src/` — if that
    # directory ever moves, the grep matches nothing, exits clean and the
    # "no third-party host" check passes VACUOUSLY. That is the same defect as
    # the stale mypy path wearing different clothes, so `src/` is as much a
    # path claim as `rootfs/usr/bin/vesta/brief` and the regex must reach it.
    rx = re.compile(r"(?<![\w/.])((?:" + "|".join(map(re.escape, sorted(tops)))
                    + r")/[A-Za-z0-9_./-]*)")
    cited: set[tuple[str, str, str]] = set()
    for workflow, body in _run_steps():
        for candidate in rx.findall(body):
            # a glob or a shell variable is not a literal path claim
            if any(ch in candidate for ch in "*$"):
                continue
            cited.add((workflow, body.strip().splitlines()[0][:70], candidate.rstrip(".,;:'\"")))
    return cited


def test_every_path_a_ci_step_names_exists() -> None:
    cited = _cited_paths()

    # ⚠️ VACUOUS-PASS GUARD, AND IT IS NOT OPTIONAL. A source-reading test whose
    # anchors move compares two empty sets and reports health forever — this
    # project has had four counters read 0 for the exact case they existed to
    # measure.
    # ⚠️ THE THRESHOLDS ARE MEASURED, NOT GUESSED. On 2026-09-01 the workflows
    # parse to 10 `run:` steps naming 5 distinct repo paths. The first draft of
    # this guard asserted >= 8 paths from imagination, went red on a healthy
    # tree, and would have been "fixed" by lowering it until it passed — which
    # is how a guard becomes decoration. Half of each measured value catches a
    # parse collapse without restating today's count.
    steps = _run_steps()
    assert len(steps) >= 6, (
        f"only {len(steps)} `run:` step(s) parsed (10 on 2026-09-01) — the "
        f"parse or the workflow layout moved, so this test measures nothing"
    )
    assert len(set(p for _, _, p in cited)) >= 4, (
        f"only {len(set(p for _, _, p in cited))} distinct CI path(s) found "
        f"(5 on 2026-09-01) — the top-level-dir derivation collapsed"
    )

    missing = sorted(
        f"{workflow}: `{step}` names {path!r}, which does not exist"
        for workflow, step, path in cited
        if not os.path.exists(os.path.join(REPO_ROOT, path))
    )
    assert not missing, "\n".join(missing)


def test_the_type_gate_still_covers_the_reports_package() -> None:
    """The gate's SCOPE, not just its syntax.

    ⚠️ A PATH THAT EXISTS IS NOT A GATE THAT COVERS ANYTHING. Repointing the
    stale `mypy --strict` at any real directory would satisfy the test above
    while checking a fraction of what it used to. The reports package became
    `adapters` + `brief` at TASK-115, and both must stay COVERED — named
    outright, or contained by something named — or the gate quietly narrows the
    next time something moves. It is covered today by the whole `vesta`
    package, which is wider than either half; that is why this asks about
    containment rather than about the two strings.
    """
    assert os.path.exists(os.path.join(WORKFLOWS, "ci.yaml")), (
        "ci.yaml moved — this test's anchor is gone"
    )
    types_step = [
        body for _workflow, body in _run_steps() if "mypy --strict" in body
    ]
    assert types_step, "no `mypy --strict` step in any workflow — the type gate is gone"

    command = "\n".join(types_step)

    # ⚠️ COVERAGE, NOT A LITERAL. The first version asserted the two
    # subdirectory strings appeared verbatim, which would have gone RED on a
    # gate widened to the whole package — a pin that fails when the thing it
    # guards gets stronger is a pin nobody keeps. What must hold is that every
    # required path is named OR sits under something named.
    targets = [t for t in re.findall(r"(rootfs/[A-Za-z0-9_./-]+)", command)]
    assert targets, "the --strict step names no path at all"
    for required in ("rootfs/usr/bin/vesta/adapters", "rootfs/usr/bin/vesta/brief"):
        covered = any(required == t or required.startswith(t.rstrip("/") + "/")
                      for t in targets)
        assert covered, (
            f"the --strict gate no longer covers {required!r} (targets: "
            f"{targets}). The reports package is both halves; dropping one, or "
            f"narrowing to a subdirectory of it, weakens the gate silently."
        )
    # ⚠️ THE COMMAND, NOT THE FILE. The first draft read the whole of ci.yaml
    # and went red on the ⚠️ COMMENT that explains why the dead path must never
    # come back — a test matching the sentence that describes the thing it
    # checks, which `test_modal_shell` records as having happened five times
    # here already. Prose may name the deleted path; only the `run:` body may
    # not. The general form of this is already covered by the first test, which
    # would fail on any non-existent path; this states the specific regression.
    assert "usr/bin/reports" not in command, (
        "`rootfs/usr/bin/reports` is back in a run: step — it was deleted at "
        "TASK-115 step 3c and naming it makes mypy exit 2, disabling the gate"
    )
