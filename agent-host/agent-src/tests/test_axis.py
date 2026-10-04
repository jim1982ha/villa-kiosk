"""vesta_shared.axis — every chart's Y axis in the VESTA Agent — by value (0.12.36)."""
from vesta_shared.axis import decimals, is_flat, nice_axis


def test_a_label_has_exactly_its_steps_decimals():
    # the reports printed 0.2 / 0.8 for 0.25 / 0.75, the Costs page $3 / $8 for 2.5 / 7.5
    assert nice_axis(0, 0.9)["labels"] == ["0.00", "0.25", "0.50", "0.75", "1.00"]
    assert nice_axis(0, 9)["labels"] == ["0.0", "2.5", "5.0", "7.5", "10.0"]
    assert nice_axis(0, 2400)["labels"] == ["0", "1,000", "2,000", "3,000"]
    assert decimals(0.25) == 2 and decimals(2.5) == 1 and decimals(5) == 0


def test_float_noise_is_flat_and_an_axis_always_ends():
    a = nice_axis(21.4, 21.400000000000002)
    assert is_flat(21.4, 21.400000000000002) and 2 <= len(a["ticks"]) <= 12
    assert len(nice_axis(0, 1e9, 10**9)["ticks"]) <= 101
    assert nice_axis(0, float("inf"))["ticks"] == []


def test_the_ends_are_round_and_hold_the_data():
    a = nice_axis(0.3, 0.9)
    assert a["first"] <= 0.3 and a["last"] >= 0.9 and a["ticks"][0] == a["first"]
    # 0.3 / 0.1 is 2.9999999999999996 in floating point: without the margin the axis started a step low (0.2)
    assert nice_axis(0.3, 0.7)["first"] == 0.30000000000000004 or abs(nice_axis(0.3, 0.7)["first"] - 0.3) < 1e-9


def test_the_costs_chart_is_served_its_axis(tmp_path):
    import json
    from datetime import datetime, timedelta, timezone
    from vesta_agent import status
    from vesta_agent.state import State
    st = State(str(tmp_path / "s.sqlite"))
    st.db.execute("insert into calls(at, kind, detail) values (?, 'run', ?)",
                  ((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(), json.dumps({"who": "job:x", "cost_usd": 8.4})))
    st.db.commit()
    ax = status.costs(st, 7)["axis"]
    assert ax["labels"] == ["$0.0", "$2.5", "$5.0", "$7.5", "$10.0"] and ax["top"] == 10.0
