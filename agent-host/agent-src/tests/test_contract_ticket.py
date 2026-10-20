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
U = json.load(open(CONTRACT))["ticketUpdate"]


def test_the_agreement_the_agent_reads_is_the_hosts_file():
    from vesta_shared import agreement
    assert agreement.section("ticketUpdate") == U and agreement.section("ticket") == T
    assert agreement.section("no such section") == {}


def test_every_agreed_history_reads_as_the_agreement_says():
    """How a closed fault was closed — the agreement's `ticketUpdate.histories`, every case, through fault_of: the
    Kiosk's two readers (fmEngine.lastResolution, the proxy's _fm_last_resolution) replay the same file. Before
    (architecture review round 2, 2026-10-19) six of them read the other way: a cleared blip renamed afterwards, one
    with a Telegram line noted after it, time order against list order, a close before kinds by its note or its
    prefix, a step whose time cannot be read."""
    for case in U["histories"]["cases"]:
        held = kiosk.fault_of({"id": "va-h", "title": "x", "status": "resolved", "resolvedAt": case["resolvedAt"],
                               "updates": case["updates"]})
        assert held["cleared"] is case["cleared"], case["_"]
        step = case["updates"][case["last"]] if case["last"] is not None else {}
        assert held["by"] == (step.get("who") or step.get("by") or ""), case["_"]
        assert held["resolved_at"] == case["resolvedAt"]


def test_the_lists_are_the_agreements_never_a_copy():
    # a note the agreement does not name is a repair; the same note on a kindless close is a clearing only through
    # the file's own list (no literal of it in the engine)
    close = {"at": "2026-06-01T00:00:00Z", "status": "resolved", "note": "Fixed"}
    assert kiosk.cleared_step(close) is False
    assert kiosk.cleared_step(dict(close, note=U["clearedNotes"][0])) is True
    assert kiosk.cleared_step(dict(close, note=U["clearedNotePrefixes"][0] + " x")) is True
    assert [u.get("kind") for u in kiosk.status_changes([
        {"at": "2026-06-01T00:00:00Z", "status": "resolved", "kind": U["notStatusChanges"][0]},
        {"at": "2026-06-01T00:00:00Z", "status": "resolved", "kind": "cleared"}])] == ["cleared"]


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
    checks = {pb.card(st.task(a))["check"], pb.card(st.task(n))["check"], pb.card(st.task(n), {"battery_low"})["check"],
              pb.card(st.task(n), {"*"})["check"]}
    # every clock the card can say, each one declared — and one a Kiosk read before it listed them (2.496.429), so no
    # Kiosk is ever sent a word it does not show and the agent asks none which it reads (the "day" gate went with "day")
    assert checks == {"minutes", "nightly"} and checks <= set(T["checks"]) and checks <= set(T["checksBeforeList"]), checks


def test_the_sample_reads_as_the_agreement_says():
    held = asyncio.run(FakeKiosk(T["sample"]).held_tickets())[T["sample"]["id"]]
    step = [u for u in T["sample"]["updates"] if u["status"] == T["takenStep"]["status"] and not u.get("kind")
            and u.get("by") != T["agentStamp"]][-1]
    assert held["alert_number"] == T["sample"]["alertNumber"] and held["origin"] == T["sample"]["origin"]
    assert held["check"] == T["sample"]["check"]
    assert (held["taken_by"], held["taken_at"]) == (step["who"], step["at"])             # the take-on the chase stops on
    assert held["agent_title"] == T["sample"]["title"]                                   # its own title, by the stamp
    assert [n for _at, n in held["noted"]] == ["Reminder sent to Facility Manager"]


def test_the_agent_reads_the_agreement_never_a_copy():
    # one assertion per table the engine reads from the file (architecture review round 3, 2026-10-19: the kinds,
    # the stamp, the take-on step, the origins and the checks were typed in the engine and pinned here after the fact)
    from vesta_shared.problems import agreed
    assert list(kiosk.KINDS) == U["kinds"]                                             # ticketUpdate.kinds
    assert kiosk.AGENT_BY == T["agentStamp"]                                           # ticket.agentStamp
    step = {"status": T["takenStep"]["status"], "who": "Wayan", "by": "Facility manager"}
    assert kiosk.taken_step(step) and not kiosk.taken_step({**step, "by": T["agentStamp"]})   # ticket.takenStep
    assert not kiosk.taken_step({**step, "kind": U["kinds"][0]}) and not kiosk.taken_step({**step, "status": "open"})
    assert not kiosk.taken_step({k: v for k, v in step.items() if k != "by"})          # unstamped: the agent's own
    assert [agreed("origins", w) for w in T["origins"]] == T["origins"] and agreed("origins", "elsewhere") is None
    assert [agreed("checks", w) for w in T["checks"]] == T["checks"] and agreed("checks", "hourly") is None
