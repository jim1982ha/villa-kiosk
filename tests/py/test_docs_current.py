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

# ⚠️ THE PROBE FOR "docs/ IS PRESENT" MUST TRACK THE LAYOUT (2026-08-30). This
# pointed at `docs/refdata`, which the reorganisation moved to
# `docs/source/refdata` — so the whole module skipped, silently, and reported 7
# passes as 7 skips. The reorganisation turned this file off and this file is
# what was supposed to notice reorganisations.
pytestmark = pytest.mark.skipif(
    not os.path.isdir(os.path.join(DOCS, "source", "refdata")),
    reason="docs/ is gitignored and absent — not an error (ADR-018)")

#: Finished records are identified by WHERE THEY ARE, not by a list.
#: ⚠️ THEY ARE STILL CHECKED for ghost ids and dead paths — an archive naming a
#: task that never existed is as misleading as a live document doing it — but
#: they are exempt from the "no stale version" rule, because naming the release
#: they were written against is the whole point of an archive.
#:
#: ⚠️ THIS WAS A HAND-KEPT SET AND IT WENT STALE TWICE (2026-08-27, 2026-08-30).
#: It named files that had been merged or moved — the exact rot this file
#: exists to find, turned on the list itself. Worse, `_docs()` listed only the
#: TOP LEVEL, so moving a document into `archive/` removed it from every check
#: here: coverage shrank silently and that was described as "the point of
#: moving it". It is not — an unchecked archive is where a ghost id goes to
#: live. `docs/` was reorganised on 2026-08-30 so that LOCATION states status,
#: and this now walks the whole tree and derives the answer from the path.
ARCHIVE_DIR: str = "history"


def _is_archive(rel: str) -> bool:
    """Anything under `docs/history/` is a finished record, by location."""
    return rel.split(os.sep)[0] == ARCHIVE_DIR


#: Ids a document may name BECAUSE they do not exist — the finding IS that they
#: do not. ⚠️ Without this, recording a ghost-id defect would fail the very
#: check that found it.
NAMED_GHOSTS: Dict[str, Set[str]] = {
    # ⚠️ VALIDATION.md moved to `docs/archive/` on 2026-08-27 and is no longer
    # scanned, so this entry is inert. Kept rather than deleted: if the file is
    # ever brought back the exemption must come with it, and a dead key here
    # costs nothing — unlike ARCHIVES above, nothing asserts this list is live.
    os.path.join("history", "VALIDATION.md"): {"TASK-086", "TASK-087"},
    "README.md": {"TASK-086", "TASK-087"},
}


def _docs() -> List[str]:
    """Every `.md` under `docs/`, as a path relative to it.

    ⚠️ RECURSIVE, AND THAT IS THE WHOLE FIX. It listed one directory, so a
    document moved into a subfolder left this file's scope without failing
    anything — an instrument going quiet and reading as health, which is this
    repository's most repeated defect.
    """
    out: List[str] = []
    for dirpath, _dirs, files in os.walk(DOCS):
        for name in files:
            if name.endswith(".md"):
                out.append(os.path.relpath(os.path.join(dirpath, name), DOCS))
    return sorted(out)


#: Module references a LIVE document may name although the module is gone —
#: the same exemption `NAMED_GHOSTS` gives task ids, for the same reason: a
#: document that RECORDS a rename has to be able to print the old name.
#: ⚠️ KEYED ON THE MODULE, NOT ON EACH SPELLING OF IT. The first cut listed
#: `agent/fallback.brief` and `agent/fallback.py`; the check compares module
#: identity, so neither matched and both documents failed for the right reason
#: with the wrong message. One entry covers every way a document names it.
#: ⚠️ EMPTY, AND THAT IS THE POINT (2026-08-30). It held `STATUS.md` and
#: `BACKLOG.md` while both described the `fallback.py` -> `compose.py` rename in
#: progress; the naming pass landed and both sentences stopped naming the dead
#: module, so the exemptions came out with it. An entry here is a debt with a
#: due date, not a permanent licence — the exemption outliving its rename is the
#: same defect one level up, a claim in prose outliving the code.
NAMED_DEAD_MODULES: Dict[str, Set[str]] = {}

#: `pkg/module` or `pkg/module.attr` in backticks.
_MODULE_REF = re.compile(
    r"`([a-z_][a-z0-9_]*)/([a-z_][a-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)?`")


def _modules() -> Dict[str, Set[str]]:
    """package directory -> the module stems really in it. Derived, never listed."""
    out: Dict[str, Set[str]] = {}
    for base in ("rootfs/usr/bin/vesta", "src"):
        for dirpath, _dirs, files in os.walk(os.path.join(REPO_ROOT, base)):
            if "node_modules" in dirpath or "__pycache__" in dirpath:
                continue
            pkg = os.path.basename(dirpath)
            for name in files:
                stem, ext = os.path.splitext(name)
                if ext in (".py", ".ts", ".tsx"):
                    out.setdefault(pkg, set()).add(stem)
    return out


def test_no_live_document_names_a_module_that_does_not_exist() -> None:
    """⚠️ THE BLIND SPOT THE DEAD-PATH CHECK CANNOT SEE (2026-08-30). That one
    only resolves `src/…`, `rootfs/…`, `tests/…` — a real PATH. But documents
    mostly name CODE the way engineers speak: `agent/fallback.brief`,
    `analysis/registry.py`. Rename the module and every document naming it goes
    on reading as correct, because nothing resolves a symbol.

    `STATUS.md` claimed `agent/fallback.brief` writes every briefing for days
    after that module became `agent/compose.py`. It was the FOURTH document to
    outlive its code in one day and the only one no automated check could
    catch. Measured before writing this: 33 module references in the live docs,
    20 distinct — small enough to resolve, and 4 of them were dead.

    ⚠️ `generated/` AND `history/` ARE EXEMPT, DELIBERATELY. The development
    plan's TASK-073 section says it removes `narrate/deterministic.py` — naming
    a module a task DELETED is the correct prose for a record of that task, and
    failing it would be demanding that history be rewritten. A correction to a
    generated document goes into `source/refdata/` anyway, never into the
    output.
    """
    known = _modules()
    # ⚠️ THE VACUOUS-PASS GUARD, AND MUTATION TESTING IS WHAT DEMANDED IT.
    # Every reference below is skipped when its package is unknown, so an empty
    # index means "nothing to check" and the test goes green having measured
    # nothing. Emptying `_modules()` left all eight tests passing.
    assert "agent" in known and "brief" in known, (
        f"the module index found no agent/ or brief/ package: {sorted(known)[:8]}")

    problems: List[str] = []
    checked = 0
    for name in _docs():
        if _is_archive(name) or name.split(os.sep)[0] == "generated":
            continue
        allowed = NAMED_DEAD_MODULES.get(os.path.basename(name), set())
        for pkg, mod in _MODULE_REF.findall(_read(name)):
            ref = f"{pkg}/{mod}"
            if pkg not in known:          # not a package in this tree at all
                continue
            checked += 1
            if mod in known[pkg] or ref in allowed:
                continue
            problems.append(f"{name}: `{ref}` — no such module")
    # Measured at 20 distinct references across the live documents when this
    # was written; a floor well under that fails if the scan stops reaching them.
    assert checked >= 8, (
        f"only {checked} module reference(s) resolved — the live documents name "
        "far more than that, so this check has stopped reaching them")
    assert not problems, (
        "live document(s) naming a module that does not exist:\n  "
        + "\n  ".join(sorted(set(problems)))
        + "\n\nRename it, or add it to NAMED_DEAD_MODULES with the reason it is "
          "named on purpose (a document recording a rename may print the old name).")


#: "the villa runs 2.903.0" and every phrasing of it. Deliberately narrow: it
#: wants a SUBJECT (villa/property/add-on), a PRESENT-TENSE running verb, and a
#: version, close together. A version alone is fine — documents cite releases
#: constantly — and so is the past tense, which is how a record of a past
#: deployment is correctly written.
#: ⚠️ MATCHED PER PARAGRAPH, NOT PER LINE. The sentence that caused this wrapped
#: across two lines ("Villa add-on running\n**2.903.0**"), so the first cut of
#: this check scanned lines and did not catch the very defect it was written
#: for — measured, not assumed, before it was changed.
_DEPLOYED_VERSION = re.compile(
    r"(?:villa|property|add-?on)\b.{0,40}?"
    r"\b(?:runs?|running|is\s+on|sits\s+on)\b.{0,25}?"
    r"v?\*{0,2}\d+\.\d+\.\d+",
    re.IGNORECASE)


def _paragraphs(text: str) -> List[str]:
    """Blank-line-separated blocks, whitespace collapsed, so a claim that wraps
    is one string rather than two unmatchable halves."""
    return [re.sub(r"\s+", " ", block).strip()
            for block in re.split(r"\n\s*\n", text)]


def test_no_live_document_states_what_version_the_villa_IS_RUNNING() -> None:
    """⚠️ A RUNTIME FACT ABOUT A MACHINE THIS REPO DOES NOT CONTROL (2026-08-30).

    `STATUS.md` opened with "Villa add-on running 2.903.0 — deployed and
    verified this session, so for once the tree and the property are the same
    build". The property was running 2.905.0. The owner updates the add-on
    whenever they like, so the number was stale the moment they pressed the
    button, in the one file whose stated job is to be true today.

    ⚠️ THE COST WAS NOT THE WRONG NUMBER, IT WAS WHAT GOT BUILT ON IT. The stale
    version was carried into the status memory, repeated the next session, and
    AMPLIFIED into a derived claim — "three behind, and deliberately: those
    releases are tests and docs only, nothing the property executes" — which was
    confidently wrong in both halves and would have justified not deploying.

    The fix is not a fresher number, because a fresher number decays the same
    way. It is to READ it: `ha_get_addon(source="installed")`, slug
    `..._villa_kiosk_dev`. A version this repo genuinely owns — what `main` is
    frozen at, what a changelog entry describes — is untouched by this check.
    """
    problems: List[str] = []
    scanned = 0
    for name in _docs():
        if _is_archive(name) or name.split(os.sep)[0] == "generated":
            continue
        scanned += 1
        for para in _paragraphs(_read(name)):
            found = _DEPLOYED_VERSION.search(para)
            if found:
                problems.append(f"{name}: …{found.group(0)[:90]}…")
    # The same vacuous-pass guard the module check carries, for the same reason:
    # an empty document list would pass this having measured nothing.
    assert scanned >= 3, (
        f"only {scanned} live document(s) scanned — this check has stopped "
        "reaching them, which is how the docs test went quiet in 2.904.0")
    assert not problems, (
        "live document(s) stating what version is DEPLOYED:\n  "
        + "\n  ".join(sorted(set(problems)))
        + "\n\nDo not transcribe it — the owner updates the add-on whenever "
          "they like. Read it with ha_get_addon(source=\"installed\") and cite "
          "how to read it, not the answer.")


def test_the_document_scan_is_not_vacuous() -> None:
    """⚠️ THE GUARD THE RECURSION NEEDS. Every check below iterates `_docs()`;
    all of them pass on an empty list. A renamed folder must fail loudly here
    rather than quietly stop checking anything."""
    found = _docs()
    assert len(found) >= 10, f"only {len(found)} documents found: {found}"
    assert any(_is_archive(f) for f in found), "no archived document found"
    assert any(not _is_archive(f) for f in found), "no live document found"


def _read(name: str) -> str:
    # ⚠️ `errors="replace"`. One of these files carries a degree sign in a
    # legacy encoding, and a decode error here would present as "the docs check
    # is broken" rather than as one byte in one line.
    return open(os.path.join(DOCS, name), encoding="utf-8",
                errors="replace").read()


def _catalogue() -> Dict[str, Set[str]]:
    sys.path.insert(0, os.path.join(DOCS, "source"))
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
        if _is_archive(name):
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
    # ⚠️ INVERTED ON 2026-08-30, AND IT IS A STRONGER RULE. It used to demand
    # a banner inside each archive; the folder now says it, so the banner is a
    # second spelling of one fact. What CAN go wrong is the other direction —
    # a document that calls itself an archive while sitting among the live
    # ones, which is how a reader acts on a finished record.
    stray = [name for name in _docs()
             if not _is_archive(name) and "ARCHIVE" in _read(name)[:1200]]
    assert not stray, (
        f"document(s) declaring themselves ARCHIVE outside docs/{ARCHIVE_DIR}/: "
        f"{stray}. Move them there, or drop the banner because they are live.")


def test_the_archive_rule_needs_no_hand_kept_list() -> None:
    """⚠️ THIS USED TO GUARD A HAND-KEPT SET AND THE SET WENT STALE TWICE. The
    rule is now LOCATION — `docs/history/` — so "the list names a file that
    moved" cannot happen: there is no list. What is asserted instead is that
    the rule still partitions the tree, which is the thing a future
    reorganisation could break.
    """
    docs = _docs()
    archived = [d for d in docs if _is_archive(d)]
    live = [d for d in docs if not _is_archive(d)]
    assert archived, f"docs/{ARCHIVE_DIR}/ holds no documents — has it moved?"
    assert live, "every document reads as archived — the live set is empty"
    assert all(os.sep in a for a in archived), (
        "an archived path with no separator means _is_archive is matching the "
        "top level, so every document would count as archived")


def test_this_check_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING, IN THE FILE. Every assertion above passes when the
    corpus is empty, and `docs/` being gitignored means "empty" is one bad path
    away at all times."""
    assert _docs(), "the docs walk found no .md files; every check above is vacuous"
    known = _catalogue()
    assert "TASK-086" not in known["tasks"], (
        "TASK-086 exists now — remove it from NAMED_GHOSTS, and rewrite the "
        "findings in VALIDATION.md that call it a ghost")
