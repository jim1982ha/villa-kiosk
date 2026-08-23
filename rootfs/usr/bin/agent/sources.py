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
import time

from typing import (Any, Callable, Dict, List, Mapping, Optional, Sequence,
                    Set)

from agent.refs import RefTable
from agent.tools.base import BaseTool
from reports.log import swallow

#: ⚠️ THE WINDOW AND THE SAMPLE MINIMUMS BELONG TO `observe/salience.py` AND ARE
#: NOT RESTATED HERE. This module decides what to feed it, never what counts as
#: enough — a second copy of `MIN_SAMPLES` is how the two would drift.
from observe import salience as salience_mod
from observe import snapshot as snapshot_mod


def _journal_rows() -> List[Dict[str, Any]]:
    try:
        from observe import journal
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
        from reports import devices as devices_mod
        entity_map = devices_mod.read_config().get("entityMap") or {}
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the device labels", err)
        entity_map = {}

    def name(entity_id: str) -> str:
        try:
            from reports import devices as devices_mod
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


def build_scorer(rows: Optional[Sequence[Mapping[str, Any]]] = None
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
    """
    def scorer() -> List[salience_mod.Salience]:
        entries = list(rows) if rows is not None else _journal_rows()
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
                    out.append(salience_mod.score_categorical(
                        seen, history[-1].get("s"), entity_id=entity_id))
            except Exception as err:  # noqa: BLE001 - one bad entity is not a
                swallow(f"could not score {entity_id}", err)   # failed pass
        return out

    return scorer


def build_profile_source(rows: Optional[Sequence[Mapping[str, Any]]] = None
                         ) -> Callable[[], Dict[str, Any]]:
    """The villa's structure, as `snapshot.profile` keyword arguments.

    ⚠️ `absent_capabilities` IS LEFT UNSET, WHICH NOW MEANS "NOT SURVEYED"
    RATHER THAN "NOTHING MISSING". Discovery has not been wired into this path
    yet, and the profile says so out loud instead of printing a coverage claim
    nobody earned — the over-claim the agent caught and quoted back.
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


def build_document(rows: Optional[Sequence[Mapping[str, Any]]] = None, *,
                   now: Optional[float] = None,
                   window_hours: Optional[int] = None) -> str:
    """The Villa Document, CONNECTED TO THIS VILLA. Never raises.

    ⚠️ ONE BUILDER, BECAUSE THERE WERE TWO CALL SITES AND THEY WERE IDENTICALLY
    WRONG. See this module's header: both passed no arguments, so the model was
    handed 480 characters describing an empty property. A third call site added
    later gets the wired document by construction rather than by remembering to.

    ⚠️ EVERY SOURCE HERE IS LOCAL — the journal, the concern store, the facility
    record and the device labels are all files this add-on already owns. That is
    what lets a triage pass stay cheap enough to run four times an hour, and it
    is why `absent_capabilities` is still unset: discovery is a fan-out of Home
    Assistant calls, and the profile says NOT SURVEYED out loud rather than
    printing a coverage claim nobody earned.

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
    profile_text = snapshot_mod.profile(**dict(facts))

    scored: List[salience_mod.Salience] = []
    try:
        scored = list(build_scorer(entries)())
    except Exception as err:  # noqa: BLE001
        swallow("could not rank the villa's novelty", err)

    try:
        ranked = salience_mod.rank(scored, limit=DOCUMENT_SALIENT_LIMIT)
        unscorable = len(salience_mod.unscorable(scored))
    except Exception as err:  # noqa: BLE001
        swallow("could not rank the villa's novelty", err)
        ranked, unscorable = [], 0

    delta_text = snapshot_mod.delta(
        salient=ranked, unscorable=unscorable,
        concerns=_open_concerns(), ledger=_facility_record(),
        coverage=_coverage(now=now, window_hours=window_hours),
        label_of=labeller())
    return snapshot_mod.villa_document(profile_text=profile_text,
                                       delta_text=delta_text)


def _coverage(*, now: Optional[float] = None,
              window_hours: Optional[int] = None) -> Dict[str, Any]:
    """Was the journal listening for the delta's window? Degrades to silence.

    ⚠️ RETURNING `{}` WOULD BE A LIE AND `None` IS THE HONEST ANSWER — but
    `snapshot.delta` prints no coverage line for `None`, and an ABSENT coverage
    line reads as "fine". So a failure here reports INCOMPLETE, which is what a
    journal we cannot ask about is.
    """
    from observe import journal
    try:
        hours = int(window_hours or DOCUMENT_WINDOW_HOURS)
        since_iso = time.strftime(
            "%Y-%m-%dT%H:%M:%S+00:00",
            time.gmtime((now if now is not None else time.time())
                        - max(1, hours) * 3600))
        return dict(journal.coverage(since_iso))
    except Exception as err:  # noqa: BLE001
        swallow("could not establish observation coverage", err)
        return {"complete": False}


def _open_concerns() -> List[Dict[str, Any]]:
    """Live concerns, oldest first, in the shape `snapshot.delta` prints.

    ⚠️ SETTLED ONES ARE EXCLUDED THROUGH `concerns.SETTLED`, never a local list
    of state names — `open_for` already keys on that tuple and a second copy here
    is how a state added to one would go on being reported as open by the other.
    """
    try:
        from agent import concerns as concerns_mod
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
        from reports import ledger as ledger_mod
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

    ⚠️ IT FOLLOWS SHADOW MODE, because the writes do. Reading the live store
    during a shadow period would show the model an empty villa while its own
    concerns piled up next door, and it would supersede nothing and be refused
    on every repeat.
    """
    def rows() -> List[Dict[str, Any]]:
        try:
            from agent import shadow as shadow_mod
            if shadow_mod.suppressed(config):
                return list(shadow_mod.recorded())
            from agent import concerns as concerns_mod
            return list(concerns_mod.read())
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("could not read the concern store", err)
            return []

    return rows


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
    from agent.tools import ha as ha_tools
    from agent.tools import ledger as ledger_tools
    from agent.tools import logs as log_tools
    from agent.tools import playbook as playbook_tools
    from agent.tools import read as read_tools

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
    _wired = (read_tools.ReadVilla, read_tools.ReadSalient,
              read_tools.ReadConcerns)
    for cls in read_tools.READ_TOOLS:
        if cls not in _wired:
            made.append(cls())
    made.extend(cls(refs=refs) for cls in ha_tools.HA_TOOLS)
    made.extend(cls(refs=refs) for cls in log_tools.LOG_TOOLS)
    made.extend(cls() for cls in ledger_tools.LEDGER_TOOLS)
    # ⚠️ NO SOURCE ARGUMENT: its source is the filesystem the add-on ships, so
    # it is the one tool here that answers correctly on a fresh install with no
    # villa data at all. Every other member of this list is a per-property read
    # and returns nothing useful until the collector has run.
    made.extend(cls() for cls in playbook_tools.PLAYBOOK_TOOLS)
    return made
