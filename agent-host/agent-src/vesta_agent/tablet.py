"""The VESTA Kiosk's tablet, a place people talk to the agent (ticket 21 of "One inbox", owner 2026-10-28).

⚠️ THE KIOSK NEVER CALLS THE AGENT. A question typed on a tablet waits in the Kiosk's inbox; the agent collects it with
a long read (`listen`, GET /agent/v1/inbox: held open until one comes), and writes each answer back as a conversation
turn (POST /agent/v1/conversation-turn). The Kiosk stamps who asked from the tablet's signed-in profile — the page
never says — and the agreement (agent-contract.json `conversation.profiles`) maps the profile to the role the agent
answers it with: owner, fm, or guest (answers only: tool_access.GUEST).

⚠️ A CONVERSATION LIKE A CHAT, NEVER A TELEGRAM CHAT. Each profile is one conversation, with its own AI session, apart
from every Telegram chat: it enters the gate a Telegram message does, as itself (`question`; app.handle_question: the
intake gate, so /investigate, /proposal and /new work as there; then converse), under a chat id no Telegram chat can have (Telegram's ids have at most
52 significant bits). Delivery sends to it through this module instead of Telegram (`Tablet`, Delivery's second sink,
chosen by conversation): a message is a turn, an edit replaces it (a "being prepared" answer becomes its result), a
deletion withdraws it. Nobody is added to People.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import replace
from typing import Awaitable, Callable

from vesta_shared import agreement

from . import intake
from .kiosk import KioskError, kiosk_timeout_s
from .kiosk_messages import buttons_of
from .policy import Person, tablet_chat, tablet_person, tablet_profile, tablet_profiles

log = logging.getLogger("vesta.tablet")

#: How many turns' last record are remembered, for an edit that changes only the words (its pictures kept).
REMEMBERED = 200
#: Pause before reading the inbox again after the Kiosk could not be reached; after a Kiosk with no inbox (older).
RETRY_S, NO_INBOX_S = 10.0, 600.0
#: How often a conversation that waits for VESTA says so again (the tablet's dots go when it stops saying it).
TYPING_EVERY_S = 60.0
#: How the person's message reads to the AI: where it was written, and how that place shows the answer.
WHERE = ("conversation on the villa's wall tablet (the VESTA Kiosk; apart from every Telegram chat): it shows your text "
         "as written, plain text, with the camera pictures you looked at and the pages you send")
# who is at a tablet is the People module's answer (policy.tablet_*): one place for every step that asks
profiles, chat_of, profile_of = tablet_profiles, tablet_chat, tablet_profile


def person_of(profile: str | None) -> Person | None:
    """Who asks, from the profile the Kiosk stamped (policy.tablet_person): a guest too, answered with answers only."""
    chat = tablet_chat(profile)
    return tablet_person(chat) if chat is not None else None


def question(chat: int, person: Person, ask: dict, audio=None) -> intake.Question:
    """A tablet's question as the gate reads it (intake.Question): a "/command" as a command, a spoken one by its audio
    (`Spoken`), anything else as words. Only the agent reads a tablet's conversation (intake._shared), so what is not
    the agent's ("/help") is answered there, never left to the time a question is kept."""
    words = str(ask.get("text") or "").strip()
    q = intake.Question(chat, chat, person.name, person=person)
    if audio is not None:
        return replace(q, audio=audio)
    if words.startswith("/"):
        cmd, _, rest = words.partition(" ")
        return replace(q, command=cmd, args=tuple(rest.split()))
    return replace(q, text=words)


def key(kind: str, of) -> str:
    """A turn's key at the Kiosk, of its kind (the agreement's conversation.keys: `turn` an answer, `press` a press's
    short answer, `typing` VESTA answering, `ask` the person's own line, the Kiosk's)."""
    return f"{agreement.section('conversation')['keys'][kind]}{of}"


def turn_key(mid) -> str:
    """A turn's key at the Kiosk: its message id (the Kiosk replaces a turn by it)."""
    return key("turn", int(mid))


class Spoken:
    """A question spoken on a tablet (ticket 23 of "One inbox", hold to talk), as voice.Voice reads a voice message: its
    WAV fetched from the Kiosk ONCE (the Kiosk deletes it as it answers), and the words heard written onto the person's
    own line of the thread (`heard`): the tablet then shows them as the question."""
    suffix = ".wav"

    def __init__(self, sink: "Tablet", chat: int, ask: dict):
        self.sink, self.chat, self.seq, self.name = sink, chat, ask.get("seq"), str(ask.get("voice") or "")

    async def fetch(self, cid: int) -> bytes | str | None:
        try:
            data = await asyncio.wait_for(self.sink.kiosk.voice(self.name), self.sink._timeout_s())
        except (KioskError, asyncio.TimeoutError) as e:
            log.warning("A spoken question could not be fetched from the tablet (%s)", type(e).__name__)
            return "Your spoken question could not be fetched from the tablet. Hold to talk again, or type it."
        return data or "Your spoken question is no longer kept. Hold to talk again, or type it."

    async def heard(self, words: str) -> None:
        await self.sink.heard(self.chat, self.seq, words)


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
        self._working: dict[int, dict] = {}     # chat → its "VESTA is answering" loop and what holds it (hold)
        self._after: int | None = None          # the last question collected (kept in the state too: tablet_after)
        self._said: str | None = None           # the inbox's last trouble, said once: "unreached", "none"

    def owns(self, chat) -> bool:
        return self.kiosk.enabled and profile_of(chat) is not None

    @property
    def reaches(self) -> bool:
        return self.kiosk.enabled

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

    # ⚠️ DELIVERY'S SECOND PLACE (delivery.TelegramChats is the first): the same five steps, each as the tablet shows it.
    # Buttons and "typing…" are ticket 22's (the keyboard is not drawn yet, a hold shows nothing).
    async def send(self, chat: int, text: str, *, keyboard: dict | None = None, document: str | None = None, photos=(),
                   reply_to: int | None = None) -> int | None:
        """One turn of VESTA's in `chat`'s conversation: its words, the camera pictures ((base64, mime)) and a page (an
        HTML file of the out folder, uploaded first). Its message id, or None when the Kiosk did not keep it."""
        rec = {"profile": profile_of(chat), "text": text or ""}
        if buttons := buttons_of(keyboard):
            rec["buttons"] = buttons                 # VESTA's own kind and id (kiosk_messages.buttons_of), never a command
        b64 = [p[0] for p in photos if p][-photos_per_turn():] if photos_per_turn() else []
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

    async def heard(self, chat: int, ask: int | None, words: str) -> bool:
        """The words heard in a spoken question, onto the person's own line (`ask:<seq>`, the Kiosk's): the one write the
        agent makes to a person's line, once (the Kiosk refuses any other)."""
        if not isinstance(ask, int) or not words.strip():
            return False
        try:
            return await asyncio.wait_for(self.kiosk.add_turn(
                {"key": key("ask", ask), "profile": profile_of(chat), "heard": words.strip()}), self._timeout_s())
        except (KioskError, asyncio.TimeoutError) as e:
            log.warning("The words heard could not be written to the tablet (%s)", type(e).__name__)
            return False

    def spoken(self, chat: int, ask: dict) -> Spoken:
        """A spoken question's audio, for voice.Voice."""
        return Spoken(self, chat, ask)

    async def answer(self, chat: int, press: int | None, text: str) -> bool:
        """A press's short answer (Telegram's toast), back to the tablet that pressed: a turn naming the press, shown
        under its button, never as a line of the conversation."""
        if not isinstance(press, int) or not text:
            return False
        return await self._write(self._mid(), {"key": key("press", press), "profile": profile_of(chat), "text": text,
                                               "answers": press})

    async def reply(self, chat: int, text: str, *, keyboard: dict | None = None, photos=()) -> int | None:
        """A reply to a person: ONE turn, its words with the camera pictures."""
        return await self.send(chat, text, keyboard=keyboard, photos=photos) if (text or photos) else None

    async def buttons(self, chat: int, mid: int, keyboard: dict | None) -> bool:
        """`mid`'s turn offers these buttons now (its words kept)."""
        was = self._turns.get(int(mid))
        if was is None:
            return False
        return await self._write(int(mid), {**{k: v for k, v in was.items() if k != "buttons"},
                                            **({"buttons": b} if (b := buttons_of(keyboard)) else {})})

    # ⚠️ "VESTA IS ANSWERING" ON THE TABLET (owner, 2026-10-29: "a running indicator in the chat response bubble while
    # VESTA is thinking or waiting for an answer"): Telegram's "typing…" for the tablet — held as Delivery holds every
    # wait (a message being read, the AI answering, a report being made), ONE per conversation whatever holds it, said
    # again every TYPING_EVERY_S so a tablet can tell a VESTA that stopped (its dots go after the agreement's
    # conversation.typingSeconds), and withdrawn when the last hold is released.
    def hold(self, chat: int, label: str | None = None) -> Callable[[], None]:
        """The conversation `chat` waits for VESTA from now; the release (safe to call twice)."""
        w = self._working.get(chat)
        if w is None:
            w = {"stop": asyncio.Event(), "holds": set()}
            try:
                w["task"] = asyncio.get_running_loop().create_task(self._working_loop(chat, w["stop"]))
            except RuntimeError:              # no loop (a script, a test outside one): nothing to show it on
                return lambda: None
            self._working[chat] = w
        token = object()
        w["holds"].add(token)

        def release() -> None:
            if token not in w["holds"]:
                return
            w["holds"].discard(token)
            if not w["holds"]:
                w["stop"].set()
                if self._working.get(chat) is w:
                    self._working.pop(chat, None)
        return release

    async def _working_loop(self, chat: int, stop: asyncio.Event) -> None:
        typing = {"key": key("typing", profile_of(chat)), "profile": profile_of(chat)}
        while not stop.is_set():
            await self._say_working(dict(typing, typing=True))
            try:
                await asyncio.wait_for(stop.wait(), timeout=TYPING_EVERY_S)
            except asyncio.TimeoutError:
                pass
        await self._say_working(dict(typing, gone=True))

    async def _say_working(self, record: dict) -> None:
        try:
            await asyncio.wait_for(self.kiosk.add_turn(record), self._timeout_s())
        except (KioskError, asyncio.TimeoutError):
            pass                               # the tablet's dots are a courtesy: the answer itself never waits on them

    async def edit(self, chat: int, mid: int, text: str, keyboard: dict | None = None) -> bool:
        """`mid`'s turn says `text` now, its buttons gone or `keyboard`'s (its pictures and page kept): the Kiosk replaces it
        by its key."""
        was = self._turns.get(int(mid)) or {"key": turn_key(mid), "profile": profile_of(chat)}
        rec = {k: v for k, v in was.items() if k != "buttons"}
        return await self._write(int(mid), {**rec, "text": text, **({"buttons": b} if (b := buttons_of(keyboard)) else {})})

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

