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

from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from observe import salience as salience_mod

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
            absent_capabilities: Sequence[str] = ()) -> str:
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

    if floors or areas:
        lines.append(
            f"Layout: {_plural(len(floors), 'floor')}, "
            f"{_plural(len(areas), 'area')}.")
        if areas:
            lines.append(f"  Areas: {', '.join(sorted(areas))}.")
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
    lines.append("What this villa cannot be asked about:")
    if absent_capabilities:
        for sentence in absent_capabilities:
            text = str(sentence).strip()
            if text:
                lines.append(f"  - {text}")
    else:
        lines.append("  - Nothing known to be unmeasured.")
    lines.append("")
    lines.append(CACHE_BREAKPOINT)
    return "\n".join(lines)


def delta(*, salient: Sequence[salience_mod.Salience] = (),
          concerns: Sequence[Mapping[str, Any]] = (),
          ledger: Optional[Mapping[str, Any]] = None,
          coverage: Optional[Mapping[str, Any]] = None,
          unscorable: int = 0) -> str:
    """The fresh half. Everything here is allowed — required — to change.

    ⚠️ COVERAGE IS NOT OPTIONAL AND GOES NEAR THE TOP. "I was not listening for
    six hours of this window" changes how every line below it should be read,
    and a reader who learns it at the end has already believed the rest.
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
            lines.append("  The journal is at its size bound, so history older "
                         "than its oldest entry is unavailable — that is a "
                         "limit of the recorder, not of the villa.")
        lines.append("")

    lines.append("Most unusual right now:")
    ranked = [s for s in salient if s.score]
    if ranked:
        for item in ranked:
            lines.append(f"  {_label_of(item)} — {item.reason}")
    else:
        lines.append("  Nothing is behaving unusually for itself.")
    lines.append("")

    if unscorable:
        # ⚠️ A FIRST-CLASS LINE, NOT A FOOTNOTE. "I could not assess 40 of your
        # devices" is the honest half of any coverage claim, and the current
        # pipeline's inability to say it is what `covered_but_silent` existed
        # to paper over.
        lines.append(f"Could not be assessed: {_plural(unscorable, 'entity', 'entities')} "
                     "lack enough history to compare against.")
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
            suffix = []
            if state and state.lower() != "open":
                suffix.append(state)
            if isinstance(age, (int, float)):
                suffix.append(f"open {_plural(int(age), 'day')}")
            elif state:
                suffix.append(state)
            lines.append(f"  {title}"
                         + (f" ({', '.join(suffix)})" if suffix else ""))
    else:
        lines.append("  None.")
    lines.append("")

    if ledger:
        lines.append("Facility record: "
                     + ", ".join(f"{k} {v}" for k, v in sorted(ledger.items())))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _label_of(item: salience_mod.Salience) -> str:
    """A readable name for a salient entity.

    ⚠️ THE ID IS THE FALLBACK, NOT THE DEFAULT. A `Salience` carries only an
    entity id today, so this is where a label resolver is injected when one
    exists; until then an id is better than nothing and the caller is expected
    to map it. Stated so the shortcut is visible rather than discovered.
    """
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
