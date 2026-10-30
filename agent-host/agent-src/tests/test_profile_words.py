"""One name per role, the Kiosk's (architecture review round 8: the Facility Manager had three names — "Facility
manager" on the tablet and in the ticket history, "FM" on Telegram, "Facility Manager" on VESTA's page). The words are
the agreement's profiles (agent-contract.json `profiles`); a Facility step names its profile by id (`role`), an older
one by the words it was shown in, a former name included. Synthetic tickets; ids invented."""
from __future__ import annotations

from vesta_agent.kiosk import fault_of
from vesta_shared import agreement
from vesta_shared.message_format import ROLE_SHORT, ROLE_WORDS, audience
from vesta_shared.profiles import step_by

PROFILES = agreement.section("profiles")
AS_ROLE = agreement.section("conversation")["profiles"]           # profile → the Agent's role


def test_the_roles_words_are_the_kiosks_profiles():
    for profile, role in AS_ROLE.items():
        if role in ROLE_WORDS:
            assert ROLE_WORDS[role] == PROFILES[profile]["label"]
            assert ROLE_SHORT[role] == PROFILES[profile]["short"]
    assert audience(["owner", "fm"]) == f"{PROFILES['owner']['label']} & {PROFILES['ops']['label']}"


def test_a_step_is_said_by_its_profile_and_an_older_one_by_its_former_name():
    ops = PROFILES["ops"]
    assert step_by({"role": "ops", "by": ops["formerLabels"][0]}) == ops["label"]
    assert step_by({"by": ops["formerLabels"][0]}) == ops["label"]                 # written before the Kiosk said role
    # a role named since by other words: the profile's words now, whatever the step was shown in
    assert step_by({"role": "ops", "by": "Site lead"}) == ops["label"]
    assert step_by({"by": "VESTA"}) == "VESTA" and step_by({}) == ""                # nobody's profile: as written


def test_a_fault_taken_on_closed_and_reopened_reads_who_in_the_profiles_words():
    old = PROFILES["ops"]["formerLabels"][0]
    t = {"id": "t1", "status": "resolved", "resolvedAt": "2026-10-30T10:00:00Z", "updates": [
        {"at": "2026-10-30T08:00:00Z", "status": "in_progress", "by": old},
        {"at": "2026-10-30T09:00:00Z", "kind": "reopened", "status": "open", "role": "owner", "by": "Owner"},
        {"at": "2026-10-30T10:00:00Z", "status": "resolved", "role": "ops", "by": old}]}
    f = fault_of(t)
    assert f["by"] == PROFILES["ops"]["label"] and f["reopened_by"] == PROFILES["owner"]["label"]
    assert f["taken_by"] == PROFILES["ops"]["label"]
