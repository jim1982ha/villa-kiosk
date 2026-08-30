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

from vesta.supervise.agent import config as agent_config
from vesta.supervise.agent import playbooks
from vesta.supervise.agent import runtime
from vesta.supervise.agent.llm.base import Provider
from vesta.supervise.agent.registry import Registry
from vesta.supervise.agent.registry import build_registry
from vesta.supervise.agent.registry import narrowed
from vesta.adapters.log import note, stage

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
#: How much of a device's own name a subject span must be before it may claim
#: that device, when the span sits INSIDE the label (the model shortening).
#: ⚠️ DIMENSIONLESS, and it is what stops the word "pump" naming a pump: on the
#: reference villa five labels end in "Pump Power", so a bare "pump" is inside
#: all of them and the shortest-label rule would attach one at random.
REVERSE_MIN_SHARE: float = 0.5

#: A space a person put between a word and a digit, which the villa's own label
#: does not have. ⚠️ MEASURED, NOT IMAGINED (2026-08-30): triage escalated
#: "Bedroom 1 Light" against labels reading "Bedroom1 Light Power", and reported
#: `0/1 identified` on two consecutive passes with 1,269 candidate labels
#: available — so the candidate set was full and the MATCHER was the problem.
#: The subject and the label differ by one space.
_DIGIT_GAP = re.compile(r"(?<=[a-z])\s+(?=\d)")


def _comparable(value: Any) -> str:
    """One spelling for both sides of every subject/label comparison.

    ⚠️ APPLIED TO BOTH SIDES OR IT IS A BUG. It is a normalisation, not a
    rewrite: making the subject and the label agree is only sound while the same
    function produces both, which is why there is one of it and both call sites
    use it. Case and whitespace for the reason every name comparison in this
    project uses `roomKey`-style folding; the digit rule because a model writes
    "Bedroom 1" for equipment a villa labels "Bedroom1".
    """
    return _DIGIT_GAP.sub("", " ".join(str(value or "").split()).lower())

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
    #: ⚠️ EVERY device the subject names, in the order it names them; the
    #: singular above is always the first and stays for its existing readers.
    #: One escalation routinely covers a pair ("Pool Pump and Massage Jet
    #: Pump"), and keeping only one device meant the other's flag could never
    #: be stamped by the investigation that covered it — see
    #: `contracts.subject_entities` for the delivered-brief symptom.
    entity_ids: Tuple[str, ...] = ()


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
        label = _comparable(refs.label(ref))
        entity = refs.resolve(ref)
        if label and entity:
            known.setdefault(label, entity)
    for item in items:
        subject = _comparable(item.subject)
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
        #
        # ⚠️ EVERY NON-OVERLAPPING MATCH IS KEPT, NOT ONLY THE FIRST
        # (2026-08-30). "Pool Pump and Massage Jet Pump" names two devices, and
        # keeping one meant the other's flag was never stamped by the
        # investigation that covered it — the delivered brief then showed the
        # same pump "noticed, not investigated" beside "investigated". Longest
        # label first still decides SPECIFICITY: a label whose span sits inside
        # an already-claimed span is the general name of equipment a more
        # specific label already matched ("Massage Jet Pump" inside "Massage
        # Jet Pump Power Factor"), and claiming it too would attach a second
        # device to one mention. Devices are ordered by where the subject
        # names them, so the primary is the one the model led with.
        claimed: list = []          # (start, end) char spans already matched
        found_at: dict = {}         # entity -> first position in the subject

        def free(start: int, end: int) -> bool:
            return all(end <= s or start >= e for s, e in claimed)

        for label in sorted(known, key=len, reverse=True):
            start = subject.find(label)
            while start >= 0:
                end = start + len(label)
                if free(start, end):
                    claimed.append((start, end))
                    found_at.setdefault(known[label], start)
                    break
                start = subject.find(label, start + 1)

        # ⚠️ THE REVERSE DIRECTION MUST WORK PER-SPAN TOO, AND SHIPPING IT
        # WHOLE-SUBJECT-ONLY LEFT THE REPORTED BUG OPEN (2026-08-30). Measured
        # against the villa's own labels: they carry a "Power" suffix the model
        # drops ("Pool Pump Power" vs "Pool Pump"), so the FORWARD pass above
        # matches nothing at all and every single-device subject is identified
        # by this fallback. Testing only the whole subject therefore worked for
        # "Pool Pump" and could never work for "Pool Pump and Massage Jet
        # Pump", which is not wholly inside any label — so the compound kept a
        # `topic:` key, could not merge with either pump's own flag, and the
        # brief showed one pump twice with opposite verdicts. The first fix
        # generalised the direction that was NOT doing the work.
        #
        # ⚠️ LONGEST SPAN FIRST, and the two directions keep DIFFERENT
        # tie-breaks because they mean opposite things: a label found inside
        # the subject is the model padding, so the LONGEST label is the most
        # specific device meant; a subject span found inside a label is the
        # model shortening, so the SHORTEST label is the most general name of
        # the equipment. Collapsing them re-opens whichever case is not tested.
        starts = []
        at = 0
        for word in subject.split():
            starts.append((at, at + len(word)))
            at += len(word) + 1
        for length in range(len(starts), 0, -1):
            for first in range(0, len(starts) - length + 1):
                begin, finish = starts[first][0], starts[first + length - 1][1]
                if not free(begin, finish):
                    continue
                span = subject[begin:finish]
                inside = [l for l in known if span in l]
                if not inside:
                    continue
                best = min(inside, key=lambda l: (len(l), l))
                # ⚠️ THE SPAN MUST BE MOST OF THE NAME IT CLAIMS. "pump" sits
                # inside every pump label on this property, and without this a
                # one-word span would attach whichever device sorted first —
                # inventing a device the model never named. Dimensionless, so
                # it carries no assumption about how anyone names equipment.
                if len(span) < REVERSE_MIN_SHARE * len(best):
                    continue
                claimed.append((begin, finish))
                found_at.setdefault(known[best], begin)
        hits = sorted(found_at, key=lambda entity: found_at[entity])
        # ⚠️ THE WHOLE-SUBJECT REVERSE FALLBACK THAT USED TO SIT HERE IS GONE,
        # AND ITS REASONING LIVES IN THE SPAN LOOP ABOVE (2026-08-30). It was
        # added on 2026-08-28 for two live passes logging `0/5 identified` —
        # triage writing "Jacuzzi Pump" for a device labelled "Jacuzzi Pump
        # Power" — and the span loop is that same rule with the subject's own
        # spans instead of only the whole string, so the maximal span it tries
        # FIRST is exactly the case this block used to answer.
        #
        # ⚠️ DELETING IT IS PART OF THE FIX, NOT A TIDY-UP. It carried no
        # share guard, so it happily matched a subject of "pump" against
        # whichever of this villa's five "… Pump Power" labels sorted shortest
        # — inventing a device the model never named. Measured: with the span
        # loop in place and this block still present, `"pump"` resolved to the
        # pool pump. With it removed, `"pump"` correctly resolves to nothing.
        # Two rules answering one question, and the weaker one won.
        if hits:
            item.entity_id = hits[0]
            item.entity_ids = tuple(hits)


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
    refs = getattr(reg, "refs", None)
    _identify(found, refs)
    named = sum(1 for e in found if e.entity_id)
    stage("triage", f"{len(found)} escalation(s) from {result.turns} turn(s)"
        # ⚠️ COUNTED, BECAUSE "identified 0 of 3" AND "identified 3 of 3" ARE
        # THE TWO OUTCOMES THAT DECIDE WHETHER THE HANDOVER PAGE CAN EVER SHOW
        # A MATCH, and they are otherwise indistinguishable from outside.
        + (f", {named}/{len(found)} identified" if found else "")
        + _unidentified_note(found, refs))
    note("escalated", len(found))
    note("identified", named)
    # ⚠️ NO `turns` HERE. Triage reaches the model through `runtime.investigate`,
    # which already tallies turns and tool calls for EVERY tier — noting them
    # again would overwrite the pass total with this one tier's figure, which is
    # the shape of a counter that reads plausibly and is wrong.
    return TriageResult(status="answered", escalations=found,
                        turns=result.turns, usage=result.usage)


#: How many unidentified subjects the log line names before it stops.
MAX_REPORTED_UNIDENTIFIED: int = 3


def _unidentified_note(found: Sequence[Any], refs: Any) -> str:
    """" (unidentified: 'x'; N candidate label(s))", or "" when all matched.

    ⚠️ IT SEPARATES THE TWO CAUSES, WHICH `N/N identified` CANNOT (2026-08-30).
    A pass read `0/1 identified` on two consecutive runs for a subject the villa
    plainly HAS — labels of the shape the reverse rule was built for. That has
    two completely different explanations needing opposite fixes: the matching
    rule failed on labels it was given, or NO handle for that device was minted
    this run and there was nothing to match against. `_identify` only ever sees
    `refs.known()`, so the second is entirely possible and is invisible to every
    test of the matcher — those hand it the labels directly, which is
    `feedback_pin-the-caller` in its usual disguise.

    ⚠️ THE SUBJECT IS THE MODEL'S OWN WORDS AND CARRIES NO ID, so it may be
    logged; the candidate COUNT is logged rather than the labels, which would
    put the villa's device list in the log on every quiet pass.

    ⚠️ NEVER RAISES. A diagnostic on the end of a stage line must not be able to
    fail the pass that produced it.
    """
    try:
        missing = [e for e in found if not getattr(e, "entity_id", "")]
        if not missing:
            return ""
        candidates = len(getattr(refs, "known", lambda: ())()) if refs else 0
        shown = [f"{str(getattr(e, 'subject', ''))[:40]!r}"
                 for e in missing[:MAX_REPORTED_UNIDENTIFIED]]
        more = len(missing) - len(shown)
        return (f" (unidentified: {', '.join(shown)}"
                + (f", +{more} more" if more > 0 else "")
                + f"; {candidates} candidate label(s))")
    except Exception:  # noqa: BLE001 - a note must not fail the pass
        return ""


def due(config: Optional[Mapping[str, Any]] = None, *,
        since_minutes: float = 0.0) -> bool:
    """Is a triage pass due? Cadence from config, never a literal here."""
    cfg = agent_config.view(config)
    try:
        every = float(cfg.get("triage_minutes") or 0)
    except (TypeError, ValueError):
        return False
    return every > 0 and since_minutes >= every
