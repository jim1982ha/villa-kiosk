"""One logging entry point for the whole reports subsystem.

The add-on has no logging framework and does not want one: the proxy prints
`[supervisor-proxy] ...` with `flush=True` and that is read directly from the
Home Assistant add-on log, which is how every field diagnosis in this project
has actually been made (see CLAUDE.md — three ceiling bugs in a row were
diagnosed from owner-pasted kiosk logs).

`flush=True` is not decoration. Python block-buffers stdout when it is not a
TTY, which is exactly the case under s6, so an unflushed line can sit in a
buffer for minutes and — critically — is LOST if the process is killed. Losing
the last line before a crash loses the only line that mattered.

The tag differs from the proxy's on purpose: `[reports]` makes this subsystem's
output greppable in an add-on log that carries everything else too.
"""

from __future__ import annotations

import sys
import traceback
from typing import Any

TAG = "[reports]"


def log(msg: str) -> None:
    """One line to the add-on log."""
    print(f"{TAG} {msg}", flush=True)


def warn(msg: str) -> None:
    """A line that names something wrong but survivable.

    Deliberately still stdout, not stderr: s6 interleaves the two with no
    ordering guarantee, and a warning that sorts away from the line explaining
    it is a warning that costs a round-trip to interpret.
    """
    print(f"{TAG} WARNING: {msg}", flush=True)


def swallow(what: str, err: BaseException) -> None:
    """Report an exception that is being deliberately absorbed.

    The subsystem's contract is DEGRADE, NEVER FAIL, which makes bare `except`
    blocks common here — and a silent one is indistinguishable from code that
    never ran. This makes the absorption visible without letting it propagate.

    The traceback goes out on the same stream, because "reports failed" without
    a stack has cost this project whole diagnosis rounds before.
    """
    print(f"{TAG} ERROR: {what}: {type(err).__name__}: {err}", flush=True)
    traceback.print_exception(type(err), err, err.__traceback__, file=sys.stdout)
    sys.stdout.flush()


def redact(value: Any) -> str:
    """Render a value that MAY be a credential, for logging.

    Phase 6 stores provider API keys. A key that reaches the add-on log is
    disclosed to anyone the owner ever sends a log to — which, in this project,
    is routine: debugging here is done by pasting kiosk logs into a chat.

    Never prints the value. The length is kept because "configured but wrong
    length" and "not configured" are different faults, and the prefix is
    omitted entirely — four characters of an API key is still four characters
    of an API key.
    """
    if value is None:
        return "<unset>"
    text = str(value)
    if not text:
        return "<empty>"
    return f"<redacted len={len(text)}>"
