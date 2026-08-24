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
from typing import Any, Dict, List, Mapping, Optional, Tuple

from agent import config as agent_config
from agent import playbooks
from agent import runtime
from agent.llm.base import Provider
from agent.registry import Registry, build_registry
from reports.log import log

#: The only tool triage may see. ⚠️ A NAME, not a mode: `read_state` is READ too
#: and would let a cheap pass fan out across the villa one entity at a time.
TRIAGE_TOOLS: Tuple[str, ...] = ("read_villa",)

#: ⚠️ NO VILLA FACTS, NO ENTITY IDS, NO CLOCK. This string sits above the cache
#: breakpoint on every one of ~96 daily calls; one interpolated timestamp ends
#: prompt caching silently and the only symptom is the bill.
SYSTEM = """You are the triage pass of a villa supervision system.

You are asked ONE question: is anything in this villa worth a closer, more
expensive look right now?

You are not diagnosing. You are not deciding what to do. You are deciding
whether to spend a frontier model's attention.

Escalate a subject when a competent facility manager walking the property would
stop and look at it. Do not escalate because a number exists, because a value is
unfamiliar, or because you would like more data.

⚠️ AN ABSENCE OF EVIDENCE IS NOT A REASON TO ESCALATE, AND IT IS NOT A REASON TO
STAY SILENT EITHER. If the document tells you the observation floor was not
listening, or that nothing has been surveyed, say so as a subject in its own
right — a supervisor that cannot see is a more urgent problem than most of what
it would have seen.

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


def registry_for(full: Optional[Registry] = None) -> Registry:
    """The triage tool set: the shipped registry, narrowed to `TRIAGE_TOOLS`.

    ⚠️ NARROWED FROM THE REAL ONE, NEVER BUILT SEPARATELY. A second registry is
    a second gate (ARCH-012), and it would be the one nobody tests. This takes
    the same wired tools and hands over a subset.
    """
    source = full if full is not None else build_registry()
    kept = [t for t in (source.get(n) for n in TRIAGE_TOOLS) if t is not None]
    return Registry(kept)


async def run(*, provider: Provider, document: str,
              config: Optional[Mapping[str, Any]] = None,
              registry: Optional[Registry] = None,
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
        config=config, registry=registry_for(registry), tier="triage",
        trigger=trigger, run_id=run_id)

    if not result.usable:
        return TriageResult(status=result.status, reason=result.reason,
                            turns=result.turns, usage=result.usage)

    found = parse(result.text)
    log(f"triage: {len(found)} escalation(s) from {result.turns} turn(s)")
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
