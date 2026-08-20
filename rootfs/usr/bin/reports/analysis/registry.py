"""Which modules run, which do not, and why.

⚠️ THE GATE IS ORDERED, AND THE ORDER IS THE MESSAGE. A module is checked
against capability, then operator setting, then history, then audience:

    requires ⊆ capabilities → enabled → history ≥ min_days → audience ∩ run

Capability first because "this property has no device metering" is a more
useful thing to tell an owner than "you have not enabled the module" about a
module that could never have worked. Reporting the last failing check instead
would tell them to switch on something that would then skip for a different
reason next week.

⚠️ EVERY OUTCOME IS RECORDED. A module runs, or it produces a skip with a
reason that reaches the report. There is no path where a module simply is not
mentioned — that reads as "nothing to report", which is a claim nobody made.

⚠️ A FAILING MODULE MUST NOT TAKE THE PASS DOWN. Each run is bounded by a
timeout and wrapped; three consecutive failures disable it with a notice,
because a module that throws every week is noise the operator cannot act on
and a cost the scheduler pays every time.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Sequence, Tuple

from ..log import swallow, warn
from .base import AnalysisModule, Finding, ModuleContext, skip

#: One module's budget. Generous — a month of hourly statistics for twenty
#: meters is real work on a Pi — but bounded, because the tick that runs it is
#: in the proxy's own event loop and a wedged module would stall the kiosk's
#: API alongside it.
MODULE_TIMEOUT_S = 30.0

#: Consecutive failures before a module is switched off and the operator told.
FAILURES_BEFORE_DISABLE = 3

_REGISTRY: Dict[str, AnalysisModule] = {}


def register(module: AnalysisModule) -> AnalysisModule:
    """Add a module. Called at import time by each module file."""
    _REGISTRY[module.name] = module
    return module


def registered() -> List[AnalysisModule]:
    return [_REGISTRY[name] for name in sorted(_REGISTRY)]


def gate(module: AnalysisModule, context: ModuleContext,
         failures: Dict[str, int], history_days: int) -> Tuple[bool, str, str]:
    """May this module run? Returns (ok, reason, detail).

    `reason` is a SKIP_REASON value when ok is False.
    """
    # ⚠️ SUPERSEDED BY A BETTER-INFORMED LAYER. On a property whose own
    # automations already detect this, running the built-in module duplicates it
    # — and duplicates it WORSE, because a blueprint sees occupancy, schedules
    # and tariffs while these modules see only statistics. On the reference
    # villa that gap produced five false positives in one week.
    #
    # Not deleted, because the add-on is redistributable: a fresh install has no
    # blueprints, and there these modules are the only analysis there is. The
    # deployment is detected rather than configured.
    if getattr(module, "superseded_by_blueprints", False):
        if "blueprint_layer" in context.capabilities:
            return (False, "missing_capability",
                    "covered by this property's own automation layer, which "
                    "sees occupancy and cost context these checks cannot")

    missing = [c for c in module.requires if c not in context.capabilities]
    if missing:
        return (False, "missing_capability",
                f"this property has no {', '.join(missing)}")

    enabled = context.settings.get("enabled")
    if enabled is False:
        return (False, "disabled", "switched off by the operator")

    if failures.get(module.name, 0) >= FAILURES_BEFORE_DISABLE:
        return (False, "errored",
                f"disabled after {FAILURES_BEFORE_DISABLE} consecutive failures")

    needed = max(module.min_days, context.min_history_days)
    if history_days < needed:
        return (False, "insufficient_history",
                f"needs {needed} days of history, has {history_days}")

    if context.audience not in module.audiences:
        return (False, "audience_mismatch",
                f"not part of the {context.audience} brief")

    return (True, "", "")


async def run_all(context: ModuleContext, failures: Dict[str, int],
                  history_days: int) -> Tuple[List[Finding], List[Dict[str, str]],
                                              Dict[str, int], List[str]]:
    """Run every registered module.

    Returns (findings, skipped, failures, ran). `ran` is the names of modules
    that actually executed — ⚠️ WITHOUT IT, "no module is configured" and
    "every module ran and found nothing" are the same empty result, and the
    report cannot tell an owner which of the two happened. They mean opposite
    things.

    Never raises. `failures` is returned rather than mutated in place so the
    caller decides whether to persist it — a pass that crashed before writing
    should not have half-updated counters.
    """
    findings: List[Finding] = []
    skipped: List[Dict[str, str]] = []
    ran: List[str] = []
    counts = dict(failures)

    for module in registered():
        settings = context.settings.get(module.name)
        module_context = ModuleContext(
            audience=context.audience, cadence=context.cadence,
            now_local=context.now_local, capabilities=context.capabilities,
            inventory=context.inventory,
            settings=settings if isinstance(settings, dict) else {},
            min_history_days=context.min_history_days,
            stats=context.stats, labels=context.labels,
        )

        ok, reason, detail = gate(module, module_context, counts, history_days)
        if not ok:
            skipped.append(skip(module.name, reason, detail))
            continue

        try:
            produced = await asyncio.wait_for(
                module.run(module_context), timeout=MODULE_TIMEOUT_S)
            findings.extend(produced)
            counts[module.name] = 0
            ran.append(module.name)
        except asyncio.TimeoutError:
            counts[module.name] = counts.get(module.name, 0) + 1
            warn(f"module {module.name} exceeded {MODULE_TIMEOUT_S:.0f}s")
            skipped.append(skip(module.name, "timed_out",
                                f"exceeded {MODULE_TIMEOUT_S:.0f}s"))
        except Exception as err:  # noqa: BLE001 - one module must not stop a pass
            counts[module.name] = counts.get(module.name, 0) + 1
            swallow(f"module {module.name} failed", err)
            skipped.append(skip(module.name, "errored", str(err)[:200]))

    return findings, skipped, counts, ran


def describe_skips(skipped: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Skips in the form the renderer prints: module plus a readable reason."""
    readable = {
        "missing_capability": "not possible on this property",
        "disabled": "switched off",
        "insufficient_history": "not enough history yet",
        "audience_mismatch": "not part of this brief",
        "timed_out": "took too long",
        "errored": "failed",
    }
    out: List[Dict[str, str]] = []
    for item in skipped:
        reason = readable.get(item.get("reason", ""), item.get("reason", ""))
        detail = item.get("detail", "")
        # ⚠️ THE DETAIL WINS WHERE THERE IS ONE. Printing both gave
        # "not possible on this property — covered by this property's own
        # automation layer, which sees occupancy and cost context these checks
        # cannot": the generic reason restated by the specific one, with "this
        # property" twice in a line the owner reads three times over.
        out.append({"module": item.get("module", "a check"),
                    "reason": detail or reason})
    return out


def _reset_for_tests() -> None:
    """Empty the registry. Tests only — importing a module registers it, and a
    test that asserts on the registry must not inherit another test's."""
    _REGISTRY.clear()


def _snapshot() -> Dict[str, Any]:
    return dict(_REGISTRY)
