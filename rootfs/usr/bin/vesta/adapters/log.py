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

import contextlib
import os
import sys
import time
import traceback
from contextvars import ContextVar
from typing import Any, Dict, Iterator, List, Tuple

TAG = "[reports]"

#: The pass this line belongs to, or "" outside one. ⚠️ A CONTEXTVAR AND NOT AN
#: ARGUMENT, WHICH IS THE WHOLE REASON THIS IS AFFORDABLE. Threading an id
#: through would touch every signature between the scheduler and
#: `task.raise_for` — eight modules — and the first one that forgot to pass it on
#: would break the correlation silently. asyncio copies the context when a task
#: is created, so the scheduled clock and an owner's button press are two tasks
#: with two ids and their lines cannot be confused for each other even when they
#: overlap. That overlap is not hypothetical: the button exists to be pressed at
#: a moment nobody chose relative to a six-hourly clock.
PASS: ContextVar[str] = ContextVar("vesta_pass", default="")


def log(msg: str) -> None:
    """One line to the add-on log, tagged with the pass when inside one."""
    ident = PASS.get()
    print(f"{TAG} {f'{ident} ' if ident else ''}{msg}", flush=True)


def stage(name: str, detail: str) -> None:
    """One TIER of one pass reporting what it received and what it produced.

    ⚠️ EVERY TIER CALLS THIS, INCLUDING THE ONES THAT DID NOTHING. A tier that
    logs only when it acts is the instrument shape this project has now been
    caught by five times (`feedback_instruments-never-skip`): "no line" and
    "nothing to do" are indistinguishable in a log, so a tier that never ran
    reads exactly like a quiet villa. `outbox: nothing waiting` is a fact;
    silence is an unanswered question, and answering it has cost whole rounds.

    ⚠️ THE FORMAT IS `tier: detail` AND THE TIER NAMES ARE THE ARCHITECTURE'S
    OWN — document, triage, reason, concern, route, outbox, escalation, task —
    so a capture can be laid beside the tier diagram in the HLD and read box by
    box. That is exactly the question a first end-to-end test is run to answer.
    """
    log(f"{name}: {detail}")


#: Everything one pass wants to report about itself, printed once at its end.
#:
#: ⚠️ A CONTEXTVAR FOR THE SAME REASON `PASS` IS ONE, AND THE ARGUMENT IS THE
#: FILE'S OWN (2026-08-30). A census assembled by RETURN VALUES would have to
#: thread a dict through every signature between the scheduler and the tools —
#: the eight modules `PASS` exists to avoid touching — and the first tier that
#: forgot to pass it on would drop its facts silently, which is precisely the
#: failure a census exists to make impossible.
#:
#: ⚠️ IT IS FOR NUMBERS AND SHORT WORDS, NEVER PROSE OR IDS. It is printed, so
#: everything `redact` refuses in a payload is refused here by the same
#: judgement: an entity id must not reach it, and a device list must be COUNTED
#: rather than listed.
_CENSUS: ContextVar[Dict[str, Any]] = ContextVar("vesta_census", default={})


def tally(key: str, n: int = 1) -> None:
    """Add `n` to this pass's counter `key`. Silent outside a pass.

    ⚠️ NEVER RAISES. A census is a diagnostic, and the whole contract of this
    module is that logging cannot take down the thing it describes.
    """
    try:
        book = _CENSUS.get()
        if book is not None:
            book[key] = int(book.get(key, 0)) + int(n)
    except Exception:  # noqa: BLE001 - a counter must not fail the pass
        pass


def note(key: str, value: Any) -> None:
    """Record one fact about this pass, replacing any earlier value."""
    try:
        book = _CENSUS.get()
        if book is not None:
            book[key] = value
    except Exception:  # noqa: BLE001 - a note must not fail the pass
        pass


def census() -> Dict[str, Any]:
    """This pass's facts so far. A copy: a reader must not be able to edit it."""
    try:
        return dict(_CENSUS.get() or {})
    except Exception:  # noqa: BLE001
        return {}


#: Order the census prints in — the tier order of the architecture, so a capture
#: reads down the pipeline. Anything not named here prints after, sorted, so a
#: new counter is never invisible merely because nobody updated this list.
CENSUS_ORDER: Tuple[str, ...] = (
    "doc_salient", "doc_standing", "doc_concerns", "doc_coverage",
    "escalated", "identified", "deferred",
    "investigated", "evidence_rows", "turns", "tool_calls", "tool_errors",
    "concerns_opened", "concerns_refused",
    "delivered", "tasks", "suppressed",
    "tokens_in", "tokens_out", "usd",
)


def _census_line(book: Dict[str, Any]) -> str:
    """The census as one line, or "" when the pass recorded nothing."""
    if not book:
        return ""
    named = [k for k in CENSUS_ORDER if k in book]
    rest = sorted(k for k in book if k not in CENSUS_ORDER)
    parts: List[str] = []
    for key in named + rest:
        value = book[key]
        parts.append(f"{key}={value:.4f}" if isinstance(value, float)
                     else f"{key}={value}")
    return " ".join(parts)


@contextlib.contextmanager
def pass_scope(kind: str) -> Iterator[str]:
    """Mark every line of one supervision pass with a shared id, and time it.

    ⚠️ THE ID IS SHORT AND RANDOM, NOT A COUNTER. A counter would have to
    persist to survive a restart, and a restart is exactly when two passes are
    most easily confused; four hex characters collide rarely enough for a log
    window and cost nothing.

    ⚠️ THE END LINE IS EMITTED ON EVERY PATH, INCLUDING AN EXCEPTION. A pass
    that starts and never finishes is the single most important thing this trace
    can show, and `finally` is the only construct that cannot forget.
    """
    ident = os.urandom(2).hex()
    # ⚠️ RESTORED BY `set(previous)`, NOT BY A TOKEN. `ContextVar.reset` raises
    # `ValueError` when the token was created in a different Context, which is
    # reachable if a scope is ever entered and left across a task boundary — and
    # this module's whole contract is that logging can never take down the thing
    # it is describing. Restoring the previous value is observably identical
    # (the default is "") and cannot raise. It also keeps `test_reachability`
    # honest: its caller regex matches `.reset(` anywhere in shipped code, so a
    # token reset here would have marked `chat.reset` as called by a file that
    # has never heard of it.
    previous = PASS.get()
    PASS.set(ident)
    # ⚠️ A FRESH DICT PER PASS, SET HERE RATHER THAN DEFAULTED. The ContextVar's
    # default is a single shared `{}`; contributing to that would accumulate
    # across every pass in the process and report the sum as one run's figures.
    previous_book = _CENSUS.get()
    _CENSUS.set({})
    started = time.monotonic()
    log(f"── {kind} pass begins ──")
    try:
        yield ident
    finally:
        # ⚠️ BEFORE THE END LINE AND INSIDE THE `finally`, so a pass that RAISED
        # still reports what it managed to do — which is the case a census is
        # most worth having, and the one a `try`-suffix version would lose.
        line = _census_line(_CENSUS.get())
        if line:
            log(f"census: {line}")
        log(f"── {kind} pass ends after {time.monotonic() - started:.1f}s ──")
        _CENSUS.set(previous_book)
        PASS.set(previous)


def warn(msg: str) -> None:
    """A line that names something wrong but survivable.

    Deliberately still stdout, not stderr: s6 interleaves the two with no
    ordering guarantee, and a warning that sorts away from the line explaining
    it is a warning that costs a round-trip to interpret.

    ⚠️ IT CARRIES THE PASS ID FOR THE SAME REASON, AND DID NOT UNTIL 2.768.0.
    A warning is the line a reader jumps to first, and an unstamped one sitting
    between two stamped passes belongs to whichever the reader assumes — the
    trace's correlation failing at exactly the line it exists to explain.
    """
    log(f"WARNING: {msg}")


def swallow(what: str, err: BaseException) -> None:
    """Report an exception that is being deliberately absorbed.

    The subsystem's contract is DEGRADE, NEVER FAIL, which makes bare `except`
    blocks common here — and a silent one is indistinguishable from code that
    never ran. This makes the absorption visible without letting it propagate.

    The traceback goes out on the same stream, because "reports failed" without
    a stack has cost this project whole diagnosis rounds before.
    """
    # ⚠️ THE HEADER IS STAMPED, THE TRACEBACK IS NOT. A stack is many lines in a
    # format Python owns; prefixing each would break the shape every reader and
    # every tool recognises. The header carries the correlation, and the stack
    # directly follows it.
    log(f"ERROR: {what}: {type(err).__name__}: {err}")
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
