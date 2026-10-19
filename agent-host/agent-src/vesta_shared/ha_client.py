"""Home Assistant access for the skills' scripts.

Two clients share one interface:

McpClient     talks to Home Assistant through ha-mcp only (MCP streamable
              HTTP, JSON-RPC over POST). No direct REST or WebSocket access,
              no Home Assistant token: the house rule is "HA access = ha-mcp
              exclusively". The URL (a secret: the webhook path is the only
              credential) comes from VESTA_HA_MCP_URL. The client is read-only
              unless the agent's executor builds it with write=True; the
              skills' scripts never get a writing client.

Every script accepts --fixture-dir for the agent's offline tests: their
FixtureClient (saved JSON files, the same interface) lives with the tests,
tests/fixture_client.py, and never in the app. Inside the agent the option is
refused anyway: the scripts read the live villa through McpClient.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import urllib.error
import urllib.request

from .past import History, Logbook, until
from .limits import limit
from .read_guard import READ_ACTIONS, READ_TOOLS, WRITE_TOOLS, logbook_slice, refused  # noqa: F401 (READ_ACTIONS, READ_TOOLS: read here by name)


class HABase:
    zone: str = "UTC"
    #: where the last logbook read stopped before its end (None: it read everything) — a count from it is a floor.
    #: Kept for a starter skill edited on the villa (kept by updates); new readers use logbook_read.
    logbook_cut: "datetime | None" = None
    #: {entity: where the last history read stopped before its end} — the same, for history(); see history_read
    history_cut: "dict[str, datetime] | None" = None

    # the past, with how far each read got (vesta_shared.past) ------------
    def history_read(self, entity_ids: Iterable[str], start: datetime, end: datetime,
                     now: datetime | None = None) -> "History":
        """history() with how far each entity's reading got, over [start, end) brought back to `now` (default: the
        clock). A client that reads in one piece says nothing stopped short (`history_cut` unset)."""
        ids, end = list(entity_ids), until(end, now)
        if end <= start:
            return History({e: [] for e in ids}, start, start)
        rows = self.history(ids, start, end)
        return History(rows, start, end, dict(getattr(self, "history_cut", None) or {}), self.kept_from(now))

    def logbook_read(self, start: datetime, end: datetime, entity_id: str | None = None,
                     now: datetime | None = None) -> "Logbook":
        """logbook() with how far the reading got, over [start, end) brought back to `now` (default: the clock)."""
        end = until(end, now)
        if end <= start:
            return Logbook([], start, start)
        rows = self.logbook(start, end, entity_id) if entity_id is not None else self.logbook(start, end)
        return Logbook(rows, start, end, getattr(self, "logbook_cut", None), self.kept_from(now))

    #: How many days of detailed history the villa's system holds (the knowledge pack's measure, vesta_shared.retention;
    #: script.Context sets it): None when not known — every period is then read as kept
    detailed_days: "float | None" = None

    def kept_from(self, now: datetime | None = None) -> "datetime | None":
        """Where the villa's detailed history begins now (its every change, its logbook), or None when not known."""
        if not self.detailed_days:
            return None
        return (now or datetime.now(timezone.utc)) - timedelta(days=float(self.detailed_days))

    # statistics ---------------------------------------------------------
    def statistics(self, entity_ids: Iterable[str], start: datetime, end: datetime,
                   period: str = "hour", types: Iterable[str] = ("mean", "min", "max")) -> dict[str, list[dict]]:
        raise NotImplementedError

    # raw history --------------------------------------------------------
    def history(self, entity_ids: Iterable[str], start: datetime, end: datetime) -> dict[str, list[dict]]:
        raise NotImplementedError

    def states(self, entity_ids: Iterable[str] | None = None) -> dict[str, dict]:
        raise NotImplementedError

    def not_found(self, entity_ids: Iterable[str]) -> set[str]:
        """The ids Home Assistant says it does not have (deleted, renamed). Only its own "not found": an id a read
        failed for is not in it — a client that cannot tell says none."""
        return set()

    def helpers(self) -> tuple[list[dict], dict[str, str]]:
        raise NotImplementedError

    def automation_configs(self, text: str) -> list[dict]:
        """The configs of the villa's automations whose configuration mentions `text` (a blueprint's name)."""
        raise NotImplementedError

    def registry(self) -> dict:
        """{'entities': [...], 'devices': [...], 'areas': [...]}"""
        raise NotImplementedError

    def logbook(self, start: datetime, end: datetime, entity_id: str | None = None) -> list[dict]:
        raise NotImplementedError

    def call_service(self, domain: str, service: str, data: dict) -> Any:
        raise NotImplementedError

    def template(self, text: str) -> str:
        """`text` (a Home Assistant template) rendered by Home Assistant now — an alert's claim (alert-desk)."""
        raise NotImplementedError

    def energy_prefs(self) -> dict | None:
        """The villa's Energy settings (energy_sources, device_consumption, …) — vesta_shared.energy_setup reads them.
        None: a client that cannot read them (a test's stand-in), so a reader falls back."""
        return None


class HAError(RuntimeError):
    pass


# Which tools and arguments may reach the villa's system: read_guard.py, for this client and the AI's reads alike.
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

    def __init__(self, url: str, timeout: int | None = None):
        if not url:
            raise HAError("VESTA_HA_MCP_URL is not set")
        self.url = url
        self.timeout = timeout          # None: the villa's limit, read at each call
        self.sid: str | None = None
        self._id = 0

    def _http(self, payload: bytes, headers: dict) -> tuple[int, dict, bytes]:
        """One POST with the standard library (no third-party HTTP package in the scripts' path).
        urllib raises on 4xx/5xx; the status, headers and body are read from the error the same way."""
        req = urllib.request.Request(self.url, data=payload, method="POST", headers={**self.HEADERS, **headers})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout or read_timeout_s()) as r:
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
        self.server_info = (res or {}).get("serverInfo") or {}      # name and version, for the VESTA Agent page
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


# history() reads by time slices (ha-mcp fetches the whole period on every page): its page, first slice and bounds —
# each the villa's limit (vesta_shared.limits), read when a reading starts
def read_timeout_s() -> float:
    return limit("villa.read_timeout_s", 90, unit="seconds", group="read", lo=10, hi=600,
                 says="How long the agent waits for the villa's system to answer one read.",
                 reached="That read fails: the AI is told \"The villa's system did not answer\", a skill's step fails.",
                 told="ai")


def history_page() -> int:
    return limit("history.page_rows", 1000, unit="readings", group="read", lo=100, hi=1000,
                 says="Readings a skill asks for in one page of a device's history (the villa's system gives 1,000 at "
                      "most).",
                 reached="The skill reads the next page, or a shorter slice of time.", told="")


def history_first_slice() -> timedelta:
    return timedelta(hours=limit("history.first_slice_hours", 6, unit="hours", group="read", lo=1, hi=48,
                                 says="The first stretch of time a skill reads of a device's history in one go.",
                                 reached="A busy stretch is halved, a quiet one doubled.", told=""))


def history_min_slice() -> timedelta:
    return timedelta(minutes=limit("history.min_slice_minutes", 5, unit="minutes", group="read", lo=1, hi=60,
                                   says="The shortest stretch a skill halves a busy history down to before paging "
                                        "through it.",
                                   reached="That stretch is read page after page.", told=""))


def history_max_slice() -> timedelta:
    return timedelta(days=limit("history.max_slice_days", 2, unit="days", group="read", lo=1, hi=10,
                                says="The longest stretch of a quiet device's history a skill reads in one go.",
                                reached="The next stretch starts there.", told=""))


def history_max_calls() -> int:
    return limit("history.max_calls", 400, unit="reads", group="read", lo=10, hi=5000,
                 says="Reads of the villa's system one device's history may take (a 10-day read of a meter reporting "
                      "every second fits).",
                 reached="The reading stops there; the skill says the period was read only up to that moment.",
                 told="person")


def history_slice_pages() -> int:
    return limit("history.slice_pages", 20, unit="pages", group="read", lo=1, hi=200,
                 says="Pages read of the shortest stretch of a very busy device's history.",
                 reached="The reading stops there and says how far it got.", told="person")


def error_chars() -> int:
    return limit("errors.detail_chars", 300, unit="characters", group="text", lo=50, hi=5000,
                 says="How much of an error's own text is kept when a read or a script fails.",
                 reached="The rest of the error's text is cut.", told="")


def error_short_chars() -> int:
    return limit("errors.short_detail_chars", 200, unit="characters", group="text", lo=50, hi=5000,
                 says="How much of an error's text a short failure note keeps (a template, a list that could not be "
                      "read).",
                 reached="The rest of the error's text is cut.", told="")


def _when(row: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(row.get("last_changed") or row.get("last_updated")))
    except (TypeError, ValueError):
        return None


def paged(fetch, step: int, max_pages: int) -> tuple[list, bool]:
    """Every row of a paged read, each once, and whether the read reached its end. `fetch(offset) -> (rows, has_more,
    next_offset)`.

    ⚠️ A READ CUT SHORT SAYS SO (2026-10-13): ha-mcp gives at most 500 logbook rows a page whatever is asked, and
    the night's 3-day logbook (13,031 rows) stopped at its 20th page — the last 17 hours never read, a relay's
    drops counted 13 for 31. Every caller is told, never left to guess from a row count.

    ⚠️ A PAGE MUST BRING NEW ROWS (ha-mcp 8.5.0 answered the same first page to every offset: one 3-day logbook read
    became 20 identical calls). The reading stops at a page that adds nothing, at the last page, or after
    `max_pages`. ONE RULE FOR EVERY PAGED READ (architecture review, 2026-10-07): only the logbook had it —
    statistics and history could loop for ever on an empty page that said "more"."""
    rows, seen, offset = [], set(), 0
    for _ in range(max_pages):
        batch, more, nxt = fetch(offset)
        fresh = 0
        for r in batch:
            key = json.dumps(r, sort_keys=True, default=str)
            if key not in seen:
                seen.add(key)
                rows.append(r)
                fresh += 1
        if not more:
            return rows, True
        if not fresh:
            return rows, False                     # "more" with nothing new: the server repeats itself
        offset = nxt if isinstance(nxt, int) and nxt > offset else offset + (len(batch) or step)
    return rows, False


class McpClient(HABase):
    """The villa through ha-mcp. Read-only unless write=True (the agent's executor only)."""

    def __init__(self, url: str | None = None, zone: str | None = None, write: bool = False,
                 session: McpSession | None = None):
        self.zone = zone or os.environ.get("VILLA_TZ") or os.environ.get("TZ") or "UTC"
        self.write = bool(write) and os.environ.get("VESTA_HA_READ_ONLY") != "1"
        self.mcp = session or McpSession(url or os.environ.get("VESTA_HA_MCP_URL", ""))
        self._all_ids: list[str] | None = None

    # ------------------------------------------------------------------ core
    def tool(self, name: str, args: dict, partial: bool = False) -> Any:
        """`partial`: a bulk read whose every lookup failed still answers (its `errors` say why), not HAError."""
        if why := refused(name, args):
            raise HAError(why)
        if name in READ_ACTIONS:
            pass                                        # a read action of a tool that can write (refused passed it)
        elif name in WRITE_TOOLS and not self.write:
            raise HAError(f"{name} refused: this client is read-only")
        elif name not in READ_TOOLS and name not in WRITE_TOOLS:
            raise HAError(f"{name} refused: not an allowed ha-mcp tool")
        res = self.mcp.call_raw(name, args)
        text = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        try:
            body = json.loads(text) if text else res.get("structuredContent")
        except json.JSONDecodeError:
            body = {"text": text}
        if res.get("isError"):
            raise HAError(f"{name} failed: {str(body)[:error_chars()]}")
        body = _unwrap(body)
        if isinstance(body, dict) and body.get("success") is False and not (partial and "errors" in body):
            raise HAError(f"{name} failed: {str(body.get('error') or body.get('message') or body)[:error_chars()]}")
        return body

    def energy_prefs(self):
        # mode "get" ONLY: the one mode READ_ACTIONS lets through (every other one writes the owner's Energy dashboard)
        body = self.tool("ha_manage_energy_prefs", {"mode": "get"})
        cfg = body.get("config") if isinstance(body, dict) else None
        return cfg if isinstance(cfg, dict) else None

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
                                               "include_state": False,
                                               "max_entities_per_domain": limit(
                                                   "devices.per_domain", 5000, unit="devices", group="read", lo=100,
                                                   hi=50000,
                                                   says="Devices of one kind (lights, sensors…) the agent lists from "
                                                        "the villa's system.",
                                                   reached="Devices of that kind past this number are not known to "
                                                           "the skills.", told="")})
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

    def not_found(self, entity_ids):
        # ⚠️ ASKED AS A LIST, EVEN OF ONE: one id alone that HA does not have is an error; in a list it is a row of
        # `errors` with HA's own code (ENTITY_NOT_FOUND, its 404) — a timeout or a refusal is never read as "deleted"
        ids, gone = sorted(set(entity_ids)), set()
        for i in range(0, len(ids), 100):
            body = self.tool("ha_get_state", {"entity_id": ids[i:i + 100], "fields": ["entity_id"]}, partial=True)
            for e in (body.get("errors") or []) if isinstance(body, dict) else []:
                if isinstance(e, dict) and (e.get("error") or {}).get("code") == "ENTITY_NOT_FOUND" and e.get("entity_id"):
                    gone.add(e["entity_id"])
        return gone

    def statistics(self, entity_ids, start, end, period="hour", types=("mean", "min", "max")):
        out = {}
        page = limit("statistics.page_rows", 1000, unit="rows", group="read", lo=100, hi=1000,
                     says="Hourly or daily figures a skill asks for in one page of a device's statistics.",
                     reached="The skill reads the next page.", told="")
        pages = limit("statistics.max_pages", 200, unit="pages", group="read", lo=1, hi=2000,
                      says="Pages of statistics read for one device (200 pages are years of hourly figures).",
                      reached="The reading stops there, without saying so.", told="")
        for eid in entity_ids:
            def fetch(offset, eid=eid):
                body = self.tool("ha_get_history", {
                    "entity_ids": eid, "source": "statistics", "period": period, "statistic_types": list(types),
                    "start_time": start.astimezone(timezone.utc).isoformat(), "end_time": end.astimezone(timezone.utc).isoformat(),
                    "limit": page, "offset": offset})
                ent = next(iter(body.get("entities") or []), {})
                return ent.get("statistics") or [], ent.get("has_more"), ent.get("next_offset")
            rows, _ = paged(fetch, page, max_pages=pages)     # a year of hours is 9 pages of 1,000
            for r in rows:
                if not isinstance(r.get("start"), (int, float)):
                    r["start"] = int(datetime.fromisoformat(str(r["start"])).timestamp() * 1000)
            out[eid] = sorted(rows, key=lambda r: r["start"])
        return out

    def history(self, entity_ids, start, end):
        """Every recorded state of each entity in [start, end), oldest first.

        ⚠️ READ BY TIME SLICES, NOT BY PAGES (2026-10-11): ha-mcp fetches the WHOLE period from Home Assistant on every
        call and cuts its page out after — 3 days of a power meter that reports every few seconds were read 88 times
        over to page through them (minutes for one device). A slice holding more than a page is halved and read again;
        a quiet slice lets the next one double. Each slice opens with the state carried over from before it, stamped
        at the slice's start: kept only for the first slice, never counted as a change."""
        # ⚠️ A READ CUT SHORT SAYS SO (architecture review 32): stopped at its cap, it handed back what it had and a reader
        # stretched the last state to the period's end — "ran until 15:00", made up. {entity: where the read stopped}:
        # kept on the client for a skill edited before history_read (round 2, 2026-10-16), which carries it instead.
        out, self.history_cut = self._history(entity_ids, start, end)
        return out

    def history_read(self, entity_ids, start, end, now=None):
        ids, end = list(entity_ids), until(end, now)
        if end <= start:
            return History({e: [] for e in ids}, start, start)
        rows, cut = self._history(ids, start, end)          # the cut carried with the rows, not left on the client
        return History(rows, start, end, cut, self.kept_from(now))

    def _history(self, entity_ids, start, end) -> tuple[dict[str, list[dict]], dict[str, datetime]]:
        out: dict[str, list[dict]] = {}
        cut: dict[str, datetime] = {}
        for eid in entity_ids:
            out[eid], stopped = self._history_one(eid, start.astimezone(timezone.utc), end.astimezone(timezone.utc))
            if stopped is not None:
                cut[eid] = stopped
        return out, cut

    def _history_one(self, eid, start, end) -> tuple[list[dict], datetime | None]:
        """(the rows, where the reading stopped before `end` — None when it read to the end)."""
        page = history_page()

        def fetch(a, b, offset=0):
            body = self.tool("ha_get_history", {
                "entity_ids": eid, "source": "history", "order": "asc", "minimal_response": True,
                "significant_changes_only": False, "limit": page, "offset": offset,
                "start_time": a.isoformat(), "end_time": b.isoformat()})
            ent = next(iter(body.get("entities") or []), {})
            return ent.get("states") or [], ent.get("has_more"), ent.get("next_offset")

        rows: list[dict] = []
        at, span, calls = start, history_first_slice(), 0
        min_span, max_span, max_calls = history_min_slice(), history_max_slice(), history_max_calls()
        while at < end and calls < max_calls:
            to = min(end, at + span)
            batch, more, _ = fetch(at, to)
            calls += 1
            if more and span > min_span:
                span /= 2                                 # too many readings in this slice: a shorter one, same start
                continue
            if more:                                      # a slice of minutes still holds more: its pages, as before
                batch, whole = paged(lambda off, a=at, b=to: fetch(a, b, off), page, max_pages=history_slice_pages())
                if not whole:                             # even its pages could not hold it: read no further
                    rows.extend(batch[1:] if rows and batch and batch[0].get("state") == rows[-1].get("state") else batch)
                    return rows, _when(rows[-1]) or at
            if rows and batch and batch[0].get("state") == rows[-1].get("state"):
                batch = batch[1:]                         # the carried-over state, stamped at the slice's start
            rows.extend(batch)
            at = to
            if len(batch) < page // 4:
                span = min(span * 2, max_span)
        return rows, (at if at < end else None)           # the call cap: nothing read after `at`

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

    def automation_configs(self, text):
        # ha-mcp's own search over the automations' configurations, then each one read whole; a search cut short says
        # has_more: read on (a list of critical devices missing its second rule would lose them in silence)
        ids, offset = [], 0
        while True:
            body = self.tool("ha_search", {"query": text, "fields": ["automations", "config_has_more",
                                                                     "config_next_offset"], "limit": 50,
                                           "offset": offset})
            ids += [a["entity_id"] for a in (body.get("automations") or []) if a.get("entity_id")]
            if not body.get("config_has_more") or body.get("config_next_offset") in (None, offset):
                break
            offset = body["config_next_offset"]
        out = []
        for eid in dict.fromkeys(ids):
            got = self.tool("ha_config_get_automation", {"identifier": eid})
            cfg = got.get("config") if isinstance(got, dict) else None
            if isinstance(cfg, dict):
                out.append(cfg)
        return out

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
                    "hidden_by": e.get("hidden_by"),
                })
        fa = self.tool("ha_list_floors_areas", {})
        areas = [a for f in fa.get("floors") or [] for a in f.get("areas") or []] + list(fa.get("unassigned_areas") or [])
        home = (states.get("zone.home") or {}).get("attributes") or {}
        return {"entities": entities, "devices": devices,
                "areas": [{"area_id": a.get("area_id"), "name": a.get("name"), "aliases": a.get("aliases") or []}
                          for a in areas],
                "config": {"time_zone": self.zone, "location_name": home.get("friendly_name")}}

    def logbook(self, start, end, entity_id=None):
        """Every logbook row in [start, end), oldest first (one entity's, or the whole villa's).

        ⚠️ THE WHOLE VILLA BY SLICES OF logbook_slice() (villa, 2026-10-15: an /investigate's `around` over a week ran
        minutes, a call every 15 s): ha-mcp fetches the WHOLE period from Home Assistant at every page, and a week of the
        villa's logbook is some thirty pages — thirty reads of the whole week. A slice is read in a page or two, each
        fetching its own hours only. One entity's logbook is filtered by Home Assistant itself: one read."""
        out, self.logbook_cut = self._logbook(start, end, entity_id)   # kept for a skill edited before logbook_read
        return out

    def logbook_read(self, start, end, entity_id=None, now=None):
        end = until(end, now)
        if end <= start:
            return Logbook([], start, start)
        rows, cut = self._logbook(start, end, entity_id)  # the cut carried with the rows, not left on the client
        return Logbook(rows, start, end, cut, self.kept_from(now))

    def _logbook(self, start, end, entity_id=None) -> tuple[list[dict], datetime | None]:
        """(every row of [start, end), where the reading stopped before `end` — None when it read to the end)."""
        cut = None
        out, seen, at = [], set(), start
        step = (end - start) if entity_id else logbook_slice()
        while at < end:
            to = min(end, at + step)
            rows, whole, last = self._logbook_slice(at, to, entity_id)
            for r in rows:
                key = json.dumps(r, sort_keys=True, default=str)
                if key not in seen:
                    seen.add(key)
                    out.append(r)
            if not whole:
                cut = last                        # stopped before its end: a reader says where
                break
            at = to
        return out, cut

    def _logbook_slice(self, start, end, entity_id=None):
        """([start, end)'s rows, whether the read reached its end, the last moment read)."""
        # ⚠️ hours_back COUNTS BACK FROM end_time, not from now (ha-mcp: "24 hours back from <end_time>"). Counted from
        # now, one day two days ago read 67 hours of logbook in 24 pages, 75 s (investigate, 2026-10-11) — and a period
        # far enough back would end at the 20-page cap before reaching its own end.
        span = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()
        hours = max(1, -int(-span // 3600))
        # ⚠️ A PAGE MUST BRING NEW ROWS. ha-mcp 8.5.0 answered the same first page to every offset
        # (seen on the villa: one 3-day read became 20 identical calls, and every flip of a
        # device was counted 20 times by the reconnect check). Rows are kept once each, and the
        # reading stops at the first page that adds nothing.
        page = limit("logbook.page_rows", 1000, unit="lines", group="read", lo=100, hi=1000,
                     says="Logbook lines a skill asks for in one page (the villa's system gives 500 at most).",
                     reached="The skill reads the next page.", told="")

        def fetch(offset):
            args = {"source": "logbook", "hours_back": hours, "end_time": end.astimezone(timezone.utc).isoformat(),
                    "limit": page, "offset": offset, "order": "oldest"}
            if entity_id:
                args["entity_id"] = entity_id
            body = self.tool("ha_get_logs", args)
            return body.get("entries") or [], body.get("has_more"), None
        # ⚠️ PAGES UNTIL THE END (2026-10-13): 20 pages of ha-mcp's 500 rows read 10,000 of a 3-day logbook's 13,031.
        # 200 pages is 100,000 rows; a read stopped before the end says where (logbook_cut).
        rows, whole = paged(fetch, page, max_pages=limit(
            "logbook.max_pages", 200, unit="pages", group="read", lo=1, hi=2000,
            says="Pages of logbook a skill reads for one stretch of time (200 pages are 100,000 lines).",
            reached="The reading stops there and says how far it got.", told="person"))
        out, last = [], start
        for r in rows:
            try:
                t = datetime.fromisoformat(r["when"])
            except (KeyError, ValueError):
                continue
            last = max(last, t)
            if start <= t < end:
                out.append(r)
        return out, whole, last

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

    # ------------------------------------------------------------------ templates (read)
    def template(self, text):
        """Home Assistant renders `text` now (ha_eval_template: read-only, it acts on nothing). A failed render raises."""
        body = self.tool("ha_eval_template", {"template": str(text), "timeout": 10})
        if not isinstance(body, dict) or "result" not in body:
            raise HAError(f"ha_eval_template gave no result: {str(body)[:error_short_chars()]}")
        return str(body["result"])


def client_from_args(args) -> HABase:
    """Every script accepts --fixture-dir (offline tests); otherwise the villa through ha-mcp, read-only."""
    if getattr(args, "fixture_dir", None):
        try:
            from fixture_client import FixtureClient   # the tests' own (tests/ on PYTHONPATH): not in the app
        except ImportError:
            raise SystemExit("--fixture-dir is for the agent's tests only") from None
        return FixtureClient(args.fixture_dir, zone=getattr(args, "zone", None) or "UTC")
    return McpClient(zone=getattr(args, "zone", None))


def window(days: int, end: datetime | None = None) -> tuple[datetime, datetime]:
    end = end or datetime.now(timezone.utc)
    return end - timedelta(days=days), end
