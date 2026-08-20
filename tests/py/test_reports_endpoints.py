"""The four reports endpoints, exercised through the REAL proxy handlers.

⚠️ RBAC IS ENFORCED SERVER-SIDE. `auth/permissions.ts` in the SPA is a
rendering convenience — a browser can send whatever it likes — so every rule
that matters lives in `supervisor-proxy.py`, and this file is the regression
suite for the reports half of it. `tests/security_test.py` remains the suite for
everything that came before; it is deliberately local-only, which is precisely
why the NEW boundary is pinned here instead: a guarantee CI never runs is a
guarantee that decays.

These load the proxy by file path, exactly as security_test.py does, so they
exercise the real handler chain — the role gate, the write guard, the revision
bump and the store factory's lock — rather than a re-implementation that would
agree with itself while the shipped code drifted.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
from typing import Any, Dict, Optional

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY_PATH = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")

# aiohttp is the proxy's one runtime dependency; without it there is nothing to
# test here. Skipped rather than failed so a contributor without it still gets a
# useful run — but CI installs it, so the gate is never silently absent there.
aiohttp = pytest.importorskip("aiohttp", reason="proxy requires aiohttp")


def _load_proxy() -> Any:
    spec = importlib.util.spec_from_file_location("proxy", PROXY_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["proxy"] = module
    spec.loader.exec_module(module)
    return module


proxy = _load_proxy()


class FakeRequest:
    """Enough of a web.Request for these handlers.

    They touch only the signed session cookie and the JSON body — the role is
    never taken from anything the caller can assert, which is the property the
    whole auth model rests on.
    """

    def __init__(self, role: str, body: Optional[Dict[str, Any]] = None) -> None:
        self._body = body
        self.cookies = {proxy.SESSION_COOKIE: proxy._make_session_token(role)}
        self.headers: Dict[str, str] = {}
        self.query: Dict[str, str] = {}
        self.remote = "127.0.0.1"

    async def json(self) -> Any:
        return self._body


@pytest.fixture()
def handlers(tmp_path: Any) -> Any:
    """Config store handlers bound to a throwaway file.

    Rebuilt rather than reusing the module-level pair because those captured
    `/data/reports-config.json` at import time — and a test that wrote there
    would be writing to the real add-on's store on a developer's machine.
    """
    path = str(tmp_path / "reports-config.json")
    return proxy._json_store_handlers(
        path, "config", {}, proxy.reports_store.REPORTS_CONFIG_MAX_BYTES,
        "reports configuration", write_guard=proxy._reports_config_guard)


def _body(response: Any) -> Any:
    return json.loads(response.body)


def test_empty_store_reads_as_empty(handlers: Any) -> None:
    """Nothing configured yet is `{}`, not a seeded document."""
    get_handler, _ = handlers
    response = asyncio.run(get_handler(FakeRequest("owner")))
    assert response.status == 200
    assert _body(response)["config"] == {}


def test_get_is_uncacheable(handlers: Any) -> None:
    """Explicit no-store: the direct/standalone hostname is exactly where a
    user-added reverse proxy or tunnel sits in front of this response, and none
    of those honour a policy the handler never stated."""
    get_handler, _ = handlers
    response = asyncio.run(get_handler(FakeRequest("owner")))
    assert response.headers.get("Cache-Control") == "no-store"


def test_owner_write_persists_and_advances_the_revision(handlers: Any) -> None:
    get_handler, put_handler = handlers
    before = _body(asyncio.run(get_handler(FakeRequest("owner"))))["rev"]
    config = {"enabled": True,
              "schedules": [{"id": "a", "cadence": "weekly", "hour": 7}]}
    assert asyncio.run(put_handler(FakeRequest("owner", {"config": config}))).status == 200
    after = _body(asyncio.run(get_handler(FakeRequest("owner"))))
    assert after["config"] == config
    assert after["rev"] != before, "revision did not advance; 409 concurrency is dead"


@pytest.mark.parametrize("role", ["guest", "ops"])
def test_non_owner_write_is_refused(handlers: Any, role: str) -> None:
    """A schedule decides who gets messaged and how often — not a guest's call.

    `ops` is included deliberately: it MAY write the facility-manager store, so
    "can write something" must not read as "can write this".
    """
    _, put_handler = handlers
    response = asyncio.run(put_handler(FakeRequest(role, {"config": {"enabled": True}})))
    assert response.status == 403


def test_a_refused_write_leaves_the_store_untouched(handlers: Any) -> None:
    get_handler, put_handler = handlers
    good = {"enabled": True}
    asyncio.run(put_handler(FakeRequest("owner", {"config": good})))
    asyncio.run(put_handler(FakeRequest("guest", {"config": {"enabled": False}})))
    assert _body(asyncio.run(get_handler(FakeRequest("owner"))))["config"] == good


def test_any_authorized_session_may_read(handlers: Any) -> None:
    """GET is open to every role, as with every other shared store."""
    get_handler, _ = handlers
    for role in ("owner", "ops", "guest"):
        assert asyncio.run(get_handler(FakeRequest(role))).status == 200


def test_invalid_config_is_refused_with_its_fields_named(handlers: Any) -> None:
    get_handler, put_handler = handlers
    bad = {"schedules": [{"cadence": "hourly", "hour": 99}]}
    response = asyncio.run(put_handler(FakeRequest("owner", {"config": bad})))
    assert response.status == 400
    problems = _body(response)["problems"]
    assert any("cadence" in p for p in problems)
    assert any("hour" in p for p in problems)
    assert _body(asyncio.run(get_handler(FakeRequest("owner"))))["config"] == {}


def test_diagnostics_is_owner_only() -> None:
    """It enumerates the property's instrumentation, which is a fair
    description of what the villa does and does not watch."""
    assert asyncio.run(proxy.reports_diagnostics_handler(FakeRequest("owner"))).status == 200
    for role in ("ops", "guest"):
        response = asyncio.run(proxy.reports_diagnostics_handler(FakeRequest(role)))
        assert response.status == 403


def test_diagnostics_declares_itself_a_stub() -> None:
    """`ready: false` is what separates "nothing is instrumented" — a real
    answer — from "not implemented yet". Conflating them is how a counter comes
    to read 0 for exactly the case it exists to measure."""
    payload = _body(asyncio.run(proxy.reports_diagnostics_handler(FakeRequest("owner"))))
    assert payload["ready"] is False
    assert payload["contract_version"] == proxy.reports_contracts.CONTRACT_VERSION


def test_history_is_not_writable_over_http() -> None:
    """History is the record of what was delivered. An endpoint letting a
    browser rewrite it would make it worthless as an audit of what was
    delivered — so the factory's PUT is built and deliberately not routed."""
    source = open(PROXY_PATH, encoding="utf-8").read()
    assert 'add_get("/reports-history"' in source
    assert 'add_put("/reports-history"' not in source


def test_all_four_routes_are_registered() -> None:
    source = open(PROXY_PATH, encoding="utf-8").read()
    for route in ('add_get("/reports-config"', 'add_put("/reports-config"',
                  'add_get("/reports-history"', 'add_get("/reports-diagnostics"'):
        assert route in source, f"route missing: {route}"
