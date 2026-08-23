"""`reports/store.py` — the config overlay and its validation.

The first two tests are the ones that matter, and both pin a rule this project
has already paid for in the field: a stored config is a SPARSE OVERLAY, and a
default must never be written back underneath it.
"""

from __future__ import annotations

from typing import Any, Dict

from reports.store import (
    CONFIG_DEFAULTS,
    EMPTY_CONFIG,
    REPORTS_HISTORY_MAX_ENTRIES,
    config_view,
    history_view,
    trim_history,
    validate_config,
)


def test_empty_config_is_empty() -> None:
    """The hard rule, asserted at the constant.

    CLAUDE.md: prefer an EMPTY default over a seeded one for any user-editable
    config slice, because a seed spread underneath stored config resurrects
    deleted entries. This is the one-line version of that rule, and it is worth
    a test because "add a sensible default schedule" is a genuinely tempting
    change that looks helpful in review.
    """
    assert EMPTY_CONFIG == {}


def test_defaults_are_not_persisted_into_the_view() -> None:
    """`config_view` must not mutate its input or the defaults table."""
    stored: Dict[str, Any] = {"enabled": True}
    before = dict(CONFIG_DEFAULTS)
    view = config_view(stored)
    assert view["enabled"] is True
    assert stored == {"enabled": True}, "config_view mutated the stored document"
    assert CONFIG_DEFAULTS == before, "config_view mutated the defaults table"


def test_deleted_entry_stays_deleted() -> None:
    """The resurrection bug, stated as a behaviour.

    An operator who removes every schedule stores `{"schedules": []}`. If that
    read back as the default, their deleted schedule would return on the next
    restart and deliver a report they switched off. Empty must beat the default;
    only ABSENT falls back.
    """
    assert config_view({"schedules": []})["schedules"] == []
    assert config_view({})["schedules"] == CONFIG_DEFAULTS["schedules"]


def test_unknown_keys_survive_a_downgrade() -> None:
    """A config written by a NEWER add-on must not be silently pruned."""
    view = config_view({"from_the_future": {"a": 1}})
    assert view["from_the_future"] == {"a": 1}


def test_corrupt_config_degrades_to_defaults() -> None:
    for garbage in ([], "text", 7, None):
        assert config_view(garbage) == CONFIG_DEFAULTS


def test_reports_are_disabled_until_asked_for() -> None:
    """A feature that messages people is opt-in, never inherited from an
    update — a villa that updates the add-on must not start sending its owner
    unsolicited notifications."""
    assert config_view({})["enabled"] is False


def test_validate_accepts_a_well_formed_config() -> None:
    assert validate_config({
        "enabled": True,
        "schedules": [{"id": "a", "cadence": "weekly", "hour": 7}],
        "notify_targets": ["mobile_app_x"],
    }) == []


def test_validate_rejects_a_bad_cadence_and_hour() -> None:
    problems = validate_config({"schedules": [{"cadence": "hourly", "hour": 24}]})
    assert len(problems) == 2
    assert any("cadence" in p for p in problems)
    assert any("hour" in p for p in problems)


def test_validate_rejects_a_boolean_hour() -> None:
    """`isinstance(True, int)` is True in Python, so a JSON `true` sails
    through a bare int check and schedules hour 1. Pinned because the bug is
    invisible at the call site."""
    problems = validate_config({"schedules": [{"cadence": "daily", "hour": True}]})
    assert any("hour" in p for p in problems)


def test_validate_accepts_a_schedule_with_a_PROFILE() -> None:
    assert validate_config({
        "schedules": [{"id": "a", "cadence": "weekly", "hour": 7,
                       "role": "ops"}],
    }) == []


def test_validate_accepts_a_schedule_with_NO_profile() -> None:
    """⚠️ OPTIONAL, BECAUSE EVERY SCHEDULE WRITTEN BEFORE PROFILES EXISTED HAS
    NO SUCH KEY. Refusing those would make an upgrade refuse to save a document
    it had itself written."""
    assert validate_config({
        "schedules": [{"id": "a", "cadence": "weekly", "hour": 7}],
    }) == []


def test_validate_rejects_an_UNKNOWN_profile() -> None:
    """⚠️ REFUSED AT THE MOMENT OF THE MISTAKE, not resolved to nowhere at
    delivery time. `targets_for_role` answers `[]` for an unrecognised profile,
    which at 03:00 looks exactly like a villa nobody has configured — the
    subsystem's rule is to refuse when saving and degrade when using."""
    problems = validate_config({
        "schedules": [{"id": "a", "cadence": "weekly", "hour": 7,
                       "role": "facility"}],
    })
    assert any("role" in p for p in problems), (
        "an audience word was accepted as a profile — the two vocabularies are "
        "different sets and `facility` belongs to the other one")


def test_validate_rejects_non_object() -> None:
    assert validate_config(["not", "a", "config"]) == ["config must be an object"]


def test_history_view_shapes_anything() -> None:
    assert history_view(None)["entries"] == []
    assert history_view({"entries": "nope"})["entries"] == []
    assert history_view({"entries": [{"id": "x"}]})["entries"] == [{"id": "x"}]


def test_trim_history_keeps_the_newest() -> None:
    entries = list(range(REPORTS_HISTORY_MAX_ENTRIES + 25))
    trimmed = trim_history(entries)
    assert len(trimmed) == REPORTS_HISTORY_MAX_ENTRIES
    assert trimmed[-1] == entries[-1], "trim dropped the newest entry, not the oldest"
    assert trim_history([1, 2]) == [1, 2]
