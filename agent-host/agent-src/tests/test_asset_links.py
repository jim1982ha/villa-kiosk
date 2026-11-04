"""Knowledge › Device links (owner, 2026-10-30): which helpers of the villa's system belong to each device (its
schedule, its normal power, its run hours), found by their name or chosen on the VESTA Agent page with a drop-down —
the choice read by knowledge_pack.asset_link, so the night check follows it from its next run; "None" switches a link
off, "Back to the guess" takes the choice away. And the Rules tab keeps only what policy.yaml holds: the rest is the
Knowledge tab's."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest
from helpers import STARTER_SKILLS, body_of, page_js, settings
from test_ui import HDR, call
from vesta_agent.history import History
from vesta_agent.places import ORDER, PLACES, TABBED, TABS
from vesta_agent.ui import links
from vesta_agent.ui.changes import PageFiles, Refused
from vesta_shared import asset_links
from vesta_shared.choice_files import BY_KIND
from vesta_shared.knowledge_pack import KnowledgePack, build_pack
from vesta_agent.roster import Roster

SLUG = "example_pool_pump"
GUESSED = f"schedule.{SLUG}_expected_runtime"          # the name rule's schedule
OTHER = "schedule.example_filtration_hours"             # a schedule named any other way: never found by its name
BLOCKS = {"monday": [{"from": "08:00:00", "to": "12:00:00"}], "tuesday": [{"from": "08:00:00", "to": "12:00:00"}]}
REGISTRY = {"entities": [
    {"entity_id": f"sensor.{SLUG}_power", "name": "Example pool pump power", "device_id": "d1", "device_class": "power",
     "unit_of_measurement": "W", "state_class": "measurement"},
    {"entity_id": "binary_sensor.example_door_opening", "name": "Example door", "device_id": "d2",
     "device_class": "opening"},
    {"entity_id": GUESSED, "name": "Example pump plan"},
    {"entity_id": OTHER, "name": "Example filtration hours"},
    {"entity_id": "input_number.example_pump_watts", "name": "Example pump watts"}]}
HELPERS = [{"entity_id": GUESSED, "helper_type": "schedule", **BLOCKS},
           {"entity_id": OTHER, "helper_type": "schedule", **BLOCKS},
           {"entity_id": "input_number.example_pump_watts", "helper_type": "input_number"}]


class _NoFindings:
    """A store with no open finding."""
    def open_finding(self, *a):
        return None


def _setup(tmp_path, monkeypatch, helpers=HELPERS):
    s = settings(str(tmp_path))
    os.makedirs(s.data_dir, exist_ok=True)
    os.makedirs(s.config_dir, exist_ok=True)
    # a skill script's environment (skills.script_env): the page's file found beside policy.yaml
    monkeypatch.setenv("VESTA_POLICY", s.policy_path)
    with open(s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, list(helpers)).to_json())
    return s, PageFiles(s, History(s.history_path))


def _expected(monkeypatch, pack_path):
    """The hours the night check expects the pump to run (nightly.asset_findings on the pack as a script loads it, its
    day rules caught): None when its run-hours check is off; and the notes it wrote."""
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import nightly
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    seen = {}

    def power_rules(asset, eid, p_series, today, params, expected, *rest):
        seen["expected"] = expected
        return []
    monkeypatch.setattr(nightly.R, "power_rules", power_rules)
    params = VillaParams(helpers=HELPERS,
                         defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    asset = KnowledgePack.load(pack_path).assets[SLUG]
    now = datetime(2026, 10, 28, 1, 30, tzinfo=timezone.utc)
    notes: list[str] = []
    nightly.asset_findings(None, _NoFindings(), params, asset, date(2026, 10, 27), now, {}, {}, now, "UTC", timezone.utc, notes,
                           skip_raw=True, write_features=False)
    return seen["expected"], notes


def _row(card):
    return next(r for r in card["rows"] if r["slug"] == SLUG)


def test_a_schedule_chosen_on_the_page_is_the_one_the_night_check_reads_none_switches_it_off_and_back(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch)
    card = links.rows(s)
    # only devices with a power or energy reading, or a link: the door has neither
    assert [r["slug"] for r in card["rows"]] == [SLUG]
    assert _row(card)["links"]["schedule"] == {"value": GUESSED, "name": "Example pump plan", "guess": GUESSED,
                                               "guess_name": "Example pump plan", "source": "guessed", "gone": False}
    assert _row(card)["links"]["baseline"]["source"] == "none"
    # the drop-down: the villa's helpers of the link's type, by name
    assert card["options"]["schedule"] == [[OTHER, "Example filtration hours"], [GUESSED, "Example pump plan"]]
    assert card["options"]["baseline"] == [["input_number.example_pump_watts", "Example pump watts"]]
    assert [k for k, *_ in card["roles"]] == list(asset_links.ROLES)
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0                 # the name rule's schedule

    # the owner picks another schedule: saved at once, recorded, and the night check reads it from its next run
    card = links.save(s, files, SLUG, "schedule", OTHER)
    assert _row(card)["links"]["schedule"]["value"] == OTHER and _row(card)["links"]["schedule"]["source"] == "chosen"
    assert BY_KIND["links"].chosen(s.config_dir) == {SLUG: {"schedule": OTHER}}
    (change,) = files.history.rows(5)
    assert change["place"] == "Knowledge" and change["what"] == \
        "Example pool pump: Schedule set to Example filtration hours (found by name: Example pump plan)"
    assert KnowledgePack.load(s.pack_path).assets[SLUG]["schedule"] == OTHER
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0

    # None: the link off, whatever the name rule finds; the night check has no hours to expect
    card = links.save(s, files, SLUG, "schedule", "")
    assert _row(card)["links"]["schedule"] == {"value": None, "name": None, "guess": GUESSED,
                                               "guess_name": "Example pump plan", "source": "chosen", "gone": False}
    assert _expected(monkeypatch, s.pack_path)[0] is None
    assert files.history.rows(5)[0]["what"] == "Example pool pump: Schedule set to None"

    # back to the guess: the choice is gone, the name rule's schedule read again
    card = links.save(s, files, SLUG, "schedule", None)
    assert _row(card)["links"]["schedule"]["source"] == "guessed"
    assert BY_KIND["links"].chosen(s.config_dir) == {}
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0
    assert files.history.rows(5)[0]["what"] == "Example pool pump: Schedule back to the one found, Example pump plan"

    # Undo (Overview › Page changes) puts the None back, through the same writer
    files.undo(files.history.rows(5)[0]["id"])
    assert _expected(monkeypatch, s.pack_path)[0] is None


def test_a_schedule_named_otherwise_is_read_only_once_linked(tmp_path, monkeypatch):
    # the villa's case: no schedule by the name rule, so nothing linked and the run-hours check off, until chosen
    s, files = _setup(tmp_path, monkeypatch, helpers=HELPERS[1:])
    assert _row(links.rows(s))["links"]["schedule"]["source"] == "none"
    assert _expected(monkeypatch, s.pack_path)[0] is None
    links.save(s, files, SLUG, "schedule", OTHER)
    assert _expected(monkeypatch, s.pack_path)[0]["tuesday"] == 4.0
    # a chosen schedule also marks a motor in the kind guess (guessed_kind reads the pack's links)
    assert KnowledgePack.load(s.pack_path).assets[SLUG]["kind"] == "motor"
    # ...and Device kinds says it came from that link, never "Found by name" (architecture review 20, card 4)
    from vesta_agent.ui import kinds
    (row,) = [r for r in kinds.rows(s)["rows"] if r["slug"] == SLUG]
    assert (row["guess"], row["source"], row["link"]) == ("motor", "link", "Schedule")


def test_a_chosen_normal_power_is_the_one_the_running_threshold_reads(tmp_path, monkeypatch):
    from vesta_shared import daily
    from vesta_shared.params import VillaParams
    s, files = _setup(tmp_path, monkeypatch)
    params = VillaParams(helpers=HELPERS, states={"input_number.example_pump_watts": "1000"},
                         defaults={"on_threshold_fraction": 0.5, "on_threshold_floor_w": 5})
    asset = lambda: KnowledgePack.load(s.pack_path).assets[SLUG]               # noqa: E731
    assert daily.running_threshold(asset(), [], params) == 5                    # no normal power: the floor
    links.save(s, files, SLUG, "baseline", "input_number.example_pump_watts")
    assert daily.running_threshold(asset(), [], params) == 500


def test_the_page_refuses_a_link_a_helper_or_a_device_it_does_not_know(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch)
    with pytest.raises(Refused):
        links.save(s, files, SLUG, "timer", OTHER)                              # not a link
    with pytest.raises(Refused):
        links.save(s, files, SLUG, "schedule", "input_number.example_pump_watts")   # not a schedule
    with pytest.raises(Refused):
        links.save(s, files, SLUG, "schedule", "schedule.example_not_there")
    with pytest.raises(Refused):
        links.save(s, files, "example_door", "schedule", OTHER)                 # not on the card
    # a file written by hand with a wrong helper is refused by the writer (Undo, an import), never half read
    with pytest.raises(Refused):
        files.text_change("Knowledge", "by hand", {"kind": "links"},
                          asset_links.HEADER + f"links:\n  {SLUG}:\n    schedule: input_number.x\n")
    assert asset_links.parse(f"links:\n  {SLUG}:\n    schedule: input_number.x\n    counter: ''\n") == \
        {SLUG: {"counter": ""}}
    assert not os.path.exists(s.choice_path("links"))


def test_a_link_is_chosen_through_the_page_and_the_knowledge_tab_shows_it(tmp_path, monkeypatch):
    s, _ = _setup(tmp_path, monkeypatch)

    async def fn(c):
        r = await c.put("/api/links", json={"slug": SLUG, "role": "schedule", "value": OTHER}, headers=HDR)
        put = (r.status, await r.json())
        bad = (await c.put("/api/links", json={"slug": SLUG, "role": "schedule", "value": 0}, headers=HDR)).status
        tab = await (await c.get("/api/knowledge", headers=HDR)).json()
        return put, bad, tab
    (status, body), bad, tab = call(s, fn)
    assert status == 200 and _row(body)["links"]["schedule"]["source"] == "chosen" and bad == 400
    assert _row(tab["links"])["links"]["schedule"]["value"] == OTHER
    assert BY_KIND["links"].chosen(s.config_dir) == {SLUG: {"schedule": OTHER}}


def test_the_knowledge_tab_holds_every_part_of_the_page_not_kept_in_policy_yaml():
    # owner, 2026-10-30: "the Rule tab exclusively contain feature defined in the policy.yaml file … the other ones
    # moved to another dedicated (single) tab"
    assert list(TABS) == ["overview", "rules", "knowledge", "skills", "costs", "limits"]
    # owner, 2026-10-31: Asleep between reports and Translations are cards above the tabs, Device kinds and Device links
    # the only tabs of the tabbed section, under them
    assert ORDER["knowledge"] == ["asleep", "translations", "kinds", "links"]
    assert TABBED["knowledge"] == ["kinds", "links"]
    assert all(PLACES[k][1] == "Knowledge" for k in ORDER["knowledge"])
    assert not set(ORDER["knowledge"]) & set(ORDER["rules"])
    js = page_js()
    rules = body_of(js, "rulesForms")
    for gone in ("kindsCard", "unavailable_by_design", 'withInfo("Asleep between reports"', "api/translations",
                 "Devices hidden in the villa"):
        assert gone not in rules, gone
    tab = body_of(js, "knowledge")
    assert 'api("GET", "api/knowledge")' in tab
    # the tabbed section holds the tabs places.TABBED names, drawn where the first of them sits in the order; every
    # other section is its own card, drawn in the order too
    assert 'const inTabs = tabbedIn("knowledge");' in tab
    assert 'tabbed("knowledge", inTabs.map((k) => [k, place(k), null, cards[k]]))' in tab
    assert "[k, !inTabs.includes(k) ? cards[k]() : k === inTabs[0] ? [probs, t.bar, t.body] : null]" in tab
    assert '...inOrder("knowledge", sections));' in tab
    assert "export const tabbedIn = (tab) => PAGE.tabbed?.[tab] || [];" in js
    assert "knowledge, skills" in js                                            # app.js: the tab's view


def test_the_device_links_card_says_which_devices_and_explains_in_sections():
    card = body_of(page_js(), "linksCard")
    for head in ("Which devices are listed", "What each link is used for", "Where a link comes from", "To change a link"):
        assert f'part("{head}"' in card, head
    # each link named, with what it is used for: the agent's words (asset_links.ROLES), never a copy on the page
    assert "items(roles.map((r) => [`${r.name}:`, r.words]))" in card
    # one set of words with Device kinds (owner, 2026-11-04: "hardly understandable")
    for chip in ('"Set by you"', '"Found by name"', '"Use the one found"', '["", "None"]', '"—"'):
        assert chip in card, chip
    for gone in ("Guessed", "Chosen here", "None linked", "Back to the guess", "(guess)"):
        assert gone not in card, gone
    # read first: one line per device, its drop-downs only for the device being changed (Set / Change, then Done)
    assert 'editing ? editCell(r, role) : readCell(r, role)' in card
    assert 'editing ? "Done" : r.links.schedule?.value || r.gone ? "Change" : "Set"' in card
    # each column its own (i), the link's own words
    assert 'const head = ["Device", ...roles.map((r) => withInfo(r.name, r.words)), ""];' in card
    # which devices have their run-hours check off: the agent's answer (rows' run_hours), driven in
    # test_the_page_files_a_device_by_the_night_checks_own_verdict
    assert 'card(place("links"), info, which,' in card


def test_the_agent_reads_a_link_chosen_since_its_last_look_at_the_pack(tmp_path, monkeypatch):
    """Pinned on the caller: the agent's own pack (Vesta.pack, what its tools read), read again when the page's file
    changes, though the pack itself did not."""
    from helpers import make_agent
    villa = make_agent(tmp_path, {}, roster=Roster.of(), telegram_on=False)
    os.makedirs(os.path.dirname(villa.s.pack_path), exist_ok=True)
    with open(villa.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, HELPERS).to_json())
    assert villa.pack().assets[SLUG]["schedule"] == GUESSED
    links.save(villa.s, PageFiles(villa.s, History(villa.s.history_path)), SLUG, "schedule", OTHER)
    assert villa.pack().assets[SLUG]["schedule"] == OTHER


# ---- architecture review 20: the run-hours check is the night check's one verdict (card 2), a helper gone from the
# villa is said (card 3), and a save's sentence is the one recorded (card 6)
def _night(tmp_path, s, helpers, registry=REGISTRY) -> dict:
    """The real night check (nightly.py, as the agent runs it) over a villa holding `helpers`, on the page's pack and
    store: its result."""
    import json
    import subprocess
    import sys
    from helpers import PYTHONPATH
    fx = tmp_path / "fx"
    fx.mkdir(exist_ok=True)
    (fx / "helpers.json").write_text(json.dumps({"helpers": helpers, "states": {}}))
    (fx / "registry.json").write_text(json.dumps(registry))
    (fx / "states.json").write_text(json.dumps({"states": {}}))
    r = subprocess.run([sys.executable, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts", "nightly.py"),
                        "--pack", s.pack_path, "--store", s.store_path, "--fixture-dir", str(fx), "--skip-raw",
                        "--out", str(tmp_path / "res.json")],
                       capture_output=True, text=True, env={**os.environ, "PYTHONPATH": PYTHONPATH}, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads((tmp_path / "res.json").read_text())


def test_the_page_files_a_device_by_the_night_checks_own_verdict(tmp_path, monkeypatch):
    # the villa's case (review 20, card 2): a schedule linked, so the page said "Schedule linked", while the night check
    # had the run-hours check off (here: its schedule has no time blocks)
    empty = [{"entity_id": GUESSED, "helper_type": "schedule", "name": "Example pump plan"}, *HELPERS[1:]]
    s, files = _setup(tmp_path, monkeypatch, helpers=empty)
    # before any night: what can be judged without the villa, a schedule linked and among the villa's helpers
    assert _row(links.rows(s))["run_hours"] == {"on": True, "why": "Judged against Example pump plan.", "at": None}
    res = _night(tmp_path, s, empty)
    assert "Example pool pump: run-hours check off. Example pump plan has no time blocks." in res["notes"]
    got = _row(links.rows(s))["run_hours"]
    assert (got["on"], got["why"]) == (False, "Example pump plan has no time blocks.") and got["at"]
    # a link chosen since the night: that verdict is out of date, the page judges what it can again
    links.save(s, files, SLUG, "schedule", OTHER)
    assert _row(links.rows(s))["run_hours"] == {"on": True, "why": "Judged against Example filtration hours.", "at": None}
    _night(tmp_path, s, empty)
    assert _row(links.rows(s))["run_hours"]["on"] is True and _row(links.rows(s))["run_hours"]["at"]
    # a kind never judged, said as such, the night not needed
    files.text_change("Knowledge", "by test", {"kind": "kinds"}, f"kinds:\n  {SLUG}: lighting\n")
    assert _row(links.rows(s))["run_hours"] == {
        "on": False, "why": "Its kind is Lighting: its run hours are never judged (Device kinds).", "at": None}


def test_a_schedule_gone_from_the_villa_is_said_on_its_line_and_by_the_night_check(tmp_path, monkeypatch):
    # review 20, card 3: a schedule deleted or renamed in the villa showed as its raw id, "Set by you", under Schedule
    # linked, and the night check stopped judging it without a word
    s, files = _setup(tmp_path, monkeypatch)
    links.save(s, files, SLUG, "schedule", OTHER)
    links.save(s, files, SLUG, "baseline", "input_number.example_pump_watts")
    assert not _row(links.rows(s))["links"]["schedule"]["gone"]
    # the villa's system no longer has them: the pack rebuilt without
    gone = (OTHER, "input_number.example_pump_watts")
    left = [h for h in HELPERS if h["entity_id"] not in gone]
    registry = {"entities": [e for e in REGISTRY["entities"] if e["entity_id"] not in gone]}
    with open(s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(registry, left).to_json())
    row = _row(links.rows(s))
    assert row["links"]["schedule"]["gone"] and row["links"]["baseline"]["gone"]
    assert row["links"]["schedule"]["value"] == OTHER and not row["links"]["counter"]["gone"]
    assert row["run_hours"] == {"on": False, "why": f"{OTHER} is no longer in the villa's system.", "at": None}
    notes = _night(tmp_path, s, left, registry)["notes"]
    assert f"Example pool pump: run-hours check off. {OTHER} is no longer in the villa's system." in notes
    assert any(n.startswith("Example pool pump: its Normal power input_number.example_pump_watts is no longer in the "
                            "villa's system") for n in notes)
    assert _row(links.rows(s))["run_hours"]["at"]


def test_a_save_answers_the_sentence_it_recorded_and_a_gone_devices_remove_says_removed(tmp_path, monkeypatch):
    # review 20, card 6: Remove on a "No longer found" device was recorded "back to the one found, none found" and the
    # page toasted words of its own; the page now toasts the answer's `what`, the line Page changes keeps
    from vesta_agent.ui import kinds
    s, files = _setup(tmp_path, monkeypatch)
    files.text_change("Knowledge", "by test", {"kind": "links"},
                      asset_links.text_of({"example_gone_pump": {"schedule": OTHER}}))
    card = links.save(s, files, "example_gone_pump", "schedule", None)
    assert card["what"] == "example_gone_pump: Schedule removed" == files.history.rows(5)[0]["what"]
    assert all(r["slug"] != "example_gone_pump" for r in card["rows"])
    card = links.save(s, files, SLUG, "schedule", "")
    assert card["what"] == "Example pool pump: Schedule set to None" == files.history.rows(5)[0]["what"]
    card = kinds.save(s, files, SLUG, "appliance")
    assert card["what"] == files.history.rows(5)[0]["what"] == "Example pool pump set to Appliance (guessed Motor)"
