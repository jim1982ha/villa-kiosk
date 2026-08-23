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

OWNER = {"name": "Jm", "telegram": "765979167",
         "targets": ["entity:notify.iphone_16_fab"], "role": "owner"}
FM = {"name": "Facility", "telegram": "",
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
    assert people_mod.audience_for_target(
        CFG, "entity:notify.the_ipad") == "facility"


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
    bad = {"people": [{"name": "x", "telegram": "1", "role": "adminz"}]}
    assert people_mod.people(bad) == []
    assert people_mod.role_for_sender(bad, channel="telegram",
                                      sender_id="1") == ""


# ── the lookup that replaced the dropdown ───────────────────────────────────
def test_the_audience_follows_the_person_a_brief_is_SENT_to() -> None:
    assert people_mod.audience_for_target(
        CFG, "entity:notify.iphone_16_fab") == "owner"
    assert people_mod.audience_for_target(
        CFG, "entity:notify.the_ipad") == "facility"


def test_a_target_NOBODY_claims_returns_EMPTY_not_a_guess() -> None:
    """⚠️ `""` means "nobody has said", and it must not read as a default. The
    UI greys that option and refuses to save; the backend degrades to the owner
    voice, which is the half that withholds identifiers."""
    assert people_mod.audience_for_target(CFG, "entity:notify.nobody") == ""
    assert people_mod.unclaimed(CFG, ["entity:notify.nobody",
                                      "entity:notify.the_ipad"]) \
        == ["entity:notify.nobody"]


def test_the_pipeline_DERIVES_the_audience_from_the_target() -> None:
    """The redundancy the owner reported, removed at the one resolver."""
    assert pipeline_mod.audience_of(
        {"cadence": "daily"}, CFG,
        targets=["entity:notify.the_ipad"]) == "facility"


def test_a_STORED_audience_still_wins() -> None:
    """⚠️ Dropping it would silently rewrite what every configured briefing
    sounds like on upgrade, and the two voices are opposites. A stored choice is
    a decision somebody made."""
    assert pipeline_mod.audience_of(
        {"audience": "owner"}, CFG,
        targets=["entity:notify.the_ipad"]) == "owner"


def test_an_UNCLAIMED_target_falls_back_to_the_QUIETER_voice() -> None:
    assert pipeline_mod.audience_of(
        {}, CFG, targets=["entity:notify.nobody"]) == "owner"


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
