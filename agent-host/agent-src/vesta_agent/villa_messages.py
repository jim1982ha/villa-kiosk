"""The villa's own Telegram messages — a doorbell's photo, a camera's, the curfew's — in the language each chat reads.

    🔔 Visitor at Parking Doorbell            ← the villa's automation sends it at once, in English, in the VESTA layout
    To: Owner & FM                              (its own Telegram send: nothing waits on the agent)
    Someone is at the door.
    Status: ⚠️ New alert
                                             ← then fires vesta_message with the same words, in the same run
    🔔 Pengunjung di Bel Pintu Parkir         ← the agent draws that message again in the chat's language (People),
    …                                           from the translations kept (translation.Translations.lines), or once the
                                                AI has given them; any failure leaves the English

⚠️ NEVER BLOCK, ALWAYS FALL BACK (owner, 2026-10-24: "the villa keeps sending English instantly, and the Agent then
rewrites the message in the group's language. If the Agent is down, the English one stays"). The event only follows a
send that already happened; an alert of a VESTA rule (vesta_critical_event) is taken over by its incident instead
(outcome.Outcome.adopt_ha), so a message the agent already owns is left alone.

The event's data:
    message     the message as the villa sent it (its layout's text; tags and escapes are read through)
    buttons     the message's own buttons, as telegram_bot writes them ([["🔓 Unlock Gate", "/unlock_gate"]]) — kept by
                the edit, which would otherwise remove them
    messages    [{chat_id, message_id}] — a rewrite (edit_caption) sends nothing new; without it, the messages this run
                sent (telegram_sent, same context)

⚠️ THE LATEST WORDS WIN: the doorbell says "New alert", then "Opened at 09:03:27" when the gate opens. A translation of
the first that arrives after the second is never drawn over it.
"""
from __future__ import annotations

import asyncio
import html
import itertools
import logging
import re

from vesta_shared import status_words
from vesta_shared.message_format import STATUS, TO, document

log = logging.getLogger("vesta.villa_messages")

#: How long the villa's telegram_sent may trail its vesta_message (one run: the message first; a margin)
SENT_WAIT_S = (0.5, 1.0, 2.0)


def keyboard(buttons) -> dict | None:
    """telegram_bot's inline keyboard ([[label, command], …] per row, or one row) as Telegram's reply_markup."""
    if not isinstance(buttons, list) or not buttons:
        return None
    rows = buttons if all(isinstance(r, list) and r and isinstance(r[0], list) for r in buttons) else [buttons]
    out = []
    for row in rows:
        keys = [{"text": str(b[0]), "callback_data": str(b[1])} for b in row
                if isinstance(b, list) and len(b) == 2 and all(isinstance(x, str) for x in b)]
        if keys:
            out.append(keys)
    return {"inline_keyboard": out} if out else None


class VillaMessages:
    def __init__(self, state, translations, lang, edit):
        self.state = state
        self.translations = translations      # translation.Translations: what is kept, what is asked
        self.lang = lang                      # chat → the language it reads (notice.Notices.lang)
        self.edit = edit                      # async (chat, message id, text, keyboard) → bool (delivery.Delivery.edit)
        self._latest: dict[tuple[int, int], int] = {}
        self._n = itertools.count(1)

    async def on_message(self, data: dict, context: str | None) -> int:
        """One vesta_message: each of its messages drawn in its chat's language. Returns how many were drawn."""
        found = self._messages(data)
        if not found and context:
            found = self.state.ha_sent(context)
            for wait in SENT_WAIT_S:
                if found:
                    break
                await asyncio.sleep(wait)
                found = self.state.ha_sent(context)
        n = 0
        for chat, mid in found:
            if self.state.is_own_message(chat, mid):
                continue                      # an incident's message now: its card says it, in its chat's language
            lang = self.lang(chat)
            if lang == "en":
                continue
            token = next(self._n)
            self._latest[(chat, mid)] = token
            n += await self._draw(chat, mid, lang, data, token, ask=True)
        return n

    @staticmethod
    def _messages(data: dict) -> list[tuple[int, int]]:
        out = []
        for m in data.get("messages") or []:
            try:
                out.append((int(m["chat_id"]), int(m["message_id"])))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    async def _draw(self, chat: int, mid: int, lang: str, data: dict, token: int, ask: bool) -> int:
        if self._latest.get((chat, mid)) != token:
            return 0                          # newer words came meanwhile: they are drawn, never these
        if self.state.is_own_message(chat, mid):
            return 0                          # taken over by an incident meanwhile: its card says it
        title, to, body, status = shape(data.get("message"))
        if not title:
            return 0
        lines = [title] + body + status
        shown, want = self.translations.lines(lang, lines)
        if want and ask:
            self.translations.then(want, lambda: self._draw(chat, mid, lang, data, token, ask=False))
        if shown == lines:
            return 0                          # nothing in this language yet: the villa's English stays
        mid_lines, said = shown[1:1 + len(body)], shown[1 + len(body):]
        page = document(shown[0], to, [(None, ["\n".join(mid_lines)]), (status_words.label(lang), said)])
        try:
            ok = await self.edit(chat, mid, page, keyboard(data.get("buttons")))
        except Exception:  # noqa: BLE001 — the villa's English stays
            log.exception("The villa's message %s in chat %s could not be drawn in %s", mid, chat, lang)
            return 0
        return 1 if ok else 0


def shape(message) -> tuple[str, str, list[str], list[str]]:
    """A villa message in the VESTA layout as (title, its "To:" value, its text's lines, its Status lines); ("", …) for
    a message not in that shape (left as it is)."""
    text = html.unescape(re.sub(r"<[^>]*>", "", str(message or ""))).strip()
    title, _, rest = text.partition("\n")
    to, _, rest = rest.partition("\n")
    if not to.startswith(TO.strip()):
        return "", "", [], []
    title, to = title.strip(), to[len(TO.strip()):].strip()
    body, _, status = rest.partition(f"\n{STATUS}:\n") if f"\n{STATUS}:\n" in rest else (rest, "", "")
    return (title, to, [x for x in body.strip("\n").split("\n") if x.strip()],
            [x for x in status.strip("\n").split("\n") if x.strip()])
