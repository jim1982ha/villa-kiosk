"""policy.yaml is read twice — leniently by the agent (Policy), strictly by the page (problems). They must
agree: the agent ignores exactly what the page names (architecture review, 0.12.37).

Found by running both halves: `act_enabled: "false"` turned acting ON, a chat id written as text crashed every
message, and a person with a negative id was registered while the page said "ignored"."""
import pytest

from vesta_agent.policy import DEFAULTS, Policy, problems


@pytest.mark.parametrize("value", ["false", "no", "true", 1, 0, None, [], "off"])
def test_acting_is_on_only_for_a_real_true(value):
    p = Policy({"act_enabled": value})
    flagged = any("act_enabled" in x for x in problems({"act_enabled": value}))
    assert p.act_enabled is (value is True)
    if value is not None:
        assert flagged == (not isinstance(value, bool))
    assert p.act_enabled is False or value is True        # never ON from a value the page refuses


@pytest.mark.parametrize("value", ["@villa", "group", "1.5", [], {"x": 1}])
def test_a_chat_id_that_is_not_a_number_is_skipped_and_named_never_a_crash(value):
    p = Policy({"chats": {"owner": value, "fm": -100123}})
    assert "owner" not in p.chats and p.chats["fm"] == -100123
    assert any("chats.owner" in x for x in problems({"chats": {"owner": value}}))


@pytest.mark.parametrize("tid,registered", [(-5, False), (0, False), ("abc", False), ("42", True), (42, True)])
def test_a_person_is_registered_exactly_when_the_page_accepts_their_id(tid, registered):
    raw = {"people": [{"telegram_id": tid, "name": "X", "role": "fm"}]}
    flagged = any("telegram_id" in x for x in problems(raw))
    assert (len(Policy(raw).people) == 1) is registered and flagged is (not registered)


@pytest.mark.parametrize("key,lo,hi", [("approval_ttl_minutes", 1, 1440), ("siren_auto_off_min", 1, 60)])
@pytest.mark.parametrize("value", ["5", True, 0, 10**6, 2.5])
def test_a_number_the_page_refuses_is_the_default_for_the_agent(key, lo, hi, value):
    assert getattr(Policy({key: value}), key) == DEFAULTS[key]
    assert any(key in x for x in problems({key: value}))


def test_only_the_person_who_asked_can_continue_an_answer(tmp_path):
    # requested_by was written and never read: in a group, anyone could resume another person's conversation
    from vesta_agent.state import State
    st = State(str(tmp_path / "s.sqlite"))
    cid = st.new_continuation(-100, "sess-1", requested_by=11)
    assert st.use_continuation(cid, -100, by=22) == {"not_yours": True}
    assert st.use_continuation(cid, -100, by=11)["session_id"] == "sess-1"      # not used up by the refusal
    assert st.use_continuation(cid, -100, by=11) is None                         # used once
    legacy = st.new_continuation(-100, "sess-2", requested_by=None)
    assert st.use_continuation(legacy, -100, by=22)["session_id"] == "sess-2"     # an old one with no asker: as before
