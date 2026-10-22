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

from vesta_shared.message_format import MARK_ICONS, acted, PRESSED_STAGE, ROLE_WORDS, STEPS, UNTITLED, audience
from vesta_shared.limits import limit
from vesta_shared.messaging import incident_tag
from vesta_shared.problems import again_days
from vesta_shared.timeutil import moment_label

from datetime import datetime, timezone
from typing import Callable

from . import layout


#: Between a step's line and the desk's words on the bottom line.
STEP_SEP = ", "
EXISTING = "existing"
def history_kept() -> int:
    """An incident's history kept: its first notice, a line counting those dropped, and the latest ones (review 28:
    after 20 notices the first alert vanished without a word)."""
    return limit("alerts.history_lines", 20, unit="lines", group="text", lo=4, hi=500,
                 says="Lines of an alert's story kept (sent, reminded, escalated…): the first always, then the latest.",
                 reached="The ones between are counted in a \"… N earlier notices\" line.", told="person")


def note_press(state, incident: int, label: str, name: str, mark: str | None = None, option: str = "") -> None:
    """A button pressed on incident `incident`'s alert, kept in its history (the Kiosk's card says it: Notices.story).
    Done is not kept: the fault's close says "Done on Telegram (…)." already."""
    if option == "done":
        return
    history = state.incident_history(incident)
    history.append({"at": datetime.now(timezone.utc).isoformat(), "stage": PRESSED_STAGE, "label": label,
                    "name": name, **({"mark": mark} if mark else {})})
    state.set_incident_history(incident, _kept(history))


def note_step(state, incident: int, stage: str, note: str) -> None:
    """A step of incident `incident` that is not a notice sent — someone took it on in the Kiosk ("taken") — kept in its
    history in its own words, so a later "Status:" still lists it (owner, 2026-10-15)."""
    history = state.incident_history(incident)
    history.append({"at": datetime.now(timezone.utc).isoformat(), "stage": stage, "note": note.rstrip(".")})
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


def _ordinal(n: int) -> str:
    """2nd, 3rd, 11th, 22nd."""
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def when(at: datetime, zone: str) -> str:
    """A moment as every notice says it: 09/10/2026 13:12, in the villa's time (timeutil.moment_label: one format)."""
    return moment_label(at, zone)


class Notices:
    def __init__(self, state, policy: Callable, timezone_name: str, severity: Callable[[int], str | None] | None = None,
                 closed: Callable[[int], bool] | None = None, runs: Callable[[int], int | None] | None = None,
                 reaches: Callable[[int], list[str] | None] | None = None):
        self.state, self.policy, self.tz = state, policy, timezone_name
        # how many times an incident alerted in AGAIN_DAYS, as its skill stored it (problems.incident_runs): a "back"
        # step's line says it ("- Back at … (2nd time in 7 days), alert sent to …")
        self.runs = runs or (lambda _iid: None)
        # an incident's priority (P1…P4) as its skill stored it: "P2 Incident: New #18" (owner, 2026-10-10)
        self.severity = severity or (lambda _iid: None)
        # whether an incident is closed as its skill stored it: its copies are headed "Closed" (architecture review 25)
        self.closed = closed or (lambda _iid: False)
        # whom an incident's priority reaches, as its skill carried it (incidents.Incidents.reaches): roles, or the
        # word for a priority that reaches nobody ("digest", "log"); None when the skill did not say (an older desk)
        self.reaches = reaches or (lambda _iid: None)

    @staticmethod
    def _wanted(to) -> set[str]:
        """The roles named by `to` (a role, or several), and nothing else."""
        return ({to} if isinstance(to, str) else set(to or ())) & set(ROLE_WORDS)

    def roles_for(self, chat: int, to=None) -> set[str]:
        """The roles a notice to `chat` is for: `to` (a role, or every role the copy went there for: outcome merges
        them), else the roles the chat is listed with — for a private chat listed with none, its person's role."""
        roles = self._wanted(to)
        if roles:
            return roles
        pol = self.policy()
        roles = pol.roles_in(chat)
        if not roles and int(chat) > 0 and pol.person(chat) is not None:
            roles = {pol.person(chat).role}
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
        history = history[:len(history) - before] if before else history
        who = self.to_line(int(incident), also, history) or audience(self.roles_for(chat, to), short=True) or "this chat"
        try:
            p = self.severity(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
            p = None
        word = self.word(int(incident), stage, bool(history))
        return layout.head(f"{incident_tag(incident)}{f'-{p}' if p else ''}", who,
                           self.history_lines(int(incident), chat, before), word)

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
        lines = []
        history = self.state.incident_history(incident)
        # `latest_excluded`: the last steps recorded, left out — a copy refreshed with the notice just sent, whose own
        # bottom line already says it (Outcome's refresh of the other chats)
        for h in history[:len(history) - latest_excluded] if latest_excluded else history:
            roles = self._roles(h) if h.get("chats") or h.get("to") else set()
            if mine and roles and not roles & mine:
                continue
            # ⚠️ ONE RUN, THEN THE NEXT (owner, 2026-10-16, #43): a second run starts at its "- Back at …" line, which
            # says how many times it came (message_format.STEPS: one line, the shape of every other step)
            lines.append(f"- … {h['dropped']} earlier notice{'s' if h['dropped'] > 1 else ''}" if h.get("dropped") else
                         f"- {h['note']}" if h.get("note") else
                         f"- {self._pressed(h, when(datetime.fromisoformat(h['at']), self.tz))}" if h.get("stage") == PRESSED_STAGE else
                         f"- {self.step(h.get('stage'), self._roles(h), datetime.fromisoformat(h['at']), h.get('run'), h.get('reach'))}")
        return lines

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

    def _who(self, roles, reach=None, incident: int | None = None) -> str:
        """Whom a step went to, as its line says it: its roles ("FM"), else what its incident's priority does instead
        (`reach`, the line's own record of it; or read from `incident`: "digest"), else "nobody"."""
        return audience(roles, short=True) or self._reach_words(reach if reach is not None else
                                                                (self._reach(incident) if incident else None)) or "nobody"

    def step(self, stage: str | None, roles, at: datetime, run: int | None = None, reach=None) -> str:
        """A step as a card's "Status:" says it — what was sent, when, to whom: "Reminder sent 16/10/2026 18:20 to FM",
        "Back at 16/10/2026 18:03 (2nd time in 7 days), alert sent to FM" (`run`: the how-many-th time; an older record
        has none; `reach`: the words for a step to no role, as recorded). The ONE wording of a step, in its history
        line and on its own bottom line (`bottom`)."""
        s = STEPS.get(stage or "")
        times = f", {_ordinal(run)} time in {again_days()} days" if isinstance(run, int) and run > 1 else ""
        return (s.line if s else "{sent} {at} (to: {who})").format(
            sent=s.sent if s else "Sent", at=when(at, self.tz), times=times, who=self._who(roles, reach))

    def bottom(self, stage: str | None, roles, status: str, at: datetime | None = None,
               incident: int | None = None) -> str:
        """The bottom line of a notice of `stage` sent now to `roles`: a timed step (message_format.STEPS) says itself
        first, then the skill's words (`status`); any other notice's status as it is. `incident`: whose — a step to no
        role says what its priority does instead ("(to: digest)")."""
        if stage not in STEPS or not STEPS[stage].timed:
            return status
        who = self._who(roles, incident=incident)
        line = self.step(stage, roles, at or datetime.now(timezone.utc), reach=[who])
        if not status:
            return line
        # the skill's words go BEFORE whom, so this line ends "(to: …)" like every other (owner, 2026-10-18, #41)
        to = f" (to: {who})"
        return f"{line.removesuffix(to)}{STEP_SEP}{status}{to}" if line.endswith(to) else f"{line}{STEP_SEP}{status}"

    @staticmethod
    def _pressed(h: dict, at: str = "") -> str:
        """A press as every reader tells it: Telegram's Status "🆘 Need help on 16/10/2026 18:20 (Fabien)" (`at`), the
        Kiosk card, whose line has its own time, "🆘 Need help (Fabien)" — message_format.acted's order."""
        what = f"{MARK_ICONS.get(h.get('mark') or '', '')} {h.get('label')}".strip()
        return acted(what, at, h.get("name") or "") if at else f"{what} ({h.get('name')})"

    def story(self, incident: int) -> list[dict]:
        """What a fault's card in the Kiosk tells of incident `incident`'s Telegram life, oldest first: [{at, note}] —
        "Reminder sent to Facility Manager", "🆘 Need help (Fabien)" — its time is the step's own (the Kiosk
        writes it). ⚠️ ONE STORY (architecture review, 2026-10-14): the card is told from the history Telegram's
        "Status:" is written from, never by a second writer."""
        out = []
        for h in self.state.incident_history(incident):
            if h.get("stage") in STEPS and STEPS[h["stage"]].noted:
                who = audience(self._roles(h)) or self._reach_words(h.get("reach")) or "nobody"
                out.append({"at": h["at"], "note": f"{STEPS[h['stage']].sent} (to: {who})"})
            elif h.get("stage") == PRESSED_STAGE:
                out.append({"at": h["at"], "note": self._pressed(h)})
        return out

    def word(self, incident: int, stage: str | None = None, history: bool = True) -> str:
        """The title's word for a notice about `incident`: what the notice is (`stage`) — else what the incident is
        (closed: "closed") — else "existing" once anything was sent about it, "new" before."""
        if stage:
            return STEPS[stage].title if stage in STEPS else EXISTING
        try:
            if self.closed(int(incident)):
                return "closed"
        except Exception:  # noqa: BLE001 — the heading is written without it, never not at all
            pass
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
        return {**h, "word": self.word(int(incident), None, bool(history)),
                "to": self.to_line(int(incident), history=history) or h["to"]}

    def record(self, incident: int, stage: str | None, sent: list[tuple[int, object]], at: datetime | None = None) -> None:
        """A notice about `incident` went to `sent` — (chat, the role or roles it was for) — one result's messages being one
        notice: its history line, each chat with the roles it was for. `stage` unset: "new" for the first, "update" after."""
        if stage == PRESSED_STAGE:
            # the answer to a press in its own chat: the press itself is the story's line (note_press) — recorded as
            # "Update sent", it told the same press as two events (architecture review, 2026-10-15)
            return
        history = self.state.incident_history(incident)
        reach = self._reach(int(incident))
        # the roles it was for — the chat's own only when the desk did not say whom the priority reaches: a step to
        # no role (a P3's own message, taken over) records what the priority does instead ("digest"), so no later
        # heading reads the chat's roles out of it (owner, 2026-10-17)
        chats = [[int(c), sorted(self.roles_for(c, to) if reach is None else self._wanted(to))] for c, to in sent]
        line = {"at": (at or datetime.now(timezone.utc)).isoformat(), "chats": chats,
                "stage": stage if stage in STEPS else ("update" if history else "new"),
                **({"reach": [w for w in reach if w not in ROLE_WORDS]} if reach is not None else {})}
        # the steps whose line counts the week (message_format.STEPS "{times}"): a return, and a new number of an alert
        # already seen this week — ONE count, problems.incident_runs
        if line["stage"] in ("back", "new"):
            try:
                run = self.runs(int(incident))
            except Exception:  # noqa: BLE001 — the line is written without its count, never not at all
                run = None
            if isinstance(run, int):
                line["run"] = run
        history.append(line)
        self.state.set_incident_history(incident, _kept(history))

    def _roles(self, h: dict) -> set[str]:
        """The roles a history line's notice went to, as recorded. A line recorded before 0.12.181 named people (`to`,
        or chats without their roles): their roles as the People list gives them now, a role's own word read back."""
        roles = {r for _chat, rs in h.get("chats") or [] for r in rs or ()}
        if roles or "reach" in h:              # recorded with its roles (or, knowingly, none): as recorded
            return roles & set(ROLE_WORDS)
        try:
            pol = self.policy()
            roles = {r for chat, _rs in h.get("chats") or [] for r in pol.roles_in(int(chat))}
            names = set(h.get("to") or [])
            roles |= {e.role for e in pol.entries if e.name in names}
        except Exception:  # noqa: BLE001 — a policy that cannot be read: the role words written then
            names = set(h.get("to") or [])
        words = {w.removeprefix("the ").lower(): r for r, w in ROLE_WORDS.items()}
        roles |= {words[n.removeprefix("the ").lower()] for n in names if n.removeprefix("the ").lower() in words}
        return roles & set(ROLE_WORDS)
