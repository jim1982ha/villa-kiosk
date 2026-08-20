"""The Ingress owner-shortcut, pinned.

⚠️ THIS IS THE BIGGEST SINGLE PRIVILEGE DECISION IN THE PROXY AND IT HAD NO
TEST. `grep -n ingress tests/security_test.py` returns nothing. Found during
Phase 1 QA, when a guest-profile write through Ingress succeeded and looked
exactly like a privilege hole:

    def _role_for(request):
        if _is_ingress(request):
            return "owner"
        return _session_role(request.cookies.get(SESSION_COOKIE)) or "guest"

It is CORRECT — reaching Ingress at all means Home Assistant authenticated the
browser, and the kiosk's guest/owner picker is a UI persona rather than a
security boundary on that path. But "correct and untested" is how a
one-character edit turns into a silent escalation, and the consequence of this
particular line being wrong is that anyone on the LAN gets owner.

Two properties, and the second is the one that actually protects the villa:

  1. Ingress  -> owner, whatever cookie is presented.
  2. NO ingress header -> the signed cookie decides, and nothing else.

Property 2 is what guards the direct hostname (port 8099), where there is no
Home Assistant in front and the cookie is the only evidence of who is calling.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any, Dict, Optional

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY_PATH = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")

pytest.importorskip("aiohttp", reason="proxy requires aiohttp")


def _load_proxy() -> Any:
    spec = importlib.util.spec_from_file_location("proxy_ingress", PROXY_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["proxy_ingress"] = module
    spec.loader.exec_module(module)
    return module


proxy = _load_proxy()

INGRESS_HEADER = "X-VK-Ingress"


class Req:
    def __init__(self, role: Optional[str] = None, ingress: bool = False,
                 forged_header: Optional[str] = None) -> None:
        self.cookies: Dict[str, str] = (
            {proxy.SESSION_COOKIE: proxy._make_session_token(role)} if role else {})
        self.headers: Dict[str, str] = {}
        if ingress:
            self.headers[INGRESS_HEADER] = "1"
        if forged_header is not None:
            self.headers[INGRESS_HEADER] = forged_header
        self.query: Dict[str, str] = {}
        self.remote = "127.0.0.1"


def test_ingress_is_owner_regardless_of_cookie() -> None:
    """Property 1. A guest cookie through Ingress is still owner — this is the
    behaviour that looks like a bug and is not."""
    for role in ("guest", "ops", "owner"):
        assert proxy._role_for(Req(role, ingress=True)) == "owner"


def test_ingress_is_owner_with_no_cookie_at_all() -> None:
    assert proxy._role_for(Req(None, ingress=True)) == "owner"


def test_ingress_authorizes_without_a_session() -> None:
    assert proxy._authorized(Req(None, ingress=True)) is True


def test_without_ingress_the_cookie_decides() -> None:
    """⚠️ PROPERTY 2 — the one that guards the direct hostname.

    On port 8099 there is no Home Assistant in front, so an escalation here
    reaches anyone on the villa's LAN.
    """
    for role in ("guest", "ops", "owner"):
        assert proxy._role_for(Req(role)) == role


def test_without_ingress_and_without_a_cookie_the_least_privilege_wins() -> None:
    """Defence in depth for a should-never-happen None: fail toward the LEAST
    privileged role rather than trusting one."""
    assert proxy._role_for(Req(None)) == "guest"
    assert proxy._authorized(Req(None)) is False


@pytest.mark.parametrize("forged", ["1 ", "true", "yes", "0", "", "2", "01"])
def test_only_the_exact_value_counts_as_ingress(forged: str) -> None:
    """nginx sets this header from the real source IP and OVERWRITES anything a
    client sent, so it cannot be forged from outside. That is the deployment's
    guarantee; this is the code's half of it — an exact match, so a loosened
    comparison (truthiness, prefix, case-insensitivity) cannot quietly turn a
    client-supplied string into owner."""
    assert proxy._is_ingress(Req("guest", forged_header=forged)) is False
    assert proxy._role_for(Req("guest", forged_header=forged)) == "guest"


def test_the_exact_value_does_count() -> None:
    """Guard against the test above passing vacuously because _is_ingress
    returns False for everything."""
    assert proxy._is_ingress(Req("guest", ingress=True)) is True
