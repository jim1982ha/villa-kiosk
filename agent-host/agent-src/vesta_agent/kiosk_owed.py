"""What the VESTA Kiosk did not take, owed and sent again: one mechanism for every kind of record the agent writes there.

⚠️ A COPY NOT TAKEN IS OWED, NOT LOST — FOR A TURN AS FOR A MESSAGE (architecture review round 16). kiosk_messages.py
owed an alert card the Kiosk did not keep and sent its newest copy again at housekeeping (round 3), but held what it owed
in memory: a restart lost it. A tablet's answer (tablet.py) was written once: a Kiosk restarting or slow, and the
person's answer never appeared. Now both kinds go through here:

  owe     the newest copy of a key the Kiosk did not take, kept in the agent's state (state.kiosk_owed): a restart keeps
          it, and a newer copy of the same key replaces it — an alert closed meanwhile is sent closed, never as it stood
  paid    the Kiosk took a copy of that key (or a newer one is on its way): nothing owed
  retry   the housekeeping pass, every kiosk.message_retry_s and at the first pass after a start: each copy owed handed
          back to its kind's writer (`sends`), which owes it again if the Kiosk still does not take it

Never in the critical path: what is owed waits here; an alert, Telegram and the conversation never wait on it.
"""
from __future__ import annotations

import inspect
import logging
from typing import Awaitable, Callable

from .cadence import Every

log = logging.getLogger("vesta.kiosk")

#: How many copies are owed at most, every kind together: the oldest go first (a Kiosk gone for days).
REMEMBERED = 500
#: The kinds of record owed: a message kept for the tablet (kiosk_messages.py), a conversation turn (tablet.py).
MESSAGE, TURN = "message", "turn"


class KioskOwed:
    """See the module's note. `retry_s` () → kiosk.message_retry_s, read at each pass (the Limits tab applies at once)."""

    def __init__(self, state, retry_s: Callable[[], float] = lambda: 300.0):
        self.state = state
        self._retry_s = retry_s
        self._every = Every(lambda: self._retry_s())
        self._senders: dict[str, Callable[[str, dict], Awaitable | None]] = {}
        # what is owed, by (kind, key): read once from the state, then kept in step with it (a push asks at every copy)
        self._keys: set[tuple[str, str]] = {(kind, key) for kind, key, _ in state.kiosk_owed()}

    def sends(self, kind: str, send: Callable[[str, dict], Awaitable | None]) -> None:
        """`send(key, record)` writes a copy of `kind` again (owing it again when the Kiosk still does not take it)."""
        self._senders[kind] = send

    def owe(self, kind: str, key: str, record: dict) -> None:
        """The newest copy of `key` the Kiosk did not take: owed until it takes one."""
        self.state.set_kiosk_owed(kind, key, record, REMEMBERED)
        self._keys.add((kind, key))
        if len(self._keys) > REMEMBERED:
            self._keys = {(k, key) for k, key, _ in self.state.kiosk_owed()}

    def paid(self, kind: str, key: str) -> None:
        """Nothing owed for `key` any more (the Kiosk took it, or a newer copy is on its way)."""
        if (kind, key) in self._keys:
            self._keys.discard((kind, key))
            self.state.set_kiosk_owed(kind, key, None, REMEMBERED)

    def owes(self, kind: str, key: str) -> dict | None:
        """The copy owed for `key` now, if any."""
        if (kind, key) not in self._keys:
            return None
        return next((rec for k, ky, rec in self.state.kiosk_owed() if (k, ky) == (kind, key)), None)

    def keys(self, kind: str) -> list[str]:
        """The keys of `kind` owed now, oldest first."""
        return [key for k, key, _ in self.state.kiosk_owed() if k == kind]

    async def retry(self) -> int:
        """The housekeeping pass: every copy owed written again, at most once per kiosk.message_retry_s (the first pass
        after a start at once) — how many."""
        if not self._keys or not self._every.due():
            return 0
        owed = self.state.kiosk_owed()
        for kind, key, rec in owed:
            send = self._senders.get(kind)
            if send is None:
                continue                    # no writer of that kind in this agent (a test's): kept owed
            got = send(key, rec)
            if inspect.isawaitable(got):
                await got
        if owed:
            log.info("VESTA Kiosk: %s copy(ies) the tablet did not get sent again", len(owed))
        return len(owed)
