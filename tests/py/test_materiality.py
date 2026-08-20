"""Does a change matter? The rule that had to be learned twice.

⚠️ `standby_creep` learned it from a true, confident 869% that was worth eight
watts. The fix was made THERE and nowhere else — and the very next module
produced twelve findings on its first live run, topping out at 715,700%. Same
defect, same property, one module later, because the rule was rolled out by
call site instead of by what it applies to.

These tests are against the SHARED module, so a third one inherits the rule by
importing rather than by remembering.
"""

from __future__ import annotations

from typing import List

from reports.analysis.materiality import (
    active_level,
    has_stable_baseline,
    is_material,
)


# ── is it real? ──────────────────────────────────────────────────────────────

def test_a_trivial_change_on_a_hard_working_device_is_immaterial() -> None:
    """The 869%/eight-watt case, in the shared form."""
    pump = [0.5] * 20 + [0.0009] * 8       # works hard, rests near zero
    assert is_material(0.008, pump) is False


def test_a_real_change_on_the_same_device_is_material() -> None:
    pump = [0.5] * 20 + [0.0009] * 8
    assert is_material(0.20, pump) is True


def test_materiality_is_scale_free() -> None:
    """⚠️ A 40 W router and a 3 kW heat pump must be judged identically —
    otherwise the rule is a wattage wearing a disguise."""
    small = [0.05] * 20 + [0.001] * 8
    large = [50.0] * 20 + [1.0] * 8
    assert is_material(0.0005, small) == is_material(0.5, large)
    assert is_material(0.02, small) == is_material(20.0, large)


def test_an_uncharacterisable_device_is_not_silently_suppressed() -> None:
    """Passing on unknown is deliberate: a device we cannot describe should be
    judged by the other tests, not quietly dropped."""
    assert is_material(1.0, []) is True
    assert is_material(1.0, [0.0, 0.0]) is True


def test_active_level_is_the_working_level_not_the_average() -> None:
    """A device idle most of the time still has a working level."""
    mostly_idle = [0.001] * 18 + [1.0] * 6
    level = active_level(mostly_idle)
    assert level is not None and level > 0.1, level


# ── is there a normal? ───────────────────────────────────────────────────────

def test_intermittent_equipment_has_no_baseline() -> None:
    """⚠️ THE 715,700% CASE. A jacuzzi used on roughly one Friday in four has a
    Friday median near zero and a spread the size of its own range. Every
    Friday it runs is thousands of percent above "normal" — true, and not an
    anomaly: it is the device doing what it does."""
    fridays = [0.0, 0.0, 0.0, 8.0, 0.0, 0.0, 9.0, 0.0]
    assert has_stable_baseline(fridays) is False


def test_regular_equipment_has_a_baseline() -> None:
    assert has_stable_baseline([4.0, 4.2, 3.9, 4.1, 4.05, 3.95]) is True


def test_a_perfectly_consistent_device_has_the_most_stable_baseline() -> None:
    """Zero spread must PASS. Rejecting it would invert the test and blind the
    module to the most predictable equipment on the property."""
    assert has_stable_baseline([2.0] * 8) is True


def test_a_device_usually_off_has_no_normal_to_exceed() -> None:
    assert has_stable_baseline([0.0] * 8) is False


def test_moderate_variation_still_counts_as_normal() -> None:
    """Real equipment varies. The guard must reject chaos, not ordinary life."""
    assert has_stable_baseline([3.0, 3.6, 2.7, 3.3, 3.1, 2.9]) is True


def test_the_limit_is_reachable_by_an_operator() -> None:
    noisy = [1.0, 5.0, 0.5, 6.0, 1.2, 4.8]
    assert has_stable_baseline(noisy) is False
    assert has_stable_baseline(noisy, limit=10.0) is True


# ── the rule is shared, not copied ───────────────────────────────────────────

def test_every_analysis_module_imports_the_shared_rule() -> None:
    """⚠️ THE AUDIT THAT WOULD HAVE PREVENTED THIS.

    Roll a shared rule out by what it APPLIES to, not by its existing call
    sites. Any module producing a ratio-based finding must consult
    `materiality`; a new one that does not will fail here rather than on
    somebody's phone.
    """
    import ast
    import inspect

    from reports.analysis.modules import level_anomaly, standby_creep

    for module in (level_anomaly, standby_creep):
        source = inspect.getsource(module)
        tree = ast.parse(source)
        imported = {
            alias.name
            for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
            for alias in node.names
        }
        uses_shared = bool(imported & {"is_material", "has_stable_baseline"})
        # standby_creep predates the shared module and carries its own,
        # equivalent, inline test — recorded here rather than silently allowed.
        inline = "MIN_RISE_OF_ACTIVE" in source
        assert uses_shared or inline, (
            f"{module.__name__} produces ratio findings without a materiality "
            f"test — see this file's docstring for what that costs")
