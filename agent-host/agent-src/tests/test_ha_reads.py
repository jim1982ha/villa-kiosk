"""Reading Home Assistant through ha-mcp (vesta_shared.ha_client.McpClient). Synthetic data."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from vesta_shared.ha_client import McpClient

T = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


class SamePageSession:
    """ha-mcp 8.5.0 as seen on the villa: every offset answers the first page, has_more stays true."""

    def __init__(self, rows):
        self.rows, self.calls = rows, 0

    def call_raw(self, name, args):
        assert name == "ha_get_logs"
        self.calls += 1
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entries": self.rows, "has_more": True})}]}


def test_a_logbook_page_that_repeats_ends_the_reading_and_counts_once():
    rows = [{"when": (T - timedelta(hours=h)).isoformat(), "entity_id": "sensor.example_meter", "state": s}
            for h, s in ((5, "unavailable"), (4, "on"), (3, "unavailable"), (2, "on"))]
    session = SamePageSession(rows)
    got = McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(days=3), T)
    assert session.calls == 2                       # the second page brought nothing new: stop
    assert len(got) == 4                            # each flip once, not once per page


class HistorySession:
    """A statistics or history read whose pages misbehave: `pages` is what each call answers."""

    def __init__(self, pages):
        self.pages, self.calls = pages, 0

    def call_raw(self, name, args):
        assert name == "ha_get_history"
        page = self.pages[min(self.calls, len(self.pages) - 1)]
        self.calls += 1
        key = "statistics" if args["source"] == "statistics" else "states"
        return {"content": [{"type": "text", "text": json.dumps(
            {"success": True, "entities": [{"entity_id": args["entity_ids"], key: page, "has_more": True}]})}]}


def test_statistics_and_history_stop_on_a_page_that_brings_nothing_new():
    # architecture review, 2026-10-07: only the logbook had this rule; an empty or repeated page that said "more"
    # looped for ever on the statistics and the history
    rows = [{"start": 1_700_000_000_000 + i * 3_600_000, "mean": i} for i in range(3)]
    for pages in ([rows, []], [rows, rows]):                            # an empty page, then the same page again
        s = HistorySession(pages)
        got = McpClient("http://unused", "UTC", session=s).statistics(["sensor.x"], T - timedelta(days=1), T)
        assert s.calls == 2 and len(got["sensor.x"]) == 3
    s = HistorySession([[{"state": "on", "last_changed": "2026-09-30T10:00:00+00:00"}], []])
    assert len(McpClient("http://unused", "UTC", session=s).history(["sensor.x"], T - timedelta(days=1), T)["sensor.x"]) == 1
    assert s.calls == 2
