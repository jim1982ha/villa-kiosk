"""policy.form_schema — what the Rules page offers — against the file's own checks, by value (0.12.30).

The page kept its own copies of the lists' domains and drifted: "Buttons it may press" offered input_button
entities the check refuses on save; the siren picker offered siren entities the alert desk then asked
switch.turn_on of."""
import yaml

from test_outcome import agent, run  # noqa: F401  (the fixture)
from vesta_agent.policy import form_schema, problems as policy_problems


def test_every_device_kind_a_list_offers_is_one_the_check_accepts():
    for lst in form_schema()["lists"]:
        for d in lst["domains"]:
            assert policy_problems({lst["key"]: [f"{d}.example"]}) == [], (lst["key"], d)
    buttons = next(l for l in form_schema()["lists"] if l["key"] == "button_allowlist")
    assert buttons["domains"] == ["button"]


def test_every_siren_kind_offered_is_accepted_and_no_other():
    for d in form_schema()["siren_domains"]:
        assert policy_problems({"siren_entity": f"{d}.example"}) == []
    assert policy_problems({"siren_entity": "light.example"}) != []


def test_every_rule_offered_is_one_the_check_knows():
    for rule in form_schema()["rules"]:
        assert not any("rule" in p for p in policy_problems({"allowed_services": {"light.turn_on": rule if rule != "listed" else "any"}}))


def test_the_siren_is_asked_with_its_own_domain(agent, tmp_path):  # noqa: F811
    v, _k = agent
    with open(v.s.policy_path) as f:
        raw = yaml.safe_load(f)
    raw.update({"act_enabled": True, "siren_entity": "siren.example", "allowed_services": {"siren.turn_on": "owner"}})
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump(raw, f)
    calls = []
    real = v.actions.request

    def spy(domain, service, entity_id, *a):
        calls.append((domain, service, entity_id))
        return real(domain, service, entity_id, *a)
    v.actions.request = spy
    run(v.outcome.carry_out({"siren_gate": {"armed": True, "prompt": "Intrusion: sound the siren?"}}))
    assert calls == [("siren", "turn_on", "siren.example")]
    assert not any("cannot be requested" in t for _, t, _ in v.tg.sent)
