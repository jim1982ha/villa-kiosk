"""The night check and the reports, as the owner reads them (architecture review 30, 2026-10-11). Invented villa."""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sys

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_shared import result
from vesta_shared.knowledge_pack import KnowledgePack
from vesta_shared.problems import Problems
from vesta_shared.store import Store

PM = os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts")


def _load(name, folder):
    if folder not in sys.path:
        sys.path.insert(0, folder)
    return importlib.import_module(name)


def test_a_pump_that_ran_short_keeps_its_fault_until_a_quiet_night(tmp_path):
    # its fault was made and resolved in the same second: "Cleared: the check no longer sees it", the digest "nothing new"
    nightly, R = _load("nightly", PM), _load("rules", PM)
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": 222, "name": "Fabien", "role": "fm"}]}, kiosk=k)
    st = Store(v.s.store_path)
    f = R.Finding("PM-RUNHOURS", "sensor.pool_pump_power", "pool_pump", "power", "P3",
                  "Pool Pump ran 3.0 h against 8.0 h scheduled.", {}, "Check the timer.")
    rules = dict(state_rules=nightly.STATE_RULES, event_rules=nightly.EVENT_RULES, worsened_step=15)
    night = Problems(st).record_night([f], "2026-10-05", **rules)
    assert night["task_ids"]
    asyncio.run(v.outcome.carry_out({"actions": [result.faults_changed()]}, "preventive-maintenance"))
    asyncio.run(v.tickets.repair())
    assert k.tickets and not k.resolved and Problems(st).open_problems()
    Problems(st).record_night([], "2026-10-06", **rules)                                # a night without it
    asyncio.run(v.tickets.repair())
    assert k.resolved == ["t1"]


def test_fixed_lists_what_ended_never_what_happened_once(tmp_path):
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import facts
    from datetime import date
    st = Store(str(tmp_path / "s.sqlite"))
    once, _ = st.raise_finding("PM-RUNHOURS", "sensor.p", "power", "2026-10-05", "P4", "Pump ran short", {})
    st.close_finding("PM-RUNHOURS", "sensor.p", "2026-10-05")
    lasted, _ = st.raise_finding("PM-OFF", "sensor.q", "offline", "2026-10-03", "P3", "Plug offline", {})
    st.close_finding("PM-OFF", "sensor.q", "2026-10-06")

    class C:
        store, start, end = st, date(2026, 10, 1), date(2026, 10, 31)
    assert [f["title"] for f in facts.s_fixed_suggest(C)["fixed"]] == ["Plug offline"]


def test_an_alert_is_dated_the_villas_day(tmp_path, monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Makassar")                                            # UTC+8
    st = Store(str(tmp_path / "s.sqlite"))
    st.new_incident("k", "automation.gate", "binary_sensor.gate", "P4", {"message": "Gate opened at night"},
                    at="2026-10-09T22:30:00+00:00")                                      # 06:30 on the 10th at the villa
    (p,) = Problems(st).open_problems()
    assert p["since"] == "2026-10-10"


def test_a_sensor_without_a_value_is_not_offline_to_the_concierge():
    con = _load("concierge", os.path.join(STARTER_SKILLS, "villa-concierge", "scripts"))
    fam = {"level": [{"entity_id": "sensor.wind_chill", "name": "Weather Station Wind Chill", "asset": "ws"}]}
    pack = KnowledgePack(villa="V", time_zone="UTC", generated_at="", ha_version=None, families=fam,
                         assets={"ws": {"name": "Weather Station"}}, areas=[], people=[], channels={}, unknown_area=[],
                         unclassified=[], retention={})
    assert con.status(pack, {"sensor.wind_chill": {"state": "unknown"}}, None)["colour"] == "green"
    assert con.status(pack, {"sensor.wind_chill": {"state": "unavailable"}}, None)["colour"] == "amber"


def test_back_again_is_said_when_the_run_before_began_long_ago(tmp_path):
    nightly, R = _load("nightly", PM), _load("rules", PM)
    st = Store(str(tmp_path / "s.sqlite"))
    rules = dict(state_rules=nightly.STATE_RULES, event_rules=nightly.EVENT_RULES, worsened_step=15)
    rule = sorted(nightly.STATE_RULES)[0]
    f = lambda: R.Finding(rule, "switch.gate_relay", "gate", "offline", "P3", "Gate relay has been offline for 40 h.", {}, "Power.")
    pb = Problems(st)
    pb.record_night([f()], "2026-09-20", **rules)
    for d in range(21, 31):
        pb.record_night([f()], f"2026-09-{d}", **rules)
    for d in range(1, 9):
        pb.record_night([f()], f"2026-10-0{d}", **rules)
    pb.record_night([], "2026-10-09", **rules)                                           # gone
    back = pb.record_night([f()], "2026-10-10", **rules)["again"]                        # back
    assert back and back[0]["again"] >= 1
