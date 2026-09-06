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

#: What a reader of a fresh clone does not have.
#:
#: ⚠️ `docs/` WAS MISSING AND THE OMISSION COST A DAY (2.956.0). The whole
#: directory is gitignored — `git ls-files docs` returns nothing, ADRs
#: included — and the very next commit after this guard shipped cited
#: "ADR 0002" from `shared/concern.ts`, which is the same defect the guard was
#: written for, one document later. A hand-frozen pair of FILENAMES could not
#: see a directory.
UNTRACKED_DOCS = ("CLAUDE.md", "AGENTS.md", "docs/")

#: Where shipped source lives. `tests/` is excluded: a test may name the
#: developer's own tooling, because its reader is the developer.
#:
#: ⚠️ `rootfs` AND `src` ARE NOT ALL OF IT. `index.html` is shipped to the
#: browser and its reader is not the developer; `.github/workflows/` is read by
#: anyone diagnosing a failed build. Both cited CLAUDE.md while this guard
#: reported clean.
SOURCE_ROOTS = ("rootfs", "src", ".github")

#: Tracked shipped files that live at the repository root.
SOURCE_FILES = ("index.html", "vite.config.ts")

SKIP_DIRS = {"__pycache__", "node_modules", "dist", ".git"}
SOURCE_EXT = (".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".yaml", ".yml")


def _source_files():
    for name in SOURCE_FILES:
        full = os.path.join(REPO_ROOT, name)
        if os.path.exists(full):
            yield name, full
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


def test_no_tracked_source_cites_a_PATH_a_clone_does_not_have():
    """⚠️ DERIVED, NOT LISTED — because the frozen tuple has been wrong twice in
    two days.

    `UNTRACKED_DOCS` started as two filenames, missed `docs/` entirely (a whole
    gitignored directory, ADRs included), and its own docstring asserted that
    `tests/security_test.py` is "in the repository, so a reader can follow" —
    `git ls-files` says otherwise, and three shipped files cited it. The guard's
    worked counter-example was an instance of the defect it guards.

    This asks the thing that decides what a reader has.
    """
    import re
    import subprocess

    tracked = set(subprocess.run(["git", "ls-files"], cwd=REPO_ROOT,
                                 capture_output=True, text=True).stdout.splitlines())
    # Path-shaped citations only: a slash, a known source extension, no spaces.
    shape = re.compile(r"\b((?:tests|docs|scripts|sources)/[\w./-]+"
                       r"\.(?:py|ts|tsx|md|json|mjs|conf|yaml|yml))\b")
    offenders = []
    for rel, full in _source_files():
        try:
            text = io.open(full, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for path in shape.findall(line):
                if path not in tracked:
                    offenders.append("%s:%d cites %s" % (rel, n, path))
    assert not offenders, (
        "tracked source cites path(s) a fresh clone does not have — state the "
        "fact, or name something tracked:\n  " + "\n  ".join(offenders))
