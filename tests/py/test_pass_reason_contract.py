"""The triage pass's reason sentence is a CONTRACT, and it has three readers.

⚠️ FOUND BY /dry-audit PART 5 ON 2026-08-25, THE DAY THE THIRD READER SHIPPED.
`scheduler._run_once` returns a reason as PROSE — "nothing to escalate",
`f"escalated {n} ({clause}): {subjects}"` — and three separate places parse it
back:

  1. `scheduler.run_once` (Python), to recover the escalated COUNT and the
     SUBJECTS for the audit row.
  2. `audit.record_pass` (Python), which JOINS it to the numbers with " | ".
  3. `ShadowDiffPanel.outcomeOf`/`reasonOf` (TypeScript), which splits on that
     separator and classifies the pass as raised / quiet / could-not-run.

Nothing connects them but string literals in two languages. Reword
`"nothing to escalate"` and the Handover page silently reclassifies every quiet
pass as "could not run" — the panel whose entire purpose is separating "looked
and agreed" from "never ran" would invert exactly that distinction, and it would
render as a villa whose supervision had failed.

⚠️ WHY THIS IS A TEST AND NOT A COMMENT. The producer and the consumers are in
different languages, so neither tsc nor mypy can see the pair, and the failure is
silent in the direction that reads as bad news — which is the direction nobody
double-checks. Same shape as `test_store_envelope.py` and `test_nginx_routes.py`.

⚠️ THE LITERALS ARE DERIVED FROM THE PRODUCER, NEVER RESTATED HERE. A test
holding its own copy of "nothing to escalate" is a fourth reader of the contract
and would agree with itself forever while the app moved.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BIN = os.path.join(ROOT, "rootfs", "usr", "bin")
PANEL = os.path.join(ROOT, "src", "components", "settings", "ShadowDiffPanel.tsx")


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _quiet_literal() -> str:
    """The exact string `_run_once` returns for a successful quiet pass."""
    src = _read(os.path.join(BIN, "agent", "scheduler.py"))
    found = re.findall(r'return "(nothing[^"]*)"', src)
    assert len(found) == 1, (
        "expected exactly one quiet-pass return in scheduler.py, found "
        f"{found!r} — the anchor moved and this test is about to pass "
        "vacuously")
    return found[0]


def _escalated_prefix() -> str:
    """The literal prefix an escalating pass's reason starts with."""
    src = _read(os.path.join(BIN, "agent", "scheduler.py"))
    found = re.findall(r'return \(f"(escalated) \{', src)
    assert found, "scheduler.py no longer builds an `escalated N ...` reason"
    return found[0] + " "


def _detail_separator() -> str:
    """What `audit.record_pass` joins the reason and the numbers with."""
    src = _read(os.path.join(BIN, "agent", "audit.py"))
    assert 'f"{reason} | doc=' in src, (
        "record_pass no longer joins the reason to the numbers with ' | ' — "
        "the panel splits on exactly that separator to recover the sentence")
    return " | "


def test_the_panel_classifies_using_the_producer_s_OWN_literals() -> None:
    panel = _read(PANEL)
    quiet, prefix, sep = _quiet_literal(), _escalated_prefix(), _detail_separator()

    assert f'reason === "{quiet}"' in panel, (
        f"the panel does not recognise {quiet!r}, which is what "
        "scheduler.py returns for a pass that looked and found nothing — so "
        "every quiet pass now reports as 'could not run'")
    assert f'reason.startsWith("{prefix}")' in panel, (
        f"the panel does not recognise the {prefix!r} prefix, so a pass that "
        "raised something reports as a failure")
    assert f'split("{sep}")' in panel, (
        "the panel no longer splits `detail` on the separator record_pass "
        "writes, so it renders the numbers as part of the sentence")


def test_the_escalated_reason_keeps_the_shape_BOTH_parsers_depend_on() -> None:
    """⚠️ `head.split()[1]` AND `indexOf(": ")`, IN TWO LANGUAGES. Python
    recovers the count from the second whitespace-separated token and the
    subjects from after the first ": "; the panel recovers the subjects the same
    way. `Followup.clause` already guards its half by stripping colons — this
    guards the other half, the word order it strips them FOR."""
    sched = _read(os.path.join(BIN, "agent", "scheduler.py"))
    assert re.search(r'f"escalated \{len\(result\.escalations\)\} "', sched), (
        "the count is no longer the second token, so scheduler.run_once's own "
        "`head.split()[1]` and the panel's count both read the wrong word")
    assert re.search(r'f"\(\{follow\.clause\(\)\}\): \{subjects\}"', sched), (
        "the clause/subjects shape changed; both parsers split on the first "
        "': ' and would file part of the clause as a subject")
    clause = _read(os.path.join(BIN, "agent", "reason.py"))
    assert '.replace(":", ";")' in clause, (
        "Followup.clause no longer strips colons, so a clause containing one "
        "silently truncates the subject list in the audit row and on screen")


def test_the_panel_shows_the_investigation_yield_the_clause_carries() -> None:
    """⚠️ THE CLAUSE IS WHERE THE MONEY IS, AND IT WAS RENDERED AS PROSE ONLY.
    `Followup.clause` writes "investigated N, M concerns"; N is what was paid
    for at frontier-model prices and M is what came back. A page reporting only
    that the assistant "reached 0 of 24" cannot distinguish an assistant that
    never looked from one that looked twenty times and correctly concluded
    nothing — and the second is a deliberate instruction in `reason.SYSTEM`
    ("finding nothing is a good outcome"), not a fault."""
    panel = _read(PANEL)
    assert "investigated" in panel and "concern" in panel, (
        "the panel does not read the clause, so the one number that says where "
        "the spend went is invisible")
    assert re.search(r'investigated \\s\*\(\\d\+\)|investigated \(\\d\+\)|/investigated', panel), (
        "nothing parses `investigated N` out of the reason")
