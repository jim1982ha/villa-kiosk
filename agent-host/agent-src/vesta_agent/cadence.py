"""How often a piece of housekeeping runs: every N seconds, at once on the first round.

⚠️ ONE CLOCK FOR "EVERY N SECONDS" (architecture review round 16): app.Vesta kept a hand-made timestamp per job, each
started its own way. The Kiosk's faults started at 0.0 and were checked against time.monotonic(), which starts at the
machine's boot: on a machine up for less than 5 minutes (a power cut) the first read waited until then; its twin, the
villa's lists of who gets the messages, had been fixed alone (0.6.422, started at None). Now each job declares its
cadence here, and the first round runs at once by construction.
"""
from __future__ import annotations

import time
from typing import Callable


class Every:
    """Due every `seconds` (a number, or a setting read at each round: the Limits tab applies at once), and at the first
    round — never a wait measured from a clock that may have started just now."""

    def __init__(self, seconds: float | Callable[[], float]):
        self._seconds = seconds if callable(seconds) else (lambda: float(seconds))
        self._last: float | None = None     # None: never run, due at the first round

    def due(self) -> bool:
        """True when the job runs now (and its clock starts again from now); False until its time has come."""
        now = time.monotonic()
        if self._last is not None and now - self._last < self._seconds():
            return False
        self._last = now
        return True

