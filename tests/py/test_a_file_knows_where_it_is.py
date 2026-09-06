"""A file whose first line names a path must name its OWN path.

⚠️ THIRTY FILES WERE WRONG AT ONCE (2026-09-06). This codebase opens most
modules with `// src/…/Thing.tsx`, and the reorganisation into `src/vesta/`
moved them without touching that line — so `ReportsModal.tsx` announced itself
as `src/components/reports/ReportsModal.tsx`, a directory that no longer
existed. Every one of them was a signpost to nowhere, and nothing could see it:
the header is a comment, so no compiler, linter or test ever read it.

⚠️ THE EMPTY DIRECTORIES MADE IT WORSE, NOT BETTER. `src/components/reports/`
and three siblings survived the move as empty folders, so a reader following a
header found the path existed and the file did not — which reads as a deleted
file rather than a moved one. They are gone; this is what stops the headers
drifting back.

⚠️ IT IS THE SAME SHAPE AS EVERY OTHER CROSS-ARTEFACT PIN HERE: two statements
of one fact — where the file is, and where it says it is — with nothing between
them. The difference is that this one is checkable for free.
"""

from __future__ import annotations

import os
import re
from typing import List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")

#: `// src/path/to/File.ts` on the very first line, and nothing else.
_HEADER = re.compile(r"^//\s*(src/[\w./-]+)\s*$")


def _headers():
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d != "assets"]
        for name in sorted(files):
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as handle:
                first = handle.readline()
            m = _HEADER.match(first.strip())
            if m:
                yield os.path.relpath(path, REPO_ROOT), m.group(1)


def test_every_self_naming_header_names_its_own_file() -> None:
    wrong: List[str] = [f"{actual}  says: {claimed}"
                        for actual, claimed in _headers() if claimed != actual]
    assert not wrong, (
        "file(s) whose opening line names a different path than their own — a "
        "reader following it lands somewhere else, or nowhere:\n  "
        + "\n  ".join(wrong))


def test_no_empty_directory_survives_a_move() -> None:
    """⚠️ AN EMPTY FOLDER IS A PATH THAT STILL RESOLVES. Git does not track
    them, so a move leaves them behind on every working copy that did it — and
    they make a stale header look like a deleted file instead of a moved one."""
    empty = [os.path.relpath(os.path.join(root), REPO_ROOT)
             for root, dirs, files in os.walk(SRC)
             if not dirs and not files]
    assert not empty, (
        "empty directories under src/ — left over from a move: "
        + ", ".join(sorted(empty)))


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING. Both assertions pass on an empty scan, and the
    header regex is one formatting change away from matching nothing."""
    found = list(_headers())
    assert len(found) >= 40, (
        f"only {len(found)} self-naming header(s) found — the regex has "
        "stopped matching, and this file now measures nothing")
