"""`raise_concern` — the one write on the reasoning path. TOOL-008, TASK-053.

⚠️ SPECIFIED FROM THE START AND BUILT LAST, WHICH IS WHY THE CHAIN NEVER RAN.
The tool catalogue has carried TOOL-008 since the plan was written, `mcp_server`
names it in `EXPORTED_WRITES` as "the one write on this surface", and
`policy.may_use_tool` names it in the comment recording why `WRITE` had to be
separated from `ACT` — the correction was made specifically so this tool would
not be denied the moment PH-3 turned it on. Nothing built it. So `concerns.raise_concern`
— and behind it the whole delivery half: lifecycle, dedup, supersedes, severity,
routing, escalation bands — was a set of finished functions whose only caller was
`agent/shadow.py`, which is itself reached only from `agent/route.py`, which takes
a concern AS AN ARGUMENT. An owner's triage pass escalated two real subjects and
produced no Concern, because there was no way for anything to produce one.

⚠️ IT DECIDES NOTHING IT COULD BE WRONG ABOUT — the same discipline `act.py`
states. Whether this run may write at all is `policy.may_use_tool` (already
asked by `registry.invoke` before `run` is reached). Whether a person has
silenced this subject is `policy.is_suppressed`. Whether the concern is
well formed is `contracts.concern_errors`, run by the store. Whether a second
concern on an open subject is a duplicate is `concerns.raise_concern`. Whether
it is an FYI is the villa's mode at raise time, stamped in `writer`. This file
turns tool arguments into a `Concern` and hands it to a sink.

⚠️ `subject_key` IS COMPUTED HERE AND IS NOT IN `inputSchema` (ARCH-011,
CTR-004). The model holds a `ref` — an opaque per-run handle — and never an
entity id, so it CANNOT compute the key even if it wanted to, and a
model-supplied one has no field to arrive in. That is what makes the shadow diff
comparable: `contracts.subject_key` is `sha256(entity_id)[:16]` on this side and
`reports.analysis.base.subject_key` is the same function on the rules side, so
the two layers recognise the same equipment without either holding an identifier.

⚠️ A SUBJECT THAT IS NOT A DEVICE GETS A `topic:` KEY, AND THAT KEY CAN NEVER
MATCH A RULE. Triage escalates things like "monitoring coverage" and "the
facility record" — real subjects with no entity behind them — so refusing them
would make the tool unable to record the finding the agent is best at. They are
hashed from `topic:<lowercased text>`, which is deliberately a different
preimage from any entity id: such a concern appears in the diff as `agent only`
and always will, because no blueprint can express it. Lowercased so the same
topic raised on two days deduplicates against itself.

⚠️ EVERY FIGURE IS CHECKED AGAINST THIS RUN'S OWN TOOL RESULTS BEFORE STORAGE
(ARCH-006). `render.enforce` strips a number the run never read and says how
many it took — and the count comes BACK to the model in the tool result, because
a silent strip teaches it nothing and it will write the same unsourced sentence
in the next concern.
"""

from __future__ import annotations

import re
from typing import (Any, Callable, Dict, List, Mapping, Optional, Sequence,
                    Tuple)

from vesta.supervise.agent import contracts
from vesta.supervise.agent import refs as refs_mod
from vesta.supervise.agent import render
from vesta.supervise.agent.concerns import Concern
from vesta.supervise.agent.refs import RefTable
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import text
from vesta.adapters.log import log, swallow

#: Where a concern lands when the model gives no confidence of its own.
#: ⚠️ THE MIDDLE, NOT THE TOP. An unstated confidence is an unstated confidence.
DEFAULT_CONFIDENCE: float = 0.5

#: A claim that a device has gone quiet, in the words a model actually uses.
#: ⚠️ MATCHED ON THE CLAIM, NOT ON THE SEVERITY OR THE FLAG TYPE. The alert that
#: caused this was a `warning` about a healthy sensor; nothing about its metadata
#: was unusual and only the sentence was false.
_SILENCE_CLAIM = re.compile(
    r"stopped\s+report|no\s+longer\s+report|not\s+report|zero\s+readings?"
    r"|no\s+readings?|has\s+gone\s+(?:quiet|offline|dark)|is\s+offline"
    r"|went\s+offline|stopped\s+responding|unavailable\s+for",
    re.IGNORECASE)

#: How recently a device must have been observed for a silence claim about it to
#: be REFUSED outright. ⚠️ DELIBERATELY SHORT. A device seen three minutes ago is
#: not offline under any reading of the claim; one last seen nine hours ago might
#: genuinely have stopped an hour later, and refusing that would be this check
#: overreaching into a judgement it cannot make. Hours.
SILENCE_MAX_AGE_HOURS: float = 1.0


class RaiseConcern(BaseTool):
    """TOOL-008. File one judged, evidenced concern about one subject.

    ⚠️ ONE INSTANCE PER RUN, bound at construction to that run's ref table, that
    run's evidence and that run's policy — the same lifetime rule `reply.py`
    follows and for the same reason. A shared instance would let a later run
    cite an earlier run's evidence, and refs are per-run by design: `d3` in two
    runs are unrelated devices.
    """

    name = "raise_concern"
    description = (
        "Record one concern for a person to read. Use it when you have finished "
        "reasoning and can name the subject, say what is wrong in a sentence, "
        "and point at the tool results that show it. Read read_concerns first: "
        "if this subject already has an open concern you must either supersede "
        "it or say why this is a different condition, or the write is refused. "
        "Every number you write is checked against what you actually read in "
        "this run; anything else is removed before storage.")
    inputSchema = {
        "type": "object",
        "properties": {
            "title": {"type": "string",
                      "description": "One short line naming the subject and "
                                     "the problem, as it will appear in a list."},
            "body": {"type": "string",
                     "description": "AT MOST THREE SHORT SENTENCES, read on a "
                                    "phone: what is wrong, the single figure "
                                    "that shows it, and what to do. Do not "
                                    "narrate the investigation, list every "
                                    "reading, or explain what you could not "
                                    "check — the evidence rows already hold "
                                    "all of that and a person can open them. "
                                    "Cite only figures you read from a tool in "
                                    "this run; anything else is removed and "
                                    "leaves a visible gap in your sentence."},
            "severity": {"type": "string", "enum": list(contracts.SEVERITY),
                         "description": "How urgently a person should look. "
                                        "There is no default — choose one."},
            "ref": {"type": "string",
                    "description": "The device handle this concern is about, "
                                   "from a tool result in this run. Give this "
                                   "whenever the concern is about one device."},
            "subject": {"type": "string",
                        "description": "Only when no single device is the "
                                       "subject — for example the observation "
                                       "coverage itself. A short, stable "
                                       "phrase; the same phrase next week is "
                                       "treated as the same subject."},
            "audience": {"type": "string", "enum": list(contracts.AUDIENCE),
                         "description": "Who this is written for. Defaults to "
                                        "the owner."},
            "confidence": {"type": "number",
                           "description": "0 to 1. How sure you are, not how "
                                          "bad it would be."},
            "supersedes": {"type": "array", "items": {"type": "string"},
                           "description": "Ids of open concerns this replaces, "
                                          "from read_concerns. They are closed "
                                          "and linked to this one."},
        },
        "required": ["title", "body", "severity"],
    }
    #: ⚠️ WRITE, NOT ACT. It touches nothing in the villa — it appends a record a
    #: person then reads. `policy.may_use_tool` separates the two, and the
    #: separation is what lets this work while actuation ships off.
    mode = "WRITE"
    #: ⚠️ STATED HERE, ENFORCED ELSEWHERE — `tiers` has no reader (see
    #: `BaseTool.tiers`). What keeps triage out is two independent mechanisms,
    #: both tested: `policy.may_use_tool` denies every WRITE to the triage tier,
    #: and `runtime.investigate` does not build this tool for that tier at all.
    #: Either alone would do; the second is here because this is the first thing
    #: on the reasoning path that changes state.
    tiers: Sequence[str] = ("reason",)

    def __init__(self, *, refs: Optional[RefTable] = None,
                 evidence_source: Optional[Callable[[], Sequence[Mapping[str, Any]]]] = None,
                 sink: Optional[Callable[[Concern], Tuple[bool, str]]] = None,
                 flag_type_of: Optional[Callable[[str], str]] = None,
                 last_seen_hours: Optional[Callable[[str], Optional[float]]] = None,
                 run_id: str = "") -> None:
        self._refs = refs
        # ⚠️ THE OBSERVATION FLOOR, INJECTED RATHER THAN IMPORTED, so a run
        # without one simply does not make this check instead of failing — the
        # same shape as `flag_type_of`. It answers "how many hours since the
        # villa last observed this device", or None for "cannot say", and None
        # must never be read as silence: see `journal.last_report_at`.
        self._last_seen_hours = last_seen_hours
        self._evidence_source = evidence_source
        self._sink = sink
        # ⚠️ INJECTED, AND STAMPED RATHER THAN ACCEPTED — the same rule as
        # `informational` and `run_id`. What KIND of thing this is decides how
        # readily its kind is raised in future (`agent/flagtypes.py`), so a
        # model argument for it would be one hallucination away from retuning
        # the owner's own preferences. It is computed here because this is the
        # only place that holds the entity id: the stored concern keeps a HASH
        # of its subject, so nothing downstream — including the thumb buttons —
        # could ever work the kind out afterwards.
        self._flag_type_of = flag_type_of
        # ⚠️ A PER-RUN BINDING LIKE THE OTHER THREE, set at construction rather
        # than read from anywhere later. The model cannot influence it, which is
        # the point: it is the audit's own answer to "which investigation wrote
        # this", not something the concern claims about itself.
        self._run_id = str(run_id)

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        severity = str(args.get("severity") or "").strip().lower()
        if not contracts.is_valid(severity, contracts.SEVERITY):
            # ⚠️ REFUSED, NEVER DEFAULTED TO THE QUIETEST. A severity nobody
            # classified must not arrive as `info` — the same rule
            # `standing.SEVERITY_OF_KIND` and `contracts.severity_rank` both
            # state, where the two copies that got it backwards sorted an
            # unknown severity LAST and hid it at the bottom of the brief.
            return [fail("invalid_args",
                         f"severity {severity!r} is not one of "
                         f"{list(contracts.SEVERITY)}. Choose one.")]

        audience = str(args.get("audience") or "owner").strip().lower()
        if not contracts.is_valid(audience, contracts.AUDIENCE):
            return [fail("invalid_args",
                         f"audience {audience!r} is not one of "
                         f"{list(contracts.AUDIENCE)}.")]

        title = " ".join(str(args.get("title") or "").split())
        if not title:
            return [fail("invalid_args", "title is empty")]

        subject_key, label, problem, entity_id = self._subject(args)
        if not subject_key:
            return [fail("invalid_args", problem)]

        evidence = self._evidence()
        if not evidence:
            # ⚠️ THE STORE WOULD REFUSE THIS ANYWAY (`concern_errors`: "evidence
            # is empty — every claim must cite a tool result"), and it is caught
            # here so the model reads WHY rather than a validation string about
            # a field it never filled in.
            return [fail("invalid_args",
                         "nothing has been read in this run, so there is no "
                         "evidence to cite and a concern without evidence is "
                         "refused. Read something that shows the problem first.")]

        if self._sink is None:
            # ⚠️ THE `ReadVilla` RULE: an unwired tool REFUSES rather than
            # quietly doing nothing. A write that silently went nowhere would
            # look exactly like a villa with no problems.
            return [fail("unavailable",
                         "this run cannot record concerns — no concern store "
                         "is wired to it.")]

        rendered = render.enforce(str(args.get("body") or ""), evidence)
        if rendered.stripped:
            # ⚠️ REFUSED, NOT DELIVERED WITH THE MARKER IN IT (2026-08-30). This
            # used to record the stripped body and tell the model afterwards, so
            # an owner received: "it showed [unsourced figure removed] against a
            # median of [unsourced figure removed] — a sustained anomaly." That
            # sentence asserts nothing, and it reads like a redaction of
            # something real rather than the absence of anything.
            #
            # ⚠️ AND THE STRIPPING WAS THE EVIDENCE THE FINDING WAS INVENTED.
            # Figures that resolve to no tool result are the signal `enforce`
            # exists to raise; carrying on to store the concern used the signal
            # as decoration. A refusal is a result the model can act on — the
            # same argument the duplicate branch below makes.
            #
            # ⚠️ LOSING THE FINDING IS THE ACCEPTED COST, AND IT MUST NOT BE A
            # SILENT ONE. At `depth: brief` — the DEFAULT — a run has 4 turns,
            # and the investigation that produced this defect used all four, so
            # a refusal on the last turn leaves no turn to restate in and the
            # concern simply does not happen. That is the right outcome for an
            # unsourced claim and the wrong one to hide: `scheduler` states the
            # same rule for escalations the cap drops ("a flagged item that is
            # never investigated leaves NO trace anywhere today").
            #
            # ⚠️ IT ALSO RESTORES A MEASUREMENT THIS CHANGE BROKE. `figures_stripped`
            # used to travel with the stored concern so "how often does the agent
            # invent numbers" was answerable from the record; nothing is stored
            # now, so the log carries it instead.
            self._refused("unsourced figures: "
                          + ", ".join(rendered.removed[:3]), title)
            return [fail("invalid_args",
                         f"{rendered.stripped} figure(s) in the body appear in "
                         f"no tool result from this run "
                         f"({', '.join(rendered.removed[:3])}). A concern is "
                         f"not recorded with unsourced numbers in it. Re-read "
                         f"what you are citing and quote the value exactly, or "
                         f"state the finding without a number.")]

        silence = self._silence_contradiction(title, rendered.body, entity_id)
        if silence:
            self._refused("the villa had just seen the device", title)
            return [fail("invalid_args", silence)]

        concern = Concern(
            subject_key=subject_key,
            title=refs_mod.personalise(title, self._refs),
            body=refs_mod.personalise(rendered.body, self._refs),
            severity=severity,
            audience=audience,
            confidence=_confidence(args.get("confidence")),
            evidence=_stored_evidence(evidence),
            supersedes=[str(i).strip() for i in _list(args.get("supersedes"))
                        if str(i).strip()],
            run_id=self._run_id,
            # ⚠️ NEVER RAISES, AND AN UNKNOWN KIND IS "" RATHER THAN A GUESS.
            # A concern whose kind could not be worked out simply does not take
            # part in the weighting — it is still raised, still delivered and
            # still on the wall. Failing the concern over its own metadata
            # would trade a real finding for a preference.
            flag_type=_flag_type(self._flag_type_of, entity_id),
        )

        recorded, reason = self._sink(concern)
        if not recorded:
            # ⚠️ A REFUSAL IS A RESULT THE MODEL CAN ACT ON. "Two concerns are
            # already open about this subject — supersede one or say why this is
            # different" is an instruction; an exception is a dead run.
            return [fail("invalid_args", reason or "the concern was not recorded")]

        # ⚠️ NO "figures were removed" CLAUSE ANY MORE — a stripped body is now
        # refused above and never reaches here, so a note about it would
        # describe a branch that cannot happen. It was the whole tail of this
        # message until 2026-08-30.
        return [text(f"Recorded a {severity} concern about {label}.")]

    def _refused(self, why: str, title: str) -> None:
        """One line so a refusal is visible to whoever reads the pass.

        ⚠️ THE MODEL'S TITLE, NOT ITS BODY, and no entity id — a refused concern
        is still a payload and the same rules apply to it. The title is what
        makes the line answer "which finding did we lose".
        """
        try:
            log(f"concern REFUSED ({why}): {title[:80]}")
        except Exception as err:  # noqa: BLE001 - a log must not fail a refusal
            swallow("could not log a refused concern", err)

    # ── the observation floor's veto ────────────────────────────────────────
    def _silence_contradiction(self, title: str, body: str,
                               entity_id: str) -> str:
        """The refusal when the run claims a device is quiet and the villa
        watched it report. "" when there is nothing to say.

        ⚠️ THIS IS THE ONE CHECK IN THIS FILE THAT JUDGES THE FINDING, and it
        earns the exception by comparing the claim against OBSERVED DATA rather
        than against a preference. Everything else here refuses malformed input;
        this refuses a statement the journal contradicts.

        ⚠️ ONE DIRECTION ONLY. A device the journal has not heard from is NOT
        thereby silent — the journal records material changes, so a steady
        device can be healthy and absent from it (`journal.last_report_at` states
        this at length). So `None` and "too long ago" both mean "no opinion",
        and the only outcome available here is refusing a claim that is
        provably false.

        ⚠️ FOUND IN THE FIELD, ON A DUTY-CYCLED DEVICE. A bathroom light and VMC
        power sensor reads 0 W most of the day and 30-40 W when the room is in
        use, so its median is near zero and "zero readings" is a fair
        description of most of its samples — but not of the device. The model
        turned "the value is usually zero" into "it has stopped reporting". That
        is the same misreading `salience._clusters` was built for on the rules
        side, arriving here through a tier that has no equivalent guard.
        """
        if not entity_id or self._last_seen_hours is None:
            return ""
        if not _SILENCE_CLAIM.search(f"{title}\n{body}"):
            return ""
        try:
            age = self._last_seen_hours(entity_id)
        except Exception as err:  # noqa: BLE001 - a veto must not fail the run
            swallow("could not check when the device last reported", err)
            return ""
        if age is None or age > SILENCE_MAX_AGE_HOURS:
            return ""
        minutes = int(max(0.0, age) * 60)
        return (f"this says the device has stopped reporting, but the villa "
                f"recorded a change from it {minutes} minute(s) ago, so that "
                f"is not true. If the reading is often ZERO, say that instead "
                f"— a value of zero is not a missing reading. Re-read its "
                f"recent history before raising this.")

    # ── the subject ─────────────────────────────────────────────────────────
    def _subject(self, args: Mapping[str, Any]) -> Tuple[str, str, str, str]:
        """`(subject_key, label, problem, entity_id)`. The key is computed,
        never accepted, and the entity id is returned for the CALLER's use
        only — see `run`, which turns it into a flag type and drops it. It is
        never stored on the concern and never shown to a model.

        ⚠️ A `ref` THIS RUN DID NOT MINT IS REFUSED RATHER THAN HASHED. A model
        that invents `d47` would otherwise open a concern about a device that
        does not exist, keyed on a hash nothing else will ever produce — a
        finding no reader could act on and no diff could match.
        """
        ref = str(args.get("ref") or "").strip()
        if ref:
            entity_id = self._refs.resolve(ref) if self._refs is not None else None
            if not entity_id:
                return "", "", (f"{ref!r} is not a device handle from this run. "
                                f"Use a ref exactly as a tool result gave it."), ""
            return (contracts.subject_key(entity_id),
                    self._refs.label(ref) or ref if self._refs else ref, "",
                    entity_id)

        topic = " ".join(str(args.get("subject") or "").split()).lower()
        if not topic:
            return "", "", ("give `ref` when the concern is about one device, "
                            "or `subject` when it is about something else."), ""
        return contracts.subject_key(f"topic:{topic}"), topic, "", ""

    def _evidence(self) -> List[Dict[str, Any]]:
        try:
            rows = self._evidence_source() if callable(self._evidence_source) else []
        except Exception:  # noqa: BLE001 - a source is not worth a failed write
            return []
        return [dict(r) for r in rows if isinstance(r, Mapping)]


def writer(policy: Any, config: Optional[Mapping[str, Any]] = None
           ) -> Callable[[Concern], Tuple[bool, str]]:
    """The sink: suppression, then the one live store — with the delivery
    class stamped from the villa's mode.

    ⚠️ THE MODEL CANNOT CHOOSE THE DELIVERY CLASS, AND HAS NO ARGUMENT FOR IT.
    The mode is read from config HERE, at the call site, so "in Investigate &
    Log Only a concern is informational" is a property of the wiring rather
    than of the model's behaviour — an `informational: true` tool argument
    would be one hallucination away from a mode that never chases anything.

    ⚠️ THE SHADOW STORE IS GONE FROM THIS PATH (2026-08-28, owner's ruling).
    Observe-mode concerns used to land in a separate file and be delivered to
    nobody — the cutover-measurement design. The owner has since ruled that
    "Alert only" — named "Investigate & Log Only" at the time — means the
    concern is visible on the Reason tab
    and told once as an FYI; what the mode withholds is ESCALATION and the
    to-do job, and `informational` below is how the outbox knows.

    ⚠️ SUPPRESSION IS CHECKED BEFORE THE WRITE, AND IT IS `policy`'s ANSWER.
    `is_suppressed` reads the frozen run snapshot, so a subject silenced by a
    person cannot be re-raised by a run that started before they said so, and a
    config edit mid-run cannot widen what this run may say.

    ⚠️ `policy.concern_admissible` IS DELIBERATELY NOT THE CALL HERE, AND THIS IS
    THE ONE PLACE THAT WOULD LOOK WRONG WITHOUT A NOTE. It bundles suppression
    with `contracts.concern_errors`, which requires a NON-EMPTY `id` — and the
    id is minted by `concerns.raise_concern`, after this point, on purpose (that
    module's own comment records the release where validating before minting
    refused every concern for "id is empty"). So the two halves are asked where
    each can be answered: suppression here, validity in the store.
    """
    from vesta.supervise.agent import concerns as concerns_mod
    from vesta.supervise.agent import config as agent_config
    from vesta.supervise.agent import policy as policy_mod

    def record(concern: Concern) -> Tuple[bool, str]:
        if policy_mod.is_suppressed(policy, concern.subject_key):
            return False, ("a person has asked this villa to stop raising this "
                           "subject, so it was not recorded.")
        # ⚠️ STAMPED, NEVER CLEARED: a concern raised informational stays so
        # after a mode change, exactly as `TriagePass.mode` records the mode
        # the check RAN under rather than the villa's setting today.
        if str(agent_config.view(config).get("mode")) == "observe":
            concern.informational = True
        stored, reason = concerns_mod.raise_concern(concern)

        # ⚠️ THE DOMAIN COMES FROM THE PLAYBOOK THIS INVESTIGATION READ
        # (2026-08-30, the owner's ask to see "Water · 2 · Electrical · 1").
        # There is ONE agent, not seven — the playbooks are procedures it
        # consults — so the label rides the concern rather than pretending a
        # `water_agent` exists for a reader to go looking for.
        #
        # ⚠️ AND THE RECORD ENTRY CARRIES `ref` + `subject_key`, NOT A COPY.
        # `ref` points at the concern (whose store stays the authority on its
        # state); `subject_key` is the SAME key the triage flag carries, which
        # is how the briefing groups a flag and the concern it became into one
        # story instead of counting the event twice.
        if stored:
            try:
                from vesta.adapters import record as record_mod
                from vesta.supervise.agent import playbooks as playbooks_mod
                record_mod.append({
                    "source": "agent",
                    "domain": playbooks_mod.domain_this_run(),
                    "subject": concern.title,
                    "subject_key": concern.subject_key,
                    "title": concern.title,
                    "detail": concern.body,
                    "severity": concern.severity,
                    "ref": concern.id,
                })
                record_mod.stamp_outcome(concern.subject_key,
                                         f"investigated → {concern.id}")
            except Exception as err:  # noqa: BLE001 - never fail a concern
                swallow("could not record the concern", err)
        return bool(stored), reason

    return record


#: Keys an evidence row may carry INTO THE STORE. ⚠️ `cited` is deliberately
#: absent: `registry` attaches the whole tool result under that key so
#: `render.enforce` can check a figure against everything the run read, and
#: storing it would put up to 8 KB per row into a file bounded at 2,000 concerns.
#: The trade is stated rather than hidden — a later reader sees the 200-character
#: summary and cannot re-run the figure check offline. The check happened, its
#: result is recorded in `figures_stripped`, and the alternative is a store two
#: orders of magnitude larger than its own comment claims.
STORED_EVIDENCE_FIELDS: Tuple[str, ...] = ("tool", "args_digest", "at", "summary")


def _stored_evidence(rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """⚠️ AN ALLOW-LIST, LIKE EVERY OTHER OUTBOUND FILTER IN THIS PACKAGE — it
    loops over the permitted names, never over the input, so a key added to an
    evidence row upstream cannot reach the store by default."""
    return [{k: row[k] for k in STORED_EVIDENCE_FIELDS if k in row}
            for row in rows]


def _flag_type(resolver: Optional[Callable[[str], str]], entity_id: str) -> str:
    """What KIND this is, or "" when it cannot be said.

    ⚠️ A TOPIC-ONLY CONCERN HAS NO KIND, and that is correct rather than a gap.
    "Observation coverage is incomplete" is about the villa's own listening, not
    about a measurement going one way or the other, so there is nothing for a
    measurement-and-direction key to describe — and inventing a bucket for it
    would put unrelated findings in one row of the owner's tuning list.
    """
    if resolver is None or not entity_id:
        return ""
    try:
        return str(resolver(entity_id) or "")
    except Exception as err:  # noqa: BLE001
        swallow("could not work out the flag type of a concern", err)
        return ""


def _confidence(value: Any) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return DEFAULT_CONFIDENCE
    if out != out or abs(out) == float("inf"):
        return DEFAULT_CONFIDENCE
    return max(0.0, min(1.0, out))


def _list(value: Any) -> List[Any]:
    return list(value) if isinstance(value, (list, tuple)) else []


# ⚠️ THERE IS NO EXPORT TUPLE HERE, AND ITS ABSENCE IS THE POINT. Every other
# tool module ends in one and `agent/tools/__init__.py` collects them into
# `ALL_TOOLS`; this tool must NOT be collected, because it is bound at
# construction to one run's evidence, refs and policy snapshot, and an unbound
# instance offered to every scheduled run is a verb the model cannot use — the
# same reason `ReplyTool` and `ActService` are not collected either. The
# exemption is named in `test_agent_contracts`'s `EXEMPT` map with this reason,
# where a package walk would otherwise flag it; `runtime.investigate` is the one
# construction site, and `test_tool_raise_concern` pins that it is reached.
