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


class WindowSession:
    """ha-mcp as it answers: hours_back counted back from end_time."""

    def __init__(self):
        self.args = []

    def call_raw(self, name, args):
        self.args.append(args)
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entries": [], "has_more": False})}]}


def test_a_past_period_asks_for_its_own_hours_counted_back_from_its_end():
    # 2026-10-11: counted from now, one day two days ago read 67 hours (24 pages, 75 s)
    for start, end, hours in ((T - timedelta(days=3), T - timedelta(days=2), 24),
                              (T - timedelta(days=3, minutes=30), T - timedelta(days=2), 25),
                              (T - timedelta(minutes=5), T, 1)):
        session = WindowSession()
        McpClient("http://unused", "UTC", session=session).logbook(start, end)
        assert (session.args[0]["hours_back"], session.args[0]["end_time"]) == (hours, end.isoformat())


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


class Recorder:
    """ha_get_history as ha-mcp answers it (seen on the villa, 2026-10-11): the window's states, opening with the state
    carried over from before it stamped at the window's start; the WHOLE window fetched, then cut to limit/offset."""

    def __init__(self, rows):
        self.rows, self.windows = rows, []

    def call_raw(self, name, args):
        a, b = datetime.fromisoformat(args["start_time"]), datetime.fromisoformat(args["end_time"])
        self.windows.append((a, b))
        inside = [(t, v) for t, v in self.rows if a <= t < b]
        before = [(t, v) for t, v in self.rows if t < a][-1:]
        states = [{"state": before[0][1], "last_changed": a.isoformat()}] if before and not (inside and inside[0][0] == a) else []
        states += [{"state": v, "last_changed": t.isoformat()} for t, v in inside]
        off, lim = args.get("offset") or 0, args["limit"]
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entities": [
            {"entity_id": args["entity_ids"], "states": states[off:off + lim], "has_more": off + lim < len(states),
             "next_offset": off + lim if off + lim < len(states) else None}]})}]}


def test_a_dense_history_is_read_by_slices_each_once_and_whole():
    # 2026-10-11: 3 days of a power meter reporting every few seconds were paged 88 times, ha-mcp re-reading the whole
    # 3 days for each page — minutes for one device, in the middle of an answer
    start = T - timedelta(days=3)
    rows = [(start - timedelta(seconds=7), "0.0")]                       # the state the period opens with
    rows += [(start + timedelta(seconds=5 * i), f"{i % 7}.0") for i in range(3 * 86400 // 5)]
    rec = Recorder(rows)
    got = McpClient("http://unused", "UTC", session=rec).history(["sensor.meter"], start, T)["sensor.meter"]
    # every reading once, at its own time: none added, none moved to a slice's edge
    assert [(r["state"], r["last_changed"]) for r in got] == [(v, t.isoformat()) for t, v in rows if start <= t < T]
    assert len(rec.windows) < 150                                        # was 52 pages of the WHOLE period each
    assert max(b - a for a, b in rec.windows) <= timedelta(hours=6)      # never the whole period at once
    quiet = Recorder([(start - timedelta(hours=1), "off"), (start + timedelta(hours=30), "on")])
    got = McpClient("http://unused", "UTC", session=quiet).history(["switch.x"], start, T)["switch.x"]
    assert [r["state"] for r in got] == ["off", "on"]                    # the opening state, then the one change
    assert len(quiet.windows) <= 6                                       # a quiet device: slices grow


def test_a_history_read_cut_short_says_where(monkeypatch):
    # review 32: stopped at its cap, it returned what it had, and the last state read was stretched to the end
    from vesta_shared import ha_client
    monkeypatch.setattr(ha_client, "HISTORY_MAX_CALLS", 8)
    start = T - timedelta(days=3)
    rows = [(start + timedelta(seconds=5 * i), f"{i % 7}.0") for i in range(3 * 86400 // 5)]
    client = McpClient("http://unused", "UTC", session=Recorder(rows))
    got = client.history(["sensor.meter"], start, T)["sensor.meter"]
    cut = client.history_cut["sensor.meter"]
    assert got and start < cut < T and all(datetime.fromisoformat(r["last_changed"]) < cut for r in got)
    whole = McpClient("http://unused", "UTC", session=Recorder(rows[:10]))
    whole.history(["sensor.meter"], start, T)
    assert whole.history_cut == {}                                       # read whole: nothing said


class CappedLogbook:
    """ha-mcp as on the villa (2026-10-13): at most 500 rows a page whatever is asked, `total` rows in all, oldest first."""

    def __init__(self, total, cap=500):
        self.total, self.cap = total, cap

    def call_raw(self, name, args):
        off, n = args["offset"], min(args["limit"], self.cap)
        rows = [{"when": (T - timedelta(days=3) + timedelta(seconds=2 * i)).isoformat(), "entity_id": "sensor.example",
                 "state": str(i)} for i in range(off, min(off + n, self.total))]
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entries": rows,
                                                                 "has_more": off + n < self.total})}]}


def test_a_long_logbook_is_read_to_its_end_and_a_read_cut_short_says_where():
    # 2026-10-13: the night's 3-day logbook held 13,031 rows; 20 pages of 500 read 10,000 and stopped at 08:41 the day
    # before — a relay's last 17 hours of drops never counted
    c = McpClient("http://unused", "UTC", session=CappedLogbook(13_031))
    assert len(c.logbook(T - timedelta(days=3), T)) == 13_031 and c.logbook_cut is None
    c = McpClient("http://unused", "UTC", session=CappedLogbook(200 * 500 + 1))     # past every page it may read
    rows = c.logbook(T - timedelta(days=3), T)
    assert c.logbook_cut == max(datetime.fromisoformat(r["when"]) for r in rows)   # where the reading stopped
