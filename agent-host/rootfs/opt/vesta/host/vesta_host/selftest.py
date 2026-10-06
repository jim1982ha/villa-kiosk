"""The self-test: one check per link, each `pass`, `fail` or `skipped` (SPEC 11).

It reads only the environment contract (plus the host-side state), so it tests
exactly what the agent will be given — not the options it was derived from.

⚠️ SKIPPED IS NOT FAIL, AND NEITHER IS PASS. A missing credential or a remote
interface that does not exist yet is `skipped` with its reason, never `fail`
(SPEC 11) — and never `pass` either: the VESTA Kiosk answers ANY unknown path
with its web page and HTTP 200 (nginx `try_files … /index.html`), so a check
that trusted the status code alone would report the agent interface working
on a Kiosk that has none.

⚠️ NEVER getUpdates. The Telegram check is `getMe`, and only when
telegram_takeover is on (SPEC H5): getUpdates would take the bot's button
presses away from Home Assistant.
"""
from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Callable
from urllib.parse import urlsplit
from . import kiosk_contract
from .host_state import HostState

TIMEOUT = 10
ANTHROPIC_MODELS = "https://api.anthropic.com/v1/models?limit=1"
TELEGRAM_API = "https://api.telegram.org"
MCP_PROTOCOL = "2025-06-18"

PASS, FAIL, SKIPPED = "pass", "fail", "skipped"


@dataclass
class Result:
    link: str
    result: str
    detail: str


class HttpResult:
    def __init__(self, status: int, body: bytes, headers: dict[str, str]) -> None:
        self.status, self.body, self.headers = status, body, headers

    def json(self) -> object | None:
        if "json" not in self.headers.get("content-type", ""):
            return None
        try:
            return json.loads(self.body)
        except ValueError:
            return None


def http(method: str, url: str, headers: dict[str, str] | None = None,
         body: object | None = None) -> HttpResult:
    """One request; an HTTP error status is a result, not an exception."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return HttpResult(r.status, r.read(), {k.lower(): v for k, v in r.headers.items()})
    except urllib.error.HTTPError as e:
        return HttpResult(e.code, e.read() or b"", {k.lower(): v for k, v in e.headers.items()})


def unreachable(exc: BaseException) -> str:
    # The reason only — never the URL, which for Telegram contains the token.
    reason = getattr(exc, "reason", exc)
    return f"unreachable ({type(exc).__name__}: {reason})"


class Checks:
    def __init__(self, env: dict[str, str], client_version: str = "dev",
                 sidecar_reason: str | None = None, anthropic_url: str | None = None) -> None:
        self.env = env
        self.sidecar_reason = sidecar_reason   # None = the sidecar is meant to run
        self.anthropic_url = anthropic_url     # the container test's fake Anthropic only (HostState)
        self.client_version = client_version

    def cf(self) -> dict[str, str]:
        """Cloudflare Access service token, when running outside the villa."""
        cid = self.env.get("VESTA_CF_ACCESS_CLIENT_ID")
        sec = self.env.get("VESTA_CF_ACCESS_CLIENT_SECRET")
        return {"CF-Access-Client-Id": cid, "CF-Access-Client-Secret": sec} if cid and sec else {}

    # ── Home Assistant ────────────────────────────────────────────────────
    def home_assistant(self) -> Result:
        link, token = "Home Assistant", self.env.get("VESTA_HA_TOKEN")
        if not token:
            return Result(link, SKIPPED, "ha_token not set")
        url = self.env["VESTA_HA_URL"].rstrip("/") + "/api/"
        try:
            r = http("GET", url, {"Authorization": f"Bearer {token}", **self.cf()})
        except OSError as e:
            return Result(link, FAIL, unreachable(e))
        if r.status == 200:
            return Result(link, PASS, "HTTP 200")
        if r.status == 401:
            return Result(link, FAIL, "token rejected (HTTP 401)")
        return Result(link, FAIL, f"HTTP {r.status}")

    # ── HA MCP ────────────────────────────────────────────────────────────
    def ha_mcp(self) -> Result:
        link, url = "HA MCP", self.env.get("VESTA_HA_MCP_URL", "")
        if not url:
            return Result(link, SKIPPED, "no HA MCP address in the environment")
        if self.sidecar_reason:
            return Result(link, SKIPPED, f"HA MCP sidecar not started: {self.sidecar_reason}")
        u = urlsplit(url)
        try:
            socket.create_connection((u.hostname, u.port), timeout=2).close()
        except OSError:
            # Meant to run and not listening: broken, not missing.
            return Result(link, FAIL, "HA MCP sidecar not answering")
        return mcp_handshake(link, url, self.cf(), self.client_version)

    # ── VESTA Kiosk ───────────────────────────────────────────────────────
    def kiosk(self) -> Result:
        link, token = "VESTA Kiosk", self.env.get("VESTA_KIOSK_TOKEN")
        if not token:
            return Result(link, SKIPPED, "kiosk_agent_token not set")
        url = self.env["VESTA_KIOSK_URL"].rstrip("/") + "/agent/v1/info"
        try:
            r = http("GET", url, {"Authorization": f"Bearer {token}", **self.cf()})
        except OSError as e:
            return Result(link, FAIL, unreachable(e))
        missing = interface_missing(r)
        if missing:
            return Result(link, SKIPPED, missing)
        if r.status == 401:
            return Result(link, FAIL, "token rejected (HTTP 401)")
        if r.status != 200:
            return Result(link, FAIL, f"HTTP {r.status}")
        info = r.json()
        # The version the agreement names (kiosk_contract — a copy of the
        # Kiosk's own file, compared by the tests), not a literal typed here.
        contract = info.get("contract") if isinstance(info, dict) else None
        if str(contract) != str(kiosk_contract.VERSION):
            return Result(link, FAIL, f"agent interface contract {contract!r}, expected {kiosk_contract.VERSION}")
        version = info.get("version", "?") if isinstance(info, dict) else "?"
        return Result(link, PASS, f"contract {kiosk_contract.VERSION}, VESTA Kiosk {version}")

    # ── Anthropic ─────────────────────────────────────────────────────────
    def anthropic(self) -> Result:
        link, key = "Anthropic", self.env.get("ANTHROPIC_API_KEY")
        if not key:
            return Result(link, SKIPPED, "anthropic_api_key not set")
        try:
            r = http("GET", self.anthropic_url or ANTHROPIC_MODELS,
                     {"x-api-key": key, "anthropic-version": "2023-06-01"})
        except OSError as e:
            return Result(link, FAIL, unreachable(e))
        if r.status == 200:
            return Result(link, PASS, "HTTP 200, models listed")
        if r.status == 401:
            return Result(link, FAIL, "key rejected (HTTP 401)")
        return Result(link, FAIL, f"HTTP {r.status}")

    # ── Telegram ──────────────────────────────────────────────────────────
    def telegram(self) -> Result:
        link = "Telegram"
        if self.env.get("VESTA_TELEGRAM_ENABLED") != "true":
            return Result(link, SKIPPED, "telegram_takeover is off — no call made")
        token = self.env.get("VESTA_TELEGRAM_BOT_TOKEN")
        if not token:
            return Result(link, SKIPPED, "telegram_bot_token not set")
        try:
            r = http("GET", f"{TELEGRAM_API}/bot{token}/getMe")
        except OSError as e:
            return Result(link, FAIL, unreachable(e))
        body = r.json()
        if r.status == 200 and isinstance(body, dict) and body.get("ok") is True:
            user = (body.get("result") or {}).get("username", "?")
            return Result(link, PASS, f"getMe ok (@{user})")
        return Result(link, FAIL, f"getMe HTTP {r.status}")

    def all(self) -> list[Callable[[], Result]]:
        return [self.home_assistant, self.ha_mcp, self.kiosk, self.anthropic, self.telegram]


def interface_missing(r: HttpResult) -> str | None:
    """The VESTA Kiosk agent interface v1 does not exist on this Kiosk: a 404
    (agent_token empty, PLAN A2) or its web page instead of JSON."""
    if r.status == 404:
        return "agent interface not available on this VESTA Kiosk (HTTP 404)"
    if r.status == 200 and r.json() is None:
        return "agent interface not available on this VESTA Kiosk (web page, not JSON)"
    return None


def _mcp_messages(r: HttpResult) -> list[dict]:
    """A streamable-HTTP MCP reply is either one JSON body or an SSE stream."""
    ctype = r.headers.get("content-type", "")
    text = r.body.decode("utf-8", "replace")
    if "text/event-stream" in ctype:
        out = []
        for line in text.splitlines():
            if line.startswith("data:"):
                try:
                    out.append(json.loads(line[5:].strip()))
                except ValueError:
                    pass
        return out
    try:
        msg = json.loads(text)
    except ValueError:
        return []
    return msg if isinstance(msg, list) else [msg]


def _mcp_result(r: HttpResult, rpc_id: int) -> dict | None:
    for m in _mcp_messages(r):
        if isinstance(m, dict) and m.get("id") == rpc_id:
            return m.get("result") if "result" in m else {"__error__": m.get("error")}
    return None


def mcp_handshake(link: str, url: str, headers: dict[str, str], version: str) -> Result:
    """initialize → notifications/initialized → tools/list (MCP streamable HTTP)."""
    base = {"Accept": "application/json, text/event-stream", **headers}
    try:
        r = http("POST", url, base, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": MCP_PROTOCOL, "capabilities": {},
                       "clientInfo": {"name": "vesta-selftest", "version": version}}})
        if r.status != 200:
            return Result(link, FAIL, f"initialize HTTP {r.status}")
        init = _mcp_result(r, 1)
        if not init or "__error__" in init:
            return Result(link, FAIL, "initialize returned no result")
        server = init.get("serverInfo") or {}
        who = f"{server.get('name', '?')} {server.get('version', '?')}"
        h = dict(base)
        if r.headers.get("mcp-session-id"):
            h["Mcp-Session-Id"] = r.headers["mcp-session-id"]
        h["MCP-Protocol-Version"] = str(init.get("protocolVersion", MCP_PROTOCOL))
        http("POST", url, h, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        r = http("POST", url, h, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tools = (_mcp_result(r, 2) or {}).get("tools")
        if not isinstance(tools, list) or not tools:
            return Result(link, FAIL, f"{who}: no tools listed (HTTP {r.status})")
        return Result(link, PASS, f"{who}, {len(tools)} tools")
    except OSError as e:
        return Result(link, FAIL, unreachable(e))


def run(checks: Checks, only: tuple[str, ...] | None = None) -> list[Result]:
    results = []
    for check in checks.all():
        if only and check.__name__ not in only:
            continue
        try:
            results.append(check())
        except Exception as exc:  # one broken check must not hide the others
            results.append(Result(check.__name__, FAIL, f"check crashed ({type(exc).__name__})"))
    return results


def report(results: list[Result], host_version: str) -> dict:
    return {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "host_version": host_version,
        "results": [asdict(r) for r in results],
        "summary": {k: sum(r.result == k for r in results) for k in (PASS, FAIL, SKIPPED)},
    }


def execute(env: dict[str, str], host: "HostState | dict", only: tuple[str, ...] | None = None,
            write: bool = True) -> list[Result]:
    """Runs the checks, logs one line per link, writes /data/host/selftest.json."""
    from . import paths
    from .log import log

    h = HostState.of(host)
    checks = Checks(env, client_version=h.host_version, sidecar_reason=h.sidecar_reason, anthropic_url=h.anthropic_url)
    results = run(checks, only)
    for r in results:
        log("warning" if r.result == FAIL else "info",
            f"self-test {r.link}: {r.result} — {r.detail}")
    if write:
        paths.SELFTEST.parent.mkdir(parents=True, exist_ok=True)
        paths.SELFTEST.write_text(json.dumps(
            report(results, h.host_version), indent=2))
    return results
