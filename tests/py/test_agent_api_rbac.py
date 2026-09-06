"""The agent's HTTP surface, executed rather than read.

⚠️ 1,090 LINES AND 19 HANDLERS, AND EVERY CLAIM ABOUT THEM WAS A SUBSTRING READ.
`supervise/api.py`'s header cites its evidence — "The security suite (270
checks) runs against the mounted result, which is what makes this move
auditable" — and that suite is `tests/security_test.py`, which `git ls-files`
does not know: it is gitignored, absent on a fresh clone, and absent from
`.github/workflows/ci.yaml`.

So what CI held about these handlers was assertions of this shape:

    body = source[source.index("async def agent_concerns_shaped_handler"):]
    assert "available_for" in body

which cannot see a guard, an ordering, or a refusal — the three things an RBAC
rule is made of.

⚠️ `bind()` IS ALREADY AN INJECTION SEAM, which is what makes this cheap: the
handlers take their auth through `deps.authorized` / `deps.role_for`, so a test
binds its own and needs no proxy at all. One adapter is a hypothetical seam;
this is the second, and it also proves the export the owner reserved works.
"""

from __future__ import annotations

import asyncio
import os
import sys
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

from conftest import REPO_ROOT

from vesta.supervise import api as agent_api


class FakeRequest:
    """Enough of a `web.Request` for these handlers."""

    def __init__(self, body: Optional[Dict[str, Any]] = None,
                 app: Optional[Dict[str, Any]] = None) -> None:
        self._body = body
        self.headers: Dict[str, str] = {}
        self.query: Dict[str, str] = {}
        self.match_info: Dict[str, str] = {}
        self.remote = "127.0.0.1"
        self.app: Dict[str, Any] = app if app is not None else {"session": None}

    async def json(self) -> Any:
        if self._body is None:
            raise ValueError("no body")
        return self._body


def _bind(role: str, *, authorized: bool = True,
          config: Optional[Dict[str, Any]] = None) -> List[str]:
    """Bind the surface to a fake host. Returns the refusal log."""
    refusals: List[str] = []

    def unauthorized() -> Any:
        refusals.append("unauthorized")
        return SimpleNamespace(status=401)

    def forbidden(message: str = "") -> Any:
        refusals.append("forbidden:%s" % message)
        return SimpleNamespace(status=403)

    agent_api.bind(
        authorized=lambda request: authorized,
        unauthorized=unauthorized,
        forbidden=forbidden,
        role_for=lambda request: role,
        config_now=lambda: dict(config or {"enabled": True}),
        config_get=lambda request: None,
        config_put=lambda request: None,
        concerns_get=lambda request: None,
    )
    return refusals


def _handlers() -> Dict[str, Any]:
    """Every handler the table mounts, by `METHOD path`.

    ⚠️ KEYED ON THE PAIR, NOT THE PATH. Five paths carry a GET and a PUT/POST —
    `/agent-config`, `/agent-flag-types`, `/agent-review`, `/agent-queue`,
    `/agent-memory` — which is correct REST and not a double mount. I keyed on
    path alone first and the test reported those five as duplicates.
    """
    return {"%s %s" % (route.method, route.path): route.handler
            for route in agent_api.routes()}


#: Handlers the host injects rather than defines — `/agent-config` and
#: `/agent-concerns` come from the proxy's `_json_store_handlers` factory, which
#: `test_reports_endpoints` drives against the real thing. A stub bound here
#: proves nothing about them.
INJECTED = ("/agent-config", "/agent-concerns")

#: ⚠️ `/agent-mcp` AUTHENTICATES ITSELF, and that is a decision with a reason.
#: `mcp_server.http_handler` compares a bearer token and answers 401 with no
#: detail, because "token not configured" and "wrong token" must not be
#: distinguishable. It never reaches `deps.authorized`.
OWN_AUTH = ("/agent-mcp",)


# ── the seam itself ─────────────────────────────────────────────────────────

def test_routes_refuses_before_bind_has_run():
    """⚠️ THE ORDERING CONSTRAINT THE HEADER CALLS LOAD-BEARING. `routes()`
    raises if `bind()` has not run — a substring pin cannot check that."""
    saved = agent_api.deps
    agent_api.deps = None                                   # type: ignore[assignment]
    try:
        with pytest.raises(Exception):
            agent_api.routes()
    finally:
        agent_api.deps = saved


def test_the_table_mounts_every_handler_once():
    _bind("owner")
    pairs = ["%s %s" % (r.method, r.path) for r in agent_api.routes()]
    assert len(pairs) == len(set(pairs)), (
        "a method+path is mounted twice: %s" % pairs)
    assert len(pairs) >= 19, "the agent surface shrank unexpectedly: %d" % len(pairs)


# ── authorisation, executed ────────────────────────────────────────────────

def test_an_UNAUTHENTICATED_caller_is_refused_by_every_handler():
    """⚠️ EVERY ONE, NOT A SAMPLE. A handler that forgot its guard is exactly
    what a per-handler substring read cannot find."""
    refusals = _bind("owner", authorized=False)
    served = []
    for key, handler in _handlers().items():
        path = key.split(" ", 1)[1]
        if path in INJECTED or path in OWN_AUTH:
            continue
        refusals.clear()
        try:
            asyncio.run(handler(FakeRequest()))
        except Exception:
            # A handler that got past the guard and then failed on its own
            # missing inputs is still a handler that got past the guard.
            pass
        if not refusals:
            served.append(key)
    assert not served, (
        "these handlers answered an unauthenticated caller: %s" % served)


def test_the_owner_only_routes_refuse_a_facility_role():
    """The asymmetry `/agent-runs`' deleted sibling documented: some of this
    surface is readable by any session, some is the owner's alone."""
    refusals = _bind("ops")
    handlers = _handlers()
    owner_only = [k for k in handlers if "audit" in k or "queue" in k]
    assert owner_only, "no owner-only route found — the scan is blind"
    for key in owner_only:
        refusals.clear()
        try:
            asyncio.run(handlers[key](FakeRequest()))
        except Exception:
            pass
        assert any(r.startswith("forbidden") for r in refusals), (
            "%s served a non-owner role" % key)


def test_the_role_is_never_taken_from_anything_the_caller_can_assert():
    """⚠️ THE PROPERTY THE WHOLE AUTH MODEL RESTS ON. The role comes from
    `deps.role_for`, which reads a signed cookie — never a header, never the
    body, never a query parameter."""
    from conftest import code_of

    code = code_of(agent_api)
    for source in ('request.headers.get("X-', "request.query.get(\"role",
                   'body.get("role")'):
        assert source not in code, (
            "the agent surface reads the role from %s, which a caller controls"
            % source)


def test_bind_takes_a_config_SOURCE_not_a_path():
    """Pins the direction 2.943.0 fixed: `_Deps` names no filesystem."""
    from conftest import code_of

    code = code_of(agent_api)
    assert "agent_config_file" not in code and "read_json_store" not in code
    assert "config_now" in code
