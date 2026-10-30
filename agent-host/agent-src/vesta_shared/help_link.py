"""Need help on a fault with no alert: the alert that stands for it, owned in one place.

⚠️ NEED HELP ON EVERY CARD (owner, 2026-10-30: "Done / Need Help / Open Ticket consistently for all of them"): a Need
help pressed in the Kiosk on a fault with no alert (a night-check finding, a person's ticket) reaches the owner as an
alert the desk opens already escalated, standing for that fault — its Done on Telegram closes the fault, the fault's
Done in the Cockpit closes the alert.

⚠️ ONE OWNER (architecture review, 2026-10-30 evening: "this alert stands for that fault" was spread over about 15
places — three store mailboxes, a key, seven Problems methods, desk.py checking the key by hand — and the wording slip
of the same review came from that spread). HelpLink is the link: `asked` (a press read from the Kiosk), `waiting` (the
presses the desk opens an alert for), `opened` (the key and notes of that alert), `standing` (the alert open for a
subject), `closed` (that alert over: its fault follows), `resolves` (the person tickets the engine resolves). The
mailboxes, the key's shape and the subjects' shape are this module's only.

A subject names the fault: `of_task(id)` (a fault of the agent's) or `of_ticket(uid)` (a person's ticket)."""
from __future__ import annotations

from . import kiosk_words
from .store import Notes, notes_of

# the store's mail: the Need helps waiting for the desk ({subject: …}), the last one read of each subject (its moment:
# one press told once), and the person tickets whose alert closed, for the engine to resolve ({ticket: …})
_ASKED, _TOLD, _RESOLVE = "kiosk-help-asked", "kiosk-help-told", "kiosk-help-resolve"
# the key of the alert standing for a subject: one open at a time per subject
_KEY = "kiosk_help|{subject}"


class HelpLink:
    """The alert standing for a fault's Need help. `problems`: the villa's Problems (its store, its tasks' sources and
    titles, and how a task closes)."""

    def __init__(self, problems):
        self.problems = problems
        self.store = problems.store

    @staticmethod
    def of_task(task_id: int) -> str:
        return f"task:{int(task_id)}"

    @staticmethod
    def of_ticket(uid: str) -> str:
        return f"kiosk:{uid}"

    @staticmethod
    def key(subject: str) -> str:
        """The incident key of the alert standing for `subject`."""
        return _KEY.format(subject=subject)

    def asked(self, subject: str, said, at: str, *, task: dict | None = None, title: str = "",
              entity_id: str = "") -> int | None:
        """A person pressed Need help on a fault's card in the VESTA Kiosk (`at`: when the Kiosk recorded it; `said`:
        kiosk_words.helped): the owner is asked to act. `task`: the agent's fault's task (None for a person's ticket,
        `title` and `entity_id` its own). Told once per press. An alert's fault, or one an alert already stands for:
        mail to the alert desk (Notes.KIOSK_HELP), which escalates it as a Telegram Need help does — returns that
        incident's id. Any other: waiting for the desk to open one already escalated (`waiting`) — returns None."""
        told = self.store.cache_get(_TOLD) or {}
        if not at or (told.get(subject) or "") >= at:
            return None
        self.store.cache_put(_TOLD, {**told, subject: at})
        kind, sid = self.problems._source(task)
        iid = sid if kind == "incident" and sid else self.standing(subject)
        inc = self.store.incident(iid) if iid else None
        if inc and not inc.get("closed_at"):
            self.store.note(iid, {Notes.KIOSK_HELP: kiosk_words.stored(said)})
            return iid
        if kind == "incident":
            return None                                   # its alert is over: nothing to escalate
        waiting = self.store.cache_get(_ASKED) or {}
        self.store.cache_put(_ASKED, {**waiting, subject: {
            "said": kiosk_words.stored(said), "at": at, "title": title or self.problems.current_title(task or {}),
            "entity_id": entity_id or (task or {}).get("entity_id") or "", "rule_id": (task or {}).get("rule_id") or ""}})
        return None

    def waiting(self) -> dict[str, dict]:
        """The Need helps waiting for the desk ({subject: {said, at, title, entity_id, rule_id}}), taken: read once.
        One an alert already stands for is left out: the desk opens one alert per subject."""
        waiting = self.store.cache_get(_ASKED) or {}
        if waiting:
            self.store.cache_put(_ASKED, {})
        return {s: h for s, h in waiting.items() if not self.standing(s)}

    def opened(self, subject: str, title: str) -> tuple[str, dict]:
        """The incident key and the notes of the alert the desk opens for `subject` (its message `title`)."""
        return self.key(subject), {Notes.MESSAGE: title, Notes.HELP_OF: subject}

    def standing(self, subject: str) -> int | None:
        """The open alert standing for `subject`'s Need help, if any."""
        row = self.store.find_open_incident(self.key(subject))
        return int(row["id"]) if row else None

    def closed(self, iid: int, note: str, who: str | None) -> list[int]:
        """Alert `iid` closed: when it stands for a fault, that fault closes with it — a task as a person's Done, a
        person's ticket left for the engine to resolve (`resolves`). The tasks moved ([0]: a ticket's, the engine's
        repair resolves it); [] when it stands for nothing."""
        subject = str(notes_of(self.store.incident(iid)).get(Notes.HELP_OF) or "")
        kind, _, ref = subject.partition(":")
        if kind == "task" and ref.isdigit():
            task = self.store.task(int(ref))
            if task and task.get("status") == "open":
                from .problems import DONE
                self.problems.close(int(ref), DONE, note, who)
                return [int(ref)]
        elif kind == "kiosk" and ref:
            waiting = self.store.cache_get(_RESOLVE) or {}
            self.store.cache_put(_RESOLVE, {**waiting, ref: {"note": note, "who": who}})
            return [0]
        return []

    def resolves(self) -> dict[str, dict]:
        """The person tickets whose Need help alert closed ({ticket id: {note, who}}), taken: the engine resolves them."""
        waiting = self.store.cache_get(_RESOLVE) or {}
        if waiting:
            self.store.cache_put(_RESOLVE, {})
        return waiting
