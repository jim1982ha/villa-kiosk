"""The investigate starter skill (owner, 2026-10-11: "universal to any type of investigation… the most complete and
exhaustive response"): its script reads a night that went wrong and names every moment that matters — against the
device's own normal, never a number written for one villa."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from helpers import STARTER_SKILLS

sys.path.insert(0, os.path.join(STARTER_SKILLS, "investigate", "scripts"))

Z = ZoneInfo("UTC")


def T(d, h, m=0, s=0):
    return datetime(2026, 10, d, h, m, s, tzinfo=Z)


def _night():
    """An invented heater: three quiet days of 8 s top-ups at 750 W, then a night of trouble."""
    pw = []
    t = T(6, 0)
    while t < T(9, 3):
        pw += [(t, 750.0), (t + timedelta(seconds=8), 1.7)]
        t += timedelta(minutes=90)
    pw += [(T(9, 3, 9, 46), 780.0), (T(9, 3, 40), 730.0), (T(9, 4, 5), 1600.0), (T(9, 4, 30), 400.0),
           (T(9, 4, 31), 1400.0)]
    for k in range(8):                                                   # stop-start, every 2 min
        pw += [(T(9, 4, 55) + timedelta(minutes=2 * k), 1.8), (T(9, 4, 56) + timedelta(minutes=2 * k), 2500.0)]
    pw += [(T(9, 5, 13, 33), 1650.0), (T(9, 6, 0, 6), 0.0), (T(9, 13, 5), 415.0), (T(9, 13, 16), 3.0)]
    return pw


class _Client:
    def __init__(self):
        self.pw = _night()

    def tool(self, name, args):
        if name == "ha_search":
            return {"entities": [{"entity_id": "sensor.heater_power", "friendly_name": "Heater Power"}]}
        if name == "ha_get_entity":
            return {"entity_entries": [{"entity_id": "sensor.heater_power", "area": "Plant Room",
                                        "unique_id": "AABBCCDD1122-em1:0-power", "device_id": "d1"}]}
        if name == "ha_get_device":
            return {"entities": [{"entity_id": "sensor.heater_energy", "name": "Energy"}]}
        return {}

    def states(self, ids):
        return {i: {"state": "1.7", "attributes": {"friendly_name": "Heater Power", "unit_of_measurement": "W"}}
                for i in ids}

    def history(self, ids, start, end):
        before = [r for r in self.pw if r[0] < start][-1:]
        rows = before + [r for r in self.pw if start <= r[0] < end]
        return {ids[0]: [{"state": str(v), "last_changed": max(t, start).isoformat()} for t, v in rows]}

    def logbook(self, start, end):
        rows = [{"when": T(9, 3, 14, 46).isoformat(), "entity_id": "automation.heater_watch", "name": "heater watch",
                 "message": "triggered by numeric state"},
                {"when": T(9, 6, 1, 25).isoformat(), "entity_id": "switch.next_relay", "name": "Next Relay",
                 "state": "unavailable"},
                {"when": T(9, 13, 8).isoformat(), "entity_id": "switch.next_relay", "name": "Next Relay", "state": "off"},
                {"when": T(9, 6, 11, 25).isoformat(), "entity_id": "notify.owner_phone", "name": "Owner phone",
                 "state": "x"}]
        rows += [{"when": (T(9, 2) + timedelta(minutes=k)).isoformat(), "entity_id": "sensor.clock", "name": "Clock",
                  "state": str(k)} for k in range(600)]
        return [r for r in rows if start <= datetime.fromisoformat(r["when"]) < end]


def test_find_names_the_device_and_what_shares_its_box():
    import investigate
    text = "\n".join(investigate.find(_Client(), "heater", None)["lines"])
    assert "Heater Power" in text and "Plant Room" in text
    assert "same physical device" in text and "sensor.heater_energy" in text


def test_the_timeline_flags_every_moment_against_the_device_own_normal():
    import investigate
    lines = investigate.timeline(_Client(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z)["lines"]
    text = "\n".join(lines)
    assert "longest 8 s" in text                                           # its normal, read from the days before
    run = next(x for x in lines if x.strip().startswith("03:09:46"))
    assert "1 h 45 min" in run and "longer than any run of its normal" in run
    assert any("short-cycling" in x for x in lines)
    assert any("2.3× its normal level" in x for x in lines)
    off = next(x for x in lines if x.strip().startswith("06:00:06"))
    assert "its supply was off" in off                                     # exactly 0 where it rests at 1.7
    assert any("only 55% of its normal level" in x for x in lines)


def test_around_lists_what_else_happened_and_leaves_background_out():
    import investigate
    text = "\n".join(investigate.around(_Client(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["lines"])
    gone, back = text.index("Devices that stopped answering"), text.index("answered again")
    assert gone < text.index("06:01:25  Next Relay") < back < text.index("13:08:00  Next Relay")
    assert "heater watch" in text and "06:11:25  Owner phone" in text
    assert "Left out as background" in text and "sensor.clock" in text


def test_no_device_of_any_villa_is_written_in_the_skill():
    # "it shall never quote hardcoded devices": the skill finds everything from the person's words
    import re
    folder = os.path.join(STARTER_SKILLS, "investigate")
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if name.endswith((".md", ".yaml", ".py")):
                text = open(os.path.join(root, name), encoding="utf-8").read()
                ids = set(re.findall(r"\b(?:sensor|switch|binary_sensor|automation|light|climate)\.[a-z0-9_]+\b", text))
                assert ids <= {"sensor.a", "binary_sensor.b", "sensor.c"}, (name, ids)   # the usage examples only


def _main(tmp_path, *args):
    """The script as the agent runs it, Home Assistant read from an empty fixture folder; (exit, what it said)."""
    import contextlib
    import io
    import json
    import investigate
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            code = investigate.main([*args, "--fixture-dir", str(tmp_path), "--store", str(tmp_path / "s.sqlite"),
                                     "--zone", "UTC"])
    except SystemExit as e:
        return 1, str(e.code)
    return code, json.loads(out.getvalue())


def test_a_date_alone_is_the_whole_day_and_words_are_not_device_ids(tmp_path):
    # the owner's tries on the page (2026-10-11): "--start 2026-10-09 --end 2026-10-09" was refused as an empty
    # period, and "--entities house pump" was taken without a word
    code, said = _main(tmp_path, "around", "--start", "2026-10-09", "--end", "2026-10-09")
    assert code == 0, said
    code, said = _main(tmp_path, "around", "--start", "2026-10-09", "--end", "2026-10-09",
                       "--entities", "house pump")
    assert code == 1 and "'house pump' is not one" in said and "Run find first" in said
    code, said = _main(tmp_path, "around", "--start", "2026-10-09T05:00", "--end", "2026-10-09T05:00")
    assert code == 1 and "--end must be after --start" in said           # a time given is taken as given


def test_timeline_out_saves_each_device_with_its_chart(tmp_path):
    # the investigation page's charts (reports' compose.py investigation --data): the highest reading of each slice,
    # so a short surge is still drawn
    import investigate
    res = investigate.timeline(_Client(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z, series=True)
    (part,) = res["entities"]
    assert part["name"] == "Heater Power" and part["unit"] == "W" and len(part["series"]) == investigate.CHART_POINTS
    assert max(v for _, v in part["series"] if v is not None) == 2500.0       # the stop-start surges are kept
    assert any(p.get("why") for p in part["periods"])                         # the unusual periods, for shading


def test_the_investigation_page_carries_the_account_and_its_charts(tmp_path):
    # owner, 2026-10-11: the investigate skill "uses the report skill to create all this in a HTML report file",
    # the chat message "much more synthetic and shorter"
    import json
    import subprocess
    import investigate
    from helpers import PYTHONPATH
    data = investigate.timeline(_Client(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z, series=True)
    (tmp_path / "t.json").write_text(json.dumps({"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(),
                                                 "zone": "UTC", **data}, default=str))
    notes = {"title": "The heater on the night of 9 October",
             "summary": "The heater ran without stopping from 03:09 for 1 h 45 min, then its supply went off at 06:00.",
             "timeline": [{"time": "03:09", "text": "It starts and does not stop.", "unusual": True}],
             "causes": [{"cause": "Water escaping downstream", "evidence": "a run far longer than any before",
                         "confirm": "look for a leak after the pump"}],
             "cannot_tell": ["No leak sensor in the room."], "warned_earlier": ["An alert on a run over 10 min."],
             "checked": "Its power, the logbook, the automations."}
    (tmp_path / "n.json").write_text(json.dumps(notes))
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
    r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"),
                        "--data", str(tmp_path / "t.json"), "--out", str(tmp_path / "p.html")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    page = (tmp_path / "p.html").read_text()
    for part in ("The heater on the night of 9 October", "Timeline", "Water escaping downstream", "No leak sensor",
                 "An alert on a run over 10 min.", "Heater Power", "<svg", 'rel="icon"'):
        assert part in page, part
    assert out["charts"] == 1 and out["message"]["title"] == notes["title"]
    assert out["message"]["text"] == notes["summary"] + " Details in the attached page."   # one short block
    long = {**notes, "summary": "It ran. " * 120}
    (tmp_path / "long.json").write_text(json.dumps(long))
    r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "long.json"),
                        "--out", str(tmp_path / "l.html")], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 1 and "at most" in r.stderr                       # the chat message stays one bubble
    (tmp_path / "bad.json").write_text(json.dumps({"title": "x"}))
    r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "bad.json"),
                        "--out", str(tmp_path / "q.html")], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 1 and "a title and a summary" in r.stderr and "Traceback" not in r.stderr


def test_a_surge_inside_one_slice_of_the_chart_is_still_drawn():
    # a 1-second surge between two ordinary readings of the same slice: its highest value, never its last
    import investigate
    t0 = T(9, 3)
    rows = [(t0, "10"), (t0 + timedelta(seconds=1), "3712"), (t0 + timedelta(seconds=2), "10"),
            (t0 + timedelta(seconds=30), "unavailable")]
    pts = investigate.chart_series(rows, t0, t0 + timedelta(seconds=4000))   # slices of 10 s
    assert pts[0][1] == 3712.0 and pts[1][1] == 10.0 and pts[4][1] is None   # offline from then: a gap, not a zero


def test_the_longest_summary_with_a_long_to_line_is_still_one_bubble():
    # review 32: the limit was worked out by hand against 1,024 while the agent cuts captions at 1,000 — derived now, with
    # room for a "To:" naming several people; checked through the agent's own layout of a message with a file
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    from vesta_agent.telegram import layout
    from vesta_shared.message_format import titled
    text = titled("T" * compose.TITLE_MAX, ["the Owner", "JM", "Fabien", "the facility manager group", "Housekeeping"],
                  "S" * compose.SUMMARY_MAX + compose.DETAILS)
    assert len(layout(text, {"inline_keyboard": []}, "document")) == 1


def test_a_history_cut_short_is_said_and_never_stretched_to_the_end():
    import investigate

    class Cut(_Client):
        def history(self, ids, start, end):
            got = super().history(ids, start, end)
            self.history_cut = {ids[0]: T(9, 4)} if start >= T(9, 2) else {}   # the period read stopped at 04:00
            return {ids[0]: [r for r in got[ids[0]] if datetime.fromisoformat(r["last_changed"]) < T(9, 4)]}
    lines = investigate.timeline(Cut(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z)["lines"]
    assert any("could not be read whole: nothing is known after 04:00:00" in x for x in lines)
    assert not any(x.strip().split(" → ")[-1].startswith("15:00") for x in lines if " → " in x)   # no period to the end
