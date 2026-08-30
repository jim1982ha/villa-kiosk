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

from vesta.adapters.log import swallow, warn
from vesta.shared.text import readable_label
from vesta.shared.analysis.base import AnalysisModule, Finding, ModuleContext, skip

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
    # ⚠️ ONE QUESTION, AND IT USED TO BE SIX (2.755.0). This block asked whether
    # a covering blueprint was INSTALLED, whether it had EVER FIRED, how long
    # the collector had been LISTENING, and weighed those against a 45-day grace
    # window and an operator override — ~90 lines with six exits, every one of
    # them individually defensible and the whole unstatable in a sentence.
    #
    # It was not academic. Because `seen_blueprints` never decayed, a blueprint
    # that was switched OFF but still installed counted as live coverage
    # FOREVER: the grace window sat behind an earlier return and could never be
    # reached. So retiring an automation removed detection from both layers at
    # once, silently, and the only thing preventing it was an override flag on a
    # settings tab. Explaining that to the owner took three rounds.
    #
    # The owner's ruling is the whole specification now: supervision ON means
    # the agent supersedes the blueprint; supervision OFF means the blueprint
    # does the work. Nothing else is consulted, and there is nothing left that
    # can be true-but-surprising.
    # ⚠️ THE STAND-DOWN ARM IS GONE, AND THE REASONING THAT KILLED IT IS THE
    # OWNER'S OWN QUESTION (2026-08-29): "wouldn't re-enabling the automations
    # allow the briefing to be complete again?" It would not — the briefing has
    # NEVER read an automation's output. It reads statistics, live states and
    # the to-do lists; `collect.coverage()` is metadata about the listener and
    # `events_since` has no caller outside its module. So this arm traded the
    # briefing's ONLY analysis input for a layer that cannot reach the briefing
    # at all: with supervision off, an owner got no analysis from either side,
    # however many automations they re-enabled.
    #
    # The automations' real job — instant alerts, straight from Home Assistant
    # to a phone — continues regardless and never needed this gate. What
    # supervision means now is exactly one thing: does the AGENT think about
    # this villa too. `superseded_by` survives on the modules as the record of
    # which retired blueprint each check replaced; nothing reads it here.
    #
    # ⚠️ 2.755.0's ruling ("one switch decides which layer detects") was made
    # while the blueprints still REPORTED. TASK-074 removed that reporting from
    # every shipped blueprint, which quietly removed the premise. This is the
    # completion of that change, not a reversal of the ruling's intent.
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
            # ⚠️ EVERY FIELD, AND THE RULE STILL MATTERS WITH ONE LEFT.
            # This re-assembles the context per module, so a field added to the
            # dataclass and not copied HERE arrives at the gate as its DEFAULT —
            # silently, with no type error, because the default is a valid
            # value. `supervision_enabled` defaults to False, so omitting it
            # would stand every covered check down on a villa whose supervision
            # is on: the config saved, the gate correct, and nothing to see.
            # `test_coverage_claim` caught exactly that on the day the old flag
            # was added. Same shape as the `reachY` the badge tier lost in
            # 2.429.0.
            supervision_enabled=context.supervision_enabled,
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
        # ⚠️ A MISSING ENTRY HERE RENDERS THE RAW CODE. `readable.get(reason,
        # reason)` falls back to the code itself, so a skip reason added without
        # a phrase reaches the owner as `superseded` in the middle of a
        # sentence — which is what this map replaced `covered_but_silent` with
        # when the gate changed, found by the pin rather than by reading.
        # ("superseded" left this table with the gate arm, 2026-08-29 —
        #  an unreachable reason prints as absent, which reads as "measured,
        #  did not happen", the 2.416.0 lesson.)
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
        # ⚠️ THE TITLE TRAVELS WITH THE SKIP. The renderer printed
        # `level_anomaly did not run` — an identifier in prose, on the owner's
        # phone. Modules declare a `title`; carrying it here means the sentence
        # is built from a name rather than from a key, and the renderer needs no
        # table of its own.
        name = item.get("module", "a check")
        out.append({"module": name,
                    "title": _title_of(str(name)),
                    "reason": detail or reason,
                    # ⚠️ THE RAW CODE TRAVELS TOO. `reason` above is prose for
                    # printing; `code` is what the renderer groups on, because
                    # grouping on a sentence breaks the day the sentence is
                    # reworded — which is how this report has been bitten before.
                    "code": str(item.get("reason", ""))})
    return out


def _title_of(name: str) -> str:
    """A registered module's own title, or "" if it has none.

    Looked up rather than passed through because `skip()` records are built in
    several places and a field every caller must remember is a field one of them
    will forget — which is exactly how `plain_mode` came to be missing from the
    entity-target builder one release earlier.
    """
    module = _REGISTRY.get(name)
    return str(getattr(module, "title", "") or "") if module else ""


def _reset_for_tests() -> None:
    """Empty the registry. Tests only — importing a module registers it, and a
    test that asserts on the registry must not inherit another test's."""
    _REGISTRY.clear()


def _snapshot() -> Dict[str, Any]:
    return dict(_REGISTRY)


# ⚠️ THE REGISTRY REGISTERS; A MODULE NO LONGER REGISTERS ITSELF (TASK-115,
# 2026-08-28). Each module used to end with `register(TheModule())` behind
# `from ..registry import register` — which made the three SHARED statistical
# modules import a BRIEF module, the one upward edge in the whole lattice, and
# it existed only to run a two-line side effect at import time. Registration is
# a briefing concern (the gate, the skip lines, run_all), so it lives with the
# registry: importing THIS module yields a populated registry exactly as
# importing `modules/` used to, and the statistics stay import-clean for the
# export. The analysis package docstring's "importing a module registers it" is
# superseded by this block — a new module is added HERE, deliberately, and an
# absent one is still visible as an absent skip line.
def _register_shipped() -> None:
    from vesta.shared.analysis.modules.level_anomaly import LevelAnomaly
    from vesta.shared.analysis.modules.level_shortfall import LevelShortfall
    from vesta.shared.analysis.modules.sensor_health import SensorHealth
    from vesta.shared.analysis.modules.standby_creep import StandbyCreep
    for module in (LevelAnomaly(), LevelShortfall(), SensorHealth(),
                   StandbyCreep()):
        register(module)


_register_shipped()
