"""What the tools actually read. The wiring, in one place.

⚠️ THIS FILE EXISTS BECAUSE ITS ABSENCE SHIPPED AND THE VILLA FOUND IT. Every
tool takes its data source as a constructor argument — deliberately, so that
`tools/` reaches into nothing and stays testable with no Home Assistant — and
`build_registry()` constructed them all with NO ARGUMENTS. So `read_salient`
returned `[]` forever, `read_logs` returned zero lines forever, and the agent,
asked about a pool pump on a property journalling 17,845 entries, reported a
villa with no devices. It reasoned about that correctly; it should never have
had to.

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

from typing import (Any, Callable, Dict, List, Mapping, Optional, Sequence,
                    Set)

from agent.refs import RefTable
from agent.tools.base import BaseTool
from reports.log import swallow

#: ⚠️ THE WINDOW AND THE SAMPLE MINIMUMS BELONG TO `observe/salience.py` AND ARE
#: NOT RESTATED HERE. This module decides what to feed it, never what counts as
#: enough — a second copy of `MIN_SAMPLES` is how the two would drift.
from observe import salience as salience_mod


def _journal_rows() -> List[Dict[str, Any]]:
    try:
        from observe import journal
        rows = journal.read().get("entries")
        return [r for r in rows if isinstance(r, dict)] \
            if isinstance(rows, list) else []
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the journal", err)
        return []


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
        return {"devices_by_class": {k: len(v) for k, v in sorted(seen.items())}}

    return source


def build_tools(session: Any = None) -> List[BaseTool]:
    """Every tool, connected to this villa.

    ⚠️ ONE CONSTRUCTION SITE. `build_registry` calls this and the MCP server
    serves whatever it returns, so a tool wired here is wired for both — which
    is the whole point of ARCH-012 and the reason the unwired version was a
    single defect rather than two.
    """
    from agent.tools import ha as ha_tools
    from agent.tools import ledger as ledger_tools
    from agent.tools import logs as log_tools
    from agent.tools import playbook as playbook_tools
    from agent.tools import read as read_tools

    rows = _journal_rows()
    refs = build_refs(rows)
    made: List[BaseTool] = [
        read_tools.ReadVilla(profile_source=build_profile_source(rows)),
        read_tools.ReadSalient(scorer=build_scorer(rows)),
    ]
    # ⚠️ THE REST KEEP THEIR CURRENT SOURCES UNTIL EACH HAS ONE. A tool with no
    # source now REFUSES and says so, so an unwired member of this list is
    # loudly missing rather than quietly empty — which is what let the previous
    # gap survive. Adding a source here is the only change needed.
    for cls in read_tools.READ_TOOLS:
        if cls not in (read_tools.ReadVilla, read_tools.ReadSalient):
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
