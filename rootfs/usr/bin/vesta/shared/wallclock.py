"""Rendering an instant for someone to READ. Pure; the one owner of that rule.

⚠️ THIS EXISTS BECAUSE THE VILLA WAS TOLD ITS OWN EVENING HAPPENED AT LUNCHTIME.
An alert delivered to the owner read "a brief connectivity glitch on 2026-09-12
at 12:20 UTC". The arithmetic was right — the villa is UTC+8, so that is 20:20
on its own wall clock — and the sentence was still unreadable, because nobody at
a property reads UTC. A reader converting an alert by hand before deciding
whether it matters is a reader who will eventually convert it wrong.

⚠️ IT IS THE OPPOSITE END OF `instants.py` AND THE TWO MUST NOT BE CONFUSED.
That module normalises everything to UTC so stamps can be COMPARED — ordering
ISO-8601 text lexicographically is only chronological when both sides carry the
same offset, and getting that wrong once silently dropped the first eight hours
of every local day from the daily brief. Comparison stays in UTC forever. This
module is only ever the last step before a human or a language model reads the
value, and it never feeds a comparison.

⚠️ THE OFFSET IS ALWAYS SHOWN, and that is the part that makes this safe. A
bare "20:20" that escapes into a log or a stored record is ambiguous forever;
"2026-09-12T20:20:27+08:00" is the villa's wall clock AND fully ordered, so a
value rendered here can still be parsed back by `instants.as_utc` without loss.

⚠️ THE ZONE IS A REQUIRED ARGUMENT WITH NO DEFAULT. A module-level default
would be a policy every caller inherits without knowing it — the shape this
repository keeps paying for. The kiosk's own `shared/when.ts` reached the same
conclusion from the other side and scoped the villa's wall clock OUT of itself
deliberately: a tablet renders in the READER's zone, a Telegram alert must
render in the PROPERTY's, and a single helper that tried to be both would be
wrong on one of them. `supervise/agent/clock.py` resolves which zone this is.

Pure — no clock, no I/O, no environment — which is what keeps `shared`
importable from `adapters` and `supervise` alike.
"""

from __future__ import annotations

from datetime import datetime, tzinfo
from typing import Any, Optional

from vesta.shared import instants


def for_reader(value: Any, zone: tzinfo) -> str:
    """An instant as the villa's own wall clock, offset shown.

    Returns `""` for anything unreadable, which is the same answer
    `instants.as_utc` gives and for the same reason: a briefing must not fail
    to be delivered over a timestamp. A caller that needs to tell "no stamp"
    from "bad stamp" should ask `instants.as_utc` first.
    """
    moment: Optional[datetime] = instants.as_utc(value)
    if moment is None:
        return ""
    return moment.astimezone(zone).isoformat(timespec="seconds")


def day_for_reader(value: Any, zone: tzinfo) -> str:
    """The villa's own calendar day for an instant — `YYYY-MM-DD`.

    ⚠️ NOT `str(stamp)[:10]`. Slicing a UTC stamp files the villa's whole
    evening under the following day on any property east of Greenwich, which is
    how a 20:20 event becomes a row in tomorrow's bucket.
    """
    moment: Optional[datetime] = instants.as_utc(value)
    if moment is None:
        return ""
    return moment.astimezone(zone).strftime("%Y-%m-%d")
