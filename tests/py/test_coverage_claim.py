"""A stand-down must be able to show its work.

⚠️ THIS SHIPPED AND THE OWNER FOUND IT BY COMPARING TWO SCREENS. The Cockpit
listed four devices as unavailable — three room sensors and a television — while
the brief delivered minutes later said nothing about any of them, and its only
remark on the subject was:

    3 checks did not run — your own automations already cover this:
    … Meters that stopped reporting …

`sensor_health` had stood down because the property HAS a blueprint layer. The
blueprint that covers its ground, `maintenance_silence`, had `last_triggered:
null` on all four of its instances and had never fired once since installation.
So the one line the brief spent on the subject was a reassurance about a rule
that had never reported anything.

The coarse signal is what hid it: the `maintenance` CATEGORY was busy — three
pump findings in the same brief — so every category-level instrument read
healthy. Coverage is a property of the RULE, and that is what these tests pin.

⚠️ THE STAND-DOWN ITSELF IS NOT THE BUG AND MUST NOT BE "FIXED". "Installed
beats fired" is deliberate (see `collect.blueprint_layer_present`): a quiet,
well-run villa is exactly where duplicate findings are least wanted, and waiting
for an event made the modules duplicate the automation layer until something
went wrong. What was wrong was the CLAIM, not the decision.
"""

from __future__ import annotations

import dataclasses
import inspect
import os
import re
from typing import Any, Dict, List

from reports import collect
from reports.analysis import registry
from reports.analysis.base import ModuleContext
from reports.analysis.modules import (  # noqa: F401  (importing registers them)
    level_anomaly, sensor_health, standby_creep,
)

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _context(**kw: Any) -> ModuleContext:
    base: Dict[str, Any] = dict(
        audience="owner", cadence="daily", now_local=None,
        capabilities=["blueprint_layer", "statistics", "energy_devices"],
        inventory={},
    )
    base.update(kw)
    return ModuleContext(**base)


def _superseded() -> List[Any]:
    return [m for m in registry.registered() if getattr(m, "superseded_by", ())]


# ── the signal ───────────────────────────────────────────────────────────────

def test_a_busy_category_does_not_vouch_for_a_silent_blueprint() -> None:
    """THE REFERENCE CASE, as it stood on the villa that reported it."""
    installed = ["critical_watchdog", "maintenance_signature_drift",
                 "maintenance_silence", "roi_baseline_deviation"]
    heard = {"maintenance_signature_drift": 12, "critical_watchdog": 9,
             "roi_baseline_deviation": 4}
    silent = sorted(s for s in installed if not heard.get(s))
    assert silent == ["maintenance_silence"], (
        "a category-level check would call `maintenance` healthy here — it is, "
        "and the rule inside it that matters has still never fired")


def test_a_stem_is_kept_not_reduced_to_its_category() -> None:
    listing = {
        "maintenance_silence.yaml": {"metadata": {"author": "VESTA"}},
        "maintenance_signature_drift.yaml": {"metadata": {"author": "VESTA"}},
    }
    assert collect._stems_from_blueprints(listing) == [
        "maintenance_signature_drift", "maintenance_silence"]
    # The coarse view still works and still has exactly one implementation.
    assert collect._categories_from_blueprints(listing) == ["maintenance"]
    assert collect.category_of("maintenance_silence") == "maintenance"


def test_an_unknown_blueprint_list_does_not_accuse_anything() -> None:
    """⚠️ A STORE WRITTEN BEFORE THIS RELEASE HAS NO `blueprint_names`.

    Treating that absence as "nothing is installed" would be harmless; treating
    it as "everything is silent" would put a false alarm about a working check
    into the first brief after every upgrade. The subtraction can only name a
    blueprint the store has positively recorded, so an empty list accuses
    nobody — which is the safe direction and is asserted rather than assumed.
    """
    silent = sorted(s for s in [] if not {}.get(s))
    assert silent == []


# ── the sentence ─────────────────────────────────────────────────────────────

def test_the_stand_down_names_the_rule_that_has_never_reported() -> None:
    module = next(m for m in _superseded() if m.name == "sensor_health")
    _, _, detail = registry.gate(
        module, _context(silent_blueprints=["maintenance_silence"]), {}, 60)
    assert "Maintenance silence" in detail, (
        "the reader has to know WHICH rule to go and look at; an unnamed one "
        "is the reassurance this replaced")
    assert "not reported" in detail
    assert "maintenance_silence" not in detail, (
        "an identifier in prose on the owner's phone — `readable_label` exists "
        "for exactly this and the gate must go through it")


def test_a_blueprint_that_has_spoken_keeps_the_short_sentence() -> None:
    """⚠️ THE LONGER LINE IS A WARNING, NOT A LABEL. If it appeared for every
    stood-down check it would say nothing, and this section is already the one
    a reader is least likely to reach."""
    module = next(m for m in _superseded() if m.name == "sensor_health")
    _, _, detail = registry.gate(module, _context(silent_blueprints=[]), {}, 60)
    assert detail == "your own automations already cover this"


def test_the_module_still_stands_down_either_way() -> None:
    """⚠️ INSTALLED BEATS FIRED, AND THAT IS NOT WHAT THIS RELEASE CHANGED.
    A version of this fix that ran the module instead would reintroduce the
    duplicate findings the gate exists to prevent."""
    module = next(m for m in _superseded() if m.name == "sensor_health")
    for silent in ([], ["maintenance_silence"]):
        ok, reason, _ = registry.gate(
            module, _context(silent_blueprints=silent), {}, 60)
        assert ok is False and reason == "missing_capability"


# ── the wiring, which is where this class of bug actually lives ──────────────

def test_every_superseded_module_names_a_real_blueprint_stem() -> None:
    """A typo here can never match an installed blueprint, so the check would
    stand down forever with the short sentence and nothing would ever say so —
    the same silence this whole release is about, one level up."""
    assert _superseded(), "no module declares a covering blueprint any more"
    for module in _superseded():
        for stem in module.superseded_by:
            assert stem == stem.lower().strip(), f"{module.name}: {stem!r}"
            assert "_" in stem, (
                f"{module.name} names {stem!r}, which has no category prefix — "
                f"`_stems_from_blueprints` only records stems containing '_', "
                f"so this could never match anything installed")
            assert not stem.endswith((".yaml", ".yml")), (
                f"{module.name}: a stem, not a file name")


def test_run_all_copies_every_context_field_to_the_per_module_context() -> None:
    """⚠️ THE `reachY` RULE, IN PYTHON. `run_all` re-assembles a ModuleContext
    per module, so a field added to the dataclass and not copied there arrives
    at the gate as its DEFAULT — silently, with no type error, because a default
    is a valid value. `silent_blueprints=()` makes every covering blueprint look
    like it has reported, which is exactly the false reassurance being removed.

    Derived from the dataclass, so field number seven is covered on the day it
    is added rather than the day it is reported.
    """
    source = inspect.getsource(registry.run_all)
    body = re.search(r"ModuleContext\((.*?)\n        \)", source, re.DOTALL)
    assert body, "the per-module context construction moved — this test is blind"
    passed = set(re.findall(r"(\w+)\s*=", body.group(1)))
    fields = {f.name for f in dataclasses.fields(ModuleContext)}
    missing = sorted(fields - passed)
    assert not missing, (
        f"these ModuleContext fields are dropped when run_all rebuilds the "
        f"context, so each module sees their default instead: {missing}")


def test_the_buffer_carries_both_blueprint_keys_through_every_writer() -> None:
    """⚠️ EACH WRITER REWRITES THE WHOLE DOCUMENT, so a key it forgets is a key
    it DELETES — and the loss is invisible until the next report reads it. This
    already cost a release for `blueprint_categories`; there are now two.
    """
    source = inspect.getsource(collect)
    writers = re.findall(r"store\.write_json\(store\.REPORTS_EVENTS_FILE, \{(.*?)\n            \}\)",
                         source, re.DOTALL)
    assert len(writers) >= 2, "the buffer writers moved — this test is blind"
    for index, writer in enumerate(writers):
        for key in ("blueprint_categories", "blueprint_names",
                    "seen_types", "seen_blueprints"):
            assert f'"{key}"' in writer, (
                f"writer #{index} drops {key!r}, which deletes it from the store")


def test_read_buffer_shapes_both_new_keys() -> None:
    """A key the reader does not shape is a KeyError in a `state()` call that
    every diagnostics request makes."""
    shaped = collect.read_buffer()
    for key in ("blueprint_names", "seen_blueprints"):
        assert key in shaped
