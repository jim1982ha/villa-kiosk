"""The triage clock. Without it a shadow period never fills.

⚠️ THE GUARDS ARE TESTED IN COST ORDER, because that is the property that
matters: each must refuse before the next spends anything. A scheduler that
checked the budget after calling the model would discover it was over the limit
by going over it.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vesta.supervise.agent import scheduler
from fake_provider import FakeProvider, says                    # noqa: E402

ON: Dict[str, Any] = {"enabled": True, "triage_minutes": 15,
                      "triggers": {"scheduled": True}}


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    from vesta.supervise.agent import audit as audit_mod
    from vesta.supervise.agent import budget as budget_mod
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(budget_mod, "BUDGET_FILE", str(tmp_path / "b.json"))
    monkeypatch.setattr(budget_mod, "_BREAKER", None)


def _once(**kw: Any) -> str:
    kw.setdefault("config", ON)
    kw.setdefault("provider", FakeProvider([says("NOTHING")]))
    kw.setdefault("document", "PROFILE")
    return asyncio.run(scheduler.run_once(None, **kw))


# ── the guards, in cost order ───────────────────────────────────────────────
def test_the_master_switch_stops_it_first() -> None:
    assert _once(config={"enabled": False}) == "agent disabled"


def test_the_scheduled_trigger_stops_it_second() -> None:
    got = _once(config={"enabled": True, "triggers": {"scheduled": False}})
    assert got == "scheduled trigger disabled"


def test_a_spent_budget_stops_it_before_the_provider() -> None:
    """⚠️ BEFORE, not after. Checking afterwards discovers the limit by
    exceeding it.

    ⚠️ A CEILING OF 1, SPENT — NOT A CEILING OF 0. Zero means "use the shipped
    default" in `limit_of`, so a fixture setting it to zero tests an unlimited
    budget while appearing to test an exhausted one. Caught by this test failing
    for the wrong reason.
    """
    from vesta.supervise.agent import budget as budget_mod

    tight = {**ON, "monthly_limit": 1}
    budget_mod.spend("run")
    got = _once(config=tight, provider=None)
    assert got.startswith("budget:"), got


def test_no_provider_is_a_reason_not_a_crash() -> None:
    assert _once(provider=None) == "no model provider configured"


# ── outcomes are distinguishable ────────────────────────────────────────────
def test_a_QUIET_pass_reads_differently_from_a_FAILED_one() -> None:
    """⚠️ Five causes produce "nothing happened" here and four of them are
    fine. An operator needs to tell them apart."""
    assert _once() == "nothing to escalate"
    from fake_provider import declines
    assert _once(provider=FakeProvider([declines("no credit")])).startswith(
        "triage declined")


def test_escalations_are_named_in_the_log_line() -> None:
    got = _once(provider=FakeProvider(
        [says("ESCALATE: pool pump — drawing more than usual")]))
    assert got.startswith("escalated 1") and "pool pump" in got


# ── the cadence ─────────────────────────────────────────────────────────────
def test_a_typo_cannot_bill_a_month_in_an_afternoon() -> None:
    """⚠️ `triage_minutes: 1` is ninety-six times the intended spend. The floor
    is a guard against a misplaced digit, not a policy."""
    assert scheduler._cadence({"triage_minutes": 1}) == scheduler.MIN_MINUTES
    assert scheduler._cadence({"triage_minutes": 30}) == 30.0


def test_zero_means_OFF_rather_than_as_fast_as_possible() -> None:
    assert scheduler._cadence({"triage_minutes": 0}) == 0.0
    assert scheduler._cadence({"triage_minutes": "nonsense"}) == 0.0


def test_the_config_is_a_READER_not_a_value() -> None:
    """⚠️ A config captured at boot freezes the cadence and every kill switch
    until restart — so an operator reaching for the master switch because
    something is going wrong would not be listened to. The first version took a
    value, in the same commit as a comment saying why that is wrong."""
    import inspect
    signature = inspect.signature(scheduler.run_forever)
    assert "config_source" in signature.parameters
    source = inspect.getsource(scheduler.run_forever)
    assert "config_source() if config_source" in source


def test_the_proxy_passes_the_FUNCTION_not_its_result() -> None:
    """The other half of that rule, across TWO file boundaries since TASK-115
    step 5: the proxy hands `_agent_config_now` (the function) to
    `agent_service.start`, and the service hands `config_source` (still the
    function) to `run_forever`. Pinning either hop alone would let the other
    freeze the config at boot."""
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin", "supervisor-proxy.py")
    with open(path, encoding="utf-8") as handle:
        proxy = handle.read()
    assert 'agent_service.start(' in proxy
    assert '_agent_config_now,' in proxy, "the proxy no longer hands the reader over"
    assert "_agent_config_now())" not in proxy, "the config was frozen at boot"
    service_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin", "vesta", "supervise", "service.py")
    with open(service_path, encoding="utf-8") as handle:
        service = handle.read()
    assert "agent_scheduler.run_forever(session, config_source)" in service
    assert "config_source()" not in service.split("def start")[1].split("tasks[")[0], (
        "the service froze the config before starting the loops")


def test_the_clock_is_a_task_in_the_EXISTING_loop() -> None:
    """⚠️ Not a fourth s6 service: another thing to start, stop, watch and
    misconfigure for no benefit. Since TASK-115 step 5 the task is created in
    `supervise/service.py` and the proxy mounts the returned dict — so the pin
    checks the service CREATES it and the proxy STARTS the service."""
    service_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin", "vesta", "supervise", "service.py")
    with open(service_path, encoding="utf-8") as handle:
        service = handle.read()
    assert "asyncio.create_task(" in service
    assert "agent_scheduler.run_forever" in service
    proxy_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin", "supervisor-proxy.py")
    with open(proxy_path, encoding="utf-8") as handle:
        proxy = handle.read()
    assert "agent_service.start(" in proxy


def test_run_once_DECLINES_without_a_provider_so_the_caller_must_pass_one() -> None:
    """⚠️ THE CONTRACT THAT COST FOUR BUTTON PRESSES. `run_once` does not build
    a provider — it takes one and declines when it is None. The forever-task
    passes its own, so the omission is invisible there; the proxy's manual route
    did not, and every press returned "no model provider configured" while the
    owner reported that nothing changed.

    Pinned as the CONTRACT plus its one caller, because the failure is silent by
    design: `run_once` returns a reason rather than raising, which is right for
    an unattended loop and is exactly what let a caller ignore it.
    """
    import asyncio
    import inspect
    import os
    import re

    from vesta.supervise.agent import scheduler as scheduler_mod

    assert "provider" in inspect.signature(scheduler_mod.run_once).parameters
    reason = asyncio.run(scheduler_mod.run_once(
        None, config={"enabled": True, "triggers": {"scheduled": True}},
        provider=None, document="x"))
    assert "provider" in reason, (
        f"a run with no provider no longer says so: {reason!r}")

    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    with open(os.path.join(root, "rootfs", "usr", "bin", "supervisor-proxy.py"),
              encoding="utf-8") as handle:
        proxy = re.sub(r"#[^\n]*", "", handle.read())
    call = proxy[proxy.index("agent_scheduler.run_once("):]
    call = call[:call.index(")\n")]
    assert "provider=" in call, (
        "the manual triage route calls run_once without a provider, so every "
        "press declines and the shadow diff can never gain an agent column")

