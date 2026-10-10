"""Putting one message in one chat: its heading, its parts laid out, the send, and the copy recorded in its thread.

⚠️ ONE STEP FOR EVERY MESSAGE THE AGENT SENDS ON ITS OWN (architecture review 18, then 20). It was Outcome's private
`_post`, which the approvals reached through Outcome — and Outcome reached the approvals through a field patched in after
construction: built any other way, the siren's gate called None. Alerts (outcome.py), approval requests (approvals.py),
the siren's warning and a camera snapshot all go through here; both modules are handed this one.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Awaitable, Callable

from . import layout
from .notice import when
from .routing import Origin
from .telegram import CAPTION


class Poster:
    def __init__(self, *, send: Callable[..., Awaitable], thread=None, notices=None, timezone_name: str = "UTC"):
        self.send = send                # delivery.Delivery.send — the message id, or None when nothing arrived
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident or request
        self.notices = notices          # notice.Notices: the heading
        self.tz = timezone_name         # "{time}" in a message: the villa's time when it is sent

    async def post(self, chat: int, text: str, *, status: str = "", lead: str = "", roles=(), incident: int | None = None,
                   keyboard: dict | None = None, document: str | None = None, photo=None,
                   thread: int | str | None = None, plain: bool = False, origin: Origin | None = None,
                   stage: str | None = None) -> int | None:
        """The message in `chat`: its heading — who it is for (`roles`), the incident and its history — unless it answers
        the person who asked, in their chat, or is `plain`; its parts laid out (layout.py) to fit ONE Telegram message —
        a photo's or a file's caption included, so the copy recorded is the message sent; then its `thread` (an incident,
        an approval, a snapshot): the earlier copy in this chat goes. The message id, or None when nothing arrived."""
        # "{time}": the moment it says what happened, as every notice writes one (10/10/2026 15:04, the villa's time)
        now = when(datetime.now(timezone.utc), self.tz)
        text, status, lead = (x.replace("{time}", now) for x in (text, status or "", lead or ""))
        head = self.notices.heading(chat, incident, roles, stage) if self.notices and not plain and not (
            origin and origin.holds and chat == origin.chat) else ""
        p = layout.parts(body=text, status=status, head=head, lead=lead)
        # ⚠️ A CAPTION IS 1,024 CHARACTERS (architecture review 20): laid out for 4,096, a long incident's snapshot went as a
        # photo and a separate text — only the text was recorded, so the next snapshot left the old photo behind
        limit = CAPTION if (photo or document) else layout.TELEGRAM_LIMIT
        mid = await self.send(chat, layout.render(p, limit), keyboard=keyboard, document=document, photo=photo,
                              origin=origin)
        if mid and thread is not None and self.thread is not None:
            await self.thread.post(thread, chat, mid, {**p, "limit": limit}, buttons=bool(keyboard))
        return mid
