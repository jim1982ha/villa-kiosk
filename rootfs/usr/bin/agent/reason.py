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
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from agent import audit as audit_mod
from agent import budget as budget_mod
from agent import config as agent_config
from agent import playbooks
from agent import runtime
from agent.llm.base import Provider
from agent.registry import REASON_TOOLS
from reports.log import stage, swallow

#: How many investigations one pass may start when config says nothing.
#: ⚠️ MIRRORS `config.DEFAULTS`, and `test_agent_reason` pins that it does. A
#: second number here is the drift this repo has paid for at every layer.
DEFAULT_CAP: int = 2

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
    """Does an escalation get investigated, or wait for a person? ADR-021.

    ⚠️ ONE KEY SINCE 2.756.0 — `mode`, not `investigate_mode` beside `shadow`.
    ⚠️ AND "observe" INVESTIGATES. That is the whole point of the mode: run
    everything, tell once, ask nothing — a concern raised there is stamped
    informational (`tools/concern.writer`), delivered as an FYI, and never
    escalated. Refusing to investigate here would make an observe period a
    record of nothing having been looked at.
    """
    return str(agent_config.view(config).get("mode")) in ("live", "observe")


async def follow_up(escalations: Sequence[Any], *, provider: Provider,
                    document: str = "",
                    config: Optional[Mapping[str, Any]] = None,
                    session: Any = None,
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
            # ⚠️ THE SUBJECT IS A FIELD AND THE TRIAGE REASON IS THE PROSE. A
            # person approving this later hands the SUBJECT back to the loop,
            # and recovering it by splitting a sentence is what `audit.ROW_FIELDS`
            # records having been paid for one release earlier.
            audit_mod.record_run(_ident(trigger, index, now),
                                 actor="agent", trigger=trigger,
                                 verdict=audit_mod.AWAITING,
                                 subject=_subject_of(item),
                                 detail=str(getattr(item, "reason", "") or ""))
        out.queued = len(escalations)
        stage("reason", f"{out.queued} escalation(s) queued for approval")
        return out

    before = _concern_count(config)
    cap = cap_of(config)
    for index, item in enumerate(escalations):
        if out.started >= cap:
            out.stopped = f"{len(escalations) - out.started} left for next pass"
            # ⚠️ THE REMAINDER IS WRITTEN DOWN, NOT JUST COUNTED (2026-08-28).
            # This used to `break` here and record nothing, so the pass reported
            # "3 left for next pass" and the three SUBJECTS existed nowhere —
            # the Triage tab printed that count above two cards and could not
            # list the rest. The approve path has always recorded its waiting
            # escalations (`AWAITING`, with the subject); the capped path forgot
            # the same fact.
            #
            # ⚠️ ONE ROW EACH, WITH THE SUBJECT AND TRIAGE'S OWN REASON, and the
            # id from the SAME `_ident` generator — that is what pairs it to
            # this check on the tab, and it costs nothing: no model is asked,
            # this is the branch where spending stopped.
            #
            # ⚠️ AND "waiting for the next check" IS WHAT IT MEANS, NOT
            # "queued". The next pass re-triages from the villa's own state; if
            # the condition has cleared it is simply not flagged again. Nothing
            # resumes a list, which is why the row is a record rather than a
            # work item.
            for later, rest in enumerate(escalations[index:], start=index):
                audit_mod.record_run(_ident(trigger, later, now),
                                     actor="agent", trigger=trigger,
                                     verdict=audit_mod.DEFERRED,
                                     subject=_subject_of(rest),
                                     detail=str(getattr(rest, "reason", "") or ""))
            break
        money = budget_mod.check(config, kind="run")
        if not money.allowed:
            out.stopped = f"stopped, {money.reason}"
            break
        run_id = _ident(trigger, index, now)
        if await investigate_subject(item, provider=provider, config=config,
                                     document=document, trigger=trigger,
                                     session=session, run_id=run_id):
            out.started += 1
            out.run_ids.append(run_id)

    out.concerns = max(0, _concern_count(config) - before)
    return out


async def investigate_subject(item: Any, *, provider: Provider,
                              config: Optional[Mapping[str, Any]],
                              document: str, trigger: str,
                              run_id: str, session: Any = None) -> bool:
    """One subject, investigated. Returns whether the run happened at all.

    ⚠️ EXTRACTED SO APPROVAL IS NOT A SECOND INVESTIGATION PATH. The scheduler's
    automatic arm and a person pressing approve reach the model through this one
    function, with the same prompt, the same tier, the same audit rows and the
    same never-raise contract. Two call sites and one body is the rule
    `registry.invoke` states one layer down — the second path is the one nobody
    tests, and here it would be the path that spends money.

    ⚠️ THE LINK ROW IS WRITTEN BEFORE THE RUN. It carries the SUBJECT and the
    run id, and every row the investigation writes carries that same id — which
    is what lets a reader follow one escalated subject from the triage pass to
    the concern it produced. Written first, so a run that crashes still has its
    intent on the record. For an APPROVED escalation it is also what settles the
    queued row, because `audit.pending_escalations` treats any later row sharing
    the run id as settled.
    """
    subject = _subject_of(item)
    audit_mod.record_run(run_id, actor="agent", trigger=trigger,
                         verdict="escalated", subject=subject,
                         detail=str(getattr(item, "reason", "") or ""))
    try:
        result = await runtime.investigate(
            provider=provider,
            system=playbooks.system_blocks(
                "owner", instructions=SYSTEM, document=document),
            messages=[{"role": "user", "content": _question(item)}],
            # ⚠️ NARROWED, AND THIS IS THE COST FIX (2.752.0). Passing no
            # registry made `runtime.investigate` build the FULL one — VESTA's
            # tools plus Home Assistant's entire MCP catalogue, 44 schemas and
            # 43,700 tokens, 84% of a 52,108-token prefix, re-read on all eight
            # turns of every investigation. See `registry.REASON_TOOLS` for the
            # measurement and for why the list is what the agent's own trace
            # says it calls rather than what looked useful.
            tool_names=tool_names_for(config),
            # ⚠️ THE ID TRAVELS, THE HANDLE DOES NOT — see `triage.Escalation`
            # and `runtime._seeded`. Empty for a subject with no device behind
            # it ("coverage incomplete"), which correctly keeps a topic key.
            seed=(_entity_of(item), subject),
            config=config, session=session, tier="reason",
            trigger=trigger, run_id=run_id)
    except Exception as err:  # noqa: BLE001 - the clock must survive this
        swallow(f"investigation of {subject!r} raised", err)
        return False
    stage("reason", f"{run_id} {result.status} on {subject!r}")
    return True


def tool_names_for(config: Optional[Mapping[str, Any]] = None
                   ) -> Optional[Tuple[str, ...]]:
    """Which tools the investigation tier may see, or None for "all of them".

    ⚠️ NAMES, NOT A REGISTRY, AND THAT IS WHY. `runtime.investigate` is the ONE
    place that builds a registry (it owns the run's refs, its evidence and its
    per-run write tools); a second `build_registry` here would be a second
    construction site, and the first thing it broke was a test — the wiring
    suite patches `triage.build_registry` and `runtime.build_registry` BY NAME
    because a module that imports the symbol gets its own binding, and this
    file quietly became a third. That comment was already in the test, above
    the two lines it patches.

    ⚠️ `ha_tools: true` PUTS THE UPSTREAM CATALOGUE BACK, for an owner who
    wants the investigator to reach Home Assistant's own query surface and will
    pay ~5x the prefix for it. Off by default because the agent's own trace
    reached for exactly ONE upstream tool over the observed period and the
    redaction audit refused its result every time.
    """
    if bool(agent_config.view(config).get("ha_tools")):
        return None
    return REASON_TOOLS


@dataclass
class Queued:
    """One escalation waiting for a person, as the queue hands it back."""

    subject: str = ""
    reason: str = ""


async def approve(run_id: str, *, provider: Provider, session: Any = None,
                  config: Optional[Mapping[str, Any]] = None,
                  document: str = "", trigger: str = "approved"
                  ) -> Tuple[bool, str]:
    """Run the investigation a person just approved. Returns `(ran, reason)`.

    ⚠️ THE SUBJECT COMES FROM THE QUEUE, NOT FROM THE CALLER. A run id is the
    only thing the button sends, and the subject is read back from the audit row
    it names — so a browser cannot ask for an investigation of something nobody
    escalated, and there is no field in which to try.

    ⚠️ AND THE BUDGET IS ASKED HERE TOO. An approved investigation costs exactly
    what an automatic one costs; a ceiling that bound the scheduler and not the
    button would be a ceiling with a way around it.
    """
    wanted = str(run_id or "")
    row = next((r for r in audit_mod.pending_escalations()
                if str(r.get("run_id") or "") == wanted), None)
    if row is None:
        # ⚠️ ONE ANSWER FOR "NEVER EXISTED" AND "ALREADY ACTED ON", because the
        # queue cannot tell them apart and neither reading changes what the
        # person should do — press it again and nothing more happens.
        return False, "that escalation is not waiting for approval any more"

    money = budget_mod.check(config, kind="run")
    if not money.allowed:
        return False, money.reason

    item = Queued(subject=str(row.get("subject") or ""),
                  reason=str(row.get("detail") or ""))
    ran = await investigate_subject(item, provider=provider, config=config,
                                    document=document, trigger=trigger,
                                    session=session, run_id=wanted)
    return (ran, "" if ran else "the investigation could not be started")


def dismiss(run_id: str, *, reason: str = "") -> Tuple[bool, str]:
    """Settle a queued escalation without investigating it.

    ⚠️ A SECOND ROW, NEVER AN EDIT. The queued row stays exactly as written and
    this one refers to it by run id — the append-only rule `audit.py` opens
    with, and the reason a dismissed escalation remains visible as something a
    person decided rather than something that vanished.
    """
    wanted = str(run_id or "")
    row = next((r for r in audit_mod.pending_escalations()
                if str(r.get("run_id") or "") == wanted), None)
    if row is None:
        return False, "that escalation is not waiting for approval any more"
    ok = audit_mod.record_run(wanted, actor="owner", trigger="approved",
                              verdict="dismissed",
                              subject=str(row.get("subject") or ""),
                              detail=str(reason or "").strip())
    return ok, "" if ok else "the audit could not be written"


# ── helpers ─────────────────────────────────────────────────────────────────
def _ident(trigger: str, index: int, now: Optional[float] = None) -> str:
    """⚠️ THE INDEX IS PART OF IT. `runtime.investigate` mints
    `f"{trigger}{int(time.time())}"` when handed no id, and three investigations
    inside one pass finish inside one second — so all three would have shared a
    run id, and the audit rows of three separate subjects would have merged into
    one unreadable run."""
    stamp = int(time.time() if now is None else now)
    return f"{trigger}{stamp}-e{index + 1}"


def _entity_of(item: Any) -> str:
    """The entity id behind an escalated subject, or "" when there is none.

    ⚠️ `getattr`, LIKE `_subject_of` BESIDE IT, because three shapes arrive
    here — a `triage.Escalation`, a `Queued` from the approval path, and the
    audit row an approval is rebuilt from — and only the first has ever carried
    this. A missing attribute is "no device", which is a real answer.
    """
    return str(getattr(item, "entity_id", "") or "")


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
