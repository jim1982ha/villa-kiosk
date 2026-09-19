"""Now, in the zone the operator asked for.

⚠️ THIS EXISTS BECAUSE `timezone` WAS A SETTING THAT DID NOTHING. It was
declared, explained and read, and then every timestamp the layer wrote was UTC
regardless — a field an operator can change with no observable effect, which is
worse than not offering it.

Empty means UTC **for now**, and that is a narrowing of what the manifest
promises ("ask Home Assistant"): asking Home Assistant needs a gateway read that
this release has no reason to make yet. The help text says empty follows Home
Assistant; until the layer reads it, UTC is what it follows. A timestamp in the
wrong zone is a small wrong; a timestamp that claims a zone it is not in is a
larger one, so `zone_name()` reports what is actually in use.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from agent import log


class SystemClock:
    def __init__(self, tz_name: str = "") -> None:
        self._name = "UTC"
        self._tz = timezone.utc
        wanted = (tz_name or "").strip()
        if wanted:
            try:
                self._tz = ZoneInfo(wanted)
                self._name = wanted
            except (ZoneInfoNotFoundError, ValueError, KeyError):
                # ⚠️ NAMED, NOT SWALLOWED. A typo'd zone silently falling back
                # to UTC is how every timestamp in a report ends up an hour out
                # with nothing to explain it.
                log.warning(f"  time zone {wanted!r} is not one this system knows "
                            f"— using UTC")

    def zone_name(self) -> str:
        return self._name

    def now(self) -> datetime:
        return datetime.now(self._tz)

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
