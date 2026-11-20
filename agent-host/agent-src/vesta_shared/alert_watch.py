"""An alert's standing — ONE owner of "is this the same problem as before": which incident an event of an alert belongs
to (`standing`: open, accepted while it lasts, back within its watch, closed before its late all-clear, or new), and
every note its life writes — its open run's clearing (clear_since, silent_told), THE close and the watch that follows
(how a close carries or drops it, until when it lasts, whether an alert now reopens a closed one, whether its watch is
over), its "Not a problem" while it lasts, the read-again after a person's close, and THE reopening that ends a run's
notes. The desk dispatches on the verdict and keeps every word.

⚠️ FIVE LOOKUPS, ONE ANSWER (architecture review, 2026-11-20): the desk found an event's incident five ways, each its own
scan — by Home Assistant's run (with and without a late window, its moments parsed naive), open by key, back by a scan
of every incident, accepted by its key's latest — and three reopenings each listed the notes a run ends with (the
Cockpit's kept a stale "clear since"). Here once: the desk and the Cockpit never name a note this module writes.

⚠️ ONE WATCH, NOT FIVE READINGS OF TWO SETTINGS (architecture review, 2026-10-26: "a closed alert says 'it did not come
back' when it did"): the alert desk said "Watch 4h" from reopen_hours, reopened an alert from reopen_hours, carried
max(clear_minutes, reopen_hours) for the Cockpit's "VESTA confirms by", kept the "(watch)" title a hard-coded day past
it, and four closes each wrote it or not. The villa-silent alert closed "back online" kept the watch every open alert
carried, although a new outage opens a NEW number: 40 minutes later #2 opened, and 4 hours after its close #1 said
"Closed on …: it did not come back within 4h." Here: the desk carries its two settings (terms) once, every close goes
through `close` — who closed it, whether it can come back — and every reader (the desk's words and reopening, the
Cockpit's confirmsBy, the "(watch)" title, the watch's last word) asks the length that close wrote.

The words stay the desk's (words.yaml); nothing here holds a setting: the terms are the desk's, the late days a limit.
Every moment compared here is read aware (timeutil.moment): the villa writes some in UTC, some in its zone.
⚠️ FORMATS OUTLIVE THEIR WRITER: every note keeps the name and shape the releases before this one wrote.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .limits import limit
from .store import Notes, Store, alerted_states, notes_of
from .timeutil import moment

#: The read-again a person's close waits for (the desk's quiet_after_done): who closed it and how, as it says it
CHECK = "check_quiet"
#: An open run's clearing, the desk's working notes between ticks: since when what it claims reads over (a claim is a
#: verdict, not a state with its time), and that its device not answering was said once
CLEAR_SINCE, SILENT_TOLD = "clear_since", "silent_told"
#: Home Assistant no longer watches it (its rule gave up, or a read-again found it still there): the desk does
ABANDONED = "abandoned"
#: What a run's end takes with it, whichever way it reopens (came back, still there, reopened in the Cockpit).
#: ⚠️ A RUN'S "CLEAR SINCE" ENDS WITH IT (villa's #54, 2026-10-18): main power back at 11:30:15 was closed at 11:30:17 —
#: the "back to normal since 10:40" of the run closed at 10:50 was still on the incident
RUN_NOTES = (CLEAR_SINCE, SILENT_TOLD, Notes.LASTING, CHECK)
#: What an alert back brings to its new run: Home Assistant's latest words, states and run
BACK_FIELDS = ("mode", "bad_states", "state", "ha_incident", "message", "summary", "entities")

def late_close_days() -> float:
    """How long after an alert closed it is still matched: the villa's late all-clear, a watch nobody ended."""
    return limit("alerts.late_close_days", 1, unit="days", group="detect", lo=0, hi=30,
                 says="How recently an alert must have closed for the villa's own all-clear to be matched to it.",
                 reached="An older all-clear starts no thread and is not matched.", told="")


# --------------------------------------------------------------------------------------------- which alert, which run
def keys(ev: dict) -> tuple[str, str | None]:
    """(the key an alert is filed under, the key an alert of the same rule was filed under before its rule sent its
    permanent number — None when it sends none). An alert is its rule and its device: the rule by its permanent number
    (`rule_uid`, the automation's own id) when it sends one, else by its entity id.

    ⚠️ A NEW NUMBER FOR A NEW NAME (owner, 2026-10-18 — architecture review, one problem one card #1): the laundry
    rule's entity id changed while its alert #41 was open; its next alert, under the new id, became #55 — the same
    door, two faults. The automation's own id survives any rename."""
    eid = ev.get("entity_id", "")
    by_name = f"{ev.get('rule_id', '')}|{eid}"
    uid = str(ev.get("rule_uid") or "").strip()
    return (f"rule:{uid}|{eid}", by_name) if uid else (by_name, None)


def of_run(store: Store, run: str | None) -> dict | None:
    """The open incident of Home Assistant's run `run` (an event's incident_id), if any."""
    if not run:
        return None
    return next((i for i in store.incidents(open_only=True) if notes_of(i).get("ha_incident") == run), None)


def closed_of_run(store: Store, run: str | None, now: datetime) -> dict | None:
    """The incident of run `run` closed within `late_close_days` of `now`: its villa's late all-clear, or its rule
    giving up, after the desk or a person closed it."""
    if not run:
        return None
    now, window = moment(now), timedelta(days=late_close_days())
    for inc in store.incidents(open_only=False):
        closed = moment(inc.get("closed_at"))
        if closed is not None and now - closed <= window and notes_of(inc).get("ha_incident") == run:
            return inc
    return None


def all_clear(ev: dict) -> bool:
    """Does the villa's event say the problem is over: its all-clear, or its rule giving up with it back to normal
    (`still_true` false)?"""
    return ev.get("phase") == "resolved" or str(ev.get("still_true")).lower() == "false"


#: What `standing` answers — the open incident of this alert: carry on (an all-clear closes it)
OPEN = "open"
#: …closed "Not a problem" while it lasts, and it still lasts: recorded, nothing more (lasted_again)
LASTING = "lasting"
#: …closed and watched still: the same problem back, it reopens under its own number (came_back)
BACK = "back"
#: an all-clear (or giving up) of a run closed already, within late_close_days: its close is said again
LATE = "late"
#: none of these: a new alert (an all-clear of nothing known: nothing to do)
NEW = "new"
#: The phases that end a run (all_clear says whether back to normal)
ENDS = ("resolved", "abandoned")


@dataclass(frozen=True)
class Standing:
    """Where an event of an alert stands. `incident`: the one it is about (None: NEW). `ends`: an all-clear's — the
    incident closed "Not a problem" whose problem it ends (lasted), whatever the verdict. `_filed`: the key it was found
    under (file brings it up to date), None when found by its run."""
    verdict: str
    incident: dict | None = None
    ends: dict | None = None
    _filed: str | None = None


def _accepted(store: Store, names) -> dict | None:
    """The latest incident of the alert (its permanent number's, else its rule's name's) when a person closed it "Not a
    problem" (Notes.LASTING, still written: `lasting` says whether it still holds). Its alert, never its run: Home
    Assistant restarted, the rule's run has another id for the same problem."""
    for key in names:
        rows = store.incidents_of_key(key)
        if rows:
            last = rows[-1]
            return last if last.get("closed_at") and notes_of(last).get(Notes.LASTING) else None
    return None


def _back(store: Store, key: str, now: datetime) -> dict | None:
    """The latest incident of `key` closed and still watched at `now` (reopens).

    ⚠️ BACK AGAIN IS NOT NEW (architecture review 23): an access point dropping every hour got a new number, a new
    "New" message with buttons and a new Kiosk fault each time the desk closed it — the "repeat after" applied only to
    an incident still open, and the retune proposal then counted the desk's own closes."""
    closed = [i for i in store.incidents_of_key(key) if i.get("closed_at") and reopens(i, now)]
    return closed[-1] if closed else None


def standing(store: Store, ev: dict, now: datetime) -> Standing:
    """Where event `ev` (the desk's normalised event: its phase, rule, device, permanent number, run) stands at `now`.
    Reads only — `file` brings the incident found under the alert's names up to date.

    An alert (opened): OPEN — its incident open under either name; LASTING — closed "Not a problem" and its problem
    lasts (`lasting`), inside its watch or after it; BACK — closed and watched still; NEW.
    An end (resolved, abandoned): OPEN — its run's open incident, else its alert's; LATE — its run closed within
    late_close_days; NEW. Either way `ends` is the alert closed "Not a problem" whose problem this all-clear ends.
    Any other phase (restated) reads only OPEN.

    ⚠️ NOT A PROBLEM IS NOT BACK (owner, 2026-11-20, #201): the door left unlocked on purpose, its rule repeating every
    30 minutes, reopened "Back" at each repeat after the press, its reminders and escalation started again."""
    names = [k for k in keys(ev) if k]
    end = ev.get("phase") in ENDS
    if end and (inc := of_run(store, ev.get("ha_incident"))):
        return Standing(OPEN, inc)
    for key in names:
        row = store.find_open_incident(key)
        if row is not None:
            return Standing(OPEN, dict(row), _filed=key)
    if end:
        late = closed_of_run(store, ev.get("ha_incident"), now)
        return Standing(LATE if late else NEW, late, ends=_accepted(store, names) if all_clear(ev) else None)
    if ev.get("phase", "opened") != "opened":
        return Standing(NEW)
    accepted = _accepted(store, names)
    if accepted and lasting(accepted, now):
        return Standing(LASTING, accepted)
    for key in names:
        back = _back(store, key, now)
        if back is not None:
            return Standing(BACK, back, _filed=key)
    return Standing(NEW)


def file(store: Store, st: Standing, ev: dict) -> dict | None:
    """The incident `st` found, filed under `ev`'s alert as it is named now — its permanent number (found under the
    rule's name from before rules sent one), its rule's entity id — read again. One found by its run: as it is.

    ⚠️ ONE FILE OF ALERTS (architecture review scan 2, 2026-10-19): the open alert knew both keys and a rename; intake's
    "came back" path re-did the two keys itself and kept the old name."""
    inc = st.incident
    if inc is None or st._filed is None:
        return inc
    key = keys(ev)[0]
    if st.verdict == OPEN:
        if st._filed != key:
            store.update_incident(inc["id"], key=key)
        if ev.get("rule_id") and inc["rule_id"] != ev["rule_id"]:
            store.update_incident(inc["id"], rule_id=ev["rule_id"])   # renamed: the name it has now
        if ev.get("rule_uid"):
            store.note(inc["id"], {"rule_uid": str(ev["rule_uid"])})
    else:
        fields = {k: v for k, v in (("key", key), ("rule_id", ev.get("rule_id"))) if v and inc.get(k) != v}
        if fields:
            store.update_incident(inc["id"], **fields)
    return store.incident(inc["id"])


# ------------------------------------------------------------------------------------------------- an open run's clearing
def repeated(store: Store, iid: int, notes: dict) -> dict:
    """Open alert `iid` fired again, bringing `notes`: whatever was seen clearing is not over. Its notes as written."""
    return store.note(iid, notes, drop=(CLEAR_SINCE,))


def holds(store: Store, iid: int) -> None:
    """Read again, open alert `iid` still holds: whatever was seen clearing is not over."""
    store.note(iid, drop=(CLEAR_SINCE, SILENT_TOLD, Notes.CLOSES_AT))


def cannot_tell(store: Store, inc) -> bool:
    """Read again, open alert `inc` cannot be told (a device does not answer): whatever was seen clearing is not over.
    Returns whether that is new to say (said once, until it is told again)."""
    first = not notes_of(inc).get(SILENT_TOLD)
    store.note(dict(inc)["id"], {SILENT_TOLD: True}, drop=(CLEAR_SINCE, Notes.CLOSES_AT))
    return first


def clearing(store: Store, inc, now: datetime, minutes: float) -> tuple[str, bool]:
    """Read again, what open alert `inc` claims reads over: since the first look that saw it (CLEAR_SINCE), it closes
    `minutes` on end. Returns (when it closes, as Notes.CLOSES_AT holds it; whether that is now)."""
    since = notes_of(inc).get(CLEAR_SINCE) or now.isoformat()
    start = moment(since) or moment(now)
    closes = (start + timedelta(minutes=minutes)).isoformat()
    store.note(dict(inc)["id"], {CLEAR_SINCE: since, Notes.CLOSES_AT: closes}, drop=(SILENT_TOLD,))
    return closes, moment(now) - start >= timedelta(minutes=minutes)


def clears_at(store: Store, iid: int, closes: str | None) -> None:
    """Read again from its states, open alert `iid` closes at `closes` (out of its bad states since a moment the villa's
    history tells), or nobody can say when (None)."""
    store.note(iid, {Notes.CLOSES_AT: closes} if closes else None,
               drop=(SILENT_TOLD,) if closes else (SILENT_TOLD, Notes.CLOSES_AT))


# ---------------------------------------------------------------------------------------------------- the close, a watch
def terms(clear_minutes: float, reopen_hours: float) -> dict:
    """The desk's two settings a watch is made of, as an incident carries them (Notes.WATCH_TERMS): the window an alert
    back reopens it in (reopen_hours, in minutes) and the wait before a person's close is read again (clear_minutes)."""
    return {"reopen_minutes": float(reopen_hours or 0) * 60, "read_again_minutes": float(clear_minutes or 0)}


def carry(store: Store, iid: int, t: dict, p: dict | None = None) -> bool:
    """`t` (terms) written on open incident `iid` — so a close the engine makes (the Cockpit's) knows them, as the desk
    carries the check — only when they changed. `p`: the notes as already read. Returns whether they changed."""
    if (p if p is not None else notes_of(store.incident(iid))).get(Notes.WATCH_TERMS) == t:
        return False
    store.note(iid, {Notes.WATCH_TERMS: t})
    return True


def can_read_again(inc) -> bool:
    """Can the desk tell, from the villa's system, whether this alert still holds — its claim, or its bad states? Only
    then does the read-again after a person's close watch it (still bad, it reopens)."""
    return bool(notes_of(inc).get("claim")) or alerted_states(inc) is not None


def length(t: dict | None, read_again: bool) -> float:
    """Minutes a close with terms `t` is watched: the reopen window, and for a person's close the desk reads again, at
    least its wait. 0: no watch.

    ⚠️ EVERY CLOSE IS WATCHED ALIKE (owner, 2026-10-25: "it shall consistently exist for all cleared faults") — as long
    as it can come back as the same number, and no longer: with reopen_hours 0 an alert the villa cleared is not
    watched at all, as its closing line says no watch (SKILL.md)."""
    t = t or {}
    reopen = float(t.get("reopen_minutes") or 0)
    return max(reopen, float(t.get("read_again_minutes") or 0) if read_again else 0.0)


def close(store: Store, iid: int, state: str, now_iso: str, *, person: str | None = None,
          can_come_back: bool = True, t: dict | None = None, lasting: bool = False, **fields) -> None:
    """THE close of an alert (Problems.close_incident, Problems.closed_in_kiosk): incident `iid` ends in `state` at
    `now_iso`, its other columns `fields`, and carries the watch that follows — or none. `person`: a person closed it
    (a Done, the Cockpit's Close), said as the desk's read-again says it ("Done (JM)"): the desk reads it again after its
    wait. `can_come_back`: False for an end that cannot come back as this number (its automation gone; the villa back
    online, whose next outage is a new alert) — no watch. `t`: the terms (the desk's); else those carried on it.
    `lasting`: a person's "Not a problem", which holds while the problem lasts (Notes.LASTING: `lasting`).

    ⚠️ FORMATS OUTLIVE THEIR WRITER: an incident an older desk carried only a length for (Notes.WATCH_MINUTES, before
    0.6.350) keeps that length."""
    p = notes_of(store.incident(iid))
    t = t or p.get(Notes.WATCH_TERMS)
    minutes = None
    if can_come_back:
        minutes = length(t, person is not None and can_read_again(store.incident(iid))) if t \
            else p.get(Notes.WATCH_MINUTES)
    keep = {Notes.WATCH_MINUTES: minutes} if minutes else {}
    held = {Notes.LASTING: {"since": now_iso, "seen": now_iso}} if lasting else {}
    store.note(iid, {**keep, **held, **({CHECK: person} if person is not None else {})},
               drop=(() if minutes else (Notes.WATCH_MINUTES,)) + (() if lasting else (Notes.LASTING,)),
               state=state, closed_at=now_iso, **fields)


def rewatch(store: Store, inc, t: dict) -> bool:
    """A person's close still waiting for its read-again whose watch is not what terms `t` make it — closed in the
    Cockpit before the desk carried its terms, or the settings edited since: written now. Returns whether it changed."""
    p = notes_of(inc)
    if not (dict(inc).get("closed_at") and p.get(CHECK)):
        return False
    minutes = length(t, can_read_again(inc))
    if p.get(Notes.WATCH_MINUTES) == (minutes or None) and p.get(Notes.WATCH_TERMS) == t:
        return False
    store.note(dict(inc)["id"], {Notes.WATCH_TERMS: t, **({Notes.WATCH_MINUTES: minutes} if minutes else {})},
               drop=() if minutes else (Notes.WATCH_MINUTES,))
    return True


def minutes(inc, read_again: bool = True) -> float:
    """How long closed `inc` is watched, as its close wrote it (0: not watched) — what its closing line says.
    `read_again=False`: its reopen window alone — said once the desk has read a person's close again."""
    p = notes_of(inc)
    if not read_again and p.get(Notes.WATCH_TERMS):
        return min(length(p[Notes.WATCH_TERMS], False), float(p.get(Notes.WATCH_MINUTES) or 0))
    try:
        return float(p.get(Notes.WATCH_MINUTES) or 0)
    except (TypeError, ValueError):
        return 0.0


def until(inc) -> datetime | None:
    """Until when closed incident `inc` is watched — back within it, it reopens under its own number: its close plus its
    watch. None for an incident open, or one not watched.
    ⚠️ ONE ANSWER (owner, 2026-10-25: Telegram's last update "should match more or less with the time the Fault has
    disappeared from the Watchlist"): the Kiosk fault's confirmsBy, the card's "(watch)" title, the desk's reopening and
    its last word all read it here."""
    inc = dict(inc) if inc is not None else {}
    watch = notes_of(inc).get(Notes.WATCH_MINUTES)
    closed = moment(inc.get("closed_at"))
    if closed is None or not watch:
        return None
    try:
        return closed + timedelta(minutes=float(watch))
    except (TypeError, ValueError):
        return None


def reopens(inc, at: datetime) -> bool:
    """Does an alert at `at` reopen closed incident `inc` under its own number? Within its watch."""
    end = until(inc)
    return end is not None and moment(at) <= end


# ---------------------------------------------------------------------------------------- a person's close, read again
def awaiting_read(inc) -> bool:
    """A person's close the desk has not read again yet."""
    return bool(notes_of(inc).get(CHECK))


def awaiting(store: Store) -> list[dict]:
    """Every closed incident whose person's close waits for its read-again (CHECK), oldest first."""
    return [i for i in store.incidents(open_only=False)
            if f'"{CHECK}"' in (i.get("payload") or "") and i.get("closed_at") and awaiting_read(i)]


def read_due(inc, now: datetime, wait_minutes: float) -> bool:
    """Has closed `inc` waited `wait_minutes` since its close: its read-again is due."""
    closed = moment(dict(inc).get("closed_at"))
    return closed is not None and moment(now) - closed >= timedelta(minutes=wait_minutes)


def read_again(store: Store, inc):
    """Closed `inc`'s read-again taken, once — who closed it, as it said it; None when it is no longer waiting (a fault
    reopened in the Cockpit meanwhile took it away: its own note stays). Whatever it then reads."""
    return store.take_note(dict(inc)["id"], CHECK)


# ------------------------------------------------------------------------------------------ "Not a problem" while it lasts
def lasting(inc, at: datetime) -> bool:
    """Does closed `inc`'s "Not a problem" (Notes.LASTING) still hold at `at`: its alert repeated now is the same
    problem lasting, recorded and nothing more, inside its watch or after it. Until the villa's all-clear for it
    (lasted), or the alert opening again.

    ⚠️ NEVER FOREVER: an all-clear that never comes (its automation removed or renamed, or it gave up) would hide the
    next real alert. It holds while its rule keeps repeating it: silent for `late_close_days` since its latest repeat
    (the window the villa's late all-clear is matched in), it no longer holds and the next alert opens as usual."""
    inc = dict(inc) if inc is not None else {}
    held = notes_of(inc).get(Notes.LASTING)
    if not inc.get("closed_at") or not isinstance(held, dict):
        return False
    seen = moment(held.get("seen") or held.get("since"))
    return seen is not None and moment(at) - seen <= timedelta(days=late_close_days())


def lasted_again(store: Store, inc, at: datetime) -> None:
    """Its rule repeated the alert closed "Not a problem" at `at`: the problem still lasts (lasting counts from here)."""
    held = notes_of(inc).get(Notes.LASTING) or {}
    store.note(dict(inc)["id"], {Notes.LASTING: {**held, "seen": at.isoformat()}})


def lasting_since(inc) -> str | None:
    """Since when closed `inc`'s problem lasts: its "Not a problem" close (Notes.LASTING), ISO; None when not held."""
    held = notes_of(dict(inc) if inc is not None else {}).get(Notes.LASTING)
    return str(held["since"]) if isinstance(held, dict) and held.get("since") else None


def lasted(store: Store, inc) -> None:
    """The problem closed "Not a problem" ended (the villa's all-clear for it): its next alert is a new occurrence."""
    store.note(dict(inc)["id"], drop=(Notes.LASTING,))


# ------------------------------------------------------------------------------------------------------- the reopening
def reopened(store: Store, iid: int, notes: dict | None = None, **fields) -> dict:
    """THE reopening's notes: closed incident `iid` open again — `notes` and its columns `fields` written, and what the
    run that ended kept goes (RUN_NOTES: its clearing, its "Not a problem", its read-again). Its notes as written.
    Whichever way: back (came_back), still there after a close (not_over), reopened in the Cockpit (Problems)."""
    return store.note(iid, notes, drop=RUN_NOTES, **fields)


def came_back(store: Store, iid: int, ev: dict, now_iso: str) -> dict:
    """Closed `iid`'s alert came back (BACK): a new run of it, Home Assistant's latest (BACK_FIELDS) on it, the run that
    ended kept with its own words, its rule watching it again (ABANDONED goes). Its notes as written."""
    ended = notes_of(store.incident(iid)).get(Notes.MESSAGE)   # the run that ended keeps its own words
    p = store.note(iid, {k: ev[k] for k in BACK_FIELDS if ev.get(k) is not None}, drop=RUN_NOTES + (ABANDONED,))
    store.reopen_incident(iid, now_iso, message=ended)       # this run's first alert: counted one
    return p


def not_over(store: Store, iid: int) -> dict:
    """Closed `iid` read again still there: the same run open again, Home Assistant no longer watching it (the desk does:
    ABANDONED). Its notes as written."""
    return reopened(store, iid, {ABANDONED: True}, closed_at=None, reply=None)


# ---------------------------------------------------------------------------------------------------- the watch's end
def watching(inc, now: datetime | None = None) -> bool:
    """Is closed `inc` still watched — its copies titled "(watch)" (owner, 2026-10-25)? Until the desk says its watch is
    over (Notes.WATCH_OVER, written with this close's moment), at its first look past `until`; a watch nobody ended
    (the desk stopped) is over `late_close_days` after it, as the desk leaves it."""
    end = until(inc)
    if end is None or notes_of(inc).get(Notes.WATCH_OVER) == dict(inc).get("closed_at"):
        return False
    return moment(now or datetime.now(timezone.utc)) < end + timedelta(days=late_close_days())


#: What `over` answers: the watch ended and the alert did not come back — its last word is said
ENDED = "ended"
#: …or its alert came back as another number meanwhile (closed by an older desk with a watch it could not keep):
#: nothing is said, "it did not come back" would be false
CAME_BACK_AS_NEW = "came_back_as_new"


def over(inc, now: datetime, later=()) -> str | None:
    """Is closed `inc`'s watch over now, and how: ENDED (its last word is due), CAME_BACK_AS_NEW (`later`: the
    incidents opened after it — one of its own alert opened within its watch), or None (watched still, not watched,
    already told, waiting for its read-again, or ended more than `late_close_days` ago — left as it is)."""
    inc = dict(inc)
    p = notes_of(inc)
    end = until(inc)
    if end is None or p.get(Notes.WATCH_OVER) == inc.get("closed_at") or p.get(CHECK):
        return None
    if lasting(inc, now):
        # ⚠️ NEVER CLOSED WHILE IT IS STILL THERE (owner, 2026-11-20, #208: "It can't be closed if an issue is still
        # here, right?"): its watch of 1h over at 22:31, the card read "(closed)", struck, "Closed at 22:31: still there,
        # accepted as not a problem." while the door stayed unlocked and its rule posted it again every 30 minutes. A
        # "Not a problem" problem is watched while it lasts; the villa's all-clear for it ends it (desk.resolved)
        return None
    now = moment(now)
    if now < end or now - end > timedelta(days=late_close_days()):
        return None
    closed = moment(inc["closed_at"])
    for o in later:
        o = dict(o)
        at = moment(o.get("opened_at"))
        if o.get("id") != inc.get("id") and o.get("key") == inc.get("key") and at is not None and closed <= at <= end:
            return CAME_BACK_AS_NEW
    return ENDED


def told_over(store: Store, inc) -> None:
    """Its watch's end recorded (Notes.WATCH_OVER: this close's moment) — said once; a later close is watched again."""
    store.note(dict(inc)["id"], {Notes.WATCH_OVER: dict(inc)["closed_at"]})


def watches_over(store: Store, now: datetime) -> list[tuple[dict, str]]:
    """Every closed alert whose watch is over at `now` (over), each recorded told (told_over) — once per close: [(the
    incident, ENDED or CAME_BACK_AS_NEW)], oldest first."""
    every = store.incidents(open_only=False)
    ended = []
    for inc in every:
        if not inc.get("closed_at") or f'"{Notes.WATCH_MINUTES}"' not in (inc.get("payload") or ""):
            continue                                                       # open, or never watched: not read
        how = over(inc, now, every)
        if how is not None:
            told_over(store, inc)
            ended.append((inc, how))
    return ended
