"""A closed alert's watch — ONE owner for the time after an alert closes, while it can still come back as the same
number: how a close carries or drops it, until when it lasts, whether an alert now reopens a closed one, and whether
its watch is over.

⚠️ ONE WATCH, NOT FIVE READINGS OF TWO SETTINGS (architecture review, 2026-10-26: "a closed alert says 'it did not come
back' when it did"): the alert desk said "Watch 4h" from reopen_hours, reopened an alert from reopen_hours, carried
max(clear_minutes, reopen_hours) for the Cockpit's "VESTA confirms by", kept the "(watch)" title a hard-coded day past
it, and four closes each wrote it or not. The villa-silent alert closed "back online" kept the watch every open alert
carried, although a new outage opens a NEW number: 40 minutes later #2 opened, and 4 hours after its close #1 said
"Closed on …: it did not come back within 4h." Here: the desk carries its two settings (terms) once, every close goes
through `close` — who closed it, whether it can come back — and every reader (the desk's words and reopening, the
Cockpit's confirmsBy, the "(watch)" title, the watch's last word) asks the length that close wrote.

The words stay the desk's (words.yaml); nothing here holds a setting: the terms are the desk's, the late days a limit.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .limits import limit
from .store import Notes, Store, alerted_states, notes_of

#: The read-again a person's close waits for (the desk's quiet_after_done): who closed it and how, as it says it
CHECK = "check_quiet"


def late_close_days() -> float:
    """How long after an alert closed it is still matched: the villa's late all-clear, a watch nobody ended."""
    return limit("alerts.late_close_days", 1, unit="days", group="detect", lo=0, hi=30,
                 says="How recently an alert must have closed for the villa's own all-clear to be matched to it.",
                 reached="An older all-clear starts no thread and is not matched.", told="")


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
          can_come_back: bool = True, t: dict | None = None, **fields) -> None:
    """THE close of an alert (Problems.close_incident, Problems.closed_in_kiosk): incident `iid` ends in `state` at
    `now_iso`, its other columns `fields`, and carries the watch that follows — or none. `person`: a person closed it
    (a Done, the Cockpit's Close), said as the desk's read-again says it ("Done (JM)"): the desk reads it again after its
    wait. `can_come_back`: False for an end that cannot come back as this number (its automation gone; the villa back
    online, whose next outage is a new alert) — no watch. `t`: the terms (the desk's); else those carried on it.

    ⚠️ FORMATS OUTLIVE THEIR WRITER: an incident an older desk carried only a length for (Notes.WATCH_MINUTES, before
    0.6.350) keeps that length."""
    p = notes_of(store.incident(iid))
    t = t or p.get(Notes.WATCH_TERMS)
    minutes = None
    if can_come_back:
        minutes = length(t, person is not None and can_read_again(store.incident(iid))) if t \
            else p.get(Notes.WATCH_MINUTES)
    keep = {Notes.WATCH_MINUTES: minutes} if minutes else {}
    store.note(iid, {**keep, **({CHECK: person} if person is not None else {})},
               drop=() if minutes else (Notes.WATCH_MINUTES,), state=state, closed_at=now_iso, **fields)


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
    try:
        closed = datetime.fromisoformat(str(inc.get("closed_at")).replace("Z", "+00:00")) if inc.get("closed_at") else None
        if closed is None or not watch:
            return None
        closed = closed if closed.tzinfo else closed.replace(tzinfo=timezone.utc)
        return closed + timedelta(minutes=float(watch))
    except (TypeError, ValueError):
        return None


def reopens(inc, at: datetime) -> bool:
    """Does an alert at `at` reopen closed incident `inc` under its own number? Within its watch."""
    end = until(inc)
    return end is not None and at <= end


def awaiting_read(inc) -> bool:
    """A person's close the desk has not read again yet."""
    return bool(notes_of(inc).get(CHECK))


def watching(inc, now: datetime | None = None) -> bool:
    """Is closed `inc` still watched — its copies titled "(watch)" (owner, 2026-10-25)? Until the desk says its watch is
    over (Notes.WATCH_OVER, written with this close's moment), at its first look past `until`; a watch nobody ended
    (the desk stopped) is over `late_close_days` after it, as the desk leaves it."""
    end = until(inc)
    if end is None or notes_of(inc).get(Notes.WATCH_OVER) == dict(inc).get("closed_at"):
        return False
    return (now or datetime.now(timezone.utc)) < end + timedelta(days=late_close_days())


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
    if now < end or now - end > timedelta(days=late_close_days()):
        return None
    closed = datetime.fromisoformat(str(inc["closed_at"]).replace("Z", "+00:00"))
    for o in later:
        o = dict(o)
        opened = o.get("opened_at")
        if o.get("id") != inc.get("id") and o.get("key") == inc.get("key") and opened:
            at = datetime.fromisoformat(str(opened).replace("Z", "+00:00"))
            if closed <= (at if at.tzinfo else at.replace(tzinfo=timezone.utc)) <= end:
                return CAME_BACK_AS_NEW
    return ENDED


def told_over(store: Store, inc) -> None:
    """Its watch's end recorded (Notes.WATCH_OVER: this close's moment) — said once; a later close is watched again."""
    store.note(dict(inc)["id"], {Notes.WATCH_OVER: dict(inc)["closed_at"]})
