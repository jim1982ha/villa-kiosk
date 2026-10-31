"""Devices "unavailable by design": the VESTA Kiosk's list (Advanced Settings), read by the agent (owner, 2026-10-21).

A battery device that sleeps between its reports (a Wi-Fi door contact that wakes only to send open or closed, then
goes "unavailable" minutes later) is not lost when it says "unavailable": it is asleep. Its "unavailable" is never a
fault, never a drop, never an unusual moment, and what it reads is its LAST REAL state.

⚠️ ONE LIST, ONE READING, EVERY CHECK (owner, 2026-10-21: "handle them in a consistent and centralised way"). ⚠️ THE
KIOSK'S LIST, NOT THE AGENT'S (owner, the same night: "the KIOSK will be always here and the agent might not always be
configured … a list at a unique place, and all of the consumers can see it"): 0.12.308 kept it in policy.yaml; the
Kiosk keeps it now, and hands it over in its answer to every heartbeat (agent-contract.json `unavailableByDesign`).
The agent writes what it was last told beside its knowledge pack (vesta_shared.kiosk_told) — kept while the Kiosk does
not answer — and the pack carries it from there: KnowledgePack.load reads it with the pack, so whoever has the pack has the
list. An entity listed stands for its whole physical device (KnowledgePack.is_asleep: a sensor's battery or signal
entity sleeps with it).

⚠️ TWO QUESTIONS, ONE PLACE EACH (architecture review, 2026-10-21 — each check had been taught "asleep" by hand, and
the battery checks were missed: a sleeping door sensor's battery was read as "unavailable", never as a charge):
  - what a state says of its device: KnowledgePack.standing (asleep is never offline, never "not answering");
  - what a sleeping device reads: `read_states`, the villa's states with each one asleep given its LAST REAL state —
    how the night check, its 5-minute recheck, the reports, the concierge and the alert desk read the villa;
  - what a sleeping device read over a past window: `held_window`, the same "last report holds" carried into the
    window (the alert desk's "back since", the investigation's timeline and baseline).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from . import kiosk_told
from .device_state import has_value, is_offline
from .limits import limit
from .past import History
from .timeutil import lasting

LAST_REAL_DAYS = limit("asleep.last_real_days", 7, unit="days", group="read", lo=1, hi=60,
                       says="How far back the history is read to find the last real state of a device that sleeps by "
                            "design (unavailable between its reports).",
                       reached="Older than this, it is said to have sent no report for that long.", told="person")


def listed(pack_path: str | None = None) -> frozenset[str]:
    """The entities the Kiosk lists as unavailable by design, as last told (vesta_shared.kiosk_told); none when it
    never said (no Kiosk, an older Kiosk) or the file cannot be read — then every "unavailable" counts, as before."""
    return frozenset(kiosk_told.get("unavailableByDesign", pack_path))


def _real_before(client, entity_ids, start: datetime, end: datetime) -> dict[str, dict | None]:
    """{entity_id: {"state", "last_changed"} of its last real state read in [start, end), or None when it had none}.
    ⚠️ A READ STOPPED SHORT CANNOT TELL (vesta_shared.past): what it said after the stop was never read, so the last
    real state read may not be its last; such an entity is left out."""
    got = client.history_read(entity_ids, start, end, now=end)
    out: dict[str, dict | None] = {}
    for eid in entity_ids:
        if not got.whole(eid):
            continue
        real = [(t, s) for t, s in got.changes(eid) if has_value(s)]
        out[eid] = {"state": real[-1][1], "last_changed": real[-1][0].isoformat()} if real else None
    return out


def last_real(client, entity_ids, now: datetime) -> dict[str, dict]:
    """{entity_id: its answer}: what each device unavailable by design last said.
      - {"state", "last_changed"}: its last real state within LAST_REAL_DAYS;
      - {"nothing_since": <now - LAST_REAL_DAYS>, "last_known": {"state", "last_changed"} or None}: NOTHING REAL in
        that time, said as such (`unheard`); `last_known` is the last real state read further back, within the
        history the villa keeps (a battery's last known charge), None when there is none;
    an entity whose reading stopped short is left out: what it last said cannot be told.

    ⚠️ NO REPORT FOR A WEEK WAS SILENTLY "UNAVAILABLE" (architecture review, 2026-10-22): a door contact with no real
    state within the days read was left out, read raw again: its battery line vanished from the weekly page and the
    night check judged no charge, while the Limits page promised it would be "said to have no real state recorded"."""
    ids = list(entity_ids)
    if not ids:
        return {}
    since = now - timedelta(days=LAST_REAL_DAYS)
    got = _real_before(client, ids, since, now)
    out: dict[str, dict] = {e: r for e, r in got.items() if r is not None}
    none = [e for e, r in got.items() if r is None]
    if none:
        kept = client.kept_from(now)
        older = _real_before(client, none, kept, since) if kept is not None and kept < since else {}
        out.update({e: {"nothing_since": since.isoformat(), "last_known": older.get(e)} for e in none})
    return out


def awake_states(client, pack, states: dict, now: datetime) -> dict:
    """`states` ({entity_id: state record}) with every device unavailable by design that reads "unavailable" now given
    what it last said (`last_real`), marked `"asleep": True`: its last real state (its time: when it last reported
    it), or "unavailable" with `nothing_since` / `last_known` when it said nothing real in LAST_REAL_DAYS (`unheard`
    words it). Asleep either way: never counted offline."""
    sleeping = [e for e, st in states.items() if pack is not None and pack.is_asleep(e)
                and is_offline((st or {}).get("state"))]
    if not sleeping:
        return states
    out = dict(states)
    for eid, real in last_real(client, sleeping, now).items():
        out[eid] = {**(states.get(eid) or {}), **real, "asleep": True}
    return out


def unheard(row: dict, now: datetime) -> str | None:
    """THE words for a device asleep that said nothing real in LAST_REAL_DAYS (an `awake_states` row with
    `nothing_since`): "no report for 8 d 2 h (it sleeps between its reports)", from its last known report when one was
    read, else "for more than 7 d"; None for any other row."""
    if not (row or {}).get("nothing_since"):
        return None
    known = row.get("last_known") or {}
    if known.get("last_changed"):
        gone = lasting((now - datetime.fromisoformat(known["last_changed"])).total_seconds())
    else:
        gone = "more than " + lasting(LAST_REAL_DAYS * 86400)
    return f"no report for {gone} (it sleeps between its reports)"


def last_value(row: dict):
    """The value a check judges a battery on: the row's state when it is a real value, else the last known one of a
    device asleep with no report in LAST_REAL_DAYS (`last_known`); None when there is none."""
    row = row or {}
    if has_value(row.get("state")):
        return row.get("state")
    return (row.get("last_known") or {}).get("state")


def held_window(client, pack, entity_ids, start: datetime, end: datetime, now: datetime | None = None) -> History:
    """The history of `entity_ids` over [start, end) (client.history_read, brought back to `now`) as every reader of a
    past window reads a device unavailable by design: its "unavailable" rows are sleep, never a period, and dropped;
    the state carried over into the window, when it is "unavailable", is the last real state before `start` (read back
    LAST_REAL_DAYS, as `last_real` reads now), stamped at `start`. One with none in that time has no state at `start`:
    what it was then is not known. Any other device: its history as read.

    ⚠️ "LAST REPORT HOLDS" WAS APPLIED TO NOW ONLY (architecture review, 2026-10-22): a door asleep before a window
    opened it with "unavailable"; the alert desk dropped that row and counted the door closed since the window's start
    (its fault closed minutes early), and an investigation of a quiet hour said "nothing recorded in this period"."""
    ids = list(entity_ids)
    got = client.history_read(ids, start, end, now=now)
    sleeping = [e for e in ids if pack is not None and pack.is_asleep(e)]
    if not sleeping:
        return got
    rows = dict(got.rows)
    opened = {}
    for eid in sleeping:
        changes = got.changes(eid)
        lead = changes[0] if changes and changes[0][0] <= start + timedelta(seconds=1) else None
        opened[eid] = lead is None or is_offline(lead[1])
        rows[eid] = [{"state": s, "last_changed": t.isoformat()} for t, s in changes if not is_offline(s)]
    held = _real_before(client, [e for e in sleeping if opened[e]], start - timedelta(days=LAST_REAL_DAYS), start)
    for eid, real in held.items():
        if real is not None:
            rows[eid] = [{"state": real["state"], "last_changed": start.isoformat()}] + rows[eid]
    return History(rows, got.start, got.end, got.cut, got.kept_from)


def read_states(client, pack, now: datetime, entity_ids=None) -> dict:
    """The villa's states (`entity_ids`: those; None: every one) as every check reads them: each device unavailable by
    design that says "unavailable" now given its last real state instead (`awake_states`)."""
    states = client.states(entity_ids) if entity_ids is not None else client.states()
    return awake_states(client, pack, states, now)
