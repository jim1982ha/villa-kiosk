"""A message the agent sends on its own — an alert, its reminder or escalation, a night check's finding, a report —
and the one heading every such message carries (owner, 2026-10-11, the order and shape the owner drew):

    #9-P1 (existing)                          ← in bold (vesta_shared.message_format: the one shape and style)
    To: Owner & FM
    <the alert>                               ← as a quote
    (empty line)
    Status:
    - Alert sent 09/10/2026 13:12 to Owner & FM                   ← a quote, in italics
    - Closing note sent 09/10/2026 13:20 to Owner & FM
    — Came back 09/10/2026 15:02 (2nd time in 7 days) —            ← a new run of the same alert starts here
    - Came-back alert sent 09/10/2026 15:02 to Owner & FM
    ⚠️ ⚙️ Reminder sent 09/10/2026 15:17 to FM — No answer after 15 min    ← this step: what, when, to whom, why

A message about no incident is headed the same way, by its title (owner, 2026-10-12: one layout):

    Approval request
    To: Owner

"To" names the ROLES a message is for (message_format.audience: "Owner", "Facility Manager", "Owner & Facility
Manager") — the message's role (`to`: owner or fm), else the roles the chat is listed with; never a person's name
(owner, 2026-10-13: "To: Fabien, JM" became "To: Facility Manager"). The title says "new" for an incident's first notice, "closed" for the one that
ends it, "existing" otherwise; then one line per earlier notice — what, when, to whom — whatever chat it went to (each
chat keeps only an incident's latest message: incident_thread.py). A reply to a person in a chat carries none: it
answers them.

⚠️ ONE PLACE (owner, 2026-10-10: "coded in the simplest possible way, DRY"). The incident's line was written by the
skill ("Incident #9 · Still there…"), its earlier messages by the thread ("Earlier messages: …") and nothing at all
named who a message was for. The skill now writes only what happened; this writes the rest, for every skill.
"""
from __future__ import annotations

from vesta_shared.message_format import MARK_ICONS, PRESSED_STAGE, ROLE_WORDS, STEPS, UNTITLED, audience
from vesta_shared.messaging import incident_tag
from vesta_shared.problems import AGAIN_DAYS
from vesta_shared.timeutil import moment_label

from datetime import datetime, timezone
from typing import Callable

from . import layout


#: Between a step's line and the desk's words on the bottom line.
STEP_SEP = " — "
EXISTING = "existing"
#: An incident's history kept: its first notice, a line counting those dropped, and the latest ones (review 28: after
#: 20 notices the first alert vanished without a word).
HISTORY_KEPT = 20


def note_press(state, incident: int, label: str, name: str, mark: str | None = None, option: str = "") -> None:
    """A button pressed on incident `incident`'s alert, kept in its history (the Kiosk's card says it: Notices.story).
    Done is not kept: the fault's close says "Done by … on Telegram." already."""
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
    if len(history) <= HISTORY_KEPT:
        return history
    first, rest = history[0], history[1:]
    dropped = sum(h.get("dropped", 1) if h.get("dropped") else 0 for h in rest)
    rest = [h for h in rest if not h.get("dropped")]
    cut = len(rest) - (HISTORY_KEPT - 2)
    return [first, {"dropped": dropped + cut}] + rest[cut:]


def _ordinal(n: int) -> str:
    """2nd, 3rd, 11th, 22nd."""
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def when(at: datetime, zone: str) -> str:
    """A moment as every notice says it: 09/10/2026 13:12, in the villa's time (timeutil.moment_label: one format)."""
    return moment_label(at, zone)


class Notices:
    def __init__(self, state, policy: Callable, timezone_name: str, severity: Callable[[int], str | None] | None = None,
                 closed: Callable[[int], bool] | None = None, runs: Callable[[int], int | None] | None = None):
        self.state, self.policy, self.tz = state, policy, timezone_name
        # how many times an incident alerted in AGAIN_DAYS, as its skill stored it (problems.incident_runs): a came-back
        # step's divider says it ("— Came back … (2nd time in 7 days) —")
        self.runs = runs or (lambda _iid: None)
        # an incident's priority (P1…P4) as its skill stored it: "P2 Incident: New #18" (owner, 2026-10-10)
        self.severity = severity or (lambda _iid: None)
        # whether an incident is closed as its skill stored it: its copies are headed "Closed" (architecture review 25)
        self.closed = closed or (lambda _iid: False)

    def roles_for(self, chat: int, to=None) -> set[str]:
        """The roles a notice to `chat` is for: `to` (a role, or every role the copy went there for: outcome merges
        them), else the roles the chat is listed with — for a private chat listed with none, its person's role."""
        wanted = {to} if isinstance(to, str) else set(to or ())
        roles = wanted & set(ROLE_WORDS)
        if roles:
            return roles
        pol = self.policy()
        roles = pol.roles_in(chat)
        if not roles and int(chat) > 0 and pol.person(chat) is not None:
            roles = {pol.person(chat).role}
        return roles & set(ROLE_WORDS)

    def heading(self, chat: int, incident: int | None = None, to=None, stage: str | None = None,
                also=None, title: str | None = None) -> str:
        """The heading of a notice to `chat` (about `incident`), as it stands before this notice is recorded — as facts
        (layout.head), which the layout places (layout.py: the title and "To …:" on top, the history under "Status:"):

            #9-P2 (existing)            the incident, its priority, and "new" / "existing" / "closed" (`stage`)
            To: Owner & FM                                    who this message is for
            - Alert sent 11/10/2026 09:57 to FM               one line per earlier notice
            - Escalation sent 11/10/2026 10:27 to Owner

        "To:" names every role the incident went to — every earlier notice's, and `also` (roles), this notice's — the
        same line in every chat (owner, 2026-10-11: one incident, one picture). A message about no incident: its `title`
        (UNTITLED when it has none), and "To:" the roles of `also`, else the chat's of `to`."""
        if incident is None:
            return layout.head(title or UNTITLED, audience(set(also or ()) or self.roles_for(chat, to)) or "this chat")
        history = self.state.incident_history(incident)
        everyone = {r for h in history for r in self._roles(h)} | set(also or ())
        who = audience(everyone or self.roles_for(chat, to), short=True) or "this chat"
        try:
            p = self.severity(int(incident))
        except Exception:  # noqa: BLE001 — the heading is written without its priority, never not at all
            p = None
        word = self.word(int(incident), stage, bool(history))
        lines = []
        for h in history:
            if h.get("stage") == "back":
                # ⚠️ ONE RUN, THEN THE NEXT (owner, 2026-10-16, #43): a closing note, then a came-back alert, then a
                # reminder — two runs of the alert read as one story with nothing between them
                lines.append(self.divider(h))
            lines.append(f"- … {h['dropped']} earlier notice{'s' if h['dropped'] > 1 else ''}" if h.get("dropped") else
                         f"- {h['note']}" if h.get("note") else
                         f"- {self._pressed(h)} {when(datetime.fromisoformat(h['at']), self.tz)}" if h.get("stage") == PRESSED_STAGE else
                         f"- {self.step(h.get('stage'), self._roles(h), datetime.fromisoformat(h['at']))}")
        return layout.head(f"{incident_tag(incident)}{f'-{p}' if p else ''}", who, lines, word)

    def step(self, stage: str | None, roles, at: datetime) -> str:
        """A step as a card's "Status:" says it — what was sent, when, to whom: "Reminder sent 16/10/2026 18:20 to FM".
        The ONE wording of a step, in its history line and on its own bottom line (`bottom`)."""
        sent = STEPS[stage].sent if stage in STEPS else "Sent"
        return f"{sent} {when(at, self.tz)} to {audience(roles, short=True) or 'nobody'}"

    def bottom(self, stage: str | None, roles, status: str, at: datetime | None = None) -> str:
        """The bottom line of a notice of `stage` sent now to `roles`: a timed step (message_format.STEPS) says itself
        first, then the skill's words (`status`); any other notice's status as it is."""
        if stage not in STEPS or not STEPS[stage].timed:
            return status
        line = self.step(stage, roles, at or datetime.now(timezone.utc))
        return f"{line}{STEP_SEP}{status}" if status else line

    def divider(self, h: dict) -> str:
        """The line a came-back step's run starts under: "— Came back 16/10/2026 18:03 (2nd time in 7 days) —"."""
        run = h.get("run")
        times = f" ({_ordinal(run)} time in {AGAIN_DAYS} days)" if isinstance(run, int) and run > 1 else ""
        return f"— Came back {when(datetime.fromisoformat(h['at']), self.tz)}{times} —"

    @staticmethod
    def _pressed(h: dict) -> str:
        """A press as every reader tells it — Telegram's Status and the Kiosk card: "🆘 Need help pressed by Fabien"."""
        return f"{MARK_ICONS.get(h.get('mark') or '', '')} {h.get('label')} pressed by {h.get('name')}".strip()

    def story(self, incident: int) -> list[dict]:
        """What a fault's card in the Kiosk tells of incident `incident`'s Telegram life, oldest first: [{at, note}] —
        "Reminder sent to Facility Manager", "🆘 Need help pressed by Fabien" — its time is the step's own (the Kiosk
        writes it). ⚠️ ONE STORY (architecture review, 2026-10-14): the card is told from the history Telegram's
        "Status:" is written from, never by a second writer."""
        out = []
        for h in self.state.incident_history(incident):
            if h.get("stage") in STEPS and STEPS[h["stage"]].noted:
                out.append({"at": h["at"], "note": f"{STEPS[h['stage']].sent} to {audience(self._roles(h)) or 'nobody'}"})
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
        """A copy's heading as the incident stands now: an incident closed since is "closed" in every copy settled
        (architecture review 25: the owner's earlier copy kept "New #9" under "Cleared in Home Assistant on …")."""
        h = layout.head_of(head)
        if not str(incident).isdigit() or not h:
            return head
        if not h["word"]:
            # ⚠️ A COPY SENT BEFORE 0.12.152 ("For: Jim, P2 Incident: Follow Up #9") gets the new heading whole the
            # first time it changes (review 28: settled, it kept the old look with the new icons, the other chats the new)
            return self.heading(chat, int(incident))
        return {**h, "word": "closed"} if self._is_closed(int(incident)) else h

    def _is_closed(self, incident: int) -> bool:
        try:
            return bool(self.closed(incident))
        except Exception:  # noqa: BLE001
            return False

    def record(self, incident: int, stage: str | None, sent: list[tuple[int, object]], at: datetime | None = None) -> None:
        """A notice about `incident` went to `sent` — (chat, the role or roles it was for) — one result's messages being one
        notice: its history line, each chat with the roles it was for. `stage` unset: "new" for the first, "update" after."""
        if stage == PRESSED_STAGE:
            # the answer to a press in its own chat: the press itself is the story's line (note_press) — recorded as
            # "Update sent", it told the same press as two events (architecture review, 2026-10-15)
            return
        history = self.state.incident_history(incident)
        chats = [[int(c), sorted(self.roles_for(c, to))] for c, to in sent]
        line = {"at": (at or datetime.now(timezone.utc)).isoformat(), "chats": chats,
                "stage": stage if stage in STEPS else ("update" if history else "new")}
        if line["stage"] == "back":
            try:
                run = self.runs(int(incident))
            except Exception:  # noqa: BLE001 — the divider is drawn without its count, never not at all
                run = None
            if isinstance(run, int):
                line["run"] = run
        history.append(line)
        self.state.set_incident_history(incident, _kept(history))

    def _roles(self, h: dict) -> set[str]:
        """The roles a history line's notice went to, as recorded. A line recorded before 0.12.181 named people (`to`,
        or chats without their roles): their roles as the People list gives them now, a role's own word read back."""
        roles = {r for _chat, rs in h.get("chats") or [] for r in rs or ()}
        if roles:
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
