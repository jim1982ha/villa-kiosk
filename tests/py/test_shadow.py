"""Shadow mode: everything runs, nothing is delivered. TASK-049/050.

⚠️ THE DIFF IS THE CUTOVER EVIDENCE, and the test that matters most is the one
asserting the report LEADS with what the agent missed. This document decides
whether to retire working automations; a page opening with the agent's wins is
a page written to be agreed with.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from agent import concerns as concerns_mod                     # noqa: E402
from agent import config as agent_config                       # noqa: E402
from agent import shadow                                       # noqa: E402
from agent.contracts import subject_key                        # noqa: E402

PUMP = subject_key("pool pump")
GATE = subject_key("gate motor")
DOOR = subject_key("front door")

AGENT: List[Dict[str, Any]] = [
    {"subject_key": PUMP, "title": "Pool pump short-cycling"},
    {"subject_key": GATE, "title": "Gate motor losing calibration"},
]
RULES: List[Dict[str, Any]] = [
    {"subject_key": PUMP, "title": "roi_idle_load: pool circuit"},
    {"subject_key": DOOR, "title": "critical_binary_trip: front door"},
]


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(concerns_mod, "CONCERNS_FILE", str(tmp_path / "c.json"))


# ── the switch ──────────────────────────────────────────────────────────────
def test_shadow_is_the_SHIPPED_DEFAULT() -> None:
    """⚠️ THE OPPOSITE OF EVERY OTHER SWITCH HERE. The others ship off so
    nothing happens; this ships ON so that when the agent IS switched on, its
    first period is observed rather than delivered."""
    assert agent_config.DEFAULTS["mode"] == "observe"
    assert shadow.suppressed({}) is True


def test_turning_it_off_is_a_deliberate_act() -> None:
    assert shadow.suppressed({"mode": "live"}) is False
    # ⚠️ AND A PRE-2.756.0 DOCUMENT STILL MEANS WHAT IT MEANT. Every villa has
    # `shadow` on disk; a rename with no migration would have put each of them
    # back to "observe" — supervision silently silenced on a property running
    # live, which is the direction nobody checks.
    assert shadow.suppressed({"shadow": False,
                              "investigate_mode": "auto"}) is False


def test_the_switch_is_read_per_call_not_cached() -> None:
    """⚠️ It is what an operator reaches for when something is going wrong, and
    one that needs a restart does not help then."""
    import inspect
    assert "agent_config.view(config)" in inspect.getsource(shadow.suppressed)


# ── nothing is delivered ────────────────────────────────────────────────────
def test_a_shadow_concern_goes_to_a_SEPARATE_store() -> None:
    """⚠️ A SEPARATE FILE, NOT A FLAG ON THE ROW. A shadow concern sharing the
    store would be one forgotten filter away from the Cockpit, and "nothing may
    be delivered" would depend on every reader remembering."""
    ok, reason = shadow.record(
        concerns_mod.Concern(subject_key=PUMP, title="t", body="b",
                             severity="warning", audience="owner",
                             evidence=[{"tool": "x", "args_digest": "d",
                                        "at": "2026-08-23T00:00:00Z",
                                        "summary": "s"}]),
        config={"shadow": True})
    assert ok, reason
    assert concerns_mod.read() == [], "a shadow concern reached the live store"


def test_recording_OUTSIDE_shadow_mode_is_refused() -> None:
    """⚠️ Rather than falling through to the live store: a caller reaching for
    this outside a shadow period has confused the two paths, and quietly doing
    the right thing would hide that."""
    ok, reason = shadow.record(concerns_mod.Concern(subject_key=PUMP),
                               config={"shadow": False})
    assert not ok and "not in shadow mode" in reason


# ── the diff ────────────────────────────────────────────────────────────────
def test_the_shadow_path_is_COMPUTED_not_string_replaced() -> None:
    """⚠️ The first version replaced a known filename, which silently did
    NOTHING when the base name differed — so a shadow concern landed in the
    LIVE store with no error. A replace that finds nothing is a no-op wearing
    the appearance of success."""
    assert shadow.shadow_path("/data/vesta/concerns.json") == \
        "/data/vesta/concerns-shadow.json"
    assert shadow.shadow_path("/tmp/x/c.json") == "/tmp/x/c-shadow.json"
    assert shadow.shadow_path("noext") == "noext-shadow"
    assert shadow.shadow_path("/a/b/c.json") != "/a/b/c.json"


def test_every_UNSOLICITED_delivery_path_asks_suppressed() -> None:
    """⚠️ THE CLAIM THAT WAS FALSE, NOW PINNED SO IT CANNOT BE AGAIN.

    `shadow.py` said "`suppressed()` is the one predicate every delivery path
    asks" and ZERO delivery paths asked it. The code was right and the sentence
    wrong: an answer to a question a human just typed is not the villa deciding
    to speak, and suppressing it would make chat look broken while an operator
    waited out a shadow period.

    ⚠️ SO THIS PINS THE NARROW RULE AND FAILS WHEN PHASE 4 ADDS THE PATHS IT
    ACTUALLY COVERS. `route.py` and the brief composer do not exist yet; when
    they do, each must consult `suppressed` before delivering, and this test is
    the reminder — which cannot be a comment nobody reads at the moment they are
    written.
    """
    import ast
    import os

    root = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "rootfs", "usr", "bin", "agent")
    #: Modules that ORIGINATE a message. A reply is not one of them.
    UNSOLICITED = ("route.py", "brief.py", "notify.py")
    present = [n for n in UNSOLICITED if os.path.exists(os.path.join(root, n))]
    for name in present:
        with open(os.path.join(root, name), encoding="utf-8") as handle:
            source = handle.read()
        calls = {n.func.attr for n in ast.walk(ast.parse(source))
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
        assert "suppressed" in calls, (
            f"{name} delivers without asking shadow.suppressed(), so a shadow "
            f"period would push to somebody's phone")
    # ⚠️ NOT AN ASSERTION THAT THEY EXIST. They arrive in Phase 4; this test
    # covers each one on the day it is written and says nothing before then.
    assert isinstance(present, list)


def test_a_reply_to_a_HUMAN_is_deliberately_not_suppressed() -> None:
    """The other half of the rule, so nobody 'fixes' it later by suppressing
    chat and making the villa look dead to the person asking it questions."""
    import inspect

    from agent import chat as chat_mod
    source = inspect.getsource(chat_mod.handle_event)
    assert "suppressed" not in source, (
        "the chat path now suppresses answers; an operator running a shadow "
        "period would get silence from a bot they just messaged")


def test_a_history_ENTRY_carries_its_findings_not_just_a_count() -> None:
    """⚠️ THE SHADOW DIFF'S RULES COLUMN READS THIS KEY, and it did not exist.

    `store.py` has claimed since it was written that "a report entry is metadata
    plus findings, not the rendered prose, so entries are small". Only
    `findingCount` was ever stored. The consequence surfaced two subsystems
    away: `TASK-051`'s document reported "the rules found 0" on a villa whose
    brief that same minute listed pump drift, short-cycling, power factor and a
    disabled critical automation. The row that DECIDES the cutover — what the
    rules caught and the agent did not — was structurally always empty.

    Pinned on the RECORD BUILDER rather than on a live run, because the defect
    is the shape of the dict and that is what a reader of `store.py`'s promise
    would go looking for.
    """
    import inspect
    import re

    from reports import pipeline as pipeline_mod

    source = inspect.getsource(pipeline_mod.run_report)
    entry = source[source.index('entry: Dict[str, Any] = {'):]
    entry = entry[:entry.index("\n    }")]
    assert '"findings"' in entry, (
        "a history entry stores only a COUNT again — the shadow diff's rules "
        "column has nothing to read and reports 0 forever")
    assert "subject_key" in entry, (
        "the stored findings carry no subject_key, so the diff cannot join "
        "them to the agent's concerns and every row lands in one column")
    # ⚠️ AND NOT THE WHOLE FINDING. The ring is bounded at 200 entries; storing
    # detail and baselines is how "entries are small" stops being true.
    assert '"detail"' not in entry, (
        "the stored findings carry prose — the history ring is bounded and "
        "this is what makes it expensive")


# ⚠️ test_the_history_record_reads_the_field_a_GROUP_actually_has LEFT WITH
# TASK-071: `aggregate.Group` is deleted, so there is no field for the record
# builder to misread. The general lesson (getattr's default answers "" for a
# missing attribute rather than raising) is recorded in
# feedback_guessed-field-shapes and enforced by mypy --strict on reports/.
