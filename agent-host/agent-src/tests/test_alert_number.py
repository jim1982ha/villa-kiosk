"""A Kiosk fault carries its alert's number (owner, 2026-10-14): Telegram names a problem "#5", the Cockpit's card did
not — nothing said the two were the same problem. A night check's finding has no number in any chat, and gets none.
Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio

from kiosk_fake import FakeKiosk
from test_fault_steps import kiosk_holding, ticket
from vesta_agent.tickets import Tickets
from vesta_shared.problems import Problems
from vesta_shared.store import Store


def run(c):
    return asyncio.run(c)


class _State:
    def log(self, *_a, **_k):
        pass


def desk(tmp_path, kiosk):
    path = str(tmp_path / "agent.db")
    async def settle(_iid, _note):
        return 0
    return Tickets(kiosk=kiosk, state=_State(), store_path=path, settle_alert=settle), Store(path)


def test_the_real_kiosk_writes_the_number_and_gives_it_once_to_a_fault_made_without():
    k, doc = kiosk_holding()
    tid = run(k.add_ticket("Pump did not run", number=5))
    assert ticket(doc, tid)["alertNumber"] == 5
    other = run(k.add_ticket("Battery low"))
    assert "alertNumber" not in ticket(doc, other)                       # no alert behind it: no number
    assert run(k.number_ticket(other, 7)) and ticket(doc, other)["alertNumber"] == 7
    assert not run(k.number_ticket(other, 7))                            # already says it: nothing written
    assert run(k.held_tickets())[other]["alert_number"] == 7


def test_a_fault_from_an_alert_carries_its_number_and_a_night_finding_none(tmp_path):
    kiosk = FakeKiosk()
    t, store = desk(tmp_path, kiosk)
    iid = store.new_incident("k1", "pump_schedule", "switch.example_pump", "P2", {})
    from_alert, _ = Problems(store).open_task("incident", iid, "pump_schedule", "switch.example_pump", "Pump did not run")
    from_night, _ = Problems(store).open_task("finding", 3, "battery_low", "sensor.example_battery", "Battery at 9%")
    a = run(t.create("Pump did not run", "switch.example_pump", None, from_alert))
    n = run(t.create("Battery at 9%", "sensor.example_battery", None, from_night))
    assert kiosk.numbers == {a: iid} and n not in kiosk.numbers


def test_the_repair_numbers_an_open_alert_fault_made_before_and_leaves_it_alone_after(tmp_path):
    kiosk = FakeKiosk()
    t, store = desk(tmp_path, kiosk)
    iid = store.new_incident("k1", "pump_schedule", "switch.example_pump", "P2", {})
    task, _ = Problems(store).open_task("incident", iid, "pump_schedule", "switch.example_pump", "Pump did not run")
    uid = run(kiosk.add_ticket("Pump did not run", "switch.example_pump"))   # made before the number existed
    store.set_task_uid(task, uid)
    run(t.repair())
    assert kiosk.numbers == {uid: iid}
    calls = []
    real = kiosk.number_ticket
    async def counted(tid, number):
        calls.append(tid)
        return await real(tid, number)
    kiosk.number_ticket = counted
    run(t.repair())
    assert calls == []                                                   # it says it already: not asked again
