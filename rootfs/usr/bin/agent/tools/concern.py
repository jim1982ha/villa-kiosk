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
concern on an open subject is a duplicate is `concerns.raise_concern`. Which
STORE it lands in is `shadow.suppressed`. This file turns tool arguments into a
`Concern` and hands it to a sink.

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

from typing import (Any, Callable, Dict, List, Mapping, Optional, Sequence,
                    Tuple)

from agent import contracts, render
from agent.concerns import Concern
from agent.refs import RefTable
from agent.tools.base import BaseTool, fail, text

#: Where a concern lands when the model gives no confidence of its own.
#: ⚠️ THE MIDDLE, NOT THE TOP. An unstated confidence is an unstated confidence.
DEFAULT_CONFIDENCE: float = 0.5


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
                 sink: Optional[Callable[[Concern], Tuple[bool, str]]] = None
                 ) -> None:
        self._refs = refs
        self._evidence_source = evidence_source
        self._sink = sink

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

        subject_key, label, problem = self._subject(args)
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
        concern = Concern(
            subject_key=subject_key,
            title=title,
            body=rendered.body,
            severity=severity,
            audience=audience,
            confidence=_confidence(args.get("confidence")),
            evidence=_stored_evidence(evidence),
            supersedes=[str(i).strip() for i in _list(args.get("supersedes"))
                        if str(i).strip()],
        )

        recorded, reason = self._sink(concern)
        if not recorded:
            # ⚠️ A REFUSAL IS A RESULT THE MODEL CAN ACT ON. "Two concerns are
            # already open about this subject — supersede one or say why this is
            # different" is an instruction; an exception is a dead run.
            return [fail("invalid_args", reason or "the concern was not recorded")]

        note = f"Recorded a {severity} concern about {label}."
        if rendered.stripped:
            note += (
                f" {rendered.stripped} figure(s) were REMOVED because no tool "
                f"result in this run contained them "
                f"({', '.join(rendered.removed[:3])}). Cite what you read, or "
                f"state the finding without a number.")
        return [text(note)]

    # ── the subject ─────────────────────────────────────────────────────────
    def _subject(self, args: Mapping[str, Any]) -> Tuple[str, str, str]:
        """`(subject_key, label, problem)`. The key is computed, never accepted.

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
                                f"Use a ref exactly as a tool result gave it.")
            return (contracts.subject_key(entity_id),
                    self._refs.label(ref) or ref if self._refs else ref, "")

        topic = " ".join(str(args.get("subject") or "").split()).lower()
        if not topic:
            return "", "", ("give `ref` when the concern is about one device, "
                            "or `subject` when it is about something else.")
        return contracts.subject_key(f"topic:{topic}"), topic, ""

    def _evidence(self) -> List[Dict[str, Any]]:
        try:
            rows = self._evidence_source() if callable(self._evidence_source) else []
        except Exception:  # noqa: BLE001 - a source is not worth a failed write
            return []
        return [dict(r) for r in rows if isinstance(r, Mapping)]


def writer(policy: Any, config: Optional[Mapping[str, Any]] = None
           ) -> Callable[[Concern], Tuple[bool, str]]:
    """The sink: suppression, then the store this deployment is writing to.

    ⚠️ THE MODEL CANNOT CHOOSE THE STORE, AND HAS NO ARGUMENT FOR IT. Shadow is
    read from config HERE, at the call site, so "in shadow mode a concern lands
    in the shadow store" is a property of the wiring rather than of the model's
    behaviour. A `shadow: true` tool argument would have been one hallucination
    away from a shadow period silently delivering.

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
    from agent import concerns as concerns_mod
    from agent import policy as policy_mod
    from agent import shadow as shadow_mod

    def record(concern: Concern) -> Tuple[bool, str]:
        if policy_mod.is_suppressed(policy, concern.subject_key):
            return False, ("a person has asked this villa to stop raising this "
                           "subject, so it was not recorded.")
        if shadow_mod.suppressed(config):
            return shadow_mod.record(concern, config=config)
        stored, reason = concerns_mod.raise_concern(concern)
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
