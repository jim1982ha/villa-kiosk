"""Turning a finished investigation into a Claim, and sometimes a Draft.

ADR-0004 and ADR-0005. This module is the answer to a question `memory.py` and
`review.py` both pose and neither answers: they refuse to be written from a
tool, so something on the reasoning path has to do it.

⚠️ IT RUNS AFTER THE INVESTIGATION HAS ALREADY PRODUCED ITS ANSWER, AND MAY
NEVER COST IT ANYTHING. Every failure here — provider down, ceiling reached, an
unparseable reply, nothing worth keeping — writes nothing and returns. A
delivered concern must never be traded for a claim, which is the posture
`review.propose` already states for its own refusals.

⚠️ THE EXTRACTOR SEES THE MODEL'S OWN PROSE AND NOTHING ELSE. Not a tool
result, not the villa document, not the existing claims. The first is
`memory.py`'s fourth rule: tool results carry text other people wrote, and a
write path from there into permanent state is an injection. The second and
third are this module's own: an extractor shown the current memory index would
be reading yesterday's claims while deciding today's, which is how a store of
claims quietly converges on agreeing with itself.

⚠️ AND CONFIDENCE IS NOT ASKED FOR, IT IS DERIVED (ADR-0005). A model's stated
confidence is a token distribution, not a measurement, and it is the single
number that decides whether a claim becomes a premise under every future
report. `confidence_for` reads what actually happened instead.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Sequence

from vesta.adapters.log import log, swallow
from vesta.supervise.agent import config as agent_config
from vesta.supervise.agent import contracts as agent_contracts
from vesta.supervise.agent import memory as memory_mod
from vesta.supervise.agent import playbooks as playbooks_mod
from vesta.supervise.agent import review as review_mod

#: What a run scores before anything is known in its favour. ⚠️ BELOW
#: `ASSERT_CONFIDENCE` BY A CLEAR MARGIN AND NOT BY ONE STEP: the floor is what
#: an investigation that answered and did nothing else is worth, and an
#: arrangement where a single weak signal lifts that to asserted would make the
#: threshold decorative.
BASE_CONFIDENCE: float = 0.30

#: What each thing that actually happened is worth. ⚠️ THESE ARE WEIGHTS ON
#: EVIDENCE OF WORK, NOT ON TRUTH. None of them can tell whether the claim is
#: right; together they say how much looking stands behind it, which is the
#: only question a machine downstream of the prose can answer.
LOOKED_AROUND: float = 0.15      # it made at least `MIN_TOOL_CALLS` reads
CORROBORATED: float = 0.15       # two or more pieces of evidence
WELL_EVIDENCED: float = 0.10     # four or more
FOLLOWED_A_PROCEDURE: float = 0.15   # it had a playbook to work from

#: Evidence counts the weights above key on.
CORROBORATED_AT: int = 2
WELL_EVIDENCED_AT: int = 4

#: ⚠️ NO CLAIM IS EVER CERTAIN. The ceiling sits below 1.0 because this store's
#: worst outcome is a confident wrong premise, and nothing derived from one
#: run's own behaviour has earned certainty about the property.
MAX_CONFIDENCE: float = 0.85

#: What the extractor is told. ⚠️ IT IS ASKED FOR A STANDING FACT, NOT A
#: SUMMARY. "The pump drew 60W on Tuesday" is the investigation's finding and
#: belongs in its concern; "this pump idles near 40W" is what is still true next
#: month, and only the second kind is worth asserting for a quarter.
CLAIM_INSTRUCTIONS: str = """\
You are given the written conclusion of one investigation into a property.

Reply with ONE sentence stating a lasting fact about the equipment it
concerns — something that will still be true next month and is worth knowing
before the next investigation of it.

Reply with exactly the word NOTHING if the conclusion establishes only what
happened on one occasion, or if it is about a fault rather than about how the
equipment normally behaves.

Do not explain, qualify, or add a preamble. One sentence, or NOTHING."""

#: ⚠️ THE DRAFT IS A PROCEDURE, NOT A CONCLUSION, and it is asked for
#: separately (ADR-0004) so the passes that propose nothing — most of them —
#: pay for nothing.
DRAFT_INSTRUCTIONS: str = """\
You are given the written conclusion of one investigation into a property.

Write a short procedure for investigating this KIND of situation again: what to
check, in what order, and what each answer would mean. Address it to whoever
investigates next.

Write about the kind, never this one occasion. Use markdown, no title, and stop
at about two hundred words."""

#: The word the extractor says when there is nothing to keep.
NOTHING: str = "NOTHING"


def confidence_for(result: Any, *, playbook_consulted: bool = False) -> float:
    """How much looking stands behind this run's conclusion. ADR-0005.

    ⚠️ ONLY AN `answered` RUN SCORES AT ALL. `partial` means the run hit its
    turn ceiling or was cut off, and a standing belief derived from a truncated
    investigation is precisely what must not be asserted for a quarter — even
    though `AgentResult.usable` counts `partial`, because THAT question is
    "is there something to show a person" and this one is "may this become a
    premise". Two questions, and the stricter one is here.
    """
    if str(getattr(result, "status", "")) != "answered":
        return 0.0
    evidence = len(getattr(result, "evidence", ()) or ())
    score = BASE_CONFIDENCE
    if int(getattr(result, "tool_calls", 0) or 0) >= review_mod.MIN_TOOL_CALLS:
        score += LOOKED_AROUND
    if evidence >= CORROBORATED_AT:
        score += CORROBORATED
    if evidence >= WELL_EVIDENCED_AT:
        score += WELL_EVIDENCED
    if playbook_consulted:
        score += FOLLOWED_A_PROCEDURE
    return min(score, MAX_CONFIDENCE)


def should_propose(result: Any, *, playbook_consulted: bool) -> bool:
    """Whether this investigation warrants a Draft. ADR-0006.

    ⚠️ THE CONDITION IS "THE VILLA HAD NOTHING WRITTEN DOWN", NOT "THIS WAS
    HARD". `review.MIN_TOOL_CALLS` is a floor that refuses a lookup; it cannot
    tell an investigation worth writing up from one that merely worked. Having
    consulted no playbook can, it is mechanically checkable, and it self-limits
    — every approved draft removes the condition that produced it.
    """
    if str(getattr(result, "status", "")) != "answered":
        return False
    if playbook_consulted:
        return False
    return int(getattr(result, "tool_calls", 0) or 0) >= review_mod.MIN_TOOL_CALLS


def _one_sentence(text: str) -> str:
    """The extractor's reply, or "" if it declined or rambled."""
    said = " ".join(str(text or "").split())
    if not said or said.upper().startswith(NOTHING):
        return ""
    # ⚠️ A REPLY THAT IGNORED "ONE SENTENCE" IS REFUSED, NOT TRUNCATED. Cutting
    # a paragraph at its first full stop keeps whichever half happened to come
    # first, and this store is the one place a half-claim is asserted for ever.
    return said if len(said) <= 300 else ""


def known_domains() -> Sequence[str]:
    """The domain folders the villa's playbooks already use.

    ⚠️ AN ALLOWLIST, BECAUSE A MODEL PICKS FROM IT. A draft filed under an
    invented domain is a draft nobody browsing by subject will find, and
    `descriptions()` already reads the real set out of front matter — a literal
    list here would be the second list that goes stale the day a folder is
    added.
    """
    seen = []
    for root in (playbooks_mod.LEARNED_ROOT, playbooks_mod.SHIPPED_ROOT):
        for row in playbooks_mod.descriptions(root):
            found = str(row.get("domain") or "").strip()
            if found and found not in seen:
                seen.append(found)
    return tuple(seen)


def parse_draft(text: str, *,
                domains: Sequence[str]) -> Optional[Dict[str, str]]:
    """A draft reply into `{slug, domain, description, body}`, or None.

    ⚠️ THE SLUG IS NOT VALIDATED HERE, AND THAT IS DELIBERATE. `review.propose`
    owns that rule — it refuses uppercase rather than lowercasing it, and says
    why — so a second copy of the shape test in this module would be a second
    opinion about a name `review` decides. This function structures the reply;
    `propose` accepts or refuses it. A bad name simply means no draft, silently,
    which is already what every other refusal there does.

    ⚠️ THE DOMAIN *IS* CHECKED HERE, because nothing downstream checks it. A
    draft filed under a domain the model invented is one nobody browsing by
    subject will find, and `propose` stores the string as given.
    """
    head, _, body = str(text or "").partition("---")
    if not body.strip():
        return None
    fields: Dict[str, str] = {}
    for line in head.splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip().upper()] = value.strip()
    slug = fields.get("NAME", "")
    domain = fields.get("DOMAIN", "")
    description = fields.get("WHAT", "")
    if not slug or not description or domain not in domains:
        return None
    return {"slug": slug, "domain": domain,
            "description": description, "body": body.strip()}


async def _ask(instructions: str, prose: str, *, provider: Any,
               config: Optional[Mapping[str, Any]], session: Any,
               trigger: str) -> str:
    """One cheap, toolless call over the investigation's own prose.

    ⚠️ THE SYSTEM BLOCKS ARE BUILT HERE AND NOT BY `playbooks.system_blocks`,
    WHICH IS OTHERWISE THE ONE BUILDER. That function assembles the
    constitution, the playbook catalogue AND the current memory index — all
    correct for a tier that reasons about the villa, and all wrong for this one.
    An extractor shown the existing claims is reading yesterday's conclusions
    while deciding today's, which is how a store of claims converges on agreeing
    with itself; and it has no need of a catalogue it cannot open.

    ⚠️ `tool_names=()` IS NOT `None`. `runtime.investigate` narrows on `is not
    None`, so the empty tuple means no tools while `None` would hand it the full
    registry — the difference between a call that cannot read the villa and one
    that can.
    """
    from vesta.supervise.agent import runtime
    try:
        out = await runtime.investigate(
            provider=provider,
            system=[{"type": "text", "text": instructions,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": prose}],
            tool_names=(), config=config, session=session,
            tier="triage", trigger=trigger)
    except Exception as err:  # noqa: BLE001 - learning must never cost a run
        swallow("the extraction call raised", err)
        return ""
    return str(out.text or "") if out.status == "answered" else ""


async def learn_from(result: Any, item: Any, *, provider: Any,
                     config: Optional[Mapping[str, Any]] = None,
                     session: Any = None,
                     trigger: str = "scheduled") -> None:
    """Record what this investigation established. NEVER raises, ever.

    ⚠️ CALLED AFTER THE INVESTIGATION HAS DELIVERED. Nothing this function does
    or fails to do may change what a person was told; the whole body is
    therefore inside one guard, and every individual step degrades on its own.
    """
    try:
        await _learn(result, item, provider=provider, config=config,
                     session=session, trigger=trigger)
    except Exception as err:  # noqa: BLE001 - a delivered finding outranks this
        swallow("learning from an investigation failed", err)


def has_headroom(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Whether there is budget to spare for learning. ADR-0004.

    ⚠️ LEARNING MUST NEVER TAKE THE REQUEST AN INVESTIGATION NEEDED, and the
    first cut of this feature did exactly that. `test_the_budget_is_asked_
    before_every_investigation_not_once_per_pass` sets a ceiling of three: the
    triage call takes one and each investigation takes one, so two
    investigations run and the third must not start. Adding an extraction call
    per investigation spent the second investigation's request on a claim about
    the first — the pass investigated LESS because it was learning, which is
    the priority exactly inverted.

    ⚠️ SO THIS ASKS A STRICTER QUESTION THAN `budget.check`. Not "may I make a
    request" — the answer to that is yes right up until the last one — but "is
    there a request to spare after this pass has done its actual work". The
    reserve is the per-pass investigation cap, because that is the most a pass
    can still need.

    ⚠️ THE MONEY CEILING IS LEFT TO `budget.check`. `daily_usd_limit` is a
    different axis and there is no honest way to reserve dollars for
    investigations that have not been priced yet; an extraction is a fraction
    of an investigation, so the coarse ok/not-ok is proportionate there.
    """
    from vesta.supervise.agent import budget as budget_mod
    verdict = budget_mod.check(config, kind="run")
    if not verdict.allowed:
        return False
    reserve = 0
    try:
        reserve = int(agent_config.view(config).get(
            "max_investigations_per_pass") or 0)
    except (TypeError, ValueError):
        reserve = 0
    return verdict.remaining > max(reserve, 1)


async def _learn(result: Any, item: Any, *, provider: Any,
                 config: Optional[Mapping[str, Any]], session: Any,
                 trigger: str) -> None:
    # ⚠️ ASKED ONCE, BEFORE EITHER CALL. A claim and a draft are both optional;
    # neither is worth the request an investigation is owed.
    if not has_headroom(config):
        return
    consulted = bool(playbooks_mod.consulted_this_run())
    source = str(getattr(result, "run_id", "") or "")
    if not source:
        # ⚠️ RULE 1 IS NOT NEGOTIABLE HERE EITHER. `write` and `propose` both
        # refuse without a source; asking them to refuse is a wasted model call.
        return

    confidence = confidence_for(result, playbook_consulted=consulted)
    if confidence > 0:
        await _record_claim(result, item, confidence=confidence, source=source,
                            provider=provider, config=config, session=session,
                            trigger=trigger)
    if should_propose(result, playbook_consulted=consulted):
        await _propose_draft(result, source=source, provider=provider,
                             config=config, session=session, trigger=trigger)


async def _record_claim(result: Any, item: Any, *, confidence: float,
                        source: str, provider: Any,
                        config: Optional[Mapping[str, Any]], session: Any,
                        trigger: str) -> None:
    """One Claim, for one Subject.

    ⚠️ ONLY WHEN THE INVESTIGATION CONCERNED EXACTLY ONE SUBJECT. The store is
    one claim per subject key, and an investigation of "Pool Pump and Massage
    Jet Pump" carries TWO keys with one sentence between them — writing it to
    both would file a fact about one device under the other, permanently, and
    picking the first would do the same silently. A pair teaches the villa
    nothing rather than teaching it something false.
    """
    keys = agent_contracts.subject_keys_of(item)
    if len(keys) != 1:
        return
    prose = str(getattr(result, "text", "") or "").strip()
    if not prose:
        return
    said = _one_sentence(await _ask(CLAIM_INSTRUCTIONS, prose, provider=provider,
                                    config=config, session=session,
                                    trigger=trigger))
    if not said:
        return
    if memory_mod.write(keys[0], claim=said, source=source,
                        confidence=confidence):
        log(f"learned about {keys[0]} at {confidence:.2f} from {source}")


async def _propose_draft(result: Any, *, source: str, provider: Any,
                         config: Optional[Mapping[str, Any]], session: Any,
                         trigger: str) -> None:
    """One Draft, for a kind of situation the villa had no procedure for."""
    domains = known_domains()
    if not domains:
        return
    prose = str(getattr(result, "text", "") or "").strip()
    if not prose:
        return
    asked = DRAFT_INSTRUCTIONS + "\n\nUse one of these domains, exactly as "
    asked += "spelled: " + ", ".join(domains) + ".\n\n"
    asked += ("Reply in this shape:\nDOMAIN: <one of the above>\n"
              "NAME: <a-lowercase-hyphenated-name>\nWHAT: <one line>\n---\n"
              "<the procedure>")
    draft = parse_draft(await _ask(asked, prose, provider=provider,
                                   config=config, session=session,
                                   trigger=trigger), domains=domains)
    if not draft:
        return
    review_mod.propose(draft["slug"], domain=draft["domain"],
                       description=draft["description"], body=draft["body"],
                       source=source,
                       tool_calls=int(getattr(result, "tool_calls", 0) or 0))
