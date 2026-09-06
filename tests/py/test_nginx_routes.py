"""Every proxy route must be reachable through nginx.

⚠️ THE FAILURE THIS PREVENTS RETURNS HTTP 200. `nginx.conf` is an explicit
per-endpoint allowlist, and its final `location /` serves the SPA. So a backend
route with no `location` block is not a 404 — it is answered with index.html,
status 200, Content-Type text/html. The caller gets a JSON parse error whose
text mentions `<!doctype`, which points at the client, at the build, at
anything except the missing four lines in a config file the author never
opened.

Found exactly that way: Phase 0 added four routes to `supervisor-proxy.py`,
every handler test passed, the add-on booted clean, and not one of the four was
reachable from a browser.

This is the /dry-audit rule in test form — roll a rule out by what it APPLIES
to, not by its existing call sites. The applicable set is "routes registered in
main()"; the call sites are "location blocks in nginx.conf"; the bug is the
difference. Nothing but this test connects the two files.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Set, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY_PATH = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
NGINX_PATH = os.path.join(REPO_ROOT, "rootfs", "etc", "nginx", "nginx.conf")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _routes() -> List[str]:
    """Every path registered on the aiohttp router.

    Strips aiohttp's `{name:pattern}` placeholders down to the static prefix,
    since that is all nginx matches on anyway.
    """
    found: List[str] = []
    for match in re.finditer(
        r'app\.router\.add_(?:get|put|post|delete|route)\(\s*(?:"[A-Z*]+"\s*,\s*)?"([^"]+)"',
        _read(PROXY_PATH),
    ):
        path = match.group(1)
        path = path.split("{", 1)[0]
        found.append(path)
    # ⚠️ THE AGENT'S ROUTES REGISTER THROUGH ITS OWN TABLE SINCE TASK-115 STEP
    # 6 — `supervise/api.routes()` returns `web.get/post/put(...)` entries and
    # the proxy mounts the table in one call, so the add_* regex above cannot
    # see them. Parsed from the api file with the table's own idiom; the
    # vacuous-pass guard below (>=15 routes, known names present) covers this
    # half too, so a reformat of EITHER file fails loudly.
    api_path = PROXY_PATH.replace("supervisor-proxy.py",
                                  os.path.join("vesta", "supervise", "api.py"))
    for match in re.finditer(r'web\.(?:get|post|put|delete)\("([^"]+)"',
                             _read(api_path)):
        found.append(match.group(1).split("{", 1)[0])
    return found


def _locations() -> Tuple[Set[str], Set[str]]:
    """(exact, prefix) location paths declared in nginx.conf."""
    exact: Set[str] = set()
    prefix: Set[str] = set()
    for match in re.finditer(r"^\s*location\s+(=\s*)?([^\s{]+)\s*\{", _read(NGINX_PATH),
                             re.MULTILINE):
        if match.group(1):
            exact.add(match.group(2))
        else:
            prefix.add(match.group(2))
    return exact, prefix


#: ⚠️ ROUTES THAT MUST **NOT** HAVE AN NGINX LOCATION — the inverse of what the
#: rest of this module checks, and each one is a security requirement rather
#: than an oversight. nginx is the explicit allow-list in front of Ingress, so a
#: route with no block is unreachable from the tablet, from a phone, and from
#: anything Home Assistant proxies. Adding a `location /agent-mcp` would fix a
#: test that is not failing and open a tool surface to every browser.
NOT_INGRESS_REACHABLE: Set[str] = {"/agent-mcp"}


def _reachable(path: str, exact: Set[str], prefix: Set[str]) -> bool:
    if path in exact:
        return True
    # "/" is the SPA catch-all and is deliberately NOT accepted as coverage —
    # being caught by it IS the bug this module exists to find.
    return any(path.startswith(p) for p in prefix if p != "/")


def test_the_parser_finds_the_known_routes() -> None:
    """Guard against a vacuous pass.

    If the regex stops matching — a reformat, a helper wrapping add_get — every
    assertion below passes over an empty list. These four have been routed since
    long before this test and are stable enough to anchor it.
    """
    routes = _routes()
    assert len(routes) >= 15, f"only {len(routes)} routes parsed; the regex is stale"
    for known in ("/device-config", "/fm-data", "/telemetry", "/addon-config"):
        assert known in routes, f"{known} not parsed from the router"


def test_the_parser_finds_the_known_locations() -> None:
    exact, prefix = _locations()
    assert "/device-config" in exact
    assert "/auth/" in prefix
    assert "/" in prefix, "the SPA catch-all should still exist"


def test_the_MCP_route_is_deliberately_UNREACHABLE_through_nginx() -> None:
    """REQ-046, TEST-018. The assertion runs in the opposite direction.

    ⚠️ AND IT ASSERTS THE ROUTE EXISTS FIRST. Without that, deleting
    `/agent-mcp` from the proxy entirely would make this test pass — a vacuous
    green on the one check that stands between a tool surface and the LAN.
    """
    routes = _routes()
    exact, prefix = _locations()
    for path in NOT_INGRESS_REACHABLE:
        assert path in routes, (
            f"{path} is not registered on the proxy at all; this test would "
            f"pass vacuously")
        assert not _reachable(path, exact, prefix), (
            f"{path} has an nginx location and is therefore Ingress-reachable")


def test_every_route_is_reachable_through_nginx() -> None:
    exact, prefix = _locations()
    unreachable = sorted({r for r in _routes()
                          if r not in NOT_INGRESS_REACHABLE
                          and not _reachable(r, exact, prefix)})
    assert not unreachable, (
        "these proxy routes have no nginx location and would be answered with "
        f"the SPA's index.html (HTTP 200, text/html): {unreachable}\n"
        "Add a location block to rootfs/etc/nginx/nginx.conf."
    )


def test_the_reports_routes_specifically() -> None:
    """Named explicitly because they are the ones this test was written for."""
    exact, prefix = _locations()
    for path in ("/reports-config", "/reports-history", "/reports-diagnostics"):
        assert _reachable(path, exact, prefix), f"{path} is not routed by nginx"


def test_the_check_can_fail() -> None:
    """Prove the matcher rejects something, so a bug in `_reachable` that
    returned True for everything would surface here rather than as a silent
    all-clear on every future route."""
    exact, prefix = _locations()
    assert not _reachable("/definitely-not-routed", exact, prefix)


#: nginx locations that are answered BY nginx, not proxied to the backend.
#: ⚠️ EACH IS A DECISION WITH A REASON, not a suppression list — the same
#: discipline `test_route_has_a_client.EXEMPT` uses.
SERVED_BY_NGINX = {
    "/": "the app shell, from /var/www",
    "/assets/": "hashed static assets, from /var/www",
    "/model/": "the villa's GLB, from /data/www behind auth_request",
    "/auth/check": "the internal auth subrequest, never a client route",
}


def test_every_nginx_LOCATION_reaches_a_proxy_ROUTE() -> None:
    """⚠️ THE THIRD QUESTION, AND NOBODY ASKED IT (2.957.0).

    `test_nginx_routes` walks proxy -> nginx: is every route REACHABLE?
    `test_route_has_a_client` walks proxy -> src: does anything REACH it?
    Nothing walked nginx -> proxy, so `location = /scenes` outlived the store
    it fronted by months — the proxy's own comment says the store was removed
    because it "duplicated Home Assistant's own Scene Editor" — and Ingress
    went on publishing a passthrough that could only produce a 404.

    This file's own header calls the config "AN EXPLICIT ALLOWLIST, NOT A
    CATCH-ALL". An allowlist checked in one direction is a list.
    """
    exact, prefix = _locations()
    routes = set(_routes())
    orphans = []
    for path in sorted(exact | prefix):
        if path in SERVED_BY_NGINX:
            continue
        if path in routes:
            continue
        if any(r.startswith(path) for r in routes):
            continue
        orphans.append(path)
    assert not orphans, (
        "these nginx locations proxy to nothing — Ingress publishes a path the "
        "backend does not answer: %s.\nEither delete the block or add it to "
        "SERVED_BY_NGINX with the reason nginx answers it itself." % orphans)


def test_the_nginx_exemptions_do_not_rot() -> None:
    """A named exemption whose location is gone is a stale decision."""
    exact, prefix = _locations()
    declared = exact | prefix
    stale = sorted(p for p in SERVED_BY_NGINX if p not in declared)
    assert not stale, (
        "SERVED_BY_NGINX names locations that no longer exist: %s" % stale)


def _location_bodies() -> Dict[str, str]:
    """`location` head -> its block body. ⚠️ ONE PARSER, because two tests ask
    the same question of it and a second copy would drift."""
    text = _read(NGINX_PATH)
    bodies: Dict[str, str] = {}
    for block in re.split(r"^\s*location\s+", text, flags=re.MULTILINE)[1:]:
        head = block.split("{", 1)[0].strip().replace("= ", "")
        body = block.split("{", 1)[1] if "{" in block else ""
        bodies[head] = body.split("\n    }", 1)[0]
    return bodies


#: Locations that set their own `add_header` and deliberately do NOT include
#: the shared snippet. ⚠️ A DECISION PER ENTRY, like every other exemption map
#: in this suite — and EMPTY, because every location that sets a header today
#: includes the snippet back.
#:
#: ⚠️ THIS HELD `"/"` FOR ONE RELEASE (2.959.0) AND THAT ENTRY WAS A HOLE, not
#: a decision: `location /` includes the snippet, so it passed without any
#: exemption, while the exemption made it UNCHECKABLE. Deleting the include
#: from the app shell — no nosniff, no Referrer-Policy, no X-Frame-Options, no
#: Permissions-Policy, no HSTS on every page load — left this suite green.
#: `test_the_own_header_exemptions_are_necessary` now refuses that shape.
OWN_HEADERS: Dict[str, str] = {}


def test_every_location_that_sets_ANY_add_header_includes_the_shared_set() -> None:
    """⚠️ nginx DOES NOT MERGE `add_header` ACROSS LEVELS, so a location that
    sets ITS OWN suppresses every server-level header.

    ⚠️ THIS CHECKED `add_header Cache-Control` UNTIL 2.959.0, which is what the
    three known offenders happened to have — the rule rolled out at the sites
    where it was found rather than across what it applies to, which is the
    defect this suite is full of guards against. The day a location added
    `add_header X-Request-Id` it would have lost nosniff, Referrer-Policy,
    X-Frame-Options, Permissions-Policy and HSTS, silently, with this green.
    """
    missing = [head for head, body in _location_bodies().items()
               if "add_header" in body                 # else inherits cleanly
               and head not in OWN_HEADERS
               and "security-headers.conf" not in body]
    assert not missing, (
        "these locations set their own add_header — which suppresses ALL of "
        "the server-level security headers — without including them back: %s.\n"
        "Add the include, or name the location in OWN_HEADERS with its reason."
        % missing)


def test_the_own_header_exemptions_do_not_rot() -> None:
    text = _read(NGINX_PATH)
    heads = {m.group(1).replace("= ", "").strip()
             for m in re.finditer(r"^\s*location\s+([^{]+)\{", text, re.MULTILINE)}
    stale = sorted(h for h in OWN_HEADERS if h not in heads)
    assert not stale, "OWN_HEADERS names locations that no longer exist: %s" % stale


def test_the_own_header_exemptions_are_necessary() -> None:
    """⚠️ AN EXEMPTION FOR A LOCATION THAT WOULD PASS ANYWAY IS A HOLE.

    It costs nothing today and silently swallows the failure the day someone
    deletes the include — which is exactly what `"/"` did in 2.959.0. Mirrors
    `now_gated` in the RBAC suite: an exemption has to be earning its keep.
    """
    unnecessary = sorted(h for h, body in _location_bodies().items()
                         if h in OWN_HEADERS and "security-headers.conf" in body)
    assert not unnecessary, (
        "these locations are named in OWN_HEADERS but already include the "
        "shared snippet, so the exemption is not a decision — it is a hole "
        "that stops the include check ever running on them: %s.\n"
        "Delete the entry." % unnecessary)
