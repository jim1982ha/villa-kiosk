"""What the add-on prints, and how much of it.

⚠️ THIS EXISTS BECAUSE `log_level` WAS A SETTING THAT DID NOTHING. The manifest
declared it, the Configuration page explained it, `Options` read it — and every
line the layer emitted was a bare `print`, so turning it down changed nothing an
operator could observe. That is the same two-correct-halves defect
`test_manifest_matches_options.py` was written to catch, arriving from the other
side: a field both halves agree on that no third thing honours.

Deliberately not `logging`: s6 captures stdout and the Supervisor renders it, so
a line and a flush is the whole requirement, and a logging config is one more
thing that can be wrong in a container nobody can attach to.
"""
from __future__ import annotations

import sys

#: Home Assistant's own add-on log levels, quietest last.
LEVELS = ("trace", "debug", "info", "notice", "warning", "error", "fatal")

_threshold = LEVELS.index("info")


def configure(level: str) -> None:
    """Set the quietest level that still prints. An unknown name means info."""
    global _threshold
    _threshold = LEVELS.index(level.strip().lower()) if level.strip().lower() in LEVELS \
        else LEVELS.index("info")


def current_level() -> str:
    return LEVELS[_threshold]


def _emit(level: str, message: str) -> None:
    if LEVELS.index(level) >= _threshold:
        print(message, flush=True, file=sys.stdout)


def debug(message: str) -> None:
    _emit("debug", message)


def info(message: str) -> None:
    _emit("info", message)


def warning(message: str) -> None:
    _emit("warning", message)


def error(message: str) -> None:
    _emit("error", message)
