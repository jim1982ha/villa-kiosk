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
                         "confirm": "look for a leak after the pump"},
                        {"cause": "A power surge", "evidence": "no surge recorded", "confirm": "-",
                         "source": "a maker's support page", "verdict": "not supported"}],
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
                 "An alert on a run over 10 min.", "Heater Power", "<svg", 'rel="icon"',
                 "not supported", "Lead from the web: a maker&#39;s support page"):
        assert part in page, part
    assert out["charts"] == 1 and out["message"]["title"] == notes["title"]
    key, said = out["message"]["text"].split("\n\n")                         # the recorded facts, then the summary
    assert key.startswith("Recorded: Heater Power: running 03:09–04:55 (1 h 45 min)")
    assert said == notes["summary"] + " Details in the attached page."
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


# ---- what a control and an automation can prove (2026-10-11: an account blamed a switch never once on, and a
# watchdog that could only notify; universal — any control, any device, any automation)
class _WithControl(_Client):
    """The heater's night, with an on/off control that stays `state` throughout."""

    def __init__(self, state):
        super().__init__()
        self.control_state = state

    def history(self, ids, start, end):
        if ids[0].startswith("switch."):
            return {ids[0]: [{"state": self.control_state, "last_changed": start.isoformat()}]}
        return super().history(ids, start, end)


def test_a_control_that_stayed_off_is_said_not_to_have_turned_the_device_on():
    import investigate
    res = investigate.timeline(_WithControl("off"), ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z)
    (line,) = [x for x in res["lines"] if "NOT what turned" in x]
    assert "stayed off for the whole period and the 3 days before" in line and "Heater Power" in line
    res = investigate.timeline(_WithControl("on"), ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z)
    assert any("stayed on for the whole period" in x and "does not explain" in x for x in res["lines"])
    assert not any("NOT what turned" in x for x in res["lines"])


def test_a_control_that_changed_proves_nothing_and_says_nothing():
    import investigate

    class Moving(_Client):
        def history(self, ids, start, end):
            if ids[0].startswith("switch."):
                return {ids[0]: [{"state": "off", "last_changed": start.isoformat()},
                                 {"state": "on", "last_changed": (start + timedelta(hours=1)).isoformat()}]}
            return super().history(ids, start, end)
    lines = investigate.timeline(Moving(), ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z)["lines"]
    assert not any("whole period" in x for x in lines)


def test_each_automation_says_what_it_is_able_to_do():
    import investigate
    configs = {
        "automation.watch": {"config": {"actions": [{"choose": [{"sequence": [
            {"action": "notify.send_message"}, {"event": "some_event"}]}]},
            {"action": "input_datetime.set_datetime"}]}},
        "automation.acts": {"config": {"actions": [{"if": [], "then": [{"action": "switch.turn_on"}],
                                                    "else": [{"action": "script.something"}]}]}},
        "automation.made": {"config": {"use_blueprint": {"path": "some/blueprint.yaml"}}},
    }

    class C:
        def tool(self, name, args):
            if name == "ha_config_get_automation":
                return configs[args["identifier"]]
            if name == "ha_get_automation_traces" and "run_id" not in args:
                return {"traces": [{"run_id": "r1", "timestamp": {"start": T(9, 3).isoformat()}},
                                   {"run_id": "r0", "timestamp": {"start": T(1, 3).isoformat()}}]}
            if name == "ha_get_automation_traces":              # r0, outside the period, switched something
                did = ("switch", "turn_on") if args["run_id"] == "r0" else ("input_datetime", "set_datetime")
                return {"action_trace": [{"result": {"params": {"domain": did[0], "service": did[1]}}}]}
            return {}
    watch = investigate.automation_can(C(), "automation.watch", T(9, 2), T(9, 15))
    assert "switches nothing" in watch and "notifies" in watch and "records a value" in watch
    acts = investigate.automation_can(C(), "automation.acts", T(9, 2), T(9, 15))
    assert acts.startswith("CAN change things: script.something, switch.turn_on") and "read it" in acts
    made = investigate.automation_can(C(), "automation.made", T(9, 2), T(9, 15))
    assert "not proven either way" in made and "did: records a value only" in made


def test_the_investigation_lists_web_search_among_its_tools():
    # owner, 2026-10-11: "my expectation then would be to see the web_search tool in this list" (Skills › Skill tools)
    from vesta_agent import tool_access
    from vesta_agent.policy import Policy
    from vesta_agent.skills import Skills
    sk = Skills(os.path.join(STARTER_SKILLS)).get("investigate")
    cards = {c["tool"]: c for c in tool_access.needs(Policy({}), None, sk)}
    assert cards["web_search"]["label"] == "Web search"
    text = open(os.path.join(STARTER_SKILLS, "investigate", "SKILL.md"), encoding="utf-8").read()
    assert "web_search" in text and "never instead of them" in text


def test_a_web_researched_page_names_its_sources_or_is_refused(tmp_path):
    # owner, 2026-10-11: the page of an investigation that searched the web 5 times named no source
    import json
    import subprocess
    from helpers import PYTHONPATH
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
    notes = {"title": "The heater on 9 October", "summary": "It ran 3 h.",
             "causes": [{"cause": "A stuck valve", "evidence": "…", "confirm": "…", "source": "a maker's page"}]}

    def make(n, modes):
        (tmp_path / "n.json").write_text(json.dumps(n))
        return subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"),
                               "--out", str(tmp_path / "p.html")], capture_output=True, text=True,
                              env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_MODES": modes})
    r = make(notes, "web_research")
    assert r.returncode == 1 and "list every web page you used in `sources`" in r.stderr
    notes["sources"] = [{"title": "Pump troubleshooting", "url": "https://example.org/pumps"}]
    r = make(notes, "web_research")
    assert r.returncode == 1 and "needs its verdict" in r.stderr                  # a web lead without its verdict
    notes["causes"][0]["verdict"] = "consistent"
    r = make(notes, "web_research")
    assert r.returncode == 0, r.stderr
    page = (tmp_path / "p.html").read_text()
    assert "Sources (web)" in page and 'href="https://example.org/pumps"' in page and "Pump troubleshooting" in page
    del notes["sources"]
    notes["causes"][0].pop("source")
    assert make(notes, "").returncode == 0                                        # web research off: nothing required


def test_a_device_that_runs_briefly_and_rarely_is_still_seen_running():
    # 2026-10-11: a meter reporting its idle every 10 s and topping up 8 s every 90 min had 99% of its readings at idle;
    # "high" taken as its 95th percentile was its idle level, its runs were never counted ("normal: 0 runs a day"), and
    # neither "longer than any normal run" nor "its supply was off" could be said
    import investigate
    t, rows = T(6, 0), []
    while t < T(9, 0):
        if t.minute % 90 == 0 and t.second == 0:
            rows += [(t, "750.0"), (t + timedelta(seconds=8), "1.7")]
            t += timedelta(seconds=10)
            continue
        rows.append((t, f"{1.6 + (t.second % 3) * 0.1:.1f}"))
        t += timedelta(seconds=10)
    on = investigate.threshold([investigate.number(v) for _, v in rows])
    assert on is not None and 2 < on < 750
    ref = investigate.normal(rows, T(9, 0), on)
    assert ref["runs_per_day"] > 10 and ref["run_longest_s"] == 8 and 1.5 < ref["rest_median"] < 2.0
    # …and a reading that only drifts (a temperature) is still read as levels, never as runs
    temps = [24.0 + (i % 30) / 10 for i in range(2000)]
    assert investigate.threshold(temps) is None


# ---- facts first (owner, 2026-10-11: "the investigate skill is not providing any added-value against a 'normal'
# query"): what the records establish and rule out is laid out by code, for any device — the AI explains it
class _Around(_WithControl):
    """The heater's night with its control off, a neighbour that drops off at 06:01, and two automations: one that can
    only notify (ran 5 min after the long run began), one that can switch (ran far from any unusual moment)."""

    def __init__(self):
        super().__init__("off")

    def states(self, ids):
        names = {"switch.a": "Heater Relay", "switch.spa": "Spa Relay"}
        return {i: {"state": "1.7", "attributes": {"friendly_name": names.get(i, "Heater Power"),
                                                   "unit_of_measurement": "W"}} for i in ids}

    def tool(self, name, args):
        if name == "ha_config_get_automation":
            return {"config": {"actions": [{"action": "notify.send_message"}]}} if args["identifier"] == \
                "automation.heater_watch" else {"config": {"actions": [{"action": "switch.turn_on"}]}}
        return super().tool(name, args)

    def logbook(self, start, end):
        rows = super().logbook(start, end) + [{"when": T(9, 10).isoformat(), "entity_id": "automation.morning",
                                               "name": "morning", "message": "time"},
                                              {"when": T(9, 6, 0, 30).isoformat(), "entity_id": "sensor.heater_power",
                                               "name": "Heater Power", "state": "unavailable"}]
        return [r for r in rows if start <= datetime.fromisoformat(r["when"]) < end]


def _facts(client=None, ids=("sensor.heater_power", "switch.a")):
    import investigate
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import investigation_facts
    client = client or _Around()
    data = {"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(), "zone": "UTC",
            **investigate.timeline(client, list(ids), T(9, 2), T(9, 15), 3, Z, series=True)}
    data = __import__("json").loads(__import__("json").dumps(data, default=str))       # as compose reads the file
    around = {"start": data["start"], "end": data["end"], "zone": "UTC",
              **investigate.around(client, None, T(9, 2), T(9, 15), list(ids), Z)["data"]}
    return investigation_facts, investigation_facts.facts(data, around)


def test_the_page_states_what_the_records_establish_and_rule_out():
    mod, f = _facts()
    est, out = "\n".join(f["established"]), "\n".join(f["ruled_out"])
    assert "Heater Power: running from 03:09 to 04:55 (1 h 45 min) — longer than any run of its normal (8 s)" in est
    assert "its supply was off" in est and "stops and restarts 7 times from 04:55 to 05:10" in est
    assert "Also stopped answering next to an unusual moment: 06:01 Next Relay." in est   # not the device itself
    assert "Heater Relay stayed off for the whole period and the 3 days before, while Heater Power ran: it did not turn " \
           "it on" in out
    assert "“heater watch” ran then, but all it can do is: notifies — it switched nothing" in out
    assert "morning" not in est + out                    # it can switch, but ran far from every unusual moment
    times = [r["time"] for r in f["timeline"]]
    assert times == sorted(times) and f["recorded"]
    assert any(r["text"] == "Next Relay stops answering" for r in f["timeline"])
    assert any(r["text"] == "Next Relay answers again" for r in f["timeline"])


def test_an_automation_that_can_switch_and_ran_then_is_named_with_what_it_acts_on():
    # what it acts on, by name — read from its own actions: a device read here, another one, or none named (a template)
    def acting(target):
        class Acting(_Around):
            def tool(self, name, args):
                if name == "ha_config_get_automation":
                    return {"config": {"actions": [{"choose": [{"sequence": [{"action": "switch.turn_on", **target}]}]},
                                                   {"action": "notify.send_message", "target": {"entity_id": "notify.x"}}]}}
                return super().tool(name, args)
        _, f = _facts(Acting())
        assert not any("heater watch" in x for x in f["ruled_out"])
        return next(x for x in f["established"] if "heater watch" in x)
    assert acting({"target": {"entity_id": "switch.a"}}).endswith(
        "(03:14) and can act on: Heater Relay — among the devices read here: check whether it acted.")
    assert acting({"target": {"entity_id": ["switch.spa"]}}).endswith(
        "can act on: Spa Relay — none of the devices read here.")
    assert acting({"target": {"entity_id": "{{ states('input_text.x') }}"}}).endswith(
        "can act on: (switch.turn_on) — check whether it acted on the device.")


def test_each_unusual_period_says_when_an_alert_on_the_same_limit_would_have_warned():
    # the long run: its normal longest is 8 s, flagged past max(2 × 8 s, 8 s + 300 s) = 308 s → 03:09:46 + 308 s
    _, f = _facts()
    alerts = "\n".join(f["alerts"])
    assert "An alert on “Heater Power: running longer than 5 min” would have warned at 03:14, 1 h 40 min before that " \
           "running ended (03:09 to 04:55)" in alerts
    assert "reading exactly 0 for 60 s” would have warned at 06:01" in alerts
    assert "3 runs shorter than 3 min in a row” would have warned at 05:00" in alerts     # its 3rd short run
    assert "drawing over 1.5× its normal level for 2 min” would have warned at 05:12" in alerts   # the earliest rule


def test_the_facts_are_any_devices_a_door_that_stopped_answering():
    # universal: a sensor with no numbers at all, silent for 40 min — the same facts, the same alert rule
    class Door(_Client):
        def states(self, ids):
            return {i: {"state": "off", "attributes": {"friendly_name": "Back Door"}} for i in ids}

        def history(self, ids, start, end):
            rows = [(T(6, 0), "off"), (T(7, 12), "on"), (T(7, 13), "off"), (T(9, 8), "unavailable"),
                    (T(9, 8, 40), "off")]
            rows = [r for r in rows if r[0] < start][-1:] + [r for r in rows if start <= r[0] < end]
            return {ids[0]: [{"state": v, "last_changed": max(t, start).isoformat()} for t, v in rows]}
    _, f = _facts(Door(), ("binary_sensor.back_door",))
    assert any("Back Door: offline from 08:00 to 08:40 (40 min) — did not answer" in x for x in f["established"])
    assert any("“Back Door: not answering for 60 s” would have warned at 08:01" in x for x in f["alerts"])


def test_the_key_line_gives_the_longest_periods_per_device_and_says_how_many_more():
    mod, f = _facts()
    assert f["key"] == ("Recorded: Heater Power: running 03:09–04:55 (1 h 45 min), stops and restarts 7 times 04:55–05:10 "
                        "(15 min), running 05:10–06:00 (50 min), no power 06:00–13:05 (7 h 4 min), running 13:05–13:16 "
                        "(11 min).")                                          # one device: named once
    hm = lambda t: f"{t:%H:%M}"                                              # noqa: E731
    blips = [{"name": "Gate", "kind": "offline", "start": T(9, h), "end": T(9, h, 2), "seconds": 120} for h in range(12)]
    long = {"name": "Boiler", "kind": "running", "start": T(9, 13), "end": T(9, 18), "seconds": 18000}
    key = mod.key_line(blips + [long], hm)
    assert len(key) <= mod.KEY_MAX and "Boiler: running 13:00–18:00 (5 h 0 min)" in key   # the longest, wherever it is
    assert key.endswith("more.") and key.index("Gate") < key.index("Boiler")               # devices in time order
    assert len(mod.key_line([{**long, "name": "N" * 300}], hm)) <= mod.KEY_MAX


def test_without_readings_the_page_keeps_the_accounts_own_timeline():
    _, f = (lambda m: (m, m.facts(None, None, {"timeline": [{"time": "07:30", "text": "Water on the floor"}]})))(
        _facts()[0])
    assert f["timeline"] == [{"time": "07:30", "text": "Water on the floor", "unusual": False}]
    assert f["established"] == f["ruled_out"] == f["alerts"] == [] and f["key"] == ""


def test_a_web_lead_the_records_contradict_is_listed_as_ruled_out():
    mod, _ = _facts()
    f = mod.facts(None, None, {"causes": [{"cause": "A grid outage", "evidence": "the neighbours kept power",
                                           "source": "a utility notice", "verdict": "not supported"},
                                          {"cause": "A stuck valve", "verdict": "consistent", "source": "x"}]})
    assert f["ruled_out"] == ["A grid outage — the neighbours kept power (lead from the web: a utility notice)."]


def test_any_web_search_needs_its_sources_research_asked_or_not(tmp_path):
    # owner, 2026-10-11: "include the sources, when web_search tool is used" — a manual looked up counts too
    import json
    import subprocess
    from helpers import PYTHONPATH
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
    notes = {"title": "The heater on 9 October", "summary": "It ran 3 h."}

    def make(n, searched):
        (tmp_path / "n.json").write_text(json.dumps(n))
        return subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"),
                               "--out", str(tmp_path / "p.html")], capture_output=True, text=True,
                              env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_MODES": "",
                                   "VESTA_WEB_SEARCHES": json.dumps(searched)})
    r = make(notes, ["heater model X error E4"])
    assert r.returncode == 1 and "you searched the web 1 time" in r.stderr
    r = make({**notes, "sources": [{"title": "Manual", "url": "https://example.org/m"}]}, ["heater model X error E4"])
    assert r.returncode == 0, r.stderr
    page = (tmp_path / "p.html").read_text()
    assert "Web searches made (1)" in page and "heater model X error E4" in page and "Sources (web)" in page
    assert make(notes, []).returncode == 0


def test_the_page_puts_the_records_before_the_ai_reading(tmp_path):
    import json
    import subprocess
    from helpers import PYTHONPATH
    import investigate
    c = _Around()
    for name, res in (("t.json", investigate.timeline(c, ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z,
                                                       series=True)),
                      ("a.json", investigate.around(c, None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["data"])):
        (tmp_path / name).write_text(json.dumps({"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(),
                                                 "zone": "UTC", **res}, default=str))
    (tmp_path / "n.json").write_text(json.dumps({"title": "The heater", "summary": "Water escaping kept it running.",
                                                 "timeline": [{"time": "07:30", "text": "Water on the floor"}]}))
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
    r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"), "--data",
                        str(tmp_path / "t.json"), "--around", str(tmp_path / "a.json"), "--out", str(tmp_path / "p.html")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    out, page = json.loads(r.stdout), (tmp_path / "p.html").read_text()
    order = [page.index(x) for x in ("What the records show", "Ruled out by the records", "Timeline",
                                     "What it most likely means", "What would have warned earlier")]
    assert order == sorted(order)
    assert "reported</span> Water on the floor" in page                       # what a person saw, marked so
    assert any("stayed off" in x for x in out["ruled_out"]) and out["established"]   # the AI reads them back


def test_a_period_is_judged_over_as_long_as_its_alert_would_need():
    # a zero of 30 s, or a start-up surge of 8 s, is not flagged: no alert on the same limit could have fired. At the
    # limit exactly the period is flagged, but no alert is claimed before it ended.
    import investigate
    ref = {"rest_median": 1.7, "level_median": 750.0, "run_longest_s": 600.0}
    zero = lambda s: {"kind": "no power", "start": T(9, 3), "end": T(9, 3) + timedelta(seconds=s), "seconds": float(s)}  # noqa: E731
    (got,) = investigate._notable([zero(30)], ref, 100.0)
    assert "why" not in got
    (got,) = investigate._notable([zero(60)], ref, 100.0)
    assert "its supply was off" in got["why"] and "alert" not in got
    (got,) = investigate._notable([zero(300)], ref, 100.0)
    assert got["alert"]["at"] == T(9, 3, 1)
    surge = {"kind": "running", "start": T(9, 3), "end": T(9, 3, 0, 8), "seconds": 8.0, "mean": 2000.0}
    (got,) = investigate._notable([surge], ref, 100.0)
    assert "why" not in got
    (got,) = investigate._notable([{**surge, "end": T(9, 3, 3), "seconds": 180.0}], ref, 100.0)
    assert "2.7× its normal level" in got["why"]


def test_only_an_alert_in_time_to_matter_is_said_and_repeats_are_one_line():
    # an alert after 60 s of silence, for a drop-out of 71 s, warned of nothing; the same rule firing on three outages
    # of one device is one line with its times
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import investigation_facts as mod

    def off(h, m, seconds):
        a = T(9, h, m)
        return {"kind": "offline", "start": a.isoformat(), "end": (a + timedelta(seconds=seconds)).isoformat(),
                "seconds": seconds, "why": "did not answer",
                "alert": {"rule": "not answering for 60 s", "at": (a + timedelta(seconds=60)).isoformat()}}
    data = {"zone": "UTC", "start": T(9, 0).isoformat(), "end": T(9, 23).isoformat(),
            "entities": [{"entity_id": "sensor.gate", "label": "Gate", "periods": [off(1, 0, 71), off(2, 0, 600),
                                                                                   off(5, 0, 900), off(7, 0, 3600)]}]}
    (line,) = mod.facts(data, None)["alerts"]
    assert line == ("An alert on “Gate: not answering for 60 s” would have warned at 02:01, 9 min before that offline "
                    "ended (02:00 to 02:10); and again at 05:01, 07:01.")


def test_what_drops_off_in_the_same_minute_is_one_row():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import investigation_facts as mod
    data = {"zone": "UTC", "start": T(9, 0).isoformat(), "end": T(9, 23).isoformat(), "settings": {"coincide_s": 600},
            "entities": [{"entity_id": "sensor.pump", "label": "Pump", "periods": [
                {"kind": "no power", "start": T(9, 6).isoformat(), "end": T(9, 9).isoformat(), "seconds": 10800,
                 "why": "its supply was off"}]}]}
    around = {"offline": [{"at": T(9, 6, 1, 5).isoformat(), "name": "Spa Relay", "id": "switch.spa"},
                          {"at": T(9, 6, 1, 9).isoformat(), "name": "Spa Relay Firmware", "id": "update.spa"},
                          {"at": T(9, 8, 55).isoformat(), "name": "Far Away", "id": "sensor.far"}],
              "back": [{"at": T(9, 13).isoformat(), "name": "Spa Relay", "id": "switch.spa"}]}
    texts = [r["text"] for r in mod.facts(data, around)["timeline"]]
    assert "Spa Relay, Spa Relay Firmware stop answering" in texts and "Spa Relay answers again" in texts
    assert "Also stopped answering next to an unusual moment: 06:01 Spa Relay, Spa Relay Firmware." in \
        mod.facts(data, around)["established"]
    assert not any("Far Away" in t for t in texts)          # 5 min before the END, 3 h after the start: not a cause


def test_a_stop_start_burst_is_found_among_many_ordinary_runs():
    # 9 October: with more than `ordinary_hide_over` periods, the burst's short runs were dropped as ordinary before
    # they could be grouped — the page showed nothing between the long run and the next one
    import investigate
    ps, t = [], T(9, 0)
    def add(kind, seconds, mean):
        nonlocal t
        ps.append({"kind": kind, "start": t, "end": t + timedelta(seconds=seconds), "seconds": float(seconds),
                   "mean": mean, "min": mean, "max": mean})
        t += timedelta(seconds=seconds)
    for _ in range(30):                                                    # 60 ordinary periods: 9 s runs, 10 min rests
        add("running", 9, 800.0); add("idle", 600, 1.7)
    for _ in range(8):                                                     # the burst: 60 s runs, 60 s rests
        add("running", 60, 2400.0); add("idle", 60, 1.7)
    add("idle", 3000, 1.7)
    shown, hidden = investigate.worth_a_line(ps, {"run_longest_s": 540.0, "level_median": 800.0, "rest_median": 1.7}, 100.0)
    (burst,) = [p for p in shown if p["kind"].startswith("stops and restarts")]
    assert burst["kind"] == "stops and restarts 8 times" and "short-cycling" in burst["why"] and burst.get("alert")
    assert hidden == 61                                                    # the 60, and the last ordinary rest


# ---- the charts' context (owner, 2026-10-11: "what does the red background mean? … more graphs to bring more context")
def test_a_chart_has_the_same_hours_of_the_days_before_behind_it_and_a_lane_for_each_device_without_numbers():
    import investigate
    res = investigate.timeline(_Around(), ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z, series=True)
    power, relay = res["entities"]
    assert [n["days_before"] for n in power["normal_series"]] == [1, 2, 3]
    assert all(len(n["series"]) == investigate.CHART_POINTS for n in power["normal_series"])
    assert max(v for _, v in power["normal_series"][0]["series"] if v is not None) == 750.0   # its 8-s top-ups
    assert relay["states"] == [{"at": T(9, 2).isoformat(), "state": "off", "as": "off"}] and "series" not in relay
    class OddDay(_Around):                     # the day before was different: a 900 W top-up at 03:00 on the 8th only
        def __init__(self):
            super().__init__()
            self.pw = sorted(self.pw + [(T(8, 3), 900.0), (T(8, 3, 0, 8), 1.7)])
    odd = investigate.timeline(OddDay(), ["sensor.heater_power"], T(9, 2), T(9, 15), 3, Z, series=True)
    tops = [max(v for _, v in n["series"] if v is not None) for n in odd["entities"][0]["normal_series"]]
    assert tops == [900.0, 750.0, 750.0]                                    # each day at its own place
    longer = investigate.timeline(_Around(), ["sensor.heater_power"], T(8, 2), T(9, 15), 3, Z, series=True)
    assert longer["entities"][0]["normal_series"] == []                     # over a day: no "same hours"


def test_a_state_lane_tags_each_state_by_the_timelines_own_words():
    import investigate
    rows = [(T(9, 1), "off"), (T(9, 3), "on"), (T(9, 3), "unavailable"), (T(9, 4), "unavailable"), (T(9, 5), "home"),
            (T(9, 16), "off")]
    got = investigate.state_series(rows, T(9, 2), T(9, 15))
    assert [(g["at"][11:16], g["state"], g["as"]) for g in got] == [
        ("02:00", "off", "off"), ("03:00", "unavailable", "offline"), ("05:00", "home", "other")]


def test_the_page_names_each_band_and_draws_the_strip(tmp_path):
    import json
    import subprocess
    from helpers import PYTHONPATH
    import investigate
    c = _Around()
    for name, res in (("t.json", investigate.timeline(c, ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z,
                                                       series=True)),
                      ("a.json", investigate.around(c, None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["data"])):
        (tmp_path / name).write_text(json.dumps({"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(),
                                                 "zone": "UTC", **res}, default=str))
    (tmp_path / "n.json").write_text(json.dumps({"title": "The heater", "summary": "It ran."}))
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")
    r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"), "--data",
                        str(tmp_path / "t.json"), "--around", str(tmp_path / "a.json"), "--out", str(tmp_path / "p.html")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH})
    assert r.returncode == 0, r.stderr
    page = (tmp_path / "p.html").read_text()
    legend = page[page.index("Heater Power</h2>"):page.index("Its normal (the days before)")]
    for word in ("unusual run", "stop-start", "supply off", "the same hours on each of the 3 days before"):
        assert word in legend, word
    assert page.count('class="normal"') == 3
    strip = page[page.index("On the same timeline"):]
    assert "Heater Relay" in strip and "Other devices that stopped answering" in strip and "Next Relay" in strip
    assert "02:00–15:00 · off" not in strip                                 # "off" is the empty lane: nothing drawn


def test_every_band_kind_has_its_own_word():
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    assert compose.band_of("no power")[0] == "supply off" and compose.band_of("offline")[0] == "not answering"
    assert compose.band_of("stops and restarts 8 times")[0] == "stop-start"
    assert compose.band_of("running")[0] == "unusual run" and compose.band_of("open")[0] == "unusual"


def test_the_sources_section_is_always_there_and_says_when_no_web_page_was_used(tmp_path):
    # owner, 2026-10-11: "i don't see any section for the Sources" — on a page that used no web page, it was hidden
    import json
    import subprocess
    from helpers import PYTHONPATH
    compose = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")

    def page(notes):
        (tmp_path / "n.json").write_text(json.dumps({"title": "The heater", "summary": "It ran.", **notes}))
        r = subprocess.run([sys.executable, compose, "investigation", "--notes", str(tmp_path / "n.json"),
                            "--out", str(tmp_path / "p.html")], capture_output=True, text=True,
                           env={**os.environ, "PYTHONPATH": PYTHONPATH, "VESTA_WEB_SEARCHES": "", "VESTA_MODES": ""})
        assert r.returncode == 0, r.stderr
        return (tmp_path / "p.html").read_text()
    none = page({})
    assert "Sources (web)" in none and "No web page was used" in none
    one = page({"sources": [{"title": "Pump manual", "url": "https://example.org/m"},
                            {"title": "not a link", "url": "javascript:alert(1)"}]})
    assert 'href="https://example.org/m"' in one and "No web page was used" not in one and "javascript" not in one
