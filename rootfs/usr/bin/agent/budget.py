"""The spending ceiling, and it survives a restart. ADR-015.

⚠️ THE EXISTING `providers.Budget` IS IN MEMORY AND SAYS SO AS A STATED
LIMITATION, NOT AN OVERSIGHT. That was the right call for what it guards: one
narrated sentence per brief, a handful of requests a month, and a runaway that
would happen inside one process lifetime. This tier is different in exactly the
way that matters — a 15-minute cadence is ~96 runs a day, and the specific
runaway to stop is a RESTART LOOP with a firing trigger, where every restart
resets an in-memory counter to zero and the ceiling never binds. A ceiling that
forgets is not a ceiling.

⚠️ COUNTED IN REQUESTS, NOT TOKENS, and the reasoning is `providers.py`'s and is
worth restating rather than inheriting silently: token accounting needs the
provider's own reply to be trusted for billing, differs per provider, and is the
kind of thing that silently stops being accurate. A request count is exact,
provider-agnostic, and an owner can reason about it — "at most N runs a month"
is a sentence with a number in it.

⚠️ RAISING THE LIMIT MUST NOT RESET THE COUNT. The limit and the counter are
independent fields and the limit is never stored — it is read from config on
every question. An owner who raises the ceiling mid-month gets the remaining
headroom, not a fresh month, because the alternative makes the ceiling
resettable by the person it constrains.

⚠️ CHAT HAS ITS OWN SUB-CEILING INSIDE THE SAME BUDGET. A person can type all
day; supervision cannot. Without a sub-ceiling a long conversation starves the
thing the product exists to do, and the failure is silent — the briefs simply
stop. Chat degrades with a sentence a person can read; supervision keeps its
allowance.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Final, Mapping, Optional, Tuple

from agent import config as agent_config
from reports import store
from reports import usage as usage_mod
from reports.log import log, swallow

BUDGET_FILE: Final[str] = f"{store.DATA_DIR}/vesta/budget.json"

#: ⚠️ SIZED AGAINST THE CADENCE, NOT PICKED. 96 triage runs a day is ~2,900 a
#: month, plus ~6 investigations and 2 briefs daily. 4,000 is above ordinary use
#: and far below a runaway. It is a DEFAULT — the real value is config, because
#: a villa on a 30-minute cadence wants half of it.
DEFAULT_MONTHLY_LIMIT: Final[int] = 4_000

#: Chat's slice of the same ceiling. Deliberately a fraction rather than a
#: separate budget: two independent ceilings can both be under while the bill is
#: over, which is the arithmetic that makes a budget stop meaning anything.
DEFAULT_CHAT_SHARE: Final[float] = 0.25

#: Same shape and same numbers as `providers.Breaker`, for the same reason: a
#: provider that is down stays down for minutes, and retrying every cycle is how
#: a rate limit becomes a ban.
BREAKER_FAILURES: Final[int] = 3
BREAKER_RESET_S: Final[float] = 1800.0

#: A hard stop on one run, independent of the month. The monthly ceiling cannot
#: catch a single run that loops, because it is one run.
DEFAULT_MAX_TURNS: Final[int] = 8

_EMPTY: Final[Dict[str, Any]] = {"month": "", "used": 0, "chat_used": 0}


@dataclass(frozen=True)
class Verdict:
    """Allowed, or refused with something a person can read.

    ⚠️ THE REASON IS NOT DECORATION. A declined run must be distinguishable from
    a broken one — "the ceiling is spent" and "the provider is unreachable" call
    for completely different responses, and a bare False makes them identical.
    """

    allowed: bool
    reason: str = ""
    used: int = 0
    limit: int = 0

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def _month_of(now: Optional[float] = None) -> str:
    """Calendar month in UTC. Same rule as `providers.Budget`.

    ⚠️ UTC, NOT LOCAL. A villa on UTC+8 rolling on local midnight would give
    itself eight extra hours of the old month's allowance, and the two counters
    in this system would disagree about which month it is.
    """
    return time.strftime("%Y-%m", time.gmtime(now))


def _read() -> Dict[str, Any]:
    raw = store.read_json(BUDGET_FILE, dict(_EMPTY))
    if not isinstance(raw, dict):
        return dict(_EMPTY)
    return {
        "month": str(raw.get("month") or ""),
        "used": max(0, _int(raw.get("used"))),
        "chat_used": max(0, _int(raw.get("chat_used"))),
    }


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        # ⚠️ OverflowError, because int(float("inf")) raises it rather than
        # ValueError — the same trap policy.py hit two releases ago.
        return 0


def _write(state: Mapping[str, Any]) -> None:
    try:
        store.write_json(BUDGET_FILE, dict(state))
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("budget write failed", err)


def _rolled(now: Optional[float] = None) -> Dict[str, Any]:
    """State with the month rolled if the calendar moved."""
    state = _read()
    stamp = _month_of(now)
    if state["month"] != stamp:
        # ⚠️ ROLLING IS NOT WRITTEN HERE. A read must not have a side effect, or
        # a diagnostic that merely ASKS the remaining budget silently resets the
        # counter — and the reset would look exactly like a quiet month.
        return {"month": stamp, "used": 0, "chat_used": 0}
    return state


def limit_of(config: Optional[Mapping[str, Any]]) -> int:
    """The ceiling, from config. NEVER stored beside the counter."""
    # ⚠️ THE STORE'S OWN KEY, AND THIS READ A PREFIXED ONE NOTHING WRITES.
    # `/agent-config` saves `monthly_limit`; this asked for
    # `agent_monthly_limit`, so an owner's ceiling was accepted, returned 200,
    # and then ignored — the budget ran on its shipped default whatever they
    # set. The same defect was found and fixed in `policy.py` two releases ago
    # and NOT swept for elsewhere, which is `feedback_audit-applicable-set`
    # exactly: rolled out by the call site in view rather than by what the rule
    # applies to. `test_store_envelope` now derives the key set and refuses any
    # prefixed read anywhere under `agent/`.
    cfg = agent_config.view(config)
    raw = cfg.get("monthly_limit", DEFAULT_MONTHLY_LIMIT)
    value = _int(raw)
    return value if value > 0 else DEFAULT_MONTHLY_LIMIT


def chat_limit_of(config: Optional[Mapping[str, Any]]) -> int:
    cfg = agent_config.view(config)
    explicit = cfg.get("chat_monthly_limit")
    if explicit is not None:
        value = _int(explicit)
        if value > 0:
            return min(value, limit_of(config))
    return max(1, int(limit_of(config) * DEFAULT_CHAT_SHARE))


#: The ceiling an owner can actually reason about. ⚠️ MONEY PER DAY, BESIDE A
#: COUNT PER MONTH, AND THE TWO ARE NOT THE SAME CONTROL (2.752.0).
#: `monthly_limit` counts REQUESTS, which nobody can price: on the reference
#: villa one triage pass cost $0.010 and one investigation $0.37 — a 37x spread
#: inside one unit — so "4,000 requests" is a sentence with no dollar value and
#: an owner asking "why is this $8 a day" could not translate their own setting
#: into an answer. This is the control that makes the bill predictable whatever
#: else changes: a hard stop, in the unit on the invoice, on the clock an owner
#: thinks in.
#:
#: ⚠️ 0.0 MEANS OFF, AND OFF IS THE SHIPPED DEFAULT. This is a redistributable
#: add-on; a number chosen against THIS villa's rate would silently stop
#: supervision on a property with different equipment, which is the hard rule
#: this repo exists under. An owner who wants the guarantee sets it.
DAILY_USD_KEY: Final[str] = "daily_usd_limit"


def daily_limit_of(config: Optional[Mapping[str, Any]] = None) -> float:
    """The owner's daily ceiling in USD, or 0.0 for "no ceiling"."""
    raw = agent_config.view(config).get(DAILY_USD_KEY, 0.0)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.0
    return value if value > 0 else 0.0


def _day_start(now: Optional[float] = None) -> float:
    """Epoch seconds at the most recent LOCAL midnight.

    ⚠️ LOCAL, NOT UTC, because "today" is the owner's day — a villa at UTC+8
    told its allowance resets at 08:00 has been given a fact about our servers.
    `time.localtime` reads the container's TZ, which the add-on sets from Home
    Assistant's own timezone.
    """
    stamp = time.time() if now is None else float(now)
    parts = time.localtime(stamp)
    return stamp - (parts.tm_hour * 3600 + parts.tm_min * 60 + parts.tm_sec)


def spent_today(now: Optional[float] = None) -> float:
    """Provider spend since local midnight, in USD.

    ⚠️ READ FROM THE USAGE LEDGER, NOT COUNTED HERE. `reports.usage` already
    records every request with the provider's own token counts priced through
    one table; a second tally in this module would be a second number for one
    fact, and the first day they disagreed the owner would have no way to tell
    which was the bill. Never raises — `usage.rows` degrades to [].
    """
    total = 0.0
    for row in usage_mod.rows(since=_day_start(now)):
        try:
            total += float(row.get("cost") or 0.0)
        except (TypeError, ValueError):
            continue
    return total


def check(config: Optional[Mapping[str, Any]] = None, *,
          kind: str = "run", now: Optional[float] = None) -> Verdict:
    """May another request be made? Reads only; never increments.

    ⚠️ SEPARATE FROM `spend`, DELIBERATELY. A check that also counted would
    charge for a request that was never made — every dry run, every diagnostic,
    every path that asks and then declines for some other reason. The caller
    spends when it actually calls.
    """
    state = _rolled(now)
    limit = limit_of(config)
    used = state["used"]

    if used >= limit:
        return Verdict(False,
                       f"the monthly ceiling of {limit} requests is spent "
                       f"({used} used). It resets on the 1st.", used, limit)

    # ⚠️ THE DAILY CEILING BINDS BEFORE THE CHAT SUB-CEILING AND AFTER THE
    # MONTHLY ONE, and the order is the meaning: the monthly count is the
    # provider-contract ceiling, this is the owner's money, and the chat
    # allowance is a courtesy inside both. A daily stop applies to chat too —
    # unlike the chat sub-ceiling, which deliberately spares supervision —
    # because this one exists to bound the INVOICE and an exemption in it is a
    # ceiling with a way around it.
    daily = daily_limit_of(config)
    if daily > 0:
        today = spent_today(now)
        if today >= daily:
            return Verdict(False,
                           f"today's spending ceiling of ${daily:,.2f} is "
                           f"reached (${today:,.2f} so far). It resets at "
                           f"midnight.", used, limit)

    if kind == "chat":
        chat_limit = chat_limit_of(config)
        chat_used = state["chat_used"]
        if chat_used >= chat_limit:
            # ⚠️ CHAT DEGRADES; SUPERVISION DOES NOT. This is the whole point of
            # the sub-ceiling: the product is the supervision, and the
            # conversation is the interface to it.
            return Verdict(False,
                           f"today's conversation allowance is spent "
                           f"({chat_used} of {chat_limit} this month). "
                           f"Supervision is unaffected — ask me again after "
                           f"the 1st.", chat_used, chat_limit)

    return Verdict(True, "within budget", used, limit)


def spend(kind: str = "run", now: Optional[float] = None) -> int:
    """Record one request. Returns the new total.

    ⚠️ READ-MODIFY-WRITE, AND ADEQUATE BECAUSE THERE IS ONE WRITER — the
    agent runs inside the proxy's single event loop, and `store.write_json` is
    atomic, so a crash mid-write leaves the previous count whole rather than a
    truncated file. If a second writer ever appears this becomes wrong, which is
    why the assumption is written down instead of left to be inferred.
    """
    state = _rolled(now)
    state["used"] = state["used"] + 1
    if kind == "chat":
        state["chat_used"] = state["chat_used"] + 1
    _write(state)
    return int(state["used"])


def status(config: Optional[Mapping[str, Any]] = None,
           now: Optional[float] = None) -> Dict[str, Any]:
    """What the Cockpit and the brief show. Read-only."""
    state = _rolled(now)
    limit, chat_limit = limit_of(config), chat_limit_of(config)
    return {
        "month": state["month"],
        "used": state["used"], "limit": limit,
        "remaining": max(0, limit - state["used"]),
        "chat_used": state["chat_used"], "chat_limit": chat_limit,
        "chat_remaining": max(0, chat_limit - state["chat_used"]),
    }


class Breaker:
    """Open after N consecutive failures; closes again after a rest.

    ⚠️ IN MEMORY ON PURPOSE, WHICH IS THE OPPOSITE CALL FROM THE COUNTER ABOVE,
    and the difference is the point. The counter guards a MONTH and must survive
    a restart. The breaker guards MINUTES — a provider that is down right now —
    and a restart is exactly the moment it is worth trying again. Persisting it
    would keep the agent silent after a reboot that might have fixed things.
    """

    def __init__(self, failures: int = BREAKER_FAILURES,
                 reset_s: float = BREAKER_RESET_S) -> None:
        self.failures, self.reset_s = failures, reset_s
        self._count = 0
        self._opened_at = 0.0

    def is_open(self, now: Optional[float] = None) -> bool:
        moment = time.monotonic() if now is None else now
        if self._count < self.failures:
            return False
        if moment - self._opened_at >= self.reset_s:
            self._count = 0
            return False
        return True

    def record_failure(self, now: Optional[float] = None) -> None:
        self._count += 1
        if self._count >= self.failures:
            self._opened_at = time.monotonic() if now is None else now

    def record_success(self) -> None:
        self._count = 0


#: ⚠️ ONE PROCESS-WIDE BREAKER, for the reason `providers.shared()` records: a
#: breaker constructed per run starts closed every time, which is not a breaker.
_BREAKER: Optional[Breaker] = None


def shared_breaker() -> Breaker:
    global _BREAKER
    if _BREAKER is None:
        _BREAKER = Breaker()
    return _BREAKER
