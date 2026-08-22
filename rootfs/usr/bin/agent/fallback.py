"""The degradation ladder. ARCH-003, TASK-047. Nothing on it is silent.

⚠️ FOUR RUNGS, AND EACH ONE SAYS WHICH IT IS. A brief that arrives in plainer
words than usual is a brief the reader should trust differently, and a system
that degrades without saying so has traded a visible fault for an invisible
one. Every render here states its own rung in the text a person reads.

    Tier 3 unreachable   -> the escalations, as a bare list
    Tier 2 unreachable   -> the salient changes, as a plain list
    No WAN at all        -> reflexes fire, the journal records, the kiosk
                            renders, and this sends a brief that SAYS it had
                            no writer
    Nothing at all       -> a sentence saying so, which is still a delivery

⚠️ IT DOES NOT REIMPLEMENT `deterministic.py`. That is 2,058 lines of zone
ordering, money ceilings and sparkline assembly, and copying any of it here
would produce a second renderer to keep in step with the first. This is
deliberately plainer than the thing it stands in for: HONEST BEATS POLISHED,
because the point is to be unmistakably a fallback.

⚠️ AND IT NEVER RAISES. It is the last thing between a villa and silence; a
fallback that can fail has not understood its job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence

from reports.narrate.style import inert

#: The rungs, worst-informed last. ⚠️ NAMED, because "which rung produced this"
#: is the question a reader has and the one an operator debugs from.
RUNGS: Dict[str, str] = {
    "concerns": "the reasoning layer was unreachable, so these are the raw "
                "escalations rather than an investigation",
    "salient": "the triage layer was unreachable too, so this is what changed "
               "rather than what it means",
    "nothing": "nothing could be assembled at all",
}


@dataclass
class Brief:
    text: str
    rung: str
    #: ⚠️ TRUE ONLY FOR A FULL, MODEL-WRITTEN BRIEF. Everything this module
    #: produces is a degradation, and a caller that cannot tell is a caller
    #: that will present a fallback as the real thing.
    complete: bool = False


def _lines(header: str, rung: str) -> List[str]:
    return [header, "",
            f"⚠️ This is a fallback: {RUNGS.get(rung, rung)}.", ""]


def from_concerns(concerns: Sequence[Mapping[str, Any]], *,
                  title: str = "Villa briefing") -> Brief:
    """Rung 1: Tier 3 is down. The concerns exist; nobody wrote them up.

    ⚠️ SEVERITY FIRST, THEN THE SUBJECT. With no prose to carry the weight, the
    ordering IS the report — a reader scanning a bare list needs the critical
    item at the top, not in date order.
    """
    order = {"critical": 0, "warning": 1, "notice": 2, "info": 3}
    rows = sorted(
        (c for c in concerns if isinstance(c, Mapping)),
        key=lambda c: (order.get(str(c.get("severity") or "notice"), 9),
                       str(c.get("title") or "")))
    out = _lines(title, "concerns")
    if not rows:
        out.append("No concerns were open.")
    for row in rows:
        sev = str(row.get("severity") or "notice").upper()
        # ⚠️ NO BRACKETS. `style.inert()` strips `[` and `]` on the way out —
        # they are markup-active on at least one notify platform — so a marker
        # written as `[WARNING]` arrives as `(WARNING)` and this renderer would
        # be emitting markup for the delivery layer to undo. The rule is that
        # the renderer emits none, which is what makes a whole-message inert
        # pass safe rather than lossy.
        out.append(f"- {sev}: {inert(str(row.get('title') or 'unnamed'))}")
        body = inert(str(row.get("body") or "")).strip()
        if body:
            out.append(f"    {body[:400]}")
    return Brief("\n".join(out), "concerns")


def from_salient(salient: Sequence[Mapping[str, Any]], *,
                 title: str = "Villa briefing") -> Brief:
    """Rung 2: Tier 2 is down as well. Only the observation floor answered.

    ⚠️ IT SAYS WHAT THE NUMBERS ARE, NOT WHAT THEY MEAN. Nothing has judged
    these — that is precisely the layer that is missing — so presenting them as
    findings would be the fallback inventing the thing it is standing in for.
    """
    out = _lines(title, "salient")
    rows = [s for s in salient if isinstance(s, Mapping)]
    if not rows:
        out.append("Nothing was measured as unusual. ⚠️ Nothing has judged "
                   "this, so read it as 'no change was detected' rather than "
                   "as 'all is well'.")
        return Brief("\n".join(out), "salient")
    out.append("What changed, unjudged:")
    for row in rows[:20]:
        label = inert(str(row.get("label") or row.get("entity_id") or "?"))
        reason = inert(str(row.get("reason") or "")).strip()
        out.append(f"- {label}" + (f" — {reason}" if reason else ""))
    return Brief("\n".join(out), "salient")


def nothing(*, title: str = "Villa briefing", detail: str = "") -> Brief:
    """Rung 4: nothing could be assembled. ⚠️ STILL A DELIVERY.

    Silence reads as a working system with nothing to say, which is the one
    reading that must never be available to a reader when the truth is that the
    system could not run. A brief saying "I could not assemble anything" is
    worth sending.
    """
    out = _lines(title, "nothing")
    out.append("The villa could not be assessed for this period.")
    if detail:
        out.append(f"Reason: {inert(str(detail))[:300]}")
    out.append("")
    out.append("Reflexes, the journal and the kiosk are independent of this "
               "and are unaffected.")
    return Brief("\n".join(out), "nothing")


def compose(*, concerns: Optional[Sequence[Mapping[str, Any]]] = None,
            salient: Optional[Sequence[Mapping[str, Any]]] = None,
            detail: str = "", title: str = "Villa briefing") -> Brief:
    """Descend the ladder until something can be said. Never raises.

    ⚠️ THE ORDER IS THE LADDER AND IT DESCENDS ONLY. A caller passing concerns
    gets rung 1 even if salience is also available, because the higher rung is
    strictly better informed — trying to merge them would produce a document
    that is neither, and the reader could not tell how much to trust it.
    """
    try:
        if concerns:
            return from_concerns(concerns, title=title)
        if salient:
            return from_salient(salient, title=title)
        return nothing(title=title, detail=detail)
    except Exception as err:  # noqa: BLE001 - the last thing before silence
        return Brief(f"{title}\n\n⚠️ This is a fallback: "
                     f"{RUNGS['nothing']}.\n\nReason: {err}", "nothing")
