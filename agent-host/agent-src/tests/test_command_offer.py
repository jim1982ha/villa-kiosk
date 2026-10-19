"""A reply that tells the person to write "/investigate …" carries a button that does it (owner, 2026-10-19, a Telegram
screenshot: asked about the pool pump, the reply ended "write /investigate followed by your question about the pool pump
history…" — "a button that directly triggers the suggested investigation").

The button runs what typing "/investigate <their question>" in that chat would run — the same intake, the same request,
the same check of who may — on the PERSON'S question, once (vesta_agent/command_offers.py)."""
from __future__ import annotations

import asyncio

import yaml

from helpers import make_agent
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
