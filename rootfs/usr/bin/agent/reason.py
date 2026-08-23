"""Tier 3. What happens after triage says "look at this". TASK-052.

⚠️ THE MISSING WIRE, AND IT WAS MISSING FROM THE PLAN AS WELL AS THE CODE.
TASK-040's expected output is "a triage pass producing escalations"; TASK-041's
context is "Tier 3, one loop, FOUR ENTRY POINTS (scheduled escalation, kiosk,
chat, event)" — so the loop exists and names this entry point by name. No task
said "call the loop with the escalations". Measured on the owner's villa:
`scheduler._run_once` took `result.escalations`, formatted them into a string
and returned. Two real subjects escalated at 12:18 and produced no Concern,
because nothing downstream of triage had a caller.

⚠️ IT IS A SIBLING OF `triage.py`, NOT A LAYER INSIDE `runtime.py`. `runtime`
owns the BOUNDS every tier shares — deadline, repeat detector, never-raise;
`triage` owns Tier 2's prompt and its parse; this owns Tier 3's. Putting the
reasoning prompt in `runtime` would make the tier-agnostic loop know about one
tier, and putting it in `scheduler` would put a system prompt in a clock.

⚠️ ONE INVESTIGATION PER SUBJECT, NEVER ONE PER PASS. A pass escalating three
subjects investigated together produces one body of evidence attributable to
nothing — and `raise_concern` keys on ONE subject, so a conflated run would have
to pick. Three runs cost three times as much and are the only shape that can
produce three separate, evidenced concerns.

⚠️ AND THE CAP IS ON RUNS STARTED, NOT ON SUBJECTS ACCEPTED. Everything triage
escalated is recorded; the cap decides how many are FOLLOWED this pass. A real
fault is still a fault fifteen minutes later, so the ones past the cap arrive
one cadence late rather than never — which is why this is a cap and not a filter
on severity (a triage escalation carries no severity; severity is what the
investigation assigns).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agent import audit as audit_mod
from agent import budget as budget_mod
from agent import config as agent_config
from agent import playbooks
from agent import runtime
from agent.llm.base import Provider
from reports.log import log, swallow

#: How many investigations one pass may start when config says nothing.
#: ⚠️ MIRRORS `config.DEFAULTS`, and `test_agent_reason` pins that it does. A
#: second number here is the drift this repo has paid for at every layer.
DEFAULT_CAP: int = 3

#: ⚠️ NO VILLA FACTS, NO ENTITY IDS, NO CLOCK — the same rule as `triage.SYSTEM`
#: and for the same reason: this sits above the cache breakpoint.
SYSTEM = """You are the investigation tier of a villa supervision system.

Triage has flagged ONE subject as worth a closer look. Decide whether something
is actually wrong with it, and if it is, record one concern about it.

How to work:

1. READ before you conclude. The villa document you have is a summary; the tools
   are the evidence. Read the subject's own history, what the villa logged, and
   read_coverage — an absence of findings means nothing until you know somebody
   was listening.
2. CHECK WHAT IS ALREADY OPEN with read_concerns. If this subject already has an
   open concern, either supersede it or say why this is a different condition.
   Arriving as news twice is how a person stops reading these.
3. READ A PLAYBOOK if one covers this. It says what a competent facility manager
   would check and what it usually turns out to be.
4. DECIDE. If something is wrong, call raise_concern ONCE. If nothing is wrong,
   say so in one line and stop.

Finding nothing is a good outcome and a complete answer. Do not promote an
observation into a concern because a run was started: a supervisor that reports
something every time it looks is one nobody believes the day it matters.

Rules you cannot bend:

- Every number you write must come from a tool result in THIS run. Anything else
  is removed before storage, and the removal is recorded against you.
- You never see entity ids, only handles. Name a device by the handle a tool
  gave you.
- Severity is judged, not defaulted. Read the severity scale you were given and
  choose deliberately."""


@dataclass
class Followup:
    """What a pass's escalations actually cost and produced."""

    escalated: int = 0
    started: int = 0
    concerns: int = 0
    queued: int = 0
    stopped: str = ""
    run_ids: List[str] = field(default_factory=list)

    def clause(self) -> str:
        """One phrase for the pass reason.

        ⚠️ IT MAY NEVER CONTAIN `": "`, AND THAT IS ENFORCED HERE RATHER THAN
        ASKED OF EVERY CONTRIBUTOR TO IT. `scheduler.run_once` splits the pass
        reason on the first one to recover the escalated COUNT and the SUBJECTS
        for the audit row, so a colon anywhere in this sentence files part of it
        as the list of subjects — the pass trace lying about what was escalated,
        in the one record the cutover is read from. `stopped` can carry a
        budget refusal written in another module, so the guard is at the exit
        and not at the three places that build a part.
        """
        if self.queued:
            return f"{self.queued} queued for approval"
        parts = [f"investigated {self.started}"]
        if self.concerns:
            parts.append(f"{self.concerns} concern"
                         + ("s" if self.concerns != 1 else ""))
        if self.stopped:
            parts.append(self.stopped)
        return ", ".join(parts).replace(":", ";")


def cap_of(config: Optional[Mapping[str, Any]] = None) -> int:
    """How many investigations this pass may start. Never negative."""
    raw = agent_config.view(config).get("max_investigations_per_pass")
    try:
        return max(0, int(raw))
    except (TypeError, ValueError, OverflowError):
        # ⚠️ `OverflowError` IS THE ONE THAT IS EASY TO MISS — `int(float("inf"))`
        # raises it, and a config carrying an infinity would otherwise crash the
        # pass at the moment it decided how much to spend. `policy._positive`
        # records the same trap, found there by a test rather than by review.
        return DEFAULT_CAP


def auto(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Does an escalation get investigated, or wait for a person? ADR-021."""
    return str(agent_config.view(config).get("investigate_mode")
               or "auto").strip().lower() == "auto"


async def follow_up(escalations: Sequence[Any], *, provider: Provider,
                    document: str = "",
                    config: Optional[Mapping[str, Any]] = None,
                    trigger: str = "scheduled",
                    now: Optional[float] = None) -> Followup:
    """Investigate what triage escalated. NEVER RAISES.

    ⚠️ THE CALLER IS `scheduler.run_forever`, WHICH NOBODY IS WATCHING. An
    exception here would take out the triage clock for the rest of the process's
    life, and the symptom would be a villa that quietly stopped supervising
    itself — the exact failure this whole subsystem keeps rediscovering. Every
    arm returns a `Followup`.

    ⚠️ THE BUDGET IS ASKED BEFORE EVERY INVESTIGATION, NOT ONCE FOR THE PASS.
    This is the tier where cost moves from per-PASS to per-FINDING: the triage
    check already passed the budget gate for one cheap call, and three frontier
    runs behind it are a different order of spend. Asking per run is what makes
    the monthly ceiling bind mid-pass rather than one pass late.
    """
    out = Followup(escalated=len(escalations))
    if not escalations:
        return out

    if not auto(config):
        # ⚠️ RECORDED, NOT DISCARDED. `approve` means a person decides whether to
        # spend, and the audit row is what they decide FROM — an escalation that
        # went unrecorded because nobody had approved it yet would make the queue
        # and the evidence for it the same missing thing.
        for index, item in enumerate(escalations):
            audit_mod.record_run(_ident(trigger, index, now),
                                 actor="agent", trigger=trigger,
                                 verdict="awaiting-approval",
                                 detail=_subject_of(item))
        out.queued = len(escalations)
        log(f"reason: {out.queued} escalation(s) queued for approval")
        return out

    before = _concern_count(config)
    cap = cap_of(config)
    for index, item in enumerate(escalations):
        if out.started >= cap:
            out.stopped = f"{len(escalations) - out.started} left for next pass"
            break
        money = budget_mod.check(config, kind="run")
        if not money.allowed:
            out.stopped = f"stopped, {money.reason}"
            break
        run_id = _ident(trigger, index, now)
        # ⚠️ THE LINK ROW, WRITTEN BEFORE THE RUN. It carries the SUBJECT and the
        # run id, and every row the investigation writes carries that same id —
        # which is what lets a reader follow one escalated subject from the
        # triage pass to the concern it produced. Written first, so a run that
        # crashes still has its intent on the record.
        audit_mod.record_run(run_id, actor="agent", trigger=trigger,
                             verdict="escalated", detail=_subject_of(item))
        try:
            result = await runtime.investigate(
                provider=provider,
                system=[{"type": "text", "text": playbooks.system_prompt("owner")},
                        {"type": "text", "text": SYSTEM},
                        {"type": "text", "text": document}],
                messages=[{"role": "user", "content": _question(item)}],
                config=config, tier="reason", trigger=trigger, run_id=run_id)
        except Exception as err:  # noqa: BLE001 - the clock must survive this
            swallow(f"investigation of {_subject_of(item)!r} raised", err)
            continue
        out.started += 1
        out.run_ids.append(run_id)
        log(f"reason: {run_id} {result.status} on {_subject_of(item)!r}")

    out.concerns = max(0, _concern_count(config) - before)
    return out


# ── helpers ─────────────────────────────────────────────────────────────────
def _ident(trigger: str, index: int, now: Optional[float] = None) -> str:
    """⚠️ THE INDEX IS PART OF IT. `runtime.investigate` mints
    `f"{trigger}{int(time.time())}"` when handed no id, and three investigations
    inside one pass finish inside one second — so all three would have shared a
    run id, and the audit rows of three separate subjects would have merged into
    one unreadable run."""
    stamp = int(time.time() if now is None else now)
    return f"{trigger}{stamp}-e{index + 1}"


def _subject_of(item: Any) -> str:
    return str(getattr(item, "subject", "") or "")


def _question(item: Any) -> str:
    """What the investigation is asked, in the words triage used.

    ⚠️ TRIAGE'S OWN TEXT, NOT A RESTATEMENT. Rewriting it here would put a second
    description of the finding between the tier that judged it and the tier
    acting on it, and the two would drift the first time either prompt changed.
    """
    subject = _subject_of(item) or "an unnamed subject"
    why = str(getattr(item, "reason", "") or "").strip()
    return (f"Triage flagged this subject: {subject}\n\n"
            + (f"Its reason: {why}\n\n" if why else "")
            + "Investigate it and decide whether it is worth a person's "
              "attention. Record at most one concern.")


def _concern_count(config: Optional[Mapping[str, Any]]) -> int:
    """How many concerns exist right now, in the store the writes go to.

    ⚠️ COUNTED FROM THE STORE, NOT FROM THE RUN. An `AgentResult` says nothing
    about whether the model called `raise_concern` — it carries the final prose
    and the evidence — so "did this pass actually produce anything" is only
    answerable by asking the store. Counting is also the honest measure: a run
    that filed nothing and a run that was refused both leave the count where it
    was, and both mean the same thing to a reader of the shadow diff.

    ⚠️ IT USES `sources.concern_rows`, WHICH FOLLOWS SHADOW MODE, so this cannot
    disagree with `read_concerns` or with where `raise_concern` wrote.
    """
    try:
        from agent import sources
        return len(sources.concern_rows(config)())
    except Exception as err:  # noqa: BLE001 - a count is not worth a failed pass
        swallow("could not count the concern store", err)
        return 0
