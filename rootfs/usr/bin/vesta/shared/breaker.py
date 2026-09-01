"""Stop calling a provider that is down. One implementation, two callers.

⚠️ THIS WAS THE SAME CLASS TWICE, BYTE FOR BYTE (/dry-audit, 2026-09-02).
`brief/narrate/providers.py` and `supervise/agent/budget.py` each carried a
`Breaker` of 816 characters, four methods, identical code and identical
constants — and `budget.py` even said so: "Same shape and same numbers as
`providers.Breaker`, for the same reason." That comment explained why the
NUMBERS are 3 and 1800; it never named a constraint requiring two copies, so
there was nothing for a third caller to join and nothing to keep the pair in
step. The layering already allowed this home: `shared` imports nothing, and
both `brief` and `supervise` may import `shared`.

⚠️ THE `adapters.hass` BREAKER IS DELIBERATELY NOT THIS ONE, AND MUST NOT BE
CONVERGED INTO IT. It guards Home Assistant's own websocket rather than a paid
provider, so its numbers differ (5 failures, 300s) — and its SEMANTICS differ,
which is the part a reader skims past: on reset it sets `failures = MAX - 1`,
leaving the circuit HALF-OPEN so exactly one trial call decides whether to close
it. This class resets to zero and lets the next `failures` calls all through.
Two behaviours, not two spellings of one.

⚠️ IN MEMORY, NEVER PERSISTED, and that is the opposite call from the monthly
counter that lives beside it in `budget.py`. The counter guards a MONTH and must
survive a restart. This guards MINUTES — a provider that is down right now — and
a restart is exactly the moment it is worth trying again. Persisting it would
keep the agent silent after a reboot that might have fixed things.
"""

from __future__ import annotations

import time
from typing import Final, Optional

#: ⚠️ SIZED, NOT PICKED. A provider that is down stays down for minutes, and
#: retrying every cycle is how a rate limit becomes a ban. Half an hour is long
#: enough that a scheduled pass does not hammer a failing endpoint and short
#: enough that a transient outage does not cost a whole day of briefs.
BREAKER_FAILURES: Final[int] = 3
BREAKER_RESET_S: Final[float] = 1800.0


class Breaker:
    """Open after N consecutive failures; closes again after a rest."""

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
