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

# ── the sentence ─────────────────────────────────────────────────────────────

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


