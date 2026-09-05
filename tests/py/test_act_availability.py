"""The act set is SERVED, and both surfaces read the same answer.

⚠️ THE DEFECT THIS PAYS FOR (2026-09-06). `agent/actions.available_for` decides
what an alert offers — settled state, FYI, rate-once, ladder position. Telegram
asked it (`buttons.keyboard_for`); the tablet did not. `AgentConcerns.tsx` drew
a fixed row of buttons gated only on `canJudge`, which is a ROLE check
(`hasCapability(role, "manageFacility")`) and knows nothing about a concern.

So on an informational concern the tablet offered ✅ while `available_for`
returned no `done`, and `actions.apply` refused the press with "that has
already been dealt with" — a sentence that is true of some other situation and
misdescribes this one. Nothing could see it: the act pins regex the `.tsx` for
GLYPHS and ORDERING, never for availability.

⚠️ THE PIN IS ON THE PREDICATE AND ON THE GATE, NOT ON THE BUTTON LIST. A test
that only checked which buttons the markup contains would pass again the moment
someone added a sixth act and forgot the gate. What must stay true is that the
markup asks the server at all.
"""

from __future__ import annotations

import os
import re
import sys

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

TSX = os.path.join(REPO_ROOT, "src", "vesta", "supervise",
                   "components", "AgentConcerns.tsx")

from vesta.supervise.agent import actions as agent_actions  # noqa: E402


def _ids(row):
    return [act.id for act in agent_actions.available_for(row)]


def test_an_informational_concern_never_offers_the_closer() -> None:
    """The FYI rule, stated once, in the module that owns it."""
    assert "done" not in _ids({"id": "c1", "state": "open",
                               "informational": True}), (
        "an FYI now offers `done` — if that is the new ruling, the tablet and "
        "Telegram both follow this predicate and need no edit, but this test "
        "was written because the two disagreed")


def test_an_ordinary_open_concern_does_offer_the_closer() -> None:
    """⚠️ THE OTHER HALF, AND WITHOUT IT THE TEST ABOVE PASSES ON A PREDICATE
    THAT RETURNS NOTHING AT ALL."""
    assert "done" in _ids({"id": "c1", "state": "open"})


def test_the_tablet_asks_the_server_which_acts_to_draw() -> None:
    """⚠️ THE GATE IS THE FIX. The glyph and the wording stay on the tablet —
    they are presentation — but WHETHER a button exists is policy, and policy
    is served. A lifecycle button drawn without consulting `offers` is the
    original defect returning."""
    with open(TSX, encoding="utf-8") as handle:
        markup = handle.read()
    assert re.search(r"const offers = \(c: Concern, id: string\)", markup), (
        "`offers` is gone from AgentConcerns.tsx — the tablet has stopped "
        "reading the served act set and is deciding for itself again")
    for act_id in ("done", "dismiss"):
        call = f'act(c.id, "{act_id}")'
        assert call in markup, f"the {act_id} button has gone"
        before = markup[:markup.index(call)]
        assert f'offers(c, "{act_id}")' in before, (
            f"the {act_id} button is drawn without asking `offers` first — "
            "that is exactly how ✅ came to be shown on an FYI")


def test_the_rate_once_rule_is_not_re_implemented_in_the_markup() -> None:
    """⚠️ `useful_at` IS THE DISCRIMINATOR AND `available_for` OWNS IT. The
    markup used to test the stamp itself, which is the same rule written a
    second time in a second language."""
    with open(TSX, encoding="utf-8") as handle:
        markup = handle.read()
    live = "\n".join(line for line in markup.splitlines()
                     if not line.lstrip().startswith(("*", "/*", "//")))
    assert 'offers(c, "useful")' in live, (
        "the rating pair no longer asks the served act set")


def test_the_route_serves_the_acts() -> None:
    """⚠️ THE GATE IS WORTHLESS IF THE FIELD NEVER ARRIVES — `offers` treats an
    absent `acts` as "no acts", so a read that stopped shaping rows would empty
    every row of buttons rather than mis-drawing one."""
    api = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta",
                       "supervise", "api.py")
    with open(api, encoding="utf-8") as handle:
        source = handle.read()
    assert "agent_concerns_shaped_handler" in source
    body = source[source.index("async def agent_concerns_shaped_handler"):]
    body = body[:body.index("\ndef routes()")]
    assert "available_for" in body, (
        "the shaped read no longer calls the predicate, so `acts` is either "
        "absent or invented somewhere else")
    assert 'row["acts"]' in body
    assert re.search(r'web\.get\("/agent-concerns", agent_concerns_shaped_handler\)',
                     source), "the route no longer points at the shaped read"
