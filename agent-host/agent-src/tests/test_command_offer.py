"""A reply that tells the person to write "/investigate …" carries a button that does it (owner, 2026-10-19, a Telegram
screenshot: asked about the pool pump, the reply ended "write /investigate followed by your question about the pool pump
history…" — "a button that directly triggers the suggested investigation").

The button runs what typing "/investigate <their question>" in that chat would run — the same intake, the same request,
the same check of who may — on the PERSON'S question, once (vesta_agent/command_offers.py)."""
from __future__ import annotations

import asyncio
import pathlib

import yaml

from helpers import make_agent
from ha_fake import FakeHA, tool as ha_tool
from kiosk_fake import FakeKiosk
from telegram_fake import BOT
from vesta_agent import button_data

JM, FM, GROUP = 111, 222, -1001
ANONYMOUS = 1087968824                   # a group's anonymous admin: Telegram's own id, no one to the villa
PEOPLE = [{"telegram_id": JM, "name": "JM", "role": "owner"}, {"telegram_id": FM, "name": "Ana", "role": "fm"},
          {"telegram_id": GROUP, "name": "Staff", "role": "fm"}]
ASKED = "how long did the pool pump run this week?"
SUGGESTS = ("It ran 21 h this week. For a week-by-week analysis, write /investigate followed by your question; "
            "a proposal is answered with /proposal accept 3.")
LABEL = "🔎 Investigate this"


def run(coro):
    return asyncio.run(coro)


def _villa(tmp_path, monkeypatch, answer=SUGGESTS, **policy):
    """The villa with the investigate and proposals skills; the AI answers `answer` to a question, and anything to a
    /investigate request (its prompt says "wrote /investigate")."""
    from ai_fake import FakeAI
    v = make_agent(tmp_path, {"people": PEOPLE, **policy}, skills=("investigate", "proposals"), kiosk=FakeKiosk())
    ai = FakeAI(lambda call: "The investigation." if "wrote /investigate" in call["prompt"] else answer)
    ai.install(monkeypatch)
    return v, ai


def _buttons(kb) -> list[dict]:
    return [b for row in (kb or {}).get("inline_keyboard", []) for b in row]


def _offered(v, chat):
    """The offer buttons under the last message sent to `chat`, and that message (its id, text, keyboard)."""
    n, (c, text, kb) = next((n, s) for n, s in reversed(list(enumerate(v.tg.sent, start=1001))) if s[0] == chat)
    return [b for b in _buttons(kb) if button_data.read(b["callback_data"])[0] == button_data.COMMAND], (n, text, kb)


def _press(v, chat, button, message, who=JM, name="JM"):
    mid, text, kb = message
    run(v.on_ha_event("telegram_callback", {
        "id": f"cb{len(v.tg.toasts)}", "data": button["callback_data"], "chat_id": chat, "user_id": who,
        "from_first": name, "bot": BOT,
        "message": {"message_id": mid, "chat": {"id": chat}, "text": text, "reply_markup": kb}}))


def _investigations(ai) -> list[dict]:
    return [r for r in ai.runs if "wrote /investigate" in r["prompt"] and "has not sent" not in r["prompt"]]


def test_a_reply_naming_investigate_carries_the_button_on_the_persons_question(tmp_path, monkeypatch):
    for who, name in ((JM, "JM"), (FM, "Ana")):                          # the owner and the facility manager alike
        v, ai = _villa(tmp_path / str(who), monkeypatch)
        run(v.converse(who, v.policy().person(who), ASKED))
        offers, _ = _offered(v, who)
        assert [b["text"] for b in offers] == [LABEL], who               # one button: proposals has no `offer`
        oid = button_data.read(offers[0]["callback_data"])[1][0]
        assert len(offers[0]["callback_data"].encode()) <= 64             # Telegram's limit: only an id travels
        kept = v.state.command_offer(oid, who)
        assert kept["skill"] == "investigate" and kept["question"] == ASKED and kept["by"] == who


def test_no_button_without_the_mention_or_for_a_skill_switched_off(tmp_path, monkeypatch):
    v, _ = _villa(tmp_path / "a", monkeypatch, answer="It ran 21 h this week.")
    run(v.converse(JM, v.policy().person(JM), ASKED))
    assert _offered(v, JM)[0] == []
    # a villa that switched investigate off: typing /investigate would not run it, so no button offers it
    v, _ = _villa(tmp_path / "b", monkeypatch, skills_off=["investigate"])
    run(v.converse(JM, v.policy().person(JM), ASKED))
    assert _offered(v, JM)[0] == []


def test_no_button_for_who_could_not_type_it_nor_without_a_question(tmp_path, monkeypatch):
    # the button is typing "/investigate <question>": judged by the same gate, for the person the reply answers — one
    # the villa does not know could not type it (Telegram would drop them before the AI), so the reply has none
    v, _ = _villa(tmp_path, monkeypatch)
    run(v.converse(JM, None, ASKED))
    assert _offered(v, JM)[0] == []
    # nothing to investigate: a Continue, a photo sent with no words
    assert v.command_offers.rows(JM, SUGGESTS, "", JM) == [] and v.command_offers.rows(JM, SUGGESTS, "  ", JM) == []
    assert v.command_offers.rows(JM, SUGGESTS, ASKED, JM)                   # the same answer with a question: one


def test_no_button_under_the_investigation_itself(tmp_path, monkeypatch):
    v, _ = _villa(tmp_path, monkeypatch, answer=SUGGESTS)
    from ai_fake import FakeAI
    FakeAI(SUGGESTS).install(monkeypatch)                                # even if its answer names /investigate again
    run(v.converse(JM, v.policy().person(JM), "the pump", invoked="investigate"))
    assert all(button_data.read(b["callback_data"])[0] != button_data.COMMAND for _, _, kb in v.tg.sent
               for b in _buttons(kb))


def test_pressing_runs_what_typing_it_would_run_once(tmp_path, monkeypatch):
    v, ai = _villa(tmp_path / "pressed", monkeypatch)
    run(v.converse(JM, v.policy().person(JM), ASKED))
    (button,), message = _offered(v, JM)
    _press(v, JM, button, message)
    pressed = _investigations(ai)
    assert len(pressed) == 1 and pressed[0]["skill"] == "investigate"
    assert f'"""{ASKED}"""' in pressed[0]["prompt"]                       # the person's question, word for word
    # the message says so, this button gone
    (_, mid, edited), = [e for e in v.tg.edits if e[1] == message[0]]
    assert edited.startswith(SUGGESTS[:20]) and f"Investigating: “{ASKED}” (JM)" in edited
    assert ("cb0", f"Investigating: “{ASKED}”") in v.tg.toasts
    # a second press — a double tap, or someone else — starts nothing more
    _press(v, JM, button, message)
    assert len(_investigations(ai)) == 1 and v.tg.toasts[-1][1] == "Already started."

    # the same request as typing "/investigate <question>" in that chat (the event Home Assistant fires)
    typed, ai2 = _villa(tmp_path / "typed", monkeypatch)
    run(typed.on_ha_event("telegram_command", {"chat_id": JM, "user_id": JM, "from_first": "JM",
                                               "command": "/investigate", "args": ASKED.split()}))
    by_hand = _investigations(ai2)
    assert len(by_hand) == 1
    same = ("skill", "tools", "allowed", "limit_usd", "profile", "asked", "resume")
    assert {k: pressed[0][k] for k in same} == {k: by_hand[0][k] for k in same}
    assert pressed[0]["prompt"].split("\n", 1)[1] == by_hand[0]["prompt"].split("\n", 1)[1]


def test_the_press_is_judged_again_for_who_presses(tmp_path, monkeypatch):
    # in the facility manager's group: Ana asks, the button is there for anyone in it; an anonymous admin is no one to the
    # villa, and a skill switched off after the reply starts nothing
    v, ai = _villa(tmp_path, monkeypatch)
    run(v.converse(GROUP, v.policy().member(FM, GROUP, "Ana"), ASKED))
    (button,), message = _offered(v, GROUP)
    _press(v, GROUP, button, message, who=ANONYMOUS, name="Group")
    assert _investigations(ai) == []
    pol = yaml.safe_load(open(v.s.policy_path))
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump({**pol, "skills_off": ["investigate"]}, f)
    _press(v, GROUP, button, message, who=FM, name="Ana")
    assert _investigations(ai) == [] and "not available" in v.tg.toasts[-1][1]
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump(pol, f)
    # the group taken out of People since: Ana is still the villa's facility manager, but typing /investigate there
    # would reach nobody — the press starts nothing either
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump({**pol, "people": [p for p in PEOPLE if p["telegram_id"] != GROUP]}, f)
    _press(v, GROUP, button, message, who=FM, name="Ana")
    assert _investigations(ai) == [] and v.tg.toasts[-1][1] == "You cannot start /investigate here."
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump(pol, f)
    _press(v, GROUP, button, message, who=FM, name="Ana")               # the button still works once allowed again
    assert len(_investigations(ai)) == 1


def test_the_other_buttons_of_the_reply_stay(tmp_path, monkeypatch):
    # buttons add up (TurnResult.then): pressing this one leaves a Continue or a fault offer under the same reply
    v, ai = _villa(tmp_path, monkeypatch)
    run(v.converse(JM, v.policy().person(JM), ASKED))
    (button,), (mid, text, kb) = _offered(v, JM)
    other = {"text": "Continue", "callback_data": button_data.make(button_data.CONTINUE, "c1")}
    _press(v, JM, button, (mid, text, {"inline_keyboard": [[other], *kb["inline_keyboard"]]}))
    assert v.tg.edit_keyboards[0] == {"inline_keyboard": [[other]]} and len(_investigations(ai)) == 1


def test_an_offer_is_claimed_once_and_only_in_its_own_chat(tmp_path):
    from vesta_agent.state import State
    st = State(str(tmp_path / "state.sqlite"))
    oid = st.new_command_offer(JM, "investigate", ASKED, JM)
    assert st.claim_command_offer(oid, FM) is None                       # another chat's press
    assert st.claim_command_offer(oid, JM)["question"] == ASKED
    assert st.claim_command_offer(oid, JM) is None and st.command_offer(oid, JM) is None


def test_only_a_command_skill_may_be_offered_and_its_button_has_words(tmp_path):
    import pytest
    from helpers import make_skill
    from vesta_agent.skills import SkillError, parse_skill
    for name, spec in [("plain", {"offer": {"label": "Go"}}),                              # nothing to type
                       ("nolabel", {"command": "go", "offer": {"pressed": "Going"}}),
                       ("odd", {"command": "go", "offer": {"label": "Go", "run": "x"}})]:
        with pytest.raises(SkillError, match="offer"):
            parse_skill(name, make_skill(str(tmp_path), name, spec))
    sk = parse_skill("ok", make_skill(str(tmp_path), "ok", {"command": "go", "offer": {"label": "Go"}}))
    assert sk.offer == {"label": "Go"}


def test_an_answer_that_read_the_past_carries_the_button_without_naming_the_command(tmp_path, monkeypatch):
    # owner, 2026-10-20: asked why the House Pump kept starting, the reply read its history and skipped the line naming
    # /investigate — no button came. The skill's `offer: after_reading` puts it there whatever the AI wrote.
    from ai_fake import FakeAI
    for tool, args, offered in (("ha_get_history", {"entity_ids": "sensor.pump_power"}, True),
                                ("ha_get_logs", {"source": "logbook"}, True),
                                ("ha_get_state", {"entity_id": "sensor.pump_power"}, False)):
        ha = FakeHA(tools=[ha_tool("ha_get_history", entity_ids="string"), ha_tool("ha_get_logs", source="string"),
                           ha_tool("ha_get_state", entity_id="string")],
                    answers={t: "[]" for t in ("ha_get_history", "ha_get_logs", "ha_get_state")})
        v = make_agent(tmp_path / tool, {"people": PEOPLE, "ha_read_tools": ["ha_get_history", "ha_get_logs", "ha_get_state"]},
                       skills=("investigate",), kiosk=FakeKiosk(), reader=ha)
        run(v.refresh_server_tools())

        async def reads(run_, tool=tool, args=args):
            await run_["call"](tool, args)
        FakeAI("It ran 21 h this week.", act=reads).install(monkeypatch)
        run(v.converse(JM, v.policy().person(JM), ASKED))
        assert [b["text"] for b in _offered(v, JM)[0]] == ([LABEL] if offered else []), tool


def test_after_reading_is_the_skills_list_and_a_wrong_one_is_refused(tmp_path):
    import pytest
    from vesta_agent.skills import SkillError, parse_skill
    sk = parse_skill("investigate", str(pathlib.Path(__file__).parent.parent / "starter" / "skills" / "investigate"))
    assert set(sk.offer_after) == {"ha_get_history", "ha_get_logs"} and "after_reading" not in sk.offer
    bad = tmp_path / "x"
    bad.mkdir()
    (bad / "skill.yaml").write_text(yaml.safe_dump(
        {"description": "d", "command": "x", "offer": {"label": "Go", "after_reading": "ha_get_history"}}))
    with pytest.raises(SkillError):
        parse_skill("x", str(bad))


def test_a_later_answer_that_read_nothing_carries_no_button_in_the_same_conversation(tmp_path, monkeypatch):
    # owner, 2026-10-20: "i see the button `investigate this` for all the message responded by the agent" — 0.12.297
    # carried a conversation's readings to every later answer in it; the button follows the answer's own readings only
    from ai_fake import FakeAI
    from vesta_agent import runner
    ha = FakeHA(tools=[ha_tool("ha_get_history", entity_ids="string")], answers={"ha_get_history": "[]"})
    v = make_agent(tmp_path, {"people": PEOPLE, "ha_read_tools": ["ha_get_history"]},
                   skills=("investigate",), kiosk=FakeKiosk(), reader=ha)
    run(v.refresh_server_tools())
    turns = {"n": 0}

    async def reads_first(run_):
        turns["n"] += 1
        if turns["n"] == 1:
            await run_["call"]("ha_get_history", {"entity_ids": "sensor.pump_power"})
    ai = FakeAI(lambda call: runner.RunResult("It ran 21 h this week.", "s1", False, 0.01, [], None, None),
                act=reads_first).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), ASKED))
    assert [b["text"] for b in _offered(v, JM)[0]] == [LABEL]
    run(v.converse(JM, v.policy().person(JM), "is everything ok?"))      # the same conversation, nothing read
    assert ai.runs[-1]["resume"] == "s1" and _offered(v, JM)[0] == []


def test_the_offer_can_be_declined_both_buttons_go_and_nothing_runs(tmp_path, monkeypatch):
    # owner, 2026-10-20: "add a button to reject the Investigation"
    v, ai = _villa(tmp_path, monkeypatch)
    run(v.converse(JM, v.policy().person(JM), ASKED))
    offers, message = _offered(v, JM)
    no = next(b for b in _buttons(message[2]) if button_data.read(b["callback_data"])[0] == button_data.DECLINE)
    assert no["text"] == "No, thanks" and button_data.read(no["callback_data"])[1] == button_data.read(offers[0]["callback_data"])[1]
    _press(v, JM, no, message)
    assert _investigations(ai) == []                                     # nothing ran
    _press(v, JM, offers[0], message)                                    # the Investigate button, pressed after
    assert _investigations(ai) == [] and v.tg.toasts[-1][1] in ("Already started.", "Already answered.")


def _follow_up(tmp_path, monkeypatch, pack: bool):
    """Review, 2026-10-23: "how did the House Pump run this afternoon?", then "and why did it keep starting?" — the
    follow-up reads the pump's past and earns "Investigate this". Returns the agent, the AI, the follow-up's offer."""
    from ai_fake import FakeAI
    from vesta_agent import runner
    from vesta_shared.knowledge_pack import KnowledgePack
    ha = FakeHA(tools=[ha_tool("ha_get_history", entity_ids="string", start_time="string")],
                answers={"ha_get_history": "[]"})
    v = make_agent(tmp_path, {"people": PEOPLE, "ha_read_tools": ["ha_get_history"]},
                   skills=("investigate",), kiosk=FakeKiosk(), reader=ha)
    if pack:
        with open(v.s.pack_path, "w", encoding="utf-8") as f:
            f.write(KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={"power": [
                {"entity_id": "sensor.house_pump_power", "name": "House Pump", "family": "power"}]}, assets={},
                areas=[], people=[], channels={}, unknown_area=[], unclassified=[], retention={}).to_json())
    run(v.refresh_server_tools())
    n = {"turn": 0}

    async def act(run_):
        n["turn"] += 1
        if n["turn"] == 2:                                           # the follow-up reads the pump's past
            await run_["call"]("ha_get_history", {"entity_ids": "sensor.house_pump_power", "start_time": "12h"})

    def answer(call):
        if "wrote /investigate" in call["prompt"]:
            return runner.RunResult("The investigation.", "s9", False, 0.01, [], None, None)
        return runner.RunResult("The House Pump ran 3 h." if n["turn"] == 1 else "It started 14 times after 13:28.",
                                "s1", False, 0.01, [], None, None)
    ai = FakeAI(answer, act=act).install(monkeypatch)
    run(v.converse(JM, v.policy().person(JM), "how did the House Pump run this afternoon?"))
    run(v.converse(JM, v.policy().person(JM), "and why did it keep starting?"))
    buttons, message = _offered(v, JM)
    assert [b["text"] for b in buttons] == [LABEL]
    return v, ai, buttons[0], message


def test_investigate_under_a_follow_up_is_told_what_the_answer_read(tmp_path, monkeypatch):
    """The press starts a fresh conversation (a command's rule) with the person's words only: "and why did it keep
    starting?" named no pump. The offer keeps what the turn read (its devices and period), and the request is told."""
    v, ai, button, message = _follow_up(tmp_path, monkeypatch, pack=False)
    _press(v, JM, button, message)
    (inv,) = _investigations(ai)
    assert inv["resume"] is None                                         # still a fresh conversation
    assert '"""and why did it keep starting?"""' in inv["prompt"]
    assert "about: sensor.house_pump_power (last 12 h)" in inv["prompt"]
    # never shown to the person: the toast and the line under the message say their question only
    assert all("sensor." not in t for _, t in v.tg.toasts)


def test_the_subject_names_the_device_where_the_pack_names_it(tmp_path, monkeypatch):
    v, ai, button, message = _follow_up(tmp_path, monkeypatch, pack=True)
    _press(v, JM, button, message)
    assert "about: House Pump (sensor.house_pump_power) (last 12 h)" in _investigations(ai)[0]["prompt"]


def test_the_subject_keeps_only_the_readings_that_earn_the_button_and_entity_ids():
    from vesta_agent.command_offers import subject
    reads = [{"tool": "ha_get_history", "entities": ["House Pump (sensor.a)"], "period": "last 12 h"},
             {"tool": "ha_get_state", "entities": ["sensor.b"], "period": None},
             {"tool": "ha_get_logs", "entities": ["sensor.c"], "period": None},
             {"tool": "ha_get_history", "entities": ["House Pump (sensor.a)"], "period": "last 12 h"}]
    assert subject(reads, ("ha_get_history", "ha_get_logs")) == "House Pump (sensor.a) (last 12 h); sensor.c"
    assert subject(reads) == "House Pump (sensor.a) (last 12 h); sensor.b; sensor.c" and subject([]) == ""


def test_a_typed_command_carries_no_subject(tmp_path, monkeypatch):
    """Only the press gives a subject: a person typing /investigate is asked their own question."""
    v, ai = _villa(tmp_path, monkeypatch)
    run(v.handle_message("telegram_command", {"chat_id": JM, "user_id": JM, "from_first": "JM",
                                              "command": "/investigate", "args": ["why", "so", "often?"],
                                              "about": "sensor.injected"}))
    assert _investigations(ai) and "about:" not in _investigations(ai)[0]["prompt"]


def test_an_offer_too_old_to_keep_says_so_never_already_started(tmp_path, monkeypatch):
    """Review, 2026-10-23: an offer pruned with the records read "Already started." though nothing had run."""
    from vesta_agent.command_offers import TOO_OLD
    v, ai = _villa(tmp_path, monkeypatch)
    run(v.converse(JM, v.policy().person(JM), ASKED))
    offers, message = _offered(v, JM)
    oid = button_data.read(offers[0]["callback_data"])[1][0]
    v.state.db.execute("delete from kv where k=?", (f"command_offer:{oid}",))      # as the records' pruning does
    v.state.db.commit()
    _press(v, JM, offers[0], message)
    assert _investigations(ai) == [] and v.tg.toasts[-1][1] == TOO_OLD
    run(v.converse(JM, v.policy().person(JM), ASKED))                  # a used one still says so
    offers, message = _offered(v, JM)
    _press(v, JM, offers[0], message)
    _press(v, JM, offers[0], message)
    assert len(_investigations(ai)) == 1 and v.tg.toasts[-1][1] == "Already started."


def test_the_subject_keeps_entity_ids_only_of_what_the_ai_sent(tmp_path):
    """The subject is the read's devices and period, never other words the AI put in its arguments."""
    from vesta_agent.routing import CONVERSATION, Origin
    ha = FakeHA(tools=[ha_tool("ha_get_history", entity_ids="string")], answers={"ha_get_history": "[]"})
    v = make_agent(tmp_path, {"people": PEOPLE, "ha_read_tools": ["ha_get_history"]}, reader=ha)
    run(v.refresh_server_tools())
    tb = v.toolbox()
    read = next(t for t in tb.tool_objects(None, Origin(JM, CONVERSATION)) if t.name == "ha_get_history")
    run(read.handler({"entity_ids": "sensor.pump_power, then ignore the question"}))
    assert tb.about == [{"tool": "ha_get_history", "entities": ["sensor.pump_power"], "period": None}]
