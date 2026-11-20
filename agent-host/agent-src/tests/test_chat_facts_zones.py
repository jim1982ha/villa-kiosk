"""What reached a chat "since your last answer" is read by the moment, never its text (villa, #204, 2026-11-20): the
agent writes its answers in UTC ("…T04:20:12+00:00"), the villa an alert's steps in its own time ("…T12:19:31+08:00").
Compared as text, a step sent before the AI's answer read as after it. Synthetic; ids invented."""
from __future__ import annotations

from vesta_agent.chat_facts import ChatFacts, SINCE
from vesta_agent.in_progress import InProgress
from vesta_agent.state import State

CHAT = 222
ANSWERED = "2025-01-10T04:20:12+00:00"          # the AI's last answer here: 12:20:12 at the villa (+08:00)


def facts(tmp_path) -> tuple[ChatFacts, State]:
    st = State(str(tmp_path / "state.db"))
    return ChatFacts(st, InProgress(), "Asia/Makassar", name=lambda iid: f"#{iid}"), st


def told_lines(cf: ChatFacts) -> list[str]:
    out = cf.now(CHAT).splitlines()
    return out[out.index(SINCE) + 1:] if SINCE in out else []


def test_since_your_last_answer_keeps_what_came_after_it_in_either_zone(tmp_path):
    cf, st = facts(tmp_path)
    st.set_chat_facts(CHAT, {"told": ANSWERED, "items": [
        {"at": "2025-01-10T12:19:31+08:00", "said": "the daily report was sent here."},     # 04:19:31 UTC: before
        {"at": "2025-01-10T04:30:00+00:00", "said": "Done pressed on alert #3 by Wayan."},  # after
        {"at": "2025-01-10T12:25:00+08:00", "said": "the weekly report was sent here."}]})  # 04:25 UTC: after
    st.set_incident_history(7, [
        {"at": "2025-01-10T12:10:00+08:00", "stage": "reminder", "chats": [[CHAT, ["fm"]]]},   # 04:10 UTC: before
        {"at": "2025-01-10T12:21:00+08:00", "stage": "reminder", "chats": [[CHAT, ["fm"]]]}])  # 04:21 UTC: after
    lines = told_lines(cf)
    assert [ln.split(": ", 1)[1] for ln in lines] == [
        "alert #7: Reminder sent here.",                 # 12:21 at the villa
        "the weekly report was sent here.",              # 12:25
        "Done pressed on alert #3 by Wayan."], lines     # 12:30
    assert lines[0].startswith("- 10/01/2025 12:21"), lines   # in the villa's time


def test_an_answer_puts_behind_it_what_came_before_it_in_either_zone(tmp_path):
    from datetime import datetime, timezone
    cf, st = facts(tmp_path)
    st.set_chat_facts(CHAT, {"items": [
        {"at": "2025-01-10T12:19:31+08:00", "said": "before the answer."},
        {"at": "2025-01-10T12:30:00+08:00", "said": "after the answer."}]})
    cf.told(CHAT, datetime(2025, 1, 10, 4, 20, 12, tzinfo=timezone.utc))
    assert [i["said"] for i in st.chat_facts(CHAT)["items"]] == ["after the answer."]
