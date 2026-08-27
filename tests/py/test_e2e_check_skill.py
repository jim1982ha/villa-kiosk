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
SIGNATURES: List[tuple] = [
    ("pass start", 'pass begins'),
    ("pass end", 'pass ends after'),
    ("document", 'stage("document"'),
    ("document size", 'chars, {lines} lines'),
    ("triage", 'stage("triage"'),
    ("triage escalations", 'escalation(s) from'),
    ("approval queue", 'escalation(s) queued for approval'),
    ("investigation", 'stage("reason"'),
    ("tools used", 'tools used:'),
    ("concern", 'stage("concern"'),
    ("concern opened", 'opened: {out.severity}'),
    ("routing", 'stage("route"'),
    ("routing targets", 'target(s)'),
    ("delivery", 'stage("outbox"'),
    ("delivery idle", 'nothing waiting'),
    ("to-do job", 'stage("task"'),
    ("to-do raised", 'raised {summary!r} on'),
    ("escalation sweep", 'stage("escalation"'),
    ("escalation idle", 'nothing awaiting acknowledgement'),
    ("cost", 'prefix '),
]


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
def test_the_skill_quotes_the_tiers_it_claims_to_cover() -> None:
    """⚠️ THE OTHER DIRECTION: a tier added to the pipeline with no row in the
    skill's table is a tier the report will silently omit, and the report's
    whole promise is that it is EXHAUSTIVE. Checked by stage name, which is the
    one token both sides share."""
    with open(SKILL, encoding="utf-8") as handle:
        skill = handle.read()
    emitted = set(re.findall(r'stage\("([a-z]+)"', _backend_source()))
    #: Stages that are deliberately NOT pass tiers: `collect`/`brief` belong to
    #: the briefing pipeline, which this skill does not drive.
    NOT_A_PASS_TIER = {"collect", "brief", "narration", "delivery", "schedule"}
    for name in sorted(emitted - NOT_A_PASS_TIER):
        assert name in skill, (
            f"the pipeline emits a `{name}:` stage that the skill's tier table "
            f"does not mention, so its 'exhaustive' report would omit it")


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
