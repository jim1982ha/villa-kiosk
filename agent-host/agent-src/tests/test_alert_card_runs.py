"""An alert card read by the owner (2026-10-16, alert #43): a rule's alert in the group, its all-clear, the same alert
back within the reopen window, then a reminder — and what each card says of it. Synthetic villa; ids invented.

The six points of the owner's page, as checked here:
1. a step's bottom line says what was sent, when and to whom — a quiet edit of the group's copy never reads as if it
   happened at that message's own time — and the step is not then told twice;
2. the rule's all-clear and the closing note to the facility manager are ONE line;
3. a new run of the alert starts at its own "- Back at …" line, shaped like every other step;
4. "To:" counts the rule's own chat from the first message — REVERSED by the owner on 2026-10-17: "To:" follows the
   priority (the roles it reaches, then whoever a later step went to), whatever chat the rule posts in;
A. the roles read "FM" in every line of an alert card's "Status:" and its "To:".
(5, the rule's own text, and 6, the buttons in the group, are left as they are: the report says why.)"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

import pytest

from helpers import make_agent, status
from ha_fake import FakeHA, tool
from telegram_fake import BOT
from vesta_agent.layout import head_text
from vesta_agent.ha_events import CONTEXT_KEY

OWNER, FM = 111, 222
GROUP, FM_CHAT = -100123, 222
RULE = "automation.critical_condition_phase"
SUMMARY = "⚡ Phase C high\nPhase C 4580 W\nAbove 4000 W, Held 15 min"
T = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Owner", "role": "owner", "language": "en"},
                                         {"telegram_id": FM, "name": "Wayan", "role": "fm", "language": "en"}],
                              "chats": {"owner": GROUP, "fm": FM_CHAT}}, skills=["alert-desk"],
                   reader=FakeHA(tools=[tool("ha_get_state")]))
    v.bot_username = BOT["username"]
    return v


def rule(v, phase: str, run_no: int, mid: int, priority: str | None = None):
    """The villa's rule: its own message in the group, then its event — one run, one context."""
    ctx = f"RUN-{run_no}-{phase}"
    run(v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": mid, "bot": BOT, CONTEXT_KEY: ctx}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": "critical_condition", "rule_id": RULE, "incident_id": f"{RULE}-{run_no}", "phase": phase,
        "severity": "critical", "label": "Phase C high", "entities": ["sensor.phase_c"], "summary": SUMMARY,
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: ctx, **({"priority": priority} if priority else {})}))


def tick(v, minutes):
    at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    run(v.run_code_job(v.skills.get("alert-desk"), f"desk.py tick --now {at}", 60))


def card(v, chat) -> str:
    return v.thread.shown(1)[chat]["text"]


def status_lines(text: str) -> list[str]:
    return text.split("\n\nStatus:\n", 1)[1].split("\n")


def test_to_follows_the_priority_never_the_chat_the_rule_posts_in(agent):
    # owner, 2026-10-17 (told it reverses 2026-10-16's point 4): a P2 reaches the FM — "To: FM" in the group too, where
    # the owner reads it; once escalated, the owner is named
    rule(agent, "opened", 1, 500)
    assert card(agent, GROUP).split("\n")[1] == "To: FM"
    assert card(agent, FM_CHAT).split("\n")[1] == "To: FM"
    tick(agent, 20)
    tick(agent, 50)
    assert card(agent, GROUP).split("\n")[1] == "To: Owner & FM"


def test_an_answer_in_the_group_never_widens_to(agent):
    # owner, 2026-10-17: a copy for no role (the answer to a press, in its own chat) is about the roles the incident
    # already reached — Done pressed in the group the owner reads must not turn a P2's "To: FM" into "Owner & FM"
    rule(agent, "opened", 1, 500)
    run(agent.on_ha_event("telegram_callback", {"id": "cb", "data": "i:1:done", "chat_id": GROUP, "user_id": OWNER,
                                                "message": {"message_id": 500, "chat": {"id": GROUP}}, "bot": BOT}))
    assert agent.tg.toasts, "a press on the rule's own copy, taken over, is the agent's to answer"
    assert "(closed)" in card(agent, GROUP).split("\n")[0], card(agent, GROUP)
    assert card(agent, GROUP).split("\n")[1] == "To: FM", card(agent, GROUP)
    hist = head_text(agent.notices.heading(GROUP, 1)).split("\n")[2:]
    assert hist and all(ln.endswith(" to FM") for ln in hist), hist


def test_a_p1_names_both_roles_from_its_first_message(agent):
    rule(agent, "opened", 1, 500, priority="P1")
    assert card(agent, GROUP).split("\n")[1] == "To: Owner & FM"


def test_the_rules_all_clear_and_the_closing_note_are_one_line(agent):
    # point 2: "Update sent 15:40 to Owner" and "Closing note sent 15:40 to Facility Manager" for one end
    rule(agent, "opened", 1, 500)
    rule(agent, "resolved", 1, 501)
    hist = head_text(agent.notices.heading(GROUP, 1)).split("\n")[2:]
    assert len(hist) == 2 and re.fullmatch(rf"- Alert sent {T} to FM", hist[0]), hist
    assert re.fullmatch(rf"- Closing note sent {T} to FM", hist[1]), hist
    assert not any("Update sent" in ln for ln in hist)


def test_a_run_that_came_back_starts_at_a_back_at_line_and_a_reminder_carries_its_own_time(agent):
    rule(agent, "opened", 1, 500)
    rule(agent, "resolved", 1, 501)
    rule(agent, "opened", 2, 502)                       # back within the reopen window: the same #1
    assert set(agent.thread.shown(1)) == {GROUP, FM_CHAT}
    back = card(agent, GROUP)
    assert back.startswith("#1-P2 (existing)\nTo: FM\n")
    assert re.fullmatch(rf"Back at {T}, alert sent to FM — Back again: 2 times in 7 days",
                        status(back).removeprefix("⚠️ ⚙️ ")), status(back)
    tick(agent, 20)                                     # the reminder: to the FM; the group's copy edited quietly
    group = card(agent, GROUP)
    # point 1: the bottom line says its own step — never "Reminder: no answer after 15 min" alone under 18:03
    assert re.fullmatch(rf"⚠️ ⚙️ Reminder sent {T} to FM — No answer after 15 min", status_lines(group)[-1]), group
    assert card(agent, FM_CHAT) == group                # one incident, one picture
    lines = status_lines(group)
    # ... and is told once: the history above it stops before it (drawn as it stood before this step)
    assert sum("Reminder sent" in ln for ln in lines) == 1, lines
    # point 3: the second run starts at its own "- Back at" line, shaped like every other step (owner, 2026-10-17,
    # #51: "— Came back … —" then "- Came-back alert sent …" were two shapes for one moment); A: "FM", never "Facility Manager"
    assert re.fullmatch(rf"- Back at {T} \(2nd time in 7 days\), alert sent to FM", lines[2]), lines
    assert lines[1].startswith("- Closing note sent") and lines[3].startswith("⚠️ ⚙️ Reminder sent"), lines
    assert not any("ame back" in ln or "ame-back" in ln or ln.startswith("—") for ln in lines), lines
    assert "Facility Manager" not in group and "facility manager" not in group
    tick(agent, 50)                                     # the escalation: the reminder joins the history, once
    esc = card(agent, GROUP)
    lines = status_lines(esc)
    assert re.fullmatch(rf"- Reminder sent {T} to FM", lines[-2]), lines
    assert re.fullmatch(rf"⚠️ ⚙️ Escalation sent {T} to Owner — No answer from FM after 45 min", lines[-1]), lines
    assert sum("Reminder sent" in ln for ln in lines) == 1


def test_the_back_line_counts_the_runs_and_an_older_record_has_none():
    from datetime import datetime
    from vesta_agent.notice import Notices, _ordinal
    n = Notices(None, lambda: None, "UTC")
    at = datetime.fromisoformat("2026-10-16T18:03:00+00:00")
    assert n.step("back", {"fm"}, at, 3) == "Back at 16/10/2026 18:03 (3rd time in 7 days), alert sent to FM"
    assert n.step("back", {"fm"}, at) == "Back at 16/10/2026 18:03, alert sent to FM"
    assert n.step("reminder", {"fm"}, at, 3) == "Reminder sent 16/10/2026 18:03 to FM"
    assert [_ordinal(k) for k in (1, 2, 3, 4, 11, 12, 13, 21, 22, 101)] == \
        ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]


def test_only_a_later_step_says_itself_on_the_bottom_line():
    from vesta_agent.notice import Notices
    n = Notices(None, lambda: None, "UTC")
    at = datetime(2026, 10, 16, 18, 20, tzinfo=timezone.utc)
    assert n.bottom("reminder", {"fm"}, "No answer after 15 min", at) == \
        "Reminder sent 16/10/2026 18:20 to FM — No answer after 15 min"
    assert n.bottom("escalated", {"owner"}, "", at) == "Escalation sent 16/10/2026 18:20 to Owner"
    for stage in ("new", "closed", "update", "pressed", None):
        assert n.bottom(stage, {"owner", "fm"}, "Cleared on 16/10/2026 18:20.", at) == "Cleared on 16/10/2026 18:20."


def test_every_step_is_one_line_of_the_step_table_and_said_the_same_everywhere():
    # architecture review, 2026-10-17: a step was named in five tables; a new one is ONE line of STEPS, and every reader
    # — the history, the title, the bottom line, the Kiosk's card, the stages a skill may set — follows it
    from vesta_agent.notice import Notices
    from vesta_shared.message_format import STEPS
    from vesta_shared.result import STAGES, message

    class Hist:
        def __init__(self):
            self.h = {}

        def incident_history(self, iid):
            return list(self.h.get(iid, []))

        def set_incident_history(self, iid, v):
            self.h[iid] = v

    at = datetime(2026, 10, 16, 18, 20, tzinfo=timezone.utc)
    for stage, step in STEPS.items():
        state = Hist()
        n = Notices(state, lambda: None, "UTC")
        assert stage in STAGES and message("fm", "x", incident=7, stage=stage)["stage"] == stage
        assert head_text(n.heading(-1, 7, to="fm", stage=stage)).split("\n")[0] == f"#7 ({step.title})"
        n.record(7, stage, [(-1, "fm")], at)
        line = step.line.format(sent=step.sent, at="16/10/2026 18:20", times="", who="FM")
        assert head_text(n.heading(-1, 7, to="fm")).split("\n")[-1] == f"- {line}", stage
        said = n.bottom(stage, {"fm"}, "why", at)
        assert said == (f"{line} — why" if step.timed else "why"), stage
        assert [s["note"] for s in n.story(7)] == ([f"{step.sent} to Facility Manager"] if step.noted else []), stage
