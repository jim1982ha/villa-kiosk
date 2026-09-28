"""The host's one way to print: level-filtered, prefixed, redacted."""
from __future__ import annotations

import sys

from .redact import Redactor

LEVELS = {"debug": 10, "info": 20, "warning": 30, "error": 40}
_state = {"level": LEVELS["info"], "redact": Redactor()}


def configure(level: str, redactor: Redactor) -> None:
    _state["level"] = LEVELS.get(level, LEVELS["info"])
    _state["redact"] = redactor


def log(level: str, msg: str) -> None:
    if LEVELS[level] < _state["level"]:
        return
    line = _state["redact"](f"[vesta-agent-host] {level.upper():7} {msg}")
    print(line, file=sys.stdout, flush=True)
