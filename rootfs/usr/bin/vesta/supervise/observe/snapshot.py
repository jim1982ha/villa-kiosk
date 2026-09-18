"""The Villa Document: a stable PROFILE, then a fresh PERIOD DELTA.

⚠️ THE ORDER IS A COST REQUIREMENT WEARING A STRUCTURE REQUIREMENT'S CLOTHES.
Prompt caching bills a stable prefix at roughly a tenth of the normal input rate,
and it matches on an exact prefix — so the half of this document that does not
change must come FIRST and must be byte-identical between calls. The profile is
about six thousand tokens and the delta about two, which is what makes ~75% of
every triage call nearly free and a 15-minute cadence affordable at all. Swap the
two sections and the cadence costs four times as much for identical output.

⚠️ THEREFORE: NO TIMESTAMP, RUN ID, COUNTER, DURATION OR "AS OF" ANYWHERE IN THE
PROFILE. One interpolated date is not a cosmetic flaw — it changes the prefix on
every call, so the cache never hits, and the failure is SILENT. The bill goes up
and the output looks perfect. `profile()` is a pure function of the registry for
exactly this reason, and `test_snapshot.py` renders it twice and diffs the bytes.

⚠️ LABELS, NEVER ENTITY IDS. The profile describes the property to a model that
may be remote; `contracts.PAYLOAD_ALLOWED_FIELDS` bans ids from unattended
payloads and this is the biggest unattended payload in the system. Room and
equipment names ARE admitted — prose that cannot say which pump is prose nobody
can act on — but a raw id of the `sensor.<someone>_bedroom_window` shape carries
a person's name off the property to say something the label already said.

⚠️ AND THE VILLA MUST STATE WHAT IT CANNOT BE ASKED ABOUT. `discovery` already
computes which capabilities are absent and holds a fixed English sentence for
each; those sentences are rendered VERBATIM (TASK-013). A model that does not
know it is blind answers confidently anyway, and a confident answer about an
unmetered circuit is worse than silence — it is the failure mode this whole
redesign is meant to remove, arriving by a new route.
"""

from __future__ import annotations

from typing import Any, Callable, List, Mapping, Optional, Sequence

from vesta.adapters.log import note
from vesta.supervise.observe import salience as salience_mod

# ── section headings, fixed so the prefix is stable ──────────────────────────
PROFILE_HEADING = "VILLA PROFILE"
DELTA_HEADING = "PERIOD DELTA"

#: The marker a caller puts a cache breakpoint on. It is the LAST line of the
#: profile, so everything above it is the cacheable prefix.
CACHE_BREAKPOINT = "--- end of profile ---"


def _plural(count: int, singular: str, plural: str = "") -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def _singular(label: str) -> str:
    """A regular English plural made singular, for a count of one.

    ⚠️ A HEURISTIC, AND BOUNDED SO IT CANNOT MANGLE. Only regular `-ies` and
    trailing `-s` are touched, and a word ending in `-ss` is left alone, so
    "1 climate units" becomes "1 climate unit" while "1 status" stays itself.
    Anything irregular is the CALLER's to label correctly — the renderer is not
    the place for an English lexicon.
    """
    if label.endswith("ies") and len(label) > 4:
        return label[:-3] + "y"
    if label.endswith("s") and not label.endswith("ss"):
        return label[:-1]
    return label


def _counted(items: Mapping[str, int]) -> str:
    """"3 pumps, 11 lights, 2 locks" — sorted so the string is stable.

    ⚠️ SORTED IS NOT COSMETIC HERE. A dict built by iterating a registry can
    come back in a different order after a restart, and an unsorted join would
    make the profile differ byte-for-byte between two runs over an unchanged
    villa — destroying the cache for a reason nobody would ever look for.
    """
    parts = [f"{count} {_singular(name) if count == 1 else name}"
             for name, count in sorted(items.items()) if count]
    return ", ".join(parts) if parts else "none"


def profile(*, floors: Sequence[str] = (), areas: Sequence[str] = (),
            devices_by_class: Optional[Mapping[str, int]] = None,
            metered: Sequence[Mapping[str, str]] = (),
            helpers: Sequence[str] = (),
            equipment: Sequence[Mapping[str, str]] = (),
            absent_capabilities: Optional[Sequence[str]] = None) -> str:
    """The stable half. A pure function of the villa's structure.

    ⚠️ EVERY ARGUMENT IS A FACT ABOUT THE PROPERTY THAT CHANGES WHEN THE
    PROPERTY CHANGES — never when the clock moves. If a future caller wants to
    add "devices currently unavailable" here, that belongs in the DELTA: it is
    a fact about right now, and putting it above the breakpoint would silently
    end caching. The test that diffs two renders is the guard, and it only works
    because this function takes no time and reads no clock.

    `absent_capabilities` holds discovery's own sentences, rendered verbatim
    (TASK-013): they are constants in this add-on's source, identical on every
    install, and paraphrasing them would turn a checked statement into
    generated text.
    """
    lines: List[str] = [PROFILE_HEADING, ""]

    # ⚠️ AN UNKNOWN LAYOUT IS PRINTED, NOT OMITTED, AND OMITTING IT PRODUCED A
    # CONFIDENTLY WRONG ANSWER ON A REAL VILLA. `build_profile_source` never
    # supplied `floors`/`areas`, so this block rendered nothing at all and the
    # document named NO room — and asked "how many lights are on in the gym
    # room", the agent replied "the villa has no gym room in its device
    # inventory" and listed six rooms it had reconstructed from entity NAMES.
    # Two of those six ("dining area", "outdoor entrance") are not areas of that
    # property at all; the gym is, with a light in it. Silence read as absence,
    # which is this subsystem's oldest failure wearing a new hat: three kinds of
    # empty — "no rooms", "rooms I was not told about" and "nobody asked" — and
    # only the last is true here.
    #
    # ⚠️ SAME None-vs-EMPTY RULE AS `absent_capabilities`, for the same reason.
    # `areas=()` means "nobody has told me the layout"; a villa that genuinely
    # has no areas configured is a real and different state, and a reader who
    # cannot tell them apart will answer questions about rooms from whatever
    # else is in front of them.
    if floors or areas:
        lines.append(
            f"Layout: {_plural(len(floors), 'floor')}, "
            f"{_plural(len(areas), 'area')}.")
        if areas:
            lines.append(f"  Areas: {', '.join(sorted(areas))}.")
    else:
        lines.append(
            "Layout: NOT SURVEYED. The rooms of this property have not been "
            "read, so this document names none. Do NOT conclude that a room a "
            "person asks about does not exist — you have not been told what "
            "exists. Say that you cannot see the layout.")
    lines.append("")

    if devices_by_class:
        lines.append(f"Devices by class: {_counted(devices_by_class)}.")
        lines.append("")

    if metered:
        lines.append("Metered circuits and what they feed:")
        for row in sorted(metered, key=lambda r: str(r.get("circuit", ""))):
            circuit = str(row.get("circuit") or "").strip()
            feeds = str(row.get("feeds") or "").strip()
            if circuit:
                lines.append(f"  {circuit}"
                             + (f" — {feeds}" if feeds else ""))
        lines.append("")

    if equipment:
        lines.append("Equipment and what normal looks like:")
        for row in sorted(equipment, key=lambda r: str(r.get("name", ""))):
            name = str(row.get("name") or "").strip()
            purpose = str(row.get("purpose") or "").strip()
            normal = str(row.get("normal") or "").strip()
            if not name:
                continue
            tail = " — ".join(p for p in (purpose, normal) if p)
            lines.append(f"  {name}" + (f" — {tail}" if tail else ""))
        lines.append("")

    if helpers:
        lines.append(f"Helpers: {', '.join(sorted(helpers))}.")
        lines.append("")

    # ⚠️ LAST, AND ALWAYS PRESENT EVEN WHEN EMPTY. "Nothing is unmeasured here"
    # is a claim worth making explicitly: an absent section reads as an
    # unanswered question, and the whole point of this block is that the model
    # knows the shape of its own blindness before it starts reasoning.
    #
    # ⚠️ AND IT IS THREE-VALUED, BECAUSE THE TWO-VALUED VERSION OVER-CLAIMED AND
    # THE AGENT CAUGHT IT ON THE REFERENCE VILLA. `None` means nobody has
    # surveyed this property's blind spots; `[]` means somebody did and found
    # none. Both used to print "Nothing known to be unmeasured", which reads as
    # FULL COVERAGE — and its own words were quoted back at me: "it is only a
    # statement about gaps someone has already catalogued, and this property has
    # evidently catalogued none." Exactly the failure the rest of this block
    # exists to prevent, in the line that claims to prevent it.
    lines.append("What this villa cannot be asked about:")
    if absent_capabilities is None:
        lines.append("  - NOT SURVEYED. Nobody has catalogued this property's "
                     "blind spots, so treat every absence below as unexplained "
                     "rather than as coverage.")
    elif absent_capabilities:
        for sentence in absent_capabilities:
            text = str(sentence).strip()
            if text:
                lines.append(f"  - {text}")
    else:
        lines.append("  - Surveyed, and nothing was found to be unmeasured.")
    lines.append("")
    lines.append(CACHE_BREAKPOINT)
    return "\n".join(lines)


def delta(*, salient: Sequence[salience_mod.Salience] = (),
          concerns: Sequence[Mapping[str, Any]] = (),
          ledger: Optional[Mapping[str, Any]] = None,
          coverage: Optional[Mapping[str, Any]] = None,
          unscorable: int = 0,
          offline_total: int = 0,
          firings: Optional[Mapping[str, Mapping[str, Any]]] = None,
          settled: Optional[Mapping[str, Mapping[str, int]]] = None,
          label_of: Optional[Callable[[str], str]] = None) -> str:
    """The fresh half. Everything here is allowed — required — to change.

    ⚠️ `firings` AND `settled` ARE THE LOOP THIS DOCUMENT NEVER CLOSED
    (2026-09-04). Every input above them describes the villa; neither of these
    does — they describe what the SUPERVISION LAYER ITSELF has said. `firings`
    is the record's automation tally for the window (which rules fired, how
    often, how their incidents ended) and `settled` is what became of the
    concerns this tier raised (closed, dismissed, verified, per kind). Until
    now the model was handed the open concerns and nothing else about its own
    output, so it could not know that a rule had fired three times and timed
    out twice, or that the owner had dismissed the last three concerns of one
    kind. `None` prints nothing — a caller with no record is a caller with no
    record — while an EMPTY mapping prints "none", because "no automation fired
    this window" is a finding and a vanishing section is not.

    ⚠️ COVERAGE IS NOT OPTIONAL AND GOES NEAR THE TOP. "I was not listening for
    six hours of this window" changes how every line below it should be read,
    and a reader who learns it at the end has already believed the rest.

    ⚠️ `label_of` IS THE INJECTION `_label_of` HAS ALWAYS ASKED FOR, AND IT IS
    WHAT MAKES THE RANKED EXCERPT SHIPPABLE AT ALL. This document is the biggest
    unattended payload in the system and this module's own first rule is LABELS,
    NEVER ENTITY IDS — so until a caller supplies a resolver, every salient row
    would carry a raw id off the property. The caller passes `sources.labeller`,
    which is `reports.devices.label_for`, which is the ONE shared answer to
    "what do we call this device" the kiosk and the brief already agree on.
    """
    lines: List[str] = [DELTA_HEADING, ""]

    if coverage is not None:
        complete = bool(coverage.get("complete"))
        lines.append("Coverage: "
                     + ("the whole window was observed."
                        if complete else
                        "INCOMPLETE — part of this window was not observed, "
                        "so an absence of findings below is not evidence of "
                        "a quiet villa."))
        if coverage.get("at_bound"):
            # ⚠️ NEVER THE WORD "recorder" HERE, AND THAT IS NOT PEDANTRY — IT
            # SENT SOMEBODY TO THE WRONG SUBSYSTEM (TASK-039, the PH-2 gate).
            # `recorder` is Home Assistant's OWN component, with its own
            # retention and purge settings, and this sentence used it for VESTA's
            # journal ring. Asked why it could not see overnight, the agent
            # answered — correctly, from this text — "it's a retention setting on
            # the recorder … someone needs to check the recorder's retention and
            # purge settings on the Home Assistant host". That is an actionable
            # instruction to change a system that was working, and the villa's
            # own 20,000-entry ring would have gone on evicting history either
            # way. A generated document is read as fact; a borrowed noun in one
            # is a wrong diagnosis with our name on it.
            lines.append("  This add-on's own observation journal is full "
                         f"({coverage.get('bound')} entries), so it has "
                         "started dropping its oldest rows and history before "
                         "them is gone. That is VESTA's own storage limit — "
                         "NOT Home Assistant's recorder, whose retention "
                         "settings are unrelated and should not be changed on "
                         "account of this line.")
        lines.append("")

    # ⚠️ IT IS AN EXCERPT AND MUST SAY SO (TASK-039). Asked about the pool
    # pump, the agent answered "there is no pool pump circuit in what I can
    # see" — of equipment that exists, is metered, and was drawing 863.7 W at
    # the time. It had read this ranked list as an INVENTORY. Nothing here
    # claimed to be one, and nothing said it was not: this subsystem's own rule
    # is that absence must never be silent, and a heading that lists some
    # devices is silent about every device it omits.
    lines.append("Most unusual right now (a RANKED EXCERPT, never an inventory "
                 "— equipment absent from this list still exists, and must be "
                 "looked up before saying anything about whether it is here):")
    ranked = [s for s in salient if s.score]
    # ⚠️ WHAT THE MODEL WAS ACTUALLY GIVEN, recorded where the lists are still
    # lists (2026-08-30). The pass log said only `document: N chars, N lines`,
    # which proved the agent was blind once and could never say WHICH input was
    # empty — and "no salient rows", "no standing faults" and "no coverage" are
    # three different faults with three different fixes. ⚠️ `ranked`, NOT
    # `salient`: an unscored row is in the list and not in the document, and
    # counting the argument would report rows the model never saw.
    note("doc_salient", len(ranked))
    note("doc_concerns", len(list(concerns)))
    note("doc_offline", int(offline_total))
    note("doc_unscorable", int(unscorable))
    note("doc_coverage",
         "unknown" if not coverage else
         ("complete" if coverage.get("complete") else "partial"))
    if ranked:
        for item in ranked:
            lines.append(f"  {_label_of(item, label_of)} — {item.reason}")
    else:
        lines.append("  Nothing is behaving unusually for itself.")
    lines.append("")

    # ⚠️ THE SECTION THAT DID NOT EXIST, AND ITS ABSENCE WAS A BLIND SPOT RATHER
    # THAN A CHOICE (2026-08-27). Everything above is scored by `salience`,
    # which reads NUMBERS — `_numeric()` refuses `unavailable`/`unknown` by
    # design, because a previous system read unavailable as -999999 and fired
    # every low-battery alert. Correct, and it meant a device going OFFLINE had
    # no channel into this document at all: no score, no row, nothing. Measured
    # end-to-end on the reference villa — a critical entity taken offline, a
    # HEALTHY document (4,874 chars), and triage answered "nothing to escalate"
    # because it was never told. The kiosk shows it, Readiness shows it, the
    # brief's standing section shows it, and the tier that SUPERVISES could not
    # see it: two correct halves with nothing joining them, this repository's
    # most repeated defect.
    #
    # ⚠️ IT IS A STATE, NOT AN EVENT, SO IT BELONGS IN THE DELTA AND NOWHERE
    # ELSE. `profile()` says so itself — "if a future caller wants to add
    # 'devices currently unavailable' here, that belongs in the DELTA" — because
    # anything above the cache breakpoint that changes with the clock silently
    # ends prefix caching and multiplies the bill.
    #
    # ⚠️ A COUNT, DELIBERATELY WITHOUT NAMES (2026-08-27, owner's decision, and
    # it REPLACED a named list that shipped in 2.805.0 and was wrong). Naming
    # them invited this pass to act on devices the REFLEX layer owns:
    # `architecture.TGT-001` gives Tier 0 "critical unavailable" — sub-second,
    # offline, no model in the path — and the briefing's standing section
    # already reports every unavailable device to the owner. A concern raised
    # here would be a THIRD message about one fact, which is the alert fatigue
    # this whole system is built to avoid.
    #
    # ⚠️ SO IT IS CONTEXT, NOT DETECTION, AND THE SENTENCE SAYS SO. Its only job
    # is to stop the pass asserting that a silent device is healthy — the
    # failure REQ-055 describes ("'The Onsen pump is unavailable', true in
    # March, must not still be asserted in December"). Without names it cannot
    # be acted on, which is the point rather than a limitation.
    #
    # ⚠️ AND IT PRINTS WHEN EMPTY, like the excerpt above it. "Everything is
    # reporting" is a FINDING; a section that vanishes when all is well is
    # indistinguishable from one that is broken, which is the instrument shape
    # this project has been caught by five times. Both branches are one short
    # line, so the whole block costs well under 1% of the document.
    # ⚠️ EVERY WORD IS PAID FOR ON EVERY PASS, so this says the three things it
    # must and stops: how many, whose job they are (not this pass's), and that
    # nothing above describes them. An earlier draft ran to 228 characters by
    # explaining the reasoning; the reasoning belongs in this comment, which is
    # free, rather than in the prompt, which is billed ~96 times a day.
    if offline_total > 0:
        lines.append(
            f"Not reporting right now: {_plural(offline_total, 'device')} "
            f"offline or unknown — covered by the villa's own alerting, not by "
            f"this pass, and nothing above is evidence about them.")
    else:
        lines.append("Not reporting right now: none.")
    lines.append("")

    if unscorable:
        # ⚠️ A FIRST-CLASS LINE, NOT A FOOTNOTE. "I could not assess 40 of your
        # devices" is the honest half of any coverage claim, and the current
        # pipeline's inability to say it is what `covered_but_silent` existed
        # to paper over.
        # ⚠️ THE VERB AGREES WITH THE COUNT. "1 entity lack enough history" is
        # the same defect the PH-1 checkpoint found as "1 climate units" — a
        # shape no assertion sees and every reader does, in a generated document
        # whose whole authority rests on reading as though somebody wrote it.
        lines.append(f"Could not be assessed: {_plural(unscorable, 'entity', 'entities')} "
                     + ("lacks" if unscorable == 1 else "lack")
                     + " enough history to compare against.")
        lines.append("")

    lines.append("Open concerns:")
    if concerns:
        for row in concerns:
            title = str(row.get("title") or "").strip() or "(untitled)"
            age = row.get("age_days")
            state = str(row.get("state") or "").strip()
            # ⚠️ THE STATE AND THE AGE BOTH SAID "open" — a real reading found
            # "(open, open 2 days)" in the first generated document. The age
            # phrase already implies the state when the state IS open, so only
            # a state that adds something is printed.
            #
            # ⚠️ AND THE FIX FOR THAT SHIPPED WITH THE SAME DEFECT IN ITS OTHER
            # BRANCH, WHICH NOTHING COULD SEE BECAUSE NO CALLER EVER PASSED A
            # CONCERN. An `elif state: suffix.append(state)` stood here for the
            # unknown-age case and re-added the state the line above had just
            # appended — "(closed, closed)", "(dismissed, dismissed)" — while
            # a live concern of unknown age read "(open)", the very redundancy
            # the first branch exists to remove. Two independent facts, each
            # printed at most once, and neither one's presence conditional on
            # the other's.
            suffix = []
            if state and state.lower() != "open":
                suffix.append(state)
            if isinstance(age, (int, float)):
                suffix.append(f"open {_plural(int(age), 'day')}")
            lines.append(f"  {title}"
                         + (f" ({', '.join(suffix)})" if suffix else ""))
    else:
        lines.append("  None.")
    lines.append("")

    if ledger:
        lines.append("Facility record: "
                     + ", ".join(f"{k} {v}" for k, v in sorted(ledger.items())))
        lines.append("")

    if firings is not None:
        note("doc_firings", len(firings))
        lines.append("Automations that fired in this window (the villa's own "
                     "rules; a rule whose incidents end by timeout rather than "
                     "all-clear may be miscalibrated rather than the villa "
                     "abnormal):")
        if firings:
            for name, held in firings.items():
                bits = [f"{int(held.get('times') or 0)} time"
                        + ("" if int(held.get("times") or 0) == 1 else "s")]
                ended = held.get("phases") or {}
                for phase in ("cleared", "timeout"):
                    if ended.get(phase):
                        bits.append(f"{int(ended[phase])} ended by {phase}")
                lines.append(f"  {name} — {', '.join(bits)}")
        else:
            lines.append("  None.")
        lines.append("")

    if settled is not None:
        note("doc_settled", sum(sum(v.values()) for v in settled.values()))
        lines.append("What became of earlier concerns, by kind (dismissed "
                     "means a person said it did not matter — raise that kind "
                     "less readily):")
        if settled:
            for kind, counts in settled.items():
                lines.append(f"  {kind} — " + ", ".join(
                    f"{state} {n}" for state, n in sorted(counts.items())))
        else:
            lines.append("  None settled yet.")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ⚠️ `_label_of_id` WENT WITH THE NAMED LIST (2026-08-27). The offline block is
# a COUNT now, so nothing resolves a bare entity id to a label any more and a
# second naming ladder beside `_label_of` would be dead code drifting from its
# twin. Deleting it also deletes the label lookups it performed on every pass.


def _label_of(item: salience_mod.Salience,
              label_of: Optional[Callable[[str], str]] = None) -> str:
    """A readable name for a salient entity.

    ⚠️ THE ID IS THE FALLBACK, NOT THE DEFAULT — and from v2.612.0 to v2.683.0
    it was the only thing this returned, because no caller ever passed a
    non-empty `salient` list, so the rule at the top of this module was upheld
    by the document being empty rather than by this function. The
    resolver arrives from `sources.build_document`; a resolver that raises or
    answers with nothing leaves the id, because a ranked row nobody can name is
    still worth more than a row that is not there.
    """
    if callable(label_of):
        try:
            named = str(label_of(item.entity_id) or "").strip()
        except Exception:  # noqa: BLE001 - a naming failure is not a lost row
            named = ""
        if named:
            return named
    return item.entity_id


def villa_document(*, profile_text: str, delta_text: str) -> str:
    """Profile then delta, in that order, always.

    ⚠️ THIS FUNCTION EXISTS SO THE ORDER CANNOT BE GOT WRONG BY A CALLER. It
    would otherwise be two string concatenations at every call site, and the
    one that reverses them costs money silently — no error, no wrong answer,
    just a bill four times larger for identical output.
    """
    return f"{profile_text}\n\n{delta_text}"


def cache_prefix_of(document: str) -> str:
    """Everything a caller may put behind a cache breakpoint.

    Returns "" when the marker is absent, which is the safe answer: caching
    nothing costs money, caching the wrong span returns a stale villa.
    """
    marker = document.find(CACHE_BREAKPOINT)
    return "" if marker < 0 else document[:marker + len(CACHE_BREAKPOINT)]


def absent_sentences(discovered: Optional[Mapping[str, Any]]) -> List[str]:
    """discovery's own sentences for the capabilities this villa lacks.

    ⚠️ VERBATIM, AND IN A FIXED ORDER (TASK-013). These are constants in this
    add-on's source, identical on every install, so they are quoted rather than
    paraphrased — a paraphrase turns a statement somebody checked into
    generated text, and generated text about what the system cannot see is
    exactly the wrong thing to invent.

    ⚠️ SORTED BY CAPABILITY KEY, because `capabilities_missing` is built from a
    set in `discovery` and a set has no stable order. Unsorted, this block
    would reshuffle between runs and break the cached prefix — the same trap as
    `_counted`, one level up.
    """
    if not isinstance(discovered, Mapping):
        return []
    missing = discovered.get("capabilities_missing")
    meanings = discovered.get("capability_absent")
    if not isinstance(missing, (list, tuple)) or not isinstance(meanings, Mapping):
        return []
    out: List[str] = []
    for capability in sorted(str(c) for c in missing):
        sentence = meanings.get(capability)
        if isinstance(sentence, str) and sentence.strip():
            out.append(sentence.strip())
    return out
