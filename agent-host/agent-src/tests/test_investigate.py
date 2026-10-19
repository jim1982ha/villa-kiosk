"""The investigate starter skill (owner, 2026-10-11: "universal to any type of investigation… the most complete and
exhaustive response"): its script reads a night that went wrong and names every moment that matters — against the
device's own normal, never a number written for one villa."""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from helpers import STARTER_SKILLS
from vesta_shared.ha_client import HABase

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


class _Client(HABase):
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
                # the rules reloaded at 06:02 (next to the 06:00 moment): every rule ran once to re-check itself, and
                # one was switched off by hand — none of these is a run of the rule's own
                {"when": T(9, 6, 2, 1).isoformat(), "entity_id": "automation.heater_watch", "name": "heater watch",
                 "message": "triggered by event 'automation_reloaded'", "source": "event 'automation_reloaded'"},
                {"when": T(9, 6, 2, 2).isoformat(), "entity_id": "automation.morning", "name": "morning",
                 "message": "triggered by event 'automation_reloaded'", "source": "event 'automation_reloaded'"},
                {"when": T(9, 6, 3).isoformat(), "entity_id": "automation.morning", "name": "morning",
                 "message": "turned off"},
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
    assert "1 h 45 min" in run and "longer than its longest usual run" in run
    assert any("runs of about" in x and "stops and restarts" in x for x in lines)
    assert any("about 2.3× its usual running level" in x for x in lines)
    off = next(x for x in lines if x.strip().startswith("06:00:06"))
    assert "instead of its usual 1.7" in off                                 # exactly 0 where it rests at 1.7
    assert any("only 55% of its usual running level" in x for x in lines)


def test_around_lists_what_else_happened_and_leaves_background_out():
    import investigate
    text = "\n".join(investigate.around(_Client(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["lines"])
    gone, back = text.index("Devices that stopped answering"), text.index("answered again")
    assert gone < text.index("06:01:25  Next Relay") < back < text.index("13:08:00  Next Relay")
    assert "heater watch" in text and "06:11:25  Owner phone" in text
    assert "Left out as background" in text and "sensor.clock" in text


def test_a_reload_of_the_rules_is_one_line_never_a_run_per_rule():
    # architecture review round 2, 2026-10-19: a reload at 16:59 made 23 "Automation “X” ran at 16:59 and can act on …
    # check whether it did" lines; "turned on/off" rows counted as runs too. One reading (vesta_shared.past.automation_run)
    import investigate
    out = investigate.around(_Client(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)
    reload_lines = [x for x in out["lines"] if x.startswith("The rules were reloaded: ")]
    assert reload_lines == ["The rules were reloaded: every rule ran once to re-check itself, none of them acted (06:02; 2 rule run(s))"]
    (watch,) = [x for x in out["lines"] if x.strip().startswith("heater watch (")]
    assert "1× from 03:14:46 to 03:14:46" in watch                          # its own run only
    assert not any("morning" in x for x in out["lines"] if not x.startswith("The rules were reloaded"))
    assert [a["id"] for a in out["data"]["automations"]] == ["automation.heater_watch"]
    (reran,) = out["data"]["system_runs"]
    assert (reran["kind"], reran["runs"], reran["times"]) == ("reloaded", 2, [T(9, 6, 2).isoformat()])
    # …and the page: one "usual" line at 06:02, no "can act on" for the rule the reload re-ran next to the 06:00 moment
    _, f = _facts()
    log = [(r["time"], r["pill"], r["text"]) for r in f["log"]]
    assert ("06:02", "usual", "The rules were reloaded: every rule ran once to re-check itself, none of them acted") in log
    checks = [i for g in f["findings"] if g["title"] == "To check" for x in g["groups"] for i in x["items"]]
    assert not [c for c in checks if "06:02" in c or "morning" in c], checks
    assert not any("06:02" in t and "Automation" in x for t, _, x in log), log


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
    # the investigation page's charts (reports' inv_page.py investigation --data): the highest reading of each slice,
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
    notes = {"title": "The heater on the night of 9 October",
             "summary": "The heater ran without stopping from 03:09 for 1 h 45 min, then its supply went off at 06:00.",
             "timeline": [{"time": "07:30", "text": "The gardener found water on the floor.", "unusual": True}],
             "causes": [{"cause": "Water escaping downstream", "evidence": "a run far longer than any before",
                         "confirm": "look for a leak after the pump"},
                        {"cause": "A power surge", "evidence": "no surge recorded", "confirm": "-",
                         "source": "the weather station's records", "verdict": "not supported"}],
             "cannot_tell": ["No leak sensor in the room."], "warned_earlier": ["A leak sensor on the floor."],
             "checked": "Its power, the logbook, the automations."}
    code, err, page, out = _page(tmp_path, notes)
    assert code == 0, err
    for part in ("The heater on the night of 9 October", "Investigation conclusions", "Water escaping downstream",
                 "No leak sensor", "A leak sensor on the floor.", "Heater Power", "<svg", 'rel="icon"', "not supported",
                 "Where the lead came from: the weather station&#39;s records", "The gardener found water on the floor."):
        assert part in page, part
    assert out["charts"] == 3 and out["message"]["title"] == notes["title"]   # the chart, its hours, the strip
    key, said = out["message"]["text"].split("\n\n")                         # the recorded facts, then the summary
    assert key.startswith("Recorded: Heater Power: ran 03:09–04:55 (1 h 45 min)")
    assert said == notes["summary"] + " Details in the attached page."
    code, err, _, _ = _page(tmp_path, {**notes, "summary": "It ran. " * 120}, readings=False)
    assert code == 1 and "at most" in err                                  # the chat message stays one bubble
    code, err, _, _ = _page(tmp_path, {"title": "x"}, readings=False)
    assert code == 1 and "a title and a summary" in err and "Traceback" not in err


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
    # room for the longest "To:" (every role: review 3, 2026-10-13 — 120 kept for names cut the summary ~90 short);
    # checked through the agent's own layout of a message with a file
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    from vesta_agent.telegram import layout
    from vesta_shared.message_format import ROLE_WORDS, audience, titled
    from vesta_shared.messaging import TELEGRAM_CAPTION
    text = titled("T" * inv_page.TITLE_MAX, audience(ROLE_WORDS), "K" * inv_page.KEY_MAX + "\n" + "S" * inv_page.SUMMARY_MAX
                  + inv_page.DETAILS)
    assert len(layout(text, {"inline_keyboard": []}, "document")) == 1
    assert len(text) > TELEGRAM_CAPTION - 30                               # and no room is left unused


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
    assert "**Search the web (web_search) — always**" in text            # owner, 2026-10-12: every investigation
    import yaml
    assert "modes" not in yaml.safe_load(open(os.path.join(STARTER_SKILLS, "investigate", "skill.yaml")))  # no keyword


def _page(tmp_path, notes, searches=None, readings=True, web_on=False):
    """inv_page.py investigation as the agent runs it, on the invented heater's night (its timeline and around, with a
    control that stayed off): (exit, stderr, the page, its result). `searches`: the web searches the AI made."""
    import json
    import subprocess
    from helpers import PYTHONPATH
    import investigate
    args = []
    if readings:
        c = _Around()
        for name, res in (("t.json", investigate.timeline(c, ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3,
                                                           Z, series=True)),
                          ("a.json", investigate.around(c, None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["data"])):
            (tmp_path / name).write_text(json.dumps({"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(),
                                                     "zone": "UTC", **res}, default=str))
        args = ["--data", str(tmp_path / "t.json"), "--around", str(tmp_path / "a.json")]
    (tmp_path / "n.json").write_text(json.dumps(notes))
    if (tmp_path / "p.html").exists():
        (tmp_path / "p.html").unlink()
    page_py = os.path.join(STARTER_SKILLS, "investigate", "scripts", "page.py")
    r = subprocess.run([sys.executable, page_py, "--notes", str(tmp_path / "n.json"), *args,
                        "--out", str(tmp_path / "p.html")], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": PYTHONPATH,
                            "VESTA_WEB_SEARCHES": json.dumps(searches) if searches else "",
                            "VESTA_WEB_SEARCH_ON": "1" if web_on else ""})
    page = (tmp_path / "p.html").read_text() if (tmp_path / "p.html").exists() else ""
    return r.returncode, r.stderr, page, (json.loads(r.stdout) if r.returncode == 0 else {})


def test_after_a_web_search_the_page_names_and_cites_every_source(tmp_path):
    # owner, 2026-10-11: a page researched with 5 searches named no source; 2026-10-12: "I am expecting to see the text
    # section where you used any of these web page content … with reference numbers"
    notes = {"title": "The heater on 9 October", "summary": "It ran 3 h, the pattern of a stuck valve [1].",
             "causes": [{"cause": "A stuck valve", "evidence": "runs without stopping [1]", "confirm": "…",
                         "source": "[1]"}]}
    asked = ["pump runs without stopping causes"]
    code, err, _, _ = _page(tmp_path, notes, asked, readings=False)
    assert code == 1 and "list every web page you used in `sources`" in err
    notes["sources"] = [{"title": "Pump troubleshooting", "url": "https://example.org/pumps"},
                        {"title": "Valve guide", "url": "https://example.org/valves"}]
    code, err, _, _ = _page(tmp_path, notes, asked, readings=False)
    assert code == 1 and "never cited: [2] Valve guide" in err                # listed, used nowhere
    notes["cannot_tell"] = ["Whether the valve sticks when cold [2]."]
    code, err, _, _ = _page(tmp_path, notes, asked, readings=False)
    assert code == 1 and "needs its verdict" in err                          # a web lead without its verdict
    notes["causes"][0]["verdict"] = "consistent"
    notes["warned_earlier"] = ["A flow sensor [3]."]
    code, err, _, _ = _page(tmp_path, notes, asked, readings=False)
    assert code == 1 and "cites [3] but `sources` has 2" in err
    notes["warned_earlier"] = ["A flow sensor [2]."]
    code, err, page, out = _page(tmp_path, notes, asked, readings=False)
    assert code == 0, err
    assert '<li id="src-1"><a href="https://example.org/pumps"' in page and '<li id="src-2">' in page
    assert page.count('<sup class="ref"><a href="#src-1">[1]</a></sup>') == 3    # the summary, the evidence, the source
    assert "Web contribution" in page and "1 web search made" in page and "pump runs without stopping causes" in page
    assert "[1]" not in out["message"]["text"]                                # the chat message has no page for [n]
    code, err, page, _ = _page(tmp_path, {"title": "t", "summary": "s"}, readings=False)
    assert code == 0 and "Web search is switched off: no web search was made." in page   # off: nothing required
    # architecture review 4 (2026-10-13): web search on and none made — refused, as skill.yaml says (owner, 2026-10-12:
    # "always use web_search by default")
    code, err, page, _ = _page(tmp_path, {"title": "t", "summary": "s"}, readings=False, web_on=True)
    assert code == 1 and "web search is on for this investigation and none was made" in err and not page
    code, err, page, _ = _page(tmp_path, notes, asked, readings=False, web_on=True)
    assert code == 0, err


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
    import investigation_facts
    client = client or _Around()
    data = {"start": T(9, 2).isoformat(), "end": T(9, 15).isoformat(), "zone": "UTC",
            **investigate.timeline(client, list(ids), T(9, 2), T(9, 15), 3, Z, series=True)}
    data = __import__("json").loads(__import__("json").dumps(data, default=str))       # as page.py reads the file
    around = {"start": data["start"], "end": data["end"], "zone": "UTC",
              **investigate.around(client, None, T(9, 2), T(9, 15), list(ids), Z)["data"]}
    return investigation_facts, investigation_facts.facts(data, around)


def test_the_page_states_what_the_records_establish_and_rule_out():
    mod, f = _facts()
    log = [(r["time"], r["pill"], r["text"]) for r in f["log"]]
    assert ("03:09", "unusual", "Heater Power ran for 1 h 45 min, until 04:55 — longer than its longest usual run (8 s)") \
        in log
    assert any(p == "unusual" and t.startswith("Heater Power stopped and restarted 7 times in 15 min, until 05:10")
               for _, p, t in log)
    # 06:00–13:05 rounded to the minute, as the Kiosk says it (round 2, 2026-10-16; was "7 h 4 min", cut)
    assert any(p == "unusual" and t.startswith("Heater Power had no power for 7 h 5 min") for _, p, t in log)
    assert ("06:01", "unusual", "Next Relay stops reporting") in log            # not the device itself
    assert ("13:08", "usual", "Next Relay reports again") in log
    assert [t for t, _, _ in log] == sorted(t for t, _, _ in log)           # one list, in time order
    (out,) = [g for g in f["findings"] if g["title"] == "Ruled out"]
    groups = {g["lead"]: g["items"] for g in out["groups"]}
    assert groups["Stayed off for the whole period and the 3 days before, so it did not turn Heater Power on:"] == \
        ["Heater Relay"]
    assert groups["Ran next to an unusual moment, but can only notify or record, so it switched nothing:"] == \
        ["heater watch (notifies)"]
    assert not any("morning" in x["text"] for x in f["log"])           # it can switch, but ran far from every moment


def test_an_automation_that_can_switch_and_ran_then_is_named_with_what_it_acts_on():
    # what it acts on, by name — read from its own actions: a device read here (to check), another one (in the log
    # only) or none named (a template: to check)
    def acting(target):
        class Acting(_Around):
            def tool(self, name, args):
                if name == "ha_config_get_automation":
                    return {"config": {"actions": [{"choose": [{"sequence": [{"action": "switch.turn_on", **target}]}]},
                                                   {"action": "notify.send_message", "target": {"entity_id": "notify.x"}}]}}
                return super().tool(name, args)
        _, f = _facts(Acting())
        assert not any("heater watch" in str(g) for g in f["findings"] if g["title"] == "Ruled out")
        checks = [i for g in f["findings"] if g["title"] == "To check" for x in g["groups"] for i in x["items"]]
        logged = next(r["text"] for r in f["log"] if "heater watch" in r["text"])
        return checks, logged
    checks, logged = acting({"target": {"entity_id": "switch.a"}})
    assert checks == ["Automation “heater watch” ran at 03:14 and can act on Heater Relay — one of the devices read "
                      "here: check whether it did."]
    assert logged == "Automation “heater watch” runs — it can act on Heater Relay"
    checks, logged = acting({"target": {"entity_id": ["switch.spa"]}})
    assert checks == [] and logged == "Automation “heater watch” runs — it can act on Spa Relay"
    checks, _ = acting({"target": {"entity_id": "{{ states('input_text.x') }}"}})
    assert checks and "(switch.turn_on) — its targets could not be read" in checks[0]


def test_each_unusual_period_says_when_an_alert_on_the_same_limit_would_have_warned():
    # the long run: its normal longest is 8 s, flagged past max(2 × 8 s, 8 s + 300 s) = 308 s → 03:09:46 + 308 s
    _, f = _facts()
    (heater,) = f["alerts"]
    rules = {a["rule"]: a for a in heater["items"]}
    assert heater["name"] == "Heater Power"
    long = rules["it runs for more than 5 min without stopping"]
    assert (long["at"], long["ahead"], long["what"], long["span"]) == ("03:14", "1 h 40 min", "ran", "03:09–04:55")
    assert rules["it reads 0 for 1 min"]["at"] == "06:01"  # was "60 s": the Kiosk's words (round 2)
    assert rules["it starts 3 times in a row, each run shorter than 3 min"]["at"] == "05:00"     # its 3rd short run
    assert rules["it stays above 1.5× its usual running level for 2 min"]["at"] == "05:12"      # the earliest rule


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
    assert {"time": "08:00", "pill": "unusual",
            "text": "Back Door stopped reporting for 40 min, until 08:40 — it stopped reporting"} in f["log"]
    (door,) = f["alerts"]
    assert door["items"][0]["rule"] == "it stops reporting for 1 min" and door["items"][0]["at"] == "08:01"


def test_the_key_line_gives_the_longest_periods_per_device_and_says_how_many_more():
    mod, f = _facts()
    assert f["key"] == ("Recorded: Heater Power: ran 03:09–04:55 (1 h 45 min), stopped and restarted 7 times "
                        "04:55–05:10 (15 min), ran 05:10–06:00 (50 min), had no power 06:00–13:05 (7 h 5 min), ran "
                        "13:05–13:16 (11 min).")                                # one device: named once
    hm = lambda t: f"{t:%H:%M}"                                              # noqa: E731
    blips = [{"name": "Gate", "kind": "offline", "start": T(9, h), "end": T(9, h, 2), "seconds": 120} for h in range(12)]
    long = {"name": "Boiler", "kind": "running", "start": T(9, 13), "end": T(9, 18), "seconds": 18000}
    key = mod.key_line(blips + [long], hm)
    assert len(key) <= mod.KEY_MAX and "Boiler: ran 13:00–18:00 (5 h)" in key        # the longest, wherever
    assert key.endswith("more.") and key.index("Gate") < key.index("Boiler")               # devices in time order
    assert len(mod.key_line([{**long, "name": "N" * 300}], hm)) <= mod.KEY_MAX


def test_without_readings_the_page_keeps_the_accounts_own_timeline():
    mod, _ = _facts()
    f = mod.facts(None, None, {"timeline": [{"time": "07:30", "text": "Water on the floor"}]})
    assert f["log"] == [{"time": "07:30", "text": "Water on the floor", "pill": "reported"}]
    assert f["findings"] == f["alerts"] == [] and f["key"] == ""


def test_a_web_lead_the_records_contradict_is_listed_as_ruled_out():
    mod, _ = _facts()
    f = mod.facts(None, None, {"causes": [{"cause": "A grid outage", "evidence": "the neighbours kept power",
                                           "source": "[1]", "verdict": "not supported"},
                                          {"cause": "A stuck valve", "verdict": "consistent", "source": "x"}]})
    assert f["findings"] == [{"title": "Ruled out", "groups": [
        {"lead": "Leads the records contradict:", "items": ["A grid outage — the neighbours kept power"]}]}]


def test_the_page_is_laid_out_as_the_owner_asked(tmp_path):
    # owner, 2026-10-12: conclusions first, the charts right under them, ruled out + cannot tell together under the
    # charts, then what would have warned, everything recorded (folded) and how it was checked with the web's part
    code, err, page, out = _page(tmp_path, {"title": "The heater", "summary": "Water escaping kept it running.",
                                            "cannot_tell": ["No leak sensor."],
                                            "timeline": [{"time": "07:30", "text": "Water on the floor"}]})
    assert code == 0, err
    order = [page.index(x) for x in ("Investigation conclusions", "Heater Power</h2>", "On the same timeline",
                                     "Ruled out, and what the records cannot tell", "What would have warned earlier",
                                     "Everything recorded, in time order", "How it was checked, and its sources",
                                     "Web contribution")]
    assert order == sorted(order)
    assert '<details class="card fold"><summary><h2>Everything recorded, in time order (' in page
    assert "<details open" not in page and page.count("<details") == 1
    # owner, 2026-10-12: "reported" in yellow, "usual" in green
    assert '<span class="st watch">reported</span> Water on the floor' in page
    assert '<span class="st bad">unusual</span> Heater Power ran for 1 h 45 min' in page
    assert '<span class="st ok">usual</span> Next Relay reports again' in page
    assert '<div class="themes" role="radiogroup"' in page and 'id="th-auto" checked' in page   # Light / Auto / Dark
    assert "<h3>What the records cannot tell</h3>" in page and "No leak sensor." in page
    assert any("did not turn Heater Power on" in x for x in out["ruled_out"]) and out["established"]


def test_a_period_is_judged_over_as_long_as_its_alert_would_need():
    # a zero of 30 s, or a start-up surge of 8 s, is not flagged: no alert on the same limit could have fired. At the
    # limit exactly the period is flagged, but no alert is claimed before it ended.
    import investigate
    ref = {"rest_median": 1.7, "level_median": 750.0, "run_longest_s": 600.0}
    zero = lambda s: {"kind": "no power", "start": T(9, 3), "end": T(9, 3) + timedelta(seconds=s), "seconds": float(s)}  # noqa: E731
    (got,) = investigate._notable([zero(30)], ref, 100.0)
    assert "why" not in got
    (got,) = investigate._notable([zero(60)], ref, 100.0)
    assert "instead of its usual 1.7" in got["why"] and "alert" not in got
    (got,) = investigate._notable([zero(300)], ref, 100.0)
    assert got["alert"]["at"] == T(9, 3, 1)
    surge = {"kind": "running", "start": T(9, 3), "end": T(9, 3, 0, 8), "seconds": 8.0, "mean": 2000.0}
    (got,) = investigate._notable([surge], ref, 100.0)
    assert "why" not in got
    (got,) = investigate._notable([{**surge, "end": T(9, 3, 3), "seconds": 180.0}], ref, 100.0)
    assert "about 2.7× its usual running level" in got["why"]


def test_only_an_alert_in_time_to_matter_is_said_and_repeats_are_one_line():
    # an alert after 60 s of silence, for a drop-out of 71 s, warned of nothing; the same rule firing on three outages
    # of one device is one entry with its other times
    import investigation_facts as mod

    def off(h, m, seconds):
        a = T(9, h, m)
        return {"kind": "offline", "start": a.isoformat(), "end": (a + timedelta(seconds=seconds)).isoformat(),
                "seconds": seconds, "why": "it stopped reporting",
                "alert": {"rule": "it stops reporting for 60 s", "at": (a + timedelta(seconds=60)).isoformat()}}
    data = {"zone": "UTC", "start": T(9, 0).isoformat(), "end": T(9, 23).isoformat(),
            "entities": [{"entity_id": "sensor.gate", "label": "Gate", "periods": [off(1, 0, 71), off(2, 0, 600),
                                                                                   off(5, 0, 900), off(7, 0, 3600)]}]}
    assert mod.facts(data, None)["alerts"] == [{"name": "Gate", "items": [
        {"rule": "it stops reporting for 60 s", "at": "02:01", "ahead": "9 min", "what": "stopped reporting",
         "span": "02:00–02:10", "again": ["05:01", "07:01"]}]}]


def test_what_drops_off_in_the_same_minute_is_one_row():
    import investigation_facts as mod
    data = {"zone": "UTC", "start": T(9, 0).isoformat(), "end": T(9, 23).isoformat(), "settings": {"coincide_s": 600},
            "entities": [{"entity_id": "sensor.pump", "label": "Pump", "periods": [
                {"kind": "no power", "start": T(9, 6).isoformat(), "end": T(9, 9).isoformat(), "seconds": 10800,
                 "why": "it read 0"}]}]}
    around = {"offline": [{"at": T(9, 6, 1, 5).isoformat(), "name": "Spa Relay", "id": "switch.spa"},
                          {"at": T(9, 6, 1, 9).isoformat(), "name": "Spa Relay Firmware", "id": "update.spa"},
                          {"at": T(9, 8, 55).isoformat(), "name": "Far Away", "id": "sensor.far"}],
              "back": [{"at": T(9, 13).isoformat(), "name": "Spa Relay", "id": "switch.spa"}]}
    texts = [r["text"] for r in mod.facts(data, around)["log"]]
    assert "Spa Relay, Spa Relay Firmware stop reporting" in texts and "Spa Relay reports again" in texts
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
    assert burst["kind"] == "stops and restarts 8 times" and "runs of about" in burst["why"] and burst.get("alert")
    assert hidden == 61                                                    # the 60, and the last ordinary rest


# ---- the charts' context (owner, 2026-10-11: "what does the red background mean? … more graphs to bring more context")
class _Temps(_Client):
    """An invented room temperature: 21 to 23 °C every day, 26 °C at 03:00 on the 8th only."""

    def __init__(self):
        super().__init__()
        self.pw = sorted([(T(d, h), 21.0 + (h % 3)) for d in range(6, 10) for h in range(24)] + [(T(8, 3, 30), 26.0)])

    def states(self, ids):
        return {i: {"state": "22", "attributes": {"friendly_name": "Room Temperature", "unit_of_measurement": "°C"}}
                for i in ids}


def test_the_chart_fits_the_device_its_hours_running_or_its_usual_days_behind():
    # owner, 2026-10-12: "would you use other metric? other graph representation?" — a device that RUNS gets its
    # minutes running per hour against its usual; one read as LEVELS keeps the same hours of the days before, dashed
    import investigate
    res = investigate.timeline(_Around(), ["sensor.heater_power", "switch.a"], T(9, 2), T(9, 15), 3, Z, series=True)
    power, relay = res["entities"]
    assert "normal_series" not in power and power["per_hour"]["unit"] == "hour"
    bins = {b["at"][11:16]: b for b in power["per_hour"]["bins"]}
    assert len(bins) == 13 and bins["03:00"]["minutes"] > 50 and bins["02:00"]["minutes"] < 1
    assert 0 < bins["03:00"]["usual"] < 1                                    # its usual: a few 8-s top-ups an hour
    assert relay["states"] == [{"at": T(9, 2).isoformat(), "state": "off", "as": "off"}] and "series" not in relay
    temp = investigate.timeline(_Temps(), ["sensor.room_temperature"], T(9, 2), T(9, 15), 3, Z, series=True)
    (room,) = temp["entities"]
    assert "per_hour" not in room and [n["days_before"] for n in room["normal_series"]] == [1, 2, 3]
    tops = [max(v for _, v in n["series"] if v is not None) for n in room["normal_series"]]
    assert tops == [26.0, 23.0, 23.0]                                       # each day at its own place
    longer = investigate.timeline(_Temps(), ["sensor.room_temperature"], T(8, 2), T(9, 15), 3, Z, series=True)
    assert longer["entities"][0]["normal_series"] == []                     # over a day: no "same hours"


def test_a_state_lane_tags_each_state_by_the_timelines_own_words():
    import investigate
    rows = [(T(9, 1), "off"), (T(9, 3), "on"), (T(9, 3), "unavailable"), (T(9, 4), "unavailable"), (T(9, 5), "home"),
            (T(9, 16), "off")]
    got = investigate.state_series(rows, T(9, 2), T(9, 15))
    assert [(g["at"][11:16], g["state"], g["as"]) for g in got] == [
        ("02:00", "off", "off"), ("03:00", "unavailable", "offline"), ("05:00", "home", "other")]


def test_the_page_names_each_band_and_draws_the_strip(tmp_path):
    code, err, page, _ = _page(tmp_path, {"title": "The heater", "summary": "It ran."})
    assert code == 0, err
    # what the chart shows is said ABOVE it, its legend under it (owner, 2026-10-12)
    assert page.index("Heater Power</h2>") < page.index("Usually (over the 3 days before)") < \
        page.index("<svg", page.index("Heater Power</h2>"))
    legend = page[page.index("Usually (over the 3 days before)"):page.index("How many minutes it ran each hour")]
    for word in ("what it read (W)", "ran longer or harder than usual", "kept stopping and restarting",
                 "read 0: no power reached it"):
        assert word in legend, word
    hours = page[page.index("How many minutes it ran each hour"):page.index("On the same timeline")]
    assert "minutes it ran that hour" in hours and "its usual for that hour (the days before)" in hours
    strip = page[page.index("On the same timeline"):]
    assert strip.index("An empty lane means off") < strip.index("<svg")
    assert "Heater Relay" in strip and "Other devices that stopped reporting" in strip and "Next Relay" in strip
    assert "02:00–15:00 · off" not in strip                                 # "off" is the empty lane: nothing drawn


def test_every_band_kind_has_its_own_word_and_colour():
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    assert inv_page.band_of("no power")[0] == "read 0: no power reached it"
    assert inv_page.band_of("offline")[0] == "stopped reporting"
    assert inv_page.band_of("stops and restarts 8 times")[0] == "kept stopping and restarting"
    assert inv_page.band_of("running")[0] == "ran longer or harder than usual" and inv_page.band_of("open")[0] == "unusual"
    # owner, 2026-10-12: "you are using too similar colour": every kind its own, none the readings' or the usual's
    colours = [c for c in inv_page.BAND_COLOURS.values() if c != "var(--ink2)"]
    assert len(set(colours)) == len(colours) and not {inv_page.READINGS, inv_page.USUAL} & set(colours)


def test_a_period_is_said_the_same_by_the_lines_the_ai_reads_and_by_the_page():
    # architecture review, 2026-10-13: the AI's reading quoted investigate.py's "offline for 1 h 15 min" while the
    # page's facts said "stopped reporting … 75 min" for the same outage — three duration rules and two word tables
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    import investigation_facts
    from vesta_shared import periods
    import investigate as lines
    for seconds, said in ((45, "45 s"), (600, "10 min"), (4500, "1 h 15 min"), (7200, "2 h"), (9000, "2 h 30 min")):
        assert lines.lasting(seconds) == investigation_facts.lasting(seconds) == inv_page.lasting(seconds) == said
    for kind in (periods.NO_POWER, periods.OFFLINE, periods.NO_VALUE, periods.RUNNING, periods.restarts(8)):
        assert investigation_facts.did(kind) == periods.did(kind) and inv_page.band_of(kind)[0] == periods.band(kind)
        assert periods.base(kind) in inv_page.BAND_COLOURS
    assert periods.did(periods.restarts(8)) == "stopped and restarted 8 times"


def test_the_web_contribution_is_always_there_and_says_when_no_web_page_was_used(tmp_path):
    # owner, 2026-10-11: "i don't see any section for the Sources" — on a page that used no web page, it was hidden
    code, err, none, _ = _page(tmp_path, {"title": "The heater", "summary": "It ran."}, readings=False)
    assert code == 0, err
    assert "<h3>Web contribution</h3>" in none and "No web page was used" in none
    code, err, one, _ = _page(tmp_path, {"title": "The heater", "summary": "It ran [1].",
                                         "sources": [{"title": "Pump manual", "url": "https://example.org/m"},
                                                     {"title": "not a link", "url": "javascript:alert(1)"}]},
                              readings=False)
    assert code == 0, err
    assert 'href="https://example.org/m"' in one and "No web page was used" not in one and "javascript" not in one


def test_every_chart_and_the_strip_have_a_legend_of_what_they_draw(tmp_path):
    code, err, page, _ = _page(tmp_path, {"title": "The heater", "summary": "It ran."})
    assert code == 0, err
    assert page.count('class="note legend"') == page.count("<svg viewBox") == 3   # the chart, its hours, the strip
    strip = page[page.index("On the same timeline"):page.index("Ruled out, and what")]
    assert "another device stopped reporting" in strip                     # Next Relay
    assert "on or open" not in strip                                        # the relay stayed off: nothing drawn, no key


def test_a_tooltip_is_page_text_over_its_column_never_covered():
    # owner, 2026-10-12: the tip was chart text — it grew with the screen and the next bars covered it. Now page text
    # (13 px, page_head.html), laid over the chart after it, its place in % of the chart
    import re
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    chart = inv_page.hourchart({"unit": "hour", "bins": [
        {"at": T(9, h).isoformat(), "minutes": m, "usual": 0.3} for h, m in ((2, 0), (3, 50), (4, 58), (5, 52))]}, Z)
    svg_end = chart.index("</svg>")
    tips = re.findall(r'<span class="pt" tabindex="0" aria-label="([^"]+)" style="left:([\d.]+)%;width:([\d.]+)%', chart)
    assert len(tips) == 4 and chart.index('class="pt"') > svg_end                # after the chart: nothing covers them
    assert tips[0][0] == "02:00 · ran 0 min (usually 0.3 min)"
    assert all(0 <= float(left) and float(left) + float(w) <= 100.01 for _, left, w in tips)
    assert '<span class="tip l">' in chart and '<span class="tip r">' in chart   # at the edges, anchored inside
    head = open(__import__("vesta_shared.page", fromlist=["SHARED_TEMPLATES"]).SHARED_TEMPLATES + "/page_head.html", encoding="utf-8").read()
    assert ".chart .pt .tip{" in head and "font-size:13px" in head[head.index(".chart .pt .tip{"):][:400]


def test_the_hours_chart_stops_at_an_hour_and_draws_its_usual_as_one_line():
    # 2026-10-12: the scale went to 80 min in an hour, and a dash per hour at 0 read as a broken axis
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    chart = inv_page.hourchart({"unit": "hour", "bins": [
        {"at": T(9, h).isoformat(), "minutes": m, "usual": u} for h, m, u in ((2, 0, 0.3), (3, 58, 0.2), (4, 0, 8))]}, Z)
    assert ">60</span>" in chart and ">80</span>" not in chart
    assert chart.count('class="usual"') == 1 and chart.count(f'stroke="{inv_page.USUAL}"') == 1   # one line, no dashes


def test_an_automation_made_from_a_blueprint_says_what_it_acts_on():
    # 2026-10-12: five automations of the villa said "could not be read" — the blueprint is read (its `get` only) and
    # each input filled with the automation's own, a default where it gave none
    import investigate
    bp = {"blueprint": {"input": {"fan": {"name": "Fan"}, "level": {"default": 70}}},
          "actions": [{"choose": [{"sequence": [{"action": "homeassistant.turn_on",
                                                  "target": {"entity_id": {"__input__": "fan"}}}]}]},
                      {"action": "notify.notify", "data": {"message": {"__input__": "level"}}}]}

    class C(_Around):
        def tool(self, name, args):
            if name == "ha_config_get_automation":
                return {"config": {"use_blueprint": {"path": "fan.yaml", "input": {"fan": "switch.spa"}}}}
            if name == "ha_manage_blueprints":
                assert args == {"action": "get", "path": "fan.yaml", "domain": "automation"}
                return {"success": True, "data": {"config": bp}}
            return super().tool(name, args)
    got = investigate.automation_able(C(), "automation.x", T(9, 2), T(9, 15))
    assert got["can"] == "changes" and got["changes"] == ["homeassistant.turn_on"]
    assert got["targets"] == [{"id": "switch.spa", "name": "Spa Relay"}]

    class Unreadable(C):
        def tool(self, name, args):
            if name == "ha_manage_blueprints":
                raise RuntimeError("no file access")
            return super().tool(name, args)
    assert investigate.automation_able(Unreadable(), "automation.x", T(9, 2), T(9, 15))["can"] == "unproven"


def test_the_read_only_client_allows_a_blueprints_get_and_nothing_else_of_it():
    from vesta_shared.ha_client import HAError, McpClient

    class Session:
        calls = []

        def call_raw(self, name, args):
            Session.calls.append((name, args))
            return {"content": [{"type": "text", "text": "{}"}]}
    c = McpClient("http://x", "UTC", session=Session())
    c.tool("ha_manage_blueprints", {"action": "get", "path": "a.yaml"})
    for action in ("save", "delete", "import", "substitute", None):
        try:
            c.tool("ha_manage_blueprints", {"action": action, "path": "a.yaml"})
            raise AssertionError(f"{action} was allowed")
        except HAError as e:
            assert "only its get action" in str(e)
    assert Session.calls == [("ha_manage_blueprints", {"action": "get", "path": "a.yaml"})]


def test_a_device_home_assistant_names_nowhere_is_said_in_words_never_by_its_id():
    import investigate

    class Silent(_Around):
        def history(self, ids, start, end):
            return {ids[0]: []} if ids[0] == "sensor.pump_current" else super().history(ids, start, end)

        def states(self, ids):
            return {i: v for i, v in super().states(ids).items() if i != "sensor.pump_current"}
    _, f = _facts(Silent(), ("sensor.heater_power", "sensor.pump_current"))
    (cannot,) = [g for g in f["findings"] if g["title"] == "What the records cannot tell"]
    assert cannot["groups"][0]["items"] == ["Pump current: no reading of it was kept in this period, so it "
                                            "cannot be judged."]
    assert "sensor.pump_current" not in str(f)

def test_a_reference_links_only_to_a_source_that_exists():
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    said = str(inv_page.citing(1)("the guide [1] and <b> [2]"))
    assert '<a href="#src-1">[1]</a>' in said and "[2]" in said and "#src-2" not in said and "&lt;b&gt;" in said


def test_the_usual_is_said_in_plain_sentences():
    # owner, 2026-10-12: "54.3 runs a day, usually 9 s, longest 9 min … doesn't seem proper English"
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    ref = {"days": 3.0, "runs_per_day": 54.3, "run_median_s": 9.0, "run_longest_s": 566.0, "level_median": 802.0,
           "rest_median": 1.76}
    assert inv_page.normal_words(ref, "W") == ("Usually (over the 3 days before) it started about 54 times a day; a run "
                                              "usually lasted 9 s and never more than 9 min. While running it read "
                                              "about 802 W; at rest about 1.76 W.")
    same = inv_page.normal_words({**ref, "run_longest_s": 9.0}, "W")
    assert "usually lasted 9 s." in same and "never more than" not in same          # never "9 s and never more than 9 s"


def test_what_an_automation_does_is_said_as_a_person_says_a_list():
    import investigation_facts as mod
    assert mod._and(["fires an event", "notifies", "records a value"]) == "fires an event, notifies and records a value"
    assert mod._and(["notifies"]) == "notifies" and mod._and([]) == ""



def test_a_lead_names_its_web_page_and_links_its_number_or_says_the_records(tmp_path):
    # owner, 2026-10-12: "Where the lead came from: AGM Service, booster pump failure guide" — no number, no link
    notes = {"title": "t", "summary": "It ran [1].",
             "sources": [{"title": "Common Causes of Booster Pump Failure", "url": "https://example.org/agm"}],
             "causes": [{"cause": "A leak", "evidence": "ran 3 h", "source": "AGM Service guide", "verdict": "consistent"}]}
    code, err, _, _ = _page(tmp_path, notes, ["pump runs nonstop"], readings=False)
    assert code == 1 and "as [n]" in err and "AGM Service guide" in err
    notes["causes"][0]["source"] = "[1]"
    code, err, page, _ = _page(tmp_path, notes, ["pump runs nonstop"], readings=False)
    assert code == 0, err
    assert ('Where the lead came from: Common Causes of Booster Pump Failure <sup class="ref"><a href="#src-1">[1]</a>'
            in page)
    notes["causes"][0]["source"] = "the villa's records"
    assert _page(tmp_path, notes, ["pump runs nonstop"], readings=False)[0] == 0


def test_every_word_of_a_chart_is_page_text_at_the_reports_size():
    # owner, 2026-10-12: "the X-axis and Y-axis and the graph legends … a font size different from the text in the
    # report" — no word is drawn in a chart any more: each is laid over it, in the page's own size
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    charts = [__import__("vesta_shared.page", fromlist=["line"]).line([("2026-10-01", 40), ("2026-10-02", 97)], "%"),
              inv_page.hourchart({"unit": "hour", "bins": [{"at": T(9, h).isoformat(), "minutes": 5, "usual": 1}
                                                          for h in range(3)]}, Z),
              inv_page.strip([{"name": "Spa Relay", "bands": [{"start": T(9, 2), "end": T(9, 4), "state": "on",
                                                               "as": "on"}]}], T(9, 2), T(9, 15), Z)]
    for chart in charts:
        assert "<text" not in chart and '<span class="ax"' in chart, chart[:200]
    assert '">Spa Relay</span>' in charts[2]
    head = open(__import__("vesta_shared.page", fromlist=["SHARED_TEMPLATES"]).SHARED_TEMPLATES + "/page_head.html", encoding="utf-8").read()
    import re
    note = re.search(r"(?:^|[}\n])\.note\{([^}]*)\}", head).group(1)
    assert "font-size:13px" in head[head.index(".chart .ax{"):][:200] and "font-size:13px" in note   # the notes' size


def test_a_device_that_reports_a_value_has_no_state_band():
    # owner, 2026-10-12: a relay's "Uptime" (a new time at every reading) filled its whole lane as "another state"
    import investigate
    rows = [(T(9, 2) + timedelta(minutes=10 * k), f"2026-10-0{k % 9 + 1}T00:00:00") for k in range(12)]
    rows.insert(5, (T(9, 2, 45), "unavailable"))
    got = investigate.state_series(rows, T(9, 2), T(9, 15))
    assert [g["as"] for g in got] == ["value", "offline", "value"]           # only when it stopped reporting shows
    door = investigate.state_series([(T(9, 2), "open"), (T(9, 3), "closed"), (T(9, 4), "jammed")], T(9, 2), T(9, 15))
    assert [g["as"] for g in door] == ["on", "off", "other"]                  # a few states: a state lane
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    lane = inv_page.strip([{"name": "Uptime", "bands": [{"start": T(9, 2), "end": T(9, 15), "state": "x", "as": "value"}]}],
                         T(9, 2), T(9, 15), Z)
    assert "opacity=\".55\"" not in lane and inv_page.strip_legend([{"bands": [{"as": "value"}]}]) == []


def test_the_skill_asks_for_a_summary_the_caption_can_hold():
    # review 3 (2026-10-13): the room grew when "To:" became roles; the AI is told the limit in SKILL.md, so the two agree
    import page as inv_page   # the investigate skill's page (it was reports' inv_page.py)
    told = re.search(r'"summary": "[^"]*?at most (\d+) characters', open(os.path.join(STARTER_SKILLS, "investigate",
                                                                                      "SKILL.md")).read())
    assert told and inv_page.SUMMARY_MAX - 10 <= int(told.group(1)) <= inv_page.SUMMARY_MAX
    # architecture review 4: the same sentences too — the instructions said 3 to 5, the refusal 4 to 6
    assert re.search(r'"summary": "' + inv_page.SUMMARY_SENTENCES + r", at most \d+ characters",
                     open(os.path.join(STARTER_SKILLS, "investigate", "SKILL.md")).read())


def test_around_says_a_restart_once_and_keeps_a_device_that_did_not_come_back():
    # 2026-10-13: a period holding a Home Assistant restart listed every device as "stopped answering" and never said it
    import investigate

    class Restarted(_Client):
        def logbook(self, start, end):
            rows = super().logbook(start, end) + [
                {"when": T(9, 4, 0, 0).isoformat(), "name": "Home Assistant", "message": "started", "domain": "homeassistant"},
                {"when": T(9, 3, 59, 40).isoformat(), "entity_id": "switch.spa", "name": "Spa Relay", "state": "unavailable"},
                {"when": T(9, 4, 1, 0).isoformat(), "entity_id": "switch.spa", "name": "Spa Relay", "state": "off"},
                {"when": T(9, 3, 59, 41).isoformat(), "entity_id": "sensor.example_thermometer", "name": "Thermometer",
                 "state": "unavailable"}]                                          # it never answered again
            return [r for r in rows if start <= datetime.fromisoformat(r["when"]) < end]
    text = "\n".join(investigate.around(Restarted(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z)["lines"])
    assert "The villa's system restarted: 04:00:00 (1 device(s) dropped and answered again with it" in text, text
    assert "Spa Relay" not in text                                                 # the restart's, not its own
    assert "03:59:41  Thermometer (sensor.example_thermometer)  — with the restart, not back since" in text, text
    assert "06:01:25  Next Relay" in text and "Next Relay (switch.next_relay)  —" not in text   # its own drop: plain
    # ⚠️ THE NIGHTLY CHECK READS THE SAME ROWS THE SAME WAY (architecture review, 2026-10-15: one answer,
    # vesta_shared.device_state.RestartDrops): neither restart drop is a reconnect of the device's own, Next Relay's is
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "pm_features", os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "features.py"))
    features = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(features)
    rows = Restarted().logbook(T(9, 2), T(9, 15))
    flips = features.flips_per_day(rows, "UTC", investigate.th("restart_settle_minutes"))
    assert "switch.spa" not in flips and "sensor.example_thermometer" not in flips and "switch.next_relay" in flips, flips


def test_the_skills_own_example_of_a_cause_passes_the_pages_rules():
    # 2026-10-15: step 6 said a lead's source is "[n]", the account's format said "the web page's name" — the page
    # refuses a name, so following the format had the page refused. One rule, and the example obeys it
    import json
    import page as inv_page
    text = open(os.path.join(STARTER_SKILLS, "investigate", "SKILL.md"), encoding="utf-8").read()
    raw = re.search(r'\{"cause":[^{}]*?"verdict"[^{}]*\}', text).group(0)          # the example, not the format
    cause = json.loads(" ".join(line.strip() for line in raw.splitlines()))
    assert (inv_page.CITE.search(cause["source"]) or inv_page.RECORDS.search(cause["source"])) \
        and cause["verdict"] in inv_page.VERDICTS
    assert "page's name" not in text and "web page's name" not in text
    # the message shows the summary under the line of recorded times: the example explains, it never repeats a time
    example = re.search(r'"summary": "The pool pump.*?"\n', text, re.S).group(0)
    assert not re.search(r"\b\d{1,2}:\d{2}\b", example), example


def test_a_period_that_would_end_later_ends_now(tmp_path):
    # villa, 2026-10-15: "--end 2026-10-15" read at 23:05 ran to midnight — a sensor offline 6 d 6 h read "6 d 7 h"
    import json
    code, said = _main(tmp_path, "timeline", "--entities", "sensor.a", "--start", "2026-10-09", "--end", "2026-10-15",
                       "--now", "2026-10-15T23:05:00+00:00", "--out", str(tmp_path / "timeline.json"))
    assert code == 0, said
    assert json.load(open(tmp_path / "timeline.json"))["end"] == "2026-10-15T23:05:00+00:00"
    code, said = _main(tmp_path, "around", "--start", "2026-10-16", "--end", "2026-10-16",
                       "--now", "2026-10-15T23:05:00+00:00")
    assert code == 1 and "--end must be after --start" in said           # a period that has not begun yet


def test_find_names_the_parts_listed_under_the_device_as_the_same_box():
    # architecture review scan 1, 2026-10-19: a meter's phases hang under it ("via"); the night's checks call them one
    # device (0.12.249) — the investigation's "same physical device" now says so too, from the same rule
    import investigate
    from vesta_shared.knowledge_pack import KnowledgePack
    pack = KnowledgePack(villa="Example Villa", time_zone="UTC", generated_at="x", ha_version=None, areas=[], people=[],
                         channels={}, unknown_area=[], unclassified=[], retention={}, families={}, assets={},
                         devices={"d1": {"name": "Heater meter"}, "d2": {"name": "Phase A", "via": "d1"}},
                         entity_devices={"sensor.heater_power": "d1", "sensor.heater_phase_a_power": "d2"})
    text = "\n".join(investigate.find(_Client(), "heater", None, pack)["lines"])
    assert "sensor.heater_phase_a_power" in text, text
    assert "sensor.heater_phase_a_power" not in "\n".join(investigate.find(_Client(), "heater", None)["lines"])
