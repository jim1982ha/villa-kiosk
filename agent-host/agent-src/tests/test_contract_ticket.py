"""The fault the VESTA Agent writes and reads, as the agreement with the Kiosk declares it (agent-contract.json
`ticket`, architecture review 2026-10-15) — the agent's side of the check; the Kiosk's oracle contract_ticket.mjs
holds the other side against the same file. A renamed stamp would have silently stopped the agent retitling its own
faults (it would read them all as a person's); a new origin would have shown the generic icon."""
from __future__ import annotations

import asyncio
import json
import os

from kiosk_fake import FakeKiosk
from vesta_agent import kiosk
from vesta_shared.problems import Problems
from vesta_shared.store import Store

CONTRACT = os.path.join(os.path.dirname(__file__), "..", "..", "rootfs", "opt", "vesta", "host", "agent-contract.json")
T = json.load(open(CONTRACT))["ticket"]


def test_the_agent_knows_its_own_steps_by_the_agreements_stamp():
    assert kiosk.AGENT_BY == T["agentStamp"]
    assert kiosk._mine({"by": T["agentStamp"]}) and not kiosk._mine({"by": "Owner"})


def test_every_origin_the_agent_writes_is_declared(tmp_path):
    st = Store(str(tmp_path / "s.sqlite"))
    pb = Problems(st)
    iid = st.new_incident("k", "r", "lock.example", "P2", {"message": "x"})
    a, _ = pb.open_task("incident", iid, "r", "lock.example", "x")
    n, _ = pb.open_task("finding", 3, "battery_low", "sensor.example", "y")
    written = {pb.card(st.task(a))["origin"], pb.card(st.task(n))["origin"], "chat"}   # chat: tickets.create, no task
    assert written <= set(T["origins"]), written


def test_the_sample_reads_as_the_agreement_says():
    held = asyncio.run(FakeKiosk(T["sample"]).held_tickets())[T["sample"]["id"]]
    step = [u for u in T["sample"]["updates"] if u["status"] == T["takenStep"]["status"] and not u.get("kind")
            and u.get("by") != T["agentStamp"]][-1]
    assert held["alert_number"] == T["sample"]["alertNumber"] and held["origin"] == T["sample"]["origin"]
    assert (held["taken_by"], held["taken_at"]) == (step["who"], step["at"])             # the take-on the chase stops on
    assert held["agent_title"] == T["sample"]["title"]                                   # its own title, by the stamp
    assert [n for _at, n in held["noted"]] == ["Reminder sent to Facility Manager"]
