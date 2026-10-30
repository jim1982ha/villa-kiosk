"""Rules › Device kinds (owner, 2026-10-28): what each device is, guessed from its name or chosen on the VESTA Agent page
with a drop-down — the choice read by knowledge_pack.asset_kind, so the night check follows it from its next run; the
old helper of the villa's system moved into the page's file once, at the agent's start, and never read again."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest
from helpers import STARTER_SKILLS, settings
from vesta_agent.app import Vesta
from vesta_agent.history import History
from vesta_agent.ui import kinds
from vesta_agent.ui.changes import PageFiles, Refused
from vesta_shared import asset_kinds
from vesta_shared.knowledge_pack import KnowledgePack, build_pack

SLUG = "example_led_strip"
#: a strip whose name says "led": guessed lighting, which the night check never reads
REGISTRY = {"entities": [{"entity_id": f"sensor.{SLUG}_power", "name": "Example LED strip power", "device_id": "d1",
                          "device_class": "power", "unit_of_measurement": "W", "state_class": "measurement"},
                         {"entity_id": "binary_sensor.example_door_opening", "name": "Example door", "device_id": "d2",
                          "device_class": "opening"}]}
OLD = {"entity_id": asset_kinds.OLD_HELPER, "helper_type": "input_text"}


class Reached(Exception):
    """The night check went on to read the device's power: it was not skipped."""


class _Cli:
    def history_read(self, *a, **k):
        raise Reached


def _setup(tmp_path, monkeypatch, helpers=()):
    s = settings(str(tmp_path))
    os.makedirs(s.data_dir, exist_ok=True)
    os.makedirs(s.config_dir, exist_ok=True)
    # a skill script's environment (skills.script_env): the page's file found beside policy.yaml
    monkeypatch.setenv("VESTA_POLICY", s.policy_path)
    with open(s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, list(helpers)).to_json())
    return s, PageFiles(s, History(s.history_path))


def _night_reads_it(monkeypatch, pack_path) -> bool:
    """Whether the night check reads the strip's power tonight (nightly.asset_findings on the pack as a script loads
    it): False when its kind skips it."""
    monkeypatch.syspath_prepend(os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
    import nightly
    from vesta_shared.params import VillaParams
    from vesta_shared.skill_settings import load
    params = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])
    asset = KnowledgePack.load(pack_path).assets[SLUG]
    now = datetime(2026, 10, 28, 1, 30, tzinfo=timezone.utc)
    try:
        found = nightly.asset_findings(_Cli(), None, params, asset, date(2026, 10, 27), now, {}, {}, now, "UTC",
                                       timezone.utc, [])
    except Reached:
        return True
    assert found == ([], 0)
    return False


def test_a_kind_chosen_on_the_page_is_the_one_the_night_check_follows_and_back_to_the_guess(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch)
    card = kinds.rows(s)
    # only a device with a power or energy reading is listed: the door's kind changes nothing
    assert [(r["slug"], r["guess"], r["kind"], r["chosen"]) for r in card["rows"]] == [(SLUG, "lighting", "lighting", False)]
    assert [k for k, _, _ in card["kinds"]] == list(asset_kinds.KINDS)
    assert not _night_reads_it(monkeypatch, s.pack_path)

    # the owner picks Motor: saved at once, recorded, and the night check reads it from its next run (no rebuild)
    card = kinds.save(s, files, SLUG, "motor")
    assert [(r["kind"], r["chosen"]) for r in card["rows"]] == [("motor", True)]
    assert asset_kinds.chosen(s.asset_kinds_path) == {SLUG: "motor"}
    assert _night_reads_it(monkeypatch, s.pack_path)
    (change,) = files.history.rows(5)
    assert change["place"] == "Rules" and change["what"] == "Example LED strip set to Motor (guessed Lighting)"

    # back to the guess: the choice is gone, the night check skips it again
    card = kinds.save(s, files, SLUG, None)
    assert [(r["kind"], r["chosen"]) for r in card["rows"]] == [("lighting", False)]
    assert not _night_reads_it(monkeypatch, s.pack_path)
    assert files.history.rows(5)[0]["what"] == "Example LED strip back to its guess, Lighting"

    # Undo (Overview › Page changes) puts the choice back, through the same writer
    files.undo(files.history.rows(5)[0]["id"])
    assert _night_reads_it(monkeypatch, s.pack_path)


def test_the_page_refuses_a_kind_or_a_device_it_does_not_know(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch)
    with pytest.raises(Refused):
        kinds.save(s, files, SLUG, "pump")
    with pytest.raises(Refused):
        kinds.save(s, files, "example_door", "motor")          # no power, no energy: not on the card
    # a file written by hand with a wrong kind is refused by the writer (Undo, an import), never half read
    with pytest.raises(Refused):
        files.text_change("Rules", "by hand", {"kind": "kinds"}, "kinds:\n  example_led_strip: pump\n")
    assert not os.path.exists(s.asset_kinds_path)


class _Villa:
    """The read-only client as the migration uses it: the old helper's state, or no such helper."""
    def __init__(self, state=None, fails=False):
        self.state, self.fails, self.asked = state, fails, 0

    def not_found(self, ids):
        self.asked += 1
        if self.fails:
            raise TimeoutError("no answer")
        return set() if self.state is not None else set(ids)

    def states(self, ids):
        return {asset_kinds.OLD_HELPER: {"state": self.state}}


class _Agent:
    migrate_asset_kinds = Vesta.migrate_asset_kinds

    def __init__(self, s, villa):
        self.s, self.reader = s, villa


def test_the_old_helper_is_moved_once_at_start_and_never_read_again(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch, [{**OLD, "state": '{"example_led_strip": "meter"}'}])
    # the pack's own build no longer reads the helper: the strip is still guessed lighting
    assert KnowledgePack.load(s.pack_path).assets[SLUG]["kind"] == "lighting"

    # a villa's system that does not answer: nothing written, tried again at the next start
    assert _Agent(s, _Villa(fails=True)).migrate_asset_kinds() is None
    assert not os.path.exists(s.asset_kinds_path)

    # the next start: the owner's value (a bad entry left out) is moved, and said in Page changes
    villa = _Villa('{"example_led_strip": "meter", "example_other": "bogus"}')
    assert _Agent(s, villa).migrate_asset_kinds() == {SLUG: "meter"}
    assert asset_kinds.chosen(s.asset_kinds_path) == {SLUG: "meter"}
    assert KnowledgePack.load(s.pack_path).assets[SLUG]["kind"] == "meter"
    assert [(r["kind"], r["chosen"]) for r in kinds.rows(s)["rows"]] == [("meter", True)]
    (moved,) = files.history.rows(5)
    assert moved["place"] == "Release" and moved["what"] == "Rules › Device kinds: 1 set in the villa's system before, kept here"

    # every later start: the helper is not even asked for, whatever it says now
    later = _Villa('{"example_led_strip": "motor"}')
    assert _Agent(s, later).migrate_asset_kinds() is None and later.asked == 0
    assert asset_kinds.chosen(s.asset_kinds_path) == {SLUG: "meter"}


def test_a_villa_without_the_old_helper_gets_an_empty_file_once(tmp_path, monkeypatch):
    s, files = _setup(tmp_path, monkeypatch)
    assert _Agent(s, _Villa()).migrate_asset_kinds() is None
    assert os.path.exists(s.asset_kinds_path) and asset_kinds.chosen(s.asset_kinds_path) == {}
    assert files.history.rows(5) == []                          # nothing moved, nothing to say
    later = _Villa('{"example_led_strip": "motor"}')
    assert _Agent(s, later).migrate_asset_kinds() is None and later.asked == 0


def test_the_agents_own_start_moves_the_old_helper(tmp_path):
    """Pinned on the caller: the agent's real start() (helpers.restarted), its client holding the old helper."""
    from ha_fake import FakeHA
    from helpers import make_agent, restarted
    villa = make_agent(tmp_path, {"people": []}, telegram_on=False,
                       reader=FakeHA(states={asset_kinds.OLD_HELPER: {"state": '{"example_pump": "motor"}'}}))
    assert not os.path.exists(villa.s.asset_kinds_path)
    restarted(villa)
    assert asset_kinds.chosen(villa.s.asset_kinds_path) == {"example_pump": "motor"}


def test_the_device_kinds_card_says_which_devices_and_explains_in_sections():
    # owner, 2026-10-30: the (i) was "barely understandable and very poorly formatted" (one block of run-on paragraphs),
    # and "where the device list is coming from?": the card says which devices, the (i) is in titled sections with lists
    import os
    from helpers import ROOT
    js = open(os.path.join(ROOT, "vesta_agent", "ui", "static", "rules.js"), encoding="utf-8").read()
    start = js.index("export function kindsCard")
    card = js[start:js.find("\nexport function", start + 1) if js.find("\nexport function", start + 1) > 0 else len(js)]
    for head in ("Which devices are listed", "What the kind changes", "Where the kind comes from", "To correct a kind"):
        assert f'part("{head}"' in card, head
    assert "items(data.kinds.map(kindItem))" in card and '].join(" ")' not in card
    assert "devices that measure their own power or energy" in card and "${data.rows.length}" in card
    assert 'card(place("kinds"), info, which,' in card                         # said on the card, not only behind (i)
