"""Routing and escalation. TEST-031, TEST-039, TASK-060.

⚠️ THE TEST THAT MATTERS MOST IS THAT A CLEARED CONDITION STANDS DOWN. The
catalog's ladder counts minutes and cannot express it, and escalating a problem
that fixed itself is how a supervisor loses trust fastest.
"""

from __future__ import annotations

import ast
import inspect
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import route

OWNER = ["entity:notify.owner_chat"]
PHONE = ["notify.owner_phone"]

#: ⚠️ ROUTING NO LONGER READS THE MODE AT ALL (2026-08-28): the delivery class
#: rides the CONCERN (`informational`, stamped at raise time), so this constant
#: is only the config the callers pass through. It stays named so the tests
#: below read as "a live villa" where that is what they mean.
LIVE: Dict[str, Any] = {}


def _c(**over: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {"id": "c1", "severity": "warning",
                            "title": "Pool pump short-cycling",
                            "body": "14 starts in an hour."}
    base.update(over)
    return base


# ── the matrix ──────────────────────────────────────────────────────────────
def test_a_notice_reaches_the_thread_and_NOT_a_phone() -> None:
    """UC-018: it appears on the wall and in the thread, and buzzes nobody."""
    out = route.plan(_c(severity="notice"), targets=OWNER, push_targets=PHONE,
                     config=LIVE)
    assert out.targets == OWNER and out.push is False


def test_a_critical_is_pushed_as_WELL_as_threaded() -> None:
    """⚠️ Telegram can be muted and a critical must survive that. It is a
    SECOND CHANNEL FOR ONE CONCERN — same id — not a second concern."""
    out = route.plan(_c(severity="critical"), targets=OWNER, push_targets=PHONE,
                     config=LIVE)
    assert out.push is True
    assert out.targets == OWNER + PHONE
    assert out.concern_id == "c1", "the push carries a different id"


def test_an_unknown_severity_routes_as_a_WARNING_never_as_info() -> None:
    """⚠️ A severity nobody has classified must not arrive as the quietest
    thing in the system."""
    assert route.row_for("catastrophic") is route.MATRIX["warning"]
    assert route.row_for("") is route.MATRIX["warning"]


def test_the_kiosk_is_not_a_routing_target() -> None:
    """⚠️ The wall always renders, live and offline, with no delivery involved:
    it is the STATE of the villa, not a notification. Only push is routed, and
    confusing the two is how a notice ends up buzzing a phone.

    ⚠️ THE FIRST VERSION OF THIS TEST WAS NONSENSE — it split the source on a
    docstring and ended with `or True`, so it asserted nothing and crashed on an
    IndexError instead. What is checkable is that the matrix has no kiosk
    concept and that every target came from the CALLER.
    """
    import dataclasses

    fields = {f.name for f in dataclasses.fields(route.Row)}
    assert fields == {"thread", "push", "quiet_hours_apply", "acknowledgement"}, (
        f"the routing row grew a field: {fields}")

    out = route.plan(_c(severity="critical"), targets=OWNER, push_targets=PHONE,
                     config=LIVE)
    assert set(out.targets) <= set(OWNER + PHONE), (
        "a destination appeared that the caller never offered")


# ── quiet hours and occupancy ───────────────────────────────────────────────
def test_a_warning_at_night_in_an_EMPTY_villa_is_held() -> None:
    out = route.plan(_c(), targets=OWNER, occupied=False, quiet_hours=True,
                     config=LIVE)
    assert out.held is True and out.sends is False


def test_the_same_warning_with_people_in_the_house_is_NOT_held() -> None:
    """⚠️ A failure nobody is experiencing can wait; the same failure with
    guests is happening TO somebody."""
    out = route.plan(_c(), targets=OWNER, occupied=True, quiet_hours=True,
                     config=LIVE)
    assert out.held is False and "occupied" in out.reason


def test_UNKNOWN_occupancy_delivers_rather_than_holds() -> None:
    """⚠️ "I cannot tell" is not "nobody is there". Holding a message on an
    assumption is the expensive way to be wrong."""
    out = route.plan(_c(), targets=OWNER, occupied=None, quiet_hours=True,
                     config=LIVE)
    assert out.held is False and "assumption" in out.reason


def test_a_CRITICAL_ignores_quiet_hours_entirely() -> None:
    """That is the whole meaning of the word: if it can wait, it is a warning."""
    out = route.plan(_c(severity="critical"), targets=OWNER,
                     occupied=False, quiet_hours=True, config=LIVE)
    assert out.held is False


# ── occupancy is three-valued ───────────────────────────────────────────────
def test_occupancy_reads_person_and_device_tracker() -> None:
    assert route.occupancy([{"entity_id": "person.a", "state": "home"}]) is True
    assert route.occupancy([{"entity_id": "device_tracker.b",
                             "state": "not_home"}]) is False


def test_NO_trackers_is_UNKNOWN_not_EMPTY() -> None:
    """⚠️ A two-valued answer turns "none configured" into "nobody is home",
    which is the reading that holds a critical overnight."""
    assert route.occupancy([]) is None
    assert route.occupancy([{"entity_id": "light.x", "state": "on"}]) is None
    assert route.occupancy([{"entity_id": "person.a",
                             "state": "unknown"}]) is None


# ── escalation re-evaluates ─────────────────────────────────────────────────
def test_a_CLEARED_condition_stands_down() -> None:
    """TEST-039, and the branch the catalog's ladder cannot express at all."""
    out = route.escalate(minutes_open=999, acknowledged=False,
                         condition_cleared=True)
    assert out.act is False and out.step == "stand down"
    assert "fixed itself" in out.reason


def test_an_ACKNOWLEDGED_concern_stops() -> None:
    out = route.escalate(minutes_open=999, acknowledged=True,
                         condition_cleared=False)
    assert out.act is False and out.step == "acknowledged"


def test_the_PRESENCE_branch_jumps_the_bands() -> None:
    """⚠️ 60 device_tracker and 4 person entities, and routing has never used
    one. If the FM is unreachable with guests in residence, the owner is told
    NOW rather than after forty-five minutes."""
    out = route.escalate(minutes_open=1, acknowledged=False,
                         condition_cleared=False,
                         facility_reachable=False, guests_present=True)
    assert out.act is True and out.step == "add the owner"


def test_the_bands_apply_only_after_presence_and_state() -> None:
    """⚠️ TIME IS THE LAST QUESTION ASKED. A cleared condition at 999 minutes
    must still stand down — order, not precedence by accident."""
    assert route.escalate(minutes_open=999, acknowledged=False,
                          condition_cleared=True).act is False
    assert route.escalate(minutes_open=16, acknowledged=False,
                          condition_cleared=False).step == "resend to the same target"
    assert route.escalate(minutes_open=100, acknowledged=False,
                          condition_cleared=False).step == \
        "every configured target, once"


def test_only_a_CRITICAL_escalates() -> None:
    out = route.escalate(minutes_open=999, acknowledged=False,
                         condition_cleared=False, severity="warning")
    assert out.act is False


# ── the boundary ────────────────────────────────────────────────────────────
def test_everything_delivered_is_INERT() -> None:
    """⚠️ Applied at the ROUTING boundary so every channel below inherits it
    rather than each remembering — a real friendly name with an underscore once
    cost a day of failed deliveries."""
    out = route.plan(_c(title="pump_A is *down*", body="[urgent] <now>"),
                     targets=OWNER, config=LIVE)
    for markup in ("_", "*", "[", "]", "<", ">"):
        assert markup not in out.title + out.body, markup


def test_route_contains_NO_MODEL_CALL() -> None:
    """⚠️ STRUCTURAL. The agent proposes urgency; this turns urgency into a
    destination. A model deciding whether to wake somebody at 3am is the most
    consequential unforced error available here, and the defence is that the
    decision is a TABLE."""
    tree = ast.parse(inspect.getsource(route))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
        elif isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
    for banned in ("anthropic", "agent.llm", "agent.llm.base", "agent.registry",
                   "agent.runtime", "agent.triage"):
        assert banned not in imported, f"route.py imports {banned}"


def test_an_INFORMATIONAL_concern_is_an_FYI_not_a_request() -> None:
    """⚠️ THE STAMP TRAVELS ON THE CONCERN, NOT ON TODAY'S CONFIG (2026-08-28,
    owner's ruling — this replaced the shadow suppression branch). Raised in
    "Investigate & Log Only", a concern is DELIVERED — once, to the thread —
    and everything that ASKS is withheld: no push even at critical, and the
    message says out loud that nothing is asked of the reader."""
    out = route.plan(_c(severity="critical", informational=True),
                     targets=OWNER, push_targets=PHONE, config={})
    assert out.informational is True
    assert out.targets == OWNER, "an FYI must still reach the thread"
    assert out.push is False, "an FYI pushed to a phone is a request"
    assert out.title.startswith("FYI: ")
    assert "nothing is asked of you" in out.body
    assert out.sends is True


def test_an_informational_CRITICAL_still_waits_out_quiet_hours() -> None:
    """⚠️ SEVERITY IS NOT CONSULTED FOR AN FYI's HOLD. `holds_until_morning`
    exempts a critical from quiet hours — right for a message that wakes
    somebody to act, wrong for one whose own body says nothing is asked.
    Occupancy still overrides, exactly as for every other severity."""
    night = route.plan(_c(severity="critical", informational=True),
                       targets=OWNER, occupied=False, quiet_hours=True,
                       config={})
    assert night.held is True and "held until morning" in night.reason
    occupied = route.plan(_c(severity="critical", informational=True),
                          targets=OWNER, occupied=True, quiet_hours=True,
                          config={})
    assert occupied.held is False


def test_a_NORMAL_concern_routes_unchanged() -> None:
    out = route.plan(_c(severity="critical"), targets=OWNER,
                     push_targets=PHONE, config={})
    assert out.informational is False and out.sends is True
    assert out.push is True
    assert not out.title.startswith("FYI"), (
        "a concern that will be chased must not announce itself as ignorable")


# ── who the message is for (2026-08-27) ─────────────────────────────────────
def test_a_delivered_message_says_which_PROFILE_it_is_for() -> None:
    """⚠️ ONE CHAT CAN CARRY BOTH PEOPLE'S POST. A villa may route the
    household's alerts and the Facility manager's work to the same Telegram
    chat, and the escalation ladder deliberately sends the SAME concern on to a
    second profile — so two messages arrive looking identical with nothing
    saying which was written for whom. The footer is the signature.

    ⚠️ THE SCREEN'S WORDS, NOT THE STORE'S: `ops` is the Facility manager
    everywhere a person can see, and signing a message "ops" names a role
    nobody has heard of.
    """
    owner = route.plan(_c(), targets=OWNER, profile="owner", config=LIVE)
    ops = route.plan(_c(), targets=OWNER, profile="ops", config=LIVE)
    assert owner.body.rstrip().endswith("— for the Owner"), owner.body
    assert ops.body.rstrip().endswith("— for the Facility manager"), ops.body
    assert "ops" not in ops.body.split("—")[-1]


def test_the_footer_is_LAST_even_when_the_FYI_block_is_added() -> None:
    """⚠️ IT IS A SIGNATURE, SO IT SIGNS EVERYTHING ABOVE IT. An informational
    concern appends its own "nothing is asked of you" paragraph; a footer
    written before that would sit in the middle of the message and read as part
    of the finding."""
    out = route.plan(_c(informational=True), targets=OWNER, profile="owner",
                     config=LIVE)
    assert out.body.rstrip().endswith("— for the Owner")
    assert "nothing is asked of you" in out.body
    assert out.body.index("nothing is asked of you") < out.body.index("— for the")


def test_the_footer_carries_NO_MARKUP_a_platform_could_parse() -> None:
    """⚠️ `style.inert` STRIPS EVERY CHARACTER A NOTIFY PLATFORM MIGHT READ —
    underscore, asterisk, backtick, brackets, angle brackets — because the
    add-on does not choose the parse mode, and one stray underscore in a real
    device name once cost a day of failed deliveries (2.573.0). "Small" on a
    plain-text channel is brevity and position, never typography."""
    body = route.plan(_c(), targets=OWNER, profile="ops", config=LIVE).body
    footer = body.rsplit("\n\n", 1)[-1]
    for banned in ("_", "*", "`", "~", "[", "]", "<", ">"):
        assert banned not in footer, f"{banned!r} survived into {footer!r}"


def test_an_unknown_or_absent_profile_adds_NOTHING() -> None:
    """⚠️ SILENCE RATHER THAN A GUESS. A caller that does not know the profile
    must not produce "— for the " or invent one; an unsigned message is honest,
    a wrongly-signed one sends somebody else's work to the household."""
    for profile in ("", "   ", "nobody"):
        body = route.plan(_c(), targets=OWNER, profile=profile,
                          config=LIVE).body
        assert "— for the" not in body, (profile, body)


def test_BOTH_delivery_paths_tell_route_which_profile_they_used() -> None:
    """⚠️ `feedback_pin-the-caller`. `plan` signs whatever it is told, so a
    caller that forgets the argument produces an unsigned message and this
    file's other pins stay green — the defect lives in the wiring, twice over:
    the first delivery and the escalation send to DIFFERENT profiles, and the
    second is the one whose whole point is that the audience changed.

    ⚠️ SCOPED TO THE `route.plan` CALL, AND THE FIRST VERSION WAS NOT — it
    asserted `"profile=role" in source`, which is ALSO true of
    `_mark_delivered(..., profile=role)` a few lines below. Deleting the
    argument from the routing call left the pin green: it was matching a
    different call the whole time. Caught by mutation testing, which is the
    only thing that could have caught it.
    """
    import inspect

    from vesta.supervise.agent import outbox as outbox_mod

    for fn in (outbox_mod._deliver_one, outbox_mod._escalate_one):
        source = inspect.getsource(fn)
        start = source.index("route_mod.plan(")
        depth, end = 0, start
        for i in range(start, len(source)):
            if source[i] == "(":
                depth += 1
            elif source[i] == ")":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        call = source[start:end + 1]
        assert "profile=" in call, (
            f"{fn.__name__} calls route.plan without naming the profile, so "
            f"its message arrives unsigned:\n{call}")


# ── the alert says it has a job ─────────────────────────────────────────────
def test_a_DELIVERED_ALERT_says_it_is_on_the_TO_DO_LIST() -> None:
    """⚠️ THE INVISIBLE SIDE EFFECT, NAMED AT LAST (2026-08-28, owner: "it's
    currently not clear from the UI that clicking on the Thumbs will create a
    ToDo item in the list"). It does not — DELIVERY raises the job, before
    anybody presses anything, and no surface said so. An item appeared on the
    list with nothing connecting it to the alert, so its arrival was attributed
    to whichever button had just been pressed."""
    out = route.plan(_c(), targets=OWNER,
                     config={"task_list": "todo.shopping_list"})
    assert "To-Do List" in out.body
    # ⚠️ IT SAYS WHAT PRESSING ✅ DOES, NOT THAT AN ITEM IS ALREADY THERE. The
    # job is raised AFTER the send, deliberately, so a message that failed to
    # leave never puts work on anybody's list. And it names the button AS THE
    # READER SEES IT: since the labels became glyphs (2026-08-28), "Press Done"
    # would point at a word that appears nowhere on the keyboard below it.
    assert "\u2705" in out.body, (
        "the delivered body no longer names the ✅ button, so the instruction "
        "points at nothing the reader can see")


def test_it_CLAIMS_NO_JOB_on_a_villa_that_has_configured_no_list() -> None:
    """⚠️ `task_list` DEFAULTS TO EMPTY, so this is the state a fresh install is
    in, not an edge case. `list_for` returning "" means the loop is off and
    there is no item — a message promising one would send its reader to look
    for something that does not exist."""
    out = route.plan(_c(), targets=OWNER, config={"task_list": ""})
    assert "To-Do List" not in out.body
    assert route.plan(_c(), targets=OWNER, config={}).body.count("To-Do") == 0


def test_an_FYI_claims_no_job_either_because_it_RAISES_none() -> None:
    """⚠️ AN ALERT-ONLY NOTICE ASKS FOR NOTHING, and raising no job is the whole
    point of the mode — so the sentence that explains the job must not appear on
    the one delivery class that never has one."""
    out = route.plan(_c(informational=True), targets=OWNER,
                     config={"task_list": "todo.shopping_list"})
    assert "nothing is asked of you" in out.body, "the fixture is not an FYI"
    assert "To-Do List" not in out.body


def test_the_RATING_pair_is_directional_and_touches_no_list() -> None:
    """⚠️ THIS PIN DEMANDED WORDS FOR HALF A DAY AND NOW PINS GLYPHS — both by
    the owner, both from screenshots (2026-08-28). The words were the cure for
    two bare THUMBS being read as filing something into the To-Do List; ⬆️/⬇️
    say "more/less" on their face, which a thumb never did. What survives both
    rulings: the pair must be an OPPOSITE-DIRECTION pair (one glyph cannot be
    read as approving the alert itself, which is how 👎 came to dismiss), and
    neither may promise anything about the list."""
    from vesta.supervise.agent import actions
    up = actions.act_by_id("useful").label               # type: ignore[union-attr]
    down = actions.act_by_id("not_useful").label         # type: ignore[union-attr]
    assert (up, down) == ("⬆️", "⬇️"), (
        f"the rating pair is {up!r}/{down!r}; the owner chose ⬆️/⬇️, and a "
        f"drive-by change would desync the phone from the outcome notes")
    for act in actions.ACTS:
        if act.id in ("useful", "not_useful"):
            assert "To-Do" not in act.label and "job" not in act.label.lower()
