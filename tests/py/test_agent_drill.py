"""The agent DRILL — the deterministic delivery rehearsal behind the Cockpit's
own button. It writes a concern through the model's real sink and runs the real
routing/delivery/to-do/escalation sweep, so the properties below are what stop
it lying.

⚠️ THESE TESTS ARE THE SURVIVING HALF OF `test_e2e_check_skill.py`, SPLIT OUT
ON 2026-09-05. That file did two jobs under one name: four tests compared the
`/e2e-check` skill's PROSE against the code, and five tested the drill itself.
The skill was deleted when this repo moved to the mattpocock-skills workflow,
and deleting the file with it took these five along — guards on a SHIPPED
feature, removed as collateral for a document that no longer exists. The
lesson is the file name: it described the consumer, so when the consumer went
the whole thing looked disposable.

⚠️ THE DRILL IS NOT A TEST FIXTURE, IT IS PRODUCT. `_agent_drill` lives in
`rootfs/usr/bin/vesta/supervise/api.py` and the Cockpit calls it. It sends a
real message to a real phone, possibly at night, which is why "says it is a
drill" and "cannot collide with a real device" are pinned as hard as the
delivery path itself.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def _proxy_source() -> str:
    with open(os.path.join(ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "api.py"),
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
    assert handler.index('role_for(request) != "owner"') < \
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
    DISMISSAL `suppressed_subjects` counts. `NEGATIVES_TO_SUPPRESS` is 3 and
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
