"""The skills' Home Assistant client for the offline tests: saved JSON files, McpClient's interface.

Moved out of vesta_shared.ha_client (0.6.42): it was installed on the villa, where nothing may use it.
A script given --fixture-dir imports it from here (tests/ on PYTHONPATH: helpers.PYTHONPATH).
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from vesta_shared.ha_client import HABase


class FixtureClient(HABase):
    """Reads the JSON files a session saved from ha-mcp tool results.

    Expected files (any may be absent):
      stats_hour_*.json / stats_day_*.json  ha_get_history(source=statistics) result 'data'
      history_raw_*.json                    ha_get_history(source=history) result 'data'
      helpers.json                          {'helpers': [...], 'states': {...}}
      registry.json                         {'entities': [...], 'areas': [...], 'devices': [...]}
      states.json                           {'states': {entity_id: {state, attributes, last_changed}}, 'not_found': [ids]}
      logbook.json                          {'entries': [...]}
      templates.json                        {template text: what Home Assistant renders it as}
      energy_prefs.json                     ha_manage_energy_prefs(mode=get)'s `config` (absent: no settings read)
    """

    def __init__(self, fixture_dir: str, zone: str = "UTC", extra_helpers: str | None = None):
        self.dir = fixture_dir
        self.zone = zone
        self.extra_helpers = extra_helpers or os.environ.get("VESTA_EXTRA_HELPERS")
        self._stats: dict[str, dict[str, list[dict]]] = {"hour": {}, "day": {}, "week": {}, "month": {}}
        self._hist: dict[str, list[dict]] = {}
        self._calls: list[dict] = []
        for name in sorted(os.listdir(fixture_dir)):
            p = os.path.join(fixture_dir, name)
            if name.startswith("stats_") and name.endswith(".json"):
                d = json.load(open(p, encoding="utf-8"))
                d = d.get("data", d)
                period = d.get("period_type", "hour")
                for e in d.get("entities", []):
                    self._stats.setdefault(period, {}).setdefault(e["entity_id"], []).extend(e.get("statistics", []))
            elif name.startswith("history_raw") and name.endswith(".json"):
                d = json.load(open(p, encoding="utf-8"))
                d = d.get("data", d)
                for e in d.get("entities", []):
                    self._hist.setdefault(e["entity_id"], []).extend(e.get("states", []))
        for per in self._stats.values():
            for rows in per.values():
                rows.sort(key=lambda r: r["start"])

    def _load(self, name: str, default: Any) -> Any:
        p = os.path.join(self.dir, name)
        if not os.path.exists(p):
            return default
        return json.load(open(p, encoding="utf-8"))

    def statistics(self, entity_ids, start, end, period="hour", types=("mean", "min", "max")):
        s_ms, e_ms = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
        out = {}
        for eid in entity_ids:
            rows = self._stats.get(period, {}).get(eid, [])
            out[eid] = [r for r in rows if s_ms <= r["start"] < e_ms]
        return out

    def history(self, entity_ids, start, end):
        """As Home Assistant answers (villa_timeline.history_rows): the state carried over from before `start`, stamped at
        `start`, then each change."""
        from villa_timeline import history_rows
        return {eid: history_rows([(datetime.fromisoformat(r["last_changed"]), r["state"]) for r in self._hist.get(eid, [])],
                                  start, end) for eid in entity_ids}

    def states(self, entity_ids=None):
        d = self._load("states.json", {"states": {}})["states"]
        if entity_ids is None:
            return d
        return {e: d[e] for e in entity_ids if e in d}

    def not_found(self, entity_ids):
        # states.json's "not_found": the ids Home Assistant answers "not found" for (deleted since)
        gone = set(self._load("states.json", {"states": {}}).get("not_found") or [])
        return {e for e in entity_ids if e in gone}

    def helpers(self):
        d = self._load("helpers.json", {"helpers": [], "states": {}})
        helpers, states = list(d.get("helpers", [])), dict(d.get("states", {}))
        # helpers_local.json: helpers that do not exist on the villa yet (a proposal, a test)
        extra = self._load(self.extra_helpers, {"helpers": [], "states": {}}) if self.extra_helpers else {"helpers": [], "states": {}}
        helpers += extra.get("helpers", []); states.update(extra.get("states", {}))
        return helpers, states

    def registry(self):
        return self._load("registry.json", {"entities": [], "areas": [], "devices": []})

    def logbook(self, start, end, entity_id=None):
        rows = self._load("logbook.json", {"entries": []})["entries"]
        out = []
        for r in rows:
            t = datetime.fromisoformat(r["when"])
            if start <= t < end and (entity_id is None or r.get("entity_id") == entity_id):
                out.append(r)
        return out

    def template(self, text):
        said = self._load("templates.json", {})
        if text not in said:
            raise KeyError(f"no rendering saved for this template: {text[:80]}")
        return str(said[text])

    def energy_prefs(self):
        return self._load("energy_prefs.json", None)

    def call_service(self, domain, service, data):
        # Recorded, never executed. The replay test asserts on this list.
        self._calls.append({"domain": domain, "service": service, "data": data})
        return {"recorded": True}
