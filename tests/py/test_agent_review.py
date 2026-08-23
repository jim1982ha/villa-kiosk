"""The playbook review queue. TASK-094.

⚠️ THE ONE PROPERTY THAT MATTERS IS NEGATIVE: nothing the agent drafts may be
consulted until a person has approved it. A playbook is read on every future
investigation of its class, so a wrong one compounds silently and looks like
expertise — which is why this output, alone among the agent's, has a person in
the loop at all.
"""

from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import playbooks as playbooks_mod  # noqa: E402
from agent import review as review_mod  # noqa: E402

SOURCE = "concern/01J9XABCDEF"
BODY = "# When a thing does the thing\n\n1. Look at it.\n2. Look again."


@pytest.fixture()
def tree(tmp_path):
    return {"queue": str(tmp_path / "review-queue"),
            "live": str(tmp_path / "local"),
            "discarded": str(tmp_path / "review-discarded")}


def _propose(tree, slug="thing-anomaly", calls=4, **kw):
    return review_mod.propose(
        slug, domain="electrical", description="A thing that changed.",
        body=BODY, source=SOURCE, tool_calls=calls, root=tree["queue"], **kw)


# ── the boundary ────────────────────────────────────────────────────────────
def test_an_UNAPPROVED_draft_is_NOT_READABLE_as_a_playbook(tree) -> None:
    """⚠️ THE WHOLE POINT, AND IT IS A PROPERTY OF THE LAYOUT RATHER THAN OF A
    FILTER. `playbooks.body()` resolves a name by walking its two roots; the
    queue is neither of them, so a draft is unreachable by construction.

    ⚠️ THIS TEST FOUND A REAL DEFECT (2.650.0): `LEARNED_ROOT` was
    `/data/vesta`, the PARENT of the queue, so `os.walk` reached every draft —
    and every memory file — and would have served them as procedures.
    """
    assert _propose(tree)
    assert review_mod.pending(tree["queue"])
    assert playbooks_mod.body("thing-anomaly",
                              roots=(tree["live"],)) == ""
    assert "review-queue" not in playbooks_mod.LEARNED_ROOT
    assert not playbooks_mod.LEARNED_ROOT.rstrip("/").endswith("vesta"), (
        "LEARNED_ROOT is the parent of the review queue and the memory store, "
        "so os.walk would serve an unapproved draft as a playbook")


def test_approval_MOVES_the_file_and_makes_it_readable(tree) -> None:
    assert _propose(tree)
    assert review_mod.approve("thing-anomaly", by="owner",
                              root=tree["queue"], live_root=tree["live"])
    assert review_mod.pending(tree["queue"]) == []
    assert "Look again" in playbooks_mod.body("thing-anomaly",
                                              roots=(tree["live"],))


def test_a_draft_does_NOT_declare_kind_playbook(tree) -> None:
    """⚠️ `descriptions()` keys on that field, so a draft carrying it would be
    OFFERED to the model the moment anything walked its directory — approval by
    filesystem accident. `approve` stamps it in."""
    _propose(tree)
    raw = open(os.path.join(tree["queue"], "thing-anomaly.md")).read()
    assert "kind: draft" in raw and "kind: playbook" not in raw
    review_mod.approve("thing-anomaly", by="owner", root=tree["queue"],
                       live_root=tree["live"])
    live = open(os.path.join(tree["live"], "thing-anomaly.md")).read()
    assert "kind: playbook" in live


def test_an_approved_playbook_is_OFFERED_in_the_catalogue(tree) -> None:
    _propose(tree)
    assert playbooks_mod.descriptions(tree["live"]) == []
    review_mod.approve("thing-anomaly", by="owner", root=tree["queue"],
                       live_root=tree["live"])
    names = [r["name"] for r in playbooks_mod.descriptions(tree["live"])]
    assert names == ["thing-anomaly"]


# ── proposing ───────────────────────────────────────────────────────────────
def test_a_short_investigation_proposes_NOTHING(tree) -> None:
    """An investigation of one or two tool calls was a lookup, and a procedure
    for a lookup is noise that costs a person a review."""
    assert not _propose(tree, calls=2)
    assert review_mod.pending(tree["queue"]) == []


def test_a_draft_without_a_SOURCE_is_refused(tree) -> None:
    assert not review_mod.propose(
        "x-thing", domain="water", description="d", body=BODY, source="",
        tool_calls=9, root=tree["queue"])


def test_the_queue_STOPS_PROPOSING_when_it_is_full(tree) -> None:
    """⚠️ A queue nobody can finish is a queue nobody opens. An agent proposing
    faster than a person reviews turns this into a second inbox."""
    for n in range(review_mod.MAX_PENDING):
        assert _propose(tree, slug=f"thing-{n}")
    assert not _propose(tree, slug="one-too-many")
    assert len(review_mod.pending(tree["queue"])) == review_mod.MAX_PENDING


def test_the_same_slug_is_not_queued_twice(tree) -> None:
    assert _propose(tree)
    assert not _propose(tree)


def test_a_slug_cannot_TRAVERSE(tree) -> None:
    """A model names this file."""
    for bad in ("../escape", "a/b", "..", "", "-lead", "Thing", "a" * 80,
                "thing_anomaly!"):
        assert not review_mod.propose(
            bad, domain="water", description="d", body=BODY, source=SOURCE,
            tool_calls=9, root=tree["queue"]), bad


# ── deciding ────────────────────────────────────────────────────────────────
def test_approval_RECORDS_WHO_and_refuses_without_a_name(tree) -> None:
    """A live procedure nobody's name is on is one nobody owns."""
    _propose(tree)
    assert not review_mod.approve("thing-anomaly", by="  ",
                                  root=tree["queue"], live_root=tree["live"])
    assert review_mod.pending(tree["queue"]), "the draft was consumed anyway"
    review_mod.approve("thing-anomaly", by="jm", root=tree["queue"],
                       live_root=tree["live"])
    assert "approved_by: jm" in open(
        os.path.join(tree["live"], "thing-anomaly.md")).read()


def test_an_EDIT_is_part_of_approving(tree) -> None:
    """The realistic case is a reviewer who agrees with most of a draft and
    wants a paragraph changed; a second mechanism is how they approve it
    unchanged instead."""
    _propose(tree)
    review_mod.approve("thing-anomaly", by="jm", edited_body="# Rewritten",
                       root=tree["queue"], live_root=tree["live"])
    body = playbooks_mod.body("thing-anomaly", roots=(tree["live"],))
    assert body == "# Rewritten" and "Look again" not in body


def test_a_DISCARD_is_recorded_and_not_deleted(tree) -> None:
    """⚠️ "We considered this and said no" is the answer to the same draft
    arriving again next quarter. A queue that forgets its refusals re-proposes
    them forever."""
    _propose(tree)
    assert review_mod.discard("thing-anomaly", by="jm", reason="the annexe is "
                              "out of use", root=tree["queue"],
                              discard_root=tree["discarded"])
    assert review_mod.pending(tree["queue"]) == []
    raw = open(os.path.join(tree["discarded"], "thing-anomaly.md")).read()
    assert "discarded_by: jm" in raw
    assert "out of use" in raw
    assert "Look again" in raw, "the draft's own text was not kept"


def test_a_discarded_draft_is_NOT_a_playbook(tree) -> None:
    _propose(tree)
    review_mod.discard("thing-anomaly", by="jm", root=tree["queue"],
                       discard_root=tree["discarded"])
    assert playbooks_mod.descriptions(tree["discarded"]) == []


def test_deciding_on_a_draft_that_does_not_exist_is_refused(tree) -> None:
    assert not review_mod.approve("ghost", by="jm", root=tree["queue"],
                                  live_root=tree["live"])
    assert not review_mod.discard("ghost", by="jm", root=tree["queue"],
                                  discard_root=tree["discarded"])


def test_an_absent_queue_is_EMPTY_rather_than_an_error() -> None:
    assert review_mod.pending("/nonexistent/vesta/review-queue") == []


def test_NO_TOOL_can_reach_the_review_queue() -> None:
    """The same boundary `memory.py` states. What the agent proposes here it
    derived; what a device name says about itself is not a procedure this villa
    should adopt."""
    import ast
    tools = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent", "tools")
    offenders = []
    for base, _dirs, names in os.walk(tools):
        for name in names:
            if not name.endswith(".py"):
                continue
            with open(os.path.join(base, name), encoding="utf-8") as handle:
                tree_ = ast.parse(handle.read())
            for node in ast.walk(tree_):
                if isinstance(node, ast.ImportFrom) and node.module == "agent":
                    if any(a.name == "review" for a in node.names):
                        offenders.append(name)
                elif isinstance(node, ast.Import):
                    if any(a.name.endswith("review") for a in node.names):
                        offenders.append(name)
    assert not offenders, offenders
