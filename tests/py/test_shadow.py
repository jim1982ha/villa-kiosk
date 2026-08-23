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
    assert agent_config.DEFAULTS["shadow"] is True
    assert shadow.suppressed({}) is True


def test_turning_it_off_is_a_deliberate_act() -> None:
    assert shadow.suppressed({"shadow": False}) is False


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
def test_the_diff_buckets_by_SUBJECT_not_by_title() -> None:
    """⚠️ Both layers already compute `subject_key` the same way — the agent's
    delegates to the reports one — so they recognise the same equipment without
    either holding an identifier. Keying on titles would compare prose and find
    nothing in common."""
    out = shadow.diff(AGENT, RULES)
    assert [r.by_agent for r in out.both] == ["Pool pump short-cycling"]
    assert [r.by_agent for r in out.agent_only] == ["Gate motor losing calibration"]
    assert [r.by_rules for r in out.rules_only] == ["critical_binary_trip: front door"]


def test_the_report_LEADS_with_what_the_agent_MISSED() -> None:
    """⚠️ THE ORDERING IS AN ARGUMENT. "The agent found things the rules could
    not" is the flattering half and the one confirmation bias reaches for; the
    question that decides a cutover is what the rules caught and the agent did
    not, because those are the regressions it would ship."""
    text = shadow.report(shadow.diff(AGENT, RULES))
    missed = text.index("NOT by the agent")
    found = text.index("NOT by the rules")
    assert missed < found, "the report opens with the agent's wins"
    assert "regressions a cutover would ship" in text


def test_an_empty_bucket_says_NONE_rather_than_vanishing() -> None:
    """A missing section reads as an unanswered question; "none" is a result."""
    text = shadow.report(shadow.diff(AGENT, []))
    assert "NOT by the agent (0)" in text
    assert text.count("- none") >= 2


def test_INCOMPLETE_coverage_is_stated_before_any_count() -> None:
    """⚠️ A shadow period during which the collector was not listening compares
    two silences, and a diff read without knowing that is worse than no diff."""
    text = shadow.report(shadow.diff(AGENT, RULES, coverage_complete=False))
    assert text.index("COVERAGE WAS INCOMPLETE") < text.index("The rules found")
    assert "proves nothing" in text


def test_the_totals_count_SUBJECTS_not_rows() -> None:
    """Two concerns about one pump are one subject; counting rows would let a
    chatty layer look more thorough than a precise one."""
    noisy = AGENT + [{"subject_key": PUMP, "title": "pump again"}]
    assert shadow.diff(noisy, RULES).agent_total == 2


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


def test_the_ROUTE_asks_coverage_with_a_WINDOW_not_with_nothing() -> None:
    """⚠️ IT SHIPPED CALLING `coverage()` WITH NO ARGUMENT, and the TypeError
    was swallowed into a log line — so every shadow diff this route ever served
    said COVERAGE INCOMPLETE, and that banner tells the reader a subject missing
    from both columns proves nothing. The PH-3 cutover decision would have been
    taken on a document that disclaimed itself.

    Found by the owner in the add-on log, one release after it shipped:
    "shadow coverage unread: coverage() missing 1 required positional
    argument: 'since_iso'". Nothing else could have found it — the handler
    degrades on purpose, so the failure looked exactly like a villa that had
    not been listening.
    """
    import inspect
    import os
    import re

    from reports import collect as collect_mod

    assert len(inspect.signature(collect_mod.coverage).parameters) >= 1, (
        "collect.coverage takes no argument now; this pin is checking nothing")

    root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    with open(os.path.join(root, "rootfs", "usr", "bin", "supervisor-proxy.py"),
              encoding="utf-8") as handle:
        proxy = re.sub(r"#[^\n]*", "", handle.read())

    # ⚠️ THE HANDLER'S OWN BODY, cut at the NEXT `async def` rather than at the
    # first one — which is its own signature. The first cut sliced the function
    # off at character 10 and searched an empty string, then reported "the route
    # no longer asks about coverage at all". A slicing bug that reads as a
    # finding is worse than no test.
    start = proxy.index("async def agent_shadow_handler")
    nxt = proxy.find("\nasync def ", start + 1)
    handler = proxy[start:nxt if nxt > 0 else len(proxy)]
    calls = re.findall(r"coverage\(([^)]*)\)", handler)
    assert calls, "the shadow route no longer asks about coverage at all"
    for args in calls:
        assert args.strip(), (
            "the shadow route calls coverage() with no window — every diff it "
            "serves will disclaim itself as INCOMPLETE")


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


def test_a_row_NEVER_renders_as_its_own_subject_key() -> None:
    """⚠️ THE CUTOVER PAGE LISTED TEN SHA-256 PREFIXES. `_subjects` fell back to
    the subject_key when a stored finding had no title, and the blueprint half
    of the history record was written with `getattr(g, "title")` — a field
    `Group` does not have, so every one of them was empty.

    `29d2dd0f3a69762c` is not a label a person can weigh, and this is the page
    the PH-3 decision is taken from. Saying the title is missing is at least a
    fact somebody can act on.
    """
    rows = [{"subject_key": "29d2dd0f3a69762c", "title": ""}]
    out = shadow.diff([], rows)
    rendered = out.rules_only[0].by_rules
    assert "29d2dd0f3a69762c" != rendered, (
        "a finding with no title renders as its own hash")
    assert "untitled" in rendered.lower()


def test_the_history_record_reads_the_field_a_GROUP_actually_has() -> None:
    """⚠️ `Group.label`, NOT `Group.title`. The record builder asked for a field
    the dataclass does not define, and `getattr(…, "title", "")` answers "" for
    a missing attribute rather than raising — so ten blueprint findings were
    stored titleless and nothing failed."""
    import inspect
    import re

    from reports.aggregate import Group
    from reports import pipeline as pipeline_mod

    # ⚠️ ANNOTATIONS, NOT `dataclasses.fields` — `Group` is a plain class with
    # a hand-written __init__, and asking dataclasses about it raises. The
    # first version of this pin failed on the tool rather than on the code.
    names = set(getattr(Group, "__annotations__", {}))
    assert "label" in names and "title" not in names, (
        "Group's fields changed; this pin is checking the wrong one")

    # ⚠️ COMMENTS STRIPPED. The note explaining this very fix quotes the
    # offending expression, and without this the pin fires on the prose — the
    # SEVENTH time a source-reading check in this repo has matched its own
    # explanation.
    source = re.sub(r"#[^\n]*", "", inspect.getsource(pipeline_mod.run_report))
    entry = source[source.index('entry: Dict[str, Any] = {'):]
    entry = entry[:entry.index("\n    }")]
    assert not re.search(r'getattr\(g,\s*"title"', entry), (
        "the record builder reads Group.title again — a field that does not "
        "exist, so every blueprint finding is stored without one")
