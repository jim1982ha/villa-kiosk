"""Putting one message in one chat: its heading, its parts laid out, the send, and the copy recorded in its thread.

⚠️ ONE STEP FOR EVERY MESSAGE THE AGENT SENDS ON ITS OWN (architecture review 18, then 20). It was Outcome's private
`_post`, which the approvals reached through Outcome — and Outcome reached the approvals through a field patched in after
construction: built any other way, the siren's gate called None. Alerts (outcome.py), approval requests (approvals.py),
the siren's warning and a camera snapshot all go through here; both modules are handed this one.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable

from vesta_shared.message_format import UNTITLED, audience, fill_to, pages
from vesta_shared.status_words import pick

from . import kiosk_messages, layout
from .routing import Origin
from vesta_shared.messaging import telegram_caption_chars, telegram_message_chars

log = logging.getLogger("vesta")


def laid_out(make: Callable[[], object], plain):
    """What `make` lays out, or `plain` — the same words, unstyled — when laying it out raised.

    ⚠️ THE LAYOUT NEVER BLOCKS A MESSAGE (owner, 2026-10-23): a title, "To:" and sections are how a message looks, never
    whether it goes; a fault in them must not leave a chat without its words."""
    try:
        return make()
    except Exception:  # noqa: BLE001 — whatever the layout raised, the words still go
        log.exception("A message's layout failed: it goes as plain text")
        return plain


class Poster:
    def __init__(self, *, send: Callable[..., Awaitable], thread=None, notices=None, timezone_name: str = "UTC",
                 edit: Callable[..., Awaitable] | None = None, translations=None, mirror: Callable | None = None):
        self.send = send                # delivery.Delivery.send — the message id, or None when nothing arrived
        self.edit = edit                # delivery.Delivery.edit — a message already sent, rewritten (rewrite)
        self.thread = thread            # incident_thread.IncidentThread: what each chat shows of an incident or request
        self.notices = notices          # notice.Notices: the heading
        self.tz = timezone_name         # "{time}" in a message: the villa's time when it is sent
        # translation.Translations: an alert card's own words in the chat's language (owner, 2026-10-23); None: as written
        self.translations = translations
        # kiosk_messages.KioskMessages.keep (a record): a message sent on its own, kept for the tablet too (ticket 25 of
        # "One inbox"); None: not kept
        self.mirror = mirror

    async def post(self, chat: int, text: str, *, status: str = "", lead: str = "", roles=(), incident: int | None = None,
                   keyboard: dict | None = None, document: str | None = None, photo=None,
                   thread: int | str | None = None, plain: bool = False, origin: Origin | None = None,
                   stage: str | None = None, mark: str | None = None, also=None,
                   title: str | None = None, told=None, reply_to: int | None = None,
                   status_in: dict | None = None, keep: str | bool | None = None) -> int | None:
        """The message in `chat`: its heading — who it is for (`roles`), the incident and its history — unless it answers
        the person who asked, in their chat, or is `plain`; its parts laid out (layout.py) to fit ONE Telegram message —
        a photo's or a file's caption included, so the copy recorded is the message sent; then its `thread` (an incident,
        an approval, a snapshot): the earlier copy in this chat goes. `told`: the roles this step of the incident went to
        (its bottom line says them: notice.Notices.bottom). `status_in`: the skill's `status` in other languages
        ({code: text}) — an alert's copy says the one its chat reads. `keep`: a note sent on its own is also kept for the
        tablet (True; or the skill's own `key`, so a later rewrite replaces it there too) — a reply to a person is not.
        The message id, or None when nothing arrived."""
        # "{time}": the moment it says what happened, as every notice writes one (10/10/2026 15:04, the villa's time)
        now = datetime.now(timezone.utc)
        text, status, lead = (layout.fill_time(x, now, self.tz) for x in (text, status, lead))
        status_in = {k: layout.fill_time(v, now, self.tz) for k, v in (status_in or {}).items() if isinstance(v, str)}
        said = None
        # ⚠️ ONE LAYOUT (owner, 2026-10-12): every message sent on its own is headed by its title and "To:" — an alert's
        # "#9-P2 (new)", a report's, an approval's "Approval request"; the last resort UNTITLED (notice.heading) — and a
        # message given a title carries it in the asker's chat too. Only an answer to the person who asked, or a
        # `plain` one, has no heading. A report is titled as data (owner, 2026-10-11, review 28): the agent writes its
        # title and "To:" — every role it went to (`also`), the same in every chat — and cuts a long one into whole
        # messages "(1/2)", "(2/2)". A text a skill already wrote in the shape, with "To:" left for the agent, is filled.
        answering = bool(origin and origin.holds and chat == origin.chat)
        to = self.to_line(chat, roles, also) if incident is None else ""
        filled = fill_to(text, to) if incident is None and not plain else None
        head = None
        if filled is not None:
            text = filled
        elif incident is None and not plain and (title or (self.notices and not answering)):
            title = title or UNTITLED
            if not (status or lead or thread is not None):
                mid = await self._pages(chat, title, to, text, keyboard, document, photo, origin, reply_to)
                self._keep(keep, kiosk_messages.of_note(kiosk_messages.note_key(keep if isinstance(keep, str) else None, title, text),
                                                        title, to, text, keyboard=keyboard, photo=kiosk_messages.photo_b64(photo)))
                return mid
            head = layout.head(title, to or "this chat")
        elif incident is not None and self.notices and not plain and not answering:
            head = self.notices.heading(chat, incident, roles, stage, also)
            # its own step, when and to whom, on its bottom line: a quiet copy elsewhere never reads as of its own time
            # ⚠️ IN THE CHAT'S LANGUAGE, KEPT AS THE STEP (owner, 2026-10-23): the step and the skill's words are kept
            # (`said`), so the copy another chat gets of it (IncidentThread.sync) is drawn in that chat's language
            stepped = sorted(told or self.notices.roles_for(chat, roles))
            said = {"stage": stage, "roles": stepped, "at": now.isoformat(), "status": status,
                    **({"status_in": status_in} if status_in else {})}
            lang = self.notices.lang(chat) if hasattr(self.notices, "lang") else "en"
            status = self.notices.bottom(stage, stepped, pick(status, status_in, lang), now,
                                         **({"lang": lang} if lang != "en" else {}))
        p = layout.parts(body=text, status=status, head=head, lead=lead, mark=mark)
        if said:
            p["said"] = said
        # the alert's own words in the chat's language: known, the card goes translated; not yet, it goes as written and
        # is translated afterwards (`later`, once recorded) — never waited for (translation.py). The incident's own
        # card only: a snapshot's caption is the agent's
        want = None
        if self.translations is not None and said and str(thread) == str(incident):
            p, want = self.translations.apply(int(incident), chat, p)
        # ⚠️ A CAPTION IS 1,024 CHARACTERS (architecture review 20): laid out for 4,096, a long incident's snapshot went as a
        # photo and a separate text — only the text was recorded, so the next snapshot left the old photo behind
        limit = telegram_caption_chars() if (photo or document) else telegram_message_chars()
        shown = laid_out(lambda: layout.render(p, limit), "\n\n".join(x for x in (lead, text, status) if x))
        mid = await self.send(chat, shown, keyboard=keyboard, document=document, photo=photo,
                              origin=origin, **({"reply_to": reply_to} if reply_to else {}))
        if mid and thread is not None and self.thread is not None:
            await self.thread.post(thread, chat, mid, {**p, "limit": limit}, buttons=bool(keyboard), keyboard=keyboard,
                                   photo=photo)
            if want:
                self.translations.later(int(incident), chat, want)
        elif thread is not None:
            # ⚠️ THE TABLET TOO WHEN TELEGRAM DID NOT TAKE IT (off, or refused): the thread records only what arrived, and
            # the tablet is the second place precisely for when Telegram is not there (spec, "Without the internet")
            self._keep(True, kiosk_messages.of_parts(kiosk_messages.thread_key(thread), p, keyboard=keyboard, photo=kiosk_messages.photo_b64(photo)))
        elif keep:
            self._keep(keep, kiosk_messages.of_parts(
                kiosk_messages.note_key(keep if isinstance(keep, str) else None, str((p.get("head") or {}).get("title") or ""),
                                        text), p, keyboard=keyboard, photo=kiosk_messages.photo_b64(photo)))
        return mid

    def _keep(self, keep, record: dict) -> None:
        """`record` is also kept for the tablet (`mirror`), when `keep` asks for it."""
        if keep and self.mirror is not None:
            self.mirror(record)

    def to_line(self, chat: int, roles=(), also=None) -> str:
        """The "To:" of a message sent on its own in `chat` — post's, and rewrite's for the same message."""
        return audience(also or (self.notices.roles_for(chat, roles) if self.notices else ()))

    async def rewrite(self, chat: int, message_id: int, title: str, to: str, text: str, key: str | bool | None = None) -> bool:
        """A titled message already sent, rewritten in place in the same layout (owner, 2026-10-20: a P2 of the night
        check that clears is said on its own message, never a new one). Only a message that was ONE page and still is;
        False when it cannot be (two pages, Telegram off or refusing: an old or deleted message) — the caller says
        nothing more here: Outcome.rewrite decides the backup. `key`: the skill's own, under which the message was kept for
        the tablet: its record is replaced by these words whatever Telegram said."""
        if key:
            self._keep(True, kiosk_messages.of_note(
                kiosk_messages.note_key(key if isinstance(key, str) else None, title, text), title, to, text))
        docs = laid_out(lambda: pages(title, to, text, telegram_message_chars()), [text])
        if self.edit is None or len(docs) != 1:
            return False
        return bool(await self.edit(int(chat), int(message_id), docs[0]))

    async def _pages(self, chat, title, to, text, keyboard, document, photo, origin, reply_to=None) -> int | None:
        """A titled report, one message per page; its file, photo and buttons go with the last. The last id, or None
        when a page did not arrive."""
        limit = telegram_caption_chars() if (photo or document) else telegram_message_chars()
        docs = laid_out(lambda: pages(title, to, text, limit), [text])
        mid = None
        for i, doc in enumerate(docs):
            last = i == len(docs) - 1
            mid = await self.send(chat, doc, keyboard=keyboard if last else None, document=document if last else None,
                                  photo=photo if last else None, origin=origin,
                                  **({"reply_to": reply_to} if reply_to and i == 0 else {}))
            if not mid:
                return None
        return mid
