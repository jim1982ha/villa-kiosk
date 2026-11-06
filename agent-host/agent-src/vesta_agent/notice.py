"""A message the agent sends on its own — an alert, its reminder or escalation, a night check's finding, a report —
and the one heading every such message carries (owner, 2026-10-11, the order and shape the owner drew):

    #9-P1 (existing)                          ← in bold (vesta_shared.message_format: the one shape and style)
    To: Owner & FM
    <the alert>                               ← as a quote
    (empty line)
    Status:
    - Alert sent 09/10/2026 13:12 to Owner & FM                   ← a quote, in italics
    - Closing note sent 09/10/2026 13:20 to Owner & FM
    - Back at 09/10/2026 15:02 (2nd time in 7 days), alert sent to Owner & FM   ← a new run of the same alert
    ⚠️ ⚙️ Reminder sent 09/10/2026 15:17 to FM — No answer after 15 min    ← this step: what, when, to whom, why

A message about no incident is headed the same way, by its title (owner, 2026-10-12: one layout):

    Approval request
    To: Owner

"To" names the ROLES a message is for (message_format.audience: "Owner", "Facility Manager", "Owner & Facility
Manager") — never a person's name (owner, 2026-10-13: "To: Fabien, JM" became "To: Facility Manager"). An incident's
"To:" FOLLOWS ITS PRIORITY (owner, 2026-10-17): the roles the priority reaches, as the alert desk carried them on the
incident (store.Notes.TO, `reaches`), widened by every role a step went to (an escalation); a priority that reaches
nobody says what it does instead, in the desk's words ("To: digest", "To: log") — never the roles of the chat the
villa's rule posted in (a P3's own message in the owner's group read "To: Owner"). A message about no incident is for
its role (`to`), else the roles its chat is listed with. The title says "new" for an incident's first notice, "closed"
for the one that ends it, "existing" otherwise; then one line per earlier notice — what, when, to whom — whatever chat
it went to (each chat keeps only an incident's latest message: incident_thread.py). A reply to a person in a chat
carries none: it answers them.

⚠️ ONE PLACE (owner, 2026-10-10: "coded in the simplest possible way, DRY"). The incident's line was written by the
skill ("Incident #9 · Still there…"), its earlier messages by the thread ("Earlier messages: …") and nothing at all
named who a message was for. The skill now writes only what happened; this writes the rest, for every skill.
"""
from __future__ import annotations

from vesta_shared.message_format import (MARK_ICONS, ON_PLACE, ON_TELEGRAM, PRESSED_STAGE, ROLE_WORDS, STEPS, UNTITLED,
                                         audience, folds)
from vesta_shared import status_words
from vesta_shared.limits import limit
from vesta_shared.messaging import incident_tag
from vesta_shared.problems import again_days
from vesta_shared.timeutil import moment_label

from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Callable

from . import layout


#: The steps that are notes, not notices sent (note_step): a ticket someone took on in the Kiosk (app.py) — the Kiosk's
#: card says it already, as its own step — and an alert's close once its watch is over (incident_thread.py).
TAKEN_STAGE = "taken"
CLEARED_STAGE = "cleared"
#: The step of a close (message_format.STEPS "closed"): told by its bottom line while it stands (Notices.history_lines)
CLOSED_STEP = "closed"
#: The step a Need help makes (message_format.STEPS "escalated"): its line says the press (Notices.history_lines)
ESCALATED_STAGE = "escalated"
#: A line of a visit's story (owner, 2026-11-06: one visit, one story): what was seen, in the desk's words, kept under
#: its `fold` key — the same key again is the same line said anew (Notices.observe), never a notice sent
SEEN_STAGE = "seen"
#: Between a step's line and the desk's words on the bottom line.
STEP_SEP = ", "
EXISTING = "existing"
def history_kept() -> int:
    """An incident's history kept: its first notice, a line counting those dropped, and the latest ones (review 28:
    after 20 notices the first alert vanished without a word)."""
    return limit("alerts.history_lines", 20, unit="lines", group="text", lo=4, hi=500,
                 says="Lines of an alert's story kept (sent, reminded, escalated…): the first always, then the latest.",
                 reached="The ones between are counted in a \"… N earlier notices\" line.", told="person")


def note_press(state, incident: int, label: str, name: str, mark: str | None = None, closes: bool = False,
               labels: dict | None = None, place: str = ON_TELEGRAM, told: bool = False) -> None:
    """A button pressed on incident `incident`'s alert, kept in its history (the Kiosk's card says it: Notices.story).
    A button that closes the alert (skill.yaml `closes`: Done, Not a problem) is not kept: its close says "Done on
    Telegram (…)." already. One whose answer says the press (`told`: skill.yaml `tells` — Need help's "🆘 Need help on …
    (Luc): Owner is asked to act.") is kept, its line left to that answer while it is the copy's last word
    (history_lines; architecture review 23, card 4: Need help was said twice until someone acted). `labels`: the button's label in other languages (skill.yaml `labels`), so each chat's Status
    names the press in its own (owner, 2026-10-23). `place`: where it was pressed (message_format ON_TELEGRAM, ON_TABLET),
    as the Kiosk card's story says it — architecture review 21: a press on the tablet read "on Telegram" there.

    ⚠️ EVERY CLOSING BUTTON, NOT DONE BY NAME (owner, 2026-11-05, #118): Not a problem, added beside Done, was kept —
    its card read "- Not a problem on 05/11/2026 00:19 (Jm)" above "✅ Not a problem on 05/11/2026 00:19 (Jm). Watch 1h.".
    """
    if closes:
        return
    history = state.incident_history(incident)
    history.append({"at": datetime.now(timezone.utc).isoformat(), "stage": PRESSED_STAGE, "label": label,
                    "name": name, **({"mark": mark} if mark else {}), **({"labels": dict(labels)} if labels else {}),
                    **({"told": True} if told else {}),
                    **({"place": place} if place != ON_TELEGRAM else {})})
    state.set_incident_history(incident, _kept(history))


def close_step(state, incident: int, note: str, note_in: dict | None = None) -> None:
    """Incident `incident` closed with `note` (who closed it, where, when; `note_in`: its other languages): its closing
    step in its history, in the close's own words — every close, however it was made.

    ⚠️ A CLOSE KEEPS ITS OWN LINE (architecture review 22, card 6): it had one only when a closing message happened to be
    sent ("- Closing note sent 00:29 (to: FM)", the confirmation's time, not the close's), none at all for "Not a
    problem" in the Cockpit, and never who closed it; an alert back within its watch then told its close three ways.
    A closing step standing already is its close: a closing message's ("Closing note sent", no words) takes these words;
    one with words, or the close's end (CLEARED), stays."""
    history = state.incident_history(incident)
    if history and (history[-1].get("stage") == CLEARED_STAGE
                    or (history[-1].get("stage") == CLOSED_STEP and history[-1].get("note"))):
        return
    if history and history[-1].get("stage") == CLOSED_STEP:
        history.pop()
        state.set_incident_history(incident, history)
    note_step(state, incident, CLOSED_STEP, note, note_in)


def note_step(state, incident: int, stage: str, note: str, note_in: dict | None = None) -> None:
    """A step of incident `incident` that is not a notice sent — someone took it on in the Kiosk ("taken"), its close
    once its watch is over ("cleared") — kept in its history in its own words, so a later "Status:" still lists it
    (owner, 2026-10-15). `note_in`: the same words in other languages ({code: text}), each chat's line in its own."""
    history = state.incident_history(incident)
    langs = {k: str(v).rstrip(".") for k, v in (note_in or {}).items() if isinstance(v, str) and v}
    step = {"at": datetime.now(timezone.utc).isoformat(), "stage": stage, "note": note.rstrip("."),
            **({"note_in": langs} if langs else {})}
    if stage == CLEARED_STAGE and history and history[-1].get("stage") == CLOSED_STEP:
        # ⚠️ ONE LINE PER CLOSE (owner, 2026-11-05, #118): "- Closing note sent 00:19 (to: Owner & FM)" stood above
        # "- Cleared on … Watch 1h", one close told twice. The close's own words take its closing step's place, told in
        # every chat as the close was (its copy in each said it)
        history[-1] = step
    else:
        history.append(step)
    state.set_incident_history(incident, _kept(history))


def _kept(history: list[dict]) -> list[dict]:
    """The history with its first notice always kept and the dropped ones counted ("- … 3 earlier notices")."""
    most = history_kept()
    if len(history) <= most:
        return history
    first, rest = history[0], history[1:]
    dropped = sum(h.get("dropped", 1) if h.get("dropped") else 0 for h in rest)
    rest = [h for h in rest if not h.get("dropped")]
    cut = len(rest) - (most - 2)
    return [first, {"dropped": dropped + cut}] + rest[cut:]


def _same_step(last: dict, line: dict) -> bool:
    """Is `line` the step `last` again, right after it — the same kind (message_format.folds), sent the same way (to
    the same reach)? Then it is ONE line, counted (`times`), at its latest moment."""
    return (folds(line.get("stage")) and last.get("stage") == line.get("stage") and not last.get("note")
            and last.get("reach") == line.get("reach"))


def _merged(last: dict, line: dict) -> dict:
    """`last` and `line`, the same step again, as ONE: the latest moment, every chat it went to, how many times
    (`times`), and the moments it was (`ats`, the newest kept: the Kiosk fault's lines of the earlier ones, which it
    replaces, kiosk.noted)."""
    chats = {int(c): set(r or ()) for c, r in last.get("chats") or []}
    for c, r in line.get("chats") or []:
        chats.setdefault(int(c), set()).update(r or ())
    ats = (last.get("ats") or [last["at"]]) + (line.get("ats") or [line["at"]])
    return {**last, **line, "chats": [[c, sorted(r)] for c, r in chats.items()],
            "times": last.get("times", 1) + line.get("times", 1), "ats": ats[-history_kept():]}


def fold(history: list[dict]) -> tuple[list[dict], list[int]]:
    """`history` with every step repeated in a row as ONE line (_same_step): what an engine before 0.6.447 recorded as
    a line per repeat (#125-P1: three "Still-there alert sent 06/11/2026 18:35 (to: Owner & FM)"), as record writes it
    now — and, for each step of `history`, the line that holds it."""
    out: list[dict] = []
    held: list[int] = []
    for h in history:
        if out and h.get("stage") and _same_step(out[-1], h):
            out[-1] = _merged(out[-1], h)
        else:
            out.append(h)
        held.append(len(out) - 1)
    return out, held


_NO_STEP = STEPS["update"]


def observed(h: dict) -> bool:
    """Is history line `h` a line of a visit's story (Notices.observe) rather than a notice sent?"""
    return bool(h.get("fold"))


def listed(h: dict) -> bool:
    """Is history line `h` a notice whose line stays among the Status lines while its bottom line says where the alert
    stands (message_format.Step.listed: a stronger signal, its card's state "New alert")?"""
    return bool((STEPS.get(h.get("stage") or "") or _NO_STEP).listed)


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
            if not listed(history[i]):      # its line stays: the bottom line says where the alert stands instead
                gone.add(i)
    return [h for i, h in enumerate(history) if i not in gone], gone


def _in_time(history: list[dict], line: dict, at: str) -> list[dict]:
    """`history` with `line` placed in time order: after every step at or before `at`, before the first one later.
    ⚠️ IN TIME ORDER (owner's drill #129: "Seen at Test motion, 22:55–22:58 / Alert sent 22:57 / Test door opened,
    22:55"): VESTA taking over a visit late recorded its alert and its lines as it heard of them."""
    t = _moment(at)
    for i, h in enumerate(history):
        mine = _moment(h.get("since") or h.get("at"))
        if t is not None and mine is not None and mine > t:
            return history[:i] + [line] + history[i:]
    return history + [line]


def _moment(at) -> datetime | None:
    try:
        m = datetime.fromisoformat(str(at))
    except (TypeError, ValueError):
        return None
    return m if m.tzinfo else m.replace(tzinfo=timezone.utc)


def _fold_target(history: list[dict], line: dict) -> int | None:
    """Where story line `line` folds into: the line of its key, wherever it stands — "Seen at Parking → Entrance Left →
    … → Main House Door" stays ONE line across the lock's line and the card sent again between two cameras: one line per
    kind of step, said anew where it began. None: a new line."""
    return next((i for i in range(len(history) - 1, -1, -1) if history[i].get("fold") == line["fold"]), None)


#: A visit's card sent again for a step stronger than every one before it (message_format.STEPS "stronger").
STRONGER_STAGE = "stronger"


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
        at, best = _moment(h.get("at")), None
        for j, x in enumerate(history):
            began = _moment(x.get("since")) if observed(x) else None
            if began is not None and at is not None and began <= at and (best is None or began >= best[0]):
                best = (began, j)
        if best is not None:
            out[i] = best[1]
    return out


#: 2nd, 3rd, 11th: the English ordinal of "6th time in 7 days" (status_words writes every language's).
_ordinal = status_words._ordinal_en


def when(at: datetime, zone: str) -> str:
    """A moment as every notice says it: 09/10/2026 13:12, in the villa's time (timeutil.moment_label: one format)."""
    return moment_label(at, zone)


class Notices:
    def __init__(self, state, policy: Callable, timezone_name: str, name: Callable[[int], str] | None = None,
                 closed: Callable[[int], bool] | None = None, runs: Callable[[int], int | None] | None = None,
                 reaches: Callable[[int], list[str] | None] | None = None,
                 watching: Callable[[int], bool] | None = None, began: Callable[[int], str | None] | None = None,
                 monitored_until: Callable[[int], str | None] | None = None):
        self.state, self.policy, self.tz = state, policy, timezone_name
        # when an incident's current run began (incidents.Incidents.began): the day its card's strip shows, the day its
        # Status moments are written by (`day`)
        self.began = began or (lambda _iid: None)
        # until when an open visit is monitored (incidents.Incidents.monitored_until, ISO): its bottom line says it
        self.monitored_until = monitored_until or (lambda _iid: None)
        # whether a closed incident is still watched (incidents.Incidents.watching): its copies read "(watch)", then
        # "(closed)" once the desk said its watch is over (owner, 2026-10-25)
        self.watching = watching or (lambda _iid: False)
        # how many times an incident alerted in AGAIN_DAYS, as its skill stored it (problems.incident_runs): a "back"
        # step's line says it ("- Back at … (2nd time in 7 days), alert sent to …")
        self.runs = runs or (lambda _iid: None)
        # how the alert is named, with its priority (incidents.Incidents.name: "#18-P2", the one name everywhere —
        # owner, 2026-10-29); its number alone without it
        self.name = name or incident_tag
        # whether an incident is closed as its skill stored it: its copies are headed "Closed" (architecture review 25)
        self.closed = closed or (lambda _iid: False)
        # whom an incident's priority reaches, as its skill carried it (incidents.Incidents.reaches): roles, or the
        # word for a priority that reaches nobody ("digest", "log"); None when the skill did not say (an older desk)
        self.reaches = reaches or (lambda _iid: None)

    def lang(self, chat: int) -> str:
        """The language chat `chat` reads its alert cards' Status in (a code of status_words): its row's in the People
        list — a chat listed for several roles, its first row's (one language per copy); English for no chat, a chat
        the list does not name, or a list that cannot be read.

        ⚠️ EACH CHAT ITS OWN LANGUAGE (owner, 2026-10-23): the facility manager reading French and the one reading
        German each got "Reminder sent … (to: FM)" in English, under the villa's own words."""
        if not chat:
            return "en"
        try:
            return status_words.lang_of(self.policy().roster.language_of(int(chat), None))
        except Exception:  # noqa: BLE001 — the card is written in English, never not at all
            return "en"

    @staticmethod
    def _wanted(to) -> set[str]:
        """The roles named by `to` (a role, or several), and nothing else."""
        return ({to} if isinstance(to, str) else set(to or ())) & set(ROLE_WORDS)

    def roles_for(self, chat: int, to=None) -> set[str]:
        """The roles a notice to `chat` is for: `to` (a role, or every role the copy went there for: outcome merges
        them), else the roles whose messages go to the chat (Roster.delivered_roles: the villa's lists) —
        for a private chat that gets none, its person's role."""
        roles = self._wanted(to)
        if roles:
            return roles
        pol = self.policy()
        roles = pol.roster.delivered_roles(chat)
        if not roles and int(chat) > 0 and pol.roster.person(chat) is not None:
            roles = {pol.roster.person(chat).role}
        return roles & set(ROLE_WORDS)

    def _reach(self, incident: int) -> list[str] | None:
        """Whom incident `incident`'s priority reaches, as the desk carried it; None when it did not say."""
        try:
            return self.reaches(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written as before, never not at all
            return None

    @staticmethod
    def _reach_words(reach) -> str:
        """What a priority that reaches no role does instead, in the desk's words ("digest", "log"): the "To:" of an
        alert nobody is sent, and the "(to: …)" of its steps."""
        return ", ".join(w for w in reach or () if w not in ROLE_WORDS)

    def went_to(self, incident: int, chat: int, told=(), going=()) -> set[str]:
        """The roles a villa message of `incident` taken over in `chat` (a rule's own alert) is about — the desk's own
        step of this result (`told`), else the roles its priority reaches, else this result's other roles (`going`),
        else those the incident went to so far. The chat's own roles ONLY when the desk did not say whom the priority
        reaches (an older desk): "To:" follows the priority, never the chat the rule posts in (owner, 2026-10-17)."""
        reach = self._reach(incident)
        roles = self._wanted(told) or (self._wanted(reach) if reach is not None else set()) or self._wanted(going) \
            or self.roles_of(incident)
        return roles or (self.roles_for(chat) if reach is None else set())

    def audiences(self, pairs, incident_of) -> tuple[dict, dict, dict]:
        """Who each of one result's notices is for, from its deliveries (routing.Routing.deliveries: (chat, message,
        roles)): ({incident: the roles its "To:" names — the same in every chat}, {(incident, stage): the roles this
        step went to — its bottom line says them}, {id(message): a report's roles}). `incident_of(message)`: its
        incident, or None. Pure of Telegram (architecture review scan 2, 2026-10-19: worked out inside Outcome's
        sending loop, where four "To:" fixes in three days each had to be made).

        A "Need help" escalates to the owner while the presser's own chat gets the answer: only the first is the
        step's. ⚠️ A COPY FOR NO ROLE WIDENS NOTHING (owner, 2026-10-17: "To:" follows the priority): an answer in its
        own chat is about the incident the roles its priority reaches already had — the group's own roles made a P2
        read "To: Owner & FM"."""
        going: dict[int, set[str]] = {}
        told: dict[tuple[int, str | None], set[str]] = {}
        sent_to: dict[int, set[str]] = {}
        for chat, item, roles in pairs:
            to = self.roles_for(chat, roles)
            iid = incident_of(item)
            if iid and not roles:
                reach = self._reach(int(iid))
                to = self.roles_of(int(iid)) or (self._wanted(reach) if reach is not None else to)
            if iid:
                going.setdefault(int(iid), set()).update(to)
                told.setdefault((int(iid), item.get("stage")), set()).update(to)
            else:
                sent_to.setdefault(id(item), set()).update(to)
        return going, told, sent_to

    def roles_of(self, incident: int) -> set[str]:
        """The roles incident `incident`'s notices went to so far, as its history recorded them."""
        return {r for h in self.state.incident_history(incident) for r in self._roles(h)}

    def heading(self, chat: int, incident: int | None = None, to=None, stage: str | None = None,
                also=None, title: str | None = None, before: int = 0) -> str:
        """The heading of a notice to `chat` (about `incident`), as it stands before this notice is recorded — as facts
        (layout.head), which the layout places (layout.py: the title and "To …:" on top, the history under "Status:"):

            #9-P2 (existing)            the incident, its priority, and "new" / "existing" / "closed" (`stage`)
            To: Owner & FM                                    who this message is for
            - Alert sent 11/10/2026 09:57 to FM               one line per earlier notice
            - Escalation sent 11/10/2026 10:27 to Owner

        "To:" names every role the incident went to — every earlier notice's, and `also` (roles), this notice's — the
        same line in every chat (owner, 2026-10-11: one incident, one picture). A message about no incident: its `title`
        (UNTITLED when it has none), and "To:" the roles of `also`, else the chat's of `to`.

        `before`: the heading as it stood before the incident's last `before` steps were recorded — a copy refreshed in
        another chat with the notice just sent, whose own bottom line already says them.

        ⚠️ THE ONE HEADING OF A CHAT'S COPY (architecture review "One answer per question" #2, 2026-10-19): the first
        copy, the villa's own alert taken over, a replaced status AND every other chat's refresh are headed here. The
        refresh had its own path (rehead: the sent copy's heading re-parsed, its lines swapped), and showed the newest
        step twice until the last test of 0.12.251 caught it."""
        if incident is None:
            return layout.head(title or UNTITLED, audience(set(also or ()) or self.roles_for(chat, to)) or "this chat")
        history = self.state.incident_history(incident)
        if not before and history and _same_step(history[-1], {"stage": stage, **self._reach_field(int(incident))}):
            # the step this notice is folds into the last one (record): its bottom line says it, never the line above too
            before = 1
        history = _cut(history, before)[0] if before else history
        who = self.to_line(int(incident), also, history) or audience(self.roles_for(chat, to), short=True) or "this chat"
        try:
            label = self.name(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
            label = incident_tag(incident)
        word = self.word(int(incident), stage, bool(history))
        return layout.head(label, who,
                           self.history_lines(int(incident), chat, before), word, self.lang(chat),
                           story=self.history_lines(int(incident), 0, before), day=self.day(int(incident)),
                           until=self.until(int(incident)))

    def until(self, incident: int) -> str | None:
        """Until when open visit `incident` is monitored, as a moment is written in the villa's time ("07/11/2026
        06:40"; layout.status_shown shortens it by the alert's day); None for any other incident."""
        try:
            t = _moment(self.monitored_until(int(incident)) or "")
        except Exception:  # noqa: BLE001 — the line is written without it, never not at all
            return None
        return moment_label(t, self.tz) if t else None

    def day(self, incident: int) -> str | None:
        """Incident `incident`'s own day in the villa's time (ISO): when its current run began (`began`), the day its
        card's strip shows — else its first step's; None when neither says. Its Status moments are written by it
        (layout.status_shown: "05:14" that day, "08/11 09:20" another)."""
        try:
            at = self.began(int(incident))
        except Exception:  # noqa: BLE001 — read from its first step instead
            at = None
        steps = self.state.incident_history(incident) if at is None else []
        at = at or next((h["at"] for h in steps if h.get("at")), None)
        t = _moment(at) if at else None
        return t.astimezone(ZoneInfo(self.tz)).date().isoformat() if t else None

    def to_line(self, incident: int, also=(), history: list[dict] | None = None) -> str | None:
        """The "To:" of every copy of `incident` — the SAME in every chat: every role the incident went to (its
        `history`, as recorded; `also`: the roles of the notice being sent) and the roles its priority reaches
        (`reaches`). ⚠️ "TO:" FOLLOWS THE PRIORITY (owner, 2026-10-17): a priority nobody is sent says what it does
        instead, in the desk's words ("digest", "log") — never the roles of the chat the villa's rule posted in. None
        when nothing says (an older desk that did not carry it, and no step yet): the caller's own fallback."""
        history = self.state.incident_history(incident) if history is None else history
        everyone = {r for h in history for r in self._roles(h)} | set(also or ())
        reach = self._reach(incident)
        if reach is None:
            return audience(everyone, short=True) or None
        return audience(everyone | self._wanted(reach), short=True) or self._reach_words(reach) or "nobody"

    def history_lines(self, incident: int, chat: int = 0, latest_excluded: int = 0) -> list[str]:
        """Incident `incident`'s "Status:" lines as chat `chat` sees them: the steps sent to one of its roles, and what
        was sent to nobody in particular (a button pressed, a note) — every step for a chat that has no role (0: any).

        ⚠️ EACH CHAT ITS OWN STEPS (owner, 2026-10-18, #55): the owner's group listed "Reminder sent … (to: FM)" and a
        still-there to the FM, and the facility manager's chat the still-theres sent to the owner alone. "To:" still
        names everyone the alert involves; the lines are the ones sent to this chat's people."""
        mine = self._chat_roles(chat)
        lang = self.lang(chat)                 # drawn from the stored steps in the chat's language at every redraw
        lines = []
        history = self.state.incident_history(incident)
        # `latest_excluded`: the last steps recorded, left out — a copy refreshed with the notice just sent, whose own
        # bottom line already says it (Outcome's refresh of the other chats)
        gone = _cut(history, latest_excluded)[1] if latest_excluded else set()
        # ⚠️ A CLOSE STANDING IS ITS BOTTOM LINE (owner, 2026-11-05, #118): redrawn while closed, the card listed
        # "- Closing note sent 00:19" above "✅ Not a problem on 00:19 (Jm). Watch 1h." — the same close. Its step shows
        # once something came after it (it came back), or as the close's own words once its watch is over (note_step)
        kept = [i for i in range(len(history)) if i not in gone]
        if kept and history[kept[-1]].get("stage") == CLOSED_STEP and self.closed_now(incident):
            gone.add(kept[-1])
        into = {i: j for i, j in resent_into(history).items() if j not in gone}
        resent: dict[int, set[str]] = {}                # a step's line: the roles its card was sent again to
        for i, j in into.items():
            roles = self._roles(history[i])
            if not (mine and roles and not roles & mine):
                resent.setdefault(j, set()).update(roles)
        for i, h in enumerate(history):
            if i in gone or i in into:
                continue
            roles = self._roles(h) if h.get("chats") or h.get("to") else set()
            if mine and roles and not roles & mine:
                continue
            if i in resent:
                lines.append(f"- {status_words.resent(self._line(h, lang), self._who(resent[i], lang=lang), lang)}")
                continue
            # ⚠️ ONE LINE PER PRESS (architecture review 23, card 4): a press whose answer says it (skill.yaml `tells`:
            # "🆘 Need help on … (Luc): Owner is asked to act.") is that answer while nothing but the escalation it made
            # came after it — its own line once something did
            if h.get("stage") == PRESSED_STAGE and h.get("told") and \
                    all(x.get("stage") == ESCALATED_STAGE for x in history[i + 1:]):
                continue
            # ⚠️ ONE RUN, THEN THE NEXT (owner, 2026-10-16, #43): a second run starts at its "- Back at …" line, which
            # says how many times it came (message_format.STEPS: one line, the shape of every other step)
            # a step is kept as facts (stage, moment, roles, count) and worded by `_line`, the Kiosk's card's writer too
            lines.append(f"- {self._line(h, lang)}")
        return lines

    def closed_now(self, incident: int) -> bool:
        """Is incident `incident` closed now (False when that cannot be read)?"""
        try:
            return bool(self.closed(int(incident)))
        except Exception:  # noqa: BLE001 — not knowable: every step listed, as before
            return False

    def story_of(self, incident: int, chat: int, shown) -> tuple[int, list[str]] | None:
        """A copy of `incident` in `chat` that showed the Status lines `shown` (its own steps), told for everyone: (how
        many of the newest steps it left to its bottom line, every step before them, whoever it went to) — None when no
        count draws its lines again (a copy drawn by an older wording)."""
        for n in range(len(self.state.incident_history(incident)) + 1):
            if self.history_lines(incident, chat, n) == list(shown):
                return n, self.history_lines(incident, 0, n)
        return None

    def refold(self, incident: int) -> dict[int, str]:
        """Incident `incident`'s history recorded a line per repeat (an engine before 0.6.447: #125-P1's three
        "Still-there alert sent … 18:35"): folded as record writes it now (`fold`), and the heading each chat's copy
        shows then — its lines drawn again, the steps its bottom line says still left to it — {chat: heading}; {} when
        nothing repeated. A copy no count draws again (story_of: an older wording) keeps its heading to its next step.

        ⚠️ FORMAT CHANGES NEED MIGRATIONS (rules/agent-code.md): the alerts open at the update read one line per problem at
        once, on Telegram and the tablet, never only from their next step on."""
        old = self.state.incident_history(incident)
        new, held = fold(old)
        if len(new) == len(old):
            return {}
        befores = {}
        for chat, rec in self.state.incident_chats(incident):
            h = layout.head_of((rec.get("parts") or {}).get("head"))
            found = self.story_of(incident, chat, h["history"]) if h and "history" in h else None
            if found is not None:
                befores[int(chat)] = found[0]
        self.state.set_incident_history(incident, new)
        # a copy that left its newest `n` notices to its bottom line leaves the lines holding them (a repeat its bottom
        # line says: the whole line, counted, is said there)
        def left(n: int) -> int:
            first = min(_cut(old, n)[1]) if n else len(old)
            return sum(1 for h in new[held[first]:] if not observed(h)) if first < len(old) else 0
        return {chat: self.heading(chat, int(incident), before=left(n)) for chat, n in befores.items()}

    def observe(self, incident: int, lines: list[dict]) -> dict[int, str]:
        """A visit's story lines (result.seen: {key, note, note_in?, at?}) in incident `incident`'s history — a key it
        holds already is THAT line said anew (`_fold_target`, the one fold: `_merged`), a new key a new line — and the
        heading each chat's copy shows then, its bottom line's notices still left to it: {chat: heading}.

        ⚠️ ONE VISIT, ONE STORY (owner, 2026-11-06, #125-P1): four cameras, a lock and the living room in two minutes were
        a "Still-there alert sent" line each, and a second alert for the lock. Each kind of step is now one line,
        updated in place in every copy, on the tablet and in the Kiosk fault's story (`story`)."""
        history = self.state.incident_history(incident)
        befores = {}
        for chat, rec in self.state.incident_chats(incident):
            h = layout.head_of((rec.get("parts") or {}).get("head"))
            found = self.story_of(incident, chat, h["history"]) if h and "history" in h else None
            befores[int(chat)] = found[0] if found is not None else 0
        now = datetime.now(timezone.utc).isoformat()
        for ln in lines:
            line = {"at": str(ln.get("at") or now), "stage": SEEN_STAGE, "fold": str(ln["key"]),
                    "note": str(ln["note"]).rstrip("."),
                    "note_in": {k: str(v).rstrip(".") for k, v in (ln.get("note_in") or {}).items() if isinstance(v, str)},
                    **({"since": str(ln["since"])} if ln.get("since") else {})}
            i = _fold_target(history, line)
            if i is None:
                # a step of the visit where it began among the others; a line of no moment of its own after them
                history = _in_time(history, line, line["since"]) if line.get("since") else history + [line]
            elif history[i].get("note") != line["note"] or history[i].get("note_in") != line["note_in"]:
                history[i] = _merged(history[i], line)
        self.state.set_incident_history(incident, _kept(history))
        return {chat: self.heading(chat, int(incident), before=n) for chat, n in befores.items()}

    def concerns(self, chat: int, roles) -> bool:
        """Is a step sent to `roles` one of chat `chat`'s — a role of the chat's among them (a chat with no role, or a
        step to nobody in particular: yes)? A step that is not leaves the chat's copy as it is (each chat its own steps)."""
        mine, roles = self._chat_roles(chat), set(roles or ())
        return not mine or not roles or bool(mine & roles)

    def _chat_roles(self, chat: int) -> set[str]:
        """The roles chat `chat` is listed with (roles_for); none for no chat, or when the People list cannot be read —
        then every step shows there, as before each chat had its own."""
        if not chat:
            return set()
        try:
            return self.roles_for(chat)
        except Exception:  # noqa: BLE001
            return set()

    def _who(self, roles, reach=None, incident: int | None = None, lang: str = "en") -> str:
        """Whom a step went to, as its line says it: its roles ("FM"), else what its incident's priority does instead
        (`reach`, the line's own record of it; or read from `incident`: "digest" — the desk's word, as it wrote it),
        else "nobody" (in `lang`)."""
        return status_words.who(roles, lang) or self._reach_words(
            reach if reach is not None else (self._reach(incident) if incident else None)) or status_words.nobody(lang)

    def step(self, stage: str | None, roles, at: datetime, run: int | None = None, reach=None, lang: str = "en",
             repeated: int | None = None) -> str:
        """A step as a card's "Status:" says it — what was sent, when, to whom: "Reminder sent 16/10/2026 18:20 (to: FM)",
        "Back at 16/10/2026 18:03, 2nd time in 7 days (to: FM)" (`run`: the how-many-th time; an older record has none;
        `reach`: the words for a step to no role, as recorded), in the chat's language (`lang`: status_words). The ONE
        wording of a step, in its history line and on its own bottom line (`bottom`). `repeated`: how many times it
        came in a row ("…18:35, 3 times (to: Owner & FM)": record folds a repeat into its line)."""
        return status_words.step(stage, when(at, self.tz), status_words.times(run, again_days(), lang),
                                 self._who(roles, reach, lang=lang), lang, repeated)

    def bottom(self, stage: str | None, roles, status: str, at: datetime | None = None,
               incident: int | None = None, lang: str = "en") -> str:
        """The bottom line of a notice of `stage` sent now to `roles`: a timed step (message_format.STEPS) says itself
        first, then the skill's words (`status`, already in `lang`); any other notice's status as it is. `incident`:
        whose — a step to no role says what its priority does instead ("(to: digest)")."""
        if stage not in STEPS or not STEPS[stage].timed:
            return status
        who = self._who(roles, incident=incident, lang=lang)
        line = self.step(stage, roles, at or datetime.now(timezone.utc), reach=[who], lang=lang)
        if not status:
            return line
        # the skill's words go BEFORE whom, so this line ends "(to: …)" like every other (owner, 2026-10-18, #41)
        to, sep = status_words.to_tail(who, lang), (STEP_SEP if lang == "en" else status_words.sep(lang))
        return f"{line.removesuffix(to)}{sep}{status}{to}" if line.endswith(to) else f"{line}{sep}{status}"

    def restatus(self, chat: int, p: dict) -> dict:
        """A copy's parts with its bottom line drawn again for chat `chat`, in the chat's language, from the step it
        was drawn from (`said`: Poster.post and Outcome.adopt_ha keep it; a close's note and its languages,
        IncidentThread.close) — the copy another chat gets of it (IncidentThread.sync). A status kept without it
        (recorded before, or replaced since) stays as it is."""
        s = p.get("said")
        if not isinstance(s, dict) or (s.get("stage") and not s.get("at")):
            return p
        lang = self.lang(chat)
        try:
            words = status_words.pick(s.get("status") or "", s.get("status_in"), lang)
            at = datetime.fromisoformat(s["at"]) if s.get("at") else None     # a note (a close) has no step to time
            return {**p, "status": self.bottom(s.get("stage"), s.get("roles") or (), words, at, s.get("incident"), lang)}
        except (TypeError, ValueError):
            return p

    @staticmethod
    def _pressed(h: dict, at: str = "", lang: str = "en") -> str:
        """A press as every reader tells it: Telegram's Status "🆘 Need help on 16/10/2026 18:20 (Fabien)" (`at`), in
        the chat's language when the button has a label in it (`labels`; else the whole line in English, never half),
        the Kiosk card, whose line has its own time, "🆘 Need help on Telegram (Fabien)" — message_format.acted's order.
        The card names where it was pressed: its own buttons keep the Kiosk's words (decisions of "One inbox")."""
        label = (h.get("labels") or {}).get(lang) if lang != "en" else None
        lang = lang if label else "en"
        what = f"{MARK_ICONS.get(h.get('mark') or '', '')} {label or h.get('label')}".strip()
        # a press kept before its place was (0.12.453): on Telegram, the only place then recorded
        where = ON_PLACE.get(h.get("place") or ON_TELEGRAM, ON_PLACE[ON_TELEGRAM])
        return status_words.acted(what, at, h.get("name") or "", lang) if at else f"{what} {where} ({h.get('name')})"

    def story(self, incident: int) -> list[dict]:
        """What a fault's card in the Kiosk tells of incident `incident`'s Telegram life, oldest first: [{at, note,
        stage}] — "Alert sent (to: Facility Manager)", "🆘 Need help on Telegram (Fabien)" — every line Telegram's
        "Status:" shows (ticket 19 of "One inbox", owner 2026-10-28: it told reminders, escalations and presses only),
        each without its time: the Kiosk says the step's own. ⚠️ ONE STORY (architecture review, 2026-10-14): told by
        `_line`, the writer of Telegram's lines, never by a second writer."""
        out = []
        history = self.state.incident_history(incident)
        into = resent_into(history)
        resent: dict[int, set[str]] = {}
        for i, j in into.items():
            resent.setdefault(j, set()).update(self._roles(history[i]))
        for i, h in enumerate(history):
            note = None if i in into else self._line(h, kiosk=True)
            if note and i in resent:
                # its card sent again for it, on its own line, as Telegram's Status says it (resent_into)
                note = status_words.resent(note, audience(resent[i]) or "nobody")
            if note:
                # a step repeated in a row: its line, counted, in place of the fault's lines of each time (`ats`, kiosk.noted)
                out.append({"at": h["at"], "note": note, "stage": h.get("stage"),
                            **({"ats": list(h["ats"])} if h.get("ats") else {})})
        return out

    def _line(self, h: dict, lang: str = "en", kiosk: bool = False) -> str | None:
        """One step of an incident's history as its story tells it: on Telegram (a "Status:" line, with its moment, in
        the chat's language), or on the Kiosk's card (`kiosk`: English, no moment — the card says the step's own; a
        press says it was on Telegram). None for what the card does not tell: the "… N earlier notices" count (no
        moment; the card keeps every line it was given), and a ticket taken on in the Cockpit — the Kiosk's own step."""
        if h.get("dropped"):
            return None if kiosk else status_words.earlier(h["dropped"], lang)
        if h.get("note"):
            # someone took it on in the Kiosk, its close once its watch is over: kept as written (note_step)
            return None if kiosk and h.get("stage") == TAKEN_STAGE else (h.get("note_in") or {}).get(lang) or h["note"]
        if h.get("stage") == PRESSED_STAGE:
            return self._pressed(h, "" if kiosk else when(datetime.fromisoformat(h["at"]), self.tz), lang)
        if kiosk:
            # the step and whom, in the words of its Telegram line ("Reminder sent (to: Facility Manager)")
            sent = STEPS[h["stage"]].sent if h.get("stage") in STEPS else "Sent"
            whom = audience(self._roles(h)) or self._reach_words(h.get("reach")) or "nobody"
            return f"{sent}{status_words.repeats(h.get('times'))} (to: {whom})"
        return self.step(h.get("stage"), self._roles(h), datetime.fromisoformat(h["at"]), h.get("run"), h.get("reach"), lang,
                         h.get("times"))

    def word(self, incident: int, stage: str | None = None, history: bool = True) -> str:
        """The title's word for a notice about `incident`: what the notice is (`stage`) — else what the incident is
        (closed: "watch" while it is watched, then "closed") — else "existing" once anything was sent about it, "new" before."""
        if stage and (STEPS[stage].title if stage in STEPS else EXISTING) != "closed":
            return STEPS[stage].title if stage in STEPS else EXISTING
        try:
            # a closing step says what every other copy says: "(watch)" while it is watched (owner, 2026-10-25)
            if stage or self.closed(int(incident)):
                return "watch" if self.watching(int(incident)) else "closed"
        except Exception:  # noqa: BLE001 — the heading is written without it, never not at all
            pass
        if history:
            # ⚠️ A VISIT UNANSWERED IS STILL A NEW ALERT (owner's drills, 2026-11-06: the tablet's card read "Still open"
            # under a visit's quiet step): its card is redrawn at every step, and where it stands is its last notice's
            # — its alert, or a stronger signal that sent it again — until a reminder or an answer says more
            steps = self.state.incident_history(int(incident)) if str(incident).isdigit() else []
            if any(h.get("fold") for h in steps):
                last = next((h for h in reversed(steps) if not h.get("fold") and h.get("stage")), None)
                if last and (last["stage"] == "new" or (STEPS.get(last["stage"]) or _NO_STEP).listed):
                    return "new"
        return EXISTING if history else "new"

    def retitle(self, incident, head, chat: int = 0):
        """A copy's heading — its own history lines kept (each chat its own steps) — with the title word and the "To:"
        as the incident stands NOW: the word from `word` (closed since: "closed" in every copy — architecture review
        25, the owner's earlier copy kept "New #9" under "Cleared in Home Assistant on …"; open again since, a fault
        reopened in the Cockpit: "existing" — both ways), the "To:" from `to_line`. The ONE place that says it
        (architecture review, 2026-10-19: the owner's group kept "(closed)" above "Done on … (Wayan)." while the
        facility manager's copy of the same alert read "(existing)")."""
        h = layout.head_of(head)
        if not str(incident).isdigit() or not h:
            return head
        if not h["word"]:
            # ⚠️ A COPY SENT BEFORE 0.12.152 ("For: Jim, P2 Incident: Follow Up #9") gets the new heading whole the
            # first time it changes (review 28: settled, it kept the old look with the new icons, the other chats the new)
            return self.heading(chat, int(incident))
        history = self.state.incident_history(incident)
        # until when it is monitored as it stands NOW: moved at each step, gone once it closed
        kept = {k: v for k, v in h.items() if k != "until"}
        return {**kept, "word": self.word(int(incident), None, bool(history)),
                "to": self.to_line(int(incident), history=history) or h["to"], **({"day": d} if (d := self.day(int(incident))) else {}),
                **({"until": u} if (u := self.until(int(incident))) else {})}

    def record(self, incident: int, stage: str | None, sent: list[tuple[int, object]], at: datetime | None = None) -> int:
        """A notice about `incident` went to `sent` — (chat, the role or roles it was for) — one result's messages being one
        notice: its history line, each chat with the roles it was for. `stage` unset: "new" for the first, "update" after.
        Returns how many steps it recorded (0 or 1): the ONE answer to "what did this result add" (Outcome's `before`)."""
        if stage == PRESSED_STAGE:
            # the answer to a press in its own chat: the press itself is the story's line (note_press) — recorded as
            # "Update sent", it told the same press as two events (architecture review, 2026-10-15)
            return 0
        history = self.state.incident_history(incident)
        if stage == CLOSED_STEP and self._closed_again(history):
            # ⚠️ ONE CLOSE, ONE STEP (owner, 2026-11-05, #118): the villa's own all-clear at 00:27 of an alert closed with
            # "Not a problem" at 00:19 was a second "Closing note sent" — the same close, its message taken over
            return 0
        reach = self._reach(int(incident))
        # the roles it was for — the chat's own only when the desk did not say whom the priority reaches: a step to
        # no role (a P3's own message, taken over) records what the priority does instead ("digest"), so no later
        # heading reads the chat's roles out of it (owner, 2026-10-17)
        chats = [[int(c), sorted(self.roles_for(c, to) if reach is None else self._wanted(to))] for c, to in sent]
        line = {"at": (at or datetime.now(timezone.utc)).isoformat(), "chats": chats,
                "stage": stage if stage in STEPS else ("update" if history else "new"), **self._reach_field(reach=reach)}
        # the steps whose line counts the week (message_format.STEPS "{times}"): a return, and a new number of an alert
        # already seen this week — ONE count, problems.incident_runs
        if line["stage"] in ("back", "new"):
            try:
                run = self.runs(int(incident))
            except Exception:  # noqa: BLE001 — the line is written without its count, never not at all
                run = None
            if isinstance(run, int):
                line["run"] = run
        if history and _same_step(history[-1], line):
            # ⚠️ ONE LINE PER PROBLEM (owner, 2026-11-06, #125-P1): the same step again, right after itself — four
            # cameras' "opened" events of one run — is that line counted at its latest moment, never a line per repeat.
            # Still this result's step (1): the other chats' copies leave it to the bottom line that says it now
            history[-1] = _merged(history[-1], line)
        elif at is not None:
            history = _in_time(history, line, line["at"])        # a step dated by the desk: where it happened
        else:
            history.append(line)
        self.state.set_incident_history(incident, _kept(history))
        return 1

    def _reach_field(self, incident: int | None = None, reach=None) -> dict:
        """What a step records of what its incident's priority does instead of a role (`reach`, or read from
        `incident`): {"reach": [words]}, or nothing when the desk did not say — the ONE shape record and heading compare."""
        reach = self._reach(incident) if incident is not None else reach
        return {"reach": [w for w in reach if w not in ROLE_WORDS]} if reach is not None else {}

    @staticmethod
    def _closed_again(history: list[dict]) -> bool:
        """The incident's last step is its close already: nothing happened since (no return, no reopening)."""
        return bool(history) and history[-1].get("stage") in (CLOSED_STEP, CLEARED_STAGE)

    def _roles(self, h: dict) -> set[str]:
        """The roles a history line's notice went to, as recorded. A line recorded before 0.12.181 named people (`to`,
        or chats without their roles): their roles as the People list gives them now, a role's own word read back."""
        roles = {r for _chat, rs in h.get("chats") or [] for r in rs or ()}
        if roles or "reach" in h:              # recorded with its roles (or, knowingly, none): as recorded
            return roles & set(ROLE_WORDS)
        try:
            pol = self.policy()
            roles = {r for chat, _rs in h.get("chats") or [] for r in pol.roster.roles_in(int(chat))}
            names = set(h.get("to") or [])
            roles |= {e.role for e in pol.roster.entries if e.name in names}
        except Exception:  # noqa: BLE001 — a policy that cannot be read: the role words written then
            names = set(h.get("to") or [])
        words = {w.removeprefix("the ").lower(): r for r, w in ROLE_WORDS.items()}
        roles |= {words[n.removeprefix("the ").lower()] for n in names if n.removeprefix("the ").lower() in words}
        return roles & set(ROLE_WORDS)
