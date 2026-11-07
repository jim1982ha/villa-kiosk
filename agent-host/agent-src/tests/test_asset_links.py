"""Knowledge › Device links (owner, 2026-10-30): which helpers of the villa's system belong to each device (its
schedule, its normal power, its run hours), found by their name or chosen on the VESTA Agent page with a drop-down —
the choice read by knowledge_pack.asset_link, so the night check follows it from its next run; "None" switches a link
off, "Back to the guess" takes the choice away. And the Rules tab keeps only what policy.yaml holds: the rest is the
Knowledge tab's."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest
from helpers import STARTER_SKILLS, settings
from test_ui import HDR, call
from vesta_agent.history import History
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


