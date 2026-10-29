"""The VESTA Kiosk's tablet, a place people talk to the agent (ticket 21 of "One inbox", owner 2026-10-28).

⚠️ THE KIOSK NEVER CALLS THE AGENT. A question typed on a tablet waits in the Kiosk's inbox; the agent collects it with
a long read (`listen`, GET /agent/v1/inbox: held open until one comes), and writes each answer back as a conversation
turn (POST /agent/v1/conversation-turn). The Kiosk stamps who asked from the tablet's signed-in profile — the page
never says — and the agreement (agent-contract.json `conversation.profiles`) maps the profile to the role the agent
answers it with: owner, fm, or guest (answers only: tool_access.GUEST).

⚠️ A CONVERSATION LIKE A CHAT, NEVER A TELEGRAM CHAT. Each profile is one conversation, with its own AI session, apart
from every Telegram chat: it enters where a Telegram message does (app.handle_message: the intake gate, so /investigate,
/proposal and /new work as there; then converse), under a chat id no Telegram chat can have (Telegram's ids have at most
52 significant bits). Delivery sends to it through this module instead of Telegram (`Tablet`, Delivery's second sink,
chosen by conversation): a message is a turn, an edit replaces it (a "being prepared" answer becomes its result), a
deletion withdraws it. Nobody is added to People.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Awaitable, Callable

from vesta_shared import agreement
from vesta_shared.message_format import ROLE_WORDS

from .kiosk import KioskError, kiosk_timeout_s
from .policy import Person

log = logging.getLogger("vesta.tablet")

#: Above every Telegram chat id: Telegram's have at most 52 significant bits (its Bot API says so of every chat id).
TABLET_BASE = 2 ** 52
#: How many turns' last record are remembered, for an edit that changes only the words (its pictures kept).
REMEMBERED = 200
#: Pause before reading the inbox again after the Kiosk could not be reached; after a Kiosk with no inbox (older).
RETRY_S, NO_INBOX_S = 10.0, 600.0
#: How the person's message reads to the AI: where it was written, and how that place shows the answer.
WHERE = ("conversation on the villa's wall tablet (the VESTA Kiosk; apart from every Telegram chat): it shows your text "
         "as written, plain text, with the camera pictures you looked at and the pages you send")


def profiles() -> dict[str, str]:
    """The Kiosk's profiles the agent answers, each with its role (the agreement's one table)."""
    return {str(k): str(v) for k, v in (agreement.section("conversation").get("profiles") or {}).items()}


def chat_of(profile: str | None) -> int | None:
    """The conversation of a profile, as a chat id no Telegram chat has (stable across versions: from its name)."""
    if profile not in profiles():
        return None
    return TABLET_BASE + int.from_bytes(hashlib.sha1(str(profile).encode()).digest()[:4], "big")


def profile_of(chat) -> str | None:
    """The profile whose conversation `chat` is; None for any other chat (a Telegram one)."""
    try:
        chat = int(chat)
    except (TypeError, ValueError):
        return None
    return next((p for p in profiles() if chat_of(p) == chat), None) if chat >= TABLET_BASE else None


def person_of(profile: str | None) -> Person | None:
    """Who asks, from the profile the Kiosk stamped: its role's rights; named for the AI by the role ("Owner at the
    tablet"). English: the tablet's one language (ticket 28 parked)."""
    chat, role = chat_of(profile), profiles().get(str(profile))
    if chat is None or not role:
        return None
    return Person(chat, f"{ROLE_WORDS.get(role, role.capitalize())} at the tablet", role, "en")


def as_message(chat: int, person: Person, text: str) -> tuple[str, dict]:
    """A tablet's question as the gate reads a Telegram message (intake.gate): a "/command" as a command, anything else
    as text. (event type, message)."""
    m = {"chat_id": chat, "user_id": chat, "from_first": person.name}
    words = (text or "").strip()
    if words.startswith("/"):
        cmd, _, rest = words.partition(" ")
        return "telegram_command", {**m, "command": cmd, "args": rest.split()}
    return "telegram_text", {**m, "text": words}


def turn_key(mid) -> str:
    """A turn's key at the Kiosk: its message id (the Kiosk replaces a turn by it; `ask:` keys are the Kiosk's own)."""
    return f"turn:{int(mid)}"


def photos_per_turn() -> int:
    return int((agreement.section("conversation").get("limits") or {}).get("photos") or 0)


class Tablet:
    """Delivery's second sink (one per agent): what is sent to a tablet's conversation, as turns the Kiosk keeps — and
    the inbox the questions come from."""

    def __init__(self, kiosk, state, timeout_s: Callable[[], float] = kiosk_timeout_s):
        self.kiosk = kiosk
        self.state = state
        self._timeout_s = timeout_s
        self._last_mid = 0
        self._turns: dict[int, dict] = {}       # message id → the record last written for it (an edit keeps its pictures)
        self._tasks: set[asyncio.Task] = set()
        self._after: int | None = None          # the last question collected (kept in the state too: tablet_after)
        self._said: str | None = None           # the inbox's last trouble, said once: "unreached", "none"

    def owns(self, chat) -> bool:
        return self.kiosk.enabled and profile_of(chat) is not None

    # ------------------------------------------------------------------ out: turns
    def _mid(self) -> int:
        """A new message id for a turn: past every earlier one, across restarts (a turn's key is made of it)."""
        self._last_mid = max(self._last_mid + 1, int(time.time() * 1000))
        return self._last_mid

    async def _write(self, mid: int, record: dict) -> bool:
        try:
            ok = await asyncio.wait_for(self.kiosk.add_turn(record), self._timeout_s())
        except (KioskError, asyncio.TimeoutError) as e:
            log.warning("An answer could not be written to the tablet (%s)", type(e).__name__)
            return False
        if ok:
            self._turns[mid] = record
            while len(self._turns) > REMEMBERED:
                self._turns.pop(next(iter(self._turns)))
        return ok

    async def send(self, chat: int, text: str, *, document: str | None = None, photos=()) -> int | None:
        """One turn of VESTA's in `chat`'s conversation: its words, the camera pictures (base64) and a page (an HTML file
        of the out folder, uploaded first). Its message id, or None when the Kiosk did not keep it."""
        rec = {"profile": profile_of(chat), "text": text or ""}
        b64 = [p for p in photos if p][-photos_per_turn():] if photos_per_turn() else []
        if b64:
            rec["photos"] = b64
        if document:
            page = await self._page(document)
            if page:
                rec["page"] = page
            else:
                rec["text"] = (rec["text"] + "\n\n" if rec["text"] else "") + "(A file came with this answer: the tablet cannot show it.)"
        mid = self._mid()
        return mid if await self._write(mid, {"key": turn_key(mid), **rec}) else None

    async def edit(self, chat: int, mid: int, text: str) -> bool:
        """`mid`'s turn says `text` now (its pictures and page kept): the Kiosk replaces it by its key."""
        was = self._turns.get(int(mid)) or {"key": turn_key(mid), "profile": profile_of(chat)}
        return await self._write(int(mid), {**was, "text": text})

    async def delete(self, chat: int, mid: int) -> bool:
        """`mid`'s turn withdrawn (a "being prepared" answer once its result came, as on Telegram): the Kiosk keeps it
        withdrawn, the tablet no longer shows it. The agent never removes a record."""
        return await self._write(int(mid), {"key": turn_key(mid), "profile": profile_of(chat), "gone": True})

    async def _page(self, path: str) -> str | None:
        """A page sent with an answer, kept at the Kiosk (its id), as a report's is (kiosk_messages.page_id); None for any
        other file, or when the Kiosk did not keep it."""
        from .kiosk_messages import page_id
        if not str(path).lower().endswith(".html"):
            return None
        try:
            html = await asyncio.to_thread(lambda: open(path, "rb").read())
            return await self.kiosk.add_document(html, page_id(html))
        except (OSError, KioskError) as e:
            log.warning("A page could not be kept for the tablet (%s)", type(e).__name__)
            return None

    # ------------------------------------------------------------------ in: the inbox
    async def listen(self, stop: asyncio.Event, handle: Callable[[dict], Awaitable[None]]) -> None:
        """Collect the tablets' questions until `stop` (`collect`, again and again: the Kiosk holds each read open until
        one comes)."""
        while not stop.is_set():
            pause = await self.collect(handle)
            if pause:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=pause)
                except asyncio.TimeoutError:
                    pass

    async def collect(self, handle: Callable[[dict], Awaitable[None]]) -> float:
        """One read of the inbox: each new question handed to `handle` (app.Vesta.on_tablet) without waiting for its
        answer — a long answer never holds up another profile's question. The last one collected is kept, so a restart
        answers each once; one asked while the agent was stopped is answered when it starts (the Kiosk keeps a question
        only the agreement's askKeptSeconds). How long to pause before the next read (0: at once)."""
        after = self._after if self._after is not None else self.state.tablet_after()
        try:
            got = await self.kiosk.inbox(after)
        except KioskError as e:
            if self._said != "unreached":
                log.warning("The tablet's questions could not be collected: %s", e)
            self._said = "unreached"
            return RETRY_S
        if got is None:
            if self._said != "none":
                log.info("The VESTA Kiosk keeps no questions from the tablet (a version before 2.496.582)")
            self._said = "none"
            return NO_INBOX_S
        if self._said is not None:
            log.info("The tablet's questions are collected again")
        self._said = None
        last = int(got.get("last") or 0)
        if after is not None and last < after:
            self._after = None                           # the Kiosk's store started again (a reinstall): read it whole
            self.state.set_tablet_after(None)
            return 0.0
        # the Kiosk answers only what came after `after` (its rule, never copied here)
        for ask in got.get("asks") or ():
            if isinstance(ask, dict) and isinstance(ask.get("seq"), int):
                log.info("A question from the tablet (%s)", ask.get("profile"))
                task = asyncio.create_task(handle(ask))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
        self._after = last
        self.state.set_tablet_after(last)
        return 0.0

    async def idle(self) -> None:
        """Until every question collected has been handled (the tests)."""
        while pending := [t for t in self._tasks if not t.done()]:
            await asyncio.gather(*pending, return_exceptions=True)

