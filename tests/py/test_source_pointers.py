"""A `see X` pointer in a comment must point at something that exists.

⚠️ THIS EXISTS BECAUSE SOURCE COMMENTS WERE NEVER A CORPUS (/dry-audit,
2026-09-01). `dry-audit/prose.sh` check 2 looks the MANAGED PROSE up in the
code — CLAUDE.md, the skills, the memory store, docs. Source files are the
haystack it searches, never the hay. So a docstring naming a module that no
longer exists is invisible to every check in the repository, which is exactly
how `shared/text.py` came to document its readers as three modules of which two
were deleted and one renamed, with the whole suite green.

⚠️ IT IS SCOPED TO POINTERS, NOT TO ALL REFERENCES, AND THAT IS DELIBERATE.
A general "does every backticked dotted name resolve" probe was measured first
and rejected: 104 unresolved out of 440, almost all of them Home Assistant
entity ids (`light.turn_off`), stdlib calls (`hmac.compare_digest`) and
attribute access on locals (`g.grid`). A pointer is different — `see X` is an
INSTRUCTION to go and look, so if X is nowhere, the instruction is broken
whatever X is. Measured on the day it was written: 133 pointers, 2 broken.

⚠️ THE RESOLUTION RULE IS "APPEARS SOMEWHERE ELSE", NOT "IS DEFINED". Parsing
definitions across Python and TypeScript missed private class members and
reported six healthy pointers as broken. What actually distinguishes the real
defect is that its target appeared NOWHERE but inside the pointer itself — the
currency formatter occurred exactly once in the entire tree, in the comment
that referenced it. That is cheap, language-agnostic and had no false positives.

⚠️ AND HERE IS WHAT IT DOES NOT CATCH, STATED SO IT IS NOT OVERSOLD. Mutation
testing on the day it was written: a pointer at a name that exists nowhere goes
red (twice, two different shapes); a pointer at a DELETED module whose name is
still discussed in prose stays GREEN, because the name does occur in the tree —
in the sentences explaining that it is gone. So this catches a pointer to
something that never existed or left no trace, and NOT a pointer to something
deleted-but-documented. The second was found by hand this same day in
`shared/text.py`, and nothing here would have found it. A passing run is
evidence about one shape of broken pointer, not about all of them.
"""

from __future__ import annotations

import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

#: `see `X`` / `See `X``. Backticked so prose that merely says "see the
#: briefing" is not a claim about a symbol.
POINTER = re.compile(r"[Ss]ee\s+`([A-Za-z_][A-Za-z0-9_./]*)`")

SOURCE_EXT = (".py", ".ts", ".tsx")


def _tracked_source() -> list[str]:
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True,
                         cwd=REPO_ROOT).stdout.split()
    return [p for p in out if p.endswith(SOURCE_EXT)]


def _read(path: str) -> str:
    with open(os.path.join(REPO_ROOT, path), encoding="utf-8", errors="replace") as fh:
        return fh.read()


def test_every_see_pointer_resolves_to_something() -> None:
    sources = _tracked_source()

    # ⚠️ VACUOUS-PASS GUARD. A source-reading test whose anchor moves compares
    # two empty sets and reports health forever; this project has had four
    # counters read 0 for the exact case they existed to measure. On
    # 2026-09-01 the tree held ~500 source files and 133 pointers; half of
    # either means the scan broke, not that the comments got tidier.
    assert len(sources) >= 250, (
        f"only {len(sources)} tracked source files — the git scope moved, "
        f"so this test is measuring nothing")

    # ⚠️ THE HAYSTACK INCLUDES GITIGNORED-BUT-PRESENT FILES. `tests/` is
    # gitignored while `tests/security_test.py` is real and referenced by the
    # proxy; a git-only haystack calls all 26 of those references dangling.
    # prose.sh states the same rule about `docs/` and it is the same trap.
    haystack: list[str] = []
    for base, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in
                   (".git", "node_modules", "dist", "__pycache__", ".venv")]
        for name in files:
            if name.endswith(SOURCE_EXT + (".md", ".css", ".yaml", ".json")):
                haystack.append(os.path.join(base, name))
    # ⚠️ STRIP THE POINTERS, NOT THE TARGET. The first draft removed every
    # occurrence of the target from the corpus and then searched for it, which
    # can only ever fail — it reported `readable_label` as dangling while three
    # modules import it. Removing the POINTER TEXT is what leaves "does this
    # name occur anywhere that is not the reference itself" answerable.
    corpus = POINTER.sub(" ", "\n".join(
        open(p, encoding="utf-8", errors="replace").read() for p in haystack))
    filenames = {os.path.basename(p) for p in haystack}
    filenames |= {os.path.splitext(os.path.basename(p))[0] for p in haystack}

    pointers, broken = 0, []
    for path in sources:
        text = _read(path)
        # what the file says OTHER than inside its own pointers — a target that
        # occurs only in the pointer naming it is the defect this catches.
        without = POINTER.sub(" ", text)
        for match in POINTER.finditer(text):
            target = match.group(1)
            pointers += 1
            # ⚠️ STRIP THE EXTENSION BEFORE SPLITTING. A pointer naming a
            # file split to a tail of "py", which occurs in every file in the
            # tree, so every file-shaped pointer resolved trivially and BOTH
            # mutation tests passed against a pin that was checking nothing.
            # The extension is the least informative segment there is.
            # ⚠️ AND THE EXAMPLE THAT USED TO SIT IN THIS COMMENT WAS WRITTEN
            # IN THE POINTER FORM, so this test flagged ITSELF — the same
            # "matched the sentence describing the thing it checks" trap
            # `test_modal_shell` records. Describe the shape; never spell it.
            stem = re.sub(r"\.(py|ts|tsx)$", "", target)
            head = re.split(r"[./]", stem)[0]
            tail = re.split(r"[./]", stem)[-1]
            if head in filenames or tail in filenames or target in filenames:
                continue
            if re.search(rf"\b{re.escape(tail)}\b", without):
                continue
            if re.search(rf"\b{re.escape(tail)}\b", corpus):
                continue
            line = text[:match.start()].count("\n") + 1
            broken.append(f"{path}:{line} points at `{target}`, "
                          f"which appears nowhere else in the tree")

    assert pointers >= 60, (
        f"only {pointers} `see X` pointer(s) found (133 on 2026-09-01) — the "
        f"pattern or the comment style moved, so this measures nothing")
    assert not broken, "\n".join(sorted(broken))
