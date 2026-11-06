"""A close reaches the tablet's fault before its card (owner, 2026-11-07, #134-P1): the closed card was told to the
tablet at once while the fault was resolved only after every Telegram edit, ten seconds in which the tablet's open issue
said "Cleared on …" with its Done and Open Ticket buttons. Driven through Outcome.carry_out, the alert desk's result
shape (result.settle with result.faults_changed)."""
from __future__ import annotations

import asyncio

from helpers import make_agent
from test_visit_story import PARKING, Visit, at, play, send, villa
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_shared import result as R
from vesta_shared.store import Store


def test_a_settled_close_repairs_the_faults_before_the_card_is_settled(tmp_path):
    v = make_agent(tmp_path, {})
    order: list[str] = []

    async def repair():
        order.append("repair")
        return {}

    async def close(iid, note, **kw):
        order.append(f"settle #{iid}")
    v.tickets.repair = repair
    v.outcome.thread.close = close
    asyncio.run(v.outcome.carry_out({"settle": [R.settle(7, "✅ Cleared on {time}.")], "actions": [R.faults_changed()]},
                                    "alert-desk"))
    assert order[:2] == ["repair", "settle #7"], order


def test_a_result_with_no_settle_repairs_once_after_its_actions(tmp_path):
    v = make_agent(tmp_path, {})
    calls: list[str] = []

    async def repair():
        calls.append("repair")
        return {}
    v.tickets.repair = repair
    asyncio.run(v.outcome.carry_out({"actions": [R.faults_changed()]}, "alert-desk"))
    asyncio.run(v.outcome.carry_out({"settle": [R.settle(8, "✅ Cleared.")]}, "alert-desk"))   # no fault moved: none
    assert calls == ["repair"], calls


def test_a_visit_taken_over_late_dates_its_fault_when_the_villa_sent_it(tmp_path, kiosk, media):
    # owner's drill #134-P1 (2026-11-07): VESTA restarted while the villa opened the visit at 04:10 and took it over at
    # 04:12; the tablet's card said 04:12 while Telegram's Status said "Alert sent" at the villa's 04:10. Driven
    # through the alert desk and the fault's making (Problems.card began → Kiosk.add_ticket)
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "22:55:00", photo=True)
    play(v, send(vi.event("opened", timestamp=at("22:57:30"))))
    faults = [t for t in kiosk.doc["data"]["tickets"] if t.get("alertNumber") == 1]
    assert len(faults) == 1 and Store(v.s.store_path).incident(1)["opened_at"] == at("22:55:00"), faults
    assert faults[0]["openedAt"] == at("22:55:00"), faults[0]
