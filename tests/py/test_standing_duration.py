"""How long a device has been down, in the section that says it is down.

⚠️ A TELEVISION FOUND THIS (owner's brief, 2026-08-30). Four items sat under
"needs attention right now" and only three of them did: two Zigbee sensors dead
for a week, an open fault — and an LG webOS TV, which drops its network
connection when switched off and so reports `unavailable` twelve seconds later.
Rendered as the bare word "Unavailable", a TV somebody turned off at bedtime and
a sensor that had been dead since last Sunday were the same line.

⚠️ INFORMATION, NOT SUPPRESSION. Nothing is filtered and no grace window is
applied — the owner chose that over a settling threshold. A tier that decides a
device is "not down enough to mention" is making a judgement silently; one that
says "for 2 minutes" lets the reader make it.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.brief import standing  # noqa: E402
from vesta.shared import text as text_mod  # noqa: E402

NOW = datetime(2026, 8, 30, 13, 39, tzinfo=timezone.utc)


def _phrase(**delta: float) -> str:
    """The phrase for a device that went down `delta` ago."""
    return text_mod.for_phrase(timedelta(**delta).total_seconds() * 1000.0)


def test_a_WEEK_reads_in_days_and_a_MINUTE_reads_in_minutes() -> None:
    """The distinction the whole change exists for: these two must not be the
    same string, because on the delivered brief they were."""
    week = _phrase(days=7)
    tv = _phrase(seconds=12)
    assert week == "for 7 days", week
    assert tv == "for under a minute", tv
    assert week != tv


def test_the_scale_moves_through_minutes_hours_days() -> None:
    assert _phrase(minutes=12) == "for 12 minutes"
    assert _phrase(minutes=59) == "for 59 minutes"
    assert _phrase(hours=3) == "for 3 hours"
    assert _phrase(hours=47) == "for 47 hours"
    assert _phrase(hours=48) == "for 2 days"


def test_ONE_of_a_unit_is_not_pluralised() -> None:
    """⚠️ "for 1 days" is the kind of thing a reader stops trusting."""
    assert _phrase(minutes=1) == "for 1 minute"
    assert _phrase(hours=1) == "for 1 hour"
    assert _phrase(hours=72) == "for 3 days"


def _build(states: List[Dict[str, Any]]) -> List[Any]:
    entities = {s["entity_id"]: s for s in states}
    return standing.build(
        entities=entities,
        device_config={"entityMap": {i: {"type": "sensor"} for i in entities}},
        fm_data={}, now=NOW)


def _detail_of(items: List[Any], entity_id: str) -> str:
    for item in items:
        if item.entity_id == entity_id:
            return item.detail
    raise AssertionError(f"{entity_id} not reported at all: {items}")


def test_the_DURATION_reaches_the_rendered_item() -> None:
    """⚠️ PIN THE ITEM, NOT THE HELPER. A perfect `_for_phrase` that nothing
    calls would leave the delivered brief exactly as it was — this repo has
    shipped that shape enough times to have a memory file about it."""
    down_a_week = (NOW - timedelta(days=7)).isoformat()
    items = _build([
        {"entity_id": "sensor.a_temperature", "state": "unavailable",
         "last_changed": down_a_week, "attributes": {"friendly_name": "A"}},
    ])
    assert _detail_of(items, "sensor.a_temperature") == "Unavailable for 7 days"


def test_an_UNKNOWN_stamp_keeps_the_bare_word() -> None:
    """⚠️ NEVER GUESS SHORT. A missing or unreadable stamp means we do not know
    how long, and rendering that as a small number would state the opposite of
    what we have — the failure mode `feedback_instruments-never-skip` catalogues.
    """
    items = _build([
        {"entity_id": "sensor.b_temperature", "state": "unavailable",
         "attributes": {"friendly_name": "B"}},
        {"entity_id": "sensor.c_temperature", "state": "unavailable",
         "last_changed": "not a timestamp", "attributes": {"friendly_name": "C"}},
    ])
    assert _detail_of(items, "sensor.b_temperature") == "Unavailable"
    assert _detail_of(items, "sensor.c_temperature") == "Unavailable"


def test_NOTHING_IS_SUPPRESSED_however_short_the_outage() -> None:
    """⚠️ THE OWNER'S CHOICE, PINNED SO IT IS NOT QUIETLY REVISITED. The
    alternative on the table was a settling window that drops a device down for
    less than N minutes. This is the other one: the TV still appears, it just
    says how long."""
    items = _build([
        {"entity_id": "media_player.d", "state": "unavailable",
         "last_changed": (NOW - timedelta(seconds=12)).isoformat(),
         "attributes": {"friendly_name": "D"}},
    ])
    assert _detail_of(items, "media_player.d") == "Unavailable for under a minute"


def test_the_PARITY_FIELDS_are_untouched() -> None:
    """⚠️ `detail` IS NOT PART OF THE KIOSK CONTRACT — `test_consistency_parity`
    compares `kind`, `title` and `room`, which is what makes enriching this one
    field safe. If that ever changes, this pin is where the reason lives."""
    items = _build([
        {"entity_id": "sensor.e_temperature", "state": "unavailable",
         "last_changed": (NOW - timedelta(days=3)).isoformat(),
         "attributes": {"friendly_name": "E"}},
    ])
    item = items[0]
    assert item.kind == "unavailable"
    assert item.subject == "unavailable:sensor.e_temperature"
    assert item.detail.startswith("Unavailable")


def test_the_DAYS_branch_can_never_say_ONE() -> None:
    """⚠️ WHY THERE IS NO SINGULAR FOR DAYS. The hours→days cutover is 48 h, so
    the days branch starts at 2 and "for 1 day" is unreachable. A singular arm
    there would read as handled and never run — mutation testing found exactly
    that, by deleting one and staying green. This pin is what makes its absence
    a decision rather than an omission, and it fails the moment the cutover
    moves below two days."""
    for hours in range(text_mod.DAYS_FROM_HOURS, text_mod.DAYS_FROM_HOURS + 240):
        phrase = _phrase(hours=hours)
        if phrase.endswith("days"):
            count = int(phrase.split()[1])
            assert count >= 2, f"{hours}h yielded {phrase!r}, so a singular IS reachable"
