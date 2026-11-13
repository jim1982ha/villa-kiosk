"""The investigate starter skill (owner, 2026-10-11: "universal to any type of investigation… the most complete and
exhaustive response"): its script reads a night that went wrong and names every moment that matters — against the
device's own normal, never a number written for one villa."""
from __future__ import annotations

import os
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
    """An invented heater: three quiet days of 8s top-ups at 750 W, then a night of trouble."""
    pw = []
    t = T(6, 0)
    while t < T(9, 3):
        pw += [(t, 750.0), (t + timedelta(seconds=8), 1.7)]
        t += timedelta(minutes=90)
    pw += [(T(9, 3, 9, 46), 780.0), (T(9, 3, 40), 730.0), (T(9, 4, 5), 1600.0), (T(9, 4, 30), 400.0),
           (T(9, 4, 31), 1400.0)]
    for k in range(8):                                                   # stop-start, every 2min
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
    assert "longest 8s" in text                                           # its normal, read from the days before
    run = next(x for x in lines if x.strip().startswith("03:09:46"))
    assert "1h 45min" in run and "longer than its longest usual run" in run
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
    reload_lines = [x for x in out["lines"] if x.startswith("The automations were reloaded: ")]
    assert reload_lines == ["The automations were reloaded: every automation ran once to re-check itself, none of them acted (06:02; 2 automation run(s))"]
    (watch,) = [x for x in out["lines"] if x.strip().startswith("heater watch (")]
    assert "1× from 03:14:46 to 03:14:46" in watch                          # its own run only
    assert not any("morning" in x for x in out["lines"] if not x.startswith("The automations were reloaded"))
    assert [a["id"] for a in out["data"]["automations"]] == ["automation.heater_watch"]
    (reran,) = out["data"]["system_runs"]
    assert (reran["kind"], reran["runs"], reran["times"]) == ("reloaded", 2, [T(9, 6, 2).isoformat()])
    # …and the page: one "usual" line at 06:02, no "can act on" for the rule the reload re-ran next to the 06:00 moment
    _, f = _facts()
    log = [(r["time"], r["pill"], r["text"]) for r in f["log"]]
    assert ("06:02", "usual", "The automations were reloaded: every automation ran once to re-check itself, none of them acted") in log
    checks = [i for g in f["findings"] if g["title"] == "To check" for x in g["groups"] for i in x["items"]]
    assert not [c for c in checks if "06:02" in c or "morning" in c], checks
    assert not any("06:02" in t and "Automation" in x for t, _, x in log), log


def test_the_investigation_page_carries_the_account_and_its_charts(tmp_path):
    # owner, 2026-10-11: the investigate skill "uses the report skill to create all this in a HTML report file",
    # the chat message "much more synthetic and shorter"
    notes = {"title": "The heater on the night of 9 October",
             "summary": "The heater ran without stopping from 03:09 for 1h 45min, then its supply went off at 06:00.",
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
    assert key.startswith("Recorded: Heater Power: ran 03:09–04:55 (1h 45min)")
    assert said == notes["summary"] + " Details in the attached page."
    code, err, _, _ = _page(tmp_path, {**notes, "summary": "It ran. " * 120}, readings=False)
    assert code == 1 and "at most" in err                                  # the chat message stays one bubble
    code, err, _, _ = _page(tmp_path, {"title": "x"}, readings=False)
    assert code == 1 and "a title and a summary" in err and "Traceback" not in err


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
    notes = {"title": "The heater on 9 October", "summary": "It ran 3h, the pattern of a stuck valve [1].",
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
    # 2026-10-11: a meter reporting its idle every 10s and topping up 8s every 90min had 99% of its readings at idle;
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
    on = investigate.threshold(rows)
    assert on is not None and 2 < on < 750
    ref = investigate.normal(rows, T(9, 0), on)
    assert ref["runs_per_day"] > 10 and ref["run_longest_s"] == 8 and 1.5 < ref["rest_median"] < 2.0
    # …and a reading that only drifts (a temperature) is still read as levels, never as runs
    temps = [24.0 + (i % 30) / 10 for i in range(2000)]
    assert investigate.threshold([(T(6, 0) + timedelta(minutes=i), str(v)) for i, v in enumerate(temps)]) is None


# ---- facts first (owner, 2026-10-11: "the investigate skill is not providing any added-value against a 'normal'
# query"): what the records establish and rule out is laid out by code, for any device — the AI explains it
class _Around(_WithControl):
    """The heater's night with its control off, a neighbour that drops off at 06:01, and two automations: one that can
    only notify (ran 5min after the long run began), one that can switch (ran far from any unusual moment)."""

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
    assert ("03:09", "unusual", "Heater Power ran for 1h 45min, until 04:55, longer than its longest usual run (8s)") \
        in log
    assert any(p == "unusual" and t.startswith("Heater Power stopped and restarted 7 times in 15min, until 05:10")
               for _, p, t in log)
    # 06:00–13:05 rounded to the minute, as the Kiosk says it (round 2, 2026-10-16; was "7h 4min", cut)
    assert any(p == "unusual" and t.startswith("Heater Power had no power for 7h 5min") for _, p, t in log)
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


def test_each_unusual_period_says_when_an_alert_on_the_same_limit_would_have_warned():
    # the long run: its normal longest is 8s, flagged past max(2 × 8s, 8s + 300s) = 308s → 03:09:46 + 308s
    _, f = _facts()
    (heater,) = f["alerts"]
    rules = {a["rule"]: a for a in heater["items"]}
    assert heater["name"] == "Heater Power"
    long = rules["it runs for more than 5min without stopping"]
    assert (long["at"], long["ahead"], long["what"], long["span"]) == ("03:14", "1h 40min", "ran", "03:09–04:55")
    assert rules["it reads 0 for 1min"]["at"] == "06:01"  # was "60s": the Kiosk's words (round 2)
    assert rules["it starts 3 times in a row, each run shorter than 3min"]["at"] == "05:00"     # its 3rd short run
    assert rules["it stays above 1.5× its usual running level for 2min"]["at"] == "05:12"      # the earliest rule


def test_the_facts_are_any_devices_a_door_that_stopped_answering():
    # universal: a sensor with no numbers at all, silent for 40min — the same facts, the same alert rule
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
            "text": "Back Door stopped reporting for 40min, until 08:40, it stopped reporting"} in f["log"]
    (door,) = f["alerts"]
    assert door["items"][0]["rule"] == "it stops reporting for 1min" and door["items"][0]["at"] == "08:01"


def test_a_period_is_judged_over_as_long_as_its_alert_would_need():
    # a zero of 30s, or a start-up surge of 8s, is not flagged: no alert on the same limit could have fired. At the
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
    # an alert after 60s of silence, for a drop-out of 71s, warned of nothing; the same rule firing on three outages
    # of one device is one entry with its other times
    import investigation_facts as mod

    def off(h, m, seconds):
        a = T(9, h, m)
        return {"kind": "offline", "start": a.isoformat(), "end": (a + timedelta(seconds=seconds)).isoformat(),
                "seconds": seconds, "why": "it stopped reporting",
                "alert": {"rule": "it stops reporting for 60s", "at": (a + timedelta(seconds=60)).isoformat()}}
    data = {"zone": "UTC", "start": T(9, 0).isoformat(), "end": T(9, 23).isoformat(),
            "entities": [{"entity_id": "sensor.gate", "label": "Gate", "periods": [off(1, 0, 71), off(2, 0, 600),
                                                                                   off(5, 0, 900), off(7, 0, 3600)]}]}
    assert mod.facts(data, None)["alerts"] == [{"name": "Gate", "items": [
        {"rule": "it stops reporting for 60s", "at": "02:01", "ahead": "9min", "what": "stopped reporting",
         "span": "02:00–02:10", "again": ["05:01", "07:01"]}]}]


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
    for _ in range(30):                                                    # 60 ordinary periods: 9s runs, 10min rests
        add("running", 9, 800.0); add("idle", 600, 1.7)
    for _ in range(8):                                                     # the burst: 60s runs, 60s rests
        add("running", 60, 2400.0); add("idle", 60, 1.7)
    add("idle", 3000, 1.7)
    shown, hidden = investigate.worth_a_line(ps, {"run_longest_s": 540.0, "level_median": 800.0, "rest_median": 1.7}, 100.0)
    (burst,) = [p for p in shown if p["kind"].startswith("stops and restarts")]
    assert burst["kind"] == "stops and restarts 8 times" and "runs of about" in burst["why"] and burst.get("alert")
    assert hidden == 61                                                    # the 60, and the last ordinary rest


# ---- the charts' context (owner, 2026-10-11: "what does the red background mean? … more graphs to bring more context")
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
    # vesta_shared.restart.RestartDrops): neither restart drop is a reconnect of the device's own, Next Relay's is
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "pm_features", os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "features.py"))
    features = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(features)
    rows = Restarted().logbook(T(9, 2), T(9, 15))
    from vesta_shared import restart
    flips = features.flips_per_day(rows, "UTC", restart.minutes())
    assert "switch.spa" not in flips and "sensor.example_thermometer" not in flips and "switch.next_relay" in flips, flips


def _periods_data(spans):
    """A timeline --out of one device whose unusual periods are `spans`: (kind, start minute, length minutes, why)."""
    t0 = datetime(2026, 10, 14, tzinfo=ZoneInfo("UTC"))
    return {"zone": "UTC", "start": t0.isoformat(), "end": (t0 + timedelta(days=7)).isoformat(),
            "entities": [{"entity_id": "sensor.p", "label": "Pump Power", "periods": [
                {"kind": k, "why": w, "start": (t0 + timedelta(minutes=a)).isoformat(),
                 "end": (t0 + timedelta(minutes=a + n)).isoformat(), "seconds": n * 60} for k, a, n, w in spans]}]}


def test_a_repeated_problem_is_one_row_and_the_finding_after_it_stays_on_the_page():
    # villa, 2026-10-21: 80 rows of a relay's Wi-Fi drops (14-15 Oct) filled the log; the pump's stop-start of 16 Oct,
    # the finding, was cut off
    mod, _ = _facts()
    drops = [("offline", 10 * i, 1 + (i == 7), "it stopped reporting") for i in range(100)]
    bursts = [("stops and restarts 8 times", 3 * 1440 + 60 * i, 10, "runs of about 30s each") for i in range(2)]
    f = mod.facts(_periods_data(drops + bursts), {})
    log = [r["text"] for r in f["log"]]
    assert log[0] == ("Pump Power: 100 times “stopped reporting”, from 14/10/2026 00:00 to 14/10/2026 16:31, the longest "
                      "2min at 14/10/2026 01:10, it stopped reporting")
    assert [x for x in log if x.startswith("Pump Power stopped and restarted 8 times in 10min")] == log[1:]
    assert f["established"] == log                                    # what the AI reads back is what the page says


def test_a_device_unavailable_by_design_never_stops_reporting_in_an_investigation():
    # owner, 2026-10-21: a door contact asleep between its reports — its "unavailable" is not a device that went
    import investigate
    from test_offline import _pack
    pack = _pack()
    got = investigate.around(_Around(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z, pack=pack)["data"]
    assert "Next Relay" in str(got.get("offline"))
    pack.asleep_are(["switch.next_relay"])
    got = investigate.around(_Around(), None, T(9, 2), T(9, 15), ["sensor.heater_power"], Z, pack=pack)["data"]
    assert "Next Relay" not in str(got.get("offline")) and "Next Relay" not in str(got.get("back"))


