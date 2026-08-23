"""The people table — one row per person, two directions, not symmetric.

⚠️ MERGING AN AUTH ALLOW-LIST WITH A DELIVERY LIST HAS EXACTLY ONE DANGEROUS
FAILURE, AND IT IS THE FIRST TEST BELOW. `allowed_senders` decided who may talk
to the villa; the schedule targets decided where a brief is sent. They are now
one table because they were always one fact about one person — but a notify
destination can only RECEIVE, so treating one as identity would let anyone who
can name a notify entity assume that person's role. Everything else here is
convenience; that one is the boundary.
"""

from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from reports import people as people_mod  # noqa: E402
from reports import pipeline as pipeline_mod  # noqa: E402

OWNER = {"telegram": "765979167",
         "targets": ["entity:notify.iphone_16_fab"], "role": "owner"}
FM = {"telegram": "",
      "targets": ["entity:notify.the_ipad"], "role": "ops"}
CFG = {"people": [OWNER, FM]}


# ── the boundary ────────────────────────────────────────────────────────────
def test_a_DELIVERY_TARGET_is_never_an_identity() -> None:
    """⚠️ THE ONE WAY THIS MERGE COULD HAVE WIDENED THE ALLOW-LIST. A notify
    entity can only receive; naming one must grant nothing inbound. If this ever
    goes green in the other direction, anyone who can guess a notify entity id
    can speak to the villa as its owner."""
    assert people_mod.role_for_sender(
        CFG, channel="telegram", sender_id="entity:notify.iphone_16_fab") == ""
    assert people_mod.role_for_sender(
        CFG, channel="telegram", sender_id="notify.the_ipad") == ""


def test_a_person_with_NO_telegram_grants_nothing_inbound() -> None:
    """A delivery-only row is a normal row, and it is not a credential."""
    assert people_mod.role_for_sender(CFG, channel="telegram",
                                      sender_id="") == ""
    # The FM is reachable and cannot speak.
    assert people_mod.targets_for_role(CFG, "ops") == ["entity:notify.the_ipad"]


def test_an_unknown_sender_is_NOBODY() -> None:
    assert people_mod.role_for_sender(CFG, channel="telegram",
                                      sender_id="999") == ""


def test_another_channel_is_NOBODY_even_with_a_matching_id() -> None:
    """⚠️ A Telegram user id and a future WhatsApp id are integers from
    different namespaces and would eventually collide."""
    assert people_mod.role_for_sender(CFG, channel="whatsapp",
                                      sender_id="765979167") == ""


def test_an_EMPTY_table_answers_nobody() -> None:
    assert people_mod.role_for_sender({}, channel="telegram",
                                      sender_id="765979167") == ""
    assert people_mod.people({}) == []


def test_a_row_with_an_UNKNOWN_ROLE_is_dropped_not_defaulted() -> None:
    """⚠️ The role decides both whether somebody may speak and which voice they
    are written in — one withholds entity ids, the other requires them. A
    default here would be a privilege decision made by a typo."""
    bad = {"people": [{"telegram": "1", "role": "adminz"}]}
    assert people_mod.people(bad) == []
    assert people_mod.role_for_sender(bad, channel="telegram",
                                      sender_id="1") == ""


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


def test_a_person_with_a_CHAT_and_no_device_makes_no_profile_reachable() -> None:
    """The asymmetry, from the delivery side: `role_for_sender` says they may
    speak and this says there is nowhere to write back to on a schedule."""
    chat_only = {"people": [{"telegram": "1", "role": "ops",
                             "targets": []}]}
    assert people_mod.role_for_sender(chat_only, channel="telegram",
                                      sender_id="1") == "ops"
    assert people_mod.targets_for_role(chat_only, "ops") == []


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

    from reports import contracts as reports_contracts

    def read(rel: str) -> str:
        with open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as handle:
            return handle.read()

    types_ts = read("src/reports/reportsTypes.ts")
    assert re.search(r"^\s*role\?: Role;", types_ts, re.M), (
        "ReportSchedule lost its `role` field, or renamed it — the backend "
        "still resolves destinations from that exact key")

    api_ts = read("src/reports/reportsApi.ts")
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


def test_the_profile_vocabulary_is_the_APPS_OWN() -> None:
    """⚠️ `contracts.PROFILE` is what `store.validate_config` refuses a bad
    schedule `role` against, and `supervisor-proxy.AUTH_ROLES` is the authority
    for every profile list in this app. A fourth spelling of "who a person is"
    is how `facility` and `ops` once appeared in one picker."""
    import re

    from reports import contracts as reports_contracts

    proxy_path = os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                              "supervisor-proxy.py")
    with open(proxy_path, encoding="utf-8") as handle:
        match = re.search(r"AUTH_ROLES\s*=\s*\(([^)]*)\)", handle.read())
    assert match, "AUTH_ROLES not found; this test is checking nothing"
    assert reports_contracts.PROFILE == tuple(
        re.findall(r'"([a-z]+)"', match.group(1)))
    assert set(people_mod.AUDIENCE_OF_ROLE) == set(reports_contracts.PROFILE), (
        "a profile with no audience answers nothing, silently")


# ── the migration ───────────────────────────────────────────────────────────
def test_the_LEGACY_map_still_answers_when_the_table_is_empty() -> None:
    """⚠️ WITHOUT THIS, UPGRADING MAKES THE BOT GO DEAF. The symptom would be
    "the villa stopped answering me" with nothing in the config visibly
    wrong."""
    legacy = {"allowed_senders": {"telegram:765979167": "owner"}}
    assert people_mod.role_for_sender(legacy, channel="telegram",
                                      sender_id="765979167") == "owner"
    rows = people_mod.people(legacy)
    assert len(rows) == 1 and rows[0]["role"] == "owner"
    assert rows[0]["targets"] == [], "a legacy sender has no delivery target"


def test_the_NEW_table_wins_over_the_legacy_map() -> None:
    """Once an owner has edited the new panel, the old map must not resurrect a
    sender they removed — the config-resurrection bug in a new place."""
    both = {"people": [OWNER],
            "allowed_senders": {"telegram:111": "owner"}}
    assert people_mod.role_for_sender(both, channel="telegram",
                                      sender_id="111") == ""
    assert people_mod.role_for_sender(both, channel="telegram",
                                      sender_id="765979167") == "owner"


def test_the_migration_does_not_WRITE(tmp_path, monkeypatch) -> None:
    """⚠️ A config rewrite on READ is how a store silently loses a key it did
    not understand, and this path runs on every message."""
    path = str(tmp_path / "agent-config.json")
    monkeypatch.setattr(people_mod, "CONFIG_PATH", path)
    people_mod.people({"allowed_senders": {"telegram:1": "owner"}})
    assert not os.path.exists(path)


# ── the duplicated constant, pinned equal ───────────────────────────────────
def test_the_two_AUDIENCE_OF_ROLE_tables_agree() -> None:
    """⚠️ DUPLICATED ON PURPOSE: `agent.playbooks` cannot be imported from
    `reports/` (layering is strictly downward), and this fact is needed on both
    sides. Two copies with nothing checking them is the drift this repo has paid
    for repeatedly — so they are pinned equal rather than trusted."""
    from agent import playbooks
    assert people_mod.AUDIENCE_OF_ROLE == playbooks.AUDIENCE_OF_ROLE


def test_policy_delegates_to_this_module() -> None:
    """The agent's own entry point must resolve identically — one table, one
    answer, not two lookups that agree today."""
    from agent import policy
    assert policy.sender_role(CFG, channel="telegram",
                              sender_id="765979167") == "owner"
    assert policy.sender_role(CFG, channel="telegram",
                              sender_id="entity:notify.iphone_16_fab") == ""
