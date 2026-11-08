"""Does a step of an alert ring in a chat? The one answer Telegram's message and the tablet's pop-up both read.

  decide(incident, stage, mark, editable)   a message of a step: RING_NEW, EDIT_QUIET or SEND_SILENT
  PICTURE                                   a copy given its picture again (a text message sent as a photo): no news
  Rang.question(incident, chat)             a visit's siren question on its card: rings once per result and chat
  Rang.shown(incident, chat)                where this result just put the card (sent, or the villa's taken over)

⚠️ ONE DECISION (architecture review of 2026-11-09, card 1): "ring or not" was answered in six places (the step's
table, the poster, the tablet's quiet, the thread's re-sends, the sheet's re-send, the siren's question with a `rang` set
threaded through three modules) — a person's Need help needed its own fix, an escalation re-sent once came out as text.

⚠️ RING ONLY FOR WHAT CHANGES THE PICTURE (owner, 2026-11-08, visit #154): the first alert, its return, a stronger step,
the one reminder and a person's Need help ring (message_format.rings, the step's table); the siren's question rings
once. Every other step is told quietly: its copy edited in place where the chat holds one, else sent without a sound.
"""
from __future__ import annotations

from vesta_shared.message_format import rings

#: A new message, with its sound; on the tablet, its pop-up
RING_NEW = "ring_new"
#: The chat's copy edited in place, no sound — sent without a sound when the chat holds no live copy to edit
EDIT_QUIET = "edit_quiet"
#: A new message without a sound (a copy that cannot be an edit: a file, a reply)
SEND_SILENT = "send_silent"
#: A copy given the visit's picture again, sent as a photo (Telegram gives no text message a picture): no news
PICTURE = SEND_SILENT


def decide(incident: int | str | None, stage: str | None = None, mark: str | None = None,
           editable: bool = True) -> str:
    """How a message of incident `incident`'s step `stage` (`mark`: its press, "help") goes in a chat: RING_NEW for a
    step that rings — and for a message about no incident, which is no step —, else EDIT_QUIET where its copy there can
    be edited (`editable`: the incident's own card, no file, no reply), else SEND_SILENT."""
    if incident is None or rings(stage, mark):
        return RING_NEW
    return EDIT_QUIET if editable else SEND_SILENT


class Rang:
    """Where one script result just put an incident's card: {(incident, chat)}. A visit's siren question asked by the
    same result rings only where it did not (owner, 2026-11-08, #154: the card, then the question, then the reminder
    each rang)."""

    def __init__(self):
        self.rang: set[tuple[int, int]] = set()

    def shown(self, incident: int | str, chat: int) -> None:
        """This result put incident `incident`'s card in `chat` (Outcome.carry_out: sent, or the villa's taken over)."""
        self.rang.add((int(incident), int(chat)))

    def question(self, incident: int | str, chat: int) -> str:
        """A visit's siren question put on its card in `chat`: RING_NEW (the card sent again with it), EDIT_QUIET where
        this result just rang that card."""
        return EDIT_QUIET if (int(incident), int(chat)) in self.rang else RING_NEW
