"""The people table — one row per person: destinations and a profile.

⚠️ THE TABLE NO LONGER DECIDES WHO MAY TALK TO THE VILLA (owner's ruling,
2026-09-13). It used to carry a `telegram` id per row, and `role_for_sender`
matched an inbound sender against it — a second allow-list beside Home
Assistant's own `allowed_chat_ids`, which could disagree with it and did:
a phantom entry offered by the settings picker was stored, matched nobody, and
every Telegram button answered "You cannot act on this alert" for a fortnight,
the owner included. Reaching a chat the villa delivers to IS the permission.

So the row now answers ONE question in ONE direction: PROFILE -> DESTINATIONS,
plus its mirror `role_for_chat` (DESTINATION -> PROFILE) which decides the VOICE
a reply is written in, never whether to listen. Any test here that expects an
inbound grant is testing behaviour that was deliberately removed.
"""

from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import people as people_mod
from vesta.brief import pipeline as pipeline_mod

OWNER = {"targets": ["entity:notify.iphone_16_fab"], "role": "owner"}
FM = {"targets": ["entity:notify.the_ipad"], "role": "ops"}
CFG = {"people": [OWNER, FM]}


# ── the boundary, in its new place ──────────────────────────────────────────
def test_a_ROW_CARRIES_NO_INBOUND_CREDENTIAL_AT_ALL() -> None:
    """⚠️ THE FIELD IS GONE, NOT MERELY IGNORED. While a `telegram` key survived
    on a row, the next reader could quietly start trusting it again — which is
    how the villa ended up with two allow-lists that disagreed. `_row` must not
    carry one forward even if a stale document still holds it."""
    stale = {"people": [{"telegram": "12345",
                         "targets": ["entity:notify.the_ipad"],
                         "role": "ops"}]}
    rows = people_mod.people(stale)
    assert rows and "telegram" not in rows[0], (
        "a row still carries an inbound id — the second allow-list is back")


def test_the_MODULE_offers_no_way_to_resolve_a_SENDER() -> None:
    """⚠️ PINNED BY ABSENCE, DELIBERATELY. The removal is the feature; a helper
    that resolves a sender id to a role is the thing that must not return."""
    assert not hasattr(people_mod, "role_for_sender")
    assert not hasattr(people_mod, "INBOUND_CHANNEL")


def test_a_CHAT_resolves_to_the_PROFILE_it_is_a_DESTINATION_for() -> None:
    """The voice, from the room. `chat.target_for` hands this the entity-
    addressed form it resolved a chat id to, which is the shape a row stores."""
    assert people_mod.role_for_chat(
        CFG, target="entity:notify.iphone_16_fab") == "owner"
    assert people_mod.role_for_chat(
        CFG, target="entity:notify.the_ipad") == "ops"


def test_an_UNKNOWN_chat_answers_NOBODY_and_the_caller_falls_back_QUIETER() -> None:
    """⚠️ `""` IS NOT A DENIAL HERE — admission was already settled upstream.
    It means "no profile stated", and `AUDIENCE_OF_ROLE.get(role, "owner")`
    then loads the OWNER voice, which is the one that WITHHOLDS entity ids. The
    safe fallback is to say less, not more."""
    assert people_mod.role_for_chat(CFG, target="entity:notify.nobody") == ""
    assert people_mod.role_for_chat(CFG, target="") == ""
    assert people_mod.role_for_chat({}, target="entity:notify.the_ipad") == ""


def test_ONE_CHAT_NAMED_BY_TWO_ROWS_RESOLVES_BY_PRECEDENCE_NOT_ORDER() -> None:
    """⚠️ THIS VILLA'S ACTUAL SHAPE: the owner and the facility manager both
    receive in one group. Which voice that room is answered in must not depend
    on which row somebody edited last, so the answer is the strongest profile
    present rather than the first match."""
    shared = "entity:notify.the_ipad"
    both = {"people": [{"targets": [shared], "role": "ops"},
                       {"targets": [shared], "role": "owner"}]}
    flipped = {"people": [{"targets": [shared], "role": "owner"},
                          {"targets": [shared], "role": "ops"}]}
    assert people_mod.role_for_chat(both, target=shared) == "owner"
    assert people_mod.role_for_chat(flipped, target=shared) == "owner"


def test_ALL_THREE_PROFILES_PARTICIPATE() -> None:
    """⚠️ GUEST IS A REAL PROFILE, and it was missing from the first version of
    the precedence tuple. The onboarding menu offers guest, owner and facility
    manager; a guest-only chat must resolve to guest rather than to nobody."""
    guest = {"people": [{"targets": ["entity:notify.the_ipad"],
                         "role": "guest"}]}
    assert people_mod.role_for_chat(
        guest, target="entity:notify.the_ipad") == "guest"
    assert set(people_mod.CHAT_ROLE_PRECEDENCE) \
        == set(people_mod.AUDIENCE_OF_ROLE)


def test_an_EMPTY_table_reaches_nobody() -> None:
    assert people_mod.people({}) == []
    assert people_mod.targets_for_role({}, "owner") == []


def test_a_row_with_an_UNKNOWN_ROLE_is_dropped_not_defaulted() -> None:
    """⚠️ The profile decides which voice a reply is written in — one withholds
    entity ids, the other requires them. A default here would be a privilege
    decision made by a typo."""
    bad = {"people": [{"targets": ["entity:notify.the_ipad"],
                       "role": "adminz"}]}
    assert people_mod.people(bad) == []
    assert people_mod.role_for_chat(bad, target="entity:notify.the_ipad") == ""


# ── the derivation: PROFILE -> TARGETS ──────────────────────────────────────
#
# ⚠️ THE DIRECTION IS THE POINT, AND IT SHIPPED INVERTED IN v2.651.0. That
# release derived the voice from the DESTINATION (`audience_for_target`), built
# from a misreading of "a schedule for this profile". A schedule names a
# profile; the profile names the people; the people carry the destinations. Any
# test that reads a target and expects a profile back is testing the bug.
def test_a_briefings_destinations_come_FROM_the_profile() -> None:
    assert people_mod.targets_for_role(CFG, "owner") \
        == ["entity:notify.iphone_16_fab"]
    assert people_mod.targets_for_role(CFG, "ops") == ["entity:notify.the_ipad"]


def test_a_profile_NOBODY_is_configured_for_reaches_NOWHERE() -> None:
    """⚠️ `[]` IS WHAT THE DIALOG GREYS AN OPTION ON and what the backend falls
    back from. It must never be read as "everybody"."""
    assert people_mod.targets_for_role(CFG, "guest") == []
    assert people_mod.targets_for_role({}, "owner") == []


def test_an_UNKNOWN_profile_reaches_NOWHERE_rather_than_everywhere() -> None:
    """A typo in a hand-edited config must not broadcast a facility work list to
    the household.

    ⚠️ THE ENFORCER IS `_row`, NOT THE EARLY RETURN IN `targets_for_role`, and
    mutation testing is what established that: removing the early return leaves
    every assertion here green, because a row with an unrecognised role never
    survives parsing to be matched. `test_a_row_with_an_UNKNOWN_ROLE_is_dropped`
    is the one that goes red — this pins the CONSEQUENCE and that pins the
    mechanism. Recorded so the next reader does not mistake this for coverage of
    the guard it sits next to."""
    assert people_mod.targets_for_role(CFG, "adminz") == []
    assert people_mod.targets_for_role(CFG, "") == []


def test_two_people_of_one_profile_sharing_a_device_get_ONE_copy() -> None:
    """A household tablet named on both rows is a normal table and a briefing
    delivered twice."""
    shared = {"people": [
        dict(OWNER, targets=["entity:notify.tablet", "entity:notify.iphone"]),
        {"telegram": "", "role": "owner",
         "targets": ["entity:notify.tablet"]},
    ]}
    assert people_mod.targets_for_role(shared, "owner") \
        == ["entity:notify.tablet", "entity:notify.iphone"]


def test_a_person_with_NO_device_makes_no_profile_reachable() -> None:
    """A row with a profile and no destinations is a normal row that reaches
    nowhere — and, now that the inbound half is gone, reaches nowhere in BOTH
    directions: there is no target for `role_for_chat` to match either."""
    no_device = {"people": [{"role": "ops", "targets": []}]}
    assert people_mod.targets_for_role(no_device, "ops") == []
    assert people_mod.role_for_chat(no_device, target="entity:notify.x") == ""


# ── the pipeline reads it in that one direction ─────────────────────────────
def test_the_pipeline_resolves_a_schedules_destinations_from_its_PROFILE() -> None:
    assert pipeline_mod.targets_for({}, {"role": "ops"}, CFG) \
        == ["entity:notify.the_ipad"]


def test_the_PROFILE_OUTRANKS_a_schedules_own_stored_list() -> None:
    """⚠️ THE ORDERING IS THE FEATURE. If the stored list won, a villa that
    configured People would go on delivering to the list it can no longer see —
    "I set it up and nothing changed", which is what this release removes."""
    legacy_schedule = {"role": "ops", "targets": ["entity:notify.old"]}
    assert pipeline_mod.targets_for({}, legacy_schedule, CFG) \
        == ["entity:notify.the_ipad"]


def test_a_schedule_with_NO_profile_still_delivers_where_it_always_did() -> None:
    """Nothing is rewritten on read: an install that never opens the dialog
    keeps working, through both legacy fallbacks in order."""
    assert pipeline_mod.targets_for({}, {"targets": ["entity:notify.old"]}, CFG) \
        == ["entity:notify.old"]
    assert pipeline_mod.targets_for({"notify_targets": ["notify.shared"]},
                                    {}, CFG) == ["notify.shared"]


def test_a_profile_NOBODY_is_configured_for_falls_BACK_rather_than_nowhere() -> None:
    """A hand-written config naming an unconfigured profile keeps its own list.
    The dialog refuses to CREATE this state; the backend degrades rather than
    going silent at 03:00."""
    assert pipeline_mod.targets_for({}, {"role": "guest",
                                         "targets": ["entity:notify.old"]},
                                    CFG) == ["entity:notify.old"]


# ── the voice comes from the same row ───────────────────────────────────────
def test_the_voice_is_derived_from_the_PROFILE() -> None:
    assert pipeline_mod.audience_of({"role": "ops"}, CFG) == "facility"
    assert pipeline_mod.audience_of({"role": "owner"}, CFG) == "owner"


def test_a_GUEST_profile_is_written_in_the_owner_voice() -> None:
    """`AUDIENCE_OF_ROLE` is the one table, and it maps two profiles onto one
    voice — which is exactly why profiles and audiences may not be merged."""
    assert pipeline_mod.audience_of({"role": "guest"}, CFG) == "owner"


def test_a_STORED_audience_still_wins() -> None:
    """⚠️ Dropping it would silently rewrite what every configured briefing
    sounds like on upgrade, and the two voices are opposites. A stored choice is
    a decision somebody made; the dialog clears it when the operator picks a
    profile, so a deliberate edit is not outvoted by it."""
    assert pipeline_mod.audience_of({"audience": "owner", "role": "ops"},
                                    CFG) == "owner"


def test_an_UNKNOWN_profile_falls_back_to_the_QUIETER_voice() -> None:
    """The owner voice is the half that withholds identifiers."""
    assert pipeline_mod.audience_of({"role": "adminz"}, CFG) == "owner"
    assert pipeline_mod.audience_of({}, CFG) == "owner"


def test_the_INVERSE_lookup_is_GONE_and_must_not_come_back() -> None:
    """⚠️ RETIRED RATHER THAN LEFT BESIDE THE NEW ONE. `audience_for_target` and
    `unclaimed` answered target -> profile, which is the misreading v2.651.0
    shipped; two lookups pointing opposite ways over one table is an invitation
    to reach for the wrong one."""
    for gone in ("audience_for_target", "unclaimed", "person_for_target"):
        assert not hasattr(people_mod, gone), (
            f"{gone} is back — it encodes the inverse direction")


def test_the_schedules_PROFILE_KEY_crosses_every_boundary_intact() -> None:
    """⚠️ ONE STRING LITERAL, FOUR FILES, THREE LANGUAGES, NOTHING BETWEEN THEM.

    A schedule's profile is written by `reportsApi.ts`, stored verbatim, refused
    by `store.validate_config`, and read by `pipeline.targets_for`. It is a
    single word and therefore identical in both vocabularies — which is exactly
    why the wire-key defect of v2.545.0 hid in the five single-word keys and
    surfaced only in the two that differ. A rename on one side would not fail to
    compile anywhere; it would simply stop resolving, and a schedule with a
    profile nobody can read falls back to its legacy list forever.

    ⚠️ AND THE SPA MUST OFFER EXACTLY THE PROFILES THE BACKEND ACCEPTS. The SPA
    builds its select from `auth/roles.ts`; the proxy refuses anything outside
    `contracts.PROFILE`. A value in one and not the other is a save that 400s
    with nothing on screen explaining which field the server disliked.
    """
    import re

    from vesta.shared import contracts as reports_contracts

    def read(rel: str) -> str:
        with open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as handle:
            return handle.read()

    types_ts = read("src/vesta/shared/reportsTypes.ts")
    assert re.search(r"^\s*role\?: Role;", types_ts, re.M), (
        "ReportSchedule lost its `role` field, or renamed it — the backend "
        "still resolves destinations from that exact key")

    api_ts = read("src/vesta/brief/reportsApi.ts")
    assert "s.role" in api_ts, (
        "parseSchedule no longer reads `role` off the stored document, so every "
        "schedule would render as having no profile")

    # ⚠️ THE SELECT'S OPTIONS AND THE VALIDATOR'S ALLOW-LIST, DERIVED FROM BOTH
    # SIDES rather than restated here — a literal list in this test would be a
    # fifth copy of the same three words.
    roles_ts = read("src/auth/roles.ts")
    match = re.search(r"ROLE_ORDER: Role\[\] = \[([^\]]*)\]", roles_ts)
    assert match, "ROLE_ORDER not found; this test is checking nothing"
    assert tuple(re.findall(r'"([a-z]+)"', match.group(1))) \
        == reports_contracts.PROFILE, (
        "the profiles the dialog offers are not the profiles the store accepts")


def test_the_PANEL_NO_LONGER_ASKS_FOR_A_CHAT_AT_ALL() -> None:
    """⚠️ PINNED BY ABSENCE, AND THIS IS THE CONTROL THAT CAUSED THE INCIDENT.

    The removed column was a picker of the bot's private chats. Its option list
    was built from any telegram-platform registry entry whose unique_id had an
    underscore, so when Home Assistant grew an update-EVENT entity the list
    offered "Vesta_… Update event" as a PERSON. It was reasonably selected, and
    a stored value that can never equal a sender id then refused every button
    press by everybody.

    The owner's ruling: "there is no need for 'can message' selection here,
    since it will be fully handled by the telegram group/channel configured."
    So the field is gone, and a future panel must not reintroduce it.
    """
    import re

    panel = os.path.join(REPO_ROOT, "src", "components", "settings",
                         "PeoplePanel.tsx")
    with open(panel, encoding="utf-8") as handle:
        source = handle.read()
    # ⚠️ COMMENTS STRIPPED FIRST, AND THE FIRST VERSION OF THIS TEST FAILED
    # BECAUSE THEY WERE NOT. The header above explains the removal and has to
    # NAME the removed label to do so, so a raw substring search over the file
    # reports the control as present while reading its own obituary. Assert
    # against the CODE, never against prose describing it.
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    source = re.sub(r"(?m)^\s*//.*$", "", source)
    assert "Can message the villa" not in source, (
        "the inbound chat picker is back — it is the control that stored an "
        "unmatchable id and refused every press")
    assert "loadBotChats" not in source and "row.telegram" not in source


def test_the_profile_vocabulary_is_the_APPS_OWN() -> None:
    """⚠️ `contracts.PROFILE` is what `store.validate_config` refuses a bad
    schedule `role` against, and `supervisor-proxy.AUTH_ROLES` is the authority
    for every profile list in this app. A fourth spelling of "who a person is"
    is how `facility` and `ops` once appeared in one picker."""
    import re

    from vesta.shared import contracts as reports_contracts

    proxy_path = os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                              "supervisor-proxy.py")
    with open(proxy_path, encoding="utf-8") as handle:
        match = re.search(r"AUTH_ROLES\s*=\s*\(([^)]*)\)", handle.read())
    assert match, "AUTH_ROLES not found; this test is checking nothing"
    assert reports_contracts.PROFILE == tuple(
        re.findall(r'"([a-z]+)"', match.group(1)))
    assert set(people_mod.AUDIENCE_OF_ROLE) == set(reports_contracts.PROFILE), (
        "a profile with no audience answers nothing, silently")


# ── the duplicated constant, pinned equal ───────────────────────────────────
def test_the_two_AUDIENCE_OF_ROLE_tables_agree() -> None:
    """⚠️ DUPLICATED ON PURPOSE: `agent.playbooks` cannot be imported from
    `reports/` (layering is strictly downward), and this fact is needed on both
    sides. Two copies with nothing checking them is the drift this repo has paid
    for repeatedly — so they are pinned equal rather than trusted."""
    from vesta.supervise.agent import playbooks
    assert people_mod.AUDIENCE_OF_ROLE == playbooks.AUDIENCE_OF_ROLE


def test_policy_OFFERS_NO_SENDER_LOOKUP_EITHER() -> None:
    """⚠️ THE AGENT'S OWN ENTRY POINT IS GONE TOO, and both halves must stay
    gone together. While either survived, a caller could resolve a sender to a
    role and gate on it — which is the second allow-list this removal exists to
    delete. `test_reachability` would also flag an uncalled survivor, but this
    says WHY rather than merely that nothing calls it."""
    from vesta.supervise.agent import policy
    assert not hasattr(policy, "sender_role")


def test_the_CONFIG_no_longer_carries_an_inbound_allow_list() -> None:
    """⚠️ `allowed_senders` WAS THE OLDER SPELLING OF THE SAME GATE, kept for a
    migration that no longer has anywhere to migrate to. Leaving the key in
    DEFAULTS would let a hand-edited document reintroduce it silently."""
    from vesta.supervise.agent import config as agent_config
    assert "allowed_senders" not in agent_config.DEFAULTS
    assert "allowed_senders" not in agent_config.MUST_BE_EMPTY
