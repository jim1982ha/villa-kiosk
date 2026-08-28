"""The Concern is the alert; a to-do item is the record. TASK-046, REQ-038.

⚠️ ONE FINDING USED TO PRODUCE TWO NOTIFICATIONS ON TWO LADDERS. `task.raise_for`
fired `vesta_task_event`; `vesta_task_actions.yaml` heard it, messaged the
facility manager, re-asked at fifteen minutes and escalated to the owner at
forty-five — while the add-on's own ladder was separately chasing the concern.
Acknowledging one did not stop the other, which is a defect you can only fix by
handling it in two places or by removing one of them.

The owner removed one (2026-08-28): *"shall we consider the Concern as an alert,
and never send notification on what we are calling jobs now?"*. With no event
fired the blueprint never triggers, so its ladder, its buttons and its escalation
stop existing rather than being suppressed. **A bug that cannot be expressed
beats a bug somebody remembered to handle.**

⚠️ AND THE WORK STILL HAS TO REACH SOMEBODY. "It appears on a list" is how work
goes unnoticed, so `digest.py` announces it once a day, in aggregate, to whoever
holds the facility manager role. That is the one thing replacing the per-item
messages, and these tests pin both halves: that nothing announces itself, and
that the digest does.
"""

from __future__ import annotations

import inspect
import os
import re
import sys
from typing import Any, Dict, List, Mapping

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import digest, task                                # noqa: E402

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _code(fn: Any) -> str:
    return re.sub(r"#[^\n]*", "", inspect.getsource(fn))


# ── nothing announces itself any more ───────────────────────────────────────
def test_raising_a_to_do_item_FIRES_NO_EVENT() -> None:
    """⚠️ THE WHOLE SIMPLIFICATION IN ONE ASSERTION. The event is what woke the
    blueprint; with it gone the second ladder cannot run, so the "acknowledged
    one, still chased by the other" defect is unreachable rather than fixed."""
    code = _code(task.raise_for)
    assert "fire_event" not in code, (
        "a to-do item still announces itself, so the blueprint's ladder is "
        "alive and there are two chases again")


def test_the_EVENT_TYPE_constant_is_GONE_not_merely_unused() -> None:
    """⚠️ AN UNUSED CONSTANT IS AN INVITATION. Leaving `vesta_task_event`
    declared would let the next reader wire it back in one plausible line —
    the shape CLAUDE.md warns about for the deleted blueprint-era names."""
    assert not hasattr(task, "EVENT_TYPE")
    src = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                            "task.py"), encoding="utf-8").read()
    body = re.sub(r"#[^\n]*", "", src)
    assert "vesta_task_event" not in body.split('"""', 2)[-1], (
        "the retired event name is still live code rather than only history")


def test_the_ITEM_is_still_created() -> None:
    """⚠️ ONLY THE ANNOUNCEMENT WENT. Removing the record too would have been
    the 2.763.0 defect again: a concern nobody is asked to act on."""
    code = _code(task.raise_for)
    assert "todo" in code and "add_item" in code


# ── the digest ──────────────────────────────────────────────────────────────
def test_it_lists_every_open_item_IN_A_PERSON_S_WORDS() -> None:
    """⚠️ THE REFERENCE USED TO BE PRINTED AND IS NOW DELIBERATELY ABSENT
    (2026-08-28). This asserted `[c7]` appeared, on the reasoning that the
    bracket "ties a line to the alert behind it and to the row the tablet
    ticks" — true of the software, worth nothing to the reader, who cannot type
    `c7` anywhere. The owner reported seeing it on a screen; the tying is done
    by `ledger.TASK_PREFIX` against the STORED summary, which is untouched.

    ⚠️ THE ABSENCE IS PINNED IN `test_no_internal_ids_on_screen.py`, which owns
    that rule for every surface. What is pinned HERE is what remains true of a
    digest: every item is named, and named readably."""
    body = digest.compose([{"rule_id": "c7", "text": "Pool pump cycling"},
                           {"rule_id": "c9", "text": "Filter overdue"}])
    assert "Pool pump cycling" in body
    assert "Filter overdue" in body
    assert body.count("\n- ") + 1 == 2, "an item was dropped from the list"


def test_a_LONG_list_is_capped_and_SAYS_it_was() -> None:
    """⚠️ TRUNCATION IS ALWAYS EXPLICIT. A notify platform cuts a long body
    silently, which would drop the tail of somebody's work with no sign — the
    rule this project applies to tool results, applied to prose."""
    rows = [{"rule_id": f"c{i}", "text": f"Item {i}"} for i in range(40)]
    body = digest.compose(rows)
    assert body.count("\n- ") + 1 <= digest.MAX_LISTED + 2
    assert f"and {40 - digest.MAX_LISTED} more" in body


def test_it_points_at_the_TAB_by_its_current_name() -> None:
    """The tab was renamed and then MERGED on 2026-08-28 — the list now lives
    under Act & Tell — and a digest naming a tab that is not there sends
    somebody hunting.

    ⚠️ DERIVED FROM THE TAB STRIP, NOT SPELLED OUT. Writing the current name
    here makes this pin need editing on the next rename, which is how it came
    to name a tab that had been gone for an hour. `test_no_internal_ids_on_
    screen.py` cross-checks the digest's own words against `AgentModal`'s
    labels; this asserts only that it still says where to go."""
    body = digest.compose([{"rule_id": "c1", "text": "x"}])
    assert "in VESTA" in body, "the digest no longer says where to act"


def test_the_DAY_BOUNDARY_is_the_one_the_budget_already_owns() -> None:
    """⚠️ TWO IMPLEMENTATIONS OF "today" IS HOW A VILLA ON UTC+8 GETS TWO
    ANSWERS. `budget._day_start` carries the reasoning about the container's
    timezone; this asks it rather than computing a second one."""
    assert "budget_mod._day_start" in _code(digest.due)


def test_it_is_due_once_a_day_not_once_a_tick(tmp_path: Any,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    """It rides the chase clock, which ticks every fifteen minutes."""
    monkeypatch.setattr(digest, "STATE_FILE", str(tmp_path / "d.json"))
    assert digest.due(), "a villa that has never sent one is due"
    digest._stamp()
    assert not digest.due(), "a second tick in the same day would send again"
    # ⚠️ AND THE SENDER MUST ASK IT. Testing `due` alone is `pin-the-caller`
    # for the fifteenth time — the mutation that deleted the check from
    # `send_daily` left every assertion above green, and the digest would have
    # gone out every fifteen minutes.
    assert "if not due(now)" in _code(digest.send_daily), (
        "send_daily does not consult `due`, so it sends on every chase tick")


def test_a_FAILED_SEND_is_not_stamped(monkeypatch: pytest.MonkeyPatch) -> None:
    """⚠️ OR A DAY'S WORK IS SWALLOWED BY ONE UNREACHABLE TARGET. The stamp is
    the record that somebody was told; writing it when nobody was is the same
    class of lie as marking a concern delivered on a failed send."""
    code = _code(digest.send_daily)
    # ⚠️ THE GUARD ITSELF, NOT ITS POSITION. The first cut compared the ORDER
    # of two strings and survived `if not sent:` becoming `if False:` — both
    # lines were still there, in the same order, guarding nothing.
    assert "if not sent:" in code, (
        "nothing checks whether the digest actually reached anybody")
    guard = code.index("if not sent:")
    stamped = code.index("_stamp(now)\n    stage(")
    assert guard < stamped, (
        "the send is stamped before the failure is checked, so an unreachable "
        "facility manager loses that day's digest entirely")


def test_NOTHING_OUTSTANDING_is_silent_but_still_stamps() -> None:
    """⚠️ SILENT BECAUSE IT IS A MESSAGE TO A PERSON, not an instrument whose
    silence could be misread. But the clock is still stamped, or an item raised
    at 23:55 would be announced immediately — a per-item notification wearing a
    digest's name."""
    code = _code(digest.send_daily)
    block = code[code.index("if not items:"):]
    assert "_stamp(now)" in block.split("return")[0]
    assert '"nothing outstanding"' in block


def test_it_goes_to_the_FACILITY_MANAGER_not_the_owner() -> None:
    """The whole point is reaching whoever does the work, rather than whoever
    was told about the finding — the alert already did that."""
    assert digest.ROLE == "ops"
    assert "targets_for_role(config, ROLE)" in _code(digest.send_daily)


def test_every_refusal_has_a_DISTINCT_reason() -> None:
    """⚠️ "NOTHING HAPPENED" HAS FIVE CAUSES AND FOUR ARE FINE. A caller that
    could not tell them apart would report a healthy villa and a broken one
    identically — `scheduler.run_once`'s rule, applied here."""
    code = _code(digest.send_daily)
    reasons = set(re.findall(r'return "([^"]+)"', code))
    assert len(reasons) >= 5, f"only {len(reasons)} distinct reasons: {reasons}"


# ── the wiring ──────────────────────────────────────────────────────────────
def test_the_digest_is_REACHED_from_a_clock() -> None:
    """⚠️ THE ASSERTION THAT WOULD CATCH THE DEFECT THIS REPO KEEPS MAKING. A
    digest nothing calls is `concerns.verify` again."""
    from agent import scheduler
    code = _code(scheduler.chase_forever)
    assert "send_daily" in code, "nothing ever sends the digest"


def test_it_rides_the_EXISTING_clock_rather_than_a_fifth_loop() -> None:
    """It decides its own dueness from a stamp, so all a loop provides is
    somewhere to ask often enough. A task of its own would be another thing to
    start, stop and forget to cancel."""
    proxy = open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin",
                              "supervisor-proxy.py"), encoding="utf-8").read()
    # ⚠️ ANCHORED ON `create_task`, NOT ON THE WORD. The first cut asserted
    # "digest" was absent from the proxy and matched `hexdigest()` in the
    # session-token signing — an unanchored substring over a 3,700-line file,
    # which is this repo's most repeated test defect and was caught on the
    # first run.
    body = re.sub(r"#[^\n]*", "", proxy)
    started = re.findall(r'create_task\(\s*([\w.]+)', body)
    assert not any("digest" in name for name in started), (
        f"the digest has a background task of its own ({started}); it should "
        f"ride the chase clock, which already ticks every 15 minutes")
