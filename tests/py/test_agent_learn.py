"""What the villa learns from an investigation. ADR-0004, ADR-0005, ADR-0006.

⚠️ THIS IS THE FILE FOR THE DEFECT `test_reachability` FOUND AND NAMED. The
memory store, the review queue, their routes and both their screens were built
and correct, and nothing on the reasoning path called `memory.write`,
`memory.expire` or `review.propose` — so the villa could hold what a person
overrode and never what the agent concluded, and the playbook queue could only
ever be empty. `agent/learn.py` is the missing half; these tests are what stop
it going missing again in a way the reachability scan cannot see, because a
function with a caller that never fires IS reachable.
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from fake_provider import FakeProvider, says             # noqa: E402
from vesta.supervise.agent import learn as learn_mod     # noqa: E402
from vesta.supervise.agent import memory as memory_mod   # noqa: E402
from vesta.supervise.agent import playbooks as pb_mod    # noqa: E402
from vesta.supervise.agent import review as review_mod   # noqa: E402


class Result:
    """An `AgentResult` as `learn` reads one."""

    def __init__(self, *, status="answered", tool_calls=0, evidence=0,
                 text="the pump idles near 40W and that is normal for it",
                 run_id="run-abc123"):
        self.status = status
        self.tool_calls = tool_calls
        self.evidence = [{"n": i} for i in range(evidence)]
        self.text = text
        self.run_id = run_id


class Item:
    """A flag, as `contracts.subject_keys_of` reads one."""

    def __init__(self, *entities, subject="Pool Pump"):
        self.subject = subject
        self.entity_ids = list(entities)


# ════════════════════════════════════════════════════════════════════════════
#  Confidence is DERIVED (ADR-0005)
# ════════════════════════════════════════════════════════════════════════════

def test_a_PARTIAL_run_teaches_the_villa_NOTHING():
    """⚠️ AND `AgentResult.usable` DISAGREES, ON PURPOSE. `usable` counts
    `partial` because the question there is "is there something to show a
    person" — the evidence gathered before the clock ran out is real and was
    paid for. The question HERE is "may this become a premise under every
    future report", and a belief derived from a truncated investigation is
    precisely what must not be. Two questions, and the stricter one is this."""
    for status in ("partial", "declined", "failed"):
        assert learn_mod.confidence_for(
            Result(status=status, tool_calls=9, evidence=9),
            playbook_consulted=True) == 0.0, (
            f"a {status} run scored above zero and would be written")


def test_the_floor_is_below_the_line_that_ASSERTS():
    """⚠️ AN INVESTIGATION THAT MERELY ANSWERED IS HELD, NOT ASSERTED. If the
    floor cleared `ASSERT_CONFIDENCE` on its own, every answered run would put a
    premise under every later report and the threshold would be decorative."""
    bare = learn_mod.confidence_for(Result(), playbook_consulted=False)
    assert 0 < bare < memory_mod.ASSERT_CONFIDENCE


def test_asserting_needs_MORE_than_one_signal():
    """⚠️ NO SINGLE THING THAT HAPPENED IS ENOUGH. Each weight says how much
    looking stands behind the claim; any one of them lifting a bare run to
    asserted would make the other three ornamental."""
    for kwargs, pb in ((dict(tool_calls=9), False), (dict(evidence=9), False),
                       (dict(), True)):
        score = learn_mod.confidence_for(Result(**kwargs), playbook_consulted=pb)
        assert score < memory_mod.ASSERT_CONFIDENCE, (
            f"one signal ({kwargs or 'a playbook'}) asserted a claim by itself")


def test_a_well_evidenced_run_DOES_assert():
    """⚠️ THE OTHER DIRECTION, WHICH IS THE ONE A MUTATION WOULD SURVIVE.
    Weights that never reach the threshold would pass every test above and mean
    the villa can never assert anything on its own — the same dead end in a new
    place."""
    assert learn_mod.confidence_for(
        Result(tool_calls=5, evidence=4),
        playbook_consulted=True) >= memory_mod.ASSERT_CONFIDENCE


def test_no_claim_is_ever_certain():
    assert learn_mod.confidence_for(
        Result(tool_calls=99, evidence=99),
        playbook_consulted=True) <= learn_mod.MAX_CONFIDENCE < 1.0


# ════════════════════════════════════════════════════════════════════════════
#  A draft is proposed only where there was no procedure (ADR-0006)
# ════════════════════════════════════════════════════════════════════════════

def test_a_draft_is_proposed_only_where_the_villa_had_NOTHING():
    """⚠️ THE SELF-LIMITING HALF. Every approved draft removes the condition
    that produced it, so proposals stop as the learned tree fills instead of the
    queue refilling against MAX_PENDING for ever."""
    enough = review_mod.MIN_TOOL_CALLS
    assert learn_mod.should_propose(Result(tool_calls=enough),
                                    playbook_consulted=False) is True
    assert learn_mod.should_propose(Result(tool_calls=enough),
                                    playbook_consulted=True) is False


def test_a_LOOKUP_never_proposes_a_procedure():
    """⚠️ `review.MIN_TOOL_CALLS` IS ASKED, NOT RESTATED. A second copy of the
    floor here would be a second opinion about a number `review` owns."""
    assert learn_mod.should_propose(Result(tool_calls=review_mod.MIN_TOOL_CALLS - 1),
                                    playbook_consulted=False) is False
    assert learn_mod.should_propose(Result(status="partial", tool_calls=9),
                                    playbook_consulted=False) is False


# ════════════════════════════════════════════════════════════════════════════
#  Parsing what the extractor said
# ════════════════════════════════════════════════════════════════════════════

def test_a_draft_reply_is_refused_whole_when_any_field_is_wrong():
    """⚠️ REFUSED, NEVER REPAIRED. `review._slug_ok` refuses uppercase instead
    of lowercasing it and says why: a sanitiser that silently renames its input
    is how a handle and the thing it names come apart. The same argument holds
    one layer up — a draft filed under a domain the model invented is not the
    thing that was proposed."""
    good = "DOMAIN: water\nNAME: pump-idle\nWHAT: How to read idle draw.\n---\nSteps."
    assert learn_mod.parse_draft(good, domains=("water",))["slug"] == "pump-idle"
    for bad in ("DOMAIN: invented\nNAME: a-b\nWHAT: x\n---\nb",
                "DOMAIN: water\nNAME: \nWHAT: x\n---\nb",
                "DOMAIN: water\nNAME: a-b\nWHAT: \n---\nb",
                "DOMAIN: water\nNAME: a-b\nWHAT: x\n"):
        assert learn_mod.parse_draft(bad, domains=("water",)) is None


def test_the_extractor_may_say_NOTHING_and_usually_should():
    """⚠️ "NOTHING TO LEARN" IS THE COMMON, HEALTHY ANSWER. Most investigations
    establish what happened once, which belongs in a concern and not in a store
    re-asserted for a quarter."""
    assert learn_mod._one_sentence("NOTHING") == ""
    assert learn_mod._one_sentence("  nothing here  ") == ""
    assert learn_mod._one_sentence("The pump idles near 40W.") != ""


def test_a_rambling_reply_is_refused_rather_than_TRUNCATED():
    """⚠️ CUTTING A PARAGRAPH AT ITS FIRST FULL STOP KEEPS WHATEVER CAME FIRST,
    and this store is the one place a half-claim is asserted for ever."""
    assert learn_mod._one_sentence("word " * 200) == ""


# ════════════════════════════════════════════════════════════════════════════
#  A delivered finding outranks a claim (ADR-0004)
# ════════════════════════════════════════════════════════════════════════════

def test_learning_STANDS_DOWN_before_it_takes_an_investigation_s_request(monkeypatch):
    """⚠️ THE DEFECT THIS FEATURE SHIPPED AND `test_agent_escalation_wiring`
    CAUGHT. An extraction call per investigation spent the request the NEXT
    investigation needed, so a pass near its ceiling investigated less because
    it was learning — the priority exactly inverted. `budget.check` cannot catch
    that: it answers "may I make a request", which is yes right up to the last
    one."""
    from vesta.supervise.agent import budget as budget_mod

    cap = {"max_investigations_per_pass": 2}
    seen = []

    def verdict(remaining):
        monkeypatch.setattr(budget_mod, "check", lambda *a, **k: budget_mod.Verdict(
            True, "", used=100 - remaining, limit=100))
        return learn_mod.has_headroom(cap)

    assert verdict(1) is False, "learning took the last request"
    assert verdict(2) is False, "learning took a request a pass still needed"
    assert verdict(9) is True, "learning stood down with the budget wide open"

    monkeypatch.setattr(budget_mod, "check",
                        lambda *a, **k: budget_mod.Verdict(False, "spent", 3, 3))
    assert learn_mod.has_headroom(cap) is False
    assert seen == []


def test_a_spent_budget_makes_learning_a_silent_NO_OP(monkeypatch, tmp_path):
    """⚠️ SILENT, AND NEVER AN EXCEPTION. This runs after the investigation has
    delivered; anything that raised here would trade a finding a person already
    has for a claim they never asked for."""
    monkeypatch.setattr(learn_mod, "has_headroom", lambda *a, **k: False)
    root = str(tmp_path / "memory")
    monkeypatch.setattr(memory_mod, "MEMORY_ROOT", root)
    asyncio.run(learn_mod.learn_from(
        Result(tool_calls=9, evidence=9), Item("sensor.example_x"),
        provider=FakeProvider([says("the pump idles near 40W")])))
    assert memory_mod.all_memories(root) == []


# ════════════════════════════════════════════════════════════════════════════
#  End to end: the villa actually learns something
# ════════════════════════════════════════════════════════════════════════════

#: ⚠️ THE AGENT'S OWN CONFIG, NOT `None`. `runtime.investigate` declines every
#: call while `enabled` is false — correctly, it is the master switch — so a
#: helper that passed no config would have every extraction decline and every
#: assertion below would read "the villa learned nothing" for the wrong reason.
#: `learn_from` receives the config the investigation itself ran under, which
#: is by definition an enabled one.
ON = {"enabled": True, "mode": "live", "model_triage": "test-model"}


def _learn(monkeypatch, tmp_path, item, *, replies, result=None):
    """Drive the real `learn_from` with a scripted provider. Returns the store."""
    root = str(tmp_path / "memory")
    monkeypatch.setattr(memory_mod, "MEMORY_ROOT", root)
    monkeypatch.setattr(learn_mod, "has_headroom", lambda *a, **k: True)
    pb_mod.reset_run()
    asyncio.run(learn_mod.learn_from(
        result or Result(tool_calls=5, evidence=4), item,
        provider=FakeProvider([says(r) for r in replies]), config=ON))
    return memory_mod.all_memories(root)


def test_a_villa_with_supervision_OFF_learns_nothing(monkeypatch, tmp_path):
    """⚠️ THE MASTER SWITCH REACHES THIS TOO, THROUGH `runtime.investigate`
    RATHER THAN A SECOND GUARD HERE. A switch checked in two places is two
    switches, and the second one is the one that gets forgotten."""
    root = str(tmp_path / "memory")
    monkeypatch.setattr(memory_mod, "MEMORY_ROOT", root)
    monkeypatch.setattr(learn_mod, "has_headroom", lambda *a, **k: True)
    asyncio.run(learn_mod.learn_from(
        Result(tool_calls=5, evidence=4), Item("sensor.example_pump"),
        provider=FakeProvider([says("The pump idles near 40W.")]),
        config={"enabled": False}))
    assert memory_mod.all_memories(root) == []


def test_an_investigation_teaches_the_villa_a_CLAIM(monkeypatch, tmp_path):
    """⚠️ THE WHOLE POINT, AND THE ONE ASSERTION THAT WOULD HAVE FAILED FOR THE
    LIFE OF THIS SUBSYSTEM until now. Every layer below was green while nothing
    could put a single claim in the store."""
    held = _learn(monkeypatch, tmp_path, Item("sensor.example_pump"),
                  replies=["The pump's idle draw sits near 40W."])
    assert len(held) == 1, "an answered investigation taught the villa nothing"
    assert "40W" in held[0].claim
    assert held[0].source == "run-abc123", (
        "the claim cannot be traced back to the investigation that made it")


def test_NOTHING_from_the_extractor_writes_NOTHING(monkeypatch, tmp_path):
    assert _learn(monkeypatch, tmp_path, Item("sensor.example_pump"),
                  replies=["NOTHING"]) == []


def test_a_PAIR_teaches_the_villa_nothing_rather_than_something_FALSE(
        monkeypatch, tmp_path):
    """⚠️ ONE SENTENCE, TWO SUBJECT KEYS. Writing it to both files a fact about
    one device under the other, permanently; taking the first does the same
    silently. `contracts.subject_keys_of` returns one key per device precisely
    so a multi-device subject cannot be joined on one of them."""
    assert _learn(monkeypatch, tmp_path,
                  Item("sensor.example_pump_a", "sensor.example_pump_b"),
                  replies=["Both pumps idle near 40W."]) == []


def test_a_provider_that_says_nothing_at_all_is_not_an_error(monkeypatch, tmp_path):
    assert _learn(monkeypatch, tmp_path, Item("sensor.example_pump"),
                  replies=[]) == []


# ════════════════════════════════════════════════════════════════════════════
#  The caller (the half a test of the helper cannot see)
# ════════════════════════════════════════════════════════════════════════════

def test_INVESTIGATE_SUBJECT_actually_calls_it(monkeypatch):
    """⚠️ EVERY TEST ABOVE DRIVES `learn_from` DIRECTLY AND WOULD STAY GREEN IF
    NOTHING CALLED IT — which is the defect that produced this whole feature.
    `test_reachability` cannot see it either: a call site that exists makes a
    function reachable whether or not it ever fires. So this pins the ONE choke
    point, `reason.investigate_subject`, through which both the scheduler's arm
    and a person pressing approve reach the model.

    ⚠️ AND IT ASSERTS THE ARGUMENTS, NOT JUST THE CALL. A caller that passed no
    `item` writes a claim against no subject; one that passed no `config` gets
    a declined extraction on every villa, silently, for ever.
    """
    from vesta.supervise.agent import reason as reason_mod
    from vesta.supervise.agent import runtime as runtime_mod

    seen = {}

    async def fake_investigate(**kwargs):
        return Result(tool_calls=4, evidence=2, run_id="run-xyz")

    async def recorder(result, item, **kwargs):
        seen["result"], seen["item"] = result, item
        seen.update(kwargs)

    monkeypatch.setattr(runtime_mod, "investigate", fake_investigate)
    monkeypatch.setattr(learn_mod, "learn_from", recorder)
    monkeypatch.setattr(reason_mod, "_mark_looked_at", lambda item: None)

    item = Item("sensor.example_pump")
    ran = asyncio.run(reason_mod.investigate_subject(
        item, provider=FakeProvider([]), config=ON, document="doc",
        trigger="scheduled", run_id="run-xyz"))

    assert ran is True
    assert seen, (
        "an investigation finished and nothing was offered to the villa to "
        "learn from — the store can only ever hold what a person typed")
    assert seen["item"] is item, "the claim would be filed against no subject"
    assert seen["result"].run_id == "run-xyz", "the claim could not be traced"
    assert seen.get("config") is ON, (
        "no config reached the extractor, so it declines on every villa")
    assert seen.get("provider") is not None
