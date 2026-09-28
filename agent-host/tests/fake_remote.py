#!/usr/bin/env python3
"""A fake of every remote end the self-test talks to — one HTTP server.

It plays Home Assistant (`/api/`), the VESTA Kiosk agent interface (with it,
without it = the Kiosk's web page, or 404), an MCP server (JSON or SSE
replies), Anthropic (`/v1/models`) and Telegram (`/bot<token>/getMe`), and
records every request so a test can assert on calls that did NOT happen.

⚠️ FAKE_REQUIRE_CF=1 MAKES IT CLOUDFLARE ACCESS: any request without the
service-token headers gets 403 — what a remote deployment meets in front of
the villa (PLAN 7). The standalone compose test runs it that way.

Imported by test_selftest.py; run on its own by the standalone compose test:
    python3 fake_remote.py 8080
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CF_ID, CF_SECRET = "cf-client-id.access", "cf-SECRET-123456"

HA_TOKEN, KIOSK_TOKEN, KEY, TG = "ha-TOKEN-123456", "kiosk-TOKEN-123456", "sk-ant-KEY-123456", "42:TG-TOKEN-123456"


class Fake(BaseHTTPRequestHandler):
    kiosk = "json"          # json | spa | 404
    #: The Kiosk's recorded button presses (the stub demo reads them back).
    choices: list = []
    mcp = "json"            # json | sse
    requests: list[tuple[str, str]] = []

    def log_message(self, *a):  # quiet
        pass

    def reply(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def auth(self, token):
        return self.headers.get("Authorization") == f"Bearer {token}"

    def cf_refused(self):
        if os.environ.get("FAKE_REQUIRE_CF") != "1":
            return False
        if (self.headers.get("CF-Access-Client-Id") == CF_ID
                and self.headers.get("CF-Access-Client-Secret") == CF_SECRET):
            return False
        self.reply(403, b"Forbidden by Cloudflare Access (fake)", "text/plain")
        return True

    def do_GET(self):
        Fake.requests.append(("GET", self.path))
        if self.cf_refused():
            return
        if self.path == "/api/":
            return self.reply(200, {"message": "API running."}) if self.auth(HA_TOKEN) \
                else self.reply(401, {"message": "Unauthorized"})
        if self.path == "/agent/v1/info":
            return self.kiosk_reply({"contract": 1, "version": "2.500.0"})
        if self.path.startswith("/v1/models"):
            return self.reply(200, {"data": [{"id": "claude"}]}) if self.headers.get("x-api-key") == KEY \
                else self.reply(401, {"error": "invalid x-api-key"})
        if self.path.startswith("/agent/v1/choices"):
            return self.kiosk_reply({"choices": Fake.choices, "next_seq": len(Fake.choices) + 1})
        if self.path.startswith(f"/bot{TG}/getMe"):
            return self.reply(200, {"ok": True, "result": {"username": "villa_bot"}})
        if self.path.startswith("/bot"):
            return self.reply(401, {"ok": False})
        self.reply(404, {})

    def kiosk_reply(self, ok_body):
        if Fake.kiosk == "404":
            return self.reply(404, b"Not Found", "text/plain")
        if Fake.kiosk == "spa":
            return self.reply(200, b"<!doctype html><html>VESTA</html>", "text/html")
        return self.reply(200, ok_body) if self.auth(KIOSK_TOKEN) else self.reply(401, {})

    def do_POST(self):
        Fake.requests.append(("POST", self.path))
        if self.cf_refused():
            return
        if self.path == "/agent/v1/heartbeat":
            self.body()
            return self.kiosk_reply({"ok": True})
        if self.path == "/agent/v1/messages":
            msg = self.body()
            if not msg.get("title") or not msg.get("buttons"):
                return self.reply(400, {"error": "bad message"})
            if Fake.kiosk != "json":
                return self.kiosk_reply({})
            if not self.auth(KIOSK_TOKEN):
                return self.reply(401, {})
            return self.reply(201, {"ok": True, "id": "msg_demo", "created_at": "2026-09-29T00:00:00Z"})
        if self.path == "/mcp":
            msg = self.body()
            if msg.get("method") == "initialize":
                return self.mcp_reply({"jsonrpc": "2.0", "id": msg["id"], "result": {
                    "protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake-ha-mcp", "version": "8.5.0"}}},
                    {"Mcp-Session-Id": "s1"})
            if msg.get("method") == "notifications/initialized":
                return self.reply(202, b"", "text/plain")
            if msg.get("method") == "tools/list":
                if self.headers.get("Mcp-Session-Id") != "s1":
                    return self.reply(400, {"error": "no session"})
                return self.mcp_reply({"jsonrpc": "2.0", "id": msg["id"],
                                       "result": {"tools": [{"name": "ha_search"}, {"name": "ha_get_state"}]}})
        self.reply(404, {})

    def mcp_reply(self, msg, headers=None):
        if Fake.mcp == "sse":
            return self.reply(200, f"event: message\ndata: {json.dumps(msg)}\n\n".encode(),
                              "text/event-stream", headers)
        return self.reply(200, msg, headers=headers)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"fake remote on :{port} (Cloudflare Access: {os.environ.get('FAKE_REQUIRE_CF') == '1'})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Fake).serve_forever()
