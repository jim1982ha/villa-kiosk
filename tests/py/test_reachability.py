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
import os
import re
import subprocess
import sys
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

PKG = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent")

#: name -> why it has no shipped caller. ⚠️ EVERY ENTRY IS A DECISION SOMEBODY
#: MADE, and the ones marked BLOCKED are findings rather than exemptions — they
#: are here so the count does not grow silently, not because they are fine.
EXEMPT: Dict[str, str] = {
    # ── genuinely unreachable, and that is a FINDING (TASK-106, parked) ──
    "occupancy": "route.py is imported by nothing shipped. REQ-034's occupancy "
                 "input has no producer — TASK-106, parked by the owner "
                 "2026-08-23, see docs/BACKLOG.md",
    "escalate": "route.py is imported by nothing shipped. REQ-033 is NOT MET "
                "for this reason — TASK-106, parked",
    "note_delivered": "records a delivered concern so a reply can resolve "
                      "'why?' without naming the subject (REQ-014). Nothing "
                      "delivers a concern yet — TASK-106, parked",

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
    "dismissals_of": "the per-subject count. `suppressed_subjects` computes the "
                     "whole map in one pass and is what policy reads; this is "
                     "the single-subject reader a diagnostic would want",
    "coerce_severity": "the inbound half of the severity vocabulary, mirroring "
                       "`severity_rank`. Kept so the contract is complete in "
                       "both directions",
    "plan": "route.py is imported by nothing shipped — this is THE routing "
            "entry point, and its absence is why TASK-063 cannot run. "
            "TASK-106, parked",
    "correct": "the one path that sets `corrected` on a memory (REQ-056), and "
               "no route or control reaches it — so a person cannot in fact "
               "correct a memory, and `write()`'s refusal to overwrite one "
               "guards a state nothing can enter. Recorded as TASK-110; "
               "docs/VALIDATION.md marks REQ-056 NOT MET because of this",
    "status": "budget diagnostics for an operator; the Cockpit reads the "
              "narrower `summary()` instead",

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
}


def _shipped() -> Dict[str, str]:
    """Every tracked file under `rootfs/` and `src/`, by path.

    ⚠️ TRACKED, NOT ON DISK. A caller that exists only in an untracked scratch
    file is not a caller — the same rule `test_hard_rules` learned the hard way,
    one release late.
    """
    out = subprocess.run(["git", "ls-files", "rootfs/", "src/"],
                         capture_output=True, text=True, cwd=REPO_ROOT)
    files: Dict[str, str] = {}
    for rel in out.stdout.split():
        path = os.path.join(REPO_ROOT, rel)
        if os.path.exists(path):
            try:
                files[path] = open(path, encoding="utf-8",
                                   errors="ignore").read()
            except OSError:
                pass
    return files


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
            if not _called(files, call, node, path):
                found.append(f"{node.name}  ({os.path.basename(path)}:"
                             f"{node.lineno})")
    return found


def _called(files: Dict[str, str], call: "re.Pattern[str]", node: ast.AST,
            path: str) -> bool:
    """⚠️ THE DEFINITION LINE AND COMMENTS DO NOT COUNT. Prose naming a function
    is not a use of it — that alone was three false hits in /dry-audit's own
    history, in this same repository."""
    lineno = getattr(node, "lineno", -1)
    name = getattr(node, "name", "")
    for where, text in files.items():
        for i, line in enumerate(text.splitlines(), 1):
            if where == path and i == lineno:
                continue
            stripped = line.lstrip()
            if stripped.startswith(("#", "//", "*", "⚠️")):
                continue
            if re.match(rf"\s*(async )?def {re.escape(name)}\b", line):
                continue
            if call.search(line):
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
    failure mode it exists to catch, so it is worth one test."""
    files = {"x.py": "nothing here"}
    node = ast.parse("def only_in_tests():\n    pass").body[0]
    assert not _called(files, re.compile(r"(?<![\w.])only_in_tests\s*\("),
                       node, "x.py")
    assert _called({"x.py": "    only_in_tests()"},
                   re.compile(r"(?<![\w.])only_in_tests\s*\("), node, "y.py")
