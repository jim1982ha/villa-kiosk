"""A message for the agent (Telegram's, or a tablet's question: `Question`): what the agent does with it. Pure —
app.py carries it out.

⚠️ THE GATE, OUT OF THE I/O (architecture review 6, 2026-10-07). Which messages reach the AI was a run of early
returns inside app.handle_message, between sends and log lines; a test had to build the whole agent with a skill
and patch `converse` to watch it. Here each message gets one answer:

    drop          not for the agent (another bot's command, people talking in a group, an unlisted group…)
    told          the same, where only the agent reads (a tablet): the person is told why, never left waiting
    whoami        /whoami: the ids, answered even before policy.yaml lists any chat
    unregistered  a person policy.yaml does not know (told so in a private chat only)
    new           /new: the conversation starts again
    converse      the text (or the voice message to transcribe, or the photo with its caption) for the AI

Also the conversation-reset rule ("Delete conversation context at", settings.conversation_reset), which had no
test at all.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from vesta_shared.message_format import ROLE_WORDS

from .places import tab
from .policy import NOT_REGISTERED, reset_at, silence_reset_hours, tablet_profile

OWN_COMMANDS = {"/ask", "/new", "/whoami"}


@dataclass(frozen=True)
class Question:
    """A message for the agent, wherever it was written: Telegram's event (`from_telegram`) or a tablet's question
    (tablet.question). ⚠️ NEVER ONE DRESSED AS THE OTHER (architecture review R, 2026-10-29): the tablet's question was
    made into a Telegram event to reach the gate, and Telegram's rule for what is not the agent's (a command for the
    villa's automations or another bot, said in the same chat) left "/help" on the tablet unanswered: dots for the time a
    question is kept, then "No answer came". Whether others read the place too is the chat's own (`_shared`), never a
    field a builder sets (round 2: a command offer pressed on a tablet came through Telegram's shape)."""
    chat: int | None
    user_id: object = None
    first_name: str | None = None
    text: str = ""                       # the words (a photo's caption); a command's are in `args`
    command: str | None = None           # "/name" or "/name@bot"
    args: tuple = ()
    voice_file: str | None = None        # a Telegram voice note, by its file id
    audio: object = None                 # a voice message's audio from elsewhere (voice.AudioSource: spoken on a tablet)
    photo_file: str | None = None        # a photo the AI looks at, its caption the text
    mime: str = ""                       # its type, as sent
    unread_file: str | None = None       # a file the agent does not read: its type
    reply_to: object = None
    person: object = None                # who asks, when the place knows it (a tablet's profile, stamped by the Kiosk)


def from_telegram(event_type: str, m: dict) -> Question:
    """A Telegram message as Home Assistant fires it (fields checked live on 2026-09-30)."""
    try:
        cid = int(m.get("chat_id"))
    except (TypeError, ValueError):
        cid = None
    mime = str(m.get("file_mime_type") or "")
    attachment = event_type == "telegram_attachment"
    voice, photo = attachment and mime.startswith("audio/"), attachment and mime.startswith("image/")
    text = str(m.get("text") or "").strip()
    command, args = m.get("command"), m.get("args")
    if photo and text.startswith("/"):
        # a photo's caption is plain text to Home Assistant ("/ask are you sure ?"), never a command event: put in the
        # command's own shape, it meets the one command rule — a photo has no rule of its own
        command, args = text.split(" ", 1)[0], text.split()[1:]
    fid = str(m.get("file_id") or "")
    return Question(cid, m.get("user_id"), m.get("from_first"), text, command, tuple(args or ()),
                    voice_file=fid if voice else None, photo_file=fid if photo else None,
                    unread_file=(mime or "unknown type") if attachment and not (voice or photo) else None,
                    mime=mime, reply_to=m.get("reply_to_message_id"))


@dataclass
class Intake:
    action: str                          # drop · told · whoami · unregistered · new · command_off · converse
    chat: int = 0
    person: object = None
    # converse: the words; told, whoami, unregistered, new, command_off: what the person is told (empty: nothing, an
    # unregistered sender in a group). ⚠️ WRITTEN HERE, ONCE (architecture review 2026-10-30, round 2): app.py wrote them
    # beside its sends, out of reach of a test of the gate
    text: str = ""
    voice_file: str | None = None        # a Telegram voice note to transcribe first
    audio: object = None                 # a voice message from elsewhere to transcribe first (Question.audio)
    photo_file: str | None = None        # a photo the AI looks at, its caption the text
    group: bool = False
    why: str = ""                        # a drop worth a record ("group not listed in policy.yaml")
    invoked: str | None = None           # the skill its "/command" calls for (skills.Skill.command), its token removed

    @property
    def spoken(self) -> bool:
        return self.voice_file is not None or self.audio is not None


def _shared(chat: int) -> bool:
    """Others read this place too: a Telegram chat (the villa's automations, other bots), never a tablet's conversation
    (policy.tablet_profile: the People module's one answer)."""
    return tablet_profile(chat) is None


def _not_ours(q: Question, chat: int, group: bool, line: str) -> Intake:
    """What is not the agent's: unanswered where others read too (Telegram), told where only the agent does."""
    return Intake("drop", chat, group=group) if _shared(chat) else Intake("told", chat, q.person, line)


def command_name(cmd: str, bot_username: str | None) -> tuple[str, bool]:
    """('/ask', addressed) from '/ask' or '/ask@TheBot'. A command naming another bot is not ours."""
    name, _, target = (cmd or "").partition("@")
    if target:
        return name.lower(), bool(bot_username) and target.lower() == bot_username.lower()
    return name.lower(), True


def without_mention(text: str, bot_username: str | None) -> str:
    if bot_username:
        text = re.sub(rf"@{re.escape(bot_username)}", "", text or "", flags=re.I)
    return (text or "").strip()


SKILL_TOKEN = re.compile(r"(?<![\w/])(/[a-z][a-z0-9_]*)(?:@\w+)?(?![\w/])", re.I)


def skill_called(text: str, skill_commands: dict[str, str]) -> tuple[str | None, str]:
    """(the skill a "/command" anywhere in the text calls for, the text without it) — or (None, text)."""
    for m in SKILL_TOKEN.finditer(text or ""):
        skill = skill_commands.get(m.group(1).lower())
        if skill:
            return skill, " ".join((text[:m.start()] + text[m.end():]).split())
    return None, text


def gate(q: Question, policy, bot_username: str | None, is_own_message: Callable[[int, object], bool],
         skill_commands: dict[str, str] | None = None, commands_off: dict[str, str] | None = None) -> Intake:
    """`skill_commands`: "/command" → the skill only it starts (skills.Skills.commands); `commands_off`: those of the
    skills the villa switched off — ⚠️ ANSWERED, NEVER DROPPED (review 32: "/investigate" with the skill off was silence,
    while the concierge still told people to write it). `q.person`: who writes, when the place knows it — a tablet's
    profile, stamped by the Kiosk (tablet.py): never looked up in People, and no Telegram id to tell (/whoami)."""
    skill_commands, commands_off = skill_commands or {}, commands_off or {}
    if q.chat is None:
        return Intake("drop")
    cid = q.chat
    group = cid < 0                      # Telegram: groups negative, private chats positive; no type field
    # ⚠️ A PHOTO IS A MESSAGE (owner, 2026-10-10: Fabien sent a screenshot with "/ask are you sure ?" in the group, twice,
    # and the agent dropped it without a word or a record). It is read as a text message is — its caption the text, by
    # the same rules (in a group: /ask, a mention or a reply to the agent; in a private chat: always) — and the AI sees it.
    if q.unread_file is not None:
        return Intake("drop", cid, group=group, why=f"a file the agent does not read ({q.unread_file})")
    if q.command is not None:
        cmd, addressed = command_name(q.command or "", bot_username)
        if not addressed or (cmd not in OWN_COMMANDS and cmd not in skill_commands and cmd not in commands_off):
            # a command for the villa's automations or another bot, where they read too
            return _not_ours(q, cid, group, f"VESTA has no {cmd or q.command} command. Write your question in your own "
                                            "words.")
        text = " ".join(str(a) for a in q.args).strip()
    else:
        cmd, text = "", (q.text or "").strip()
    # a skill's command, as the message's command or written anywhere in it: that skill, and only then
    invoked = skill_commands.get(cmd)
    if invoked is None:
        invoked, text = skill_called(text, skill_commands)
    # ⚠️ /whoami IS HOW A GROUP GETS INTO PEOPLE (0.12.128): its id is read there before it is listed — by anyone while
    # People is empty, by a listed person once it is not (a stranger in an unlisted group still gets nothing). A place
    # that knows who asks (a tablet) says who that is: there is no Telegram id to tell.
    if cmd == "/whoami" and (q.person is not None or not group or not policy.destinations or policy.roles_in(cid)
                             or policy.person(q.user_id) is not None):
        # a tablet: who is signed in there is the answer (no Telegram id to tell)
        said = (f"You are {q.person.name}; VESTA answers you as {ROLE_WORDS.get(q.person.role, q.person.role)}."
                if q.person is not None else f"Your Telegram id: {q.user_id}. This chat id: {cid}.")
        return Intake("whoami", cid, q.person, said, group=group)
    if group and not policy.roles_in(cid):
        # never leaveChat: the bot is Home Assistant's too
        return Intake("drop", cid, group=True, why="group not listed in People" if policy.destinations else None)
    # a listed group's member has its role; a tablet's profile is the caller's (the Kiosk stamped it)
    person = q.person if q.person is not None else policy.member(q.user_id, cid, q.first_name)
    if group:
        mention = bool(bot_username) and f"@{bot_username}".lower() in text.lower()
        if not (cmd or mention or invoked or is_own_message(cid, q.reply_to)):
            return Intake("drop", cid, group=True)            # people talking to each other
    if person is None:
        return Intake("unregistered", cid, text="" if group else f"{NOT_REGISTERED} Your Telegram id is {q.user_id}.",
                      group=group)
    if cmd == "/new":
        return Intake("new", cid, person, "New conversation.", group=group)
    if cmd in commands_off:
        return Intake("command_off", cid, person, f"The {commands_off[cmd]} skill is switched off on this villa "
                      f"({tab('skills')}). Write your question without {cmd}.", group=group, invoked=commands_off[cmd])
    if q.voice_file is not None or q.audio is not None:
        # in a group, only a voice message that replies to the agent reaches here (no mention possible)
        return Intake("converse", cid, person, voice_file=q.voice_file, audio=q.audio, group=group)
    if q.photo_file is not None:
        return Intake("converse", cid, person, without_mention(text, bot_username),
                      photo_file=q.photo_file, group=group, invoked=invoked)
    text = without_mention(text, bot_username)
    if not text and not invoked:
        return _not_ours(q, cid, group, f"Write your question after {cmd}." if cmd else "Write your question.")
    return Intake("converse", cid, person, text, group=group, invoked=invoked)    # the command alone: app asks for the question


def resume_for(session_id: str | None, last_iso: str | None, rule: str, zone: str, now: datetime | None = None) -> str | None:
    """The conversation to go on with, or None to start a new one (settings.conversation_reset):
    never · after_8h_silence · otherwise at 04:00 in the villa's time."""
    if not session_id or not last_iso:
        return None
    last = datetime.fromisoformat(last_iso)
    now = now or datetime.now(timezone.utc)
    if rule == "never":
        return session_id
    if rule == "after_8h_silence":
        return session_id if now - last < timedelta(hours=silence_reset_hours()) else None
    local = now.astimezone(ZoneInfo(zone))
    hh, mm = map(int, reset_at().split(":"))
    cut = datetime.combine(local.date(), time(hh, mm), tzinfo=local.tzinfo)
    if local < cut:
        cut -= timedelta(days=1)
    return session_id if last >= cut.astimezone(timezone.utc) else None
