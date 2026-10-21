"""What a device did over a stretch of time: the investigation's period kinds and the words that say them.

The investigate skill cuts a device's history into periods of one kind each (investigate.py `periods`, `cycles`); the
reports skill's investigation page says them — in its facts ("the pump stopped reporting for 1 h 15 min") and as the
bands of its charts. A skill never imports another skill's folder, so the kinds and their words live here, once
(architecture review, 2026-10-13: the two folders matched each other's words by their first letters, each with its own
table, and a renamed kind would have read as "unusual" without a word).
"""
from __future__ import annotations

RUNNING, IDLE, NO_POWER, OFFLINE, NO_VALUE = "running", "idle", "no power", "offline", "no value"
#: a run of short starts and stops, said with its count: restarts(8) = "stops and restarts 8 times"
RESTARTS = "stops and restarts"

#: kind → (what the device did, as a sentence of the page says it; what a chart's band says it was)
#: ⚠️ PLAIN WORDS (owner, 2026-10-12: "what is supply? what is stop-start?")
WORDS = {
    NO_POWER: ("had no power", "read 0: no power reached it"),
    OFFLINE: ("stopped reporting", "stopped reporting"),
    NO_VALUE: ("reported no value", "reported no value"),      # it answers, with nothing to give: never "stopped"
    RESTARTS: ("stopped and restarted", "kept stopping and restarting"),
    RUNNING: ("ran", "ran longer or harder than usual"),
    IDLE: ("drew more than usual at rest", "drew more than usual at rest"),       # flagged only so (investigate)
}


def restarts(n: int) -> str:
    return f"{RESTARTS} {n} times"


def base(kind) -> str:
    """The kind a period's `kind` is ("stops and restarts 8 times" is RESTARTS); any other text as it is."""
    k = str(kind or "")
    return RESTARTS if k.startswith(RESTARTS) else k


def did(kind) -> str:
    """What the device did: "had no power", "stopped and restarted 8 times"; a kind with no words (a state) as it is."""
    k = base(kind)
    if k not in WORDS:
        return str(kind or "")
    return WORDS[k][0] + str(kind)[len(RESTARTS):] if k == RESTARTS else WORDS[k][0]


def band(kind) -> str | None:
    """What a chart's band of this kind says; None for a kind no band names."""
    w = WORDS.get(base(kind))
    return w[1] if w else None
