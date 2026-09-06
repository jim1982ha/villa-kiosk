"""Tracked source must state its facts, not cite an untracked file.

⚠️ CLAUDE.md IS GITIGNORED. It is not in the repository, so every reference to
it from tracked source is unresolvable on a fresh clone BY CONSTRUCTION — the
reader is pointed at a file they do not have and cannot get.

That defect was always there; a rewrite is what exposed it. When CLAUDE.md was
reduced from its old form to 173 lines, 43 citations across 33 tracked files
were left pointing at claims that no longer existed anywhere: the "envelope
bug", the `SHARED_CONFIG_KEYS` gap, `floorProbe`'s three callers, the "two
dials", the Arial gotcha, "why getRenderHeight() alone is not". Sampling twelve
of the anchors, eight resolved to nothing.

⚠️ THE FIX IS NOT TO RE-ADD THE TEXT. A comment that says "see CLAUDE.md" is
appealing to an authority the reader cannot check; a comment that states the
fact is the authority. Every one of those 43 already stated its fact — the
citation was decoration in front of it.

This does not forbid citing TRACKED files. `tests/security_test.py`,
`test_playbooks.py` and sibling modules are all in the repository, so a reader
can follow them.
"""

import io
import os

import pytest

from conftest import REPO_ROOT

#: Files a reader of a fresh clone does not have. Keep this list in step with
#: .gitignore for anything source is tempted to point at.
UNTRACKED_DOCS = ("CLAUDE.md", "AGENTS.md")

#: Where shipped source lives. `tests/` is excluded: a test may name the
#: developer's own tooling, because its reader is the developer.
SOURCE_ROOTS = ("rootfs", "src")

SKIP_DIRS = {"__pycache__", "node_modules", "dist", ".git"}
SOURCE_EXT = (".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".yaml", ".yml")


def _source_files():
    for root in SOURCE_ROOTS:
        base = os.path.join(REPO_ROOT, root)
        for dirpath, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fn in files:
                if fn.endswith(SOURCE_EXT) or fn == "supervisor-proxy.py":
                    full = os.path.join(dirpath, fn)
                    yield os.path.relpath(full, REPO_ROOT), full


def test_the_docs_this_forbids_are_genuinely_untracked():
    """⚠️ THE GUARD'S OWN PREMISE, CHECKED. If CLAUDE.md were ever committed,
    this rule would be wrong and should be deleted rather than worked around."""
    import subprocess

    for doc in UNTRACKED_DOCS:
        out = subprocess.run(["git", "ls-files", doc], cwd=REPO_ROOT,
                             capture_output=True, text=True).stdout.strip()
        assert out == "", (
            "%s is tracked now — a reader of a fresh clone HAS it, so this "
            "rule no longer applies and should be removed." % doc)


@pytest.mark.parametrize("doc", UNTRACKED_DOCS)
def test_no_tracked_source_points_at_an_untracked_doc(doc):
    offenders = []
    for rel, full in _source_files():
        try:
            src = io.open(full, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(src.splitlines(), 1):
            if doc in line:
                offenders.append("%s:%d: %s" % (rel, n, line.strip()[:100]))
    assert not offenders, (
        "%d reference(s) to %s, which is gitignored — a reader of a fresh "
        "clone cannot follow any of them. State the fact instead of citing "
        "the file:\n  %s" % (len(offenders), doc, "\n  ".join(offenders)))
