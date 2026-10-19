"""The pure pieces the nightly check and the reports share (architecture review, 0.12.27), by value."""
import os
import sys

from helpers import STARTER_SKILLS

sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
import features as F  # noqa: E402
import facts  # noqa: E402
import playbook
from vesta_shared.messaging import no_code  # noqa: E402
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.skill_settings import load  # noqa: E402

#: the night check's thresholds as the skill ships them
PM_PARAMS = VillaParams(defaults=load(os.path.join(STARTER_SKILLS, "preventive-maintenance"), "settings.yaml")["behaviour"])


def test_one_device_key_whichever_rule_asks():
    with_id = {"device_id": "d1", "platform": "zha", "asset": "pump"}
    no_id = {"platform": "zha", "asset": "pump"}
    assert F.device_key(with_id, "sensor.x") == "d1"
    assert F.device_key(no_id, "sensor.x") == "zha:pump"
    # the flaps' case: a row the pack lacks, its asset found another way — same key shape as the others
    assert F.device_key({"asset": "pump"}, "sensor.x") == "x:pump"
    assert F.device_key({}, "sensor.x") == "sensor.x"


def test_a_device_found_through_several_entities_is_one_name():
    assert F.device_name(["Pump power"]) == "Pump power"
    assert F.device_name(["Pump power", "Pump energy", "Pump uptime"]) == "Pump power (+2 entities of the same device)"


def test_worsened_and_closed_tonight():
    assert F.worsened(-40, -20, 15) and not F.worsened(-30, -20, 15) and not F.worsened(None, 10, 15)
    assert F.worsened(20, None, 15)
    rows = [{"rule_id": "S", "entity_id": "a"}, {"rule_id": "S", "entity_id": "b"}, {"rule_id": "E", "entity_id": "c"}]
    assert F.to_close(rows, {("S", "a")}, {"S"}) == [{"rule_id": "S", "entity_id": "b"}]


def test_no_code_strips_the_rule_code_only():
    assert no_code("[PM-02] Pump is off") == "Pump is off" and no_code("Pump [x] off") == "Pump [x] off"


def test_group_kinds_one_line_per_kind_worst_severity_and_kind_in_the_words():
    it = lambda k, s, n, since="": {"kind": k, "severity": s, "subject": n, "since": since}
    items = [it("A/x", "P3", "two", "2"), it("A/x", "P2", "one", "1"), it("A/x", "P4", "three", "3"), it("B", "P3", "alone")]
    out = playbook.group_kinds(items, 3, {"A/x": "{n} {kind} things"})
    assert [g and g["title"] for g, _ in out] == ["3 x things", None]
    g, members = out[0]
    assert g["severity"] == "P2" and g["names"] == ["one", "two", "three"] and g["shown"] == "one, two, three"
    assert members[0]["subject"] == "one"
    # below the threshold, or no words for the kind: each stands alone
    assert all(g is None for g, _ in playbook.group_kinds(items[:2], 3, {"A/x": "{n}"}))
    assert all(g is None for g, _ in playbook.group_kinds(items, 3, {}))
    many = [it("A", "P3", f"n{k}") for k in range(10)]
    assert playbook.group_kinds(many, 3, {"A": "{n}"})[0][0]["shown"].endswith("and 2 more")


def test_the_morning_digest_uses_the_same_grouping():
    import compose
    lines = compose._grouped([{"kind": "K", "severity": s, "subject": n, "title": f"{n} is off"}
                              for s, n in (("P3", "a"), ("P2", "b"), ("P3", "c"))], 3, {"K": "{n} {kind} off"})
    assert lines == ["- P2 3 K off: a, b, c."]


def test_a_percentage_line_stays_within_0_to_100_while_its_values_do():
    # owner, 2026-10-05: "the Y axis shall never go above 100 % when the value is 100 %" — but never a cap
    import re
    import compose
    # the axis values are page text over the chart (compose._framed): right-aligned spans
    top = lambda svg: max(float(v.replace(",", "")) for v in re.findall(r'translate\(-100%,-80%\)[^"]*">([-\d.,]+)</span>', svg))
    assert top(compose.line([("2026-10-01", 100), ("2026-10-02", 100), ("2026-10-03", 100)], "%")) == 100
    assert top(compose.line([("2026-10-01", 40), ("2026-10-02", 97)], "%")) == 100
    assert top(compose.line([("2026-10-01", 80), ("2026-10-02", 135)], "%")) > 135          # an energy change: no cap
    assert top(compose.line([("2026-10-01", 100), ("2026-10-02", 100)], "kWh")) > 100       # other units unchanged


def test_float_noise_never_hangs_an_axis():
    # 2026-10-05: readings 21.4 and 21.400000000000002 looped forever in the axis ticks (the Kiosk's own
    # chart crashed on the same shape of data)
    from vesta_shared import page                                  # the charts every page shares
    first, last, ticks = page._ticks(21.4, 21.400000000000002)
    assert 2 <= len(ticks) <= 12 and last - first >= 0.5          # a readable axis, not 100 ticks of noise
    assert "<svg" in page.line([("2026-10-01", 21.4), ("2026-10-02", 21.400000000000002)], "°C")


def test_one_day_format_everywhere():
    # 2026-10-05: four skills wrote "5 Oct", three "05 Oct" — sometimes in the same report
    import re
    from datetime import date, datetime
    from helpers import STARTER_SKILLS
    from vesta_shared.timeutil import day_label, day_time_label
    assert day_label(date(2026, 10, 5)) == "5 Oct" and day_label(date(2026, 10, 15)) == "15 Oct"
    assert day_time_label(datetime(2026, 10, 5, 9, 30)) == "5 Oct, 09:30"
    hand = []
    for root, _d, files in os.walk(STARTER_SKILLS):
        for f in files:
            if f.endswith(".py"):
                src = open(os.path.join(root, f), encoding="utf-8").read()
                hand += [f for _ in re.findall(r'strftime\("%d %b', src)]
    assert hand == [], hand


def test_a_persons_phone_and_network_gear_are_known_by_their_integration_never_by_a_villas_names():
    # architecture review, 2026-10-07: the classifier named one villa's phones and a person; any villa now
    from vesta_shared.knowledge_pack import family_of
    phone = {"entity_id": "sensor.any_phone_battery_level", "device_class": "battery", "unit_of_measurement": "%",
             "platform": "mobile_app"}
    router = {"entity_id": "switch.any_router_port_forward", "platform": "unifi"}
    pump = {"entity_id": "sensor.example_pump_power", "device_class": "power", "unit_of_measurement": "W",
            "platform": "shelly"}
    assert family_of(phone) is None and family_of(router) == "network" and family_of(pump) == "power"


def test_an_integration_down_is_one_group_named_for_it():
    # architecture review 7: the merge sat inline in the night's run; round 3 (2026-10-19): it is the one reading's
    # (vesta_shared.offline.merged_integrations), the night check words it (nightly.integration_name)
    from datetime import datetime, timedelta, timezone
    from vesta_shared.offline import Group, merged_integrations
    import nightly
    now = datetime(2026, 10, 10, 2, tzinfo=timezone.utc)
    g = lambda eid, plat, h: Group(key=eid, label=None, asset=eid, asset_name=eid.title(), family="power", platform=plat,  # noqa: E731
                                   state="unavailable", since=now - timedelta(hours=h), hours=h, critical=False,
                                   names=[eid.title()], entity_ids=[eid])
    groups = {"d1": g("a", "zigbee", 2), "d2": g("b", "zigbee", 5), "d3": g("c", "zigbee", 1), "d4": g("d", "wifi", 3)}
    out = {x.key: x for x in merged_integrations(groups, 3, now)}
    assert set(out) == {"zigbee", "d"} and out["zigbee"].hours == 5 and out["zigbee"].integration == "zigbee"
    assert out["zigbee"].entity_ids == ["a", "b", "c"] and out["zigbee"].names == ["A", "B", "C"]
    # critical only when one of its devices is on the villa's list (owner, 2026-10-18), never for being a group
    assert out["zigbee"].critical is False
    crit = {**groups, "d2": Group(**{**groups["d2"].__dict__, "critical": True})}
    assert {x.key: x for x in merged_integrations(crit, 3, now)}["zigbee"].critical is True
    assert nightly.integration_name("zigbee", 3) == "zigbee integration (3 devices)" and groups["d1"].entity_ids == ["a"]
    assert merged_integrations(groups, 4, now) == list(groups.values())


def test_does_this_device_answer_has_one_reading():
    # architecture review, 2026-10-13: five scripts kept their own tuple of "does not answer" states
    from vesta_shared import device_state as D
    assert [D.reading(s) for s in ("21.5", "unavailable", "unknown", "", None)] == \
        [D.ANSWERS, D.OFFLINE_NOW, D.NO_VALUE_NOW, D.NO_VALUE_NOW, D.ABSENT]
    assert D.has_value("off") and not any(D.has_value(s) for s in ("unavailable", "unknown", "", None))


def test_a_sensor_without_a_value_now_and_then_is_not_a_reconnect_loop():
    # architecture review, 2026-10-13: "unknown" was counted as a drop — a wind chill going without a value on still
    # days read as "dropped and reconnected 12 times in 3 days: a Wi-Fi or power problem"
    from datetime import date
    import rules as R
    from vesta_shared.params import VillaParams
    rows = []
    for i in range(12):
        when = f"2026-10-1{1 + i // 6}T{8 + i % 6:02d}:00:00+00:00"
        rows.append({"entity_id": "sensor.wind_chill", "state": "unknown", "when": when})
        rows.append({"entity_id": "sensor.wind_chill", "state": "24.1", "when": when.replace(":00:00+", ":05:00+")})
        rows.append({"entity_id": "switch.relay", "state": "unavailable", "when": when.replace(":00:00+", ":30:00+")})
    flips = F.flips_per_day(rows, "UTC", 3)
    assert "sensor.wind_chill" not in flips
    assert sum(flips["switch.relay"].values()) == 12
    asset = {"slug": "relay", "name": "Relay"}
    (loop,) = R.flap_rules(asset, "switch.relay", flips["switch.relay"], date(2026, 10, 12), PM_PARAMS)
    assert loop.rule_id == "PM-RECONNECT-LOOP"


def test_a_reload_of_virtual_devices_is_not_a_reconnect_loop():
    # villa, 2026-10-20: 19 faults "dropped and reconnected 10 times in 3 days" in one night — every ceiling fan, a
    # template lock, template sensors: each save of a template, a helper or a package reloads them, "unavailable" for
    # ~50 ms. A drop back within the night's reconnect_min_drop_seconds is not counted; a real one, and one never
    # back, are.
    rows = []
    for i in range(12):
        t = f"2026-10-1{1 + i // 6}T{8 + i % 6:02d}:00:00"
        rows += [{"entity_id": "fan.ceiling", "state": "unavailable", "when": t + ".100000+00:00"},
                 {"entity_id": "fan.ceiling", "state": "off", "when": t + ".150000+00:00"},
                 {"entity_id": "switch.relay", "state": "unavailable", "when": t + ".000000+00:00"},
                 {"entity_id": "switch.relay", "state": "on", "when": t.replace(":00:00", ":00:45") + ".000000+00:00"}]
    rows.append({"entity_id": "sensor.gone", "state": "unavailable", "when": "2026-10-12T23:59:59.000000+00:00"})
    flips = F.flips_per_day(rows, "UTC", 3, 10)
    assert "fan.ceiling" not in flips                                  # 50 ms: the reload's blink
    assert sum(flips["switch.relay"].values()) == 12                    # 45 s: a real reconnect
    assert sum(flips["sensor.gone"].values()) == 1                      # never back: a drop
    assert sum(F.flips_per_day(rows, "UTC", 3)["fan.ceiling"].values()) == 12   # without the setting: counted, as before


def test_the_day_recheck_counts_the_same_three_days_as_the_night():
    # architecture review, 2026-10-20: at 12:00 the recheck read 72 hours but counted calendar days ending today — two
    # and a half days against a three-day threshold: a real loop of 12 drops "cleared" at noon, opened again at night
    from datetime import date, datetime, timedelta, timezone
    import rules as R
    noon = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
    rows = []
    for k in range(12):                                      # one drop every 6 hours over the last 72 hours
        t = noon - timedelta(hours=3 + 6 * k)
        rows += [{"entity_id": "switch.relay", "state": "unavailable", "when": t.isoformat()},
                 {"entity_id": "switch.relay", "state": "on", "when": (t + timedelta(minutes=1)).isoformat()}]
    flips = F.flips_per_day(rows, "UTC", 3, 10, end=noon)["switch.relay"]
    assert sum(flips.values()) == 12
    (loop,) = R.flap_rules({"slug": "relay", "name": "Relay"}, "switch.relay", flips, date(2026, 10, 19), PM_PARAMS)
    assert "12 times in 3 days" in loop.summary
    midnight = datetime(2026, 10, 19, tzinfo=timezone.utc)
    night = F.flips_per_day([r for r in rows if datetime.fromisoformat(r["when"]) < midnight], "UTC", 3, 10,
                            end=midnight)["switch.relay"]
    assert set(night) == {date(2026, 10, 16), date(2026, 10, 17), date(2026, 10, 18)}   # midnight: calendar days, as before
