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
    got = McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(hours=6), T)   # one slice
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
    # 2026-10-11: counted from now, one day two days ago read 67 hours (24 pages, 75 s) — and 2026-10-15: the whole villa
    # is read by slices of 6 hours, each its own hours back from its own end; one entity's in one read
    session = WindowSession()
    McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(days=3), T - timedelta(days=2))
    assert [(a["hours_back"], a["end_time"]) for a in session.args] == [
        (6, (T - timedelta(days=3, hours=-6 * k)).isoformat()) for k in range(1, 5)]
    session = WindowSession()
    McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(minutes=5), T)
    assert [(a["hours_back"], a["end_time"]) for a in session.args] == [(1, T.isoformat())]
    session = WindowSession()
    McpClient("http://unused", "UTC", session=session).logbook(T - timedelta(days=3, minutes=30), T - timedelta(days=2),
                                                                entity_id="sensor.example")
    assert [(a["hours_back"], a["end_time"]) for a in session.args] == [(25, (T - timedelta(days=2)).isoformat())]


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
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": ["ha_get_logs"]}, reader=ha)
    asyncio.run(v.refresh_server_tools())                                     # the tools HA MCP lists, as at start
    logs = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_get_logs")
    week = asyncio.run(logs.handler({"source": "logbook", "hours_back": 168}))
    assert week.get("is_error") and "6 hours at a time" in week["content"][0]["text"] and ha.calls == []
    assert asyncio.run(logs.handler({"hours_back": 168})).get("is_error")                   # the logbook is the default
    asyncio.run(logs.handler({"source": "logbook", "hours_back": LOGBOOK_VILLA_HOURS}))       # the hours around a moment
    asyncio.run(logs.handler({"source": "logbook", "hours_back": 168, "entity_id": "sensor.example_room"}))  # one device
    asyncio.run(logs.handler({"source": "system"}))                                          # the system log: not a window
    assert [c[1].get("hours_back") for c in ha.calls] == [LOGBOOK_VILLA_HOURS, 168, None]


def test_find_asks_for_each_device_once_whatever_the_number_of_its_entities():
    # villa, 2026-10-15: find took 50 s — twenty entities of two sensors asked for the same device twenty times each
    import os
    import sys
    from helpers import STARTER_SKILLS
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate

    class Client:
        def __init__(self):
            self.calls = []

        def tool(self, name, args):
            self.calls.append((name, json.dumps(args, sort_keys=True)))
            if name == "ha_search" and args.get("query") == "sensor x":
                return {"entities": [{"entity_id": f"sensor.x_{i}"} for i in range(10)]}
            if name == "ha_get_entity":
                return {"entity_entries": [{"entity_id": e, "device_id": "dev1", "unique_id": "ABCDEF1234-x", "area": None}
                                           for e in args["entity_id"]]}
            if name == "ha_get_device":
                return {"entities": [{"entity_id": f"sensor.x_{i}"} for i in range(10)]}
            return {"entities": []}

        def states(self, ids):
            return {e: {"state": "1"} for e in ids}
    c = Client()
    investigate.find(c, "sensor x", None)
    assert [n for n, _ in c.calls].count("ha_get_device") == 1
    assert len([a for n, a in c.calls if n == "ha_search" and "ABCDEF1234" in a]) == 1


def test_the_log_says_who_reads_the_villa_and_for_how_long(tmp_path, caplog):
    # retro, 2026-10-15: a script reading the logbook for minutes was blamed on the AI's own tool — ha-mcp's log names the
    # request, never the caller, and a script was logged only when it ended
    import asyncio
    import logging
    from ha_fake import FakeHA, tool
    from helpers import make_agent, make_skill
    from vesta_agent import script_run
    from vesta_agent.routing import CONVERSATION, Origin
    ha = FakeHA(tools=[tool("ha_get_state", entity_id="string")])
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": ["ha_get_state"]}, reader=ha)
    asyncio.run(v.refresh_server_tools())
    get = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_get_state")
    with caplog.at_level(logging.INFO):
        asyncio.run(get.handler({"entity_id": "sensor.example_room"}))
    assert any(r.getMessage().startswith("AI: ha_get_state ") and "sensor.example_room" in r.getMessage()
               and r.getMessage().endswith(" s") for r in caplog.records), caplog.text
    make_skill(v.s.skills_dir, "probe", {"description": "x", "scripts": {"look.py": {}}}, {"look.py": "print('{}')\n"})
    sk = v.skills.get("probe")
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="vesta"):
        script_run.run(v.s, v.state, sk, "look.py", ["find"], by=script_run.AI)
        script_run.run(v.s, v.state, sk, "look.py", ["find"], by=script_run.PAGE)
    said = [r.getMessage() for r in caplog.records]
    assert said.count("Skill probe: look.py find started") == 1, said           # the AI's script: its start, once


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
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": ["ha_get_state", "ha_search"]}, reader=ha)
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


class StatsSession:
    """ha_get_history source=statistics as ha-mcp answers several ids (seen on the villa, 2026-10-30): one entry per
    device, each with its own has_more."""

    def __init__(self, rows, busy=()):
        self.rows, self.busy, self.calls = rows, set(busy), []

    def call_raw(self, name, args):
        ids = args["entity_ids"] if isinstance(args["entity_ids"], list) else [args["entity_ids"]]
        self.calls.append(ids)
        lim, off = args["limit"], args.get("offset") or 0
        ents = []
        for e in ids:
            rows = self.rows * (3 if e in self.busy else 1)
            rows = [{**r, "start": r["start"] + i} for i, r in enumerate(rows)]
            ents.append({"entity_id": e, "statistics": rows[off:off + lim], "has_more": off + lim < len(rows),
                         "next_offset": off + lim if off + lim < len(rows) else None})
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entities": ents})}]}


def test_statistics_of_several_devices_are_one_read_and_a_busy_one_is_read_alone(monkeypatch):
    # owner, 2026-10-30: the recheck read each battery's and each level's figures one device at a time
    from vesta_shared import limits
    monkeypatch.setattr(limits, "values", lambda: {"statistics.page_rows": 100})
    rows = [{"start": 1_700_000_000_000 + i * 86_400_000, "mean": i} for i in range(40)]
    ids = [f"sensor.battery_{i}" for i in range(20)]
    s = StatsSession(rows, busy={"sensor.battery_3"})
    got = McpClient("http://unused", "UTC", session=s).statistics(ids, T - timedelta(days=40), T, "day")
    assert s.calls[0] == ids and all(c == ["sensor.battery_3"] for c in s.calls[1:]) and len(s.calls) == 3
    assert all(len(got[e]) == 40 for e in ids if e != "sensor.battery_3") and len(got["sensor.battery_3"]) == 120


def test_a_script_says_what_it_asked_the_villa_on_its_took_line(capsys):
    from vesta_shared.script import READS, say_reads
    say_reads({"ha_get_state": 2, "ha_get_history": 5})
    assert capsys.readouterr().err.strip() == READS + "5 ha_get_history, 2 ha_get_state"


def test_a_skill_script_s_reads_are_on_its_took_line(tmp_path, caplog):
    # owner, 2026-10-30: "recheck.py took 42.4 s", ~220 calls, which ones not known: the run's reads, on its line
    import logging
    from helpers import make_agent, make_skill
    from vesta_agent import script_run
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1}})
    make_skill(v.s.skills_dir, "probe", {"description": "x", "scripts": {"look.py": {}}},
               {"look.py": "import sys\nfrom vesta_shared.script import say_reads\nprint('{}')\n"
                           "say_reads({'ha_get_history': 3, 'ha_get_state': 1})\n"})
    with caplog.at_level(logging.INFO, logger="vesta"):
        script_run.run(v.s, v.state, v.skills.get("probe"), "look.py", ["find"], by=script_run.JOB)
    assert any(r.getMessage().startswith("Skill probe: look.py find took ")
               and r.getMessage().endswith(" s (3 ha_get_history, 1 ha_get_state)") for r in caplog.records), caplog.text


def test_a_script_s_villa_client_says_its_reads_when_the_script_ends(monkeypatch):
    # the line above comes from the run itself: the client a script opens on the villa reports its calls at exit
    from argparse import Namespace
    from vesta_shared import script
    registered = []
    monkeypatch.setattr(script.atexit, "register", lambda f, *a: registered.append((f, a)))
    monkeypatch.setenv("VESTA_HA_MCP_URL", "http://unused")
    cli = script.Context(Namespace(fixture_dir=None, zone="UTC")).client
    assert registered == [(script.say_reads, (cli.mcp.calls,))]
