"""A problem has ONE name on every surface (vesta_shared.problems.problem_name): the Cockpit's fault, the morning
message, the chat's villa status (architecture review P, 2026-10-27).

The villa's alert text has three lines (what tripped, the reading, the limit held). The Cockpit kept the first and lost
the "(again: …)" written after the last; the morning message showed all three with the 🚨, cut at 160 characters —
on a long alert, through the count; eight settings cut the same title."""
from __future__ import annotations

import os
import sys
from datetime import date

from helpers import STARTER_SKILLS
from vesta_shared.knowledge_pack import KnowledgePack
from vesta_shared.messaging import problem_title_chars
from vesta_shared.problems import Problems, problem_name
from vesta_shared.store import Store

ALERT = "🚨 [VESTA-PUMP] Pool pump stopped\nsensor reads off\n10 min, held 12 min"
NAME = "Pool pump stopped (again: 3 times in 7 days)"


def _villa(tmp_path):
    """A pump alert open on the morning of 5 October, on its third run of the week, with its task (the Cockpit fault)."""
    store = Store(str(tmp_path / "s.sqlite"))
    iid = store.new_incident("automation.pump|switch.pump", "automation.pump", "switch.pump", "P2", {"message": ALERT},
                             at="2026-10-02T10:00:00+00:00")
    for day in ("03", "04"):
        store.update_incident(iid, closed_at=f"2026-10-{day}T08:00:00+00:00")
        store.reopen_incident(iid, f"2026-10-{day}T10:00:00+00:00")
    pb = Problems(store)
    tid, _ = pb.open_task("incident", iid, "automation.pump", "switch.pump", pb.source_title(f"incident:{iid}"))
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families={}, assets={}, areas=[],
                         people=[], channels={}, unknown_area=[], unclassified=[], retention={})
    return pack, store, pb, tid


def test_a_three_line_alert_back_again_has_the_same_name_in_the_cockpit_the_morning_message_and_the_chat(tmp_path):
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))
    import compose
    import concierge
    pack, store, pb, tid = _villa(tmp_path)
    assert pb.card(store.task(tid))["title"] == NAME                                     # the Cockpit's fault
    (p,) = pb.open_problems()
    assert p["title"] == NAME and p["detail"] == "sensor reads off\n10 min, held 12 min"
    still = compose.fm_daily(pack, store, date(2026, 10, 5)).split("\nStill open:\n")[1]
    assert still.split("\n") == [f"- #1 · {NAME}"]                                          # the morning message
    assert concierge.status(pack, {}, store)["open_alerts"] == [NAME]                     # the chat's villa status


def test_a_long_name_is_cut_before_how_often_it_came_back_never_through_it():
    named = problem_name("🚨 " + "Pool pump " * 40 + "\nsecond line", 2)
    assert named["headline"].endswith(" (again: 3 times in 7 days)") and len(named["headline"]) == problem_title_chars()
    assert problem_name(named["headline"])["headline"] == named["headline"]              # named again: unchanged
    assert problem_name("Battery low") == {"headline": "Battery low", "detail": ""}
