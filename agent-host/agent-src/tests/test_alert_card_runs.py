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
SUMMARY = "⚡ Phase C high\nPhase C 4580 W\nAbove 4000 W, Held 15min"
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
    # owner, 2026-10-18, #55 "each chat its own steps" (reversing part of 2026-10-11 "one incident, one picture"): the
    # steps to the FM are listed in the FM's chat, never in the owner's group
    hist = head_text(agent.notices.heading(FM_CHAT, 1)).split("\n")[2:]
    assert hist and all(ln.endswith(" (to: FM)") for ln in hist), hist
    assert not any(ln.endswith(" (to: FM)") for ln in head_text(agent.notices.heading(GROUP, 1)).split("\n")[2:])


def test_a_p1_names_both_roles_from_its_first_message(agent):
    rule(agent, "opened", 1, 500, priority="P1")
    assert card(agent, GROUP).split("\n")[1] == "To: Owner & FM"


def test_the_rules_all_clear_and_the_closing_note_are_one_line(agent):
    # point 2: "Update sent 15:40 to Owner" and "Closing note sent 15:40 to Facility Manager" for one end
    rule(agent, "opened", 1, 500)
    rule(agent, "resolved", 1, 501)
    # read where these steps went (owner, 2026-10-18, #55 "each chat its own steps"): the FM's chat
    hist = head_text(agent.notices.heading(FM_CHAT, 1)).split("\n")[2:]
    assert len(hist) == 2 and re.fullmatch(rf"- Alert sent {T} \(to: FM\)", hist[0]), hist
    assert re.fullmatch(rf"- Closing note sent {T} \(to: FM\)", hist[1]), hist
    assert not any("Update sent" in ln for ln in hist)


def test_a_run_that_came_back_starts_at_a_back_at_line_and_a_reminder_carries_its_own_time(agent):
    rule(agent, "opened", 1, 500)
    rule(agent, "resolved", 1, 501)
    rule(agent, "opened", 2, 502)                       # back within the reopen window: the same #1
    assert set(agent.thread.shown(1)) == {GROUP, FM_CHAT}
    back = card(agent, GROUP)
    assert back.startswith("#1-P2 (existing)\nTo: FM\n")
    assert re.fullmatch(rf"Back at {T}, Back again: 2 times in 7 days \(to: FM\)",
                        status(back).removeprefix("⚠️ ⚙️ ")), status(back)
    before = card(agent, GROUP)
    tick(agent, 20)                                     # the reminder: to the FM alone
    # owner, 2026-10-18, #55 "each chat its own steps" (reversing part of 2026-10-11 "one incident, one picture"): a
    # step to the FM leaves the owner's group copy as it was — no edit, no line
    assert card(agent, GROUP) == before
    group = card(agent, FM_CHAT)                        # the FM's copy tells it
    # point 1: the bottom line says its own step — never "Reminder: no answer after 15min" alone under 18:03
    assert re.fullmatch(rf"⚠️ ⚙️ Reminder sent {T}, No answer after 15min \(to: FM\)", status_lines(group)[-1]), group
    lines = status_lines(group)
    # ... and is told once: the history above it stops before it (drawn as it stood before this step)
    assert sum("Reminder sent" in ln for ln in lines) == 1, lines
    # point 3: the second run starts at its own "- Back at" line, shaped like every other step (owner, 2026-10-17,
    # #51: "— Came back … —" then "- Came-back alert sent …" were two shapes for one moment; reworded 2026-10-18, #52:
    # the count after a comma, whom in brackets); A: "FM", never "Facility Manager"
    assert re.fullmatch(rf"- Back at {T}, 2nd time in 7 days \(to: FM\)", lines[2]), lines
    assert lines[1].startswith("- Closing note sent") and lines[3].startswith("⚠️ ⚙️ Reminder sent"), lines
    assert not any("ame back" in ln or "ame-back" in ln or ln.startswith("—") for ln in lines), lines
    assert "Facility Manager" not in group and "facility manager" not in group
    fm_before = card(agent, FM_CHAT)
    tick(agent, 50)                                     # the escalation: to the owner — in the group, not the FM's chat
    esc = card(agent, GROUP)
    lines = status_lines(esc)
    assert re.fullmatch(rf"⚠️ ⚙️ Escalation sent {T}, No answer from FM after 45min \(to: Owner\)", lines[-1]), lines
    assert not any("(to: FM)" in ln for ln in lines), lines     # the FM's steps are the FM chat's
    # and the owner's step leaves the FM's copy's own lines alone — only "To:" follows the incident, which now involves
    # the owner (architecture review, 2026-10-19: the title word and "To:" are the incident's, the same in every copy)
    fm_now = card(agent, FM_CHAT)
    assert status_lines(fm_now) == status_lines(fm_before) and fm_now.split("\n")[0] == fm_before.split("\n")[0]
    assert fm_before.split("\n")[1] == "To: FM" and fm_now.split("\n")[1] == "To: Owner & FM", fm_now


def test_the_back_line_counts_the_runs_and_an_older_record_has_none():
    from datetime import datetime
    from vesta_agent.notice import Notices, _ordinal
    n = Notices(None, lambda: None, "UTC")
    at = datetime.fromisoformat("2026-10-16T18:03:00+00:00")
    assert n.step("back", {"fm"}, at, 3) == "Back at 16/10/2026 18:03, 3rd time in 7 days (to: FM)"
    assert n.step("back", {"fm"}, at) == "Back at 16/10/2026 18:03 (to: FM)"
    assert n.step("reminder", {"fm"}, at, 3) == "Reminder sent 16/10/2026 18:03 (to: FM)"
    assert [_ordinal(k) for k in (1, 2, 3, 4, 11, 12, 13, 21, 22, 101)] == \
        ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]


def test_only_a_later_step_says_itself_on_the_bottom_line():
    from vesta_agent.notice import Notices
    n = Notices(None, lambda: None, "UTC")
    at = datetime(2026, 10, 16, 18, 20, tzinfo=timezone.utc)
    assert n.bottom("reminder", {"fm"}, "No answer after 15min", at) == \
        "Reminder sent 16/10/2026 18:20, No answer after 15min (to: FM)"
    assert n.bottom("escalated", {"owner"}, "", at) == "Escalation sent 16/10/2026 18:20 (to: Owner)"
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
        assert said == (f"{line.removesuffix(' (to: FM)')}, why (to: FM)" if step.timed else "why"), stage
        assert [s["note"] for s in n.story(7)] == ([f"{step.sent} (to: Facility Manager)"] if step.noted else []), stage


def follows(v, blueprint: str, rule_id: str, mid: int):
    """A rule on "Follow Vesta Agent Setting": its own message in the group, then its event with no priority."""
    ctx = f"RUN-{rule_id}"
    run(v.on_ha_event("telegram_sent", {"chat_id": GROUP, "message_id": mid, "bot": BOT, CONTEXT_KEY: ctx}))
    run(v.on_ha_event("vesta_critical_event", {
        "blueprint": blueprint, "rule_id": rule_id, "incident_id": f"{rule_id}-1", "phase": "opened",
        "severity": "critical", "priority": "", "label": "Check", "entities": ["sensor.x"], "summary": "🔔 Check\nx",
        "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: ctx}))


@pytest.mark.parametrize("blueprint, rule_id, prio, to", [
    ("critical_battery", "automation.critical_battery_low_battery", "P1", "To: Owner & FM"),
    ("audit_config_integrity", "automation.audit_config_integrity_critical_automation_off", "P2", "To: FM")])
def test_a_follow_rule_of_a_kind_with_no_route_is_retitled_by_its_names_priority(agent, blueprint, rule_id, prio, to):
    # owner, 2026-10-19: the villa's own message cannot know the priority of a rule on "Follow" (its "To:" is the
    # villa-wide setting); the agent's card replaces it in the group with the priority its name gives, and its "To:"
    follows(agent, blueprint, rule_id, 500)
    grp = card(agent, GROUP)
    assert grp.split("\n")[0].startswith(f"#1-{prio} (new)") and grp.split("\n")[1] == to, grp
    # the villa's own message is taken over: rewritten in place (P2: no buttons for the owner), or replaced by the card
    # with the owner's buttons (P1) — never left with its villa-wide "To:"
    assert agent.thread.shown(1)[GROUP]["mid"] == 500 or (GROUP, 500) in agent.tg.deleted
    assert FM_CHAT in agent.thread.shown(1)                            # the FM is told either way


def test_a_new_number_within_the_week_counts_it_too():
    # architecture review, 2026-10-19: a return after reopen_hours is a NEW number (owner, 2026-10-18), and its card
    # and the digest said "(again: 3 times in 7 days)" while its Telegram message said New, as if the first
    from datetime import datetime
    from vesta_agent.notice import Notices
    at = datetime.fromisoformat("2026-10-16T18:03:00+00:00")
    n = Notices(None, lambda: None, "UTC")
    assert n.step("new", {"fm"}, at, 3) == "Alert sent 16/10/2026 18:03, 3rd time in 7 days (to: FM)"
    assert n.step("new", {"fm"}, at, 1) == "Alert sent 16/10/2026 18:03 (to: FM)"

    class Kept:                                                      # the state: an incident's history, kept
        def __init__(self):
            self.h = {}

        def incident_history(self, i):
            return list(self.h.get(i, []))

        def set_incident_history(self, i, h):
            self.h[i] = h
    kept = Kept()
    n = Notices(kept, lambda: None, "UTC", runs=lambda iid: {7: 3, 8: 1}[iid])
    n.record(7, "new", [(FM, "fm")], at)
    n.record(8, "new", [(FM, "fm")], at)
    n.record(7, "reminder", [(FM, "fm")], at)
    assert [h.get("run") for h in kept.incident_history(7)] == [3, None]      # ONE count: problems.incident_runs
    assert kept.incident_history(8)[0]["run"] == 1


def test_a_new_number_of_an_alert_seen_this_week_says_so_on_its_card(agent):
    # the same rule alerted yesterday under another number (closed hours ago: past reopen_hours): today's "New" card
    # counts the week on its first line, as the Cockpit's "(again: 2 times in 7 days)" and the digest do
    from vesta_shared.store import Store
    st = Store(agent.s.store_path)
    day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    old = st.new_incident(f"{RULE}|sensor.phase_c", RULE, "sensor.phase_c", "P2", {"message": "Phase C high"}, day_ago.isoformat())
    st.update_incident(old, closed_at=(day_ago + timedelta(minutes=30)).isoformat(), state="resolved")
    rule(agent, "opened", 2, 500)
    hist = head_text(agent.notices.heading(FM_CHAT, old + 1)).split("\n")[2:]
    assert re.fullmatch(rf"- Alert sent {T}, 2nd time in 7 days \(to: FM\)", hist[0]), hist
