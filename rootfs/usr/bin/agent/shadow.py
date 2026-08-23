"""Shadow mode: run everything, deliver nothing. ARCH-016, TASK-049/050.

⚠️ THE CLAIM THAT THE AGENT OUTPERFORMS THE RULES IS A PREDICTION UNTIL IT IS
MEASURED, and this is the measurement. Tiers 1–3 run for a full period beside
the existing blueprints, producing concerns that are RECORDED AND NOT
DELIVERED. Then the diff: what did the rules catch that the agent missed, and
what did the agent catch that no rule could express?

⚠️ NO UNSOLICITED DELIVERY. Not a push, not a brief line, not a kiosk badge —
nothing the villa decides by itself to say.

⚠️ AND THAT IS NARROWER THAN "NOTHING", WHICH IS WHAT THIS SAID UNTIL
/dry-audit CHECKED IT. The claim was that `suppressed()` is "the one predicate
every delivery path asks", and ZERO delivery paths asked it — `chat.py` sends an
answer and a decline, `reply.py` calls `deliver`, and none of the three consults
this module. The code is right and the sentence was wrong: an answer to a
question a human just typed is not the villa deciding to speak, and suppressing
it would make chat look broken while an operator waited for a shadow period to
end.

So the rule is: **a reply to a direct question is delivered; anything the agent
originates is not.** The unsolicited paths — routing a concern to a phone,
composing a brief — arrive in Phase 4, and `test_shadow.py` pins that each one
asks `suppressed()` as it is added, because the reminder cannot be a comment
nobody reads at the moment they are written.

⚠️ THE EXISTING PIPELINE IS UNTOUCHED AND MUST STAY SO. The blueprints keep
firing, the collector keeps recording, the briefs keep going out exactly as
they did — the whole value of a shadow period is that it costs the owner
nothing if the agent is wrong. A change to `reports/` in service of this file
would forfeit that.

⚠️ AND SHADOW IS THE SHIPPED DEFAULT. Every other switch here defaults off so
that nothing happens; this defaults ON so that when the agent IS switched on,
its first period is observed rather than delivered. Turning it off is the
cutover, and it should be a decision somebody makes after reading a diff.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import config as agent_config
from reports.log import log, swallow

#: Where shadow-mode concerns are kept, separate from live ones.
#: ⚠️ A SEPARATE FILE, NOT A FLAG ON THE ROW. A shadow concern that shared the
#: store would be one predicate away from being rendered on the Cockpit, and
#: "nothing may be delivered" would depend on every reader remembering to
#: filter. Two files cannot be confused by forgetting.
from agent.concerns import Concern  # noqa: E402


def suppressed(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Must this deployment deliver NOTHING right now?

    ⚠️ ASKED AT EVERY DELIVERY POINT, NEVER CACHED. Shadow mode is what an
    operator reaches for when something is going wrong, and a switch that needs
    a restart is a switch that does not help then.
    """
    return bool(agent_config.view(config).get("shadow"))


@dataclass
class DiffRow:
    subject: str
    by_agent: str = ""
    by_rules: str = ""

    @property
    def where(self) -> str:
        if self.by_agent and self.by_rules:
            return "both"
        return "agent only" if self.by_agent else "rules only"


@dataclass
class Diff:
    """The cutover evidence. TASK-050."""

    rows: List[DiffRow] = field(default_factory=list)
    agent_total: int = 0
    rules_total: int = 0
    #: ⚠️ WHETHER THE PERIOD IS WORTH READING AT ALL. A shadow period during
    #: which the collector was not listening compares two silences.
    coverage_complete: bool = True

    @property
    def both(self) -> List[DiffRow]:
        return [r for r in self.rows if r.where == "both"]

    @property
    def agent_only(self) -> List[DiffRow]:
        return [r for r in self.rows if r.where == "agent only"]

    @property
    def rules_only(self) -> List[DiffRow]:
        return [r for r in self.rows if r.where == "rules only"]


def _subjects(rows: Sequence[Mapping[str, Any]], key: str,
              label: str) -> Dict[str, str]:
    """`{subject_key: label}` for one side of the comparison."""
    out: Dict[str, str] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        subject = str(row.get(key) or "")
        if subject:
            # ⚠️ A BETTER LABEL UPGRADES A WORSE ONE, and `setdefault` alone
            # could not. The FIRST occurrence used to win outright, so a
            # titleless row recorded by an older release permanently shadowed
            # the same finding re-recorded with a title — the owner regenerated
            # a briefing, pressed Re-read, and got the same ten hashes back,
            # because the fix was in the store and the shadow was in the join.
            existing = out.get(subject)
            better = str(row.get(label) or "")
            if existing is not None and better and existing.startswith("(untitled"):
                out[subject] = better
                continue
            # ⚠️ NEVER THE KEY AS A LABEL. It used to fall back to the
            # subject_key, so a finding stored without a title rendered as a
            # SHA-256 prefix — ten of them on the page a cutover is decided
            # from. An opaque hash is not a label a person can weigh; saying
            # the title is missing is at least a fact they can act on.
            out.setdefault(subject, str(row.get(label) or "")
                           or f"(untitled finding {subject[:8]})")
    return out


def diff(agent_concerns: Sequence[Mapping[str, Any]],
         rule_findings: Sequence[Mapping[str, Any]], *,
         coverage_complete: bool = True) -> Diff:
    """Compare a shadow period's concerns against what the rules found.

    ⚠️ KEYED ON `subject_key`, WHICH BOTH SIDES ALREADY COMPUTE THE SAME WAY.
    `reports.analysis.base.subject_key` is `sha256(entity_id)[:16]` and
    `agent.contracts.subject_key` delegates to it rather than restating it, so
    the two layers recognise the same equipment without either holding an
    identifier. A diff keyed on titles would compare prose and find nothing in
    common.

    ⚠️ AND `rules only` IS THE ROW THAT DECIDES THE CUTOVER. "The agent found
    things the rules could not" is the pleasant half and the one confirmation
    bias reaches for; the question that matters is what the rules caught and
    the agent did not, because those are the regressions a cutover would ship.
    """
    mine = _subjects(agent_concerns, "subject_key", "title")
    theirs = _subjects(rule_findings, "subject_key", "title")
    rows = [DiffRow(subject=key,
                    by_agent=mine.get(key, ""),
                    by_rules=theirs.get(key, ""))
            for key in sorted(set(mine) | set(theirs))]
    return Diff(rows=rows, agent_total=len(mine), rules_total=len(theirs),
                coverage_complete=coverage_complete)


def report(result: Diff, *, title: str = "Shadow period") -> str:
    """The diff as a person reads it. TASK-050.

    ⚠️ IT LEADS WITH WHAT THE AGENT MISSED. The ordering is an argument about
    what the reader should weigh first, and the flattering half is last on
    purpose — this document exists to decide whether to retire working
    automations, and a page that opens with the agent's wins is a page written
    to be agreed with.
    """
    lines: List[str] = [title, ""]

    if not result.coverage_complete:
        lines.append("⚠️ COVERAGE WAS INCOMPLETE for this period, so a subject "
                     "missing from BOTH columns proves nothing — neither layer "
                     "was watching throughout. Read this as partial.")
        lines.append("")

    lines.append(f"The rules found {result.rules_total}; the agent found "
                 f"{result.agent_total}.")
    lines.append("")

    lines.append(f"Caught by the rules and NOT by the agent "
                 f"({len(result.rules_only)}) — these are the regressions a "
                 f"cutover would ship:")
    for row in result.rules_only or []:
        lines.append(f"  - {row.by_rules}")
    if not result.rules_only:
        lines.append("  - none")
    lines.append("")

    lines.append(f"Caught by both ({len(result.both)}):")
    for row in result.both:
        lines.append(f"  - {row.by_agent}")
    if not result.both:
        lines.append("  - none")
    lines.append("")

    lines.append(f"Caught by the agent and NOT by the rules "
                 f"({len(result.agent_only)}):")
    for row in result.agent_only or []:
        lines.append(f"  - {row.by_agent}")
    if not result.agent_only:
        lines.append("  - none")
    return "\n".join(lines)


def recorded() -> List[Dict[str, Any]]:
    """Every concern this shadow period stored, as dicts. Never raises.

    ⚠️ THE SAME REDIRECT `record()` USES, AND FOR THE SAME REASON. The shadow
    store is a different FILE, and the module that owns concerns is the only
    thing that should know their document's shape — the proxy's first version
    of the diff route read the file itself and did `stored.get("concerns")`,
    which `test_store_envelope` flagged as an envelope unwrap. It was not one
    (the store's document genuinely has that key, and the wire envelope happens
    to share the word) but the test cannot tell those apart BY NAME, and neither
    can a reader. Asking `concerns.read()` removes the question: one parser, and
    a second consumer of the shadow store cannot drift from the first.

    ⚠️ AND IT DOES NOT CHECK `suppressed()`. `record` refuses outside a shadow
    period because writing then would confuse two paths; READING is how a
    finished period is judged, which by definition happens after shadow mode
    has been turned off.
    """
    from agent import concerns as concerns_mod

    original = concerns_mod.CONCERNS_FILE
    try:
        concerns_mod.CONCERNS_FILE = shadow_path(original)
        return list(concerns_mod.read())
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the shadow concern store", err)
        return []
    finally:
        concerns_mod.CONCERNS_FILE = original


def shadow_path(live: str) -> str:
    """The shadow twin of a store path.

    ⚠️ COMPUTED FROM THE EXTENSION, NOT BY REPLACING A KNOWN FILENAME. The
    first version did `live.replace("concerns.json", "concerns-shadow.json")`,
    which SILENTLY DID NOTHING whenever the base name differed — a test
    fixture, a renamed store — and the shadow concern landed in the LIVE store
    with no error. A string replace that finds nothing is not a failure; it is
    a no-op that looks like success, which is the worst kind of path handling
    in a function whose whole job is to keep two things apart.
    """
    root, _, ext = str(live).rpartition(".")
    return f"{root}-shadow.{ext}" if root else f"{live}-shadow"


def record(concern: Concern, *, config: Optional[Mapping[str, Any]] = None
           ) -> Tuple[bool, str]:
    """Store a concern WITHOUT delivering it. Returns `(recorded, reason)`.

    ⚠️ IT REFUSES WHEN SHADOW IS OFF, rather than falling through to the live
    store. A caller reaching for this outside a shadow period has confused the
    two paths, and quietly doing the right thing instead would hide that.
    """
    if not suppressed(config):
        return False, "not in shadow mode; use the live concern store"
    from agent import concerns as concerns_mod

    original = concerns_mod.CONCERNS_FILE
    try:
        concerns_mod.CONCERNS_FILE = shadow_path(original)
        stored, reason = concerns_mod.raise_concern(concern)
    finally:
        concerns_mod.CONCERNS_FILE = original
    if stored:
        log(f"shadow: recorded {stored.id}, delivered nothing")
    return bool(stored), reason
