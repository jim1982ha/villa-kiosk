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


def test_clearing_an_alert_does_not_claim_to_silence_its_kind() -> None:
    """⚠️ REPORTED BY THE OWNER READING IT ON THEIR PHONE (2026-09-06).

    ✅ and 🚫 said "nobody will chase you about this again" — true of THIS
    alert's escalation ladder, and read as "this kind will not be raised
    again". The owner asked whether dismissing had just switched off a whole
    category of alerting.

    ⚠️ IT HAD NOT, AND CANNOT. `concerns.suppressed_subjects` counts RATINGS
    and never a lifecycle act, so clearing leaves the villa exactly as ready to
    raise this subject again; a settled concern is not live, which is what lets
    a recurrence open a NEW one instead of being swallowed as a duplicate. The
    behaviour was right and only the sentence was wrong — which is the worse of
    the two failures, because a person acts on the sentence.
    """
    import inspect

    src = inspect.getsource(agent_actions._clear)
    body = src[src.index('lead = "Marked done"'):]
    assert "nobody will chase you about this again" not in body, (
        "the clearing receipt claims the chase is over in words a reader takes "
        "to mean the subject is silenced")
    assert "told again" in body, (
        "the receipt no longer says a recurrence will still be reported, so a "
        "reader cannot tell clearing their list from muting their villa")


def test_clearing_really_does_not_suppress_the_subject() -> None:
    """⚠️ THE SENTENCE ABOVE IS ONLY HONEST IF THIS HOLDS. Pinning the copy
    without pinning the behaviour would leave a promise nothing keeps."""
    from vesta.supervise.agent import concerns as concerns_mod

    dismissed = [{"id": f"d{i}", "subject_key": "sk", "state": "dismissed",
                  "settled_at": "2026-09-06T00:00:00Z"} for i in range(5)]
    assert concerns_mod.suppressed_subjects(dismissed) == [], (
        "dismissing an alert five times now silences the subject, so 🚫 has "
        "become a mute button and its receipt is a lie")
    rated = [{"id": f"r{i}", "subject_key": "sk2", "state": "closed",
              "useful": False, "useful_at": "2026-09-06T00:00:00Z",
              "settled_at": "2026-09-06T00:00:00Z"} for i in range(3)]
    assert concerns_mod.suppressed_subjects(rated) == ["sk2"], (
        "the ⬇️ rating no longer silences a subject, so nothing does and the "
        "receipt points at a control that does not work")


def test_the_phone_and_the_tablet_offer_the_SAME_acts() -> None:
    """⚠️ THE OWNER REVERSED THE AUGUST LAYOUT ON 2026-09-06: "add them too
    here, so it's consistent between what appears on the Wall tablet and
    Telegram channels".

    Until then the drawn set was a deliberate SUBSET — the chat drew the
    lifecycle acts and pointed at the Reason tab for the rating — so the two
    surfaces disagreed about what an alert offers, which is the discrepancy
    this whole tier exists to prevent.
    """
    from vesta.supervise.agent import buttons as buttons_mod

    for row in ({"id": "c1", "state": "open", "informational": True},
                {"id": "c2", "state": "open", "severity": "critical"}):
        offered = {a.id for a in agent_actions.available_for(row)}
        drawn = set(buttons_mod.acts_of(
            buttons_mod.keyboard_for(row, None)).split(","))
        assert offered == drawn, (
            f"the chat draws {sorted(drawn)} while the store offers "
            f"{sorted(offered)} — the tablet renders the store's answer, so "
            f"the two surfaces now disagree")


def test_a_rating_on_EITHER_surface_withdraws_it_from_BOTH() -> None:
    """⚠️ THE STAMP IS WHAT MAKES THIS WORK. `acts_of` reads the keyboard's own
    buttons, so once the rating pair is drawn it is also RECORDED as drawn —
    and `reconcile` redraws any message whose record no longer matches. A
    rating pressed on the tablet reaches the chat because
    `agent_feedback_handler` syncs the messages; one pressed in the chat
    reaches the tablet because the tablet reads the store.

    ⚠️ RATE-ONCE IS KEYED ON `useful_at`, NEVER ON `useful` — that flag is
    `false` both for "less like this" and for "nobody has said anything".
    """
    from vesta.supervise.agent import buttons as buttons_mod

    fresh = {"id": "c1", "state": "open", "severity": "critical"}
    rated = {**fresh, "useful": False, "useful_at": "2026-09-06T00:00:00Z"}
    before = buttons_mod.acts_of(buttons_mod.keyboard_for(fresh, None))
    after = buttons_mod.acts_of(buttons_mod.keyboard_for(rated, None))
    assert "useful" in before, "the rating pair is not drawn on a fresh alert"
    assert "useful" not in after, (
        "the rating pair survives a rating, so the chat keeps offering a "
        "verdict the store has already recorded and will refuse")
    assert before != after, (
        "the recorded act set does not change when the rating is withdrawn, "
        "so `reconcile` sees no drift and never redraws the message")
