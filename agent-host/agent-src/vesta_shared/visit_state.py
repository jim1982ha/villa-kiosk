"""A visit of the villa's presence automation: where it stands, decided ONCE (architecture review of visits,
2026-11-07, card 1).

"Is this visit open or over, since when, why, by whom, who holds it, which step, which photos" was answered in seven
places — the engine reading the villa's record (app.Vesta._visit_now), the alert desk's intake (a visit closed while
VESTA was away, a step of a visit already closed, its first event), its all-clear (`resolved`), its tick
(`visits_over`), its close (`visit_close`) and the Kiosk's repair (Problems.closed_unmade) — and each answer had its own
gap (#138, #140, #141, #143: a visit the villa had closed shown open, "monitoring until", a "new" pop-up). Every one of
them now asks this module, from the same two inputs: the villa's record as read now, and the event (or the incident's
note of the visit as VESTA last saw it). The event path and the tick call the same `now_of`/`seen`.

Pure: no store, no client, no clock (the desk and the engine both import it; vesta_shared is what a skill reads).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .store import Notes

#: What the villa's record says NOW of a visit it still holds as this visit: who holds it, each chat's card and the
#: villa's replies, a person's answer, the villa's own reminder, the step it acknowledged, its close, its latest step.
HELD = ("owner", "messages", "answered", "reminded_at", "ack_seq", "closed", "seq")
#: Of those, what an OPEN visit's event takes from the record (its story stays the event's: steps arrive in order).
#: ⚠️ AN EVENT TAKEN IN LATE IS THE RECORD AS IT WAS (owner's drill #129: VESTA restarted mid-visit took in the steps it
#: missed, each saying VESTA held the visit, after the villa had taken it back and rung the door itself).
TAKEN_WHILE_OPEN = ("owner", "messages", "answered", "reminded_at")
#: A visit's story as the record holds it once it ended (its steps, photos, strongest step, moments, answer, close):
#: read whole, so an ended visit is told from the record, never from a late event (owner's drill #138).
STORY = ("steps", "photos", "strongest", "step", "seq", "opened_at", "last_at", "closes_at", "entities", "answered",
         "closed")
#: An incident's note: its visit ended while VESTA was away (the record read it closed when VESTA first heard of it) —
#: recorded with its story, its close the villa's, its cards final, the villa never told (owner's drill #138).
AWAY = "visit_away"
#: Why the villa closed a visit before its quiet window: a resident came home; a person's answer the villa applied.
HOME, ANSWERED = "home", "answered"

#: Transitions since VESTA last saw the visit (`transition`).
NEW = "new"              # no incident yet: VESTA opens it (closed already: AWAY, recorded closed at once)
STEP = "step"            # its open incident: told anew
LATE = "late"            # its incident closed already (a person's close crossed the villa's): nothing more to tell
CLOSE = "close"          # its all-clear, or the record read over at a tick: closed as the villa closed it


def when(iso) -> datetime | None:
    """A record's moment (ISO), aware; None when it is none."""
    try:
        t = datetime.fromisoformat(str(iso))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def now_of(row, vid: str) -> dict | None:
    """What the villa's record (`row`: {state, attributes}, as read now) says of visit `vid`: what it holds of it
    (HELD), and once it is over its whole story (STORY) and its close (`closed`: {why, at?, who?}; "closed" when the
    record did not say why). A record holding a later visit: this one is over, its story the event's. None when the
    record says nothing of any visit (unread, empty)."""
    attrs = row.get("attributes") if isinstance(row, dict) else None
    if not isinstance(attrs, dict) or not attrs.get("id"):
        return None
    if attrs["id"] != vid:
        return {"closed": {"why": "closed"}}
    now = {k: attrs.get(k) for k in HELD}
    if row.get("state") == "closed" or isinstance(attrs.get("closed"), dict):
        now.update({k: attrs[k] for k in STORY if attrs.get(k) is not None})
        now["closed"] = attrs["closed"] if isinstance(attrs.get("closed"), dict) else {"why": "closed"}
    return now


def seen(v, now: dict | None = None) -> dict:
    """The visit as it stands: `v` (an event's, or the incident's note of it as VESTA last saw it; {} for none) with
    the record as read now (`now`, else the event's own `now`: app.Vesta._visit_now) — an ended visit wholly as the
    record holds it, an open one taking only who holds it, its cards, an answer and a reminder (TAKEN_WHILE_OPEN)."""
    if not isinstance(v, dict):
        return {}
    if now is None:
        now = v.get("now")
    now = now if isinstance(now, dict) else {}
    base = {k: x for k, x in v.items() if k != "now"}
    if over(now):
        return {**base, **now}
    return {**base, **{k: now[k] for k in TAKEN_WHILE_OPEN if k in now}}


def over(v) -> bool:
    """Has the villa ended this visit (its `closed`)?"""
    return isinstance((v or {}).get("closed"), dict)


def ended_on(v: dict, row, vid: str) -> dict | None:
    """The tick's question, the event's answer: visit `v` (an open incident's note) as the record read now says it,
    when that says it ended — None while it is open there (or unread)."""
    now = now_of(row, vid)
    return seen(v, now) if over(now) else None


def away(notes) -> bool:
    """Did the incident's visit end while VESTA was away (`notes`: the incident's)? Never chased, never told."""
    return bool((notes or {}).get(AWAY))


def away_notes() -> dict:
    """The notes an incident gets when its visit was over before VESTA heard of it: away, its fault made closed."""
    return {AWAY: True, Notes.FAULT_CLOSED: True}


def fault_made_closed(notes) -> bool:
    """Is the incident's Kiosk fault made closed in one write (a visit over before VESTA heard of it)?"""
    return bool((notes or {}).get(Notes.FAULT_CLOSED))


@dataclass(frozen=True)
class Transition:
    """What changed since VESTA last saw the visit: `kind` (NEW, STEP, LATE, CLOSE); `away`: it ended while VESTA was
    away (its cards the villa's, final; nothing sent, edited or told); `tell`: the villa is told the step was taken."""
    kind: str
    away: bool = False
    tell: bool = True


def transition(v: dict, open_notes: dict | None, late_notes: dict | None, phase: str = "step") -> Transition:
    """Visit `v` (`seen`) at an event of `phase`, its incident open (`open_notes`, its notes) or closed lately
    (`late_notes`), or neither: what VESTA does with it.

    - an all-clear (`phase` "resolved"): its open incident closed (CLOSE, away as it was recorded); one closed already
      LATE — its close said again, unless it ended while VESTA was away (nothing changes: `tell` False);
    - a step of a closed incident: LATE, told as taken unless the visit is over on the villa (it waits for nothing);
    - no incident: NEW — `away` when the villa had ended it already;
    - its open incident: STEP — `away` when it is over and was recorded so."""
    ended = over(v)
    if phase == "resolved":
        if open_notes is not None:
            return Transition(CLOSE, away(open_notes))
        return Transition(LATE, away(late_notes), tell=late_notes is not None and not away(late_notes))
    if open_notes is None and late_notes is not None:
        return Transition(LATE, away(late_notes), tell=not ended and not away(late_notes))
    if open_notes is None:
        return Transition(NEW, ended, tell=not ended)
    gone = ended and away(open_notes)
    return Transition(STEP, gone, tell=not gone)


@dataclass(frozen=True)
class Ending:
    """How the villa ended a visit: `at` (its moment, None: now, after its quiet), `why` (HOME, ANSWERED, "quiet",
    "closed", "": not said), `who` (a resident home, a person's answer), `answered` (the press the villa applied)."""
    at: datetime | None
    why: str
    who: str
    answered: dict


def ending(v: dict) -> Ending:
    """How visit `v` ended, as its record says: its close's moment (an answer's, when the answer closed it)."""
    home = v.get("closed") if isinstance(v.get("closed"), dict) else {}
    ans = v.get("answered") if isinstance(v.get("answered"), dict) else {}
    at = when(home.get("at")) or (when(ans.get("at")) if home.get("why") == ANSWERED else None)
    return Ending(at if home else None, str(home.get("why") or ""), str(home.get("who") or ""), ans)


# ------------------------------------------------------------------ the visit's photos
# ⚠️ ONE WAY TO CHOOSE AND ORDER THEM (architecture review of visits, 2026-11-07, card 3): the desk ordered them
# strongest first, the sheet kept the strongest and the latest, the picture put the siren's snapshots in by time and
# "All photos" sent them oldest first — #148's sheet dropped the Parking photo with the person. One list now: the lead
# (the strongest step's photo, the earliest of its device) first, then every other photo oldest first, those Telegram's
# picture shows marked `onSheet` (the lead and the latest of the rest).
def photos_of(v: dict) -> list[dict]:
    """The photos visit `v`'s record holds, as the sheet and the tablet read them: [{path, label, at, strongest?}] — the
    ones of the strongest step's device marked `strongest`; a photo with no file or no moment left out."""
    top = (v.get("strongest") or {}).get("entity_id")
    out = []
    for ph in v.get("photos") or []:
        if not isinstance(ph, dict) or not ph.get("path") or not when(ph.get("at")):
            continue
        out.append({"path": str(ph["path"]), "label": str(ph.get("camera_name") or ph.get("camera") or ""),
                    "at": str(ph["at"]), **({"strongest": True} if top and ph.get("entity_id") == top else {})})
    return ordered(out)


def ordered(photos, shown: int | None = None) -> list[dict]:
    """`photos` (the record's, the siren's snapshots with them) as ONE list: the lead first (`lead`: the earliest of the
    strongest step's, else the earliest), then the rest oldest first; with `shown` (how many tiles Telegram's picture
    holds), `onSheet` on the lead and the latest of the rest — in that same order."""
    photos = [{k: x for k, x in p.items() if k not in ("lead", "onSheet")} for p in photos or [] if isinstance(p, dict)]
    if not photos:
        return []
    by_time = sorted(photos, key=lambda p: str(p.get("at")))
    lead = next((p for p in by_time if p.get("strongest")), by_time[0])
    rest = [p for p in by_time if p is not lead]
    out = [{**lead, "lead": True}, *rest]
    if shown is None:
        return out
    keep = {id(p) for p in rest[-(shown - 1):]} if shown > 1 else set()
    return [{**out[0], "onSheet": True}, *({**p, "onSheet": id(p) in keep} for p in rest)]


def off_sheet(photos) -> int:
    """How many of an `ordered` list Telegram's picture leaves to the tablet ("+N more photos")."""
    return sum(1 for p in photos or [] if not p.get("onSheet"))
