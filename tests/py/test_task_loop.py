"""The caretaker loop: a delivered Concern becomes a job somebody can tick off.

⚠️ WHAT THIS RESTORES. The `maintenance_*`, `roi_*` and `audit_*` blueprints did
TWO things when they fired: emitted their event, and called `todo.add_item` with
a caretaker task. Retiring them kept the detection — the agent replaces it — and
silently dropped the second half. Nothing under `agent/` could write a to-do
item, so a Concern was something to READ and never something anybody was asked
to do. `vesta_task_actions.yaml` was left with no producer and read as leftover
code; it is not, it is a finished feature whose input was switched off.

⚠️ THE CONTRACT IS WITH A YAML FILE THIS REPO DOES NOT COMPILE, which is why it
is pinned rather than trusted. `vesta_task_actions.yaml` lives in
`sources/files/blueprint/` (gitignored, deployed by hand to Home Assistant), and
nothing about it type-checks against `agent/task.py`. Three separate string
agreements have to hold, and each is silent when broken:

  * the EVENT TYPE the blueprint triggers on;
  * the two event FIELDS it reads, `task_text` and `rule_id`;
  * the `[<rule_id>]` bracket in the todo summary, which its "Done" button
    matches with `selectattr('summary', 'match', '\\[' ~ rule_id ~ '\\]')`.

Break the third and the loop looks like it works right up to the moment somebody
presses Done and nothing happens.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "rootfs", "usr", "bin"))

import pytest  # noqa: E402

from agent import config as agent_config, outbox, task  # noqa: E402

BLUEPRINT = os.path.join(ROOT, "sources", "files", "blueprint",
                         "vesta_task_actions.yaml")


def _blueprint() -> str:
    with open(BLUEPRINT, "r", encoding="utf-8") as handle:
        return handle.read()


needs_blueprint = pytest.mark.skipif(
    not os.path.exists(BLUEPRINT),
    reason="sources/files/blueprint is gitignored and absent on a fresh clone")


def test_the_loop_is_OFF_until_a_list_is_named() -> None:
    """⚠️ NO SEEDED DEFAULT. Which to-do list a property uses is a fact about
    that property, and a default would write jobs into a stranger's list — the
    hard rule this repo ships under."""
    assert agent_config.DEFAULTS[task.CONFIG_KEY] == ""
    assert task.list_for({}) == ""
    assert task.status({})["configured"] is False


def test_no_list_means_no_write_and_no_error() -> None:
    """Off is a configuration state, not a failure: it must not log, must not
    call Home Assistant, and must not look like something went wrong.

    ⚠️ `asyncio.run` IN A SYNC TEST — this repo has no pytest-asyncio, and every
    other async test here does the same (`test_agent_escalation_wiring._run`).
    An `async def` test without it is COLLECTED AND SKIPPED with a warning,
    which is a test that reports success while running nothing."""
    assert asyncio.run(task.raise_for(None, {"id": "c1", "title": "x"})) == "off"


def test_a_concern_with_no_ID_is_REFUSED_rather_than_written() -> None:
    """⚠️ AN ITEM NO BUTTON CAN COMPLETE IS WORSE THAN NO ITEM. The Done button
    finds its item by the bracketed rule id; without one the job sits open
    forever and reads as work nobody did."""
    out = asyncio.run(task.raise_for(None, {"title": "no id"},
                                     config={task.CONFIG_KEY: "todo.x"}))
    assert out == "failed"
    # ⚠️ AND IT MUST REFUSE BEFORE TOUCHING HOME ASSISTANT — which the return
    # value alone cannot show. Deleting the guard ALSO returns "failed", because
    # the call then reaches `HassClient(None)`, raises, and is swallowed: two
    # different outcomes, one indistinguishable answer. The mutation survived on
    # exactly that, so the ORDER is what is pinned.
    src = inspect.getsource(task.raise_for)
    assert src.index("if not rule_id or not summary") < src.index("HassClient"), (
        "the id guard runs after the Home Assistant call, so an unfinishable "
        "job is written and only then refused")


def test_the_summary_carries_the_BRACKETED_id() -> None:
    """The single most breakable link: the blueprint matches on it."""
    made = task.summary_for({"id": "c12", "title": "Pool pump drawing more"})
    assert made.startswith("[c12] ")
    assert re.match(r"\[c12\]", made), "the bracket form the blueprint matches"


@needs_blueprint
def test_the_EVENT_TYPE_matches_what_the_blueprint_listens_for() -> None:
    """⚠️ AND IT MUST NOT BE ONE THE COLLECTOR SUBSCRIBES TO. `collect.state()`
    derives its subscription from installed blueprint stems and turns everything
    it receives into a brief finding — so announcing a task on
    `vesta_maintenance_event` would put the concern in the briefing twice, once
    as a Concern and once as a blueprint finding."""
    from reports import collect
    assert task.EVENT_TYPE not in collect.FALLBACK_EVENT_TYPES, (
        f"{task.EVENT_TYPE} is a collected type, so every caretaker task would "
        "also arrive as a finding and the brief would say it twice")
    body = _blueprint()
    default = re.search(r"task_source:[\s\S]*?default:\s*\n((?:\s*-\s*\S+\n)+)",
                        body)
    assert default, "the blueprint no longer declares a task_source default"
    listed = re.findall(r"-\s*(\S+)", default.group(1))
    assert task.EVENT_TYPE in listed, (
        f"the blueprint does not listen for {task.EVENT_TYPE}; its default "
        f"sources are {listed}. A task would be created and nobody asked.")


@needs_blueprint
def test_the_event_carries_the_FIELDS_the_blueprint_reads() -> None:
    """`task_text` gates the whole automation — its condition refuses an empty
    one — and `rule_id` becomes the button's callback data."""
    body = _blueprint()
    src = inspect.getsource(task.raise_for)
    for field in ("task_text", "rule_id"):
        assert f"trigger.event.data.{field}" in body, (
            f"the blueprint no longer reads {field}")
        assert f'"{field}"' in src, (
            f"the agent does not send {field}, so the blueprint refuses or "
            "builds a dead button")


@needs_blueprint
def test_the_DONE_button_matches_the_summary_this_module_writes() -> None:
    """⚠️ THE FAILURE THIS CATCHES IS INVISIBLE UNTIL SOMEBODY PRESSES THE
    BUTTON. Everything upstream works: the job appears, the message arrives, the
    buttons render — and Done finds nothing to complete."""
    body = _blueprint()
    assert "selectattr('summary', 'match'" in body and "rule_id" in body, (
        "the blueprint no longer completes by matching the summary")
    made = task.summary_for({"id": "c7", "title": "t"})
    # the blueprint's own regex, applied to what we actually write
    assert re.match(r"\[c7\]", made), (
        f"the blueprint would not find {made!r}")


def test_the_task_is_raised_AFTER_the_send_and_only_on_success() -> None:
    """⚠️ ORDERING, AND IT IS THE SAME RULE AS `_mark_delivered`. A job raised
    for a concern whose delivery then failed is a task nobody was told about,
    sitting on a list with no message to explain it."""
    src = inspect.getsource(outbox._deliver_one)
    assert "task_mod.raise_for" in src, "delivery no longer raises a task"
    assert src.index("_mark_delivered") < src.index("task_mod.raise_for"), (
        "the task is raised before the concern is marked delivered")
    for early in ('return "held"', 'return "suppressed"', 'return "failed"'):
        assert src.index(early) < src.index("task_mod.raise_for"), (
            f"a concern that returns {early} would still raise a job")


def test_delivery_is_the_ONLY_bar_and_there_is_no_second_one() -> None:
    """⚠️ NO SEVERITY THRESHOLD HERE. Tier 4 has already decided this concern is
    worth a person's attention; a second bar would be a second opinion on a
    question just answered, and the first villa where the two disagreed would
    have a job nobody was told about, or a message with no job behind it."""
    src = inspect.getsource(outbox._deliver_one)
    after = src[src.index("task_mod.raise_for"):]
    assert "severity" not in after, "a severity threshold crept in"


def test_ESCALATION_re_sends_without_raising_a_SECOND_job() -> None:
    """⚠️ A DUPLICATE JOB IS SILENT AND PERMANENT. `escalation_sweep` re-sends a
    concern nobody acknowledged — to the same target, then to the owner — and
    each of those is a `deliver_mod.deliver` call sitting next to the one in
    `_deliver_one`. Raising a task there too would put a second, third and
    fourth copy of the same job on the caretaker's list, each with the same
    bracketed id, and the Done button completes only the first one it finds.

    The chasing is the BLUEPRINT's job (re-ask, then escalate, then leave open);
    this side raises the job exactly once, when it is first delivered.
    """
    src = inspect.getsource(outbox._escalate_one)
    assert "deliver_mod.deliver" in src, (
        "the escalation path no longer sends, so this test is measuring nothing")
    assert "raise_for" not in src and "task_mod" not in src, (
        "escalation raises a second caretaker job for a concern that already "
        "has one")
