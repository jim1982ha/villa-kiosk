"""The facility manager loop: a delivered Concern becomes a job somebody can tick off.

⚠️ WHAT THIS RESTORES. The `maintenance_*`, `roi_*` and `audit_*` blueprints did
TWO things when they fired: emitted their event, and called `todo.add_item` with
a facility manager task. Retiring them kept the detection — the agent replaces it — and
silently dropped the second half. Nothing under `agent/` could write a to-do
item, so a Concern was something to READ and never something anybody was asked
to do. `vesta_task_actions.yaml` was left with no producer and read as leftover
code; it is not, it is a finished feature whose input was switched off.

⚠️ THE CONTRACT IS WITH A YAML FILE THIS REPO DOES NOT COMPILE, which is why it
is pinned rather than trusted. `vesta_task_actions.yaml` lives in
`docs/helpers/blueprint/` (gitignored, deployed by hand to Home Assistant), and
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

from vesta.supervise.agent import config as agent_config
from vesta.supervise.agent import outbox
from vesta.supervise.agent import task




def test_the_loop_is_OFF_until_a_list_is_named() -> None:
    """⚠️ NO SEEDED DEFAULT. Which to-do list a property uses is a fact about
    that property, and a default would write jobs into a stranger's list — the
    hard rule this repo ships under."""
    assert agent_config.DEFAULTS[task.CONFIG_KEY] == ""
    assert task.list_for({}) == ""
    # ⚠️ `status()` WENT IN 2.767.0 — I wrote it "for the settings screen" and
    # never wired it to one, and this line was its ONLY caller. A test is not a
    # consumer: it kept an uncalled function looking alive for three releases,
    # which is dry-audit Part 2's exact failure mode. The field on Act & Tell is
    # the answer to "is the loop on", and an empty list IS the off state.
    assert task.list_for({"task_list": "  "}) == "", (
        "a whitespace-only list must read as off, not as a list named '  '")


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
    """The single most breakable link, and its READER CHANGED on 2026-08-28.

    ⚠️ IT USED TO BE THE BLUEPRINT'S Done BUTTON. That button is gone with the
    rest of the job notifications, and the bracket is now read by
    `ledger.TASK_PREFIX` — which is what `task.reconcile_done` joins on to CLOSE
    an alert when its item is ticked, and what the To-Do List tab reads.
    Same string, same fragility, three fewer things depending on it.
    """
    made = task.summary_for({"id": "c12", "title": "Pool pump drawing more"})
    assert made.startswith("[c12] ")
    from vesta.adapters.ledger import TASK_PREFIX
    matched = TASK_PREFIX.match(made)
    assert matched and matched.group(1) == "c12", (
        "the one parser that reads this bracket no longer recognises what we "
        "write")


def test_the_task_is_raised_AFTER_the_send_and_only_on_success() -> None:
    """⚠️ ORDERING, AND IT IS THE SAME RULE AS `_mark_delivered`. A job raised
    for a concern whose delivery then failed is a task nobody was told about,
    sitting on a list with no message to explain it."""
    src = inspect.getsource(outbox._deliver_one)
    assert "task_mod.raise_for" in src, "delivery no longer raises a task"
    assert src.index("_mark_delivered") < src.index("task_mod.raise_for"), (
        "the task is raised before the concern is marked delivered")
    # ⚠️ `return "suppressed"` left with shadow delivery (2026-08-28):
    # observe-mode concerns are delivered as FYIs now, so that early return no
    # longer exists to order against. The FYI's own no-job rule is pinned in
    # `test_agent_outbox`.
    for early in ('return "held"', 'return "failed"'):
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
    fourth copy of the same job on the facility manager's list, each with the same
    bracketed id, and the Done button completes only the first one it finds.

    The chasing is the BLUEPRINT's job (re-ask, then escalate, then leave open);
    this side raises the job exactly once, when it is first delivered.
    """
    # ⚠️ THE VACUITY GUARD FOLLOWS THE SEND (2026-09-06). It asserted that
    # `_escalate_one` names `deliver_mod.deliver`, which was true while the
    # composition was inlined; the send now goes through `_send_alert`, shared
    # with the first-send path. The guard's job is unchanged — prove this path
    # still sends, so "it raises no second job" is not measured on a function
    # that does nothing.
    src = inspect.getsource(outbox._escalate_one)
    assert "_send_alert" in src, (
        "the escalation path no longer sends, so this test is measuring nothing")
    assert "raise_for" not in src and "task_mod" not in src, (
        "escalation raises a second facility manager job for a concern that already "
        "has one")


# ── the capability nobody checked ───────────────────────────────────────────
class _Hass:
    """A to-do list with a declared feature set, recording what it was sent."""

    def __init__(self, features: int) -> None:
        self.features = features
        self.calls: list = []

    async def __aenter__(self) -> "_Hass":
        return self

    async def __aexit__(self, *_a: object) -> bool:
        return False

    async def command(self, command_type: str, **payload: object) -> object:
        if command_type == "get_states":
            return [{"entity_id": "todo.x",
                     "attributes": {"supported_features": self.features}}]
        self.calls.append((command_type, payload))
        return None


def _raise_with(monkeypatch, features: int) -> _Hass:
    import asyncio

    from vesta.supervise.agent import task as task_mod
    from vesta.adapters import hass as hass_mod

    hass = _Hass(features)
    monkeypatch.setattr(hass_mod, "HassClient", lambda _s: hass)
    asyncio.run(task_mod.raise_for(
        None, {"id": "c1", "title": "Pool pump drawing more than usual",
               "body": "It has been at 340 W for six hours.",
               "severity": "warning", "audience": "facility"},
        config={"task_list": "todo.x"}))
    return hass


def _item_fields(hass: _Hass) -> dict:
    for kind, payload in hass.calls:
        if kind == "call_service" and payload.get("service") == "add_item":
            return dict(payload.get("service_data") or {})
    raise AssertionError(f"no add_item was sent: {hass.calls}")


def test_a_list_that_REFUSES_a_description_still_gets_its_job(
        monkeypatch) -> None:
    """⚠️ THE DEFECT THE FIRST END-TO-END TEST FOUND, ON THE COMMONEST LIST IN
    HOME ASSISTANT. `todo.shopping_list` reports `supported_features: 15` —
    create, delete, update, move — and NO `SET_DESCRIPTION_ON_ITEM` (64).
    Sending one anyway is HTTP 500, and `raise_for` swallows it and returns
    "failed", so every facility manager job on that villa vanished with the
    owner having configured everything correctly.

    ⚠️ 1,908 pins were green through this, and none of them could have caught
    it: the service call is correct, the blueprint is correct, and the defect
    lives in an assumption about the third party between them —
    `feedback_guessed-field-shapes`. The field NAME was right and the
    CAPABILITY was assumed."""
    fields = _item_fields(_raise_with(monkeypatch, 15))
    assert "description" not in fields, (
        "a description was sent to a list that does not accept one — Home "
        "Assistant answers 500 and the job is lost entirely")
    assert fields.get("item", "").startswith("[c1]"), (
        "the ITEM is what the Done button matches on and must survive")


def test_a_list_that_ACCEPTS_one_still_gets_the_evidence(monkeypatch) -> None:
    """⚠️ THE OTHER DIRECTION, PINNED SO THE FIX IS NOT 'DROP IT ALWAYS'. A
    summary is one line on a phone; the evidence belongs in the description
    wherever there is one to put it in."""
    fields = _item_fields(_raise_with(monkeypatch, 15 | 64))
    assert fields.get("description"), (
        "a list that accepts a description got none, so the evidence behind "
        "the job is nowhere a person can read it")


def test_a_list_declaring_NO_features_gets_no_description(monkeypatch) -> None:
    """The readable-but-incapable case, distinct from the unreadable one below."""
    assert "description" not in _item_fields(_raise_with(monkeypatch, 0))


def test_an_UNREADABLE_feature_set_degrades_to_the_shape_that_always_works(
        monkeypatch) -> None:
    """⚠️ THE SAFE DIRECTION IS 'NO DESCRIPTION'. A terser job is a job; a
    rejected one does not exist. Guessing yes is exactly how this shipped.

    ⚠️ THE FIRST VERSION OF THIS TEST PASSED `features=0` AND PROVED NOTHING —
    that is a list that ANSWERED and said "no capabilities", which never reaches
    the exception path the docstring is about. A mutation flipping the fallback
    to `True` stayed GREEN. `feedback_mutation-testing`, and the second time
    today: a test is unproven until it has gone red."""
    import asyncio

    from vesta.supervise.agent import task as task_mod
    from vesta.adapters import hass as hass_mod

    class _Broken(_Hass):
        async def command(self, command_type: str, **payload: object) -> object:
            if command_type == "get_states":
                raise RuntimeError("Home Assistant is mid-restart")
            return await super().command(command_type, **payload)

    hass = _Broken(15 | 64)          # capable, but the answer cannot be read
    monkeypatch.setattr(hass_mod, "HassClient", lambda _s: hass)
    asyncio.run(task_mod.raise_for(
        None, {"id": "c1", "title": "Pool pump", "body": "340 W",
               "severity": "warning", "audience": "facility"},
        config={"task_list": "todo.x"}))

    assert "description" not in _item_fields(hass), (
        "an unreadable feature set was guessed as 'supports descriptions' — on "
        "a list that does not, that guess loses the job entirely")


# ── the other direction: a settled alert ticks its job off ──────────────────
class _ListHass(_Hass):
    """A list holding open items, recording every `update_item` it is sent."""

    def __init__(self, open_items: list) -> None:
        super().__init__(0)
        self.open_items = open_items

    async def command(self, command_type: str, **payload: object) -> object:
        if command_type == "get_states":
            return [{"entity_id": "todo.x", "attributes": {}}]
        self.calls.append((command_type, payload))
        return None


def _ticked(hass: _Hass) -> list:
    return [dict(p.get("service_data") or {}).get("item")
            for kind, p in hass.calls
            if kind == "call_service" and p.get("service") == "update_item"]


def _sweep(monkeypatch, rows: list, open_items: list) -> _Hass:
    from vesta.supervise.agent import concerns as concerns_mod
    from vesta.supervise.agent import task as task_mod
    from vesta.adapters import hass as hass_mod
    from vesta.adapters import ledger as ledger_mod

    hass = _ListHass(open_items)
    monkeypatch.setattr(hass_mod, "HassClient", lambda _s: hass)
    monkeypatch.setattr(concerns_mod, "read", lambda: rows)

    async def _tasks(_h: object, _lists: object, status: str = "") -> list:
        return open_items if status == "needs_action" else []

    monkeypatch.setattr(ledger_mod, "todo_tasks", _tasks)
    asyncio.run(task_mod.reconcile_settled(object(), config={"task_list": "todo.x"}))
    return hass


def test_a_SETTLED_alert_has_its_job_TICKED_OFF(monkeypatch: Any) -> None:
    """⚠️ THE LOOP HAD ONE DIRECTION ONLY, AND THE OWNER RULED ON THE OTHER
    (2026-08-28). A ticked job reconciled back to its alert (`reconcile_done`,
    which acknowledged then and CLOSES since 2.865.0); a
    settled alert did nothing to its job, and `actions._done` was the only thing
    in the tree that ever ticked one. So a thumbs-down — which DISMISSES the
    alert — left work on the facility manager's list for ever, with no alert
    behind it and no way to say where it came from."""
    hass = _sweep(
        monkeypatch,
        rows=[{"id": "c1", "state": "dismissed"},
              {"id": "c2", "state": "open"},
              {"id": "c3", "state": "verified"}],
        open_items=[{"rule_id": "c1", "uid": "u1"},
                    {"rule_id": "c2", "uid": "u2"},
                    {"rule_id": "c3", "uid": "u3"}])
    assert _ticked(hass) == ["u1", "u3"], \
        "a settled alert's job was left open, or a LIVE alert's job was ticked"


def test_it_sweeps_the_STORE_rather_than_being_called_per_settling_path(
        monkeypatch: Any) -> None:
    """⚠️ FIVE PATHS SETTLE AN ALERT — a thumb, a dismissal on the tablet, a
    supersede, the verification sweep, an expiry — and a tick added to each is
    the defect this subsystem produced three times in one day: one rule applied
    at the call sites somebody happened to be looking at. Asking the store what
    is SETTLED covers every path, including ones not yet written, so a state
    reached by no code at all is still swept."""
    hass = _sweep(monkeypatch,
                  rows=[{"id": "c9", "state": "closed"}],
                  open_items=[{"rule_id": "c9", "uid": "u9"}])
    assert _ticked(hass) == ["u9"], \
        "an alert closed by superseding kept its job"
    # ⚠️ EVERY SETTLED STATE, DERIVED FROM THE STORE'S OWN TUPLE rather than
    # transcribed here — a fourth one added there must not silently escape.
    from vesta.supervise.agent import concerns as concerns_mod
    for state in concerns_mod.SETTLED:
        swept = _sweep(monkeypatch, rows=[{"id": "c1", "state": state}],
                       open_items=[{"rule_id": "c1", "uid": "u1"}])
        assert _ticked(swept) == ["u1"], f"{state} did not tick its job"


def test_the_SWEEP_is_REACHED_from_the_chase_clock() -> None:
    """⚠️ THE ASSERTION THAT WOULD CATCH THE DEFECT THIS REPO KEEPS MAKING —
    `feedback_pin-the-caller`. A sweep with unit tests and no caller is a
    subsystem that is green and does nothing, which has happened here before."""
    from vesta.supervise.agent import scheduler
    assert "task_mod.reconcile_settled" in inspect.getsource(scheduler.dispatch), (
        "nothing calls reconcile_settled, so a settled alert's job stays open "
        "for ever however green this file is")


def test_THE_TICK_HAS_ONE_OWNER(monkeypatch: Any) -> None:
    """⚠️ TWO CALLERS, ONE WRITER. The Done button ticks one job and the sweep
    ticks many; two copies of "find the item by its bracket, then complete it"
    is how the join, the status filter and the service call drift apart."""
    from vesta.supervise.agent import actions as actions_mod
    # ⚠️ DOCSTRING OUT, THEN COMMENTS — the same order `test_buttons` uses on
    # `deliver.py`, and for the same reason: this function's prose NAMES the
    # join it delegates ("parsed by `ledger.todo_tasks`"), and a check that read
    # prose as code would forbid it from explaining itself. Caught by this test
    # failing on its own first run.
    body = re.sub(r'"""(?:.|\n)*?"""', "",
                  inspect.getsource(actions_mod._complete_item))
    body = re.sub(r"#[^\n]*", "", body)
    assert "complete_items" in body, \
        "the Done button ticks jobs through its own copy of the write"
    for grown in ("todo_tasks", "update_item", "HassClient"):
        assert grown not in body, \
            f"the Done button grew its own {grown} again"
