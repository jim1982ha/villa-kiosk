"""Home Assistant access for the skills' scripts.

Two clients share one interface:

McpClient     talks to Home Assistant through ha-mcp only (MCP streamable
              HTTP, JSON-RPC over POST). No direct REST or WebSocket access,
              no Home Assistant token: the house rule is "HA access = ha-mcp
              exclusively". The URL (a secret: the webhook path is the only
              credential) comes from VESTA_HA_MCP_URL. The client is read-only
              unless the agent's executor builds it with write=True; the
              skills' scripts never get a writing client.

FixtureClient serves saved JSON files (tests/fixtures) with the same
              interface, so every script runs offline in the replay test
              and inside the agent when it already holds the data from an
              ha-mcp tool result.

Every script accepts --fixture-dir for the offline tests. Inside the agent the
option is refused: the scripts read the live villa through McpClient.
"""

from __future__ import annotations

import json
import os
import ssl
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import urllib.error
import urllib.request


class HABase:
    zone: str = "UTC"

    # statistics ---------------------------------------------------------
    def statistics(self, entity_ids: Iterable[str], start: datetime, end: datetime,
                   period: str = "hour", types: Iterable[str] = ("mean", "min", "max")) -> dict[str, list[dict]]:
        raise NotImplementedError

    # raw history --------------------------------------------------------
    def history(self, entity_ids: Iterable[str], start: datetime, end: datetime) -> dict[str, list[dict]]:
        raise NotImplementedError

    def states(self, entity_ids: Iterable[str] | None = None) -> dict[str, dict]:
        raise NotImplementedError

    def helpers(self) -> tuple[list[dict], dict[str, str]]:
        raise NotImplementedError

    def registry(self) -> dict:
        """{'entities': [...], 'devices': [...], 'areas': [...]}"""
        raise NotImplementedError

    def logbook(self, start: datetime, end: datetime, entity_id: str | None = None) -> list[dict]:
        raise NotImplementedError

    def call_service(self, domain: str, service: str, data: dict) -> Any:
        raise NotImplementedError


class FixtureClient(HABase):
    """Reads the JSON files a session saved from ha-mcp tool results.

    Expected files (any may be absent):
      stats_hour_*.json / stats_day_*.json  ha_get_history(source=statistics) result 'data'
      history_raw_*.json                    ha_get_history(source=history) result 'data'
      helpers.json                          {'helpers': [...], 'states': {...}}
      registry.json                         {'entities': [...], 'areas': [...], 'devices': [...]}
      states.json                           {'states': {entity_id: {state, attributes, last_changed}}}
      logbook.json                          {'entries': [...]}
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
        out = {}
        for eid in entity_ids:
            rows = []
            for r in self._hist.get(eid, []):
                t = datetime.fromisoformat(r["last_changed"])
                if start <= t < end:
                    rows.append(r)
            out[eid] = rows
        return out

    def states(self, entity_ids=None):
        d = self._load("states.json", {"states": {}})["states"]
        if entity_ids is None:
            return d
        return {e: d[e] for e in entity_ids if e in d}

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

    def call_service(self, domain, service, data):
        # Recorded, never executed. The replay test asserts on this list.
        self._calls.append({"domain": domain, "service": service, "data": data})
        return {"recorded": True}


class HAError(RuntimeError):
    pass


# The only ha-mcp tools this client calls. Anything else is refused here, in
# the client, whoever asks.
READ_TOOLS = {
    "ha_get_state", "ha_get_entity", "ha_get_device", "ha_search", "ha_eval_template", "ha_get_history",
    "ha_get_logs", "ha_get_automation_traces", "ha_config_get_automation", "ha_config_list_helpers",
    "ha_list_floors_areas", "ha_get_camera_image", "ha_get_todo", "ha_get_overview", "ha_get_system_health",
}
WRITE_TOOLS = {"ha_call_service"}
BROWSER_UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 VESTA"


def _sse_last_data(raw: str) -> str:
    """The data of the last event of a text/event-stream body. Lines split on CR/LF only (the SSE rule, not
    str.splitlines, which also splits on Unicode separators found inside tool descriptions); the data lines
    of one event are joined with a newline."""
    import re as _re
    events, cur = [], []
    for line in _re.split(r"\r\n|\n|\r", raw):
        if line == "":
            if cur:
                events.append("\n".join(cur)); cur = []
        elif line.startswith("data:"):
            v = line[5:]
            cur.append(v[1:] if v.startswith(" ") else v)
    if cur:
        events.append("\n".join(cur))
    return events[-1] if events else ""


def _unwrap(body: Any) -> Any:
    if isinstance(body, dict) and isinstance(body.get("data"), dict) and ("metadata" in body or len(body) == 1):
        return body["data"]
    return body


class McpSession:
    """Minimal MCP streamable-HTTP client (initialize, tools/list, tools/call)."""

    HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
               "User-Agent": BROWSER_UA}

    def __init__(self, url: str, timeout: int = 90):
        if not url:
            raise HAError("VESTA_HA_MCP_URL is not set")
        self.url = url
        self.timeout = timeout
        self.sid: str | None = None
        self._id = 0

    def _http(self, payload: bytes, headers: dict) -> tuple[int, dict, bytes]:
        """One POST with the standard library (no third-party HTTP package in the scripts' path).
        urllib raises on 4xx/5xx; the status, headers and body are read from the error the same way."""
        req = urllib.request.Request(self.url, data=payload, method="POST", headers={**self.HEADERS, **headers})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b""

    def _post(self, method: str, params: dict | None = None, notify: bool = False, _retry: bool = True) -> Any:
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if not notify:
            self._id += 1
            body["id"] = self._id
        if params is not None:
            body["params"] = params
        headers = {"Mcp-Session-Id": self.sid} if self.sid else {}
        try:
            status, rh, content = self._http(json.dumps(body).encode(), headers)
        except Exception as e:  # never echo the URL: it holds the secret
            raise HAError(f"ha-mcp unreachable ({type(e).__name__})") from None
        if status in (400, 404) and self.sid and method != "initialize" and _retry:
            self.sid = None            # the session expired: one new session, one retry, never a loop
            self.initialize()
            return self._post(method, params, notify, _retry=False)
        if status >= 300:
            raise HAError(f"ha-mcp HTTP {status} on {method}")
        self.sid = rh.get("mcp-session-id") or self.sid
        if notify:
            return None
        raw = content.decode("utf-8", errors="replace")     # the server sends no charset: never guess Latin-1
        if "text/event-stream" in rh.get("content-type", ""):
            raw = _sse_last_data(raw)
        if not raw.strip():
            return None
        msg = json.loads(raw)
        if msg.get("error"):
            raise HAError(f"ha-mcp error on {method}: {msg['error'].get('message')}")
        return msg.get("result")

    def initialize(self) -> dict:
        res = self._post("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                        "clientInfo": {"name": "vesta-agent", "version": "0.3"}})
        self._post("notifications/initialized", notify=True)
        return res or {}

    def ensure(self) -> None:
        if not self.sid:
            self.initialize()

    def list_tools(self) -> list[dict]:
        self.ensure()
        return (self._post("tools/list", {}) or {}).get("tools", [])

    def call_raw(self, name: str, args: dict) -> dict:
        self.ensure()
        return self._post("tools/call", {"name": name, "arguments": args}) or {}


class McpClient(HABase):
    """The villa through ha-mcp. Read-only unless write=True (the agent's executor only)."""

    def __init__(self, url: str | None = None, zone: str | None = None, write: bool = False,
                 session: McpSession | None = None):
        self.zone = zone or os.environ.get("VILLA_TZ") or os.environ.get("TZ") or "UTC"
        self.write = bool(write) and os.environ.get("VESTA_HA_READ_ONLY") != "1"
        self.mcp = session or McpSession(url or os.environ.get("VESTA_HA_MCP_URL", ""))
        self._all_ids: list[str] | None = None

    # ------------------------------------------------------------------ core
    def tool(self, name: str, args: dict) -> Any:
        if name in WRITE_TOOLS and not self.write:
            raise HAError(f"{name} refused: this client is read-only")
        if name not in READ_TOOLS and name not in WRITE_TOOLS:
            raise HAError(f"{name} refused: not an allowed ha-mcp tool")
        res = self.mcp.call_raw(name, args)
        text = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        try:
            body = json.loads(text) if text else res.get("structuredContent")
        except json.JSONDecodeError:
            body = {"text": text}
        if res.get("isError"):
            raise HAError(f"{name} failed: {str(body)[:300]}")
        body = _unwrap(body)
        if isinstance(body, dict) and body.get("success") is False:
            raise HAError(f"{name} failed: {str(body.get('error') or body.get('message') or body)[:300]}")
        return body

    def tool_content(self, name: str, args: dict) -> list[dict]:
        """Raw MCP content blocks (images kept), for the camera snapshot."""
        if name not in READ_TOOLS:
            raise HAError(f"{name} refused")
        res = self.mcp.call_raw(name, args)
        if res.get("isError"):
            raise HAError(f"{name} failed")
        return res.get("content", [])

    # ------------------------------------------------------------------ reads
    def all_entity_ids(self) -> list[str]:
        if self._all_ids is None:
            ov = self.tool("ha_get_overview", {"detail_level": "minimal", "include_entity_id": True,
                                               "include_state": False, "max_entities_per_domain": 5000})
            ids = []
            for dom in (ov.get("domain_stats") or {}).values():
                ids += [e["entity_id"] for e in dom.get("entities", []) if e.get("entity_id")]
            self._all_ids = sorted(set(ids))
        return self._all_ids

    def states(self, entity_ids=None):
        ids = list(entity_ids) if entity_ids is not None else self.all_entity_ids()
        out: dict[str, dict] = {}
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            body = self.tool("ha_get_state", {"entity_id": chunk if len(chunk) > 1 else chunk[0],
                                              "fields": ["entity_id", "state", "attributes", "last_changed", "last_reported"]})
            if isinstance(body, dict) and "states" in body:
                out.update(body["states"] or {})
            elif isinstance(body, dict) and body.get("entity_id"):
                out[body["entity_id"]] = body
        return out

    def statistics(self, entity_ids, start, end, period="hour", types=("mean", "min", "max")):
        out = {}
        for eid in entity_ids:
            rows, offset = [], 0
            while True:
                body = self.tool("ha_get_history", {
                    "entity_ids": eid, "source": "statistics", "period": period, "statistic_types": list(types),
                    "start_time": start.astimezone(timezone.utc).isoformat(), "end_time": end.astimezone(timezone.utc).isoformat(),
                    "limit": 1000, "offset": offset})
                ent = next(iter(body.get("entities") or []), {})
                rows += ent.get("statistics") or []
                if not ent.get("has_more"):
                    break
                offset = ent.get("next_offset") or offset + len(ent.get("statistics") or [])
            for r in rows:
                if not isinstance(r.get("start"), (int, float)):
                    r["start"] = int(datetime.fromisoformat(str(r["start"])).timestamp() * 1000)
            out[eid] = sorted(rows, key=lambda r: r["start"])
        return out

    def history(self, entity_ids, start, end):
        out = {}
        for eid in entity_ids:
            rows, offset = [], 0
            while True:
                body = self.tool("ha_get_history", {
                    "entity_ids": eid, "source": "history", "order": "asc", "minimal_response": True,
                    "significant_changes_only": False, "limit": 1000, "offset": offset,
                    "start_time": start.astimezone(timezone.utc).isoformat(), "end_time": end.astimezone(timezone.utc).isoformat()})
                ent = next(iter(body.get("entities") or []), {})
                rows += ent.get("states") or []
                if not ent.get("has_more"):
                    break
                offset = ent.get("next_offset") or offset + len(ent.get("states") or [])
            out[eid] = rows
        return out

    def helpers(self):
        helpers = []
        for t in ("input_number", "input_text", "input_boolean", "input_select", "input_datetime",
                  "counter", "schedule", "person", "zone"):
            offset = 0
            while True:
                try:
                    body = self.tool("ha_config_list_helpers", {"helper_type": t, "limit": 500, "offset": offset})
                except HAError:
                    break
                for r in body.get("helpers") or []:
                    r = dict(r)
                    r["helper_type"] = t
                    r.setdefault("entity_id", f"{t}.{r.get('id')}")
                    helpers.append(r)
                if not body.get("has_more"):
                    break
                offset = body.get("next_offset") or offset + 500
        ids = [h["entity_id"] for h in helpers if h.get("entity_id")]
        st = self.states(ids) if ids else {}
        return helpers, {eid: s.get("state") for eid, s in st.items()}

    def registry(self):
        ids = self.all_entity_ids()
        devices, offset = [], 0
        while True:
            body = self.tool("ha_get_device", {"detail_level": "full", "limit": 100, "offset": offset})
            devices += body.get("devices") or []
            if not body.get("has_more"):
                break
            offset = body.get("next_offset") or offset + 100
        dev_of: dict[str, dict] = {}
        for d in devices:
            for e in d.get("entities") or []:
                dev_of[e["entity_id"]] = {"device_id": d.get("device_id"), "platform": e.get("platform"),
                                          "device_area": d.get("area_id")}
        states = self.states(ids)
        entities = []
        for i in range(0, len(ids), 50):
            body = self.tool("ha_get_entity", {"entity_id": ids[i:i + 50]})
            for e in body.get("entity_entries") or []:
                eid = e["entity_id"]
                attrs = (states.get(eid) or {}).get("attributes") or {}
                dv = dev_of.get(eid, {})
                entities.append({
                    "entity_id": eid,
                    "name": e.get("name") or attrs.get("friendly_name") or e.get("original_name"),
                    "area_id": e.get("area_id") or dv.get("device_area"),
                    "unit_of_measurement": attrs.get("unit_of_measurement"),
                    "device_class": e.get("device_class") or e.get("original_device_class") or attrs.get("device_class"),
                    "state_class": attrs.get("state_class"),
                    "platform": dv.get("platform"),
                    "device_id": dv.get("device_id"),
                    "state": (states.get(eid) or {}).get("state"),
                    "disabled_by": e.get("disabled_by"),
                })
        fa = self.tool("ha_list_floors_areas", {})
        areas = [a for f in fa.get("floors") or [] for a in f.get("areas") or []] + list(fa.get("unassigned_areas") or [])
        home = (states.get("zone.home") or {}).get("attributes") or {}
        return {"entities": entities, "devices": devices,
                "areas": [{"area_id": a.get("area_id"), "name": a.get("name")} for a in areas],
                "config": {"time_zone": self.zone, "location_name": home.get("friendly_name")}}

    def logbook(self, start, end, entity_id=None):
        now = datetime.now(timezone.utc)
        hours = max(1, int((now - start.astimezone(timezone.utc)).total_seconds() // 3600) + 1)
        # ⚠️ A PAGE MUST BRING NEW ROWS. ha-mcp 8.5.0 answered the same first page to every offset
        # (seen on the villa: one 3-day read became 20 identical calls, and every flip of a
        # device was counted 20 times by the reconnect check). Rows are kept once each, and the
        # reading stops at the first page that adds nothing.
        rows, seen, offset = [], set(), 0
        while True:
            args = {"source": "logbook", "hours_back": hours, "end_time": end.astimezone(timezone.utc).isoformat(),
                    "limit": 1000, "offset": offset, "order": "oldest"}
            if entity_id:
                args["entity_id"] = entity_id
            body = self.tool("ha_get_logs", args)
            batch = body.get("entries") or []
            fresh = 0
            for r in batch:
                key = json.dumps(r, sort_keys=True, default=str)
                if key not in seen:
                    seen.add(key)
                    rows.append(r)
                    fresh += 1
            if not body.get("has_more") or not fresh or offset >= 20000:   # 20 pages at most: a busy logbook is not a loop
                break
            offset += len(batch)
        out = []
        for r in rows:
            try:
                t = datetime.fromisoformat(r["when"])
            except (KeyError, ValueError):
                continue
            if start <= t < end:
                out.append(r)
        return out

    # ------------------------------------------------------------------ writes (executor only)
    def call_service(self, domain, service, data):
        if not self.write:
            raise HAError("call_service refused: this client is read-only (writes go through an approval)")
        data = dict(data or {})
        ent = data.pop("entity_id", None)
        if isinstance(ent, (list, tuple)) and len(ent) == 1:
            ent = ent[0]
        args = {"domain": domain, "service": service, "wait": True}
        # ⚠️ ha-mcp's `entity_id` ARGUMENT IS ONE STRING (8.5.0 refuses a list: "Input
        # should be a valid string" — the first approved action on the villa failed
        # so). One device goes there, and ha-mcp waits for its new state. Several go
        # as Home Assistant's own list inside `data`: a comma-joined string would
        # make ha-mcp wait 10 s on a composite name that does not exist.
        if isinstance(ent, str):
            args["entity_id"] = ent
        elif ent:
            data["entity_id"] = list(ent)
        if data:
            args["data"] = data
        return self.tool("ha_call_service", args)


def client_from_args(args) -> HABase:
    """Every script accepts --fixture-dir (offline tests); otherwise the villa through ha-mcp, read-only."""
    if getattr(args, "fixture_dir", None):
        return FixtureClient(args.fixture_dir, zone=getattr(args, "zone", None) or "UTC")
    return McpClient(zone=getattr(args, "zone", None))


def window(days: int, end: datetime | None = None) -> tuple[datetime, datetime]:
    end = end or datetime.now(timezone.utc)
    return end - timedelta(days=days), end
