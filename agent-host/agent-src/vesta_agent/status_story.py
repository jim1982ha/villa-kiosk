"""An alert's Status, written ONCE for every reader (architecture review of visits, 2026-11-07, card 2).

The same story was written three times — Telegram's "Status:" (notice.Notices.history_lines), the tablet's message
(kiosk_messages.of_parts, its lines then read back from Telegram's heading: now its heading's `story`, everyone's,
drawn here for no chat) and the Kiosk fault's short story
(notice.Notices.story, its own wording, kept by moment with a microsecond nudge) — and the copies drifted: the fault
lacked "Alert sent" and ": alert sent again", wrote dates where Telegram wrote times. Here an incident's history becomes
ONE ordered list of lines (`lines`): each with a stable id, its moment as data, its words with a slot where the moment
goes, and the roles it went to. This module owns which lines there are and their order — a repeat folded into one
line (notice.fold, at record), "Alert sent" kept on a visit, the steps the bottom line says cut, a visit's card sent
again said on its step's line, a press its answer says, "+N more photos" last. The readers only render it:

- Telegram and the tablet's message: `shown` — the moment written by the alert's day (timeutil.status_moment), from
  the line's data, in the chat's language;
- the Kiosk fault: `fault` — the same English words without the moment (the Kiosk writes the line's own time beside
  it), kept by the line's id (kiosk.noted).

⚠️ EACH CHAT ITS OWN LINES (owner, 2026-11-20, live #201, reversing 2026-11-07 #146-P2 "every copy the same lines"):
the owner's group, joined at the escalation, listed every reminder and still-there alert sent to the facility manager.
A Telegram chat lists a line sent to roles only when they include one of its own (`seen_by`); a line of no roles (a
close, a press, a note, a visit's story line) only in the chats of the alert's first recipients, its closes and presses
also in a chat its escalation brought in, from then on; and the alert's first "Alert sent" in every chat, the one line
that says when the fault began. The tablet's message and the Kiosk fault are
everyone's: every line (`roles` None).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from vesta_shared import status_words
from vesta_shared.message_format import LASTING_LISTED, MARK_ICONS, ON_PLACE, ON_TELEGRAM, PRESSED_STAGE, STEPS
from vesta_shared.timeutil import moment, moment_label, status_moment

#: Where a line's moment goes in its words: filled when it is shown (`shown`), taken out for the fault (`fault`).
SLOT = "⁣"


@dataclass(frozen=True)
class Line:
    """One line of an alert's Status: `id` (stable across redraws: the fault keeps it by it), `at` (its moment, None:
    none of its own), `words` (SLOT where the moment goes; a line the desk wrote may hold its own whole moments),
    `roles` (whom it went to), `stage` (its step, None for a line of a visit's story or a note)."""
    id: str
    at: datetime | None
    words: str
    roles: frozenset = frozenset()
    stage: str | None = None
    #: the moments a repeat folded into it was (notice._merged): the fault's lines of them are this one
    ats: tuple = ()


def line_id(h: dict) -> str:
    """A history line's stable id: the one it was given, else made from what never changes on it — a visit's story
    line by its key, the count of dropped lines, any other by its step and its FIRST moment (a repeat folded into it
    keeps it: notice._merged)."""
    if h.get("id"):
        return str(h["id"])
    if h.get("fold"):
        return f"seen:{h['fold']}"
    if h.get("dropped"):
        return "dropped"
    first = (h.get("ats") or [h.get("at")])[0]
    return f"{h.get('stage') or 'note'}@{first}"


def lines(notices, incident: int, lang: str = "en", latest_excluded: int = 0, bottom: bool = True,
          roles=None, chat: int | None = None) -> list[Line]:
    """Incident `incident`'s Status lines in `lang`, for Telegram chat `chat` of `roles` (`seen_by`; None: everyone's,
    the tablet's and the fault's). `bottom`: the reader shows a bottom line under them (Telegram, the tablet's message) — the last
    `latest_excluded` notices it says are left out, a close standing is it, and a press its answer says is that answer
    while only its escalation came after; the fault has no bottom line."""
    from .notice import CLOSED_STEP, ESCALATED_STAGE
    history = notices.state.incident_history(incident)
    gone = _cut(history, latest_excluded)[1] if bottom and latest_excluded else set()
    # ⚠️ A CLOSE STANDING IS ITS BOTTOM LINE (owner, 2026-11-05, #118): redrawn while closed, the card listed
    # "- Closing note sent 00:19" above "✅ Not a problem on 00:19 (Jm). Watch 1h." — the same close. Its step shows
    # once something came after it (it came back), or as the close's own words once its watch is over (note_step)
    # ...and stays it under the lines of its problem repeated while it lasts (a lasting repeat: `standing`)
    kept = [i for i in range(len(history)) if i not in gone]
    at = standing([history[i] for i in kept])
    if bottom and at is not None and history[kept[at]].get("stage") == CLOSED_STEP and notices.closed_now(incident):
        gone.add(kept[at])
    # a visit's card sent again is said on the line of the step that made it ring (resent_into)
    into = {i: j for i, j in resent_into(history).items() if j not in gone}
    resent: dict[int, set[str]] = {}
    for i, j in into.items():
        resent.setdefault(j, set()).update(notices._roles(history[i]))
    out: list[Line] = []
    for i, h in enumerate(history):
        if i in gone or i in into:
            continue
        if roles is not None and not seen_by(notices, h, roles, history, resent.get(i, set()), chat):
            continue
        # ⚠️ ONE LINE PER PRESS (architecture review 23, card 4): a press whose answer says it (skill.yaml `tells`:
        # "🆘 Need help on … (Luc): Owner is asked to act.") is that answer while nothing but the escalation it made
        # came after it — its own line once something did
        if bottom and h.get("stage") == PRESSED_STAGE and h.get("told") and \
                all(x.get("stage") == ESCALATED_STAGE for x in history[i + 1:]):
            continue
        words = _words(notices, h, lang, listed=bottom)
        if words is None:
            continue
        if i in resent:
            words = status_words.resent(words, notices._who(resent[i], lang=lang), lang)
        at = None if h.get("dropped") else moment(h.get("at"))
        out.append(Line(line_id(h), at, words, frozenset(notices._roles(h) | resent.get(i, set())), h.get("stage"),
                        tuple(h.get("ats") or ())))
    # "+3 more photos on the tablet": a count of the card, never a moment, after every other line (owner, 2026-11-07)
    last = {line_id(h) for h in history if h.get("last")}
    return [x for x in out if x.id not in last] + [x for x in out if x.id in last]


def first_alert(notices, history: list[dict]) -> dict | None:
    """The alert's first "Alert sent" (its first notice when none says so: a history begun by a later step): every chat
    lists it, and whom it went to are the alert's first recipients (`seen_by`)."""
    return next((h for h in history if h.get("stage") == "new" and not observed(h)), None) or \
        next((h for h in history if notices._roles(h)), None)


def seen_by(notices, h: dict, roles, history: list[dict], resent=frozenset(), chat: int | None = None) -> bool:
    """Does Telegram chat `chat` of `roles` list line `h` of `history` (`resent`: the roles of a visit's card sent
    again said on it)? The alert's first alert (`first_alert`), always; a line sent to roles when they include one of
    the chat's, or sent to the chat itself (the villa's own message posted there, taken over); a line of none (a
    close, a press, a note, a visit's story line) when the alert's first recipients do, the chat among them. A chat of
    no role is told everything (owner, 2026-11-20, #201).

    ⚠️ HOW IT ENDS, ONCE ESCALATED THERE (owner, 2026-11-20, #201): an alert sent to the facility manager and escalated
    to the owner lists in the owner's group, from that escalation on, its closes ("Cleared", "Done", "Not a problem")
    and its presses (`ending`) — never the facility manager's reminders, still-there alerts and returns. In the
    history's order (the moments of two steps of one result can be the same)."""
    roles = set(roles or ())
    first = first_alert(notices, history)
    if not roles or h is first:
        return True
    def mine(x: dict) -> bool:
        return bool(notices._roles(x) & roles) or (chat is not None and any(
            str(c) == str(chat) for c, _r in x.get("chats") or []))
    went = notices._roles(h) | set(resent)
    if went & roles or mine(h):
        return True
    if ending(h):
        # brought in later (an escalation): the ends from the chat's first own step on, and the press that brought
        # it in ("Need help", right before the escalation it made: who asked for help is never lost)
        joined = next((j for j, x in enumerate(history) if mine(x)), None)
        at = next((i for i, x in enumerate(history) if x is h), None)
        if joined is not None and at is not None and (at >= joined or (
                at == joined - 1 and h.get("stage") == PRESSED_STAGE)):
            return True
    if went:
        return False
    told = notices._roles(first) if first is not None else set()       # the alert's first recipients
    return not told or bool(told & roles) or (first is not None and mine(first))


def ending(h: dict) -> bool:
    """Is history line `h` one that says how an alert ends or is handed over: a close (its message, its words, its
    watch over), someone taking it on in the Kiosk, a press?"""
    from .notice import CLEARED_STAGE, CLOSED_STEP, TAKEN_STAGE
    return h.get("stage") in (CLOSED_STEP, CLEARED_STAGE, TAKEN_STAGE, PRESSED_STAGE)


def _words(notices, h: dict, lang: str, listed: bool = False) -> str | None:
    """One step of an incident's history as its line says it, SLOT where its moment goes: "Reminder sent ⁣ (to: FM)",
    "Back at ⁣, 2nd time in 7 days (to: FM)", "🆘 Need help on Telegram at ⁣ (Fabien)", a note as written. `listed`:
    a lasting repeat's moments each go in its SLOT (`shown`, LASTING_LISTED), its count said only past them."""
    if h.get("dropped"):
        return status_words.earlier(h["dropped"], lang)
    if h.get("note"):
        # someone took it on in the Kiosk, its close once its watch is over, a visit's story line: kept as written
        return (h.get("note_in") or {}).get(lang) or h["note"]
    if h.get("stage") == PRESSED_STAGE:
        return _pressed(h, lang)
    since = moment(h.get("from")) if h.get("from") else None
    times = h.get("times")
    if listed and h.get("stage") == LASTING_STAGE and (times or 1) <= LASTING_LISTED:
        times = None                    # each repeat its moment on the line (`shown`): no count beside them
    return status_words.step(h.get("stage"), SLOT, status_words.times(h.get("run"), _again(), lang),
                             notices._who(notices._roles(h), h.get("reach"), lang=lang), lang, times,
                             since=moment_label(since, notices.tz) if since else None)


def _again() -> int:
    from vesta_shared.problems import again_days
    return again_days()


def _pressed(h: dict, lang: str) -> str:
    """A press: "🆘 Need help on Telegram at ⁣ (Fabien)" — where it was pressed (a press kept before its place was:
    on Telegram), in the chat's language when the button has a label in it (`labels`; else the whole line in English,
    never half)."""
    label = (h.get("labels") or {}).get(lang) if lang != "en" else None
    lang = lang if label else "en"
    what = f"{MARK_ICONS.get(h.get('mark') or '', '')} {label or h.get('label')}".strip()
    if lang == "en":
        what = f"{what} {ON_PLACE.get(h.get('place') or ON_TELEGRAM, ON_PLACE[ON_TELEGRAM])}"
    return status_words.acted(what, SLOT, h.get("name") or "", lang)


def _local(at: datetime, zone: str | None) -> datetime:
    """`at` in the villa's time (`zone`; None: `at` is already)."""
    return at.astimezone(ZoneInfo(zone)) if zone else at


def shown(x: Line, day: date | None, zone: str | None = None, lang: str = "en") -> str:
    """Line `x` as a Status shows it, Telegram's and the tablet's: its moment its time alone on the alert's own `day`,
    "08/11 09:20" on another (timeutil.status_moment), "at" before a time where a day reads "on" — and any moment the
    desk wrote in its own words the same way (status_words.moments)."""
    words = x.words
    if SLOT in words and x.at is not None:
        t = _local(x.at, zone)
        if day is not None and t.date() == day:
            for on, at in status_words.on_words(lang):
                words = words.replace(f"{on} {SLOT}", f"{at} {SLOT}")
        words = words.replace(SLOT, ", ".join(status_moment(_local(m, zone), day) for m in _listed(x)) or
                              status_moment(t, day))
    return status_words.moments(words.replace(SLOT, ""), day, lang)


def _listed(x: Line) -> list[datetime]:
    """The moments line `x` lists: a lasting repeat's latest (LASTING_LISTED), each one — "Still there at 21:56, 22:26,
    22:56" (owner, 2026-11-20, #208) — none for any other line (its one moment)."""
    if x.stage != LASTING_STAGE and not x.id.startswith(f"{LASTING_STAGE}@"):
        return []
    return [m for m in (moment(a) for a in x.ats[-LASTING_LISTED:]) if m is not None]


def after_close(lines, word: str | None = None) -> tuple[list, list]:
    """A heading's Status lines (as `as_head` keeps them) split before its bottom line and after it: the repeats of a
    problem closed "Not a problem" that came after the close go UNDER it, the card's last line.

    ⚠️ CLOSED, STRUCK, STILL RINGING (owner, 2026-11-20, #208: "But it says 'closed at...' and it's stroke"): its watch
    over, the card read "✅ Closed at 22:31: still there, accepted as not a problem." and every line above it struck —
    the repeat posted at 23:26 among them. The latest repeat is what the ping is about: the card's last, plain line.
    `word`: the card's title word — "closed", the problem is over (its all-clear): its last word is the bottom line."""
    lines = list(lines or ())
    if word == "closed":
        return lines, []
    cut = len(lines)
    while cut and isinstance(lines[cut - 1], dict) and str(lines[cut - 1].get("id") or "").startswith(f"{LASTING_STAGE}@"):
        cut -= 1
    return lines[:cut], lines[cut:]


def text(x, day: date | None = None, lang: str = "en") -> str:
    """A heading's Status line as shown: one kept as facts (`as_head`), drawn from them; one kept as text (a copy
    drawn before 0.12.481, a line the desk wrote) with its moments written by the alert's day (status_words.moments)."""
    if isinstance(x, dict):
        return f"- {shown(Line(str(x.get('id') or ''), moment(x['at']) if x.get('at') else None, str(x.get('words') or ''), ats=tuple(x.get('ats') or ())), day, None, lang)}"
    return status_words.moments(str(x), day, lang)


def texts(lines, day: date | None = None, lang: str = "en") -> list[str]:
    return [text(x, day, lang) for x in lines or ()]


def bare(words: str) -> str:
    """English words without their moment: "Back at ⁣, 2nd time" → "Back, 2nd time"; "Reminder sent ⁣ (to: FM)" →
    "Reminder sent (to: FM)"."""
    for before in (" at ", " on ", " "):
        words = words.replace(f"{before}{SLOT}", "")
    return words.replace(SLOT, "")


def fault(notices, incident: int) -> list[dict]:
    """What the Kiosk fault's card tells of incident `incident`, oldest first: [{id, at, note, stage}] — every line of
    its Status, in English, each without its moment (the Kiosk writes the line's own beside it), kept by `id`."""
    from .notice import TAKEN_STAGE
    day = notices.day(incident)
    d = date.fromisoformat(day) if day else None
    out = []
    for x in lines(notices, incident, "en", bottom=False):
        if x.at is None or x.stage == TAKEN_STAGE:
            # the count of the dropped lines (the fault keeps every line it was given); a ticket taken on in the
            # Cockpit, the Kiosk's own step already ("in progress since … by …")
            continue
        out.append({"id": x.id, "at": x.at.isoformat(), "note": status_words.moments(bare(x.words), d, "en"),
                    "stage": x.stage, **({"ats": list(x.ats)} if x.ats else {})})
    return out


def as_head(x: Line, zone: str) -> dict:
    """Line `x` as a heading keeps it (layout.head's history): its id, its moment in the villa's time and its words —
    drawn when shown (layout.status_shown), never stored as text."""
    ats = [_local(m, zone).isoformat() for m in _listed(x)]
    return {"id": x.id, "at": _local(x.at, zone).isoformat() if x.at else None, "words": x.words,
            **({"ats": ats} if len(ats) > 1 else {})}


# ------------------------------------------------------------------ which lines stay, which the bottom line says
_NO_STEP = STEPS["update"]


def observed(h: dict) -> bool:
    """Is history line `h` a line of a visit's story (Notices.observe) rather than a notice sent?"""
    return bool(h.get("fold"))


def listed(h: dict) -> bool:
    """Is history line `h` a notice whose line stays among the Status lines while its bottom line says where the alert
    stands (message_format.Step.listed: a stronger signal, its card's state "New alert")?"""
    return bool((STEPS.get(h.get("stage") or "") or _NO_STEP).listed)


def stays(h: dict, history: list[dict]) -> bool:
    """Does notice `h` keep its line among the Status lines while the bottom line says it too: a listed step (a
    stronger signal), and a visit's alert (`history`: its incident's, holding the visit's story lines).

    ⚠️ A VISIT'S ALERT IS ALWAYS ONE OF ITS LINES (owner, 2026-11-07, real visit #148): a visit whose first step was
    already its strongest never rang again, so its "Alert sent" was only its bottom line's and its Status never said
    when the villa sent it, while every drill's did (a stronger step had followed)."""
    return listed(h) or (h.get("stage") == "new" and any(observed(x) for x in history))


def _cut(history: list[dict], n: int) -> tuple[list[dict], set[int]]:
    """`history` without its last `n` NOTICES — the steps a copy's bottom line says — and the positions left out. A
    visit's story lines are kept wherever they stand: they are no notice, and every copy lists them (Notices.observe);
    a listed notice (a stronger signal) is one of the `n` and stays too."""
    gone: set[int] = set()
    counted = 0
    for i in range(len(history) - 1, -1, -1):
        if counted == n:
            break
        if not observed(history[i]):
            counted += 1
            if not stays(history[i], history):      # its line stays: the bottom line says where the alert stands instead
                gone.add(i)
    return [h for i, h in enumerate(history) if i not in gone], gone


#: A visit's card sent again for a step stronger than every one before it (message_format.STEPS "stronger").
STRONGER_STAGE = "stronger"
#: The alert's rule repeating a problem closed "Not a problem" while it lasts (message_format.STEPS "lasting").
LASTING_STAGE = "lasting"


def standing(history: list[dict]) -> int | None:
    """The position in `history` of its latest step that is no lasting repeat: where the alert stands (its close, while
    its problem repeats), None when there is none. ⚠️ A LASTING REPEAT LEAVES THE CLOSE WHERE IT STANDS (owner,
    2026-11-20, #201): its line comes after the close, which is still the card's bottom line, the one its watch's end
    words again and the one the villa's late all-clear says again."""
    return next((i for i in range(len(history) - 1, -1, -1) if history[i].get("stage") != LASTING_STAGE), None)


def resent_into(history: list[dict]) -> dict[int, int]:
    """{position of a "stronger" step: position of the visit's story line of the step that made it ring} — the step line
    begun latest at or before it (`since`, Notices.observe: a step's line carries the moment it began; a line of no
    moment of its own, the siren's or the photos', is no step). A stronger step with no such line keeps its own line.

    ⚠️ ONE LINE PER STEP (owner, 2026-11-07, drill #135): "Test door opened, 05:14" then "Stronger signal sent 07/11/2026
    05:14 (to: Owner & FM)" — the ring is said on its step's line, "…, 05:14: alert sent again (to: Owner & FM)". Read
    from the steps as recorded, so a visit open at the update reads so at once (rules/agent-code.md: format changes need
    migrations)."""
    out: dict[int, int] = {}
    for i, h in enumerate(history):
        if h.get("stage") != STRONGER_STAGE:
            continue
        at, best = moment(h.get("at")), None
        for j, x in enumerate(history):
            began = moment(x.get("since")) if observed(x) else None
            if began is not None and at is not None and began <= at and (best is None or began >= best[0]):
                best = (began, j)
        if best is not None:
            out[i] = best[1]
    return out
