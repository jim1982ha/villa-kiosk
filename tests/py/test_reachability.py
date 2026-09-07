"""A function whose only callers are its own tests. TASK-109.

⚠️ THIS IS THE DEFECT THIS CODEBASE HAS PRODUCED EIGHT TIMES, AND IT HAS NEVER
ONCE BEEN CAUGHT BY A TEST — because every instance consists of two halves that
are each correct and each individually pinned. A unit test of a helper passes
whether or not anything calls it. `feedback_pin-the-caller` records two; this
session found six more in three days:

  1. `sources.build_document`  — both callers built the document with NO
     arguments, so the model read 480 characters describing an empty property
     for the whole of a shadow period the cutover was to be decided from.
  2. `ReadVilla`               — built its own poorer document instead.
  3. `raise_concern`           — in the tool catalogue, served by the MCP
     server, built by nobody. Nothing in the system could create a Concern.
  4. triage → investigation    — both ends specified, the wire assigned to
     nobody; escalations were formatted into a string and returned.
  5. `read_concerns`           — wired to no source, returned `[]` for ever.
  6. `route.py`                — the whole routing layer, imported by nothing.
  7. `concerns.suppressed_subjects` → `policy` — three dismissals were counted
     and discarded, so "stop telling me about this" silently did nothing.
  8. the ledger's `deps`       — refreshed in refdata, preserved as stale in
     the file a session is told to read first.

So the rule is now mechanical: **a public function in `agent/` must have a
caller in shipped code, or be named here with the reason it does not.** The
EXEMPT map is the point — it turns "we forgot" into "we decided", and a NEW
unreachable function fails until somebody writes a sentence about it.

⚠️ IT SCANS `agent/` ONLY, ON PURPOSE. That is where the eight instances are and
where the wiring is thinnest. Widening it to `reports/` is a good idea and a
different change: that package has a decade of shape and would need its own
exemption list, which would bury this one.
"""

from __future__ import annotations

import ast
import functools
import os
import re
import subprocess
import sys
from typing import Dict, List, Set, Tuple

from conftest import strip_prose

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

PKG = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "agent")

#: name -> why it has no shipped caller. ⚠️ EVERY ENTRY IS A DECISION SOMEBODY
#: MADE, and the ones marked BLOCKED are findings rather than exemptions — they
#: are here so the count does not grow silently, not because they are fine.
EXEMPT: Dict[str, str] = {
    # ⚠️ `flag_type_of` AND `brief` WERE HERE AND ARE NOT ANY MORE (2.966.0).
    # Both were exempted with the same true reason — "a registration is a
    # reference, not a call, and renaming pipeline locals to satisfy a scanner
    # would be gaming the instrument". The scan credits a REFERENCE now
    # (`set_brief_composer(agent_compose.brief)`,
    # `flag_type_of=sources_mod.flag_type_of`), so neither needs an entry: the
    # instrument was corrected instead of the code being annotated around it.

    # ── genuinely unreachable, and that is a FINDING (TASK-106, parked) ──
    # ⚠️ `escalate` WAS HERE AND IS NOT ANY MORE (TASK-112, v2.701.0). It was
    # unreachable for the reason recorded: re-evaluating an unacknowledged
    # concern needs an acknowledgement to read, and nothing in this system could
    # acknowledge one. `concerns.acknowledge` is that verb,
    # `outbox.escalation_sweep` is the caller, and the sweep runs on the triage
    # clock beside the delivery one.
    "note_delivered": "records a delivered concern so a reply can resolve "
                      "'why?' without naming the subject (REQ-014). The outbox "
                      "now delivers, but does not yet register the thread — "
                      "the remaining half of REQ-014",

    # ── wired by REFERENCE ──
    # ⚠️ THIS SECTION IS EMPTY NOW, AND THAT IS THE FIX (2.966.0). `brief`,
    # `ladder` and `flag_type_of` were all exempted here with the same true
    # reason: "a registration is a reference, not a call, and renaming pipeline
    # locals to satisfy a scanner would be gaming the instrument." Correct
    # about the code and about the scanner — so the scanner was corrected. It
    # credits `set_brief_composer(agent_compose.brief)` and
    # `flag_type_of=sources_mod.flag_type_of` as the uses they are, and three
    # real seams left an exemption map they were sharing with genuine
    # oversights. An exemption that describes an instrument's limit belongs in
    # the instrument.

    # ⚠️ `verify` WAS HERE AND IS NOT ANY MORE (2026-08-28), the same way
    # `escalate` left above it. It was BLOCKED rather than exempt — the ninth
    # instance of the two-correct-halves defect, found by the pin built after
    # the eighth — and TASK-046 had specified its caller from the beginning:
    # "verification sweep: did it recur while the collector was listening
    # throughout?". `concerns.verification_sweep` is that sweep,
    # `scheduler.dispatch` is where it runs, and the Reason tab's "Fixed and
    # confirmed" count can finally be something other than zero.

    # ── SURFACED BY MAKING THIS SCAN MODULE-AWARE (2.966.0) ──
    # ⚠️ FOUR WERE FOUND HERE AND THREE HAVE SINCE BEEN WIRED. `memory.write`,
    # `memory.expire` and `review.propose` were the agent's learning loop: the
    # modules, the stores, the routes and both screens existed, and the only
    # missing part was what FED them, so the villa memory could hold what a
    # person overrode and never what the agent concluded, and the playbook queue
    # could only ever be empty. `agent/learn.py` is what feeds them now
    # (ADR-0004), `scheduler` runs the sweep, and this test is what proved all
    # three were reachable afterwards rather than a grep that said so.
    #
    # ⚠️ THE EXEMPTIONS ARE DELETED RATHER THAN EDITED. A sentence saying "this
    # is a real gap, the wiring is a product decision" is not true of a wired
    # function, and leaving it would cover the NEXT unreachable function of the
    # same name — which is the whole reason `test_the_exemption_map_does_not_rot`
    # exists. `triage.due` left this map the same way and is also gone.

    "stats": "the counts the diagnostics panel is described as showing — "
             "threads, turns, concerns. No endpoint serves them, so the panel "
             "shows something else or nothing. Credited until now by "
             "`ModuleContext.stats`, the statistics fetcher",
    "summary": "the Supervision tab's 'is the tool upstream wired, and how "
               "many of its tools may this villa call'. No endpoint serves it. "
               "Credited until now by `usage.summary` and `audit.summary`",

    # ── deliberately not called, with the reason at the code ──
    "concern_admissible": "bundles suppression with contracts.concern_errors, "
                          "which requires a non-empty id — and the id is minted "
                          "by concerns.raise_concern AFTER this point, on "
                          "purpose. The two halves are asked where each can be "
                          "answered; see tools/concern.py:writer",
    "enforce_concern": "the after-the-fact variant, for re-checking a STORED "
                       "concern. The live path calls `enforce` directly because "
                       "it needs the strip count to hand back to the model",

    # ── mirrors and readers kept complete on purpose ──
    "negatives_of": "the per-subject count. `suppressed_subjects` computes the "
                     "whole map in one pass and is what policy reads; this is "
                     "the single-subject reader a diagnostic would want",
    "coerce_severity": "the inbound half of the severity vocabulary, mirroring "
                       "`severity_rank`. Kept so the contract is complete in "
                       "both directions",
    "status": "budget diagnostics for an operator; the Cockpit reads the "
              "narrower `summary()` instead",

    # ⚠️ `compose` WAS HERE AND IS NOT ANY MORE (TASK-111, v2.699.0). The whole
    # degradation ladder was unreachable — four rungs, each stating which rung
    # it is, and nothing calling any of them — which made REQ-042 satisfied by
    # tests asserting each rung in isolation while RISK-015 had no control at
    # all. `reports.pipeline` now descends it when the deterministic renderer
    # raises, registered by the proxy at boot the way the concerns source is.
    "reset": "clears every chat thread. Its own docstring says what it is for —"
             "tests, and a kill-switch flip — and a kill switch nothing calls "
             "from code is still a kill switch",

    # ── surfaces whose consumer chose to do the work elsewhere ──
    "passes": "the triage-pass reader. `loadTriagePasses` fetches /agent-audit "
              "and filters `tool.startswith('pass:')` in the browser instead, "
              "so this is a server-side equivalent nobody adopted",
    "unused": "reports which shipped playbooks the agent has never read — a "
              "content-quality diagnostic, run by hand",
    "render_index": "renders the playbook catalogue for a human reader; the "
                    "prompt path uses `catalogue()`",
    "forget_targets": "clears the chat target cache. Kept for an operator and "
                      "for the tests that must not leak state between cases",
    # ⚠️ `forget_entities` WAS HERE AND IS NOW REACHABLE (2026-08-29). The
    # lookup it clears moved to `adapters.rich` so the briefing and the alert
    # path ask one question, and `buttons.forget_entities` now delegates to it
    # — so the name has a real caller in shipped source and the exemption
    # became exactly the stale sentence this map's own pin exists to catch.
}


#: ⚠️ CACHED BECAUSE THESE TWO TESTS COMPUTED THE SAME ANSWER TWICE (2.957.0).
#: Measured: `test_reachability`'s pair was 16.4s + 16.1s and
#: `test_client_has_a_caller`'s was 2.9s + 2.9s — 38.3s of an 89.2s suite, 43%,
#: in four tests, two of which recompute what the other just did. Both
#: functions take no arguments and are pure over the tracked corpus, so the
#: cache changes nothing that is asserted.
@functools.lru_cache(maxsize=None)
def _shipped() -> Dict[str, str]:
    """Every tracked **Python** file under `rootfs/`, by path.

    ⚠️ TRACKED, NOT ON DISK. A caller that exists only in an untracked scratch
    file is not a caller — the same rule `test_hard_rules` learned the hard way,
    one release late.

    ⚠️ AND PYTHON ONLY, WHICH IS A CORRECTION. This walked `src/` as well, and a
    TypeScript file cannot call a Python function — so the only thing that
    scope could ever contribute was a FALSE NEGATIVE, and it contributed a real
    one: `redact.wrap`, the delimiter half of RISK-001's stated control, had no
    caller anywhere and was passed by this check because a prose fragment in
    `SettingsModal.tsx` reads `flex-wrap (not`, and a hyphen is not in the
    character class the lookbehind excludes. A short, common name plus prose in a
    language that cannot call it is the whole false-negative class, and
    narrowing the corpus removes it rather than patching the regex.
    """
    out = subprocess.run(["git", "ls-files", "rootfs/**/*.py"],
                         capture_output=True, text=True, cwd=REPO_ROOT)
    # ⚠️ PLUS THE PACKAGE UNDER SCAN, FROM DISK. The scan walks `agent/` on
    # disk, so a brand-new module is scanned for its public functions while its
    # own callers — in that same new file — are invisible to a tracked-only
    # corpus. `outbox.py` was flagged for three functions its own `sweep` calls,
    # one commit before it existed in git. That is `feedback_stage-before-
    # gating` a fourth time, in the check written to catch its cousin.
    #
    # An untracked file ELSEWHERE still does not count as a caller — that rule
    # is the point and is unchanged. This only says that the package being
    # audited is read the same way whether or not it has been committed yet.
    rels = list(out.stdout.split())
    rels += [os.path.relpath(os.path.join(PKG, n), REPO_ROOT)
             for n in os.listdir(PKG) if n.endswith(".py")]
    files: Dict[str, str] = {}
    for rel in dict.fromkeys(rels):
        path = os.path.join(REPO_ROOT, rel)
        if os.path.exists(path):
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            _SOURCE[path] = text
            # ⚠️ DOCSTRINGS ARE PROSE TOO, AND ONE OF THEM CREDITED A CALLER.
            # The filter below skips `#` comments; `audit.passes` was reported
            # reachable because its OWN docstring reads "The triage passes,
            # newest last." — a name followed by a comma matches the call
            # shape. This file's docstring already says "prose naming a
            # function is not a use of it"; `strip_prose` blanks comments AND
            # docstrings in place, so every column and line number survives and
            # the def-line skip still lines up.
            try:
                files[path] = strip_prose(text)
            except SyntaxError:                    # pragma: no cover
                files[path] = text
    return files


#: path -> the file as written. ⚠️ THE ORIGINAL, BECAUSE `strip_prose` OUTPUT
#: DOES NOT RE-PARSE. It blanks a docstring IN PLACE, so a function whose body
#: is only a docstring becomes an empty block — `ast.parse` then raises, and
#: `_reaches`' "do not accuse" fallback credited EVERY name in that file,
#: silently restoring the blind spot this change exists to close. Imports are
#: read from what was written; calls are matched against what is left after the
#: prose is blanked.
_SOURCE: Dict[str, str] = {}


@functools.lru_cache(maxsize=None)
def _unreachable() -> List[str]:
    files = _shipped()
    assert files, "the file walk found nothing; this test would be vacuous"
    found: List[str] = []
    for name in sorted(os.listdir(PKG)):
        if not name.endswith(".py") or name == "__init__.py":
            continue
        path = os.path.join(PKG, name)
        for node in ast.parse(open(path).read()).body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name.startswith("_"):
                continue                      # private: its module is the caller
            # ⚠️ BOTH SPELLINGS. `foo(` and `mod.foo(` are the same call, and
            # matching only the bare form flagged thirty-five functions that
            # were called through their module — a check nobody would trust
            # twice.
            call = re.compile(rf"(?<![\w.]){re.escape(node.name)}\s*\("
                              rf"|\.{re.escape(node.name)}\s*\(")
            if not _called(files, call, node, path, name=node.name):
                found.append(f"{node.name}  ({os.path.basename(path)}:"
                             f"{node.lineno})")
    return found


@functools.lru_cache(maxsize=None)
def _module_of(path: str) -> str:
    """The dotted module a shipped file is imported as."""
    rel = os.path.relpath(path, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    return rel[:-3].replace(os.sep, ".")


def _reaches(path: str, module: str, name: str) -> Tuple[bool, Set[str]]:
    """How this file could reach `module.name` -> (bare, module aliases).

    ⚠️ A CALL IS ONLY A CALL IF IT CAN REACH THE DEFINITION. The scan matched a
    bare name across the whole corpus, so `triage.due` was credited by
    `schedule_mod.due(...)` and `digest.due(...)` — different functions
    entirely — and sat unreachable, without the cadence floor the scheduler
    applies, while the gate reported it healthy. 68 shipped function names are
    defined in two or more files, so the blind spot is the width of that list.

    ⚠️ AND THE ALIASES, NOT A BOOLEAN. Returning "this file may use the
    attribute form" and then matching any `.name` credits attribute access on
    unrelated objects: `budget.status` was credited by `result.status` in two
    files that merely import `budget`. Trading one blind spot for another is
    not a fix, so the alias the module is actually bound to is what gets
    matched.
    """
    try:
        tree = ast.parse(_SOURCE.get(path, ""))
    except SyntaxError:                            # pragma: no cover
        return (True, {"*"})                       # unparseable: do not accuse
    tail = module.rsplit(".", 1)[-1]
    bare = False
    aliases: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == module:
                    aliases.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            for alias in node.names:
                if base == module and alias.name == name:
                    bare = True                    # from <module> import <name>
                elif base == module and alias.name == "*":
                    bare = True
                elif alias.name == tail and f"{base}.{tail}" == module:
                    aliases.add(alias.asname or alias.name)
    return (bare, aliases)


def _called(files: Dict[str, str], call: "re.Pattern[str]", node: ast.AST,
            path: str, name: str = "") -> bool:
    """⚠️ THE DEFINITION LINE AND COMMENTS DO NOT COUNT. Prose naming a function
    is not a use of it — that alone was three false hits in /dry-audit's own
    history, in this same repository."""
    lineno = getattr(node, "lineno", -1)
    name = name or getattr(node, "name", "")
    module = _module_of(path)
    for where, text in files.items():
        # ⚠️ RESOLVED, NOT MATCHED BY NAME. A file that cannot import this
        # definition cannot be calling it, however the text reads.
        if where == path:
            bare, aliases = True, {"*"}        # its own module always can
        else:
            bare, aliases = _reaches(where, module, name)
        if not (bare or aliases):
            continue
        # ⚠️ THE SPELLING THIS FILE CAN ACTUALLY USE. A file holding
        # `from x import name` may write `name(`; one holding `import x as m`
        # may write `m.name(`. Crediting either spelling to a file that has
        # only one of the imports is the same blind spot one notch smaller.
        # ⚠️ A REFERENCE IS A USE, NOT JUST A CALL. `compose.ladder` is handed
        # to `pipeline.set_ladder_composer(agent_compose.ladder)` — no parens —
        # and the proxy calls it through that hook. Matching only `name(` made
        # every injected function look uncalled, which is how a real seam ends
        # up in an exemption map beside the genuine oversights.
        spellings = []
        if bare:
            spellings.append(rf"(?<![\w.]){re.escape(name)}\s*[(,)\]}}]")
        for alias in aliases:
            spellings.append(
                rf"\.{re.escape(name)}\s*[(,)\]}}]" if alias == "*"
                else rf"(?<![\w.]){re.escape(alias)}\.{re.escape(name)}\s*[(,)\]}}]")
        here = re.compile("|".join(spellings))
        for i, line in enumerate(text.splitlines(), 1):
            if where == path and i == lineno:
                continue
            stripped = line.lstrip()
            # ⚠️ `#` ONLY — `//` AND `*` WERE C/JS HEURISTICS AND ONE OF THEM
            # BLINDED THIS CHECK. The corpus was narrowed to Python precisely to
            # remove false negatives, and these two survived the narrowing: `//`
            # is now unreachable, and `*` matches `**kwargs` UNPACKING, which is
            # a call site and not a comment. `sources.build_document` calls
            # `layout()` as `**dict(layout())`, and this filter skipped the line
            # and reported the function as having no caller — the checker that
            # exists to find uncalled functions, inventing one.
            #
            # The `⚠️` prefix stays: this repo's continuation lines really do
            # begin with it, and it cannot begin an expression.
            if stripped.startswith(("#", "⚠️")):
                continue
            if re.match(rf"\s*(async )?def {re.escape(name)}\b", line):
                continue
            if here.search(line):
                return True
    return False


def test_every_public_agent_function_has_a_shipped_caller() -> None:
    """⚠️ THE ASSERTION EIGHT DEFECTS WALKED PAST. See this module's header."""
    unreachable = _unreachable()
    names: Set[str] = {u.split()[0] for u in unreachable}
    unexplained = sorted(u for u in unreachable if u.split()[0] not in EXEMPT)
    assert not unexplained, (
        "public function(s) in agent/ that nothing shipped calls — so they are "
        "reachable only from their own tests, which is this codebase's most "
        "repeated defect and has never been caught by one:\n  "
        + "\n  ".join(unexplained)
        + "\n\nEither wire it up, or add it to EXEMPT with the reason it is "
          "deliberately uncalled. 'We forgot' and 'we decided' look identical "
          "from here, and the map is what separates them.")


def test_the_exemption_map_does_not_rot() -> None:
    """⚠️ AN EXEMPTION FOR A FUNCTION THAT IS NOW CALLED — or that no longer
    exists — is a sentence nobody has read since it was written, and it would
    silently cover a NEW unreachable function of the same name."""
    live = {u.split()[0] for u in _unreachable()}
    stale = sorted(n for n in EXEMPT if n not in live)
    assert not stale, (
        f"EXEMPT names function(s) that are no longer unreachable (or no longer "
        f"exist): {stale}. Remove them — a stale exemption covers the next one.")


def test_the_scanner_can_actually_fail() -> None:
    """⚠️ MUTATION-PROOFING, IN THE FILE. A reachability check that matched
    everything would pass for ever and measure nothing — which is exactly the
    failure mode it exists to catch, so it is worth one test.

    ⚠️ AND IT NOW CHECKS THE RESOLUTION, NOT JUST THE MATCH. The scan credited
    a bare name anywhere in the corpus, so `triage.due` was "called" by
    `digest.due` and `schedule_mod.due` — different functions — while sitting
    unreachable without the cadence floor. The middle case below is that
    defect: identical call TEXT in a file that cannot import the definition.
    """
    node = ast.parse("def only_in_tests():\n    pass").body[0]
    call = re.compile(r"(?<![\w.])only_in_tests\s*\(")
    here = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "x.py")
    there = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta", "y.py")

    def _with(source: str) -> Dict[str, str]:
        _SOURCE[there] = source
        return {there: source}

    assert not _called(_with("nothing_here = 1"), call, node, here,
                       name="only_in_tests"), "a file with no mention credited it"

    # ⚠️ THE DEFECT ITSELF: the right text, in a file that cannot reach it.
    assert not _called(_with("only_in_tests()"), call, node, here,
                       name="only_in_tests"), (
        "a call with no import credited it — this is the name-collision blind "
        "spot, and 68 shipped function names are defined in two or more files")

    assert _called(_with("from vesta.x import only_in_tests\n"
                         "only_in_tests()"), call, node, here,
                   name="only_in_tests"), "an imported, called function was missed"

    # ⚠️ A REFERENCE IS A USE. `set_brief_composer(agent_compose.brief)`.
    assert _called(_with("from vesta import x as x_mod\n"
                         "register(x_mod.only_in_tests)"), call, node, here,
                   name="only_in_tests"), "a function passed as a value was missed"

    # ⚠️ AND PROSE IS NOT. `audit.passes` was credited by its own docstring,
    # "The triage passes, newest last." — a name and a comma.
    assert not _called(_with("# the only_in_tests, newest last"), call, node,
                       here, name="only_in_tests"), "prose credited a caller"
