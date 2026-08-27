"""The /e2e-check skill reads the add-on log. This pins the strings it reads.

⚠️ THE SKILL IS AN INSTRUMENT, AND AN INSTRUMENT THAT HAS GONE BLIND IS WORSE
THAN NO INSTRUMENT. It follows one supervision pass through every tier by
matching literal `stage()` output — "a tier that did nothing still prints, so a
MISSING line means the tier did not run". Rename one of those stage names and
the skill silently reports a healthy tier as "not reached", which is the exact
reading that sends somebody hunting a defect that is not there.

⚠️ IT IS A CROSS-ARTEFACT CONTRACT WITH A FILE THIS REPO DOES NOT COMPILE, the
same shape as `test_task_loop.py`'s agreement with a blueprint YAML: the skill
lives under `.claude/`, which is GITIGNORED, so nothing type-checks the pair
and the test skips on a fresh clone. That is not a reason to skip writing it —
it is the reason the pin has to be a literal-string scan.

⚠️ IT PINS THE PRODUCER, NOT THE SKILL'S PROSE. The assertion is that every
signature the skill quotes still appears in the code that emits it. A test
that only read the skill would agree with itself forever.
"""

from __future__ import annotations

import os
import re
from typing import List

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKILL = os.path.join(ROOT, ".claude", "skills", "e2e-check", "SKILL.md")
BIN = os.path.join(ROOT, "rootfs", "usr", "bin")

needs_skill = pytest.mark.skipif(
    not os.path.exists(SKILL),
    reason=".claude/ is gitignored and absent on a fresh clone")

#: (what the skill calls the tier, a literal the EMITTING code must contain).
#: ⚠️ THE FRAGMENT IS THE INVARIANT HALF OF THE LINE — the stage name and the
#: fixed words around the numbers. Pinning the whole f-string would fail on any
#: wording change that the skill's own regex would still match, which is a pin
#: that cries wolf; pinning only the stage name would pass while the sentence
#: the skill greps for disappeared.
#: ⚠️ THE DRILL'S TIERS ONLY, SINCE 2026-08-27. The skill used to fire a real
#: check as well and its table covered every tier of a pass; the owner removed
#: that — a real check has two triggers of its own, costs money, and ends in a
#: model judgement that proves nothing repeatable. So the skill now starts at
#: the concern, and this list shrank with it rather than pinning coverage the
#: skill no longer claims.
SIGNATURES: List[tuple] = [
    ("drill start", 'pass begins'),
    ("drill end", 'pass ends after'),
    ("concern", 'stage("concern"'),
    ("concern opened", 'opened: {out.severity}'),
    ("routing", 'stage("route"'),
    ("routing targets", 'target(s)'),
    ("delivery", 'stage("outbox"'),
    ("to-do job", 'stage("task"'),
    ("to-do raised", 'raised {summary!r} on'),
    ("escalation sweep", 'stage("escalation"'),
    ("escalation idle", 'nothing awaiting acknowledgement'),
]

#: Stages a real CHECK emits and the drill never reaches. ⚠️ THE SKILL MUST
#: STILL NAME THEM — as what it does NOT prove. A report that quietly omitted
#: them would read as a whole-pipeline pass, which is the one claim this drill
#: is not entitled to make.
NOT_REACHED_BY_THE_DRILL: List[str] = ["document", "triage", "reason"]


def _backend_source() -> str:
    """Every backend .py, concatenated. ⚠️ NOT one named file per signature:
    the point is that the string still EXISTS somewhere that runs, and pinning
    it to a path would fail on a legitimate move between modules."""
    out: List[str] = []
    for root, _dirs, files in os.walk(BIN):
        if "__pycache__" in root:
            continue
        for name in sorted(files):
            if name.endswith(".py"):
                with open(os.path.join(root, name), encoding="utf-8") as handle:
                    out.append(handle.read())
    return "\n".join(out)


@needs_skill
def test_every_log_line_the_skill_greps_for_is_still_EMITTED() -> None:
    source = _backend_source()
    missing = [f"{tier}: {fragment!r}"
               for tier, fragment in SIGNATURES if fragment not in source]
    assert not missing, (
        "the /e2e-check skill follows a pass by matching these literals, and "
        "nothing emits them any more — it will report a healthy tier as 'not "
        "reached':\n  " + "\n  ".join(missing))


@needs_skill
def test_the_skill_is_HONEST_about_the_tiers_it_does_not_reach() -> None:
    """⚠️ THE DRILL STARTS AT THE CONCERN, AND SAYING SO IS THE WHOLE OF ITS
    HONESTY. It deterministically proves routing, delivery, the to-do job and
    the escalation sweep — and proves NOTHING about the document, triage or the
    investigation, which is exactly the half a reader assumes when they hear
    "end-to-end". A report that omitted the distinction would be a green light
    nobody had earned."""
    with open(SKILL, encoding="utf-8") as handle:
        skill = handle.read()
    assert "DOES NOT PROVE" in skill.upper(), (
        "the skill no longer states what the drill leaves untested")
    for name in NOT_REACHED_BY_THE_DRILL:
        assert name in skill.lower(), (
            f"the skill never mentions `{name}`, so a reader cannot tell that "
            f"the drill does not exercise it")


@needs_skill
def test_the_skill_does_NOT_fire_a_real_check() -> None:
    """⚠️ THE OWNER REMOVED IT (2026-08-27), and the reasons are worth keeping:
    a real check already has two triggers of its own (the cadence and the
    button), it spends ~$0.01 plus ~$0.37 per investigation, and it ends in a
    model judgement — so firing one here duplicates something that happens
    anyway and adds an outcome that cannot be repeated. The drill is the
    simulation; the check is the product."""
    with open(SKILL, encoding="utf-8") as handle:
        skill = handle.read()
    assert '"triage": true' not in skill and "'triage': true" not in skill, (
        "the skill fires a real triage pass again — that is the owner's "
        "'redundant spec', and it costs money to prove nothing repeatable")
    assert '"drill": true' in skill, "the skill no longer fires the drill"


@needs_skill
def test_the_skill_still_refuses_to_ship_or_update() -> None:
    """⚠️ THE OWNER'S RULE, PINNED BECAUSE IT WAS BROKEN ONCE. A validation run
    that also releases cannot answer the question it was asked — the thing
    under test changes underneath it."""
    with open(SKILL, encoding="utf-8") as handle:
        skill = handle.read().upper()
    assert "NEVER SHIPS" in skill and "UPDATES THE ADD-ON" in skill, (
        "the skill no longer states that it must not ship or update the "
        "add-on, which is the rule that keeps a validation honest")


# ── the drill the skill depends on ──────────────────────────────────────────
def _proxy_source() -> str:
    with open(os.path.join(ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py"),
              encoding="utf-8") as handle:
        return handle.read()


def test_the_drill_uses_the_REAL_sink_and_the_REAL_dispatch() -> None:
    """⚠️ A DRILL THAT REHEARSES ITS OWN COPY OF THE PIPELINE PROVES NOTHING.

    The whole value is that it is the same path: `tools.concern.writer` is the
    sink the MODEL's own tool uses, so the drill inherits suppression and the
    `informational` stamp for the villa's mode; `scheduler.dispatch` is the
    routing, delivery, to-do and escalation sweep a scheduled pass runs. If
    either is ever replaced with a local equivalent, the drill goes green while
    the real thing is broken — which is worse than having no drill, because
    somebody has now been told the alarm works.
    """
    source = _proxy_source()
    drill = source[source.index("async def _agent_drill"):]
    drill = drill[:drill.index("\nasync def agent_run_now_handler")]
    assert "concern_tool.writer(" in drill, (
        "the drill writes the concern some other way, so it no longer proves "
        "the sink the model's tool actually uses")
    assert "agent_scheduler.dispatch(" in drill, (
        "the drill does not run the real delivery sweep, so a green drill "
        "says nothing about whether a concern reaches anybody")
    # ⚠️ AND IT MUST NOT REACH FOR A MODEL. Determinism is the entire point:
    # the two tiers above this one end in model judgements, which is exactly
    # why the delivery half needed a test that cannot be declined.
    for banned in ("anthropic_sdk", "provider", "run_once"):
        assert banned not in drill, (
            f"the drill references {banned!r} — it is supposed to be "
            f"deterministic, and anything model-shaped can decline")


def test_the_drill_says_it_is_a_drill_where_a_PERSON_reads_it() -> None:
    """⚠️ IT SENDS A REAL MESSAGE TO A REAL PHONE, possibly at night. The word
    has to be in the TITLE, because a notification preview shows the title and
    little else — a body-only disclaimer is a disclaimer nobody sees."""
    source = _proxy_source()
    drill = source[source.index("async def _agent_drill"):]
    drill = drill[:drill.index("\nasync def agent_run_now_handler")]
    title = re.search(r'title="([^"]+)"', drill)
    assert title is not None, "the drill concern has no title"
    assert re.search(r"drill|test", title.group(1), re.I), (
        f"the drill's title does not announce itself: {title.group(1)!r}")


def test_the_drill_subject_can_never_collide_with_a_real_device() -> None:
    """⚠️ `topic:`-KEYED ON PURPOSE. A subject key is `sha256(entity_id)` for a
    device and `sha256("topic:"+text)` for anything else, so a drill keyed the
    first way could suppress or supersede a genuine concern about real
    equipment — a test that silences the thing it is testing."""
    source = _proxy_source()
    drill = source[source.index("async def _agent_drill"):]
    drill = drill[:drill.index("\nasync def agent_run_now_handler")]
    assert 'subject_key(f"topic:' in drill, (
        "the drill's subject is not topic-keyed, so it shares a key space "
        "with real devices")


def test_the_drill_is_behind_the_SAME_owner_check_as_the_button() -> None:
    """⚠️ IT SPENDS NO MODEL BUDGET BUT IT DOES SEND A REAL MESSAGE, so it is
    owner-only for the same reason the run button is. Pinned as ORDER: the
    branch must sit AFTER the role check in the handler, not before it."""
    source = _proxy_source()
    handler = source[source.index("async def agent_run_now_handler"):]
    handler = handler[:handler.index('if body.get("triage")')]
    assert handler.index('_role_for(request) != "owner"') < \
        handler.index('body.get("drill")'), (
        "the drill branch is reachable before the owner check — anyone with a "
        "session could message the owner's phone")


def test_the_drill_SUPERSEDES_its_own_previous_run() -> None:
    """⚠️ WITHOUT THIS THE FEATURE EATS ITSELF, and the owner found it by
    asking the obvious question: "we will do a lot of tests — do you see the
    contradiction?"

    `raise_concern` refuses a second concern on an open subject, so every
    re-run needed the previous drill SETTLED first. Of the three buttons on a
    concern card only "not useful" settles anything — and that is the
    DISMISSAL `suppressed_subjects` counts. `DISMISSALS_TO_SUPPRESS` is 3 and
    every drill shares one fixed `topic:` key, so on the third tidy-up the
    drill would have been refused for ever, silently, by the mechanism built to
    silence noisy rules. A test rig that destroys itself after three uses is
    worse than none, because the third failure looks like the thing under test.

    Superseding is the escape `raise_concern` itself offers, it is the honest
    description of what a re-run IS, and it needs no dismissal — so the
    counter never advances.
    """
    source = _proxy_source()
    drill = source[source.index("async def _agent_drill"):]
    drill = drill[:drill.index("\nasync def agent_run_now_handler")]
    assert "open_for(" in drill and "supersedes=" in drill, (
        "the drill no longer supersedes its predecessor, so a re-run is "
        "refused until somebody dismisses the last one — and three dismissals "
        "suppress the drill subject permanently")
