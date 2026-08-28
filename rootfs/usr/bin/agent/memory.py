"""What is true about THIS property. §12.2, TASK-093.

⚠️ THIS IS THE ONLY STORE IN THE SYSTEM THAT PERSISTS A MODEL'S CONCLUSION.
Everything else the agent writes is a concern with a lifecycle, read once and
closed. A memory is asserted into the prompt every cycle from now on, so a wrong
one is not a bad report — it is a bad premise under every future report, and it
does not announce itself. The four rules below each guard one way that goes
wrong, and none of them is ceremony.

⚠️ 1. A MEMORY IS A CLAIM WITH PROVENANCE, NOT A FACT. `source` is required and
`write` refuses without it, so every claim names the investigation that produced
it. A store of unattributed assertions is indistinguishable from a store of
hallucinations after about a month.

⚠️ 2. MEMORIES EXPIRE. `review_after` is a field, not a policy — "the pump is
unavailable" was true in one month and is still being asserted in the next
unless something forces re-derivation. Expiry RETIRES rather than deletes: the
claim stops being asserted and stays readable, because the reason a claim was
made is evidence even after the claim is stale.

⚠️ 3. A HUMAN CORRECTION OUTRANKS AND IS NEVER OVERWRITTEN. `correct()` is the
only path that sets `corrected`, and `write()` refuses to touch a corrected
memory — so no amount of re-derivation can walk back over what a person said.
Corrected memories are also EXEMPT FROM EXPIRY: expiry exists to force
re-derivation of the agent's own conclusions, and re-deriving over a human is
precisely what rule 3 forbids.

⚠️ 4. MEMORY IS WRITTEN ONLY ON THE REASONING PATH, NEVER FROM A TOOL RESULT.
There is deliberately NO write tool, and `test_agent_memory` walks `agent/tools/`
asserting none of them can reach this module. Tool results carry text written by
other people — device names, guest fault reports, log lines — and a write path
from there is an injection vector into PERMANENT state. A real device name with
an underscore once cost a day of failed deliveries; the same string reaching a
store that is re-asserted forever is a worse version of that bug.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, List, Mapping, Optional, Sequence

from agent import content
from vesta.adapters import store as store_mod
from vesta.adapters.log import log, swallow

MEMORY_ROOT: str = "/data/vesta/memory"

#: DATA-018. ⚠️ `proposed` EXISTS SO A LOW-CONFIDENCE CLAIM CAN BE HELD WITHOUT
#: BEING ASSERTED. Only `active` reaches the prompt; a proposal is visible to a
#: person and invisible to the next run.
STATES: Sequence[str] = ("proposed", "active", "corrected", "retired")

#: The states a memory is asserted from. ⚠️ `corrected` IS IN HERE AND
#: `proposed` IS NOT: a human's version of a claim is the most reliable thing in
#: the store, and the agent's unconfirmed guess is the least.
ASSERTED: Sequence[str] = ("active", "corrected")

#: How long a claim stands before it must be re-derived. ⚠️ A DEFAULT, NOT A
#: RULE — the caller sets a shorter horizon for anything seasonal, and this is
#: the fallback for a claim that named none. One quarter is chosen so that a
#: claim survives a season and does not survive a year.
DEFAULT_REVIEW_DAYS: int = 90

#: Above this, a fresh claim is asserted rather than merely held. ⚠️ NOT A
#: JUDGEMENT ABOUT TRUTH. It is the line between "worth telling the next run"
#: and "worth a person seeing first", and it is deliberately high: the cost of a
#: wrong asserted memory is paid on every future cycle.
ASSERT_CONFIDENCE: float = 0.7

DAY_S: float = 86400.0


@dataclass
class Memory:
    """One claim about this property."""

    subject_key: str
    claim: str = ""
    source: str = ""
    learned_at: str = ""
    review_after: str = ""
    confidence: float = 0.0
    state: str = "proposed"
    corrections: List[str] = field(default_factory=list)

    @property
    def asserted(self) -> bool:
        return self.state in ASSERTED


def _day(at: Optional[float] = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(
        at if at is not None else time.time()))


def _path(root: str, subject_key: str) -> str:
    """⚠️ THE KEY IS A HASH AND IS VALIDATED AS ONE. `subject_key` is
    `sha256(...)[:16]`, so anything outside lowercase hex cannot be a real key —
    and rejecting on that shape is what makes traversal impossible here rather
    than making it a question about separators. A model chooses this value."""
    safe = str(subject_key or "").strip().lower()
    if not safe or len(safe) > 64 or any(c not in "0123456789abcdef" for c in safe):
        return ""
    return os.path.join(root, f"{safe}.md")


def read(subject_key: str, *, root: Optional[str] = None) -> Optional[Memory]:
    """One memory, or `None`. Never raises."""
    path = _path(root or MEMORY_ROOT, subject_key)
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as err:  # noqa: BLE001
        swallow(f"could not read memory {subject_key}", err)
        return None
    front = content.front_matter(raw)
    body = content.strip_front_matter(raw)
    claim, _, tail = body.partition("\n\nCorrections:\n")
    try:
        confidence = float(front.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    state = front.get("state", "proposed")
    return Memory(
        subject_key=str(front.get("subject_key") or subject_key),
        claim=claim.strip(),
        source=str(front.get("source") or ""),
        learned_at=str(front.get("learned_at") or ""),
        review_after=str(front.get("review_after") or ""),
        confidence=confidence,
        state=state if state in STATES else "proposed",
        corrections=[l[2:].strip() for l in tail.splitlines()
                     if l.startswith("- ")],
    )


def all_memories(root: Optional[str] = None) -> List[Memory]:
    """Every memory on disk, oldest key first. Never raises."""
    base = root or MEMORY_ROOT
    out: List[Memory] = []
    try:
        names = sorted(n for n in os.listdir(base) if n.endswith(".md"))
    except OSError:
        return out
    for name in names:
        got = read(name[:-3], root=base)
        if got is not None:
            out.append(got)
    return out


def write(subject_key: str, *, claim: str, source: str,
          confidence: float = 0.0, review_days: int = DEFAULT_REVIEW_DAYS,
          root: Optional[str] = None, now: Optional[float] = None) -> bool:
    """Record a claim. Returns whether it was written.

    ⚠️ REFUSES WITHOUT A SOURCE, AND THE REFUSAL IS THE FEATURE (rule 1). An
    unattributed claim cannot be audited, cannot be re-derived and cannot be
    argued with — it is exactly the ambient wrongness this store exists not to
    accumulate.

    ⚠️ AND REFUSES OVER A CORRECTION (rule 3). A human's version of a claim is
    not an obstacle to route around; a run that re-derived the same conclusion
    would otherwise silently reinstate what somebody explicitly overrode.
    """
    base = root or MEMORY_ROOT
    path = _path(base, subject_key)
    if not path:
        return False
    if not str(claim).strip() or not str(source).strip():
        return False

    existing = read(subject_key, root=base)
    if existing is not None and existing.state == "corrected":
        log(f"memory {subject_key} not rewritten: a person has corrected it")
        return False

    at = now if now is not None else time.time()
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    front = {
        "subject_key": subject_key,
        "source": str(source).strip(),
        "learned_at": _day(at),
        "review_after": _day(at + max(1, int(review_days)) * DAY_S),
        "confidence": f"{confidence:.2f}",
        "state": "active" if confidence >= ASSERT_CONFIDENCE else "proposed",
    }
    body = str(claim).strip()
    if existing is not None and existing.corrections:
        # ⚠️ CORRECTIONS SURVIVE A REWRITE OF A NON-CORRECTED MEMORY. A person
        # may have annotated a claim without overriding it, and losing that on
        # the next re-derivation would quietly discard the most valuable text
        # in the file.
        body += "\n\nCorrections:\n" + "\n".join(
            f"- {c}" for c in existing.corrections)
    return _save(path, front, body, f"memory {subject_key} written")


def correct(subject_key: str, *, by: str, text: str,
            root: Optional[str] = None, now: Optional[float] = None) -> bool:
    """A person overriding a claim. The one path that sets `corrected`.

    ⚠️ APPENDS, NEVER REPLACES. The original claim stays readable beneath the
    correction, because "what did it think, and what did we tell it" is the
    record that makes a wrong conclusion traceable rather than merely gone.
    """
    base = root or MEMORY_ROOT
    path = _path(base, subject_key)
    existing = read(subject_key, root=base) if path else None
    if not path or existing is None or not str(text).strip():
        return False
    at = now if now is not None else time.time()
    note = f"{_day(at)} ({str(by).strip() or 'unknown'}): {str(text).strip()}"
    front = {
        "subject_key": existing.subject_key,
        "source": existing.source,
        "learned_at": existing.learned_at or _day(at),
        # ⚠️ NO `review_after` HORIZON ON A CORRECTION. Expiry forces the agent
        # to re-derive its OWN conclusions; a human's does not decay on a timer,
        # and giving it one would delete rule 3 after a quarter.
        "review_after": "",
        "confidence": f"{existing.confidence:.2f}",
        "state": "corrected",
    }
    body = existing.claim + "\n\nCorrections:\n" + "\n".join(
        f"- {c}" for c in existing.corrections + [note])
    return _save(path, front, body, f"memory {subject_key} corrected by {by}")


def expire(*, root: Optional[str] = None,
           now: Optional[float] = None) -> List[str]:
    """The daily sweep. Returns the keys retired. Never raises.

    ⚠️ RETIRES, NEVER DELETES, AND SKIPS CORRECTIONS. See rules 2 and 3 in the
    module docstring — a retired claim stops being asserted and stays readable,
    and a corrected one is not the agent's to expire.
    """
    today = _day(now)
    retired: List[str] = []
    for memory in all_memories(root):
        if memory.state not in ("active", "proposed"):
            continue
        if not memory.review_after or memory.review_after > today:
            continue
        path = _path(root or MEMORY_ROOT, memory.subject_key)
        front = {
            "subject_key": memory.subject_key,
            "source": memory.source,
            "learned_at": memory.learned_at,
            "review_after": memory.review_after,
            "confidence": f"{memory.confidence:.2f}",
            "state": "retired",
        }
        body = memory.claim
        if memory.corrections:
            body += "\n\nCorrections:\n" + "\n".join(
                f"- {c}" for c in memory.corrections)
        if _save(path, front, body, ""):
            retired.append(memory.subject_key)
    if retired:
        log(f"memory: retired {len(retired)} claim(s) past review")
    return retired


def index(root: Optional[str] = None) -> str:
    """The asserted claims, as the block that goes into context.

    ⚠️ CLAIMS ONLY, AND NO DATES. `learned_at` and `review_after` are metadata
    for the sweep and the review queue; putting either above the cache
    breakpoint would end prompt caching every day at midnight, which is the
    same trap `last_confirmed` is kept out of the playbook bodies for.

    ⚠️ AND EVERY LINE SAYS IT IS A CLAIM. The model is being handed its own
    past conclusions, and prose that presents them as established fact is how a
    guess becomes a premise. The framing is part of the safety of the store.
    """
    rows = [m for m in all_memories(root) if m.asserted and m.claim]
    if not rows:
        return ""
    lines = []
    for memory in sorted(rows, key=lambda m: m.subject_key):
        mark = " (corrected by a person — this outranks your own reasoning)" \
            if memory.state == "corrected" else ""
        lines.append(f"- {memory.claim}{mark}")
    return ("## What you have previously concluded about this property\n\n"
            "These are your own past claims, not established facts. If what "
            "you can see now contradicts one, say so and trust what you can "
            "see — except where a person has corrected it.\n\n"
            + "\n".join(lines))


def _save(path: str, front: Mapping[str, Any], body: str, note: str) -> bool:
    """⚠️ NEVER RAISES. A memory that cannot be written must not be able to fail
    an investigation; the cost is a claim not held, and the alternative is an
    answer nobody gets.

    ⚠️ ATOMIC, THROUGH `store.write_text`. A half-written memory is a corrupt
    claim asserted into every future prompt, which is strictly worse than no
    claim — and the atomic mechanism has ONE implementation in this subsystem
    for the reason that module's docstring gives."""
    try:
        store_mod.write_text(path, content.render(front, body))
    except OSError as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not write a memory", err)
        return False
    if note:
        log(note)
    return True
