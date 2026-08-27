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
    """The rung's own statement, under an OPTIONAL header.

    ⚠️ AN EMPTY `title` MEANS THE CALLER ALREADY HAS ONE. The report pipeline
    delivers a title and a body as two separate strings — a notification's
    subject line and its text — so a header baked in here would arrive as a
    duplicate first line on every phone. What must never be optional is the
    line below it: the rung is stated whether or not anyone asked for a header.
    """
    out = [header, ""] if header else []
    out.append(f"⚠️ This is a fallback: {RUNGS.get(rung, rung)}.")
    out.append("")
    return out


def from_concerns(concerns: Sequence[Mapping[str, Any]], *,
                  title: str = "Villa briefing") -> Brief:
    """Rung 1: Tier 3 is down. The concerns exist; nobody wrote them up.

    ⚠️ SEVERITY FIRST, THEN THE SUBJECT. With no prose to carry the weight, the
    ordering IS the report — a reader scanning a bare list needs the critical
    item at the top, not in date order.
    """
    # ⚠️ `contracts.severity_rank`, NOT A LOCAL MAP. This carried its own copy
    # with an unknown severity defaulting to 9 — LAST, the quietest position —
    # which contradicts the rule `route.py` and `standing.py` both state: an
    # unclassified severity is a warning, never the quietest thing in the
    # report. Found by /dry-audit Part 4; the same map existed in the Cockpit.
    from agent.contracts import severity_rank
    rows = sorted(
        (c for c in concerns if isinstance(c, Mapping)),
        key=lambda c: (severity_rank(c.get("severity")),
                       str(c.get("title") or "")))
    out = _lines(title, "concerns")
    if not rows:
        out.append("No alerts were open.")
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


def brief(*, concerns: Optional[Sequence[Mapping[str, Any]]] = None,
          standing: Optional[Sequence[Mapping[str, Any]]] = None,
          findings: Optional[Sequence[Mapping[str, Any]]] = None,
          carried: Optional[Sequence[Mapping[str, Any]]] = None,
          coverage_note: str = "", lead: str = "",
          title: str = "") -> Brief:
    """The NORMAL brief, banner-free. TASK-073's replacement for the renderer.

    ⚠️ THIS IS NOT A RUNG AND CARRIES NO FALLBACK BANNER. When the cutover
    retired the blueprint layer, 2,058 lines of `deterministic.py` were
    formatting a taxonomy of events nothing emits any more; what a brief has
    to say now is what the AGENT concluded (concerns), what is wrong RIGHT NOW
    (standing), what the statistical checks measured (findings) and what jobs
    are still open (carried). Said plainly, in severity order, inert. The
    polish that went with the renderer — zones, sparklines, money columns —
    formatted data that no longer exists.

    ⚠️ `lead` IS THE PROVIDER'S ONE SENTENCE, WHEN THERE IS ONE. The caller
    narrates first and hands the sentence in; empty means this composes its
    own from the loudest fact. Same one-slot contract the old renderer had,
    without the slot machinery.

    ⚠️ EVERY SECTION SAYS WHICH TENSE IT IS IN — standing is the only one in
    the present tense, exactly the rule the old renderer enforced, because
    "failed and recovered this period" and "down right now" read as a
    contradiction unless labelled.
    """
    from agent.contracts import severity_rank

    stand = [s for s in (standing or []) if isinstance(s, Mapping)]
    rows = sorted((c for c in (concerns or []) if isinstance(c, Mapping)),
                  key=lambda c: (severity_rank(c.get("severity")),
                                 str(c.get("title") or "")))
    found = [f for f in (findings or []) if isinstance(f, Mapping)]
    jobs = [t for t in (carried or []) if isinstance(t, Mapping)]

    out: List[str] = [title, ""] if title else []
    if lead.strip():
        out += [inert(lead.strip()), ""]
    elif stand:
        out += [f"{len(stand)} thing(s) need attention right now.", ""]
    elif rows:
        out += [f"{len(rows)} alert(s) are open.", ""]
    elif found:
        out += [f"{len(found)} thing(s) stood out in this period's checks.", ""]
    elif jobs:
        # ⚠️ AN OPEN JOB IS NEWS — the 2.530.0 rule, and the FIRST draft of
        # this chain broke it within the hour: "Nothing needs your attention"
        # rendered directly above a list of outstanding facility work, caught
        # by the pin that was being re-pointed at this file.
        out += [f"{len(jobs)} to-do item(s) are still open with the "
                "facility manager.", ""]
    else:
        out += ["Nothing needs your attention.", ""]

    if stand:
        out.append("Needs attention right now:")
        for row in stand[:20]:
            label = inert(str(row.get("title") or row.get("label") or "?"))
            detail = inert(str(row.get("detail") or "")).strip()
            room = inert(str(row.get("room") or "")).strip()
            out.append(f"- {label}"
                       + (f" — {detail}" if detail else "")
                       + (f", {room}" if room else ""))
        out.append("")
    if rows:
        out.append("Concerns the assistant has raised:")
        for row in rows[:20]:
            sev = str(row.get("severity") or "notice").upper()
            out.append(f"- {sev}: {inert(str(row.get('title') or 'unnamed'))}")
            body_text = inert(str(row.get("body") or "")).strip()
            if body_text:
                out.append(f"    {body_text[:400]}")
        out.append("")
    if found:
        out.append("From this period's checks:")
        for row in found[:20]:
            label = inert(str(row.get("label") or "?"))
            detail = inert(str(row.get("detail") or "")).strip()
            out.append(f"- {label}" + (f" — {detail}" if detail else ""))
        out.append("")
    if jobs:
        out.append("Jobs still open with the facility manager:")
        for row in jobs[:20]:
            out.append(f"- {inert(str(row.get('text') or row.get('summary') or '?'))}")
        out.append("")
    if coverage_note.strip():
        out.append(f"⚠️ {inert(coverage_note.strip())}")
        out.append("")
    return Brief("\n".join(out).rstrip() + "\n", "", complete=True)


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
        # ⚠️ THE SAME OPTIONAL HEADER AS `_lines`, hand-rolled because this arm
        # may not call anything that could itself be the thing that just failed.
        head = f"{title}\n\n" if title else ""
        return Brief(f"{head}⚠️ This is a fallback: "
                     f"{RUNGS['nothing']}.\n\nReason: {err}", "nothing")
