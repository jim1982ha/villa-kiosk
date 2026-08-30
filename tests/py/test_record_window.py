"""The briefing's window is an INSTANT, not a string.

⚠️ FOUND ON THE OWNER'S PHONE (2026-08-30). Their device watchdog fired six
times at 00:52 local and the 10:00 daily briefing did not mention it. The
entries were in the ledger, correctly stamped `2026-08-29T16:52:25+00:00` —
00:52 local on a UTC+8 villa. `since()` compared them as STRINGS against
`schedule.period_start`, which is deliberately the villa's LOCAL wall-clock
midnight and therefore carries a `+08:00` offset. Lexically
`"2026-08-29T16:52:25+00:00" < "2026-08-30T00:00:00+08:00"`, so the first eight
hours of every local day were silently dropped.

⚠️ THE RULE ALREADY EXISTED AND THIS LEDGER NEVER JOINED IT.
`collect.as_utc_iso` calls itself "THE ONE LINE THAT MAKES STRING COMPARISON
LEGAL" and `journal.since` warns callers to normalise. `record.py` was written
later, made the same comparison, and used neither — `feedback_audit-applicable-set`
exactly: roll a rule out by what it APPLIES to, not by its existing call sites.

⚠️ EVERY LINE OF THE REAL REPORT RECONCILED WITH THE BUG, which is what turned
a suspicion into a diagnosis: the two entries stamped `00:00:00+00:00` were
missing too, and they are dropped by the same comparison for the same reason.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.adapters import record as record_mod  # noqa: E402

#: The owner's own ledger, trimmed to the boundary. UTC stamps, as `append`
#: writes them; the villa runs at UTC+8.
ROWS: List[Dict[str, Any]] = [
    {"at": "2026-08-29T15:59:00+00:00", "source": "automation", "subject": "yesterday"},
    {"at": "2026-08-29T16:52:25+00:00", "source": "automation", "subject": "critical_watchdog---devices"},
    {"at": "2026-08-30T00:00:00+00:00", "source": "automation", "subject": "critical_schedule---house_pump"},
    {"at": "2026-08-30T01:00:00+00:00", "source": "automation", "subject": "critical_schedule---jacuzzi_pump"},
]
#: What `pipeline` passes: local wall-clock midnight, offset and all.
LOCAL_MIDNIGHT = "2026-08-30T00:00:00+08:00"


def _subjects(rows: Any, bound: str) -> List[str]:
    record_mod.read = lambda: list(rows)          # type: ignore[assignment]
    return [str(r.get("subject")) for r in record_mod.since(bound)]


def test_the_local_day_starts_at_the_right_instant(monkeypatch: Any) -> None:
    """⚠️ THE REPORTED CASE. 16:52:25Z IS 00:52 local — inside today."""
    monkeypatch.setattr(record_mod, "read", lambda: list(ROWS))
    got = [str(r.get("subject")) for r in record_mod.since(LOCAL_MIDNIGHT)]

    assert "critical_watchdog---devices" in got, (
        "the watchdog firing at 00:52 local was dropped from the daily brief — "
        "the window is being compared as a string against a local-offset bound")
    assert "critical_schedule---house_pump" in got, (
        "an entry stamped exactly 00:00:00Q was dropped: it is 08:00 local, "
        "comfortably inside the day")
    assert "yesterday" not in got, "the window no longer excludes anything"


def test_the_boundary_is_the_instant_not_the_date(monkeypatch: Any) -> None:
    """15:59Z is 23:59 local YESTERDAY and must stay out; one minute later is in."""
    monkeypatch.setattr(record_mod, "read", lambda: list(ROWS))
    got = [str(r.get("subject")) for r in record_mod.since(LOCAL_MIDNIGHT)]
    assert got == ["critical_watchdog---devices",
                   "critical_schedule---house_pump",
                   "critical_schedule---jacuzzi_pump"], got


def test_a_utc_bound_still_behaves(monkeypatch: Any) -> None:
    """⚠️ THE COMMON PATH IS UNCHANGED. A caller already passing UTC — which is
    every caller that was correct before — gets exactly what it got."""
    monkeypatch.setattr(record_mod, "read", lambda: list(ROWS))
    got = [str(r.get("subject")) for r in record_mod.since("2026-08-30T00:00:00+00:00")]
    assert got == ["critical_schedule---house_pump",
                   "critical_schedule---jacuzzi_pump"], got


def test_a_naive_stamp_is_read_as_utc(monkeypatch: Any) -> None:
    """⚠️ THE ASSERTION MUST BE THE ONE THAT DISCRIMINATES, AND THE FIRST DRAFT
    WAS NOT (found by mutation, 2026-08-30). It used a naive stamp INSIDE the
    window and asserted it survived — but a naive stamp REJECTED as unreadable
    also survives, through the fail-open branch. So the test passed whether the
    naive path worked or not.

    A naive stamp OUTSIDE the window separates them: read as UTC it is
    correctly dropped; treated as unreadable it is wrongly kept."""
    monkeypatch.setattr(record_mod, "read", lambda: [
        {"at": "2026-08-30T01:00:00", "subject": "naive-inside"},
        {"at": "2026-08-29T01:00:00", "subject": "naive-outside"}])
    got = [str(r.get("subject"))
           for r in record_mod.since("2026-08-30T00:00:00+00:00")]
    assert got == ["naive-inside"], (
        f"a naive stamp is not being read as UTC: {got}")


def test_an_unreadable_bound_or_stamp_fails_OPEN(monkeypatch: Any) -> None:
    """⚠️ THIN-BUT-HONEST BEATS SILENTLY EMPTY — the rule `since`'s docstring
    already stated, preserved through the fix. An empty section reads as "a
    quiet day", which is the lie this subsystem keeps being caught by."""
    monkeypatch.setattr(record_mod, "read", lambda: list(ROWS))
    assert len(record_mod.since("not a timestamp")) == len(ROWS)

    monkeypatch.setattr(record_mod, "read", lambda: [{"at": "???", "subject": "odd"}])
    assert len(record_mod.since(LOCAL_MIDNIGHT)) == 1, (
        "a row with an unreadable stamp was dropped rather than kept")


# ── the family, closed ──────────────────────────────────────────────────────
def test_both_windowed_reads_share_one_implementation() -> None:
    """⚠️ THE POINT OF THE FIX, PINNED. `record.since` and `journal.since` are
    the two windowed reads in this system and they made the SAME comparison in
    two places — one correct, one shipping a bug. A third reader must not be
    able to write a fourth copy."""
    import inspect
    from vesta.supervise.observe import journal as journal_mod
    from vesta.adapters import collect as collect_mod
    from vesta.shared import instants

    for mod, name in ((record_mod, "record"), (journal_mod, "journal"),
                      (collect_mod, "collect")):
        src = inspect.getsource(mod)
        assert "instants.as_utc" in src, (
            f"{name} no longer reads its window through the shared owner")
        assert "datetime.fromisoformat" not in src, (
            f"{name} parses ISO text itself again — that is the fourth copy")

    # ⚠️ AND THE OWNER ITSELF IS PURE. `shared` ships anywhere, so a clock or a
    # file read here would break the layer it is in as well as this rule.
    #
    # ⚠️ READ FROM THE AST, NOT THE TEXT — the comment trap, hit for the third
    # time in this session. A substring scan matched `now(` inside the module's
    # own docstring, where it EXPLAINS that `record.append` uses
    # `datetime.now(timezone.utc)`. Prose that names a thing is not the tree
    # calling it.
    import ast
    tree = ast.parse(inspect.getsource(instants))
    called = {
        (node.func.attr if isinstance(node.func, ast.Attribute)
         else getattr(node.func, "id", ""))
        for node in ast.walk(tree) if isinstance(node, ast.Call)
    }
    for banned in ("now", "utcnow", "open", "read_json", "write_json"):
        assert banned not in called, (
            f"shared.instants calls {banned}() — it must stay pure, or the "
            "layer it lives in stops being shippable anywhere")


def test_the_journal_window_is_an_instant_too(monkeypatch: Any) -> None:
    """⚠️ IT HAD NO PRODUCTION CALLER, SO THE FAULT WAS LATENT, NOT ABSENT —
    which is exactly why it is fixed rather than left documented."""
    from vesta.supervise.observe import journal as journal_mod
    rows = {"entries": [
        {"at": "2026-08-29T15:59:00+00:00", "id": "yesterday"},
        {"at": "2026-08-29T16:52:25+00:00", "id": "today-0052-local"},
    ]}
    monkeypatch.setattr(journal_mod, "read", lambda: rows)
    got = [r["id"] for r in journal_mod.since("2026-08-30T00:00:00+08:00")]
    assert got == ["today-0052-local"], got
