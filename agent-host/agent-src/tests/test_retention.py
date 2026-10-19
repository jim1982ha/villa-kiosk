"""How far the villa's detailed history goes, measured, and the long-term figures before it (vesta_shared.retention).

Owner, 2026-10-20: "I want the skills to read the Detailed history setting and be clever enough to switch to long-term
memory when necessary". Synthetic data.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS
from vesta_shared import retention
from vesta_shared.ha_client import HABase

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
KEPT_DAYS = 12.25


class Villa(HABase):
    """A villa whose system keeps every change for KEPT_DAYS: sun.sun twice a day, a pump every hour, a door; hourly
    figures for the pump only (a door has none)."""

    def __init__(self, days=KEPT_DAYS):
        self.oldest = NOW - timedelta(days=days)
        self.calls = []

    def _changes(self, eid):
        step = timedelta(hours=12 if eid == "sun.sun" else 1)
        t, out = NOW - timedelta(days=400), []
        while t < NOW:
            if t >= self.oldest:
                out.append({"state": "on" if eid == "binary_sensor.door" else "120", "last_changed": t.isoformat()})
            t += step
        return out

    def history(self, entity_ids, start, end):
        self.calls.append(("history", start, end))
        out = {}
        for e in entity_ids:
            rows = self._changes(e)
            before = [r for r in rows if datetime.fromisoformat(r["last_changed"]) < start]
            inside = [r for r in rows if start <= datetime.fromisoformat(r["last_changed"]) < end]
            out[e] = ([dict(before[-1], last_changed=start.isoformat())] if before else []) + inside
        return out

    def statistics(self, entity_ids, start, end, period="hour", types=("mean", "min", "max")):
        step = timedelta(hours=1 if period == "hour" else 24)
        out = {}
        for e in entity_ids:
            rows, t = [], start
            while e == "sensor.pump_power" and t < end:
                rows.append({"start": int(t.timestamp() * 1000), "mean": 118.0, "min": 0.0, "max": 240.0})
                t += step
            out[e] = rows
        return out

    def states(self, entity_ids=None):
        return {e: {"state": "120", "attributes": {"friendly_name": e}} for e in entity_ids or []}

    def logbook(self, start, end, entity_id=None):
        return []


def test_the_days_kept_are_measured_on_the_villa():
    assert abs(retention.measure(Villa(), now=NOW) - KEPT_DAYS) < 0.6         # sun.sun changes every 12 hours
    assert abs(retention.measure(Villa(days=30), now=NOW) - 30) < 0.6


def test_a_read_older_than_the_detail_kept_says_where_detail_begins():
    v = Villa()
    v.detailed_days = KEPT_DAYS
    got = v.history_read(["sensor.pump_power"], NOW - timedelta(days=20), NOW - timedelta(days=15), now=NOW)
    assert got.older_than_kept == NOW - timedelta(days=KEPT_DAYS)
    assert v.history_read(["sensor.pump_power"], NOW - timedelta(days=2), NOW, now=NOW).older_than_kept is None
    assert v.logbook_read(NOW - timedelta(days=30), NOW, now=NOW).older_than_kept is not None
    v.detailed_days = None                                       # not measured: every period is read as kept
    assert v.history_read(["sensor.pump_power"], NOW - timedelta(days=20), NOW, now=NOW).older_than_kept is None


def test_an_investigation_of_an_older_period_reads_the_figures_and_never_says_nothing_recorded():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    from zoneinfo import ZoneInfo
    v = Villa()
    v.detailed_days = KEPT_DAYS
    start, end = NOW - timedelta(days=20), NOW - timedelta(days=19)          # a whole day older than the detail
    res = investigate.timeline(v, ["sensor.pump_power", "binary_sensor.door"], start, end, 0, ZoneInfo("UTC"), now=NOW)
    text = "\n".join(res["lines"])
    assert "nothing recorded" not in text
    assert "no longer kept in detail" in text and "keeps every change for 12 days only" in text
    assert "long-term figures" in text and "mean 118, min 0, max 240" in text            # the pump: its hourly figures
    assert "No long-term figures are kept of this device" in text                       # the door: none, said


def test_the_ais_own_older_read_gets_the_figures_and_the_note():
    v = Villa()
    start = NOW - timedelta(days=20)
    answer = json.dumps({"data": {"success": True, "source": "history", "period": {
        "start": start.isoformat(), "end": NOW.isoformat()},
        "entities": [{"entity_id": "sensor.pump_power", "states": []}, {"entity_id": "binary_sensor.door", "states": []}]},
        "metadata": {}})
    out = json.loads(retention.ai_history_answer(v, {}, answer, KEPT_DAYS, now=NOW))["data"]["older_than_detail"]
    assert out["period"] == "day" and out["figures"]["sensor.pump_power"] and out["no_figures"] == ["binary_sensor.door"]
    assert "keeps every change for 12 days only" in out["note"] and "from figures" in out["note"]
    recent = answer.replace(start.isoformat(), (NOW - timedelta(days=2)).isoformat())
    assert retention.ai_history_answer(v, {}, recent, KEPT_DAYS, now=NOW) == recent       # all kept: untouched
    assert retention.ai_history_answer(v, {}, answer, None, now=NOW) == answer            # not measured: untouched
    book = json.dumps({"success": True, "entries": []})
    said = json.loads(retention.ai_logbook_answer({"hours_back": 24 * 15}, book, KEPT_DAYS, now=NOW))
    assert "does not mean nothing happened" in said["older_than_detail"]["note"]


def test_the_real_caller_adds_the_older_part_to_the_ais_answer(tmp_path):
    from ha_fake import FakeHA, tool
    from helpers import make_agent
    from vesta_agent.routing import CONVERSATION, Origin
    from vesta_shared.knowledge_pack import build_pack
    start = datetime.now(timezone.utc) - timedelta(days=20)
    answer = json.dumps({"data": {"success": True, "source": "history", "period": {
        "start": start.isoformat(), "end": datetime.now(timezone.utc).isoformat()},
        "entities": [{"entity_id": "binary_sensor.door", "states": []}]}, "metadata": {}})
    ha = FakeHA(tools=[tool("ha_get_history", entity_ids="string", start_time="string")],
                answers={"ha_get_history": answer})
    v = make_agent(tmp_path, {"people": [{"telegram_id": 111, "name": "Owner", "role": "owner"}], "chats": {"owner": -1},
                              "ha_read_tools": ["ha_get_history"]}, reader=ha)
    with open(v.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack({"entities": []}, [], detailed_days=10.0).to_json())
    asyncio.run(v.refresh_server_tools())
    hist = next(t for t in v.toolbox().tool_objects(None, Origin(-1, CONVERSATION)) if t.name == "ha_get_history")
    text = asyncio.run(hist.handler({"entity_ids": "binary_sensor.door", "start_time": "20d"}))["content"][0]["text"]
    assert "older_than_detail" in text and "keeps every change for 10 days only" in text


def test_every_reader_of_a_script_knows_where_detail_begins(tmp_path):
    # the villa's own client (McpClient) and a script's Context: the pack's measure reaches both
    import argparse
    from vesta_shared import script
    from vesta_shared.ha_client import McpClient
    from vesta_shared.knowledge_pack import build_pack

    class Session:
        def call_raw(self, name, args):
            body = {"success": True, "entities": [{"entity_id": "sensor.pump_power", "states": [], "has_more": False}]} \
                if name == "ha_get_history" else {"success": True, "entries": [], "has_more": False}
            return {"content": [{"type": "text", "text": json.dumps(body)}]}
    cli = McpClient(session=Session())
    cli.detailed_days = 10
    assert cli.history_read(["sensor.pump_power"], NOW - timedelta(days=20), NOW, now=NOW).older_than_kept is not None
    assert cli.logbook_read(NOW - timedelta(hours=3), NOW, entity_id="sensor.pump_power", now=NOW).older_than_kept is None
    pack = tmp_path / "pack.json"
    pack.write_text(build_pack({"entities": []}, [], detailed_days=11.5).to_json())
    (tmp_path / "fx").mkdir()
    ctx = script.Context(argparse.Namespace(pack=str(pack), fixture_dir=str(tmp_path / "fx"), zone="UTC"))
    assert ctx.client.detailed_days == 11.5


def test_the_investigation_page_draws_the_older_part_from_the_figures_and_says_so():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))
    import investigate
    import page
    from zoneinfo import ZoneInfo
    v = Villa()
    v.detailed_days = KEPT_DAYS
    start, end = NOW - timedelta(days=14), NOW - timedelta(days=11)          # across where the detail begins
    res = investigate.timeline(v, ["sensor.pump_power"], start, end, 0, ZoneInfo("UTC"), series=True, now=NOW)
    pump = res["entities"][0]
    first = next(p for p in pump["series"] if p[1] is not None)
    assert pump["figures_until"] and datetime.fromisoformat(first[0]) < start + timedelta(hours=1)   # from the start
    html = page.investigation({"title": "t", "summary": "s"}, {**res, "zone": "UTC"})
    assert "from the hourly figures: every change is no longer kept" in html


def test_the_empty_villa_clue_says_where_its_count_begins():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import playbook
    from types import SimpleNamespace
    from zoneinfo import ZoneInfo
    v = Villa()
    v.detailed_days = KEPT_DAYS
    end = NOW.date()
    c = SimpleNamespace(cli=v, Z=ZoneInfo("UTC"), now=NOW, start=end - timedelta(days=20), end=end,
                        e_dt=NOW, problems=[], total_from=lambda: True, daily_total=lambda a, b: {})
    playbook.clue_use_while_empty(c, {"mode_entity": "binary_sensor.door", "days": 20, "empty": ["off"]})
    assert any("counted from" in p and "12 days only" in p for p in c.problems)
