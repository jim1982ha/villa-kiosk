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
