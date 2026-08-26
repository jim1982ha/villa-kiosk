"""Every run and every action, visible after the fact. CTR-020.

⚠️ AN INTENT ROW BEFORE AND AN OUTCOME ROW AFTER, AND THE GAP IS THE POINT. One
row written after the fact cannot describe a crash mid-action: the action either
appears to have succeeded or never to have been attempted, and those are the two
readings a person most needs to tell apart. A pair with no outcome is a
half-finished action, and it says so by existing.

⚠️ APPEND-ONLY. A row is never edited, never corrected, never removed. An
outcome does not amend its intent — it is a SECOND row referring to the same
`action_key`. The moment a row can be rewritten, the record stops being evidence
and becomes a summary, and the summary is written by the thing being audited.

⚠️ THE DIGEST, NEVER THE ARGUMENTS. `contracts.args_digest` fingerprints a call;
the raw blob would carry entity ids, free text and whatever a guest typed into a
fault report, into a file whose whole purpose is to be kept and read later. The
digest answers "was this the same call", which is all this file ever asks.

⚠️ AND IT IS THE ASSERTION SURFACE THAT PROVES ONE GATE SERVES BOTH PATHS. The
in-process agent and any MCP caller must produce IDENTICAL audit rows for the
same action — that is how "a relocated agent gains no permission it did not
have" stops being a claim and becomes something a test can fail on. If the two
paths ever write different rows, they are not going through the same gate.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Final, List, Mapping, Optional, Tuple

from agent import contracts
from reports import store
from reports.log import swallow

AUDIT_FILE: Final[str] = f"{store.DATA_DIR}/vesta/audit.json"

#: ⚠️ BOUNDED, AND THE RISK IS NAMED IN THE TASK: an unbounded ledger fills the
#: disk on a property nobody visits. A row is ~200 bytes, so 20,000 is ~4 MB —
#: months of ordinary use, and asserted in the tests rather than trusted.
MAX_ROWS: Final[int] = 20_000

#: What a row may contain. ⚠️ AN ALLOW-LIST, so a field added to a caller cannot
#: reach this file without somebody writing its name here — the same discipline
#: `redact.py` uses, for the same reason.
ROW_FIELDS: Final[Tuple[str, ...]] = (
    "at", "run_id", "actor", "tool", "args_digest", "verdict", "outcome",
    "action_key", "detail",
    # ⚠️ A TRIAGE PASS'S NUMBERS, STORED AS THEMSELVES AND NOT ONLY AS PROSE.
    # `record_pass` RECEIVES all three and used to join them into `detail`
    # ("… | doc=5078c/48L | escalated=2"), which reads well on the panel and is
    # a string to everything else — so the CSV an owner exports for the cutover
    # decision could only recover the one figure that decides it by re-parsing
    # my own sentence. This package's own rule is that "the data is not there"
    # beats "the filter is careful"; the same applies to "the data is prose".
    # `detail` keeps carrying the rendered line, because the panel reads it and
    # a reader wants the sentence.
    "doc_chars", "doc_lines", "escalated", "model",
    # ⚠️ THE MODE THIS CHECK RAN UNDER, STORED BECAUSE IT CANNOT BE RECOVERED
    # LATER. What a flag was allowed to become is decided at the moment the
    # check runs — queued for a person, investigated silently, or investigated
    # and delivered — and the panel has to show the affordance that MATCHED.
    # Reading the CURRENT setting instead would relabel history every time an
    # owner changed their mind, which is the same class of error as reading a
    # threshold at render time.
    "mode",
    # ⚠️ THE ESCALATED SUBJECT, AS ITSELF. It was in `detail` alone, which is
    # prose — and the approval queue has to hand a subject BACK to the
    # investigation loop when a person presses approve. Recovering it by
    # splitting my own sentence is precisely what the `doc_chars` note above
    # was written about, one release earlier and in this same file.
    "subject",
)

#: Rows describing an intent that never got an outcome. Named because the count
#: of these is the single most useful number this file produces.
PENDING: Final[str] = "pending"

_EMPTY: Final[Dict[str, Any]] = {"rows": []}


class Replayed(Exception):
    """This action_key has already been acted on. Refuse, do not repeat.

    ⚠️ AN EXCEPTION RATHER THAN A FALSE, DELIBERATELY. Every other refusal in
    this subsystem is a value, because the caller is expected to carry on. This
    one is not: a replayed action means the caller believes it has not acted
    when it has, and continuing past that quietly is how a pump gets switched
    twice. It must interrupt.
    """


def _read() -> Dict[str, Any]:
    raw = store.read_json(AUDIT_FILE, dict(_EMPTY))
    if not isinstance(raw, dict):
        return {"rows": []}
    rows = raw.get("rows")
    return {"rows": [r for r in rows if isinstance(r, dict)]
            if isinstance(rows, list) else []}


def _now_iso(now: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))


def _clean(row: Mapping[str, Any]) -> Dict[str, Any]:
    """A row reduced to the allow-list, with every value a string.

    ⚠️ STRINGIFIED ON THE WAY IN. A row holding a nested object is a row that
    can carry a raw argument blob inside a field name that was approved — the
    same bypass `redact.py` closes one level up.
    """
    out: Dict[str, Any] = {}
    for field in ROW_FIELDS:
        if field not in row:
            continue
        value = row[field]
        if value is None:
            continue
        out[field] = str(value)
    return out


def _append(row: Mapping[str, Any]) -> bool:
    try:
        state = _read()
        rows = list(state["rows"]) + [_clean(row)]
        if len(rows) > MAX_ROWS:
            # ⚠️ THE OLDEST GO. An audit that dropped NEW rows would go blind
            # exactly when the villa got busy, which is when it is read.
            rows = rows[-MAX_ROWS:]
        store.write_json(AUDIT_FILE, {"rows": rows})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("audit write failed", err)
        return False
    return True


# ── runs ────────────────────────────────────────────────────────────────────
def record_run(run_id: str, *, actor: str, trigger: str,
               verdict: str = "started", detail: str = "", subject: str = "",
               now: Optional[float] = None) -> bool:
    """One row for a run's start or end. No action_key — a run is not an action."""
    return _append({
        "at": _now_iso(now), "run_id": str(run_id), "actor": str(actor),
        "tool": f"run:{trigger}", "verdict": str(verdict), "detail": detail,
        "subject": subject,
    })


#: A queued escalation waiting for a person, and what settles one.
#: ⚠️ SETTLED BY ANY LATER ROW SHARING THE RUN ID, not by a status field on the
#: queued row. This file's first rule is that a row is never edited — an outcome
#: is a SECOND row — so a queue derived from "has anything else happened to this
#: run id" inherits that property for free. A `pending` flag would have to be
#: rewritten, which is the moment the record stops being evidence.
AWAITING: Final[str] = "awaiting-approval"


def pending_escalations() -> List[Dict[str, Any]]:
    """Escalations queued for a person and not yet acted on. Newest last.

    ⚠️ DERIVED, NEVER STORED. A second store holding the queue is a second store
    that disagrees with the audit the first time either is written by hand — and
    the audit already contains every fact the queue needs. It is also why
    approving cannot lose an item: approval writes a row with the SAME run id,
    which is what removes it from here.
    """
    rows_all = _read()["rows"]
    queued = [r for r in rows_all if str(r.get("verdict") or "") == AWAITING]
    settled = {str(r.get("run_id") or "") for r in rows_all
               if str(r.get("verdict") or "") not in ("", AWAITING)}
    return [r for r in queued if str(r.get("run_id") or "") not in settled]


def record_pass(*, reason: str, trigger: str, doc_chars: int,
                doc_lines: int, escalated: int, subjects: str = "",
                model: str = "", run_id: str = "", mode: str = "",
                now: Optional[float] = None) -> bool:
    """One row for EVERY triage pass, including the quiet ones.

    ⚠️ THE QUIET PASSES ARE THE WHOLE POINT. `run_once` already returned a
    precise reason — "agent disabled", "budget: …", "no model provider
    configured", "nothing to escalate" — and that string went to the add-on log
    and nowhere a reader could reach. So the evidence an owner was handed for
    the PH-3 cutover ("rules found ten, the agent found none") was identical
    whether the agent had looked and stayed quiet or had never run at all, which
    is the one distinction the whole decision rests on. Four review rounds were
    spent on that ambiguity before this row existed.

    ⚠️ `doc_chars`/`doc_lines` ARE NOT PADDING. A pass that legitimately found
    nothing and a pass handed an empty villa document both report "nothing to
    escalate", and only the document size separates them — that is the failure
    this cannot be allowed to hide, because it looks exactly like success.
    """
    return _append({
        # ⚠️ A REAL ID SINCE 2.780.0, AND IT IS THE JOIN KEY. This was `""`,
        # so a check and the flags it produced had NOTHING in common: a flag's
        # id is `f"{trigger}{stamp}-e{N}"` and the only way to pair them was to
        # compare timestamps and hope. `run_once` now mints one instant for the
        # whole check and hands it to both, so a flag belongs to the check whose
        # run_id is its own id with the `-eN` suffix removed — exact, and
        # unambiguous when two checks overlap.
        "at": _now_iso(now), "run_id": run_id, "actor": "agent", "mode": mode,
        "tool": f"pass:{trigger}",
        "verdict": "escalated" if escalated else "quiet",
        "detail": (f"{reason} | doc={doc_chars}c/{doc_lines}L"
                   f" | escalated={escalated}"
                   + (f" | {subjects}" if subjects else "")
                   + (f" | model={model}" if model else "")),
        # ⚠️ THE SAME THREE NUMBERS AS THEMSELVES — see ROW_FIELDS. Duplicating
        # them beside the sentence is deliberate and is not the drift this
        # project usually forbids: `detail` is what a PERSON reads on the panel
        # and these are what a SPREADSHEET sorts and filters on. One rendering
        # each, from one source, written in the same statement — which is what
        # keeps them from disagreeing.
        "doc_chars": doc_chars, "doc_lines": doc_lines,
        "escalated": escalated, "model": model,
    })


def passes(limit: int = 50) -> List[Dict[str, Any]]:
    """The triage passes, newest last. Reads what record_pass wrote."""
    return [r for r in rows(limit * 4)
            if str(r.get("tool", "")).startswith("pass:")][-limit:]


# ── actions ─────────────────────────────────────────────────────────────────
def record_intent(run_id: str, *, actor: str, tool: str, args: Any,
                  verdict: str, action_key: str = "",
                  now: Optional[float] = None) -> str:
    """The row written BEFORE anything happens. Returns the action_key.

    ⚠️ WRITTEN EVEN WHEN THE VERDICT IS `deny`. A refused action is the most
    interesting thing this file records — it is the evidence that the gate ran
    at all, and a log containing only successes cannot distinguish "nothing was
    refused" from "nothing was checked".

    ⚠️ RAISES `Replayed` IF THIS KEY HAS ALREADY BEEN ACTED ON. The check reads
    the whole record rather than an in-memory set, so it survives a restart —
    which is the case it exists for: a crash between intent and outcome, then a
    retry that must not act twice.
    """
    key = str(action_key or contracts.action_key(run_id, tool, args))
    if key and _has_outcome(key):
        raise Replayed(
            f"action_key {key} already has an outcome; refusing to repeat it")
    _append({
        "at": _now_iso(now), "run_id": str(run_id), "actor": str(actor),
        "tool": str(tool), "args_digest": contracts.args_digest(args),
        "verdict": str(verdict), "action_key": key, "outcome": PENDING,
    })
    return key


def record_outcome(run_id: str, *, action_key: str, outcome: str,
                   detail: str = "", now: Optional[float] = None) -> bool:
    """The row written AFTER. A SECOND row — it never edits the first.

    ⚠️ IF THIS ROW IS MISSING, THE ACTION IS UNFINISHED AND THE FILE SAYS SO BY
    OMISSION. That is the whole reason for two rows rather than one.
    """
    return _append({
        "at": _now_iso(now), "run_id": str(run_id), "action_key": str(action_key),
        "outcome": str(outcome), "detail": detail, "verdict": "outcome",
    })


def _has_outcome(action_key: str) -> bool:
    key = str(action_key)
    return any(str(r.get("action_key") or "") == key
               and str(r.get("outcome") or "") not in ("", PENDING)
               for r in _read()["rows"])


# ── reading it back ─────────────────────────────────────────────────────────
def rows(limit: int = 200) -> List[Dict[str, Any]]:
    """Most recent last, as written."""
    all_rows: List[Dict[str, Any]] = _read()["rows"]
    return all_rows[-max(1, int(limit)):]


def unfinished() -> List[Dict[str, Any]]:
    """Intents with no outcome — actions that started and did not report back.

    ⚠️ THE MOST USEFUL NUMBER THIS FILE PRODUCES. A non-empty list means either
    a crash mid-action or an action still running, and both deserve a look. An
    audit that could not answer this would be a log.
    """
    seen_outcomes = {str(r.get("action_key") or "") for r in _read()["rows"]
                     if str(r.get("outcome") or "") not in ("", PENDING)}
    return [r for r in _read()["rows"]
            if str(r.get("outcome") or "") == PENDING
            and str(r.get("action_key") or "") not in seen_outcomes]


def summary() -> Dict[str, Any]:
    """What the Cockpit shows. Counts only; no row content."""
    all_rows = _read()["rows"]
    verdicts: Dict[str, int] = {}
    for row in all_rows:
        name = str(row.get("verdict") or "")
        if name:
            verdicts[name] = verdicts.get(name, 0) + 1
    return {
        "rows": len(all_rows),
        "bound": MAX_ROWS,
        "at_bound": len(all_rows) >= MAX_ROWS,
        "unfinished": len(unfinished()),
        "verdicts": dict(sorted(verdicts.items())),
    }
