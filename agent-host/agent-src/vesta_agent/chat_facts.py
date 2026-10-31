"""What is happening for a chat beyond its conversation: what is being prepared for it now, and what reached it since
the AI last answered there. Told to the AI, as facts, with every message a person sends (app._converse).

⚠️ A REPORT PROMISED THAT HAD ALREADY COME (villa, 2026-10-23). At 14:40 the facility manager tapped "Daily digest" in
their private chat; the AI answered "on its way", the fm-daily job ran and sent the digest at 14:40 — the JOB sent it,
outside the conversation. At 14:50 the same person wrote again: the conversation resumed, its transcript held the AI's
own "on its way" and nothing of the digest, and the AI answered twice "the daily digest will arrive in this chat as soon
as it is ready" — no job was running, nothing came. Nothing told the AI what reaches a chat outside its conversation.
The owner's fix (2026-10-23): with EVERY message the engine says what is being prepared for this chat — or that nothing
is — and what reached it since the AI's last answer there. Never left to the AI's reading of its own transcript.

ONE ANSWER TO "WHAT IS HAPPENING FOR THIS CHAT" (owner, 2026-10-23: "scan any other potential applicable fix the same
way" — each thing below reaches a chat outside the conversation, and the AI talked, or could talk, about it wrongly):

  being prepared  in_progress.InProgress, read now: a report asked for here (when, by whom) whose result has not come,
                  or a scheduled run holding this chat
  since           what reached it since the AI last answered here, the latest `shown()` with a count of the rest:
                    a report asked for here, as it ended (ChatJobs: sent, could not be prepared, ended with nothing,
                    cut by a restart)
                    an alert's step sent here — read from the incident's history (notice.Notices.record), the one
                    record of where each step went, never written twice
                    a button pressed here: Done / Need help on an alert (alert_buttons.py), Create / Don't create on a
                    fault offered (fault_offers.py)
  told            the AI answered here: what it was told until the message it answered is behind it

Not here, because the AI already reads them live before every answer (app.before_answer): the approval requests,
waiting and decided (approvals.Approvals.now), and the villa's open alerts (the status skill's check). An "Investigate
this" press is a conversation turn of its own (the AI answers it); its "No" leaves nothing the AI said untrue.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from vesta_shared.limits import limit
from vesta_shared.message_format import STEPS
from vesta_shared.messaging import incident_tag

from .in_progress import CHAT_JOB, HELD, InProgress, Item
from .notice import when

#: How a report asked for in a chat ended, as its chat saw it (ChatJobs tells which).
SENT, NOT_PREPARED, NOTHING, CUT = "sent", "not prepared", "nothing", "cut"
#: The line the AI reads first, every time.
HEAD = "[This chat, checked just now; answer from this, never from memory]"
NONE_PREPARED = ("No report is being prepared for this chat now: never say one is on its way, unless you start it now "
                 "and its answer says so.")
SINCE = "Reached this chat outside this conversation since your last answer here:"


def shown() -> int:
    return limit("ai.chat_facts_shown", 5, unit="items", group="ai", lo=1, hi=50,
                 says="How many of those things, the latest first, the AI is told with a person's next message in "
                      "that chat.",
                 reached="The earlier ones are counted in an \"… N earlier\" line.", told="")


def kept() -> int:
    """At most this many items are kept per chat until the AI answers there (the latest)."""
    return limit("ai.chat_facts_kept", 20, unit="items", group="keep", lo=5, hi=500,
                 says="How many of the things that reached a chat since the AI last answered there (a report, an "
                      "alert, a button pressed) are kept for its next answer.",
                 reached="The oldest are dropped; the AI is told how many it does not see.", told="")


def _iso(at: datetime | None) -> str:
    return (at or datetime.now(timezone.utc)).isoformat()


class ChatFacts:
    def __init__(self, state, work: InProgress, timezone_name: str = "UTC",
                 closed: Callable[[int], bool] | None = None, name: Callable[[int], str] | None = None):
        self.state, self.work, self.tz = state, work, timezone_name
        self.name = name or incident_tag   # incidents.Incidents.name: "#9-P2", as every message names the alert
        self.closed = closed            # incidents.Incidents.closed: an alert listed is said closed since, if it is

    def _at(self, ts: float | str | datetime | None) -> str:
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        elif not isinstance(ts, datetime):
            ts = datetime.fromtimestamp(float(ts or 0), timezone.utc)
        return when(ts, self.tz)

    # ------------------------------------------------------------------ what reached a chat
    def _note(self, chat: int, said: str, at: datetime | None = None) -> None:
        rec = self.state.chat_facts(chat)
        items = (rec.get("items") or []) + [{"at": _iso(at), "said": said}]
        dropped = int(rec.get("dropped") or 0) + max(0, len(items) - kept())
        self.state.set_chat_facts(chat, {**rec, "items": items[-kept():], "dropped": dropped})

    def _asked(self, job: Item) -> str:
        return (f"the {job.name} report asked for here at {self._at(job.started)}"
                + (f" by {job.by}" if job.by else ""))

    def job_ended(self, job: Item, how: str, why: str | None = None, at: datetime | None = None) -> None:
        """A report asked for in `job.chat` ended as its chat saw it (`how`: SENT, NOT_PREPARED, NOTHING, CUT)."""
        if job.chat is None:
            return
        said = {SENT: "was sent here",
                NOT_PREPARED: f"could not be prepared ({why or 'no reason given'}); the chat was told",
                NOTHING: "ended without sending anything; the chat was told it could not be prepared",
                CUT: "was cut by a restart of the agent before it was sent; the chat was told to ask again"}[how]
        self._note(int(job.chat), f"{self._asked(job)} {said}.", at)

    def pressed(self, chat: int, button: str, on: str, by: str, then: str = "", at: datetime | None = None) -> None:
        """A `button` pressed in `chat` on `on` ("alert #12", "the fault offered here …") by `by`; `then`: what it did,
        when the button's name does not say it."""
        self._note(chat, f"{button} pressed on {on} by {by}" + (f": {then}" if then else "") + ".", at)

    def told(self, chat: int, at: datetime) -> None:
        """The AI answered in `chat` a message it was told the facts with at `at`: what reached the chat until then is
        behind it."""
        rec = self.state.chat_facts(chat)
        items = [i for i in rec.get("items") or [] if i["at"] > at.isoformat()]
        self.state.set_chat_facts(chat, {"told": at.isoformat(), "items": items, "dropped": 0})

    # ------------------------------------------------------------------ what the AI is told
    def now(self, chat: int) -> str:
        """What the AI reads before the person's message: what is being prepared here (or that nothing is), and what
        reached this chat since its last answer here."""
        chat = int(chat)
        lines = [f"{HEAD} {self._preparing(chat)}"]
        rec = self.state.chat_facts(chat)
        since = rec.get("told") or self.state.session(chat)[1]
        items = [i for i in rec.get("items") or [] if not since or i["at"] > since] + self._alert_steps(chat, since)
        items.sort(key=lambda i: i["at"])
        earlier = max(0, len(items) - shown()) + int(rec.get("dropped") or 0)
        if items:
            lines.append(SINCE)
            if earlier:
                lines.append(f"- … {earlier} earlier")
            lines += [f"- {self._at(i['at'])}: {i['said']}" for i in items[-shown():]]
        return "\n".join(lines)

    def _preparing(self, chat: int) -> str:
        """What is being prepared for this chat now: a report asked for here whose result has not come yet, or one
        that runs on schedule and sends here."""
        doing = []
        for it in sorted(self.work.in_chat(chat), key=lambda i: float(i.started or 0)):
            if it.kind == CHAT_JOB and not it.arrived:
                doing.append(self._asked(it))
            elif it.kind == HELD:
                doing.append(f"the {it.name} report, on schedule since {self._at(it.started)}")
        if not doing:
            return NONE_PREPARED
        return "Being prepared for this chat now: " + "; ".join(doing) + ". Its result comes here when it is ready."

    def _alert_steps(self, chat: int, since: str | None) -> list[dict]:
        """Each step of an alert sent to this chat since `since`, from its incident's history (notice.Notices.record)."""
        out = []
        for iid, history in self.state.incident_histories_since(since).items():
            for h in history:
                if (h.get("stage") not in STEPS or not h.get("at") or (since and h["at"] <= since)
                        or chat not in {int(c) for c, _roles in h.get("chats") or []}):
                    continue
                said = f"alert {self.name(iid)}: {STEPS[h['stage']].sent} here"
                if self.closed:
                    try:
                        said += " (it is closed now)" if self.closed(iid) else ""
                    except Exception:  # noqa: BLE001 — said without it, never not at all
                        pass
                out.append({"at": h["at"], "said": said + "."})
        return out
