"""The pure pieces the nightly check and the reports share (architecture review, 0.12.27), by value."""
import os
import sys

from helpers import STARTER_SKILLS

sys.path.insert(0, os.path.join(STARTER_SKILLS, "preventive-maintenance", "scripts"))
sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
import features as F  # noqa: E402
import facts  # noqa: E402
from vesta_shared.messaging import no_code  # noqa: E402


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
    assert F.worsened(-40, -20) and not F.worsened(-30, -20) and not F.worsened(None, 10)
    assert F.worsened(20, None)
    rows = [{"rule_id": "S", "entity_id": "a"}, {"rule_id": "S", "entity_id": "b"}, {"rule_id": "E", "entity_id": "c"}]
    assert F.to_close(rows, {("S", "a")}, {"S"}) == [{"rule_id": "S", "entity_id": "b"}]


def test_no_code_strips_the_rule_code_only():
    assert no_code("[PM-02] Pump is off") == "Pump is off" and no_code("Pump [x] off") == "Pump [x] off"


def test_group_kinds_one_line_per_kind_worst_severity_and_kind_in_the_words():
    it = lambda k, s, n, since="": {"kind": k, "severity": s, "subject": n, "since": since}
    items = [it("A/x", "P3", "two", "2"), it("A/x", "P2", "one", "1"), it("A/x", "P4", "three", "3"), it("B", "P3", "alone")]
    out = facts.group_kinds(items, 3, {"A/x": "{n} {kind} things"})
    assert [g and g["title"] for g, _ in out] == ["3 x things", None]
    g, members = out[0]
    assert g["severity"] == "P2" and g["names"] == ["one", "two", "three"] and g["shown"] == "one, two, three"
    assert members[0]["subject"] == "one"
    # below the threshold, or no words for the kind: each stands alone
    assert all(g is None for g, _ in facts.group_kinds(items[:2], 3, {"A/x": "{n}"}))
    assert all(g is None for g, _ in facts.group_kinds(items, 3, {}))
    many = [it("A", "P3", f"n{k}") for k in range(10)]
    assert facts.group_kinds(many, 3, {"A": "{n}"})[0][0]["shown"].endswith("and 2 more")


def test_the_morning_digest_uses_the_same_grouping():
    import compose
    lines = compose._grouped([{"kind": "K", "severity": s, "subject": n, "title": f"{n} is off"}
                              for s, n in (("P3", "a"), ("P2", "b"), ("P3", "c"))], 3, {"K": "{n} {kind} off"})
    assert lines == ["- P2 3 K off: a, b, c."]


def test_a_percentage_line_stays_within_0_to_100_while_its_values_do():
    # owner, 2026-10-05: "the Y axis shall never go above 100 % when the value is 100 %" — but never a cap
    import re
    import compose
    top = lambda svg: max(float(v.replace(",", "")) for v in re.findall(r'text-anchor="end" fill="var\(--ink2\)">([-\d.,]+)<', svg))
    assert top(compose.line([("2026-10-01", 100), ("2026-10-02", 100), ("2026-10-03", 100)], "%")) == 100
    assert top(compose.line([("2026-10-01", 40), ("2026-10-02", 97)], "%")) == 100
    assert top(compose.line([("2026-10-01", 80), ("2026-10-02", 135)], "%")) > 135          # an energy change: no cap
    assert top(compose.line([("2026-10-01", 100), ("2026-10-02", 100)], "kWh")) > 100       # other units unchanged
