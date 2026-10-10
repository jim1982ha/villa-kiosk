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


def test_the_tool_carries_out_what_carry_out_reads():
    # round 3 (0.12.38): run_skill_script kept its own copy of the keys — a fifth would have been carried out
    # on schedule and skipped when the model ran the same script
    import re
    from vesta_agent import outcome
    from vesta_agent.outcome import CARRIED_KEYS, has_work
    src = open(outcome.__file__, encoding="utf-8").read()
    body = src[src.index("async def carry_out"):]
    body = body[:body.index("\n    async def ", 10)] if "\n    async def " in body[10:] else body
    read = set(re.findall(r'res\.get\("(\w+)"\)', body))
    # incident_id only qualifies a message being sent (its buttons' incident): alone it carries nothing out
    assert read - {"incident_id"} == set(CARRIED_KEYS), read
    assert has_work({"settle": [1]}) and not has_work({"notes": "x"}) and not has_work(None)
    tools = open(outcome.__file__.replace("outcome.py", "tools.py"), encoding="utf-8").read()
    assert "if has_work(res):" in tools and 'res.get("siren_gate") or res.get("settle")' not in tools


# ---- the one reading (architecture review, 2026-10-07): read_policy gives the values AND the problems
@pytest.mark.parametrize("raw", [{"allowed_services": ["light.turn_on"]}, {"system_actions": ["x"]},
                                 {"system_actions": {"a": 1}}, {"people": "Owner"}, {"chats": ["x"]},
                                 {"settings": ["x"]}, {"tool_access": ["fm"]}, {"siren_entity": 5}])
def test_a_section_of_the_wrong_shape_is_named_never_a_crash(raw):
    p = Policy(raw)                                    # crashed for the first two: every reply and job stopped
    assert problems(raw) and p.problems == problems(raw)


@pytest.mark.parametrize("raw,attr,default", [
    ({"settings": {"reply_limit_usd": "3"}}, "behaviour", 1.0),
    ({"settings": {"reply_limit_usd": True}}, "behaviour", 1.0),
])
def test_a_value_the_page_refuses_is_the_default_for_the_agent_too(raw, attr, default):
    assert problems(raw) and Policy(raw).behaviour["reply_limit_usd"] == default


def test_the_agent_reads_no_more_than_the_page_accepts():
    p = Policy({"chats": {"owner": -1, "guests": -5}, "tool_access": {"owner": {"cameras": False}},
                "settings": {"jobs": {"a": {"profile": "economy", "limit_usd": "0.5"},
                                      "b": {"profile": "economy", "limit_usd": 1, "x": 1}}},
                "people": [{"telegram_id": 7, "name": "A", "role": "fm"}, {"telegram_id": 7, "name": "B", "role": "owner"}],
                "allowed_services": {"light.turn_on": "any", "homeassistant.restart": "owner", "lock.lock": "maybe"}})
    assert p.chats == {"owner": -1} and p.tool_access == {} and p.jobs == {}
    # one id in two roles (owner, 2026-10-10): recognised as the owner, each role's entry kept with its name
    assert p.people[7].name == "B" and [(e.name, e.role) for e in p.entries] == [("A", "fm"), ("B", "owner")]
    assert p.allowed_services == {"light.turn_on": "any"}                   # a refused line is not offered


def test_the_siren_switches_itself_off_without_a_line_in_system_actions():
    p = Policy({"siren_entity": "Switch.Siren"})
    assert p.siren_entity == "switch.siren"
    assert p.check_service("switch", "turn_off", "switch.siren", system=True).allowed
    assert not p.check_service("switch", "turn_on", "switch.siren", system=True).allowed     # only its stop
    assert not p.check_service("switch", "turn_off", "switch.other", system=True).allowed


def test_a_protective_list_written_as_text_still_protects():
    raw = {"owner_only_entities": "lock.front, lock.gate"}
    assert problems(raw) and Policy(raw).owner_only == {"lock.front", "lock.gate"}


def test_one_person_in_both_roles_is_named_as_each_chat_knows_them():
    # owner, 2026-10-10: Fabien is the owner and, as Fabien_FM, a facility manager — the same Telegram id twice
    p = Policy({"people": [{"telegram_id": 1, "name": "Jean-Marie", "role": "fm"},
                           {"telegram_id": 2, "name": "Fabien", "role": "owner"},
                           {"telegram_id": 2, "name": "Fabien_FM", "role": "fm"}],
                "chats": {"owner": -5, "fm": 1}})
    assert p.person(2).role == "owner"                                     # the wider rights
    assert p.names_for(1) == ["Jean-Marie", "Fabien_FM"] and p.names_for(-5) == ["Fabien"]   # "For:" of a notice
    assert p.name_in(2, 1) == "Fabien_FM" and p.name_in(2, -5) == "Fabien"                    # a press's footer
    twice = Policy({"people": [{"telegram_id": 2, "name": "A", "role": "fm"}, {"telegram_id": 2, "name": "B", "role": "fm"}]})
    assert [e.name for e in twice.entries] == ["A"]                         # twice in ONE role: still refused
