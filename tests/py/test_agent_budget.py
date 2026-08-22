"""The spending ceiling. TEST-024, TEST-025.

⚠️ THE CEILING THIS REPLACES WAS IN MEMORY AND SAID SO. That was correct for one
narrated sentence per brief. It is wrong at ~96 runs a day, where the runaway to
stop is a RESTART LOOP — and a counter that resets on restart never binds
against exactly that.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import budget  # noqa: E402

JAN = 1767225600.0    # 2026-01-01 UTC
FEB = 1769904000.0    # 2026-02-01 UTC


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(budget, "BUDGET_FILE",
                        str(tmp_path / "vesta" / "budget.json"))
    monkeypatch.setattr(budget, "_BREAKER", None)


def _cfg(**over: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {"agent_monthly_limit": 10}
    base.update(over)
    return base


# ── TEST-024 · the ceiling declines with a reason ──────────────────────────

def test_the_ceiling_declines_with_something_a_person_can_read() -> None:
    """⚠️ A declined run must be distinguishable from a broken one. "The
    ceiling is spent" and "the provider is unreachable" call for completely
    different responses; a bare False makes them identical."""
    for _ in range(10):
        budget.spend(now=JAN)
    out = budget.check(_cfg(), now=JAN)
    assert not out.allowed
    assert "10" in out.reason and "spent" in out.reason
    assert out.remaining == 0


def test_it_allows_right_up_to_the_boundary_and_not_past_it() -> None:
    for _ in range(9):
        budget.spend(now=JAN)
    assert budget.check(_cfg(), now=JAN).allowed
    budget.spend(now=JAN)
    assert not budget.check(_cfg(), now=JAN).allowed


# ── TEST-025 · the counter survives a restart ──────────────────────────────

def test_the_counter_survives_a_restart() -> None:
    """A restart is just a fresh read of the same file — and the runaway this
    guards against IS a restart loop."""
    for _ in range(4):
        budget.spend(now=JAN)
    assert budget.status(_cfg(), now=JAN)["used"] == 4
    # "restart": nothing in memory, same file
    assert budget.check(_cfg(), now=JAN).used == 4


def test_a_restart_loop_cannot_reset_the_ceiling() -> None:
    """⚠️ THE EXACT RUNAWAY. Under the in-memory version each restart began at
    zero and the ceiling never bound."""
    for _ in range(10):
        budget.spend(now=JAN)          # each spend re-reads from disk
    assert not budget.check(_cfg(), now=JAN).allowed


# ── rolling ────────────────────────────────────────────────────────────────

def test_the_month_is_UTC_not_the_villa_s_LOCAL_time() -> None:
    """⚠️ THE FIXTURE THAT REACHES THE RULE. JAN/FEB above land on month
    boundaries in UTC *and* in the runner's local zone, so swapping gmtime for
    localtime survived mutation testing. This forces the villa's own zone
    (UTC+8) and picks an instant where the two disagree.

    On UTC+8, rolling on local midnight would give the villa eight extra hours
    of the old month's allowance — and the two counters in this system would
    disagree about which month it is."""
    import time as _t
    old = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "Asia/Singapore"
        _t.tzset()
        # 2026-01-31 20:00 UTC == 2026-02-01 04:00 in Asia/Singapore.
        straddle = 1769889600.0
        assert _t.strftime("%Y-%m", _t.gmtime(straddle)) == "2026-01"
        assert _t.strftime("%Y-%m", _t.localtime(straddle)) == "2026-02"
        assert budget._month_of(straddle) == "2026-01", (
            "the month must roll on UTC, not on the villa's wall clock")
    finally:
        if old is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old
        _t.tzset()


def test_it_rolls_on_the_calendar_month() -> None:
    for _ in range(10):
        budget.spend(now=JAN)
    assert not budget.check(_cfg(), now=JAN).allowed
    assert budget.check(_cfg(), now=FEB).allowed
    assert budget.status(_cfg(), now=FEB)["used"] == 0


def test_a_READ_does_not_roll_the_stored_counter() -> None:
    """⚠️ A read must not have a side effect, or a diagnostic that merely ASKS
    the remaining budget silently resets it — and that reset would look exactly
    like a quiet month."""
    for _ in range(3):
        budget.spend(now=JAN)
    budget.check(_cfg(), now=FEB)      # a February read...
    budget.status(_cfg(), now=FEB)
    assert budget.status(_cfg(), now=JAN)["used"] == 3, (
        "asking about February must not have wiped January's stored count")


# ── raising the limit ──────────────────────────────────────────────────────

def test_raising_the_limit_does_NOT_reset_the_count() -> None:
    """⚠️ Otherwise the ceiling is resettable by the person it constrains."""
    for _ in range(10):
        budget.spend(now=JAN)
    assert not budget.check(_cfg(), now=JAN).allowed
    raised = budget.check(_cfg(agent_monthly_limit=12), now=JAN)
    assert raised.allowed and raised.used == 10, (
        "the headroom moves; the count does not")
    assert raised.remaining == 2


def test_the_limit_is_never_stored_beside_the_counter() -> None:
    import json
    budget.spend(now=JAN)
    with open(budget.BUDGET_FILE, encoding="utf-8") as handle:
        stored = json.load(handle)
    assert "limit" not in stored and "agent_monthly_limit" not in stored, (
        "a stored limit is one an old file can carry back after config changed")
    assert set(stored) == {"month", "used", "chat_used"}


# ── the chat sub-ceiling ───────────────────────────────────────────────────

def test_chat_has_its_own_ceiling_inside_the_same_budget() -> None:
    """⚠️ A person can type all day; supervision cannot. Two INDEPENDENT
    budgets could both be under while the bill is over, so this is a slice of
    one ceiling rather than a second one."""
    cfg = _cfg(agent_monthly_limit=100)          # chat share -> 25
    assert budget.chat_limit_of(cfg) == 25
    for _ in range(25):
        budget.spend("chat", now=JAN)
    assert not budget.check(cfg, kind="chat", now=JAN).allowed
    # ...and supervision is untouched.
    assert budget.check(cfg, kind="run", now=JAN).allowed


def test_chat_declining_says_supervision_is_unaffected() -> None:
    cfg = _cfg(agent_monthly_limit=4)
    for _ in range(budget.chat_limit_of(cfg)):
        budget.spend("chat", now=JAN)
    reason = budget.check(cfg, kind="chat", now=JAN).reason
    assert "Supervision is unaffected" in reason


def test_chat_spending_counts_against_the_MAIN_ceiling_too() -> None:
    """Otherwise a conversation is free, which is the arithmetic that makes a
    budget stop meaning anything."""
    budget.spend("chat", now=JAN)
    assert budget.status(_cfg(), now=JAN)["used"] == 1


def test_an_explicit_chat_limit_cannot_exceed_the_main_one() -> None:
    cfg = _cfg(agent_monthly_limit=10, agent_chat_monthly_limit=999)
    assert budget.chat_limit_of(cfg) == 10


# ── check vs spend ─────────────────────────────────────────────────────────

def test_checking_does_not_charge() -> None:
    """⚠️ A check that counted would charge for a request never made — every
    dry run, every diagnostic, every path that asks and then declines."""
    for _ in range(20):
        budget.check(_cfg(), now=JAN)
    assert budget.status(_cfg(), now=JAN)["used"] == 0


# ── junk config ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("junk", [None, {}, "not a mapping", 42,
                                  {"agent_monthly_limit": 0},
                                  {"agent_monthly_limit": -5},
                                  {"agent_monthly_limit": "banana"},
                                  {"agent_monthly_limit": float("inf")}])
def test_junk_config_falls_back_to_the_default_never_to_zero_or_infinity(
        junk: Any) -> None:
    """⚠️ Zero would refuse everything and infinity would refuse nothing; both
    are worse than a default. int(inf) raises OverflowError, not ValueError —
    the trap policy.py hit two releases ago."""
    assert budget.limit_of(junk) == budget.DEFAULT_MONTHLY_LIMIT


def test_a_corrupt_counter_file_degrades_to_zero_rather_than_raising() -> None:
    os.makedirs(os.path.dirname(budget.BUDGET_FILE), exist_ok=True)
    for junk in ("{ not json", '["a list"]', '{"used": "banana"}',
                 '{"used": -99}'):
        with open(budget.BUDGET_FILE, "w", encoding="utf-8") as handle:
            handle.write(junk)
        assert budget.status(_cfg(), now=JAN)["used"] == 0


def test_a_NEGATIVE_stored_count_is_clamped_not_trusted() -> None:
    """⚠️ THE FIXTURE THAT REACHES THE CLAMP. The test above writes files with
    no `month` key, so `_rolled` always rolls them to zero and the clamp is
    never exercised — removing `max(0, ...)` survived mutation testing because
    of it. This file carries the CURRENT month, so the stored value is used as
    written and only the clamp can save it.

    A negative count is not academic: it would hand the ceiling free headroom,
    which is the one direction a budget must never fail."""
    import json
    os.makedirs(os.path.dirname(budget.BUDGET_FILE), exist_ok=True)
    with open(budget.BUDGET_FILE, "w", encoding="utf-8") as handle:
        json.dump({"month": budget._month_of(JAN), "used": -99,
                   "chat_used": -5}, handle)
    state = budget.status(_cfg(), now=JAN)
    assert state["used"] == 0 and state["chat_used"] == 0
    assert state["remaining"] == 10, (
        "a negative count must not create headroom above the ceiling")


def test_a_write_failure_degrades_and_does_not_raise(
        monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a: Any, **_k: Any) -> None:
        raise OSError("read-only filesystem")
    monkeypatch.setattr(budget.store, "write_json", boom)
    budget.spend(now=JAN)          # must not raise


# ── the breaker ────────────────────────────────────────────────────────────

def test_the_breaker_opens_after_consecutive_failures_and_closes_after_rest() -> None:
    b = budget.Breaker(failures=3, reset_s=100.0)
    assert not b.is_open(now=0.0)
    for i in range(3):
        b.record_failure(now=0.0)
    assert b.is_open(now=0.0)
    assert b.is_open(now=99.0)
    assert not b.is_open(now=100.0), "it must close again after the rest"


def test_a_success_clears_the_failure_run() -> None:
    b = budget.Breaker(failures=3)
    b.record_failure(now=0.0)
    b.record_failure(now=0.0)
    b.record_success()
    b.record_failure(now=0.0)
    assert not b.is_open(now=0.0), "consecutive, not cumulative"


def test_the_breaker_is_ONE_process_wide_instance() -> None:
    """⚠️ `providers.shared()` records why: a breaker constructed per run starts
    closed every time, which is not a breaker."""
    assert budget.shared_breaker() is budget.shared_breaker()


def test_the_breaker_is_deliberately_NOT_persisted() -> None:
    """⚠️ The OPPOSITE call from the counter, and the difference is the point.
    The counter guards a MONTH and must survive a restart; the breaker guards
    MINUTES, and a restart is exactly when it is worth trying again."""
    import inspect
    source = inspect.getsource(budget.Breaker)
    assert "write_json" not in source and "BUDGET_FILE" not in source
