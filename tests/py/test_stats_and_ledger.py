"""Statistics windowing and the read-only ledger.

Two modules, one file, because each is small and their tests share nothing.
The rules being pinned are the ones that fail SILENTLY: a window that drifts an
hour, a zero that means "no data", and a privacy guarantee that depends on code
that is absent rather than code that is careful.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from reports import ledger
from reports.stats import (
    accumulating_ids,
    chunked,
    completeness,
    measurement_ids,
    start_of_day,
    total_change,
)

# ── stats ────────────────────────────────────────────────────────────────────


def test_start_of_day_is_midnight() -> None:
    now = datetime(2026, 8, 20, 14, 37, 12, tzinfo=timezone.utc)
    assert start_of_day(now) == datetime(2026, 8, 20, 0, 0, tzinfo=timezone.utc)


def test_window_lands_on_midnight_every_day_back() -> None:
    """⚠️ WALL CLOCK, NOT 24-HOUR MULTIPLES.

    Two days a year are 23 or 25 hours long wherever DST applies. Subtracting
    `n * 86400` seconds gives a window starting an hour off for half the year,
    which shifts every daily bucket — and a day-of-week baseline then compares
    Monday against a slice of Sunday.
    """
    now = datetime(2026, 8, 20, 14, 37, tzinfo=timezone.utc)
    for days in range(0, 40):
        moment = start_of_day(now, days)
        assert (moment.hour, moment.minute, moment.second) == (0, 0, 0), days


def test_window_walks_back_whole_days() -> None:
    now = datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc)
    assert (start_of_day(now, 0) - start_of_day(now, 7)) == timedelta(days=7)


def test_total_change_distinguishes_no_data_from_zero() -> None:
    """A meter that reported nothing is not a meter that consumed nothing.

    Returning 0.0 for an offline meter would put a number in the report that
    nobody measured — which is exactly what DATA_QUALITY findings exist to
    prevent.
    """
    assert total_change([]) is None
    assert total_change([{"change": None}]) is None
    assert total_change([{"change": 0.0}]) == 0.0
    assert total_change([{"change": 1.5}, {"change": 2.0}]) == 3.5


def test_total_change_ignores_non_numeric() -> None:
    assert total_change([{"change": "1.5"}, {"change": 2.0}]) == 2.0


def test_completeness_reports_a_partial_window() -> None:
    """Travels with every finding so a conclusion drawn from 4 of 14 days can
    say so rather than presenting itself with full confidence."""
    rows: List[Dict[str, Any]] = [{"change": 1.0}] * 7
    assert completeness(rows, 14) == 0.5
    assert completeness(rows, 7) == 1.0
    assert completeness([], 14) == 0.0
    assert completeness(rows, 0) == 0.0


def test_completeness_never_exceeds_one() -> None:
    assert completeness([{"change": 1.0}] * 20, 14) == 1.0


def test_chunking_covers_every_id_exactly_once() -> None:
    ids = [f"sensor.s{n}" for n in range(127)]
    groups = list(chunked(ids))
    assert sum(len(g) for g in groups) == 127
    assert [i for g in groups for i in g] == ids
    assert max(len(g) for g in groups) <= 50


def test_accumulating_and_measurement_are_disjoint() -> None:
    """`change` is right for accumulating statistics and meaningless for
    sampled ones; asking the wrong question of either returns numbers that look
    plausible."""
    metadata = [
        {"statistic_id": "sensor.energy", "has_sum": True, "has_mean": False},
        {"statistic_id": "sensor.temperature", "has_sum": False, "has_mean": True},
        {"statistic_id": "sensor.odd", "has_sum": True, "has_mean": True},
    ]
    accumulating = set(accumulating_ids(metadata))
    measurement = set(measurement_ids(metadata))
    assert "sensor.energy" in accumulating
    assert "sensor.temperature" in measurement
    assert not (accumulating & measurement), "a statistic must not be in both"


# ── ledger ───────────────────────────────────────────────────────────────────


def _fm() -> Dict[str, Any]:
    return {
        # ⚠️ `status` IS THE FIELD THAT DECIDES, NOT `resolvedAt` (D12). These
        # rows carried only `resolvedAt` and the summary read it, which
        # disagreed with `fmEngine.ticketStats` — the rule the Facility Report
        # prints from. `t4` is the row that used to be answered two ways: no
        # `status` at all, which the kiosk counted RESOLVED via a bare `else`
        # and which is now OPEN on both sides, because a fault must not be
        # removed from a report by bad data.
        "tickets": [
            {"id": "t1", "entityId": "sensor.pump", "status": "resolved",
             "resolvedAt": "2026-08-01",
             "photoIds": ["p1", "p2"], "note": "operator free text"},
            {"id": "t2", "status": "resolved", "resolvedAt": "2026-07-01",
             "photoIds": []},
            {"id": "t3", "status": "open", "photoIds": ["p3"]},
            {"id": "t4", "photoIds": []},
        ],
        "costs": [
            {"id": "c1", "amount": 120.0, "date": "2026-08-02", "photoIds": []},
            {"id": "c2", "amount": 40.0, "date": "2026-06-02", "photoIds": []},
            {"id": "c3", "amount": True, "date": "2026-08-03", "photoIds": []},
        ],
        "schedules": [], "completions": [], "savedDocuments": [],
    }


def test_missing_store_reads_as_empty(tmp_path: Any) -> None:
    assert ledger.read(str(tmp_path / "absent.json")) == {}


def test_corrupt_store_degrades_rather_than_raising(tmp_path: Any) -> None:
    path = tmp_path / "fm-data.json"
    path.write_text("{not json", encoding="utf-8")
    assert ledger.read(str(path)) == {}


def test_summary_counts_tickets_by_resolution() -> None:
    summary = ledger.summarise(_fm())
    # t3 (open) and t4 (no status — see the fixture note) are both OPEN.
    assert summary["tickets_open"] == 2
    assert summary["tickets_resolved"] == 2
    assert summary["tickets_resolved_with_entity"] == 1


def test_a_ticket_with_no_status_is_open_not_resolved() -> None:
    """⚠️ THE DIRECTION THIS MAY NOT FAIL IN. A row whose status is missing or
    corrupt must surface as a fault, never vanish into the resolved count —
    the kiosk's bare `else` used to do exactly that."""
    assert ledger.ticket_is_open({"id": "x"})
    assert ledger.ticket_is_open({"id": "x", "status": ""})
    assert ledger.ticket_is_open({"id": "x", "status": "in_progress"})
    assert ledger.ticket_is_resolved({"id": "x", "status": "resolved"})


def test_resolved_at_alone_does_not_close_a_ticket() -> None:
    """`resolvedAt` answers WHEN, not WHETHER — see `ticket_is_resolved`.
    A stamp on a row still marked open is data debris and the status wins."""
    assert ledger.ticket_is_open({"status": "open", "resolvedAt": "2026-08-01"})
    assert ledger.ticket_is_resolved({"status": "resolved"})


def test_summary_counts_photos_and_never_names_them() -> None:
    """⚠️ Rule 2: evidence is COUNTED, never resolved.

    A photograph of a villa's interior is the most sensitive thing this add-on
    stores, and Phase 6 sends narration payloads to a third party. The summary
    must carry a number and no identifier.
    """
    summary = ledger.summarise(_fm())
    assert summary["evidence_photos"] == 3
    rendered = json.dumps(summary)
    for photo_id in ("p1", "p2", "p3"):
        assert photo_id not in rendered


def test_summary_carries_no_free_text() -> None:
    """Ticket and cost descriptions are written by people about their homes."""
    assert "operator free text" not in json.dumps(ledger.summarise(_fm()))


def test_ledger_module_cannot_read_evidence_bytes() -> None:
    """The guarantee is worth more as "there is no such code path" than as
    "the code path is careful". Asserted against the source, because a future
    edit adding one would otherwise pass every behavioural test here."""
    import inspect

    source = inspect.getsource(ledger)
    body = "\n".join(line for line in source.splitlines()
                     if not line.strip().startswith(("#", '"', "'")))
    assert "fm-evidence" not in body
    assert "evidence/" not in body


def test_empty_store_is_reported_absent_not_empty() -> None:
    assert ledger.summarise({})["present"] is False
    assert ledger.summarise(_fm())["present"] is True


def test_cost_total_ignores_boolean_amounts() -> None:
    """`isinstance(True, int)` again — a JSON `true` would add 1.0."""
    assert ledger.cost_total(_fm()) == 160.0


def test_cost_total_filters_by_date() -> None:
    assert ledger.cost_total(_fm(), since_iso="2026-08-01") == 120.0


def test_resolved_tickets_are_newest_first() -> None:
    data = {"tickets": [
        {"id": "old", "entityId": "sensor.x", "resolvedAt": "2026-01-01"},
        {"id": "new", "entityId": "sensor.x", "resolvedAt": "2026-08-01"},
        {"id": "open", "entityId": "sensor.x"},
    ]}
    got = ledger.resolved_tickets_for(data, "sensor.x")
    assert [row["id"] for row in got] == ["new", "old"]
