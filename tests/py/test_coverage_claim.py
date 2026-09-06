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

from vesta.adapters import collect
from vesta.brief import registry
from vesta.shared.analysis.base import ModuleContext
from vesta.brief import registry as _registry
from vesta.shared.analysis.modules import (  # noqa: F401
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


# ── the wiring, which is where this class of bug actually lives ──────────────

def test_superseded_by_is_a_RECORD_and_nothing_joins_it() -> None:
    """⚠️ THIS ASSERTED AN INVARIANT ABOUT A COMPARISON NOBODY PERFORMS.

    It required every stem to contain `"_"` because "`_stems_from_blueprints`
    only records stems containing '_', so this could never match anything
    installed" — a true statement about a join that no code makes. Nothing in
    `rootfs/` reads `superseded_by` at all: `registry.gate` refuses on
    `requires`, `settings["enabled"]`, `failures`, `min_days` and `audiences`,
    and its own comment says the field "survives on the modules as the record
    of which retired blueprint each check replaced".

    So the shape rules are gone and the RECORD is what is checked: a stem must
    still be a stem (lowercase, trimmed, not a filename), because it is read by
    a person tracing what a check replaced. If it is ever joined to
    `collect._stems_from_blueprints` again, the matching rule comes back WITH
    the code that does the matching — that is where it can be true.
    """
    assert _superseded(), "no module declares a covering blueprint any more"
    for module in _superseded():
        for stem in module.superseded_by:
            assert stem == stem.lower().strip(), (
                "%s: %r is not written as a stem" % (module.name, stem))
            assert not stem.endswith((".yaml", ".yml")), (
                f"{module.name}: a stem, not a file name")


def test_nothing_joins_superseded_by_to_the_installed_blueprints() -> None:
    """⚠️ THE PREMISE OF THE TEST ABOVE, CHECKED. If a join appears, the shape
    rules it needs are real again and belong beside it — and this test is what
    should fail to say so, rather than the record quietly acquiring a
    requirement nothing enforces."""
    import re
    import subprocess

    from conftest import strip_prose

    joined = []
    out = subprocess.run(["git", "ls-files", "rootfs"], cwd=REPO_ROOT,
                         capture_output=True, text=True).stdout.split()
    for rel in out:
        if not rel.endswith(".py"):
            continue
        try:
            text = open(f"{REPO_ROOT}/{rel}", encoding="utf-8").read()
        except OSError:
            continue
        try:
            code = strip_prose(text)
        except SyntaxError:                        # pragma: no cover
            code = text
        for n, line in enumerate(code.splitlines(), 1):
            # ⚠️ A READ, NOT A DECLARATION. `superseded_by: Sequence[str]` on
            # the Protocol and `superseded_by = (...)` on the five modules are
            # what the record IS; only an attribute access consumes it. My
            # first pattern matched the declarations and reported the record as
            # its own join.
            if re.search(r"\.superseded_by\b"
                         r"|getattr\([^,]+,\s*[\"']superseded_by[\"']", line):
                joined.append("%s:%d" % (rel, n))
    assert not joined, (
        "`superseded_by` is read by shipped code again: %s.\nIt is a record, "
        "not an input — if it is being matched against installed blueprints "
        "once more, the stem-shape rules belong beside the code that matches "
        "them, where they can be true." % joined)


def test_run_all_cannot_drop_a_context_field() -> None:
    """⚠️ THE `reachY` RULE, IN PYTHON — AND IT IS STRUCTURAL NOW (2.953.0).

    `run_all` used to re-assemble a ModuleContext field by field under a comment
    describing the hazard that created: "a field added to the dataclass and not
    copied HERE arrives at the gate as its DEFAULT — silently, with no type
    error, because the default is a valid value." `ModuleContext` grew three
    fields in tracked history and each had to be remembered there.

    `dataclasses.replace` copies by construction, so this asserts the SHAPE
    rather than enumerating fields — and then proves it, because a source check
    alone would pass for a `replace` whose result nobody used.
    """
    import asyncio

    source = inspect.getsource(registry.run_all)
    assert "replace(" in source, (
        "run_all builds the per-module context by hand again, so a new field "
        "silently arrives at the gate as its default")
    assert not re.search(r"ModuleContext\(", source), (
        "run_all constructs a ModuleContext by enumeration again")

    # And behaviourally: a value set on the outer context must reach the module.
    seen: dict = {}

    # ⚠️ SUBCLASSED FROM A SHIPPED MODULE, not hand-built. The gate reads a
    # dozen attributes and a hand-rolled double drifts from the Protocol the
    # moment one is added — which is the same defect this test guards.
    from vesta.shared.analysis.modules.sensor_health import SensorHealth

    class Spy(SensorHealth):                      # type: ignore[misc]
        name = "spy"
        requires = ()                             # no capability gate
        min_days = 0                              # no history gate
        audiences = ("owner", "facility")         # no audience gate

        async def run(self, context):             # type: ignore[override]
            seen["labels"] = dict(context.labels)
            seen["min_history_days"] = context.min_history_days
            return []

    context = ModuleContext(
        audience="owner", cadence="daily", now_local=None,
        capabilities=(), inventory={},
        labels={"sensor.a": "A name"}, min_history_days=41)

    # ⚠️ THE CLEANUP HERE WAS A NO-OP FOR THE LIFE OF THIS TEST.
    # `registry.registered().remove(...)` mutates the list `registered()` just
    # built and returns; `_REGISTRY["spy"]` was never touched, so a fake check
    # that passes every arm of the gate ran in every later pass in the session.
    # `conftest._analysis_registry_is_restored` now puts the registry back
    # after every test, so this needs no cleanup of its own — but registering
    # inside the fixture's window is the point, not an accident.
    registry.register(Spy())
    asyncio.run(registry.run_all(context, {}, 999))

    assert seen.get("labels") == {"sensor.a": "A name"}, seen
    assert seen.get("min_history_days") == 41, seen


def test_each_module_gets_its_OWN_rejection_list() -> None:
    """⚠️ MODULES ARE LONG-LIVED SINGLETONS. The recorder used to be an
    attribute on the instance, cleared only INSIDE `run()`, so a module gated
    out this pass served its PREVIOUS pass's rejections as this one's
    diagnostic — and for an instrument that exists to tell "the threshold
    suppressed everything" from "nothing is wrong", a stale reading is worse
    than none."""
    context = ModuleContext(audience="owner", cadence="daily", now_local=None,
                            capabilities=(), inventory={})
    assert context.rejected == []
    context.rejected.append({"reason": "x"})
    fresh = ModuleContext(audience="owner", cadence="daily", now_local=None,
                          capabilities=(), inventory={})
    assert fresh.rejected == [], (
        "the default is shared between contexts, so one pass can see another's")


