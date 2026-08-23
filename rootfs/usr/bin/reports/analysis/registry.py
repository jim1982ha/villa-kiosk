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
from ..text import readable_label
from .base import AnalysisModule, Finding, ModuleContext, skip

#: One module's budget. Generous — a month of hourly statistics for twenty
#: meters is real work on a Pi — but bounded, because the tick that runs it is
#: in the proxy's own event loop and a wedged module would stall the kiosk's
#: API alongside it.
MODULE_TIMEOUT_S = 30.0

#: Consecutive failures before a module is switched off and the operator told.
FAILURES_BEFORE_DISABLE = 3

#: How long a covering blueprint may stay silent before "installed" stops being
#: evidence that it works, and the built-in check runs beside it.
#:
#: ⚠️ LONGER THAN THE LONGEST CADENCE, DELIBERATELY. A monthly brief is 31 days;
#: a rule that legitimately fires once a month must not be declared silent by a
#: check that waited three weeks. 45 days is the shortest span that cannot
#: mistake one quiet month for an absent automation.
#:
#: ⚠️ AND EXPIRY IS SAFE ONLY BECAUSE OF THE SUBJECT DEDUPLICATION. Without it,
#: this constant would simply reintroduce the duplicate findings the stand-down
#: exists to prevent. The two ship together and neither is correct alone.
BLUEPRINT_GRACE_DAYS = 45

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
    covered_by = list(getattr(module, "superseded_by", ()) or ())
    if covered_by and "blueprint_layer" in context.capabilities:
        # ⚠️ SUPERSEDED BY A BETTER-INFORMED LAYER — WHILE THAT LAYER IS
        # ACTUALLY ANSWERING. On a property whose own automations detect this,
        # running the built-in module duplicates it, and duplicates it WORSE: a
        # blueprint sees occupancy, schedules and tariffs while these modules
        # see only statistics. On the reference villa that gap produced five
        # false positives in one week, and standing the modules down is what
        # stopped it. That reasoning is unchanged and this branch still exists.
        #
        # ⚠️ WHAT CHANGED IN 2.572.0 IS THE UNCONDITIONAL HALF. "Installed
        # beats fired" was correct as far as it went and had no floor, so a
        # property that imported the VESTA blueprint pack and built NO
        # automations from it stood every check down FOREVER while nothing could
        # ever fire — the worst-behaved deployment in the whole system being the
        # brand-new one. Installation is evidence that the layer is there; after
        # long enough with not one event from that blueprint, it stops being
        # evidence that it WORKS.
        #
        # ⚠️ THE GRACE IS MEASURED FROM WHEN THE COLLECTOR STARTED LISTENING,
        # never from now: a listener that has been up for an hour has no
        # standing to conclude anything about a rule that fires monthly.
        # `heard_nothing_for_days` is None when the collector cannot say.
        # ⚠️ A RETIRED BLUEPRINT IS NOT COVERAGE, AND THIS IS THE FIRST
        # QUESTION. `silent_blueprints` is installed-minus-seen, so a blueprint
        # somebody DELETED is absent from it exactly as a healthy one is — and
        # the branch below read that emptiness as "the covering rule is alive",
        # leaving the built-in check off and telling the reader "your own
        # automations already cover this" about a rule that was gone. Not for
        # 45 days: FOREVER, because the grace window below is only reached by a
        # blueprint that is still installed. Retiring `maintenance_silence`
        # would have permanently disabled the check meant to replace it.
        #
        # ⚠️ AN EMPTY `installed` MEANS "CANNOT SAY", NOT "NONE INSTALLED" —
        # `collect.state` returns an empty list when the blueprint fetch fell
        # back, and its own comment says nothing may be concluded from it. So
        # this reverses a stand-down only on positive evidence that the layer
        # exists and this rule is not in it.
        installed = set(context.installed_blueprints)
        if installed and not any(b in installed for b in covered_by):
            return (True, "", "")

        silent = [b for b in covered_by if b in set(context.silent_blueprints)]
        if not silent:
            # ⚠️ SHORT, BECAUSE IT IS PRINTED IN A NOTIFICATION. This was
            # "covered by this property's own automation layer, which sees
            # occupancy and cost context these checks cannot" — ninety-eight
            # characters, three times over in one brief, in the section a
            # reader is least likely to reach. WHY the automations are better
            # belongs on the Checks tab, which has room and already says it.
            return (False, "missing_capability",
                    "your own automations already cover this")
        listening = context.heard_nothing_for_days
        if listening is not None and listening >= BLUEPRINT_GRACE_DAYS:
            # Runs. ⚠️ AND IT IS NOT A DUPLICATE RISK: the pipeline drops any
            # finding whose SUBJECT the blueprint layer also reported this
            # period (`pipeline._without_blueprint_subjects`), so the moment
            # that rule starts speaking about a device, the built-in check
            # yields on it — per device, not per property.
            return (True, "", "")
        # ⚠️ ITS OWN REASON CODE, AND THE DETAIL IS THE BLUEPRINT NAME ALONE.
        # The renderer gathers every skip of this shape under one sub-heading
        # and writes the explanation once, so a sentence here would repeat on
        # every line — which is what the brief did, three times over, until an
        # owner asked for them grouped. Grouping on the PROSE would have worked
        # today and broken the next time a reader asked for different words.
        return (False, "covered_but_silent", readable_label(silent[0]))

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
            # ⚠️ EVERY FIELD, AND THIS ONE IS WHY THE RULE EXISTS. This
            # re-assembles the context per module, so a field added to the
            # dataclass and not copied HERE arrives at the gate as its default
            # — silently, with no type error, because the default is a valid
            # value. `silent_blueprints` defaulting to `()` makes every covering
            # blueprint look like it has reported, which is precisely the false
            # reassurance this release removes. Same shape as the `reachY` the
            # badge tier lost in 2.429.0.
            silent_blueprints=context.silent_blueprints,
            installed_blueprints=context.installed_blueprints,
            heard_nothing_for_days=context.heard_nothing_for_days,
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
        "covered_but_silent": "covered by a rule that has never reported",
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
