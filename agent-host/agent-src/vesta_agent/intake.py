"""A Telegram message as Home Assistant fired it: what the agent does with it. Pure — app.py carries it out.

⚠️ THE GATE, OUT OF THE I/O (architecture review 6, 2026-10-07). Which messages reach the AI was a run of early
returns inside app.handle_message, between sends and log lines; a test had to build the whole agent with a skill
and patch `converse` to watch it. Here each message gets one answer:

    drop          not for the agent (another bot's command, people talking in a group, an unlisted group…)
    whoami        /whoami: the ids, answered even before policy.yaml lists any chat
    unregistered  a person policy.yaml does not know (told so in a private chat only)
    new           /new: the conversation starts again
    converse      the text (or the voice message to transcribe) for the AI

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
    action: str                          # drop · whoami · unregistered · new · converse
    chat: int = 0
    person: object = None
    text: str = ""
    voice_file: str | None = None        # a voice message to transcribe first
    group: bool = False
    why: str = ""                        # a drop worth a record ("group not listed in policy.yaml")


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


def gate(event_type: str, m: dict, policy, bot_username: str | None, is_own_message: Callable[[int, object], bool]) -> Intake:
    try:
        cid = int(m.get("chat_id"))
    except (TypeError, ValueError):
        return Intake("drop")
    group = cid < 0                      # Telegram: groups negative, private chats positive; no type field
    voice = event_type == "telegram_attachment"
    if voice and not str(m.get("file_mime_type") or "").startswith("audio/"):
        return Intake("drop", cid, group=group)               # a photo or a file: nothing the agent does with it
    if event_type == "telegram_command":
        cmd, addressed = command_name(m.get("command") or "", bot_username)
        if not addressed or cmd not in OWN_COMMANDS:
            return Intake("drop", cid, group=group)           # a command for Home Assistant's automations or another bot
        text = " ".join(str(a) for a in (m.get("args") or [])).strip()
    else:
        cmd, text = "", (m.get("text") or "").strip()
    if group and policy.chats and policy.chat_role(cid) is None:
        return Intake("drop", cid, group=True, why="group not listed in policy.yaml")   # never leaveChat
    if cmd == "/whoami":
        return Intake("whoami", cid, group=group)
    if group and not policy.chats:
        return Intake("drop", cid, group=True)                # chat ids not filled yet: only /whoami in a group
    person = policy.person(m.get("user_id"))
    if group:
        mention = bool(bot_username) and f"@{bot_username}".lower() in text.lower()
        if not (cmd or mention or is_own_message(cid, m.get("reply_to_message_id"))):
            return Intake("drop", cid, group=True)            # people talking to each other
    if person is None:
        return Intake("unregistered", cid, group=group)
    if not group and policy.chats and int(cid) not in policy.people:
        return Intake("drop", cid)
    if cmd == "/new":
        return Intake("new", cid, person, group=group)
    if voice:
        # in a group, only a voice message that replies to the agent reaches here (no mention possible)
        return Intake("converse", cid, person, voice_file=str(m.get("file_id") or ""), group=group)
    text = without_mention(text, bot_username)
    return Intake("converse", cid, person, text, group=group) if text else Intake("drop", cid, group=group)


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
