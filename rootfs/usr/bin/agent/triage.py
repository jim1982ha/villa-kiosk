"""Tier 2. One cheap question, ninety-six times a day.

⚠️ IT ANSWERS ONE THING: is anything here worth a closer look? Not what is
wrong, not what to do — only whether a frontier model should be spent. That
narrowness is the whole economic argument: this runs every fifteen minutes on a
small model reading a cached prefix, and Tier 3 runs about six times a day.
Widening it is the change that quietly turns ~$14/month into ~$200.

⚠️ IT CANNOT ACT, NOTIFY OR WRITE, AND THAT IS ENFORCED BY `policy.py` RATHER
THAN ASKED FOR IN THE PROMPT. `for_run(tier="triage")` denies every non-READ
tool before the model is even offered one, so a triage pass that decided to file
a concern would be refused by the gate, not by good behaviour. This is the tier
most likely to be pointed at a cheaper or local model later (§16.1), which is
precisely why its authority must not depend on the model's judgement.

⚠️ AND IT IS GIVEN ONE TOOL. `read_villa` — the document it is already reading.
A triage pass that can pull history is a triage pass that costs what an
investigation costs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import config as agent_config
from agent import playbooks
from agent import runtime
from agent.llm.base import Provider
from agent.registry import Registry, build_registry, narrowed
from reports.log import log

#: The only tool triage may see. ⚠️ A NAME, not a mode: `read_state` is READ too
#: and would let a cheap pass fan out across the villa one entity at a time.
TRIAGE_TOOLS: Tuple[str, ...] = ("read_villa",)

#: ⚠️ NO VILLA FACTS, NO ENTITY IDS, NO CLOCK. This string sits above the cache
#: breakpoint on every one of ~96 daily calls; one interpolated timestamp ends
#: prompt caching silently and the only symptom is the bill.
#:
#: ⚠️ IT USED TO ASK FOR THE TWO SUBJECTS THAT PRODUCED EVERY DUPLICATE ROW IN
#: THE UI, AND THAT INSTRUCTION PREDATED THE SURFACES THAT ANSWER THEM. It said
#: an unlistening observation floor should be escalated "as a subject in its own
#: right" — written before `collect.coverage()` reached the tablet at all. It
#: now has a whole tab, deterministic and always present, so a frontier model
#: was being paid every thirty minutes to rediscover a fact already on screen.
#: Measured on the reference villa across six passes: of sixteen escalations,
#: THREE were this add-on reporting on itself (`Observation coverage`,
#: `Monitoring coverage`, `Observation journal (VESTA add…`) and THREE more were
#: the facility record read back to the person who wrote it (`Facility record`,
#: `Open facility fault`, `Facility record open fault (1 unresolved, 0
#: resolved)`). Six of sixteen, none of them equipment.
#:
#: ⚠️ AND THE FIX IS IN THE PROMPT RATHER THAN IN `parse()`, DELIBERATELY. A
#: code-side filter would have to match model-authored subject text by name —
#: an unanchored substring rule over prose, which is the class of rule CLAUDE.md
#: records as a recurring false-positive source here, and which would silently
#: drop a real finding whose subject happened to contain the word "coverage".
#: Telling the tier what is not a subject also saves the turn, where a filter
#: would pay for it and discard the answer.
SYSTEM = """You are the triage pass of a villa supervision system.

You are asked ONE question: is anything in this villa worth a closer, more
expensive look right now?

You are not diagnosing. You are not deciding what to do. You are deciding
whether to spend a frontier model's attention.

Escalate a subject when a competent facility manager walking the property would
stop and look at it. Do not escalate because a number exists, because a value is
unfamiliar, or because you would like more data.

An absence of evidence is not a reason to escalate. Say NOTHING rather than
escalate a subject you cannot name.

Two things in the document are NOT subjects, however they look:

- This add-on's own state — whether it was listening, what it has surveyed, how
  complete its journal is. That is reported directly on the property's screen,
  always and for free, and a person acts on it there.
- Faults, tasks and notes a person has already recorded. Somebody wrote those
  down; repeating them back is not a closer look.

Both are worth knowing and neither is worth a frontier model's attention. Read
them as context for the equipment you are judging, never as the subject.

Answer in this shape and nothing else:

ESCALATE: <subject> — <one line, why a person should look>
ESCALATE: <subject> — <one line>

or exactly:

NOTHING

Never more than one line per subject. Never a subject you cannot name."""

#: `ESCALATE: subject — reason`, tolerant of the dashes a model actually types.
_LINE = re.compile(r"^\s*ESCALATE\s*:\s*(?P<subject>[^—\-:]{1,120}?)\s*"
                   r"(?:—|--|-|:)\s*(?P<reason>.+?)\s*$", re.IGNORECASE)


@dataclass
class Escalation:
    subject: str
    reason: str
    #: ⚠️ THE DEVICE THIS IS ABOUT, SERVER-SIDE ONLY, AND IT IS WHAT MAKES THE
    #: HANDOVER MEASURABLE (2.752.0). `raise_concern` computes
    #: `subject_key = sha256(entity_id)[:16]` from a `ref`, and falls back to
    #: `sha256("topic:" + text)` when the model gives free text instead — a key
    #: the rules side, which ALWAYS hashes an entity id, can never produce. So
    #: a concern raised about a named device sat in "found only by the
    #: assistant" forever even when an automation had reported the same
    #: equipment, and `both` was 0 by construction rather than by coverage.
    #:
    #: ⚠️ A REF CANNOT TRAVEL AND AN ENTITY ID CAN. Handles are per RUN by
    #: design (`refs.py`: `d3` means different devices in different runs), so
    #: triage's `d1` is meaningless to the investigation; the id is carried
    #: between them in OUR memory and re-minted as a fresh handle on arrival.
    #: It is never sent to a model — `reason.investigate_subject` seeds it into
    #: the new run's table and the model only ever sees the new handle.
    entity_id: str = ""


@dataclass
class TriageResult:
    status: str = "answered"
    escalations: List[Escalation] = field(default_factory=list)
    reason: str = ""
    turns: int = 0
    usage: Dict[str, int] = field(default_factory=dict)

    @property
    def quiet(self) -> bool:
        """⚠️ ONLY TRUE WHEN THE PASS SUCCEEDED. A declined run has no
        escalations either, and reading that as "nothing to report" is the
        silent-failure this whole subsystem keeps being bitten by."""
        return self.status == "answered" and not self.escalations


def parse(text: str) -> List[Escalation]:
    """Escalations out of the model's reply.

    ⚠️ A LINE THAT DOES NOT PARSE IS DROPPED, NOT GUESSED AT. A malformed
    escalation is a subject nobody can act on, and inventing structure for it
    would put words in the model's mouth that the audit would then attribute to
    it. `NOTHING` is a valid, complete answer.
    """
    out: List[Escalation] = []
    for line in str(text or "").splitlines():
        match = _LINE.match(line)
        if not match:
            continue
        subject = match.group("subject").strip()
        reason = match.group("reason").strip()
        if subject and reason:
            out.append(Escalation(subject=subject, reason=reason))
    return out


def _identify(items: Sequence[Escalation], refs: Any) -> None:
    """Attach the entity id behind each escalated subject, where there is one.

    ⚠️ MATCHED ON THE LABEL THE MODEL WAS GIVEN, because that is the only thing
    it could have written. Triage sees handles and labels, never ids, so the
    subject string it emits is a label (or a phrase containing one) and this is
    the join back. `roomKey`-style normalisation — case and whitespace — for the
    same reason every other name comparison in this project uses it.

    ⚠️ NO MATCH IS A NORMAL OUTCOME, NOT A FAILURE. "Coverage incomplete" and
    "the monitoring journal" are real subjects with no device behind them; they
    keep the topic key, which is correct for them. This exists so that the ones
    that ARE a device stop being filed as topics.
    """
    if refs is None:
        return
    known = {}
    for ref in getattr(refs, "known", lambda: ())():
        label = " ".join(str(refs.label(ref) or "").split()).lower()
        entity = refs.resolve(ref)
        if label and entity:
            known.setdefault(label, entity)
    for item in items:
        subject = " ".join(str(item.subject or "").split()).lower()
        if not subject:
            continue
        # ⚠️ CONTAINMENT ONLY, AND THE EXACT-MATCH FAST PATH BESIDE IT WAS
        # DELETED RATHER THAN KEPT (2.752.0). A model writes "the pool pump
        # circuit" for a device labelled "Pool pump", so containment is the
        # rule that has to work; and `label in subject` is TRUE whenever they
        # are equal, so a preceding dict lookup could never change an answer.
        # Mutation testing proved it: replacing the fast path with `None` left
        # every assertion green, which is the definition of a line that is not
        # doing anything. Longest label first, so a specific one beats a
        # substring of it.
        hit = None
        for label in sorted(known, key=len, reverse=True):
            if label in subject:
                hit = known[label]
                break
        if hit:
            item.entity_id = hit


def registry_for(full: Optional[Registry] = None, *,
                 session: Any = None) -> Registry:
    """The triage tool set: the shipped registry, narrowed to `TRIAGE_TOOLS`.

    ⚠️ NARROWED FROM THE REAL ONE, NEVER BUILT SEPARATELY. A second registry is
    a second gate (ARCH-012), and it would be the one nobody tests. This takes
    the same wired tools and hands over a subset.
    """
    source = full if full is not None else build_registry(session=session)
    # ⚠️ THE SHARED NARROWING, AND IT FIXES A REAL DROP: this used to build
    # `Registry(kept)` with no `refs`, so triage's tools minted handles into a
    # table nothing downstream could resolve. It never showed because triage
    # sees one tool and raises no concerns — but it is the same defect
    # `narrowed`'s docstring describes, and it was here.
    return narrowed(source, TRIAGE_TOOLS)


async def run(*, provider: Provider, document: str,
              config: Optional[Mapping[str, Any]] = None,
              registry: Optional[Registry] = None,
              session: Any = None,
              run_id: str = "",
              trigger: str = "scheduled") -> TriageResult:
    """One triage pass. Never raises.

    ⚠️ THE DOCUMENT IS THE SYSTEM PREFIX AND THE QUESTION IS THE MESSAGE, which
    is what makes the caching pay: the villa profile is stable for weeks, so
    ~75% of every one of these calls is billed at a tenth.

    ⚠️ `trigger` IS A PARAMETER BECAUSE IT WAS A LITERAL, AND THE LITERAL MADE
    TWO RECORDS OF ONE EVENT DISAGREE. This function hardcoded
    `trigger="scheduled"`, and that value does two things downstream: it mints
    the run id (`f"{trigger}{int(time.time())}"`) and it is what `usage.record`
    files the spend under. So an owner pressing "Run a check now" got a triage
    trace correctly reading `manual` beside a usage row reading `scheduled`,
    with a run id of `scheduled…`, for the same press. Reported from the Usage
    tab: "they are marked as Scheduled, which is not really the case, right?"

    It is not a cosmetic mislabel. This ledger's whole reason for existing is
    the attribution the provider's own console cannot give — one key serves the
    schedule and every person who messages the villa — so filing an owner's
    manual test as the villa acting on its own is that ledger being wrong about
    the one question it answers. The default stays `scheduled` so the clock's
    behaviour is unchanged.
    """
    cfg = agent_config.view(config)
    reg = registry_for(registry, session=session)
    result = await runtime.investigate(
        provider=provider,
        # ⚠️ THE CONSTITUTION, AND NO VOICE. Triage emits `ESCALATE:` lines for
        # another machine stage, not prose for a person, so a voice file is
        # ~350 cached tokens of instructions about a document it never writes.
        # `system_prompt("")` selects none — see `VOICE_OF`.
        system=playbooks.system_blocks(
            "", instructions=SYSTEM, document=document),
        messages=[{"role": "user",
                   "content": "Is anything here worth a closer look?"}],
        config=config, registry=reg,
        session=session, tier="triage",
        trigger=trigger, run_id=run_id)

    if not result.usable:
        return TriageResult(status=result.status, reason=result.reason,
                            turns=result.turns, usage=result.usage)

    found = parse(result.text)
    # ⚠️ IDENTIFIED HERE, WHERE THE TABLE THAT CAN ANSWER STILL EXISTS. `reg`
    # is this pass's registry and `reg.refs` its handle table; once `run`
    # returns, the mapping from the label the model wrote back to an entity id
    # is gone. Doing it in the caller would mean rebuilding a table whose
    # handles no longer mean what they meant.
    _identify(found, getattr(reg, "refs", None))
    named = sum(1 for e in found if e.entity_id)
    log(f"triage: {len(found)} escalation(s) from {result.turns} turn(s)"
        # ⚠️ COUNTED, BECAUSE "identified 0 of 3" AND "identified 3 of 3" ARE
        # THE TWO OUTCOMES THAT DECIDE WHETHER THE HANDOVER PAGE CAN EVER SHOW
        # A MATCH, and they are otherwise indistinguishable from outside.
        + (f", {named}/{len(found)} identified" if found else ""))
    return TriageResult(status="answered", escalations=found,
                        turns=result.turns, usage=result.usage)


def due(config: Optional[Mapping[str, Any]] = None, *,
        since_minutes: float = 0.0) -> bool:
    """Is a triage pass due? Cadence from config, never a literal here."""
    cfg = agent_config.view(config)
    try:
        every = float(cfg.get("triage_minutes") or 0)
    except (TypeError, ValueError):
        return False
    return every > 0 and since_minutes >= every
