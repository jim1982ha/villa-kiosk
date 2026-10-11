"""A Telegram message as Home Assistant fired it: what the agent does with it. Pure — app.py carries it out.

⚠️ THE GATE, OUT OF THE I/O (architecture review 6, 2026-10-07). Which messages reach the AI was a run of early
returns inside app.handle_message, between sends and log lines; a test had to build the whole agent with a skill
and patch `converse` to watch it. Here each message gets one answer:

    drop          not for the agent (another bot's command, people talking in a group, an unlisted group…)
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

OWN_COMMANDS = {"/ask", "/new", "/whoami"}


@dataclass
class Intake:
    action: str                          # drop · whoami · unregistered · new · command_off · converse
    chat: int = 0
    person: object = None
    text: str = ""
    voice_file: str | None = None        # a voice message to transcribe first
    photo_file: str | None = None        # a photo the AI looks at, its caption the text
    group: bool = False
    why: str = ""                        # a drop worth a record ("group not listed in policy.yaml")
    invoked: str | None = None           # the skill its "/command" calls for (skills.Skill.command), its token removed


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


def gate(event_type: str, m: dict, policy, bot_username: str | None, is_own_message: Callable[[int, object], bool],
         skill_commands: dict[str, str] | None = None, commands_off: dict[str, str] | None = None) -> Intake:
    """`skill_commands`: "/command" → the skill only it starts (skills.Skills.commands); `commands_off`: those of the
    skills the villa switched off — ⚠️ ANSWERED, NEVER DROPPED (review 32: "/investigate" with the skill off was silence,
    while the concierge still told people to write it)."""
    skill_commands, commands_off = skill_commands or {}, commands_off or {}
    try:
        cid = int(m.get("chat_id"))
    except (TypeError, ValueError):
        return Intake("drop")
    group = cid < 0                      # Telegram: groups negative, private chats positive; no type field
    mime = str(m.get("file_mime_type") or "")
    attachment = event_type == "telegram_attachment"
    voice = attachment and mime.startswith("audio/")
    # ⚠️ A PHOTO IS A MESSAGE (owner, 2026-10-10: Fabien sent a screenshot with "/ask are you sure ?" in the group, twice,
    # and the agent dropped it without a word or a record). It is read as a text message is — its caption the text, by
    # the same rules (in a group: /ask, a mention or a reply to the agent; in a private chat: always) — and the AI sees it.
    photo = attachment and mime.startswith("image/")
    if attachment and not (voice or photo):
        return Intake("drop", cid, group=group, why=f"a file the agent does not read ({mime or 'unknown type'})")
    command, args = m.get("command"), m.get("args")
    if photo and (m.get("text") or "").strip().startswith("/"):
        # a photo's caption is plain text to Home Assistant ("/ask are you sure ?"), never a command event: put in the
        # command's own shape, it meets the one command rule below — a photo has no rule of its own
        command, args = (m.get("text") or "").strip().split(" ", 1)[0], (m.get("text") or "").strip().split()[1:]
    if command is not None:
        cmd, addressed = command_name(command or "", bot_username)
        if not addressed or (cmd not in OWN_COMMANDS and cmd not in skill_commands and cmd not in commands_off):
            return Intake("drop", cid, group=group)           # a command for Home Assistant's automations or another bot
        text = " ".join(str(a) for a in (args or [])).strip()
    else:
        cmd, text = "", (m.get("text") or "").strip()
    # a skill's command, as the message's command or written anywhere in it: that skill, and only then
    invoked = skill_commands.get(cmd)
    if invoked is None:
        invoked, text = skill_called(text, skill_commands)
    # ⚠️ /whoami IS HOW A GROUP GETS INTO PEOPLE (0.12.128): its id is read there before it is listed — by anyone while
    # People is empty, by a listed person once it is not (a stranger in an unlisted group still gets nothing)
    if cmd == "/whoami" and (not group or not policy.destinations or policy.roles_in(cid)
                             or policy.person(m.get("user_id")) is not None):
        return Intake("whoami", cid, group=group)
    if group and not policy.roles_in(cid):
        # never leaveChat: the bot is Home Assistant's too
        return Intake("drop", cid, group=True, why="group not listed in People" if policy.destinations else None)
    person = policy.member(m.get("user_id"), cid, m.get("from_first"))     # a listed group's member has its role
    if group:
        mention = bool(bot_username) and f"@{bot_username}".lower() in text.lower()
        if not (cmd or mention or invoked or is_own_message(cid, m.get("reply_to_message_id"))):
            return Intake("drop", cid, group=True)            # people talking to each other
    if person is None:
        return Intake("unregistered", cid, group=group)
    if cmd == "/new":
        return Intake("new", cid, person, group=group)
    if cmd in commands_off:
        return Intake("command_off", cid, person, group=group, invoked=commands_off[cmd])
    if voice:
        # in a group, only a voice message that replies to the agent reaches here (no mention possible)
        return Intake("converse", cid, person, voice_file=str(m.get("file_id") or ""), group=group)
    if photo:
        return Intake("converse", cid, person, without_mention(text, bot_username),
                      photo_file=str(m.get("file_id") or ""), group=group, invoked=invoked)
    text = without_mention(text, bot_username)
    if not text and not invoked:
        return Intake("drop", cid, group=group)
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
        return session_id if now - last < timedelta(hours=8) else None
    local = now.astimezone(ZoneInfo(zone))
    cut = datetime.combine(local.date(), time(4, 0), tzinfo=local.tzinfo)
    if local < cut:
        cut -= timedelta(days=1)
    return session_id if last >= cut.astimezone(timezone.utc) else None
