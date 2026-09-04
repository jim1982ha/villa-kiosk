"""What the tools and the Villa Document actually read. The wiring, in one place.

⚠️ THIS FILE EXISTS BECAUSE ITS ABSENCE SHIPPED AND THE VILLA FOUND IT. Every
tool takes its data source as a constructor argument — deliberately, so that
`tools/` reaches into nothing and stays testable with no Home Assistant — and
`build_registry()` constructed them all with NO ARGUMENTS. So `read_salient`
returned `[]` forever, `read_logs` returned zero lines forever, and the agent,
asked about a pool pump on a property journalling 17,845 entries, reported a
villa with no devices. It reasoned about that correctly; it should never have
had to.

⚠️ AND THEN THE SAME DEFECT WAS FOUND ONE LEVEL UP, IN THE ONE PLACE IT COST A
WHOLE PHASE. `snapshot.profile()` and `snapshot.delta()` take every villa fact
as a keyword argument for the same good reason — and BOTH callers that build the
triage document, `scheduler._pass` and `supervisor-proxy._agent_document_text`,
called them **with no arguments at all**. The result is not an error and not an
empty string: it is a well-formed 480-character document describing a property
with no devices, no coverage, no ranking and no concerns, and the model read it
and correctly escalated `monitoring coverage`. Four rounds of the PH-3 cutover
review were spent reading an agent that had never been shown the villa, and a
verdict from any of them would have retired working automations on no evidence.
Reproduced exactly: `len(villa_document(profile(), delta())) == 480`, 15 lines,
byte-for-byte the owner's capture. `build_document` below is the other half, and
it is here rather than at either call site because two call sites gathering facts
independently is what produced two identical broken copies in the first place.

⚠️ THE INJECTION IS STILL THE RIGHT DESIGN AND IS NOT WHAT FAILED. A tool that
imported the journal directly would be untestable without one, and `tools/ha.py`
would become a second implementation of what `ha_mcp` already publishes. What
failed was that nobody wrote the other half. It is written here, once, so there
is one place to look when a tool goes quiet.

⚠️ EVERY SOURCE DEGRADES TO EMPTY AND NEVER RAISES, because a tool call is not
allowed to end a run — but "empty" is now reported by the TOOL as a refusal when
the source is absent entirely, which is the distinction the agent had to infer.
An empty result from a WIRED source means the villa really has nothing to say.
"""

from __future__ import annotations

import calendar
import re as _re
import time

from typing import (Any, Callable, Dict, List, Mapping, Optional, Sequence,
                    Set)

from vesta.supervise.agent import flagtypes as flagtypes_mod
from vesta.supervise.agent.refs import RefTable
from vesta.supervise.agent.tools.base import BaseTool
from vesta.adapters.log import note, swallow, warn

#: ⚠️ THE WINDOW AND THE SAMPLE MINIMUMS BELONG TO `observe/salience.py` AND ARE
#: NOT RESTATED HERE. This module decides what to feed it, never what counts as
#: enough — a second copy of `MIN_SAMPLES` is how the two would drift.
from vesta.supervise.observe import salience as salience_mod
from vesta.supervise.observe import snapshot as snapshot_mod


def _journal_rows() -> List[Dict[str, Any]]:
    try:
        from vesta.supervise.observe import journal
        rows = journal.read().get("entries")
        return [r for r in rows if isinstance(r, dict)] \
            if isinstance(rows, list) else []
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the journal", err)
        return []


def labeller() -> Callable[[str], str]:
    """"What do we call this device", for anything the agent puts in front of a
    person — THE shared rule, never a second one.

    ⚠️ `reports.devices.label_for` IS THAT RULE and it is already what the kiosk
    and the brief agree on, so the agent joins them rather than growing a third
    spelling of one pump's name. It reads `/data/device-config.json` — the
    owner's OWN labels, on disk, no network — and falls back to the prettified
    slug for anything unmapped, which is exactly the ladder every brief already
    prints.

    ⚠️ LIVE STATE IS DELIBERATELY NOT FETCHED HERE. `label_for`'s third source is
    `friendly_name`, which costs a `get_states` over the whole villa on every
    triage pass — ninety-six a day for a name the owner has usually already set.
    The empty mapping is passed explicitly so the omission is visible in the call
    rather than discovered in the output; wiring it is a change to this function
    alone.
    """
    try:
        from vesta.adapters import devices as devices_mod
        entity_map = devices_mod.read_config().get("entityMap") or {}
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the device labels", err)
        entity_map = {}

    def name(entity_id: str) -> str:
        try:
            from vesta.adapters import devices as devices_mod
            return devices_mod.label_for(str(entity_id), entity_map, {})
        except Exception:  # noqa: BLE001 - a name is not worth a failed pass
            return ""

    return name


def build_refs(rows: Optional[Sequence[Mapping[str, Any]]] = None) -> RefTable:
    """A ref table covering every entity the journal has seen.

    ⚠️ REFS ARE MINTED FROM WHAT WAS OBSERVED, not from the HA registry, and
    that is deliberate: a device the villa has never reported is a device no
    tool can say anything about, so handing the model a handle for it invites a
    question with no answer. The journal IS the set of things there is evidence
    about.
    """
    table = RefTable()
    for row in rows if rows is not None else _journal_rows():
        entity_id = str(row.get("id") or "")
        if entity_id:
            table.ref_for(entity_id)
    return table


def _numeric(value: Any) -> Optional[float]:
    try:
        out = float(str(value))
    except (TypeError, ValueError):
        return None
    return out if out == out and abs(out) != float("inf") else None


def build_scorer(rows: Optional[Sequence[Mapping[str, Any]]] = None, *,
                 now: Optional[float] = None
                 ) -> Callable[[], List[salience_mod.Salience]]:
    """A callable returning one `Salience` per entity the journal knows.

    ⚠️ IT SCORES EVERY ENTITY, INCLUDING THE ONES IT CANNOT SCORE. An entity
    with too little history comes back UNSCORABLE with a reason, not omitted —
    `read_salient(include_unscorable=True)` exists precisely so "I could not
    assess 40 of your devices and here is why" is sayable, and omitting them
    turns that into silence.

    ⚠️ DAILY SAMPLES, AND THE BASIS TRAVELS WITH THEM. `score_numeric` sees two
    numbers and cannot tell a daily mean from an instantaneous reading; the PH-1
    checkpoint ranked "the pumps are running" as a top finding for exactly that
    reason. `basis` is printed in the reason so a mismatch is visible.

    ⚠️ ONE ROW PER ENTITY, AND THE LENS IS CHOSEN BY PRECEDENCE (2026-09-04).
    A numeric entity is scored by `score_numeric` and nothing else — a sensor
    stuck at one value is `sensor_health`'s question, not a duration. An entity
    whose state is a WORD is offered three lenses in order: a state never seen
    before (`score_categorical`) beats a state held longer than ever before
    (`score_duration`), which beats a day with an unusual number of changes
    (`score_frequency`). The first lens with a score wins; failing that, a lens
    the duration lens's answer is the row, quiet or unscorable — never
    categorical's "one of its usual states", which is true of everything and
    says nothing. `_best` is that rule, stated once.
    """
    def scorer() -> List[salience_mod.Salience]:
        entries = list(rows) if rows is not None else _journal_rows()
        moment = time.time() if now is None else float(now)
        by_entity: Dict[str, List[Dict[str, Any]]] = {}
        for row in entries:
            entity_id = str(row.get("id") or "")
            if entity_id:
                by_entity.setdefault(entity_id, []).append(dict(row))

        out: List[salience_mod.Salience] = []
        for entity_id, history in by_entity.items():
            samples: List[Dict[str, Any]] = []
            for row in history:
                value = _numeric(row.get("s"))
                day = str(row.get("at") or "")[:10]
                if value is not None and day:
                    samples.append({"day": day, "value": value})
            latest = _numeric(history[-1].get("s"))
            try:
                if samples and latest is not None:
                    out.append(salience_mod.score_numeric(
                        samples[:-1], latest, entity_id=entity_id,
                        basis="journalled reading"))
                else:
                    seen = [r.get("s") for r in history[:-1]]
                    out.append(_best(
                        salience_mod.score_categorical(
                            seen, history[-1].get("s"), entity_id=entity_id),
                        salience_mod.score_duration(
                            history, moment, entity_id=entity_id),
                        salience_mod.score_frequency(
                            history, moment, entity_id=entity_id)))
            except Exception as err:  # noqa: BLE001 - one bad entity is not a
                swallow(f"could not score {entity_id}", err)   # failed pass
        return out

    return scorer


def _best(*candidates: salience_mod.Salience) -> salience_mod.Salience:
    """The one row an entity gets, from the lenses offered to it in order.

    The first lens with a SCORE wins, in the order offered. When none scores,
    the row is the SECOND candidate's — the duration lens — whatever it says.
    ⚠️ NOT THE CATEGORICAL LENS'S QUIET ANSWER, although it usually has one:
    "'unlocked' is one of its usual states" is true of nearly every word
    entity on every pass and tells the reader nothing, while the duration
    lens's answer in the same situation is either "within its usual range
    (longest seen 1 hour)" or "only 3 earlier holds; 7 needed" — the reader's
    next question answered, or the exact thing time will supply named. It is
    also what makes `unscorable_census` honest about locks and lights: filed
    under categorical-quiet they would never appear in it at all.
    """
    for item in candidates:
        if item.score:
            return item
    return candidates[1] if len(candidates) > 1 else candidates[0]


def build_profile_source(rows: Optional[Sequence[Mapping[str, Any]]] = None
                         ) -> Callable[[], Dict[str, Any]]:
    """The villa's structure, as `snapshot.profile` keyword arguments.

    ⚠️ IT NO LONGER DECIDES `absent_capabilities` — `build_document` supplies it
    from the cached survey (TASK-108). This function was the reason REQ-005 read
    as unmet for three phases: it omitted the argument, so every document said
    NOT SURVEYED. That was honest and it was not the requirement.
    """
    def source() -> Dict[str, Any]:
        entries = list(rows) if rows is not None else _journal_rows()
        # ⚠️ DEVICES, NOT ROWS. Counting journal rows per domain would let one
        # chatty sensor dominate the profile's description of the property —
        # "sensor: 14,000" says nothing about how many sensors there are.
        seen: Dict[str, Set[str]] = {}
        for row in entries:
            entity_id = str(row.get("id") or "")
            if "." in entity_id:
                seen.setdefault(entity_id.split(".", 1)[0], set()).add(entity_id)
        return {"devices_by_class": {_class_name(k): len(v)
                                     for k, v in sorted(seen.items())}}

    return source


def _class_name(domain: str) -> str:
    """A Home Assistant domain as a countable English plural.

    ⚠️ `_counted` EXPECTS THE PLURAL AND MAKES THE SINGULAR ITSELF, which is the
    contract this has to meet: hand it `binary_sensor` and the profile reads
    "43 binary_sensor" for a property and "1 binary_senso" for a small one, since
    `_singular` strips a trailing "r"-less "s" it never had. Underscores are
    spaced for the same reason every other name in this document is — a raw
    domain slug is an identifier, and the profile is prose.
    """
    return str(domain).replace("_", " ").strip() + "s"


#: How much of the ranking reaches the document. ⚠️ A BUDGET, NOT A JUDGEMENT —
#: the same distinction `read.DEFAULT_SALIENT_LIMIT` states, and deliberately the
#: same number. This text sits in the system prompt of ~96 calls a day, so an
#: uncapped ranking is an uncapped bill; the full list stays one `read_salient`
#: away for any tier that can call it.
DOCUMENT_SALIENT_LIMIT: int = 25

#: The window the delta's coverage claim is about. ⚠️ IT MUST BE A REAL WINDOW.
#: `journal.coverage("")` means "the whole journal" and belongs to `read_villa`;
#: the delta is about a PERIOD, and a coverage line that does not name one is the
#: sentence every other line below it is supposed to be read against.
DOCUMENT_WINDOW_HOURS: int = 24

#: How many grouped automation lines, and how many concern kinds, the delta
#: carries. ⚠️ THE SAME KIND OF BUDGET AS `DOCUMENT_SALIENT_LIMIT` AND FOR THE
#: SAME REASON: these two blocks sit below the cache breakpoint and are paid
#: on every turn of every pass, and a motion light that fired ninety times is
#: one line however many times it fired — but a villa with two hundred rules
#: is not going to have all of them in the prompt. Busiest first, then cut.
DOCUMENT_RECORD_LIMIT: int = 25


#: Where the last capability survey is kept. ⚠️ A FILE, NOT A PROCESS CACHE. The
#: triage clock and the proxy's document preview are different call paths and,
#: on a restart, different processes; a cache in memory would make the profile
#: differ between them, which is precisely the byte-instability REQ-004 forbids.
CAPABILITIES_FILE: str = "/data/vesta/capabilities.json"

#: How stale a survey may be before it is re-run. ⚠️ A DAY, AND THE UNIT IS THE
#: POINT. A villa's CAPABILITIES — does it meter per device, is a tariff
#: configured, does the recorder keep statistics — change when somebody installs
#: something, not on a cadence. Surveying per triage pass is ~96 fan-outs a day
#: across Home Assistant's registries for an answer that moves a few times a
#: year, and that cost is the whole reason this was left unwired.
CAPABILITY_MAX_AGE_H: int = 24


def absent_capability_sentences() -> Optional[List[str]]:
    """What this villa cannot be asked about, or `None` for NOT SURVEYED.

    ⚠️ `None` AND `[]` MEAN OPPOSITE THINGS AND BOTH ARE CORRECT ANSWERS.
    `None` is "nobody has catalogued this property's blind spots"; `[]` is
    "surveyed, and nothing was found unmeasured". `snapshot.profile` prints a
    different sentence for each, and collapsing them is how a villa nobody has
    examined comes to read as a villa with full coverage — the exact over-claim
    the agent caught and quoted back during PH-1.

    ⚠️ SENTENCES, NOT CAPABILITY KEYS. `snapshot.absent_sentences` already
    turned discovery's own constants into prose in a fixed sorted order; this
    stores that OUTPUT so the document's bytes do not depend on re-deriving it.
    """
    try:
        from vesta.adapters import store
        raw = store.read_json(CAPABILITIES_FILE, {})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the capability survey", err)
        return None
    if not isinstance(raw, Mapping):
        return None
    found = raw.get("sentences")
    if not isinstance(found, list):
        # ⚠️ A FILE WITH NO `sentences` KEY IS NOT AN EMPTY SURVEY. It is a
        # survey that failed to write, and reporting it as "nothing missing"
        # would be a coverage claim nobody earned.
        return None
    return [str(x) for x in found]


#: Where the villa's rooms are kept between surveys. ⚠️ BESIDE THE CAPABILITIES
#: AND FOR THE SAME REASON: a property's rooms change when somebody renames one,
#: not on a cadence, so reading the registry every triage pass is ~96 fan-outs a
#: day for an answer that moves a few times a year.
LAYOUT_FILE: str = "/data/vesta/layout.json"


def layout() -> Dict[str, Any]:
    """The villa's floors and areas, or `{}` if nobody has read them.

    ⚠️ `{}` AND A POPULATED ANSWER ARE BOTH REAL, AND `snapshot.profile` PRINTS
    A DIFFERENT SENTENCE FOR EACH. Empty is "nobody has told me the layout" and
    must never render as "this property has no rooms" — see the comment at that
    function, which was written after an agent answered "the villa has no gym
    room" about a villa with a Gym Room and a light in it.
    """
    try:
        from vesta.adapters import store
        raw = store.read_json(LAYOUT_FILE, {})
        if not isinstance(raw, Mapping):
            return {}
        return {"floors": [str(f) for f in (raw.get("floors") or [])],
                "areas": [str(a) for a in (raw.get("areas") or [])]}
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the villa's layout", err)
        return {}


async def refresh_layout(session: Any, *, now: Optional[float] = None,
                         max_age_h: Optional[int] = None) -> bool:
    """Re-read the villa's rooms if the stored answer is stale. Returns whether
    it ran.

    ⚠️ NAMES, NOT A COUNT, AND THAT IS THE OPPOSITE OF `discovery.area_count`'s
    RULE ON PURPOSE. That function returns a count and says why: area names are
    room names in somebody's home, and the reports DIAGNOSTICS payload has no
    reason to carry them. This document is the other case — the agent is asked
    "how many lights are on in the gym", and an answer needs the word "gym".
    `contracts.PAYLOAD_ALLOWED_FIELDS` already admits room and equipment names
    to a provider for exactly this reason, while entity ids stay in the villa.

    ⚠️ NEVER RAISES, AND A FAILED READ LEAVES THE OLD ANSWER IN PLACE rather
    than clearing it — the same rule as `refresh_capabilities`, and for the same
    reason: a momentarily unreachable Home Assistant must not turn a villa with
    seventeen rooms into one whose layout is unknown.
    """
    if session is None:
        return False
    stamp = time.time() if now is None else now
    hours = CAPABILITY_MAX_AGE_H if max_age_h is None else max_age_h
    try:
        from vesta.adapters import store
        raw = store.read_json(LAYOUT_FILE, {})
        at = float(raw.get("at") or 0) if isinstance(raw, Mapping) else 0.0
        if stamp - at < max(1, hours) * 3600.0:
            return False

        # ⚠️ THESE TWO LINES ARE AN INTERIM TRANSPORT AND TASK-113 REPLACES
        # THEM. `ha_mcp` serves `ha_list_floors_areas`, which is strictly better
        # than this: it reads ONE consistent registry snapshot, nests areas
        # under their floors, and separates areas with no floor from areas whose
        # floor_id points at a floor that does not exist. This reads the two
        # registries in two independent calls — the exact race that tool's own
        # documentation describes avoiding, so a registry edit between these two
        # awaits can transiently misclassify an area.
        #
        # ⚠️ WHAT IS *NOT* INTERIM IS EVERYTHING AROUND THEM. Deciding that the
        # villa document carries a room list, fetching it on a daily clock,
        # keeping the old answer when a read fails and refusing to record an
        # empty registry as an answer are VESTA's job and no upstream tool does
        # them. The duplication is the two `command()` calls, not the function.
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            areas = await hass.command("config/area_registry/list")
            floors = await hass.command("config/floor_registry/list")
        names = sorted({str(a.get("name") or "").strip()
                        for a in (areas if isinstance(areas, list) else [])
                        if isinstance(a, Mapping) and a.get("name")})
        levels = sorted({str(f.get("name") or "").strip()
                         for f in (floors if isinstance(floors, list) else [])
                         if isinstance(f, Mapping) and f.get("name")})
        if not names:
            # ⚠️ AN EMPTY REGISTRY IS NOT A SURVEY. Writing it would record
            # "this villa has no rooms" as a finding, which is the exact
            # sentence that started this.
            return False
        store.write_json(LAYOUT_FILE,
                         {"at": stamp, "areas": names, "floors": levels})
    except Exception as err:  # noqa: BLE001 - a survey is not worth a failed pass
        swallow("could not read the villa's layout", err)
        return False
    return True


async def refresh_capabilities(session: Any, *, now: Optional[float] = None,
                               max_age_h: Optional[int] = None) -> bool:
    """Re-survey if the stored answer is stale. Returns whether it ran.

    ⚠️ IT DECIDES WHETHER TO RUN, SO ITS CALLER DOES NOT HAVE TO. `scheduler._pass`
    calls this every pass and it does something once a day — putting the age
    test at the call site would put a second copy of `CAPABILITY_MAX_AGE_H`
    beside the clock, which is how the two come to disagree.

    ⚠️ NEVER RAISES, AND A FAILED SURVEY LEAVES THE OLD ANSWER IN PLACE rather
    than clearing it. A momentarily unreachable Home Assistant must not turn a
    surveyed villa into an unsurveyed one — that would swap a true statement for
    NOT SURVEYED and, worse, change the cached prefix on a whim.
    """
    if session is None:
        return False
    stamp = time.time() if now is None else now
    hours = CAPABILITY_MAX_AGE_H if max_age_h is None else max_age_h
    try:
        from vesta.adapters import store
        raw = store.read_json(CAPABILITIES_FILE, {})
        at = float(raw.get("at") or 0) if isinstance(raw, Mapping) else 0.0
        if stamp - at < max(1, hours) * 3600.0:
            return False

        from vesta.adapters import discovery as discovery_mod
        found = await discovery_mod.discover(session)
        if not isinstance(found, Mapping) or not found.get("reachable"):
            # ⚠️ AN UNREACHABLE HOME ASSISTANT IS NOT A SURVEY. Writing this
            # would record "no capabilities" as a finding about the villa.
            return False
        sentences = snapshot_mod.absent_sentences(found)
        store.write_json(CAPABILITIES_FILE,
                         {"at": stamp, "sentences": list(sentences)})
    except Exception as err:  # noqa: BLE001 - a survey is not worth a failed pass
        swallow("could not survey the villa's capabilities", err)
        return False
    return True


def build_document(rows: Optional[Sequence[Mapping[str, Any]]] = None, *,
                   now: Optional[float] = None,
                   window_hours: Optional[int] = None) -> str:
    """The Villa Document, CONNECTED TO THIS VILLA. Never raises.

    ⚠️ ONE BUILDER, BECAUSE THERE WERE TWO CALL SITES AND THEY WERE IDENTICALLY
    WRONG. See this module's header: both passed no arguments, so the model was
    handed 480 characters describing an empty property. A third call site added
    later gets the wired document by construction rather than by remembering to.

    ⚠️ EVERY SOURCE HERE IS LOCAL — the journal, the concern store, the facility
    record, the device labels and the capability survey are all files this add-on
    already owns. That is what lets a triage pass stay cheap enough to run four
    times an hour. The survey is the one that would NOT be local if it were
    taken here: `refresh_capabilities` runs it at most once a day from the
    scheduler, which has a session, and this reads only the file it left.

    ⚠️ AND IT DEGRADES SECTION BY SECTION, not as a whole. A failed concern read
    must not cost the villa its device counts — the previous behaviour, one level
    up, was that a single exception replaced the entire document with a sentence
    about itself.
    """
    entries = list(rows) if rows is not None else _journal_rows()

    try:
        facts = build_profile_source(entries)()
    except Exception as err:  # noqa: BLE001
        swallow("could not describe the villa's structure", err)
        facts = {}
    # ⚠️ REQ-005. This argument was omitted for the whole of PH-1 to PH-3, so
    # every document said NOT SURVEYED — honest, and not what the requirement
    # asks for: a model that does not know it is blind answers confidently
    # anyway. `refresh_capabilities` keeps the answer at most a day old.
    # ⚠️ THE ROOMS, WHICH THIS DOCUMENT DID NOT CARRY UNTIL NOW. `profile()` has
    # taken `floors`/`areas` since it was written and nothing ever supplied
    # them, so the whole Layout block rendered nothing and the document named no
    # room at all — the same shape as the `absent_capabilities` omission three
    # lines below, found the same way (by reading what the model was actually
    # given) and with a worse symptom: asked about a room, the agent denied the
    # room existed. `build_profile_source` cannot supply these because it reads
    # the JOURNAL, which records entity ids and no area.
    profile_text = snapshot_mod.profile(
        absent_capabilities=absent_capability_sentences(),
        **dict(layout()), **dict(facts))

    scored: List[salience_mod.Salience] = []
    try:
        scored = list(build_scorer(entries, now=now)())
    except Exception as err:  # noqa: BLE001
        swallow("could not rank the villa's novelty", err)

    # ⚠️ THE OWNER'S TAUGHT PREFERENCES, APPLIED BEFORE THE RANKING AND AFTER
    # THE SCORING (2026-08-28). This is the one seam where "raise this kind
    # less readily" can mean anything: `scored` is every entity with its own
    # novelty, and `rank` then cuts it to what fits the document a check reads.
    # Weighting after the cut would reorder a list whose contents were already
    # decided, which is a different and much weaker promise.
    #
    # ⚠️ IT RE-RANKS, IT NEVER REFUSES — see `flagtypes`' header. A demerited
    # kind sinks and may fall off the end of the document; nothing is filtered
    # for its kind alone, so an extreme reading of an unpopular kind still
    # reaches the check.
    try:
        scored = flagtypes_mod.apply_weights(
            scored, lambda s: flag_type_of(str(getattr(s, "entity_id", ""))))
    except Exception as err:  # noqa: BLE001
        swallow("could not apply the owner's flag-type weights", err)

    try:
        ranked = salience_mod.rank(scored, limit=DOCUMENT_SALIENT_LIMIT)
        unscorable = len(salience_mod.unscorable(scored))
        # ⚠️ THE TWO CENSUS LINES STEP 0 OF THE 2026-09-04 PLAN ASKED FOR, noted
        # beside the ranking they describe rather than inside `delta`, which
        # receives a count and a cut list and could not derive either. `doc_
        # kinds` says which lens the 25 rows the model saw came from — the
        # figure that proves or kills "novel states never reach the document".
        # `doc_unscorable_why` says whether the ~two thirds that cannot be
        # scored are waiting on history or on a lens that does not exist.
        note("doc_kinds", salience_mod.kind_census(ranked))
        note("doc_unscorable_why", salience_mod.unscorable_census(scored))
    except Exception as err:  # noqa: BLE001
        swallow("could not rank the villa's novelty", err)
        ranked, unscorable = [], 0

    delta_text = snapshot_mod.delta(
        salient=ranked, unscorable=unscorable,
        offline_total=_offline_count(),
        concerns=_open_concerns(), ledger=_facility_record(),
        coverage=_coverage(now=now, window_hours=window_hours),
        firings=_recent_firings(now=now, window_hours=window_hours),
        settled=_settled_outcomes(),
        label_of=labeller())
    return snapshot_mod.villa_document(profile_text=profile_text,
                                       delta_text=delta_text)


def _offline_count() -> int:
    """HOW MANY devices are not reporting right now. Never raises.

    ⚠️ A COUNT, AND THE NAMES ARE DELIBERATELY NOT RETURNED (2026-08-27,
    owner's decision — this replaced a named list that shipped in 2.805.0 and
    crossed a boundary the architecture draws on purpose). `architecture.
    TGT-001` gives Tier 0 "critical unavailable": a reflex blueprint acts on it
    in under a second, offline, with no model in the path, and the briefing's
    standing section already reports every unavailable device to the owner.
    Handing this pass the names invited a Concern — a third message about one
    fact, and a paid investigation of a device that by definition has no data
    left to read. The number alone stops the pass asserting that a silent
    device is healthy, which is all it was ever needed for.

    ⚠️ THE SHARED PREDICATE, NOT A FOURTH DEFINITION OF "A DEVICE OF THIS
    VILLA". `reports.devices.selectable_device_ids` + `filter_unavailable` are
    what the kiosk's `deviceGroups.unavailableDeviceIds` is pinned against by
    `test_consistency_parity`, and what the brief's `standing.build` already
    calls — so the agent joins that agreement rather than deciding for itself
    what counts as offline. `filter_unavailable`'s own docstring asks callers to
    do exactly this; the release that inlined those three lines instead is
    recorded there.

    ⚠️ THE STATES COME FROM THE JOURNAL, NOT FROM A `get_states` CALL, AND THAT
    IS DELIBERATE. `build_document`'s contract is that every source is LOCAL —
    it is what keeps a triage pass cheap enough to run on a clock, and it is
    also what lets the proxy's document preview render with no session at all.
    `journal.last_states()` already exists for the restart baseline and holds
    each entity's most recently observed state, so the answer is at most one
    observe cycle old (15 minutes by default). A device that dropped in the last
    few minutes is therefore absent from this list, which is the same latency
    every other line of the delta carries.

    ⚠️ `is_unavailable` READS ONLY `state`, so the journal's `id -> state` map is
    reshaped into the `{id: {"state": s}}` the shared rule expects rather than
    the rule being loosened to accept two shapes. The synthesised map is also
    what `dismissed_set` and the config-debris rule test membership against,
    which is correct: an entity the journal has never seen is one this villa has
    no evidence about, and claiming it is offline would be inventing a fact.
    """
    try:
        from vesta.supervise.observe import journal as journal_mod
        from vesta.adapters import devices as devices_mod
        from vesta.adapters import model as model_mod

        states = journal_mod.last_states()
        if not states:
            # ⚠️ AN EMPTY JOURNAL IS NOT AN EMPTY VILLA, AND THIS GUARD IS THE
            # SHARP EDGE. `is_unavailable(None)` is True by design ("absent
            # counts"), so before the first observe cycle EVERY device is
            # absent from the journal and the shared rule would conclude the
            # whole property is down — the first pass after every restart
            # opening with "412 devices offline".
            return 0
        entities = {entity_id: {"state": state}
                    for entity_id, state in states.items()}
        config = devices_mod.read_config()
        entity_map = config.get("entityMap") or {}
        device_groups = config.get("deviceGroups") or []
        dismissed = config.get("dismissedEntityIds") or []
        unavailable = devices_mod.unavailable_device_ids(
            entity_map if isinstance(entity_map, dict) else {},
            device_groups if isinstance(device_groups, list) else [],
            model_mod.mesh_entity_ids(),
            entities,
            dismissed if isinstance(dismissed, list) else [])
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not count the devices that are not reporting", err)
        return 0
    # ⚠️ A COUNT IS ORDER-INDEPENDENT, which incidentally removes the cached-
    # prefix hazard the named version had to sort around: `selectable_device_ids`
    # walks a SET, so its order is not stable between runs and an unsorted list
    # reshuffled the delta on every pass over an unchanged villa — TEST-005's
    # failure mode, silent and four times the bill.
    return len(unavailable)


def _since_iso(now: Optional[float], window_hours: Optional[int]) -> str:
    """The delta's window start, as the UTC stamp every ring compares against.

    ⚠️ ONE DERIVATION FOR EVERY READER OF THE WINDOW. `_coverage` had this
    inline; the record reader needed the same bound, and two copies of "now
    minus the window, in UTC" is how the coverage line and the automation
    tally would come to describe different periods in one document.
    """
    hours = int(window_hours or DOCUMENT_WINDOW_HOURS)
    return time.strftime(
        "%Y-%m-%dT%H:%M:%S+00:00",
        time.gmtime((now if now is not None else time.time())
                    - max(1, hours) * 3600))


def _coverage(*, now: Optional[float] = None,
              window_hours: Optional[int] = None) -> Dict[str, Any]:
    """Was the journal listening for the delta's window? Degrades to silence.

    ⚠️ RETURNING `{}` WOULD BE A LIE AND `None` IS THE HONEST ANSWER — but
    `snapshot.delta` prints no coverage line for `None`, and an ABSENT coverage
    line reads as "fine". So a failure here reports INCOMPLETE, which is what a
    journal we cannot ask about is.
    """
    from vesta.supervise.observe import journal
    try:
        return dict(journal.coverage(_since_iso(now, window_hours)))
    except Exception as err:  # noqa: BLE001
        swallow("could not establish observation coverage", err)
        return {"complete": False}


def _recent_firings(*, now: Optional[float] = None,
                    window_hours: Optional[int] = None
                    ) -> Optional[Dict[str, Dict[str, Any]]]:
    """The record's automation tally for the delta's window, busiest first.

    ⚠️ THE FIRST TIME THE MODEL IS TOLD A RULE FIRED (2026-09-04). The record
    has held every `automation_triggered` since 2026-08-30 and the delta never
    received it, so "the phase-overload rule fired three times this week and
    two of those ended by timeout" — a pure count over data on disk — was not a
    sentence the agent could form. `None` when the record cannot be read, so
    the section is absent rather than falsely empty; grouped through
    `record.tally_automations`, the same rule the brief prints by.
    """
    try:
        from vesta.adapters import record as record_mod
        rows = record_mod.since(_since_iso(now, window_hours),
                                sources=("automation",))
        tally = record_mod.tally_automations(rows)
    except Exception as err:  # noqa: BLE001
        swallow("could not read the record's automation firings", err)
        return None
    busiest = sorted(tally.items(), key=lambda kv: -int(kv[1]["times"]))
    return dict(busiest[:DOCUMENT_RECORD_LIMIT])


def _settled_outcomes() -> Optional[Dict[str, Dict[str, int]]]:
    """What became of settled concerns, counted per kind and per state.

    ⚠️ THE OTHER HALF OF THE LOOP. `_open_concerns` excludes every settled row
    by design, so the model saw what was open and never once what happened to
    anything it raised: a concern the owner dismissed three times was raised a
    fourth time with the same confidence. Keyed by `flag_type` — the kind the
    owner's thumbs already tune (`agent/flagtypes.py`) — with the title as the
    key for a concern about a topic rather than a device. Counts only; no
    bodies, no ids. Most-settled kinds first, then cut.
    """
    try:
        from vesta.supervise.agent import concerns as concerns_mod
        rows = [r for r in concerns_mod.read()
                if str(r.get("state") or "open") in concerns_mod.SETTLED]
    except Exception as err:  # noqa: BLE001
        swallow("could not read the settled concerns", err)
        return None
    out: Dict[str, Dict[str, int]] = {}
    for row in rows:
        kind = (str(row.get("flag_type") or "").strip()
                or str(row.get("title") or "").strip() or "(untitled)")
        state = str(row.get("state") or "")
        held = out.setdefault(kind, {})
        held[state] = held.get(state, 0) + 1
    busiest = sorted(out.items(), key=lambda kv: -sum(kv[1].values()))
    return dict(busiest[:DOCUMENT_RECORD_LIMIT])


def _open_concerns() -> List[Dict[str, Any]]:
    """Live concerns, oldest first, in the shape `snapshot.delta` prints.

    ⚠️ SETTLED ONES ARE EXCLUDED THROUGH `concerns.SETTLED`, never a local list
    of state names — `open_for` already keys on that tuple and a second copy here
    is how a state added to one would go on being reported as open by the other.
    """
    try:
        from vesta.supervise.agent import concerns as concerns_mod
        rows = [r for r in concerns_mod.read()
                if str(r.get("state") or "open") not in concerns_mod.SETTLED]
    except Exception as err:  # noqa: BLE001
        swallow("could not read the concern store", err)
        return []
    return [{"title": r.get("title"), "state": r.get("state"),
             "age_days": _age_days(str(r.get("opened_at") or ""))}
            for r in rows]


def _age_days(opened_at: str) -> Optional[float]:
    """⚠️ `None` MEANS "CANNOT SAY", AND `delta` PRINTS NOTHING FOR IT rather
    than "open 0 days" — which would date every concern to today the moment a
    stamp failed to parse, and read as a villa whose problems are all new."""
    try:
        opened = calendar.timegm(time.strptime(opened_at, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return None
    return max(0.0, (time.time() - opened) / 86400.0)


def _facility_record() -> Optional[Dict[str, Any]]:
    """The FM ledger's counts, or None. ⚠️ COUNTS ONLY — `ledger.summarise`'s
    own rule is that everything it returns is a number or a boolean, which is
    what makes it safe to put in an unattended payload at all."""
    try:
        from vesta.adapters import ledger as ledger_mod
        summary = ledger_mod.summarise(ledger_mod.read())
    except Exception as err:  # noqa: BLE001
        swallow("could not read the facility record", err)
        return None
    if not summary.get("present"):
        return None
    return {"open faults": summary.get("tickets_open", 0),
            "resolved": summary.get("tickets_resolved", 0)}


def concern_rows(config: Optional[Mapping[str, Any]] = None
                 ) -> Callable[[], List[Dict[str, Any]]]:
    """What is already open — FROM THE STORE THE WRITES ARE GOING TO.

    ⚠️ `read_concerns` HAD NO SOURCE AT ALL AND RETURNED `[]` FOREVER, which
    only became load-bearing the day something could write one. Its whole job is
    to stop the agent raising the same thing twice, and `concerns.raise_concern`
    REFUSES a second concern on an open subject unless it says what it
    supersedes — so an unwired reader means the model is told to check, sees
    nothing, writes, and is refused with no way to comply.

    ⚠️ ONE STORE SINCE 2026-08-28. This used to follow shadow mode into a
    separate file, because the writes went there; the owner's ruling made
    observe-mode concerns land in the live store (informational, delivered
    once), so the store the writes go to is the live one in every mode and a
    second branch here would read a file nothing writes any more.
    """
    def rows() -> List[Dict[str, Any]]:
        try:
            from vesta.supervise.agent import concerns as concerns_mod
            return list(concerns_mod.read())
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("could not read the concern store", err)
            return []

    return rows


def service_caller(session: Any) -> Optional[Callable[..., Any]]:
    """`caller(entity_id, service, params)` for `act_service`, or None.

    ⚠️ IT LIVES HERE BECAUSE THIS MODULE IS "CONNECT A TOOL TO THIS VILLA", and
    `act_service` is the one tool whose source is a WRITE. Putting it in
    `tools/act.py` would give that file a Home Assistant client, and its whole
    contract is that it decides nothing and reaches nothing — it resolves a ref,
    asks two gates, and calls what it was handed.

    ⚠️ NONE WHEN THERE IS NO SESSION, NEVER A CALLER THAT SILENTLY DOES NOTHING.
    `ActService` answers a missing caller with `no service caller is wired` — a
    fault it can say out loud — whereas a no-op closure would report every
    action as DONE and write `outcome="done"` into the audit ledger for
    something that never happened. That is the worst available failure: the
    record of what the villa did would be fiction.

    ⚠️ THE DOMAIN COMES FROM THE ENTITY WHEN THE SERVICE IS A BARE VERB, which
    is the form everything else here uses: `REVERSIBLE_SERVICES` lists
    `turn_off`, and `policy.may_act` builds its allow-list key as
    `f"{domain}.{verb}"` from the entity too. A fully-qualified `light.turn_off`
    is accepted as well, because a model that has read Home Assistant's own tool
    schemas has seen that spelling and would otherwise be refused for a reason
    it could not diagnose.
    """
    if session is None:
        return None

    async def call(entity_id: str, service: str,
                   params: Optional[Mapping[str, Any]] = None) -> None:
        from vesta.adapters.hass import HassClient
        head, _, tail = str(service).partition(".")
        domain, verb = ((head, tail) if tail
                        else (str(entity_id).split(".", 1)[0], head))
        async with HassClient(session) as hass:
            await hass.command("call_service", domain=domain, service=verb,
                               target={"entity_id": entity_id},
                               service_data=dict(params or {}))

    return call


#: What each entity MEASURES, cached on the daily clock. ⚠️ NOT IN THE JOURNAL,
#: AND DELIBERATELY SO. `journal.MATERIAL_ATTRIBUTES` is a short allow-list
#: whose own header says "every addition is volume on every write, and the
#: burden of proof is on the addition" — and the journal is rewritten 96 times a
#: day over ~1,250 entities. A device's class and unit change when somebody
#: re-configures a device, which is monthly at most, so they belong on the same
#: clock as the room list and the capability survey rather than in the ring.
MEASURES_FILE: str = "/data/vesta/measures.json"


async def refresh_measures(session: Any, *, now: Optional[float] = None,
                           max_age_h: Optional[int] = None) -> bool:
    """Re-read what each entity measures, if the stored answer is stale.

    ⚠️ TWO ATTRIBUTES AND NOTHING ELSE. `device_class` and
    `unit_of_measurement` are what `flagtypes.measurement_of` reads; storing
    the states themselves would duplicate the journal, at the size of the whole
    villa, on a file nothing bounds.

    ⚠️ NEVER RAISES, AND A FAILED READ KEEPS THE OLD ANSWER — the same rule as
    `refresh_layout` and `refresh_capabilities`, for the same reason: a
    momentarily unreachable Home Assistant must not retune an owner's
    preferences by making every kind unclassifiable for a day.
    """
    if session is None:
        return False
    stamp = time.time() if now is None else now
    hours = CAPABILITY_MAX_AGE_H if max_age_h is None else max_age_h
    try:
        from vesta.adapters import store
        raw = store.read_json(MEASURES_FILE, {})
        at = float(raw.get("at") or 0) if isinstance(raw, Mapping) else 0.0
        if stamp - at < max(1, hours) * 3600.0:
            return False
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            states = await hass.command("get_states")
        found: Dict[str, Dict[str, str]] = {}
        for row in (states if isinstance(states, list) else []):
            if not isinstance(row, Mapping):
                continue
            entity_id = str(row.get("entity_id") or "")
            attrs = row.get("attributes")
            if not entity_id or not isinstance(attrs, Mapping):
                continue
            cls = str(attrs.get("device_class") or "")
            unit = str(attrs.get("unit_of_measurement") or "")
            if cls or unit:
                found[entity_id] = {"c": cls, "u": unit}
        if not found:
            # ⚠️ AN EMPTY READ IS NOT AN ANSWER — the same sentence
            # `refresh_layout` records. Writing it would file every future
            # concern under "reading", quietly merging kinds an owner has
            # already tuned apart.
            return False
        store.write_json(MEASURES_FILE, {"at": stamp, "measures": found})
    except Exception as err:  # noqa: BLE001
        swallow("could not read what the villa's entities measure", err)
        return False
    return True


def flag_type_of(entity_id: str) -> str:
    """What KIND a concern about this device is. See `agent/flagtypes.py`.

    ⚠️ IT LIVES HERE BECAUSE THIS MODULE IS "CONNECT A RULE TO THIS VILLA".
    `flagtypes` owns the vocabulary and the arithmetic and reaches nothing;
    this is the half that reads the villa's own measurements and journal.

    ⚠️ THE DIRECTION COMES FROM THE SAME SCORER THE DOCUMENT IS RANKED BY, not
    from a second reading of the numbers. A kind whose direction disagreed with
    the sentence that flagged it would be untunable: the owner would demerit
    "above baseline" while the screen said "below".
    """
    from vesta.supervise.agent import flagtypes
    from vesta.adapters import store
    entity = str(entity_id or "")
    if not entity:
        return ""
    raw = store.read_json(MEASURES_FILE, {})
    measures = raw.get("measures") if isinstance(raw, Mapping) else {}
    row = measures.get(entity) if isinstance(measures, Mapping) else None
    row = row if isinstance(row, Mapping) else {}
    measurement = flagtypes.measurement_of(
        device_class=str(row.get("c") or ""), unit=str(row.get("u") or ""),
        domain=entity.split(".", 1)[0])

    observed = baseline = None
    offline = False
    try:
        for scored in build_scorer()():
            if str(getattr(scored, "entity_id", "")) != entity:
                continue
            observed = getattr(scored, "observed", None)
            baseline = getattr(scored, "baseline", None)
            offline = str(getattr(scored, "novel_state", "") or "").lower() in (
                "unavailable", "unknown")
            break
    except Exception as err:  # noqa: BLE001
        swallow("could not read the direction of a flagged reading", err)

    return flagtypes.key_for(measurement,
                             flagtypes.direction_of(observed, baseline,
                                                    offline=offline))


#: Where Home Assistant serves its own log. ⚠️ CORE'S ENDPOINT, NOT THE
#: SUPERVISOR'S. `/core/logs` would need `hassio_role: manager`, and config.yaml
#: records why this add-on refuses that role: it also grants starting, stopping
#: and INSTALLING add-ons. `homeassistant_api: true` already grants this one.
LOG_PATH: str = "error_log"

#: A log line's leading timestamp, e.g. `2026-08-27 20:45:03.123 WARNING ...`.
#: ⚠️ ANCHORED AT THE START, because a traceback's own frames contain dates and
#: an unanchored match would read one of those as the line's time.
_LOG_STAMP = _re.compile(r"^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})")


def log_reader(session: Any) -> Optional[Callable[..., Any]]:
    """`reader(window_hours) -> [str]` for `read_logs`, or None. TOOL-007.

    ⚠️ THE TOOL WAS BUILT BY TASK-022 AND NEVER GIVEN A SOURCE, so from the day
    it shipped it could only refuse. Since 2.744.0 that refusal has been loud in
    the add-on log and the tool withheld from the model — which was the right
    call for an owner (an investigation once told somebody on their phone that
    "log access is also down", a fault on the property that did not exist) and
    left the model with no way to read a log at all. This is the missing half.

    ⚠️ NONE WHEN THERE IS NO SESSION, never a reader that returns `[]`. Zero
    matching lines and "nobody connected me to the log" are the same answer to a
    reader and opposite facts — the sentence this module keeps paying for.
    `build_tools` withholds the tool when this returns None, so the model is
    never offered a schema that cannot answer.

    ⚠️ THE WINDOW IS APPLIED HERE, NOT IN THE TOOL. Filtering beside Home
    Assistant is free; every line that reaches the tool is a line that may reach
    the transcript, and a transcript line is re-sent on every later turn. The
    tool's own docstring is the cost argument in full.

    ⚠️ A CONTINUATION LINE INHERITS THE TIME ABOVE IT. A Python traceback is
    twenty lines with no timestamp of their own, and dropping them because they
    carry no date would hand the model an exception's first line and none of the
    stack under it — the half that says what actually failed.
    """
    if session is None:
        return None

    async def read(window_hours: int = 24) -> List[str]:
        from vesta.adapters.hass import rest_get_text
        text = await rest_get_text(session, LOG_PATH)
        cutoff = _stamp_of(time.time() - max(1, int(window_hours)) * 3600)
        kept: List[str] = []
        inside = False
        for line in text.splitlines():
            match = _LOG_STAMP.match(line)
            if match:
                # ⚠️ STRING COMPARISON, WHICH IS WHY THE CUTOFF IS FORMATTED THE
                # SAME WAY. Both sides are `YYYY-MM-DD HH:MM:SS`, where
                # lexicographic order IS chronological order — and parsing every
                # line of a two-megabyte log to compare datetimes would cost far
                # more than the filter saves.
                inside = match.group(1).replace("T", " ") >= cutoff
            if inside:
                kept.append(line)
        return kept

    return read


def _stamp_of(at: float) -> str:
    """A local-clock stamp in Home Assistant's own log format.

    ⚠️ LOCAL, NOT UTC. Home Assistant writes its log in the villa's configured
    timezone while everything else in this package speaks UTC, so this is the
    one stamp here that must not use `gmtime` — on the reference property that
    is an eight-hour error, i.e. a "last 24 hours" window either returning most
    of two days or nothing at all.
    """
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(at))


# ── the Home Assistant readers · TOOL sources, session-bound ────────────────
def ha_readers(session: Any) -> Dict[Any, Optional[Callable[..., Any]]]:
    """One reader per HA tool class, or None for each when there is no session.

    ⚠️ ONE TABLE, SO A FIFTH TOOL IS WIRED BY BEING NAMED HERE — and so that
    `build_tools` cannot construct one of them without a source again, which is
    what it did for the whole life of the first three. The mapping is by CLASS
    because the tool decides its own argument shape; the readers here promise
    only what each tool's docstring asks for.

    ⚠️ NONE WHEN THERE IS NO SESSION, never a reader that returns `[]` — the
    `log_reader` rule. The document preview and the MCP server build without
    a session and must get a withheld tool, not a lying one.
    """
    from vesta.supervise.agent.tools import ha as ha_tools
    if session is None:
        return {cls: None for cls in ha_tools.HA_TOOLS}
    return {
        ha_tools.ReadState: state_reader(session),
        ha_tools.ReadHistory: history_reader(session),
        ha_tools.ReadAutomationTrace: trace_reader(session),
        ha_tools.ReadSchedule: schedule_reader(session),
    }


def state_reader(session: Any) -> Optional[Callable[..., Any]]:
    """`read(ids) -> [state rows]` for `read_state`.

    ⚠️ ONE REST CALL PER ID, NOT `get_states` FOR THE VILLA. The tool caps a
    call at `MAX_ENTITIES`, an investigation asks for one or two, and fetching
    1,270 states to answer for two is the fan-out `refresh_measures` pays on
    purpose once a day and this must not pay per turn.
    """
    if session is None:
        return None

    async def read(ids: Sequence[str]) -> List[Dict[str, Any]]:
        from vesta.adapters.hass import rest_get
        out: List[Dict[str, Any]] = []
        for entity_id in ids:
            row = await rest_get(session, f"states/{entity_id}")
            if isinstance(row, Mapping):
                out.append(dict(row))
        return out

    return read


def history_reader(session: Any) -> Optional[Callable[..., Any]]:
    """`read(entity_id, window_hours) -> [{at, state}]` for `read_history`.

    ⚠️ `minimal_response` AND `no_attributes`, BECAUSE THE TOOL DOWNSAMPLES
    ANYWAY. A power sensor changes hundreds of times a day; the full history
    row carries an attribute map per change, and every byte fetched here is a
    byte the tool then throws away. The shape kept is what `read_history`
    promises: when, and what the state was.
    """
    if session is None:
        return None

    async def read(entity_id: str, window_hours: int) -> List[Dict[str, Any]]:
        from vesta.adapters.hass import rest_get
        start = _since_iso(None, int(window_hours))
        rows = await rest_get(
            session, f"history/period/{start}?filter_entity_id={entity_id}"
            "&minimal_response&no_attributes")
        series = rows[0] if isinstance(rows, list) and rows else []
        return [{"at": str(r.get("last_changed") or r.get("last_updated") or ""),
                 "state": r.get("state")}
                for r in (series if isinstance(series, list) else [])
                if isinstance(r, Mapping)]

    return read


def trace_reader(session: Any) -> Optional[Callable[..., Any]]:
    """`read(entity_id, limit) -> [{at, outcome, error}]` for
    `read_automation_trace`.

    ⚠️ TWO CALLS, BECAUSE A TRACE IS KEYED BY THE AUTOMATION'S CONFIG `id`, NOT
    ITS ENTITY ID. The entity's state carries that id as an attribute, so the
    reader asks for the state first and the trace list second; an automation
    with no `id` attribute (YAML-defined without one) has no traces to list,
    and the tool's own note already says what an empty list does and does not
    mean.
    """
    if session is None:
        return None

    async def read(entity_id: str, limit: int) -> List[Dict[str, Any]]:
        from vesta.adapters.hass import HassClient, rest_get
        state = await rest_get(session, f"states/{entity_id}")
        attrs = state.get("attributes") if isinstance(state, Mapping) else None
        item_id = str(attrs.get("id") or "") if isinstance(attrs, Mapping) else ""
        if not item_id:
            return []
        async with HassClient(session) as hass:
            traces = await hass.command("trace/list", domain="automation",
                                        item_id=item_id)
        out: List[Dict[str, Any]] = []
        for row in (traces if isinstance(traces, list) else []):
            if not isinstance(row, Mapping):
                continue
            stamp = row.get("timestamp")
            out.append({
                "at": str(stamp.get("start") or "")
                if isinstance(stamp, Mapping) else "",
                "outcome": str(row.get("script_execution")
                               or row.get("state") or ""),
                "error": str(row.get("error") or ""),
            })
        # Newest first, as the tool's `limit` means "the most recent N".
        out.sort(key=lambda r: r["at"], reverse=True)
        return out[:max(1, int(limit))]

    return read


def schedule_reader(session: Any) -> Optional[Callable[..., Any]]:
    """`read(entity_id) -> [{day, from, to}]` for `read_schedule`.

    ⚠️ JOINED THROUGH THE ENTITY REGISTRY'S `unique_id`, NOT THE NAME. A
    schedule helper's `schedule/list` item is keyed by its storage id and the
    entity id is a slug of whatever the helper was called when it was made;
    renaming the helper changes neither, so the registry's unique_id is the one
    join that survives a rename.
    """
    if session is None:
        return None

    async def read(entity_id: str) -> List[Dict[str, Any]]:
        from vesta.adapters.hass import HassClient
        from vesta.supervise.agent.tools import ha as ha_tools
        async with HassClient(session) as hass:
            entry = await hass.command("config/entity_registry/get",
                                       entity_id=entity_id)
            items = await hass.command("schedule/list")
        unique = str(entry.get("unique_id") or "") if isinstance(entry, Mapping) else ""
        for item in (items if isinstance(items, list) else []):
            if not isinstance(item, Mapping) or str(item.get("id") or "") != unique:
                continue
            out: List[Dict[str, Any]] = []
            for day in ha_tools.WEEKDAYS:
                for block in (item.get(day) or []):
                    if isinstance(block, Mapping):
                        out.append({"day": day, "from": str(block.get("from") or ""),
                                    "to": str(block.get("to") or "")})
            return out
        return []

    return read




#: Names already reported, so the warning is once per process rather than once
#: per run. ⚠️ A per-run warning would print the same line eight times an hour
#: and train a reader to skip it.
_UNWIRED_SEEN: set[str] = set()

#: The TOOL names withheld, as the model would have seen them. ⚠️ Separate from
#: `_UNWIRED_SEEN`, which holds CLASS names for the once-only warning: a test
#: comparing against `Registry.names` needs the published name, and deriving one
#: from the other by convention is how the two drift.
_UNWIRED_SEEN_NAMES: set[str] = set()


def _warn_unwired(name: str) -> None:
    """Say a tool exists but has no source, once."""
    if name in _UNWIRED_SEEN:
        return
    _UNWIRED_SEEN.add(name)
    warn(f"{name} has no source wired, so it is NOT published to the model — "
         f"it would refuse every call and that refusal reaches the owner")


def build_tools(session: Any = None, *,
                config: Optional[Mapping[str, Any]] = None,
                refs: Optional[RefTable] = None) -> List[BaseTool]:
    """Every tool, connected to this villa.

    ⚠️ ONE CONSTRUCTION SITE. `build_registry` calls this and the MCP server
    serves whatever it returns, so a tool wired here is wired for both — which
    is the whole point of ARCH-012 and the reason the unwired version was a
    single defect rather than two.

    ⚠️ `raise_concern` IS THE ONE TOOL NOT BUILT HERE, and `agent/tools/concern.py`
    says why at its own tail: it is bound to one RUN's evidence and policy, not
    to one villa's data, so `runtime.investigate` builds it. `refs` is accepted
    rather than built so that the per-run tool can be handed the SAME table these
    tools mint into.
    """
    from vesta.supervise.agent.tools import ha as ha_tools
    from vesta.supervise.agent.tools import ledger as ledger_tools
    from vesta.supervise.agent.tools import logs as log_tools
    from vesta.supervise.agent.tools import playbook as playbook_tools
    from vesta.supervise.agent.tools import read as read_tools

    rows = _journal_rows()
    refs = build_refs(rows) if refs is None else refs
    made: List[BaseTool] = [
        # ⚠️ THE SAME BUILDER THE SYSTEM PROMPT USES. A tool that described the
        # villa differently from the document beside it sent the model round the
        # loop looking for the version it had already been given — see
        # `ReadVilla.__init__`. The lambda re-reads the journal per call rather
        # than closing over `rows`, because a tool answering from the rows that
        # existed when the registry was BUILT is a stale answer in a run that
        # may last a minute.
        read_tools.ReadVilla(
            document_source=lambda hours=None: build_document(window_hours=hours)),
        read_tools.ReadSalient(scorer=build_scorer(rows), refs=refs),
        read_tools.ReadConcerns(store=concern_rows(config)),
    ]
    # ⚠️ THE REST KEEP THEIR CURRENT SOURCES UNTIL EACH HAS ONE. A tool with no
    # source now REFUSES and says so, so an unwired member of this list is
    # loudly missing rather than quietly empty — which is what let the previous
    # gap survive. Adding a source here is the only change needed.
    made.append(read_tools.ReadCoverage(
        absent_source=absent_capability_sentences))
    _wired = (read_tools.ReadVilla, read_tools.ReadSalient,
              read_tools.ReadConcerns, read_tools.ReadCoverage)
    for cls in read_tools.READ_TOOLS:
        if cls not in _wired:
            made.append(cls())
    # ⚠️ WIRED SINCE 2026-09-04 — THIS LINE READ `cls(refs=refs)` FOR EVERY HA
    # TOOL, WHICH IS THE DEFECT THIS MODULE'S HEADER DESCRIBES, one paragraph
    # down from the paragraph describing it. `read_state`, `read_history` and
    # `read_automation_trace` answered as DATA about an empty villa on every
    # investigating pass; the ed8d pass on 2026-09-04 shows them in the prefix.
    # Same treatment as the log tools below: a reader per tool from
    # `ha_readers`, withheld when there is no session.
    for ha_cls, reader in ha_readers(session).items():
        if reader is None:
            _warn_unwired(ha_cls.__name__)
            _UNWIRED_SEEN_NAMES.add(ha_cls.name)
            continue
        made.append(ha_cls(source=reader, refs=refs))
    # ⚠️ AN UNWIRED TOOL IS NO LONGER PUBLISHED, AND WHAT CHANGED IS THE
    # CONSEQUENCE, NOT THE CODE BEING WRONG BEFORE. The note above says a
    # source-less tool "REFUSES and says so, so an unwired member is loudly
    # missing rather than quietly empty" — true while refusals were read by
    # developers. Not any more: on 2026-08-25 an investigation called
    # `read_logs`, got "this tool is not connected to the villa's logs", and
    # told the OWNER on their phone that "log access is also down" — which
    # reads as a fault on the property and is not one. It also spends prefix
    # tokens on a schema that can never answer, in the tier where schemas are
    # already 84% of the bill.
    #
    # ⚠️ SO THE GAP IS MADE LOUD TO THE OPERATOR INSTEAD — once, in the add-on
    # log, which is where the previous design wanted it — never to a household.
    # ⚠️ AND SINCE 2026-08-28 THERE IS A SOURCE TO GIVE IT. `log_reader` returns
    # None only when this builder has no Home Assistant session — the document
    # preview and the MCP server both build tools that way — so the withholding
    # below is now about a session rather than about a half-built feature.
    # ⚠️ ITS OWN LOOP VARIABLE, NOT `cls` AGAIN. Rebinding the name from the
    # READ_TOOLS loop above gives it that loop's inferred union type, so
    # `cls(source=...)` type-checks against every read tool rather than against
    # ReadLogs — four spurious `Unexpected keyword argument` errors that say
    # nothing about this call.
    reader = log_reader(session)
    for log_cls in log_tools.LOG_TOOLS:
        tool = log_cls(source=reader, refs=refs)
        if getattr(tool, "_source", None) is None:
            _warn_unwired(log_cls.__name__)
            _UNWIRED_SEEN_NAMES.add(tool.name)
            continue
        made.append(tool)
    made.extend(cls() for cls in ledger_tools.LEDGER_TOOLS)
    # ⚠️ THE THREE STATISTICAL CHECKS (TASK-070). They read long-run statistics
    # from Home Assistant, so they take the SESSION this builder was handed —
    # and when there is none they refuse in words rather than reporting a
    # healthy villa they never looked at, which is the failure mode every other
    # tool here has already paid for once.
    from vesta.supervise.agent.tools import analysis as analysis_tools
    made.extend(analysis_tools.analysis_tools(session_source=lambda: session))
    # ⚠️ NO SOURCE ARGUMENT: its source is the filesystem the add-on ships, so
    # it is the one tool here that answers correctly on a fresh install with no
    # villa data at all. Every other member of this list is a per-property read
    # and returns nothing useful until the collector has run.
    made.extend(cls() for cls in playbook_tools.PLAYBOOK_TOOLS)
    return made
