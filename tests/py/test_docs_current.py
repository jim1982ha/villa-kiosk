"""The docs cannot quietly go stale. TASK-100's durable half.

⚠️ `docs/` IS GITIGNORED (ADR-018), SO EVERY TEST HERE SKIPS WHEN IT IS ABSENT.
A fresh clone has none of this folder and that is not an error — `CLAUDE.md` says
so in as many words. A test that failed on a clean checkout would be deleted
within a week, and the check with it.

⚠️ IT CHECKS CLAIMS A MACHINE CAN SETTLE, AND NOTHING ELSE. A `TASK-nnn` that
does not exist, a `REQ-nnn` that does not exist, a version ahead of
`package.json`, a source path that is not tracked. Prose that has quietly stopped
being true is not reachable from here and never will be — what this buys is that
the CHECKABLE half cannot rot, which is the half that had:

  * `README.md` claiming "79 tasks" and "574 rows" long after both moved, and
    claiming the ledger is "never overwritten by a rebuild" after it was;
  * `REQ-051`–`054` citing `TASK-086`/`TASK-087`, ids that have never existed,
    through every build that printed "no orphans, no unknown ids";
  * `PROGRESS.md` reporting a hand-counted "57 of 79" in a file whose own rule,
    three paragraphs below it, is that such a claim must be derived.

⚠️ AND THE FIX FOR A HIT IS USUALLY TO DELETE THE NUMBER, NOT TO UPDATE IT. A
count duplicated from something generated is a second source of truth with no
owner; the build prints every one of them on each run.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Dict, List, Set

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(REPO_ROOT, "docs")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(os.path.join(DOCS, "refdata")),
    reason="docs/ is gitignored and absent — not an error (ADR-018)")

#: Files that are finished records rather than descriptions of now. ⚠️ THEY ARE
#: STILL CHECKED for ghost ids and dead paths — an archive naming a task that
#: never existed is as misleading as a live document doing it — but they are
#: exempt from the "no stale version" rule, because naming the release they were
#: written against is the whole point of an archive.
#: ⚠️ REWRITTEN WHEN `docs/` WAS REORGANISED (2026-08-27), AND THIS TEST IS
#: WHAT CAUGHT THE REORGANISATION GOING STALE. It named five files that had
#: just been merged or moved, which is precisely the rot it exists to find —
#: turned on the list itself rather than on a document.
#:
#: The seven PH1–PH5 checkpoints are now one merged record, and the finished
#: compliance/validation/rollback documents moved to `docs/archive/`. That
#: folder needs no entry here: `_docs()` lists the TOP LEVEL only, so anything
#: moved into it leaves this check's scope entirely — which is the point of
#: moving it.
ARCHIVES: Set[str] = {
    "CHECKPOINTS.md",
}

#: Ids a document may name BECAUSE they do not exist — the finding IS that they
#: do not. ⚠️ Without this, recording a ghost-id defect would fail the very
#: check that found it.
NAMED_GHOSTS: Dict[str, Set[str]] = {
    # ⚠️ VALIDATION.md moved to `docs/archive/` on 2026-08-27 and is no longer
    # scanned, so this entry is inert. Kept rather than deleted: if the file is
    # ever brought back the exemption must come with it, and a dead key here
    # costs nothing — unlike ARCHIVES above, nothing asserts this list is live.
    "VALIDATION.md": {"TASK-086", "TASK-087"},
    "README.md": {"TASK-086", "TASK-087"},
}


def _docs() -> List[str]:
    return sorted(f for f in os.listdir(DOCS) if f.endswith(".md"))


def _read(name: str) -> str:
    # ⚠️ `errors="replace"`. One of these files carries a degree sign in a
    # legacy encoding, and a decode error here would present as "the docs check
    # is broken" rather than as one byte in one line.
    return open(os.path.join(DOCS, name), encoding="utf-8",
                errors="replace").read()


def _catalogue() -> Dict[str, Set[str]]:
    sys.path.insert(0, DOCS)
    from refdata.requirements import REQUIREMENTS
    from refdata.tasks import TASKS
    return {"tasks": {t["id"] for t in TASKS},
            "reqs": {r[0] for r in REQUIREMENTS}}


def test_no_document_names_a_task_or_requirement_that_does_not_exist() -> None:
    known = _catalogue()
    problems: List[str] = []
    for name in _docs():
        text = _read(name)
        allowed = NAMED_GHOSTS.get(name, set())
        for ident in sorted(set(re.findall(r"\bTASK-\d{3}\b", text))):
            if ident not in known["tasks"] and ident not in allowed:
                problems.append(f"{name}: {ident} does not exist")
        for ident in sorted(set(re.findall(r"\bREQ-\d{3}\b", text))):
            if ident not in known["reqs"] and ident not in allowed:
                problems.append(f"{name}: {ident} does not exist")
    assert not problems, "\n  ".join(["stale ids in docs/:"] + problems)


def test_no_live_document_claims_a_version_that_has_not_shipped() -> None:
    """⚠️ AHEAD, NOT BEHIND. A doc naming an older release is usually correct —
    it is saying when something happened. One naming a FUTURE version was
    written from an intention."""
    current = json.load(open(os.path.join(REPO_ROOT, "package.json")))["version"]
    ceiling = tuple(int(x) for x in current.split("."))
    problems: List[str] = []
    for name in _docs():
        if name in ARCHIVES:
            continue
        for found in sorted(set(re.findall(r"\bv(\d+\.\d+\.\d+)\b", _read(name)))):
            parts = tuple(int(x) for x in found.split("."))
            # ⚠️ ONLY THE APP'S OWN SERIES. `v24.0.1` in BASELINE.md is the Node
            # version, and a naive comparison reported it as a release from the
            # future — the first false positive this check produced.
            if parts[0] == ceiling[0] and parts > ceiling:
                problems.append(f"{name}: v{found} is ahead of v{current}")
    assert not problems, "\n  ".join(["future versions in docs/:"] + problems)


def test_no_document_points_at_a_source_file_that_is_not_tracked() -> None:
    """⚠️ TRACKED, NOT PRESENT ON DISK. A path that exists only in somebody's
    working tree is not a reference anyone else can follow — the same rule
    `test_hard_rules` learned one release late."""
    tracked = set(subprocess.run(["git", "ls-files"], capture_output=True,
                                 text=True, cwd=REPO_ROOT).stdout.split())
    problems: List[str] = []
    for name in _docs():
        for path in sorted(set(re.findall(
                r"`((?:src|rootfs|tests)/[\w./-]+)`", _read(name)))):
            if path.endswith("/"):
                continue
            if path not in tracked and not os.path.exists(
                    os.path.join(REPO_ROOT, path)):
                problems.append(f"{name}: {path}")
    assert not problems, "\n  ".join(
        ["docs/ names source files that do not exist:"] + problems)


def test_every_archive_says_it_is_one() -> None:
    """⚠️ THE ONLY REAL RISK IN THIS FOLDER IS MISTAKING A RECORD FOR A REPORT.
    Five of the twelve documents are finished records, and a reader who cannot
    tell will act on a sentence that was true in August. The banner is cheap;
    the mistake is not."""
    missing = [name for name in ARCHIVES
               if name in _docs() and "ARCHIVE" not in _read(name)[:1200]]
    assert not missing, (
        f"archive document(s) with no ARCHIVE banner near the top: {missing}. "
        f"Add one, or take the file out of ARCHIVES because it is live again.")


def test_the_archive_list_does_not_rot() -> None:
    stale = sorted(n for n in ARCHIVES if n not in _docs())
    assert not stale, (
        f"ARCHIVES names document(s) that no longer exist: {stale}")


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING, IN THE FILE. Every assertion above passes when the
    corpus is empty, and `docs/` being gitignored means "empty" is one bad path
    away at all times."""
    assert _docs(), "the docs walk found no .md files; every check above is vacuous"
    known = _catalogue()
    assert "TASK-086" not in known["tasks"], (
        "TASK-086 exists now — remove it from NAMED_GHOSTS, and rewrite the "
        "findings in VALIDATION.md that call it a ghost")
