"""Every proxy route must be reachable from something, or it is dead capability.

⚠️ THE SAME ROUTE HAS NOW LOST ITS CLIENT TWICE, AND NEITHER TIME DID ANYTHING
FAIL. `/agent-run-now` — the one control that runs a supervision pass without
waiting for the six-hourly clock — shipped under TASK-034 with nothing in the SPA
calling it, and stayed that way until 2.674.0 gave it a button on the Handover
page. Then 2.756.0 deleted that page, because the cutover argument it made had
been settled, and took the only caller with it. The route went on existing, the
handler went on being tested, `test_nginx_routes` went on confirming it was
reachable through nginx — and there was no way to press it.

The copy on the Triage tab still said "immediately from 'Check the villa now' on
the Handover tab" for twelve releases, naming a tab that was not there.

⚠️ WHY NO EXISTING PIN COULD SEE IT. `test_nginx_routes` asks whether a route is
REACHABLE; this asks whether anything REACHES it. `test_reachability` asks the
same question of Python functions and deliberately scans `agent/` only. The gap
between them is exactly one HTTP call in a language boundary — Python one side,
TypeScript the other, a string literal in each and nothing between them. That is
the same shape as `test_store_envelope` and `test_nginx_routes`, and the third
time this project has paid for it.

⚠️ THE EXEMPTIONS ARE DECISIONS, NOT A SUPPRESSION LIST. A route whose caller is
not a browser is normal here; a route whose caller is *nothing* is a feature the
owner cannot use. Every entry says which it is, and a stale entry fails.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
SRC = os.path.join(REPO_ROOT, "src")

#: route -> who calls it, if not the SPA. ⚠️ EVERY ENTRY NAMES A REAL CALLER.
#: "Nobody calls it yet" is not a reason that belongs here — that is the defect.
EXEMPT: Dict[str, str] = {
    "/agent-mcp": "another PROCESS, not a browser — a relocated agent or a "
                  "desktop client authenticating with a bearer token from the "
                  "0600 secrets file (ARCH-011). It has no SPA caller by design",
    "/auth/check": "nginx itself, as an `auth_request` subrequest — see the "
                   "`location = /auth/check` block in nginx.conf. A browser "
                   "never calls it directly and must not be able to",
    "/": "the SPA itself — the catch-all that serves index.html",
}


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _routes() -> List[str]:
    """Every path registered on the aiohttp router, placeholders stripped."""
    found: List[str] = []
    for match in re.finditer(
        r'app\.router\.add_(?:get|put|post|delete|route)\(\s*'
        r'(?:"[A-Z*]+"\s*,\s*)?"([^"]+)"',
        _read(PROXY),
    ):
        found.append(match.group(1).split("{", 1)[0].rstrip("/") or "/")
    # ⚠️ THE AGENT'S ROUTES LIVE IN supervise/api.py's table since TASK-115
    # step 6 — same addition as test_nginx_routes' parser, same reason. (Two
    # earlier attempts landed this block in _fetched_paths on bad anchors,
    # which marked every agent route as "called by the SPA"; the scan caught
    # itself both times — /agent-mcp read as called AND unregistered.)
    api_path = PROXY.replace("supervisor-proxy.py",
                             os.path.join("vesta", "supervise", "api.py"))
    with open(api_path, encoding="utf-8") as handle:
        api_src = handle.read()
    for match in re.finditer(r'web\.(?:get|post|put|delete)\("([^"]+)"', api_src):
        found.append(match.group(1).split("{", 1)[0])
    return sorted(set(found))


def _fetched_paths() -> Set[str]:
    """Every route string the SPA actually asks for.

    ⚠️ MATCHES THE ARGUMENT TO `ingressPath`, WHICH IS THE ONE WAY THIS APP
    BUILDS A BACKEND URL. A component that hand-rolled a URL would be invisible
    here — and would also be a bug, because it would break under the Home
    Assistant ingress prefix.
    """
    found: Set[str] = set()
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            src = _read(os.path.join(base, name))
            # comments stripped as BLOCKS then as lines: prose naming a route is
            # not a call to it, and six pins here have passed on their own text.
            src = re.sub(r"/\*[\s\S]*?\*/", "", src)
            src = "\n".join(l for l in src.splitlines()
                            if not l.strip().startswith("//"))
            # ⚠️ TWO BUILDERS, NOT ONE, AND MISSING THE SECOND COST FOUR FALSE
            # POSITIVES ON THIS TEST'S FIRST RUN. `ingressPath` serves the
            # add-on's own routes; `ingressApiBase`/`ingressWsUrl` reach Home
            # Assistant THROUGH the proxy and hard-code `core/api` and
            # `core/websocket` inside `ingress.ts`. A scan that knew only the
            # first indicted the two busiest routes in the app.
            # ⚠️ THREE BUILDERS SINCE 2026-08-28, AND MISSING THE THIRD MADE
            # THIS TEST REPORT TEN LIVE ROUTES AS ORPHANS. /dry-audit converged
            # nineteen copies of the JSON-write preamble onto `postJson` /
            # `putJson`, which call `ingressPath` INTERNALLY — so every write in
            # the app stopped matching a scan anchored on the old idiom, while
            # the vacuous-pass guard stayed green on the GETs that had not
            # moved. A pin anchored on an idiom must be updated WITH the idiom;
            # that is the standing cost of a convergence, and it is cheaper than
            # the duplication only if somebody pays it.
            for m in re.finditer(
                    r'(?:ingressPath|postJson|putJson)\(\s*[`"\']([^`"\'?]+)',
                    src):
                # ⚠️ TEMPLATE LITERALS TRUNCATED AT THE INTERPOLATION, and the
                # `$` goes with it. `ingressPath(`agent-usage${q}`)` captured
                # `agent-usage$`, which matches no route — a live route reported
                # as an orphan because of one character.
                found.add("/" + m.group(1).strip("/").split("{", 1)[0]
                          .rstrip("$"))
            if "ingressApiBase" in src or "ingressWsUrl" in src:
                found.update({"/core/api", "/core/websocket"})
    return found


def test_every_owner_facing_route_has_something_that_calls_it() -> None:
    """⚠️ THE DELIVERABLE. A route nothing calls is a capability the owner paid
    for, cannot reach, and has no way to discover is missing."""
    routes = _routes()
    assert routes, "the route scan found nothing; this test would be vacuous"
    called = _fetched_paths()
    assert called, "the fetch scan found nothing; this test would be vacuous"

    orphans = [r for r in routes if r not in called and r not in EXEMPT]
    assert not orphans, (
        "these proxy routes have no caller in src/ and no exemption: "
        f"{orphans}. Either give each a surface, or add it to EXEMPT naming "
        "the non-browser caller it has. 'Nothing calls it yet' is the defect, "
        "not an exemption")


def test_the_run_now_route_is_specifically_wired() -> None:
    """⚠️ NAMED, BECAUSE IT HAS BEEN ORPHANED TWICE. The general rule above
    would catch it, and a rule that has been broken twice by the same route
    earns a test that says the route's name out loud — so a future deletion
    fails with the history attached rather than as one entry in a list."""
    assert "/agent-run-now" in _fetched_paths(), (
        "nothing in the SPA calls /agent-run-now, so there is no way to run a "
        "supervision pass without waiting for the scheduled clock. This is the "
        "third time; see the module docstring")


def test_the_exemption_map_does_not_rot() -> None:
    """⚠️ A STALE EXEMPTION COVERS THE NEXT ORPHAN. Same rule, and the same
    wording, as `test_reachability`'s — an exemption for a route that is now
    called, or that no longer exists, silently widens the hole."""
    routes, called = set(_routes()), _fetched_paths()
    stale = sorted(r for r in EXEMPT
                   if r != "/" and (r not in routes or r in called))
    assert not stale, (
        f"EXEMPT names route(s) that are called or gone: {stale}. Remove them")


def test_no_component_hand_rolls_a_backend_url() -> None:
    """⚠️ WHAT WOULD MAKE THIS TEST BLIND. `ingressPath` is how this app builds
    a backend URL — it is also the only thing that works under the Home
    Assistant ingress prefix — so a bare `fetch("/agent-...")` would be both a
    routing bug and invisible to the scan above."""
    offenders: List[str] = []
    known = {r.lstrip("/").split("-")[0] for r in _routes() if len(r) > 1}
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(base, name)
            src = re.sub(r"/\*[\s\S]*?\*/", "", _read(path))
            src = "\n".join(l for l in src.splitlines()
                            if not l.strip().startswith("//"))
            for m in re.finditer(r'fetch\(\s*[`"\']/([a-z][a-z0-9-]*)', src):
                if m.group(1).split("-")[0] in known:
                    offenders.append(f"{os.path.relpath(path, REPO_ROOT)}: "
                                     f"/{m.group(1)}")
    assert not offenders, (
        f"these fetch a backend path directly instead of through ingressPath: "
        f"{offenders} — they break under the ingress prefix and are invisible "
        "to the orphan scan above")
