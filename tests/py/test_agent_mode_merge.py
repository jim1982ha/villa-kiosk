"""Two pairs of settings that were each ONE decision, merged in the STORE.

⚠️ THE MERGE IS A CORRECTNESS CHANGE, NOT TIDYING, WHICH IS WHY IT HAS TESTS.
`shadow` and `investigate_mode` were independent, so "stay silent" + "ask before
investigating" was reachable — and in it triage escalates, `reason.follow_up`
returns early recording each escalation as AWAITING, no Concern is produced, and
anything reading the result sees an empty column. The reference villa ran its
entire observation period in that state and read the outcome as a verdict on the
agent. It was a verdict on the settings.

⚠️ 2.756.0 MOVED THE MERGE FROM THE UI INTO THE STORE, WHICH IS STRICTLY
STRONGER. Until then the panel wrote both keys from one control — so the dead
combination was unreachable *through the app* and perfectly reachable by anything
else that wrote the document, and the two values could disagree with nothing
able to say which the villa was in. Now there is one key with three values and
the bad pair cannot be expressed. Same discipline as `agent/review.py`, which
makes an unapproved playbook unreachable with a DIRECTORY rather than a flag.

The same argument applies to `max_turns` + `max_tool_calls`: not independent
dials but one answer to "how deep", which the UI only ever offered as three
presets while the store held two free integers that could hold a pair that
cannot happen (24 tool calls across 4 turns is a cap that never binds).

⚠️ AND A MERGE WITHOUT A MIGRATION IS A SILENT RESET. Every villa already had
the old keys on disk. A straight rename would have put each of them back to the
shipped default — supervision quietly silenced on a property running live, in
the direction nobody checks. `config.view` derives the new key from the old ones
on READ and never rewrites the file.
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import config as agent_config, policy, reason, shadow  # noqa: E402


def test_the_dead_COMBINATION_cannot_be_expressed_at_all() -> None:
    """⚠️ BY CONSTRUCTION, NOT BY A GUARD. "silent AND ask-first" was the state
    that produced an empty column and read as a verdict on the agent. With one
    key holding three values there is no pair left to contradict itself."""
    for gone in ("shadow", "investigate_mode", "max_turns", "max_tool_calls"):
        assert gone not in agent_config.DEFAULTS, (
            f"{gone} is a stored key again, so two settings can disagree about "
            "one decision")
    assert agent_config.DEFAULTS["mode"] in ("observe", "ask", "live")
    assert agent_config.DEFAULTS["depth"] in agent_config.DEPTH


def test_every_mode_is_one_a_person_would_ACTUALLY_want() -> None:
    """The three, and what each means to the two predicates that read it."""
    cases = {
        # mode:        (investigates?, delivery held?)
        "observe":     (True,  True),   # run everything, deliver nothing
        "ask":         (False, False),  # wait for a person, then deliver
        "live":        (True,  False),  # the normal way to run it
    }
    for mode, (investigates, held) in cases.items():
        assert reason.auto({"mode": mode}) is investigates, mode
        assert shadow.suppressed({"mode": mode}) is held, mode


def test_observe_INVESTIGATES_and_that_is_the_whole_point() -> None:
    """⚠️ THE ONE COMBINATION THAT LOOKS WRONG AND IS RIGHT. "Observe only" must
    still investigate — running everything and delivering nothing is what makes
    the period readable. Refusing to investigate would make it a record of
    nothing having been looked at, which is the defect this whole file is
    about, reintroduced from the other side."""
    assert reason.auto({"mode": "observe"}) is True
    assert shadow.suppressed({"mode": "observe"}) is True


def test_depth_is_ONE_key_and_both_bounds_come_from_it() -> None:
    """⚠️ A PAIR THAT CANNOT CONTRADICT ITSELF. Two free integers let a villa
    hold more tool calls than its turns could ever spend."""
    seen = set()
    for name, budget in agent_config.DEPTH.items():
        snap = policy.for_run({"depth": name}, tool_names=[])
        assert snap.max_turns == budget["turns"], name
        assert snap.max_tool_calls == budget["tool_calls"], name
        assert budget["tool_calls"] >= budget["turns"], (
            f"{name} allows fewer tool calls than turns, so the turn cap can "
            "never be the thing that stops a run")
        seen.add((snap.max_turns, snap.max_tool_calls))
    assert len(seen) == len(agent_config.DEPTH), (
        "two depths produce the same budget, so one of them is a label with no "
        "effect")


def test_an_OLD_document_still_means_what_it_meant() -> None:
    """⚠️ THE MIGRATION IS THE WHOLE RISK OF A MERGE. Read-time, never a
    rewrite: an older add-on downgrading onto the same file must still find its
    own keys, and `config.view` keeps unknown ones for exactly that."""
    live = {"shadow": False, "investigate_mode": "auto"}
    ask = {"shadow": False, "investigate_mode": "approve"}
    observe = {"shadow": True, "investigate_mode": "auto"}
    assert agent_config.view(live)["mode"] == "live"
    assert agent_config.view(ask)["mode"] == "ask"
    assert agent_config.view(observe)["mode"] == "observe"
    assert agent_config.view({"max_turns": 4})["depth"] == "brief"
    assert agent_config.view({"max_turns": 8})["depth"] == "normal"
    assert agent_config.view({"max_turns": 12})["depth"] == "thorough"


def test_a_FRESH_config_is_not_migrated_from_keys_it_does_not_have() -> None:
    """⚠️ THE BUG THE FIRST CUT SHIPPED, CAUGHT BY AN EXISTING TEST. The
    migration ran whenever `mode` was absent from the document — which is true
    of an EMPTY document too — so it read a missing `shadow` as false, fell to
    the else branch and produced "ask" for a villa that had never configured
    anything. A migration may only ever OVERRIDE a default, never fill one in.
    """
    assert agent_config.view({})["mode"] == agent_config.DEFAULTS["mode"]
    assert agent_config.view({})["depth"] == agent_config.DEFAULTS["depth"]
    assert agent_config.view({"enabled": True})["mode"] == "observe"


def test_the_NEW_key_wins_where_both_are_present() -> None:
    """A document holding both was written by this version; the legacy pair is
    a leftover and must not override what this version wrote."""
    both = {"mode": "live", "shadow": True, "investigate_mode": "approve"}
    assert agent_config.view(both)["mode"] == "live"


def test_an_unknown_value_falls_back_and_never_raises() -> None:
    """⚠️ READ ON EVERY RUN. A hand-edited `depth: "deep"` must produce a working
    investigation, not take supervision down — but it must also be REFUSED at
    the door, so the two behaviours are tested together."""
    assert agent_config.depth_of({"depth": "deep"}) == \
        agent_config.DEPTH[str(agent_config.DEFAULTS["depth"])]
    assert agent_config.errors({"depth": "deep"})
    assert agent_config.errors({"mode": "banana"})
    assert not agent_config.errors({"mode": "live", "depth": "normal"})
