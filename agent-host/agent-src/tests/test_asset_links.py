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
from vesta_agent.places import ORDER, PLACES, TABS
from vesta_agent.ui import links
from vesta_agent.ui.changes import PageFiles, Refused
from vesta_shared import asset_links
from vesta_shared.knowledge_pack import KnowledgePack, build_pack

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
                                               "guess_name": "Example pump plan", "source": "guessed"}
    assert _row(card)["links"]["baseline"]["source"] == "none"
    # the drop-down: the villa's helpers of the link's type, by name
    assert card["options"]["schedule"] == [[OTHER, "Example filtration hours"], [GUESSED, "Example pump plan"]]
    assert card["options"]["baseline"] == [["input_number.example_pump_watts", "Example pump watts"]]
    assert [k for k, *_ in card["roles"]] == list(asset_links.ROLES)
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0                 # the name rule's schedule

    # the owner picks another schedule: saved at once, recorded, and the night check reads it from its next run
    card = links.save(s, files, SLUG, "schedule", OTHER)
    assert _row(card)["links"]["schedule"]["value"] == OTHER and _row(card)["links"]["schedule"]["source"] == "chosen"
    assert asset_links.chosen(s.asset_links_path) == {SLUG: {"schedule": OTHER}}
    (change,) = files.history.rows(5)
    assert change["place"] == "Knowledge" and change["what"] == \
        "Example pool pump: Schedule set to Example filtration hours (guessed Example pump plan)"
    assert KnowledgePack.load(s.pack_path).assets[SLUG]["schedule"] == OTHER
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0

    # None: the link off, whatever the name rule finds; the night check has no hours to expect
    card = links.save(s, files, SLUG, "schedule", "")
    assert _row(card)["links"]["schedule"] == {"value": None, "name": None, "guess": GUESSED,
                                               "guess_name": "Example pump plan", "source": "chosen"}
    assert _expected(monkeypatch, s.pack_path)[0] is None
    assert files.history.rows(5)[0]["what"] == "Example pool pump: Schedule set to None"

    # back to the guess: the choice is gone, the name rule's schedule read again
    card = links.save(s, files, SLUG, "schedule", None)
    assert _row(card)["links"]["schedule"]["source"] == "guessed"
    assert asset_links.chosen(s.asset_links_path) == {}
    assert _expected(monkeypatch, s.pack_path)[0]["monday"] == 4.0
    assert files.history.rows(5)[0]["what"] == "Example pool pump: Schedule back to its guess, Example pump plan"

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
    assert not os.path.exists(s.asset_links_path)


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
    assert asset_links.chosen(s.asset_links_path) == {SLUG: {"schedule": OTHER}}


def test_the_knowledge_tab_holds_every_part_of_the_page_not_kept_in_policy_yaml():
    # owner, 2026-10-30: "the Rule tab exclusively contain feature defined in the policy.yaml file … the other ones
    # moved to another dedicated (single) tab"
    assert list(TABS) == ["overview", "rules", "knowledge", "skills", "costs", "limits"]
    assert ORDER["knowledge"] == ["kinds", "links", "asleep", "translations"]
    assert all(PLACES[k][1] == "Knowledge" for k in ORDER["knowledge"])
    assert not set(ORDER["knowledge"]) & set(ORDER["rules"])
    js = page_js()
    rules = body_of(js, "rulesForms")
    for gone in ("kindsCard", "unavailable_by_design", 'withInfo("Asleep between reports"', "api/translations",
                 "Devices hidden in the villa"):
        assert gone not in rules, gone
    tab = body_of(js, "knowledge")
    assert 'api("GET", "api/knowledge")' in tab and 'tabbed("knowledge", inOrder("knowledge"' in tab
    assert "knowledge, skills" in js                                            # app.js: the tab's view


def test_the_device_links_card_says_which_devices_and_explains_in_sections():
    card = body_of(page_js(), "linksCard")
    for head in ("Which devices are listed", "What each link is used for", "Where a link comes from", "To change a link"):
        assert f'part("{head}"' in card, head
    # each link named, with what it is used for: the agent's words (asset_links.ROLES), never a copy on the page
    assert "items(roles.map((r) => [`${r.name}:`, r.words]))" in card
    for chip in ('"Chosen here"', '"Guessed"', '"None linked"', '"Back to the guess"', '["", "None"]'):
        assert chip in card, chip
    assert '"No schedule linked: the run-hours check is off for it"' in card
    assert 'card(place("links"), info, which,' in card


def test_the_agent_reads_a_link_chosen_since_its_last_look_at_the_pack(tmp_path, monkeypatch):
    """Pinned on the caller: the agent's own pack (Vesta.pack, what its tools read), read again when the page's file
    changes, though the pack itself did not."""
    from helpers import make_agent
    villa = make_agent(tmp_path, {"people": []}, telegram_on=False)
    os.makedirs(os.path.dirname(villa.s.pack_path), exist_ok=True)
    with open(villa.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, HELPERS).to_json())
    assert villa.pack().assets[SLUG]["schedule"] == GUESSED
    links.save(villa.s, PageFiles(villa.s, History(villa.s.history_path)), SLUG, "schedule", OTHER)
    assert villa.pack().assets[SLUG]["schedule"] == OTHER
