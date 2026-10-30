"""History read once for every device, and kept between the passes of a job that runs every few minutes (owner,
2026-10-30: the preventive-maintenance recheck took 41.9 s, then 89.6 s — 197 reads in an hour, each of one device,
every offline device's week read again on every tick). Synthetic devices; names invented."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from vesta_shared.ha_client import McpClient
from vesta_shared.history_memory import remembered
from vesta_shared.offline import held_since, offline_since
from vesta_shared.store import Store

T = datetime(2026, 10, 30, 6, 0, tzinfo=timezone.utc)


class Villa:
    """ha_get_history as ha-mcp answers it (seen on the villa, 2026-10-30): `entity_ids` one id or a list, each
    device's window opening with the state it held, `limit` per device, `has_more` per device. `calls`: each read's
    devices and window."""

    def __init__(self, rows: dict[str, list[tuple[datetime, str]]]):
        self.rows, self.calls = rows, []

    def call_raw(self, name, args):
        assert name == "ha_get_history"
        ids = args["entity_ids"] if isinstance(args["entity_ids"], list) else [args["entity_ids"]]
        a, b = datetime.fromisoformat(args["start_time"]), datetime.fromisoformat(args["end_time"])
        self.calls.append((tuple(ids), a, b))
        off, lim = args.get("offset") or 0, args["limit"]
        assert len(ids) == 1 or off == 0                                  # the tool refuses an offset with several
        ents = []
        for eid in ids:
            mine = self.rows.get(eid, [])
            inside = [(t, v) for t, v in mine if a <= t < b]
            before = [(t, v) for t, v in mine if t < a][-1:]
            states = [{"state": before[0][1], "last_changed": a.isoformat()}] if before and not (inside and inside[0][0] == a) else []
            states += [{"state": v, "last_changed": t.isoformat()} for t, v in inside]
            ents.append({"entity_id": eid, "states": states[off:off + lim], "has_more": off + lim < len(states),
                         "next_offset": off + lim if off + lim < len(states) else None})
        return {"content": [{"type": "text", "text": json.dumps({"success": True, "entities": ents})}]}


def _quiet(n, days=8):
    """`n` devices, each offline a few times in `days` (an LED strip, a sensor on the Wi-Fi)."""
    start = T - timedelta(days=days)
    return {f"sensor.example_{i}": [(start - timedelta(hours=1), "on")]
            + [(start + timedelta(hours=7 * k + i), "on" if k % 2 else "unavailable") for k in range(days * 3)]
            for i in range(n)}


def _alone(villa, ids, start, end):
    """Each device read on its own, as before (one client per device: its own slices)."""
    out = {}
    for eid in ids:
        out.update(McpClient("http://unused", "UTC", session=villa).history([eid], start, end))
    return out


def test_twenty_devices_eight_days_are_read_together_each_whole():
    rows = _quiet(20)
    start = T - timedelta(days=8)
    alone = Villa(rows)
    before = _alone(alone, sorted(rows), start, T)
    together = Villa(rows)
    after = McpClient("http://unused", "UTC", session=together).history(sorted(rows), start, T)
    assert after == before                                               # the same rows, each once, at its own time
    print(f"\n20 devices, 8 days: {len(alone.calls)} reads one device at a time, {len(together.calls)} together")
    assert len(alone.calls) >= 100 and len(together.calls) <= 8          # was one read per device per slice


def test_a_busy_device_among_quiet_ones_is_read_on_its_own_and_whole():
    rows = _quiet(3, days=3)
    start = T - timedelta(days=3)
    rows["sensor.example_meter"] = [(start - timedelta(seconds=7), "0.0")] + [
        (start + timedelta(seconds=5 * i), f"{i % 7}.0") for i in range(3 * 86400 // 5)]
    villa = Villa(rows)
    client = McpClient("http://unused", "UTC", session=villa)
    got = client.history(sorted(rows), start, T)
    assert got == _alone(Villa(rows), sorted(rows), start, T) and client.history_cut == {}
    alone_reads = [c for c in villa.calls if c[0] == ("sensor.example_meter",)]
    assert alone_reads and all(b - a <= timedelta(hours=6) for _ids, a, b in alone_reads)
    assert all("sensor.example_meter" not in ids for ids, _a, _b in villa.calls[1:] if len(ids) > 1)   # left the group


def test_devices_read_together_and_stopped_short_say_where(monkeypatch):
    from vesta_shared import ha_client
    monkeypatch.setattr(ha_client, "history_max_calls", lambda: 2)
    rows = _quiet(4)
    start = T - timedelta(days=8)
    client = McpClient("http://unused", "UTC", session=Villa(rows))
    got = client.history(sorted(rows), start, T)
    assert set(client.history_cut) == set(rows)
    for eid, cut in client.history_cut.items():
        assert start < cut < T and all(datetime.fromisoformat(r["last_changed"]) < cut for r in got[eid])


class Counting:
    """A client whose history() is the villa's, counting the reads (history_cut as the real client keeps it)."""

    def __init__(self, rows):
        self.villa = Villa(rows)
        self.mcp = McpClient("http://unused", "UTC", session=self.villa)
        self.history_cut = {}

    def history(self, ids, start, end):
        got = self.mcp.history(ids, start, end)
        self.history_cut = dict(self.mcp.history_cut or {})
        return got


def test_a_pass_reads_only_what_the_last_one_had_not_settled(tmp_path):
    rows = _quiet(20)
    store = Store(str(tmp_path / "s.sqlite"))
    start = T - timedelta(days=8)
    first = Counting(rows)
    got = remembered(first, store, "test-history", T)(sorted(rows), start, T)
    assert got == _alone(Villa(rows), sorted(rows), start, T)
    later = T + timedelta(minutes=5)
    rows["sensor.example_3"].append((later - timedelta(minutes=2), "unavailable"))   # a change since: never hidden
    rows["sensor.example_5"].append((T - timedelta(minutes=3), "unavailable"))       # written late, dated before T
    rows["sensor.example_5"].sort()
    second = Counting(rows)
    again = remembered(second, store, "test-history", later)(sorted(rows), start + timedelta(minutes=5), later)
    assert again == _alone(Villa(rows), sorted(rows), start + timedelta(minutes=5), later)
    assert all(a >= T - timedelta(minutes=10) for _ids, a, _b in second.villa.calls)   # only the unsettled minutes
    print(f"\nsecond pass: {len(second.villa.calls)} reads (first: {len(first.villa.calls)})")
    assert len(second.villa.calls) == 1


def test_a_device_stopped_short_is_not_kept(tmp_path, monkeypatch):
    from vesta_shared import ha_client
    monkeypatch.setattr(ha_client, "history_max_calls", lambda: 2)
    rows = _quiet(2)
    store = Store(str(tmp_path / "s.sqlite"))
    remembered(Counting(rows), store, "test-history", T)(sorted(rows), T - timedelta(days=8), T)
    assert (store.cache_get("test-history") or {}).get("devices") == {}


def test_since_when_offline_reads_up_to_the_latest_last_changed_and_is_kept(tmp_path):
    # the recheck read every offline device's days since its restart clock, then dropped them
    went = T - timedelta(days=2)
    rows = {"sensor.example_a": [(T - timedelta(days=12), "on"), (T - timedelta(days=5), "unavailable"), (went, "unavailable")],
            "sensor.example_b": [(T - timedelta(days=12), "on"), (went, "unavailable")]}
    asked = []

    def history(ids, start, end):
        asked.append((start, end))
        return _alone(Villa(rows), ids, start, end)
    got = offline_since(history, {"sensor.example_a": went, "sensor.example_b": went}, T)
    assert got == {"sensor.example_a": T - timedelta(days=5), "sensor.example_b": went}
    assert asked[0][1] == went + timedelta(seconds=1)                     # not to now
    assert held_since(history, {"sensor.example_a": ("unavailable", went)}, T) == {"sensor.example_a": T - timedelta(days=5)}
    store = Store(str(tmp_path / "s.sqlite"))
    for k in range(3):                                                    # three ticks: the past read once
        tick = Counting(rows)
        now = T + timedelta(minutes=5 * k)
        assert offline_since(remembered(tick, store, "test-history", now),
                             {"sensor.example_a": went, "sensor.example_b": went}, now) == got
        assert len(tick.villa.calls) == (0 if k else len(tick.villa.calls))
