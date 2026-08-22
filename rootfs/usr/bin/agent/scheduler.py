"""The triage clock. What makes an unattended shadow period possible at all.

⚠️ WITHOUT THIS, SHADOW MODE FILLS ONLY WHEN SOMEBODY ASKS. The whole point of
a shadow period is that it accumulates evidence while nobody is watching — and
the PH-3 checkpoint cannot happen until it has. Triage existed and nothing
called it, so the store stayed empty and the emptiness looked like a quiet
villa, which is the failure this subsystem keeps rediscovering in new places.

⚠️ IT IS A FOURTH TASK IN THE SAME LOOP, not a fourth s6 service. The reports
scheduler, the collector and the observation cycle already prove the pattern; a
supervised service would be another thing to start, stop, watch and
misconfigure for no benefit.

⚠️ THE CADENCE IS RE-READ EVERY PASS, never captured at start-up — the same rule
`observe/cycle.py` states. An operator who lowers the cadence because the bill
is climbing should not have to restart the add-on to be listened to.

⚠️ AND EVERY GUARD IS ASKED PER PASS, IN COST ORDER. Switched off, then shadow,
then budget, then the provider — each refusing before the next costs anything.
A scheduler that checked the budget after calling the model would discover it
was over the limit by going over it.
"""

from __future__ import annotations

import asyncio

from typing import Any, Callable, Mapping, Optional

from agent import budget as budget_mod
from agent import config as agent_config
from agent import triage as triage_mod
from reports.log import log, swallow, warn

#: How long to wait after a failed pass before trying again. ⚠️ NOT THE
#: CADENCE: a villa whose provider is down should not retry every fifteen
#: minutes for a day, and a villa whose config is simply off should cost
#: nothing at all.
RETRY_S: float = 300.0

#: The floor on how often triage may run, whatever config says. ⚠️ A GUARD
#: AGAINST A TYPO, not a policy. `triage_minutes: 1` is ninety-six times the
#: intended spend, and a misplaced digit should not be able to bill a month in
#: an afternoon.
MIN_MINUTES: float = 5.0


def _cadence(config: Optional[Mapping[str, Any]]) -> float:
    cfg = agent_config.view(config)
    try:
        minutes = float(cfg.get("triage_minutes") or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(minutes, MIN_MINUTES) if minutes > 0 else 0.0


async def run_once(session: Any, *, config: Optional[Mapping[str, Any]] = None,
                   provider: Any = None, document: str = "") -> str:
    """One triage pass, with every guard. Returns why it stopped, for the log.

    ⚠️ IT RETURNS A REASON RATHER THAN A BOOLEAN. "Nothing happened" has five
    causes here and they need different responses from an operator — switched
    off, shadowed, over budget, no provider, and nothing to escalate all look
    identical from outside, and four of them are fine.
    """
    cfg = agent_config.view(config)
    if not cfg.get("enabled"):
        return "agent disabled"
    if not agent_config.trigger_enabled(config, "scheduled"):
        return "scheduled trigger disabled"

    money = budget_mod.check(config, kind="run")
    if not money.allowed:
        return f"budget: {money.reason}"

    if provider is None or not provider.configured():
        return "no model provider configured"

    result = await triage_mod.run(provider=provider, document=document,
                                  config=config)
    if result.status != "answered":
        return f"triage {result.status}: {result.reason}"
    if not result.escalations:
        # ⚠️ A SUCCESSFUL QUIET PASS, AND IT IS SAID DIFFERENTLY FROM A FAILED
        # ONE. `TriageResult.quiet` is only true when the pass SUCCEEDED, and
        # this log line is the human-readable half of that distinction.
        return "nothing to escalate"

    subjects = ", ".join(e.subject for e in result.escalations[:3])
    return f"escalated {len(result.escalations)}: {subjects}"


async def run_forever(session: Any,
                      config_source: Optional[Callable[[], Mapping[str, Any]]]
                      = None) -> None:
    """The triage clock. Never exits except on cancellation.

    ⚠️ IT TAKES A READER, NOT A VALUE, AND THE FIRST VERSION TOOK A VALUE while
    its own comment explained why that was wrong. A config captured at boot
    freezes the cadence and every kill switch until the add-on restarts — so an
    operator lowering the cadence because the bill is climbing, or reaching for
    the master switch because something is going wrong, would not be listened
    to. Calling the reader per pass costs one small JSON read every fifteen
    minutes.

    ⚠️ CANCELLATION RE-RAISES. aiohttp's shutdown cancels this and waits for
    it; swallowing `CancelledError` holds the whole shutdown open until the
    timeout — the trap `collect.run_forever` and `observe/cycle.py` both
    document, and the third place it would have been re-learned.
    """
    log("triage scheduler started")
    while True:
        config = config_source() if config_source else None
        minutes = _cadence(config)
        wait = RETRY_S if minutes <= 0 else minutes * 60.0
        try:
            if minutes > 0:
                outcome = await _pass(session, config)
                if outcome:
                    log(f"triage: {outcome}")
        except asyncio.CancelledError:
            log("triage scheduler stopped")
            raise
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("triage pass failed", err)
            wait = RETRY_S
        await asyncio.sleep(wait)


async def _pass(session: Any, config: Optional[Mapping[str, Any]]) -> str:
    """Assemble what a pass needs, then run it. Never raises."""
    from agent.llm import anthropic_sdk
    from observe import snapshot
    from reports import secrets as reports_secrets

    try:
        document = snapshot.villa_document(profile_text=snapshot.profile(),
                                           delta_text=snapshot.delta())
    except Exception as err:  # noqa: BLE001
        warn(f"triage could not assemble the villa document: {err}")
        document = f"The villa document could not be assembled: {err}"

    provider = anthropic_sdk.build(
        api_key=reports_secrets.get("anthropic") or "")
    return await run_once(session, config=config, provider=provider,
                          document=document)
