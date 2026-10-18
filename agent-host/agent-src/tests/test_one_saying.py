"""One saying per thing (owner, 2026-10-11, the laundry door's #21: "few information appears to be redundant and at
different places, so it's hard to understand what the agent wants to say").

The message read: "For: the Owner, P2 Incident: Follow Up #21" / "First time seen on …, to the Owner, JM" / the alert /
"🔶 Laundry Room door unlocked — no longer tracked after 30 min ("Repeat after"); the next breach alerts again." /
"Still not clear, and the rule has stopped watching it". Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import importlib.util
import os
import re
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from vesta_agent.layout import head_text
from vesta_shared.store import Store

spec = importlib.util.spec_from_file_location("desk27", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
OWNER, FM = 111, 222
ALERT = "🔓 Laundry door unlocked\nLaundry lock is locked\nHeld 1 min"
GAVE_UP = '🔶 Laundry door unlocked — no longer tracked after 30 min ("Repeat after"); the next breach alerts again.'


def ev(phase, **extra):
    return {"blueprint": "critical_condition", "rule_id": "automation.laundry", "incident_id": "automation.laundry-1",
            "phase": phase, "severity": "critical", "label": "Laundry door unlocked", "entities": ["lock.laundry"],
            "mode": "state", "bad_states": ["locked"], **extra}


def test_a_rule_that_gave_up_is_said_once_in_the_desks_words(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    desk.intake(store, ev("opened", summary=ALERT), T0, occupancy_reader=lambda: "x")
    out = desk.intake(store, ev("abandoned", summary=GAVE_UP, still_true=True), T0 + timedelta(minutes=30),
                      occupancy_reader=lambda: "x")
    (owner,) = [s for s in out["send"] if s["to"] == "owner"]
    for m in (owner, out["ha_messages"][0]):
        assert "no longer tracked" not in m["text"] and "Repeat after" not in m["text"]   # Home Assistant's words: gone
        assert m["text"].count("Laundry door unlocked") == 1                              # its name once
        # owner, 2026-10-17 (#45): a still-there notice, sent where an escalation goes — never a second "Escalation sent";
        # its line says its own time, so the words do not repeat it
        assert m["status"] == "Still not fixed (will close itself once fixed or press Done)"
        assert m["stage"] == "still", m
    assert owner.get("keyboard") and [s["to"] for s in out["send"]] == ["owner"]


def test_a_rule_alerting_again_while_open_is_a_still_there_alert_never_a_reminder(tmp_path):
    # owner, 2026-10-17 (#45): "Reminder sent 11:38 to Owner & FM" — the load had moved to another phase and the
    # villa's rule alerted again; a reminder is only the desk's own chase of the facility manager
    store = Store(str(tmp_path / "s.sqlite"))
    desk.intake(store, ev("opened", summary=ALERT), T0, occupancy_reader=lambda: "x")
    out = desk.intake(store, ev("opened", summary=ALERT), T0 + timedelta(hours=2), occupancy_reader=lambda: "x")
    assert out["decision"] == "repeat"
    assert {m["stage"] for m in out["send"] + out["ha_messages"]} == {"still"}


def test_home_assistants_all_clear_is_said_in_the_desks_words(tmp_path):
    store = Store(str(tmp_path / "s.sqlite"))
    desk.intake(store, ev("opened", summary=ALERT), T0, occupancy_reader=lambda: "x")
    out = desk.intake(store, ev("resolved", summary="✅ Laundry door unlocked — resolved after 4 min"),
                      T0 + timedelta(minutes=5), occupancy_reader=lambda: "x")
    (ha,) = out["ha_messages"]
    assert ha["status"] == "Cleared on {time}." and ha["text"].count("Laundry door unlocked") == 1


def test_the_heading_names_the_incident_first_and_what_was_sent_to_whom(tmp_path):
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "JM", "role": "fm"}]})
    run = asyncio.run
    run(v.outcome.carry_out({"send": [R.message("fm", ALERT, incident=21, buttons=True, stage="new")]}, "alert-desk"))
    run(v.outcome.carry_out({"send": [R.message("fm", ALERT, incident=21, stage="reminder", status="Reminder")]}, "alert-desk"))
    run(v.outcome.carry_out({"send": [R.message("owner", ALERT, incident=21, stage="escalated", status="x")]}, "alert-desk"))
    # owner, 2026-10-11: "#1-P2 (existing)", "To:", the alert, "Status:" — the history with a dash per line, then where
    # it stands (owner, 2026-10-13: in the same block, and "To:" says roles, never names)
    text = v.tg.sent[-1][1]
    title, to, *rest = text.split("\n")
    assert (title, to) == ("#21 (existing)", "To: Owner & FM")      # every role it went to ("FM": owner, 2026-10-16)
    # owner, 2026-10-18, #55 "each chat its own steps" (reversing part of 2026-10-11 "one incident, one picture"): the
    # owner's escalation lists none of the FM's steps — its own step, what, when, to whom (owner, 2026-10-16)
    status_block = text.split("\n\nStatus:\n")[1]
    assert re.fullmatch(r"⚠️ ⚙️ Escalation sent \d\d/\d\d/\d{4} \d\d:\d\d — x \(to: Owner\)", status_block), text
    # the FM's chat holds them, a dash per line
    history = [ln for ln in head_text(v.notices.heading(FM, 21)).split("\n")[2:] if ln.startswith("- ")]
    assert re.fullmatch(r"- Alert sent \d\d/\d\d/\d{4} \d\d:\d\d \(to: FM\)", history[0])
    assert re.fullmatch(r"- Reminder sent \d\d/\d\d/\d{4} \d\d:\d\d \(to: FM\)", history[1]) and len(history) == 2
    assert not any(w in text for w in ("For:", "First time seen", ", to ", "Follow Up", "-------"))


def test_a_copy_settled_by_a_press_is_headed_closed_once_the_desk_closes_it(tmp_path):
    # owner, 2026-10-11: the group's copy kept "New" above "Done pressed by Fabien" — the press settles every copy, the
    # desk closes the incident just after
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"}]})
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "automation.r", "lock.a", "P2", {"message": "Door unlocked"})
    run = asyncio.run
    run(v.outcome.carry_out({"send": [R.message("fm", "Door unlocked", incident=iid, buttons=True, stage="new")]}, "alert-desk"))
    run(v.thread.close(iid, "Done pressed by Fabien on {time}."))                      # the press
    # its status replaced, the copy lists every earlier step — the alert sent — and is no longer "new" (owner,
    # 2026-10-15: a replaced status dropped the step it showed)
    assert v.tg.edits[-1][2].split("\n")[0] == f"#{iid}-P2 (existing)"
    assert "- Alert sent " in v.tg.edits[-1][2] and "(to: FM)" in v.tg.edits[-1][2]
    st.update_incident(iid, closed_at=datetime.now(timezone.utc).isoformat(), state="done")   # the desk closes it
    run(v.thread.close(iid, "Done pressed by Fabien on {time}."))                      # the desk's settle
    assert v.tg.edits[-1][2].startswith(f"#{iid}-P2 (closed)\nTo: FM\n")
    assert v.tg.edits[-1][2].endswith("Done pressed by Fabien on " + v.tg.edits[-1][2].rsplit(" on ", 1)[1])
    n = len(v.tg.edits)
    run(v.thread.close(iid, "x"))
    assert len(v.tg.edits) == n                                                        # once headed so: nothing more


def test_one_result_records_one_history_line_per_kind_of_notice(tmp_path):
    # owner, 2026-10-11: "Escalated … to Jim, Fabien" — Fabien had only been told his own "Need help" was passed on
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"}]})
    run = asyncio.run
    run(v.outcome.carry_out({"send": [R.message("fm", ALERT, incident=4, buttons=True, stage="new")]}, "alert-desk"))
    run(v.outcome.carry_out({"send": [R.message("owner", ALERT, incident=4, stage="escalated", status="over to you"),
                                      R.message("fm", ALERT, incident=4, stage="update", status="owner told")]}, "alert-desk"))
    hist = [(h["stage"], v.notices._roles(h)) for h in v.state.incident_history(4)]
    assert hist == [("new", {"fm"}), ("escalated", {"owner"}), ("update", {"fm"})]


def test_the_bottom_line_shows_the_stage_by_its_icon():
    # owner, 2026-10-11: "⚠️ for New alert, ⚠️ ⚙️ for Follow-up, 🆘 for Need help pressed, ☑️ for Closed if the device logs
    # no answers, ✅ for Closed when there is no issue"
    from vesta_agent import layout
    def bottom(head, status="", mark=None):
        return layout.render(layout.parts(head=head, body="Door unlocked", status=status, mark=mark)).rsplit("\n", 1)[1]
    assert bottom("#3-P2 (new)\nTo: JM") == "⚠️ New alert"
    assert bottom("#3-P2 (existing)\nTo: JM", "Reminder: no answer after 15 min") == "⚠️ ⚙️ Reminder: no answer after 15 min"
    assert bottom("#3-P2 (existing)\nTo: JM", "Need help pressed by Fabien: over to you.", "help") == \
        "🆘 Need help pressed by Fabien: over to you."
    assert bottom("#3-P2 (closed)\nTo: JM", "Done pressed by Fabien. Note: VESTA cannot check this one.",
                  "unchecked") == "☑️ Done pressed by Fabien. Note: VESTA cannot check this one."
    assert bottom("#3-P2 (closed)\nTo: JM", "Cleared on 11/10/2026 10:27.") == \
        "✅ Cleared on 11/10/2026 10:27."
    assert bottom("#3-P2 (closed)\nTo: JM") == "✅ Closed: nothing more to do"
    assert bottom("#3-P2 (existing)\nTo: JM", "x", "unchecked") == "⚠️ ⚙️ x"         # ☑️ only on a closure
    # a copy sent before 0.12.152 ("For: JM, P2 Incident: Follow Up #3") is never drawn half old, half new: it gets
    # the new heading whole when it changes (Notices.retitle — test_an_old_copy_gets_the_new_heading_whole)
    # a "For: JM" heading recorded before 0.12.175 is laid out in the one layout, under UNTITLED (owner, 2026-10-12)
    assert layout.render(layout.parts(head="For: JM", body="Weekly report", status="Sent")) == \
        "Message from VESTA\nTo: JM\nWeekly report\n\nStatus:\nSent"
    # a new status brings its own mark: "Need help" replaced by "Done pressed" is no longer 🆘
    helped = layout.parts(head="#3-P2 (closed)\nTo: JM", body="b", status="Need help pressed", mark="help")
    assert layout.render(layout.changed(helped, status="Done pressed by Jim.")).endswith("\n✅ Done pressed by Jim.")


def test_need_help_and_an_unchecked_closure_carry_their_icon_end_to_end(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"}]}, skills=["alert-desk"])
    st = Store(v.s.store_path)
    now = datetime.now(timezone.utc)
    iid = desk.intake(st, ev("opened", summary=ALERT), now, occupancy_reader=lambda: "x")["incident_id"]
    asyncio.run(v.outcome.carry_out(desk.reply(st, iid, "need_help", "fm", now, name="Fabien"), "alert-desk"))
    # the owner's escalation says its step first (owner, 2026-10-16): "🆘 Escalation sent … to Owner — Need help …"
    assert all(t.rsplit("\n", 1)[1].startswith("🆘 ") and "Need help pressed by Fabien on " in t.rsplit("\n", 1)[1]
               for _, t, _ in v.tg.sent[-2:])
    asyncio.run(v.outcome.carry_out(desk.reply(st, iid, "done", "owner", now, name="Jim"), "alert-desk"))
    assert v.tg.edits[-1][2].rsplit("\n", 1)[1].startswith("✅ Done pressed by Jim on ")     # the owner's copy, settled
    # 10 min later the lock does not answer: closed, not checked
    class Silent:
        def states(self, ids):
            return {}
    asyncio.run(v.outcome.carry_out(desk.tick(st, now + timedelta(minutes=11), client=Silent()), "alert-desk"))
    assert v.tg.sent[-1][1].rsplit("\n", 1)[1].startswith("☑️ Done pressed by Jim. Note: VESTA cannot check this one")


def test_telegram_shows_the_title_in_bold_the_alert_quoted_and_the_status_quoted_in_italics_in_one_block():
    # owner, 2026-10-11: "the first line underlined", "text inside each section in quote style", "everything below the
    # Status line in italic" — Telegram's own markers over the text sent as it is (no markup to break on "<" or "_").
    # Owner, 2026-10-13: the title in bold (underlined, it read as a link); the history and where it stands ONE block
    from vesta_agent import layout
    from vesta_agent.telegram import Telegram
    from vesta_shared.message_format import telegram_entities
    from vesta_shared.messaging import tg_len
    tg, calls = Telegram("t0k3n"), []

    async def api(method, **data):
        calls.append((method, data))
        return {"message_id": 7}
    tg.api = api
    alert = "🚪 Gate <relay> released\nGate_Relay is off\nWhat to do: check it."
    history = "- Alert sent 11/10/2026 05:23 to Owner & Facility Manager\n- Escalation sent 11/10/2026 05:23 to Owner"
    bottom = "⚠️ ⚙️ Still not right when the alert stopped watching it on 11/10/2026 05:23."
    status = f"{history}\n{bottom}"
    text = f"#1-P2 (existing)\nTo: Owner\n{alert}\n\nStatus:\n{status}"
    asyncio.run(tg.send(1, text))
    asyncio.run(tg.edit(1, 7, text))
    asyncio.run(tg.send(1, "The pool is fine: 27 °C."))                          # an answer to a person: no heading
    (m1, d1), (m2, d2), (m3, d3) = calls

    def at(part):
        return tg_len(text[:text.index(part)])
    assert m1 == "sendMessage" and d1["text"] == text and d1["entities"] == [
        {"type": "bold", "offset": 0, "length": tg_len("#1-P2 (existing)")},
        {"type": "blockquote", "offset": at(alert), "length": tg_len(alert)},
        {"type": "blockquote", "offset": at(status), "length": tg_len(status)},
        {"type": "italic", "offset": at(status), "length": tg_len(status)}]
    assert m2 == "editMessageText" and d2["entities"] == d1["entities"]
    assert "entities" not in d3                                                   # not in the layout: as it is
    # every other message sent on its own is in the same layout, so styled the same (owner, 2026-10-12: one layout)
    request = layout.render(layout.parts(head="Approval request\nTo: JM", lead="Intrusion suspected.", body="Turn on Siren?",
                                         status="Waiting for approval by the owner"))
    assert request == ("Approval request\nTo: JM\nIntrusion suspected.\nTurn on Siren?\n\nStatus:\n"
                       "Waiting for approval by the owner")
    assert [e["type"] for e in telegram_entities(request)] == ["bold", "blockquote", "blockquote", "italic"]
    # the first alert: no history yet, its status alone under "Status:"
    first = "#1-P2 (new)\nTo: Jim\nDoor unlocked\n\nStatus:\n⚠️ New alert"
    assert [e["type"] for e in telegram_entities(first)] == ["bold", "blockquote", "blockquote", "italic"]


def test_a_copy_turning_closed_turns_green(tmp_path):
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"}]})
    st = Store(v.s.store_path)
    iid = st.new_incident("k", "automation.r", "lock.a", "P2", {"message": "Door unlocked"})
    asyncio.run(v.outcome.carry_out({"send": [R.message("fm", "Door unlocked", incident=iid, buttons=True, stage="new")]}, "alert-desk"))
    assert v.tg.sent[-1][1].endswith("\n\nStatus:\n⚠️ New alert")
    st.update_incident(iid, closed_at=datetime.now(timezone.utc).isoformat(), state="resolved")
    asyncio.run(v.thread.close(iid, "Cleared on {time}."))
    assert v.tg.edits[-1][2].rsplit("\n", 1)[1].startswith("✅ Cleared on ")


def test_one_incident_one_picture_in_every_chat_of_the_same_people(tmp_path):
    # owner, 2026-10-11: "this should be exactly the same, since we are speaking about the same incident" — kept for
    # every chat a step went to. REVERSED for the others on 2026-10-18 (#55, "each chat its own steps"): a reminder to
    # the facility managers leaves the owner's group copy as it was — no edit, no FM line
    from vesta_shared import result as R
    GROUP, JM2 = -100123, 333
    v = make_agent(tmp_path, {"people": [{"telegram_id": GROUP, "name": "VillaGroup", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"},
                                         {"telegram_id": JM2, "name": "JM", "role": "fm"}]})
    run = asyncio.run
    run(v.outcome.carry_out({"send": [R.message("owner", ALERT, incident=5, buttons=True, stage="new"),
                                      R.message("fm", ALERT, incident=5, buttons=True, stage="new")]}, "alert-desk"))
    run(v.outcome.carry_out({"send": [R.message("fm", ALERT, incident=5, buttons=True, stage="reminder",
                                                status="No answer after 15 min")]}, "alert-desk"))
    shown = {c: r["text"] for c, r in v.thread.shown(5).items()}
    assert set(shown) == {GROUP, FM, JM2} and shown[FM] == shown[JM2], shown     # the two FMs: one picture
    text = shown[FM]
    # every role it went to, never a name (owner, 2026-10-13)
    assert text.startswith("#5 (existing)\nTo: Owner & FM\n") and \
        re.search(r"\n⚠️ ⚙️ Reminder sent \d\d/\d\d/\d{4} \d\d:\d\d — No answer after 15 min \(to: FM\)$", text), text
    # the group: neither sent the reminder nor edited — its copy as first sent, its buttons kept
    first_group = next(t for c, t, _ in v.tg.sent if c == GROUP)
    assert not [c for c, _, _ in v.tg.sent[3:] if c == GROUP] and shown[GROUP] == first_group
    assert "Reminder" not in shown[GROUP] and not [e for e in v.tg.edits if e[0] == GROUP]
    group = v.thread.shown(5)[GROUP]
    assert group["buttons"] and not group["settled"]


def test_a_close_reaches_a_copy_without_buttons_too(tmp_path):
    # one incident, one picture (owner, 2026-10-11): a copy sent without buttons kept its old status at a close
    from vesta_shared import result as R
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "Fabien", "role": "fm"}]})
    asyncio.run(v.outcome.carry_out({"send": [R.message("owner", ALERT, incident=6, stage="new"),
                                              R.message("fm", ALERT, incident=6, buttons=True, stage="new")]}, "x"))
    assert not v.thread.shown(6)[OWNER]["buttons"]
    asyncio.run(v.thread.close(6, "Done pressed by Fabien on {time}."))
    # its status replaced: the copy is "existing" (its icon ⚠️ ⚙️) and lists the alert sent (owner, 2026-10-15)
    assert all(r["text"].rsplit("\n", 1)[1].startswith("⚠️ ⚙️ Done pressed by Fabien on ")
               and "\n- Alert sent " in r["text"] for r in v.thread.shown(6).values())


def test_an_old_copy_gets_the_new_heading_whole(tmp_path):
    # review 28: a copy sent before 0.12.152, settled, showed the old heading with the new icons and no style
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"}]})
    head = head_text(v.notices.retitle(9, "For: Fabien, P2 Incident: Follow Up #9\nAlert sent on 09/10/2026 13:12, to Fabien", FM))
    assert head.split("\n")[:2] == ["#9 (new)", "To: FM"]


def test_the_history_names_roles_and_keeps_its_first_alert(tmp_path):
    # review 28: after 20 notices the first alert vanished without a word. Owner, 2026-10-13: roles, never names — a
    # person leaving the People list changes nothing
    import yaml
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"},
                                         {"telegram_id": 444, "name": "Ketut", "role": "fm"}]})
    v.notices.record(5, "new", [(FM, "fm"), (444, "fm")])
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"},
                                   {"telegram_id": 555, "name": "Made", "role": "fm"}]}, f)
    for _ in range(25):
        v.notices.record(5, "reminder", [(FM, "fm"), (555, "fm")])
    lines = head_text(v.notices.heading(FM, 5, "fm")).split("\n")
    assert lines[1] == "To: FM" and lines[2].startswith("- Alert sent ") and lines[2].endswith(" (to: FM)")
    assert lines[3] == "- … 7 earlier notices" and len(lines) == 2 + 20


def test_a_heading_is_facts_and_a_heading_stored_as_text_reads_the_same():
    from vesta_agent import layout
    from vesta_shared.message_format import UNTITLED
    # architecture review, 2026-10-17: the heading was written as text and read back by patterns; it is facts now, and
    # a copy recorded before (0.12.229 and earlier) is read once, into the same facts — drawn the same, ✅ and all
    old = "#3-P2 (closed)\nTo: Owner & FM\n- Alert sent 16/10/2026 18:03 to Owner & FM"
    h = layout.head("#3-P2", "Owner & FM", ["- Alert sent 16/10/2026 18:03 to Owner & FM"], "closed")
    assert layout.head_of(old) == h and layout.head_text(h) == old
    for head in (old, h):
        text = layout.render(layout.parts(head=head, body="Door unlocked", status="Cleared."))
        assert text.split("\n")[0] == "#3-P2 (closed)" and text.endswith("\n✅ Cleared."), text
    assert layout.head_of("For: JM") == layout.head(UNTITLED, "JM")
    assert layout.head_of("Approval request\nTo: Owner")["word"] is None
    # a title that only LOOKS like a stage is never read as one once it is facts
    odd = layout.head("Pump (closed)", "Owner")
    assert layout.render(layout.parts(head=odd, body="b", status="s")).endswith("\ns")


def test_each_chat_lists_only_its_own_steps(tmp_path):
    # owner, 2026-10-18, #55 "each chat its own steps" (reversing part of 2026-10-11 "one incident, one picture"): the
    # owner's group listed the FM's alert and reminder, the FM's chat the still-theres sent to the owner alone
    from vesta_shared import result as R
    GROUP = -100123
    v = make_agent(tmp_path, {"people": [{"telegram_id": GROUP, "name": "VillaGroup", "role": "owner"},
                                         {"telegram_id": FM, "name": "Wayan", "role": "fm"}]})
    run = asyncio.run

    def send(*msgs):
        run(v.outcome.carry_out({"send": [R.message(to, ALERT, incident=9, buttons=True, stage=st, status=st)
                                          for to, st in msgs]}, "alert-desk"))
    send(("fm", "new"))
    send(("fm", "reminder"))
    send(("owner", "escalated"))
    send(("owner", "still"), ("fm", "still"))

    def steps(chat):
        return [ln.split(" ")[1] + ln[ln.rindex(" (to:"):] for ln in head_text(v.notices.heading(chat, 9)).split("\n")[2:]]
    assert steps(GROUP) == ["Escalation (to: Owner)", "Still-there (to: Owner & FM)"], steps(GROUP)
    assert steps(FM) == ["Alert (to: FM)", "Reminder (to: FM)", "Still-there (to: Owner & FM)"], steps(FM)
    # "To:" still names everyone the alert involves, in both
    assert all(v.thread.shown(9)[c]["text"].split("\n")[1] == "To: Owner & FM" for c in (GROUP, FM))
    # a step to the FM alone: the group's copy as it was — no edit, no new message
    before, edits, sent = v.thread.shown(9)[GROUP]["text"], len(v.tg.edits), len(v.tg.sent)
    send(("fm", "reminder"))
    assert v.thread.shown(9)[GROUP]["text"] == before
    assert not [e for e in v.tg.edits[edits:] if e[0] == GROUP] and not [s for s in v.tg.sent[sent:] if s[0] == GROUP]
    assert "Reminder" in v.thread.shown(9)[FM]["text"].rsplit("\n", 1)[1]
