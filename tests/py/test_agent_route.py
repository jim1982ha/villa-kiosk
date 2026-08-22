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

from agent import route                                        # noqa: E402

OWNER = ["entity:notify.owner_chat"]
PHONE = ["notify.owner_phone"]

#: ⚠️ SHADOW SHIPS **ON**, so every routing test must opt OUT of it explicitly
#: or it is testing suppression rather than routing. That default is deliberate
#: — see `agent/shadow.py` — and this constant is what keeps the two questions
#: apart in this file.
LIVE = {"shadow": False}


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


def test_SHADOW_MODE_delivers_to_nobody() -> None:
    """⚠️ THE PIN FIRED ON THIS FILE THE MOMENT IT EXISTED.

    `test_every_UNSOLICITED_delivery_path_asks_suppressed` was written one
    release before `route.py`, and failed the first time both were in the tree
    — which is the whole reason to pin a rule BEFORE the code it governs is
    written rather than after the field report.

    Routing a concern to a phone is the villa ORIGINATING a message. Answering
    a question somebody typed is not, and stays deliverable.
    """
    out = route.plan(_c(severity="critical"), targets=OWNER,
                     push_targets=PHONE, config={"shadow": True})
    assert out.suppressed is True
    assert out.targets == [] and out.sends is False
    assert "recorded, delivered to nobody" in out.reason


def test_shadow_is_distinct_from_HELD() -> None:
    """⚠️ `held` is a TIMING decision that resolves at 07:00; shadow means the
    villa is not speaking at all and nothing resolves it but an operator.
    Collapsing them would make a shadow period look like a long night."""
    shadowed = route.plan(_c(), targets=OWNER, config={"shadow": True})
    night = route.plan(_c(), targets=OWNER, occupied=False, quiet_hours=True,
                       config={"shadow": False})
    assert shadowed.suppressed and not shadowed.held
    assert night.held and not night.suppressed


def test_with_shadow_OFF_routing_is_unchanged() -> None:
    out = route.plan(_c(severity="critical"), targets=OWNER,
                     push_targets=PHONE, config={"shadow": False})
    assert out.suppressed is False and out.sends is True
