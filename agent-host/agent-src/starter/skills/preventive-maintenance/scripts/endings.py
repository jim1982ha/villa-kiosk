"""How an open fault of this check ends: ONE table, asked by the 5-minute recheck (recheck.py) and by the 02:00 night
check (nightly.py) before either says "no longer sees it".

  ending(fault, reading)  → None (still there, or nothing explains why it is gone) | Ended(name, note, handed)
  endings(faults, reading) → {fault id: Ended} for those that ended
  read(client, faults, …)  → the reading: what the villa's system says now of their devices, and what follows them

`note` is the sentence the Cockpit's fault and its Telegram message say; `handed`: another problem follows it now (an
alert, the device's missing fault, the battery's other step) — closed, never counted cleared.

⚠️ ONE ANSWER, WHICHEVER CHECK SEES IT FIRST (architecture review round 13, card 2, 2026-11-01): each check kept its own
list of the ways a fault ends, and the night's list ended with a catch-all. A deleted device (14 Oct), then a hidden one
(19 Oct) and a device still off (21 Oct) read "Cleared: the nightly check no longer sees it" when the night saw them
first, and their own sentence when the recheck did; each fix went into one check only. The night now asks this table
for every fault it no longer finds, the recheck for every fault it reads; "no longer sees it" (cleared_note) is left
for what no ending explains.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from typing import Callable, NamedTuple

from vesta_shared import automation_words as AW  # an automation named by its own name
from vesta_shared.device_state import ANSWERS, ASLEEP_NOW, NO_VALUE_NOW, OFFLINE, out_of, out_for, reading  # "is it back"
from vesta_shared import restart  # the settle time: a value-less state younger than it is still loading
from vesta_shared.offline import device_answers  # a device that answers is not offline
from vesta_shared.timeutil import clock
import rules as R  # every rule described once (rules.RULES)

OFFLINE_RULE = "PM-UNAVAILABLE"
#: The rules whose reading leaves out a device asleep between its reports (nightly.silent_findings,
#: reconnect_findings): a fault of theirs about a device listed asleep since ends saying so. A battery is read on its
#: last real charge (vesta_shared.asleep), so its fault is not one of them.
ASLEEP_SKIPPED = R.WHOLE_DEVICE_RULES
#: The rules whose reading needs the device answering (silent: "although it is online"): a fault of theirs whose device
#: went offline since is followed by its offline fault, never cleared.
NEEDS_ANSWER = R.NEEDS_ANSWER

# the sentences, each written once (the Cockpit's fault and the Telegram message read them as they are)
GONE_NOTE = "Closed: this device no longer exists in the villa's system."
HIDDEN_NOTE = "Closed: this device is hidden in the villa's system, and hidden devices are not watched."
ANSWERS_NOTE = "Closed: the device answers; only some of its sensors are waiting for their next report."
ASLEEP_NOTE = ("Closed: this device sleeps between its reports "
               "(VESTA Kiosk › Advanced Settings › Asleep between reports).")
BACK_ONLINE_NOTE = "Cleared: back online."
#: A missing fault's own end: its device answers again (nightly.missing_findings' `back`, read by both checks).
BACK_NOTE = "Cleared: back in the villa's system."
#: What a fault closed because a check no longer sees its problem says, when no ending explains it — the night's and the
#: 5-minute recheck's, one wording (owner, 2026-10-19: "refresh the open ones"): {check} is "nightly check", or "check
#: at 12:05" for the recheck (cleared_note).
CLEARED = "Cleared: the {check} no longer sees it."
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")     # only a real entity id can be "not found"


def cleared_note(at: datetime | None = None, zone: str | None = None) -> str:
    """CLEARED for the night (`at` None), or for the recheck at `at`, its villa time said ("… the check at 12:05 …")."""
    return CLEARED.format(check="nightly check" if at is None else f"check at {clock(at, zone or 'UTC', days=False)}")


def entities_of(f: dict) -> list[str]:
    """The devices a fault is about: its detail's `entities`, else its own — for a hidden-device fault, the hidden
    devices its automation names (its own entity is the automation: rules.hidden_in_rule_rules). The ONE answer, the
    night's and the recheck's (architecture review 22, card 7: three copies, and the automation's fault ended "this
    device no longer exists" when the automation was deleted)."""
    d = json.loads(f.get("detail") or "{}")
    if f.get("rule_id") == R.HIDDEN_IN_RULE:
        return list(d.get("hidden") or [])
    return d.get("entities") or [f["entity_id"]]


def offline_hands(open_rows) -> dict[tuple[str, str], str]:
    """The open faults of a rule that needs its device answering (NEEDS_ANSWER) whose device has an open offline fault
    now, each (rule, entity) → "Followed by: <the offline fault's words>". ⚠️ OFF IS NOT FIXED (architecture review 22,
    card 3): a sensor silent for 2 days that went offline closed "Cleared: the check at 11:05 no longer sees it", and
    came back 10 minutes later as a new offline fault."""
    rows = [dict(o) for o in open_rows or ()]
    off = [(set(entities_of(o)), o.get("summary") or "") for o in rows if o["rule_id"] == OFFLINE_RULE]
    out = {}
    for o in rows:
        if o["rule_id"] not in NEEDS_ANSWER:
            continue
        said = next((summary for es, summary in off if es & set(entities_of(o))), None)
        if said:
            out[(o["rule_id"], o["entity_id"])] = f"Followed by: {said}"
    return out


class Reading(NamedTuple):
    """What is read now for the faults asked about. `client`: the villa's system (None: nothing was read, as the
    recheck's reading of a rule other than the offline one — its devices were read by back_online the same tick);
    `states` of their entities and those the villa's system answers "not found" for (`gone`); `pack`; `now`; `minutes`
    (back_online_minutes: how long a device must be back). What follows a fault now, each (rule, entity) → its note:
    `missing` (nightly.missing_hands), `alerts` (nightly.handed_to_alerts), `battery` (vesta_shared.battery.judge),
    `offline` (offline_hands)."""
    client: object | None
    states: dict
    gone: set
    pack: object | None
    now: datetime | None
    minutes: float | None
    missing: dict
    alerts: dict
    battery: dict
    offline: dict


def _read_ids(f: dict) -> list[str]:
    """What is read for fault `f`: its devices, and the automation a hidden-device fault is about (it may be gone)."""
    return entities_of(f) + ([f["entity_id"]] if f.get("rule_id") == R.HIDDEN_IN_RULE else [])


def read(client, faults, *, pack=None, now: datetime | None = None, minutes: float | None = None,
         missing: dict | None = None, alerts: dict | None = None, battery: dict | None = None,
         offline: dict | None = None) -> Reading:
    """The reading for `faults`: their entities' states and which of them the villa's system no longer has, read once.
    ⚠️ NOT READ IS NOT GONE: only Home Assistant's own "not found" makes a device gone; a read that fails reads nothing
    (named on stderr), and no ending that needs it holds."""
    ids = sorted({e for f in faults for e in _read_ids(f) if ENTITY_ID.match(str(e))})
    states, gone = {}, set()
    if client is not None and ids:
        try:
            states = client.states(ids) or {}
            # only what has no state is asked about: "not found" is Home Assistant's answer, a missing row is not
            gone = set(client.not_found([e for e in ids if e not in states])) if len(states) < len(ids) else set()
        except Exception as e:  # noqa: BLE001 — nothing read: nothing ends by a reading, the next check reads again
            print(f"preventive-maintenance: the devices of {len(faults)} fault(s) could not be read "
                  f"({type(e).__name__})", file=sys.stderr)
            states, gone = {}, set()
    return Reading(client, states, gone, pack, now, minutes, dict(missing or {}), dict(alerts or {}), dict(battery or {}),
                   dict(offline or {}))


class Ending(NamedTuple):
    """One way an open fault ends: `about` (its rule → whether this ending can end it), `holds` (fault, its entities,
    the reading → whether it ended so), `note` (the same → its sentence), `handed` (another problem follows it)."""
    name: str
    about: Callable[[str], bool]
    holds: Callable
    note: Callable
    handed: bool = False


class Ended(NamedTuple):
    name: str
    note: str
    handed: bool


def _key(f: dict) -> tuple[str, str]:
    return f["rule_id"], f["entity_id"]


def _offline(rule: str) -> bool:
    return rule == OFFLINE_RULE


def _device(rule: str) -> bool:
    """A fault about a device VESTA watches: every rule's but the missing one's (it ends by its own reading: back,
    BACK_NOTE, or a Done) and the hidden-device one's (about an automation naming devices no check watches)."""
    return rule not in (R.MISSING, R.HIDDEN_IN_RULE)


def _asleep_skipped(rule: str) -> bool:
    return rule in ASLEEP_SKIPPED


def _needs_answer(rule: str) -> bool:
    return rule in NEEDS_ANSWER


def _in_rule(rule: str) -> bool:
    return rule == R.HIDDEN_IN_RULE


def _rule_gone(f: dict) -> str:
    """A hidden-device fault's automation (or script) deleted: its sentence, the automation named by its own name."""
    d = json.loads(f.get("detail") or "{}")
    return f"Closed: the {AW.words(d.get('name'), f['entity_id'], d.get('kind'))} no longer exists in the villa's system."


def answers(pack, entity_id: str, row: dict | None, now: datetime | None) -> bool:
    """Does `entity_id` answer now (`row`: its state row read now, None when the villa's system has none), by the
    knowledge pack's test (KnowledgePack.standing)? A value, or asleep between its reports by design: yes. No value
    ("unknown"): only once that has held the settle time after a restart (vesta_shared.restart.minutes) — a device still
    loading answers with no value first. Offline, or no state: no. The ONE test the night check opens a hidden-device
    fault by (nightly.hidden_in_rule_findings: a device that does not answer) and this table closes it by.

    ⚠️ OPENED BY ONE TEST, CLOSED BY ANOTHER (architecture review, 2026-11-13): the hidden-device fault opened on
    pack.standing and closed on "read and not offline", so a device answering "unknown" while its integration loaded
    was "back online"."""
    if not row:
        return False
    st = row.get("state")
    standing = pack.standing(entity_id, st) if pack is not None else reading(st)
    if standing in (ANSWERS, ASLEEP_NOW):
        return True
    return standing == NO_VALUE_NOW and now is not None and out_of(row, OFFLINE, now, restart.minutes(),
                                                                    unknown_tells=True)


def _all_answer(es, r) -> bool:
    """Every one of `es` answers now (answers): a hidden device that answers is no fault (rules.hidden_in_rule_rules)."""
    return r.client is not None and bool(es) and all(answers(r.pack, e, r.states.get(e), r.now) for e in es)


def _any(rule: str) -> bool:
    return True


#: EVERY WAY A FAULT ENDS, in the order it is asked (architecture review N card 2, 2026-10-27, for the offline fault;
#: round 13 card 2, 2026-11-01, for both checks). ⚠️ BY HOW THE DEVICE STANDS, NOT BY RULE (architecture review 22,
#: card 3): hidden, asleep and gone were asked for the offline fault alone, so a battery of a device hidden since read
#: "Next check: within 5min" all day and closed "Cleared: the nightly check no longer sees it" at 02:00.
ENDS = (
    # a hidden-device fault (its devices: entities_of): its automation deleted, or every device it names answers again
    Ending("rule_gone", _in_rule, lambda f, es, r: f["entity_id"] in r.gone, lambda f, es, r: _rule_gone(f)),
    Ending("answers_again", _in_rule, lambda f, es, r: _all_answer(es, r), lambda f, es, r: BACK_ONLINE_NOTE),
    # ⚠️ A DEVICE GONE IS MISSING, NOT OVER (owner, 2026-10-31): an entrance lock its hub stopped sharing closed its
    # faults "this device no longer exists" and nothing more was said. A fault about a device VESTA watched follows its
    # missing fault; only one about something no longer watched (an automation deleted, a device a person said was
    # removed on purpose) closes as gone.
    Ending("missing", _device, lambda f, es, r: _key(f) in r.missing, lambda f, es, r: r.missing[_key(f)],
           handed=True),
    # ⚠️ A DEVICE DELETED FROM THE VILLA'S SYSTEM (owner, 2026-10-14): its fault closed "Cleared: the nightly check no
    # longer sees it", as if it had come back — every entity answered "not found" (its own 404, never a failed read)
    Ending("gone", _device, lambda f, es, r: bool(es) and all(e in r.gone for e in es), lambda f, es, r: GONE_NOTE),
    # ⚠️ HIDDEN SINCE IT WAS FOUND (architecture review, 2026-10-21): the night check no longer saw it and closed it as
    # "Cleared" — said of a device still off
    Ending("hidden", _device, lambda f, es, r: r.pack is not None and bool(es)
           and not any(r.pack.is_watched(e) for e in es), lambda f, es, r: HIDDEN_NOTE),
    # listed as unavailable by design since it was found (vesta_shared.asleep): never a fault
    Ending("asleep", _asleep_skipped, lambda f, es, r: r.pack is not None and bool(es) and all(r.pack.is_asleep(e) for e in es),
           lambda f, es, r: ASLEEP_NOTE),
    Ending("back", _offline, lambda f, es, r: r.client is not None and r.minutes is not None and bool(r.states)
           and out_for(r.client, [e for e in es if e not in r.gone], r.states, OFFLINE, r.now, r.minutes,
                       unknown_tells=True),
           lambda f, es, r: BACK_ONLINE_NOTE),
    # ⚠️ ITS DEVICE ANSWERS (villa, 2026-10-25): a camera's event sensors read "unavailable" until its next event while
    # its stream and Wi-Fi report; opened under the older reading, it closes, saying why
    Ending("answers", _offline, lambda f, es, r: r.pack is not None and r.client is not None and bool(es)
           and device_answers(r.pack, es, r.client.states), lambda f, es, r: ANSWERS_NOTE),
    # still off, and the villa's own alert follows it now: one problem, the alert's (nightly.handed_to_alerts)
    Ending("alert", _offline, lambda f, es, r: _key(f) in r.alerts, lambda f, es, r: r.alerts[_key(f)], handed=True),
    # its device went offline since, and its offline fault follows it now (offline_hands)
    Ending("offline", _needs_answer, lambda f, es, r: _key(f) in r.offline, lambda f, es, r: r.offline[_key(f)],
           handed=True),
    # ⚠️ A BATTERY THAT MOVED A STEP (architecture review, 2026-10-22): "within the week" → "replace now", or back, is
    # handed to its new fault, never cleared (vesta_shared.battery.judge)
    Ending("battery", _any, lambda f, es, r: _key(f) in r.battery, lambda f, es, r: r.battery[_key(f)], handed=True),
)


def ending(f: dict, r: Reading) -> Ended | None:
    """How open fault `f` ended by reading `r`: the first of ENDS about its rule that holds, None when none does."""
    es = entities_of(f)
    for x in ENDS:
        if x.about(f["rule_id"]) and x.holds(f, es, r):
            return Ended(x.name, x.note(f, es, r), x.handed)
    return None


def endings(faults, r: Reading) -> dict[int, Ended]:
    """{fault id: how it ended} for each of `faults` an ending explains."""
    return {int(f["id"]): e for f in faults if (e := ending(f, r)) is not None}
