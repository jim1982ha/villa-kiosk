"""Reading Home Assistant through ha-mcp (vesta_shared.ha_client.McpClient). Synthetic data."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from vesta_shared.ha_client import McpClient
from vesta_agent.roster import Roster

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
    got = McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(hours=6), T)   # one slice
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
    monkeypatch.setattr(ha_client, "history_max_calls", lambda: 8)
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
    """ha-mcp as on the villa (2026-10-13): the hours asked back from end_time, at most 500 rows a page whatever is
    asked, oldest first — `total` rows in all, one every `every` seconds from 3 days back. `fetched`: how many rows of
    the logbook each call had Home Assistant read (the whole period asked, at every page)."""

    def __init__(self, total, cap=500, every=2.0):
        self.cap, self.fetched = cap, []
        self.rows = [{"when": (T - timedelta(days=3) + timedelta(seconds=every * i)).isoformat(), "entity_id": "sensor.example",
                      "state": str(i)} for i in range(total)]

    def call_raw(self, name, args):
        end = datetime.fromisoformat(args["end_time"])
        window = [r for r in self.rows if end - timedelta(hours=args["hours_back"]) <= datetime.fromisoformat(r["when"]) < end]
        self.fetched.append(len(window))
        off, n = args["offset"], min(args["limit"], self.cap)
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entries": window[off:off + n],
                                                                 "has_more": off + n < len(window)})}]}


def test_a_long_logbook_is_read_to_its_end_and_a_read_cut_short_says_where():
    # 2026-10-13: the night's 3-day logbook held 13,031 rows; 20 pages of 500 read 10,000 and stopped at 08:41 the day
    # before — a relay's last 17 hours of drops never counted
    book = CappedLogbook(13_031, every=19.8)                                      # three days of the villa's logbook
    c = McpClient("http://unused", "UTC", session=book)
    assert len(c.logbook(T - timedelta(days=3), T)) == 13_031 and c.logbook_cut is None
    # 2026-10-15: each call has Home Assistant read its own 6 hours, never the whole period again at every page
    # (read in one window, each of its 27 pages had the whole three days read: 27 × 13,031 rows)
    assert max(book.fetched) <= 6 * 3600 / 19.8 + 2 and sum(book.fetched) < 4 * 13_031
    c = McpClient("http://unused", "UTC", session=CappedLogbook(200 * 500 + 1, every=0.1))   # past every page it may read
    rows = c.logbook(T - timedelta(days=3), T)
    assert c.logbook_cut == max(datetime.fromisoformat(r["when"]) for r in rows)   # where the reading stopped


def test_the_ai_reads_the_whole_villas_logbook_a_few_hours_at_a_time(tmp_path):
    # villa, 2026-10-15: an /investigate read the logbook of every device over a week, a call every 15 s for 14 minutes —
    # ha-mcp fetches the whole period from Home Assistant at each page
    import asyncio
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    from vesta_shared.read_guard import logbook_villa_hours
    LOGBOOK_VILLA_HOURS = logbook_villa_hours()
    ha = FakeHA(tools=[tool("ha_get_logs", source="string", hours_back="number", entity_id="string", end_time="string")])
    v = make_agent(tmp_path, {"ha_read_tools": ["ha_get_logs"]}, roster=Roster.of(owner=[(111, "Owner"), (-1, "Owner chat")]), reader=ha)
    asyncio.run(v.refresh_server_tools())                                     # the tools HA MCP lists, as at start
    logs = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_get_logs")
    week = asyncio.run(logs.handler({"source": "logbook", "hours_back": 168}))
    assert week.get("is_error") and "6 hours at a time" in week["content"][0]["text"] and ha.calls == []
    assert asyncio.run(logs.handler({"hours_back": 168})).get("is_error")                   # the logbook is the default
    asyncio.run(logs.handler({"source": "logbook", "hours_back": LOGBOOK_VILLA_HOURS}))       # the hours around a moment
    asyncio.run(logs.handler({"source": "logbook", "hours_back": 168, "entity_id": "sensor.example_room"}))  # one device
    asyncio.run(logs.handler({"source": "system"}))                                          # the system log: not a window
    assert [c[1].get("hours_back") for c in ha.calls] == [LOGBOOK_VILLA_HOURS, 168, None]


def test_the_ai_reads_since_when_a_door_is_really_unlocked_never_the_restart(tmp_path):
    # villa, 2026-10-26: the weekly report's headline said "the Master Bedroom door has been unlocked since Sunday
    # 13:29" — the restart of the villa's system, which resets last_changed — of a door unlocked since Saturday 18:25
    import asyncio
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    unlocked, restart = "2026-10-24T10:25:00+00:00", "2026-10-25T05:29:00+00:00"
    state = {"data": {"entity_id": "lock.example_door", "state": "unlocked", "last_changed": restart}}
    rows = [{"state": "locked", "last_changed": "2026-10-24T08:00:00+00:00"},
            {"state": "unlocked", "last_changed": unlocked},
            {"state": "unavailable", "last_changed": "2026-10-25T05:28:30+00:00"},     # the restart's gap
            {"state": "unlocked", "last_changed": restart}]
    history = {"data": {"success": True, "entities": [{"entity_id": "lock.example_door", "states": rows}]}}
    found = {"data": {"entities": [{"entity_id": "lock.example_door", "state": "unlocked", "last_changed": restart}]}}
    ha = FakeHA(tools=[tool("ha_get_state", entity_id="string"), tool("ha_search", query="string")],
                answers={"ha_get_state": json.dumps(state), "ha_get_history": json.dumps(history),
                         "ha_search": json.dumps(found)})
    v = make_agent(tmp_path, {"ha_read_tools": ["ha_get_state", "ha_search"]}, roster=Roster.of(owner=[(111, "Owner"), (-1, "Owner chat")]), reader=ha)
    asyncio.run(v.refresh_server_tools())
    get = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_get_state")
    said = json.loads(asyncio.run(get.handler({"entity_id": "lock.example_door"}))["content"][0]["text"])["data"]
    assert said["last_changed"] == restart                                        # the villa's own answer, kept
    assert datetime.fromisoformat(said["in_state_since"]) == datetime.fromisoformat(unlocked), said
    assert "restart" in said["in_state_since_note"]
    # every read tool that gives a state with its last_changed: a search too
    search = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_search")
    hit = json.loads(asyncio.run(search.handler({"query": "door"}))["content"][0]["text"])["data"]["entities"][0]
    assert datetime.fromisoformat(hit["in_state_since"]) == datetime.fromisoformat(unlocked), hit
    # a state that really changed at its last_changed: nothing added
    rows[:] = [{"state": "locked", "last_changed": "2026-10-24T08:00:00+00:00"}, {"state": "unlocked", "last_changed": restart}]
    ha.answers["ha_get_history"] = json.dumps(history)
    said = json.loads(asyncio.run(get.handler({"entity_id": "lock.example_door"}))["content"][0]["text"])["data"]
    assert "in_state_since" not in said, said


def test_one_session_serves_every_call_of_a_run_even_with_no_session_id():
    # owner, 2026-10-30: the recheck's ~220 calls were each initialize, initialized, call — ha-mcp answers with no
    # session id, and a new session was opened before every call
    from vesta_shared.ha_client import McpSession
    sent = []

    class Stateless(McpSession):
        def _http(self, payload, headers):
            body = json.loads(payload)
            sent.append(body["method"])
            if "id" not in body:
                return 202, {}, b""
            return 200, {"content-type": "application/json"}, json.dumps(
                {"jsonrpc": "2.0", "id": body["id"], "result": {"content": []}}).encode()

    s = Stateless("http://unused")
    for _ in range(3):
        s.call_raw("ha_get_state", {"entity_id": "sensor.x"})
    assert sent.count("initialize") == 1 and sent.count("tools/call") == 3
    assert s.calls == {"ha_get_state": 3}


