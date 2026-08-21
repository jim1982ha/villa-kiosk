"""A `/data` store's envelope key is a contract between two files that never
meet, and the client can get it wrong in a way that half-fails.

⚠️ THIS COST A RELEASE, AND ONE HALF OF IT WAS SILENT FOR FIVE.
`_json_store_handlers(path, key, …)` takes the envelope key as an ARGUMENT, so
it is per-store: /device-config and /reports-config wrap their document in
`config`, /fm-data wraps its in `data`. `reportsApi.ts` was written from
`fmApi.ts` and inherited `data`. Two consequences, and only one of them was
visible:

  PUT  `body.get("config")` was None → 400, "config must be a dict".
       Loud, immediate, and reported by the owner within a day.
  GET  `d.data` was undefined → `parseReportsConfig(undefined)` returned every
       default → the Schedule tab rendered an empty configuration that is
       INDISTINGUISHABLE from a property nobody has set up yet.

The read path had been wrong since the tab shipped and nothing could tell,
because a config store's defaults are exactly what a healthy empty store looks
like. It was found only because the write failed on the same line.

⚠️ NO TYPE, NO TEST AND NO BUILD STEP CROSSES THIS BOUNDARY. Python on one
side, TypeScript on the other, a string literal in each, and nothing between
them — the same shape as `test_nginx_routes` (a route registered in the proxy
with no `location` block is answered with index.html at status 200). Both are
"adding an endpoint is two files"; this one is "using an endpoint is two files".

⚠️ READS SOURCE TEXT, and derives the store list from the PROXY rather than
listing it here. A hand-maintained list is a list that stops covering the next
store, which is the defect it would be pinning against.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
SRC = os.path.join(REPO_ROOT, "src")

#: `name_get_handler, name_put_handler = _json_store_handlers(PATH_CONST, "key",`
FACTORY = re.compile(
    r"(\w+)_get_handler,\s*(\w+)\s*=\s*_json_store_handlers\(\s*"
    r"[\w.]+,\s*\"(\w+)\"", re.MULTILINE)

#: `app.router.add_get("/device-config", device_config_get_handler)`
ROUTE = re.compile(r"add_(?:get|put)\(\"(/[\w-]+)\",\s*(\w+)\)")


def _proxy() -> str:
    with open(PROXY, encoding="utf-8") as handle:
        return handle.read()


def store_keys() -> Dict[str, str]:
    """`{"/reports-config": "config", "/fm-data": "data", …}`, from the proxy.

    ⚠️ ROUTED STORES ONLY. The history store's PUT handler is built and
    deliberately never routed (it is server-written and read-only to clients);
    a store with no route has no client and nothing to disagree with.
    """
    source = _proxy()
    by_handler: Dict[str, str] = {}
    for get_stem, put_name, key in FACTORY.findall(source):
        by_handler[f"{get_stem}_get_handler"] = key
        by_handler[put_name] = key

    routes: Dict[str, str] = {}
    for path, handler in ROUTE.findall(source):
        if handler in by_handler:
            routes[path] = by_handler[handler]
    return routes


def _ts_sources() -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".ts", ".tsx")):
                path = os.path.join(base, name)
                with open(path, encoding="utf-8") as handle:
                    out.append((os.path.relpath(path, REPO_ROOT), handle.read()))
    return out


#: How far around a `fetch(ingressPath("…"))` to look for the envelope. Wide
#: enough to span a whole small client function, narrow enough that the next
#: function's envelope cannot be mistaken for this one's.
WINDOW = 1400


def _uses(route: str) -> List[Tuple[str, str]]:
    """Every `(file, excerpt)` that fetches this route."""
    out: List[Tuple[str, str]] = []
    needle = f'ingressPath("{route.lstrip("/")}")'
    for path, source in _ts_sources():
        start = 0
        while True:
            at = source.find(needle, start)
            if at < 0:
                break
            out.append((path, source[at:at + WINDOW]))
            start = at + 1
    return out


#: ⚠️ ANCHORED ON THE TWO IDIOMS BOTH EXISTING CLIENTS ALREADY USE, so a new
#: client that invents a third shape fails this test rather than slipping past
#: it. That is the intended direction: a store client is four lines of
#: boilerplate and consistency between them is what makes this checkable at all.
READ_ANCHOR = re.compile(r"as\s*\{\s*(\w+)\?:\s*unknown")
WRITE_ANCHOR = re.compile(r"JSON\.stringify\(\s*\{?\s*(?:\w+\s*===\s*null[^{]*\{\s*)?(\w+)\s*:")


def test_every_store_client_uses_its_own_envelope_key() -> None:
    routes = store_keys()
    assert routes, "no JSON stores found in the proxy — this test's anchors moved"

    problems: List[str] = []
    for route, key in sorted(routes.items()):
        for path, excerpt in _uses(route):
            read = READ_ANCHOR.search(excerpt)
            if read and read.group(1) not in (key, "rev"):
                problems.append(
                    f"{path}: reads {route} as `{{{read.group(1)}}}` but the "
                    f"proxy wraps it in `{key}` — the parse degrades to "
                    f"defaults and looks like an empty store")
            write = WRITE_ANCHOR.search(excerpt)
            if write and write.group(1) not in (key, "rev"):
                problems.append(
                    f"{path}: PUTs {route} as `{{{write.group(1)}: …}}` but the "
                    f"proxy reads `{key}` — every save 400s")
    assert not problems, "\n".join(problems)


def test_the_anchors_still_find_something() -> None:
    """⚠️ A SOURCE-READING TEST THAT FINDS NOTHING PASSES VACUOUSLY, which is
    how four counters in this project came to read 0 for the exact case they
    existed to measure. If the client idiom changes, this fails FIRST and says
    so, rather than the test above reporting health over an empty loop."""
    routes = store_keys()
    covered = {route for route in routes if _uses(route)}
    assert covered, (
        "no TypeScript client fetches any store route — either `ingressPath` "
        "was renamed or the clients moved, and the envelope check above is now "
        "comparing empty sets")
    for route in covered:
        excerpts = _uses(route)
        assert any(READ_ANCHOR.search(e) or WRITE_ANCHOR.search(e)
                   for _f, e in excerpts), (
            f"the client for {route} matches neither the read idiom "
            f"(`as {{ key?: unknown }}`) nor the write idiom "
            f"(`JSON.stringify({{ key: … }})`), so its envelope is unchecked")


def test_the_three_known_stores_are_covered() -> None:
    """The list this test would otherwise have hard-coded, asserted as an
    OUTCOME of the derivation instead of as its input — so it proves the regex
    works without becoming the thing that has to be maintained."""
    routes = store_keys()
    assert routes.get("/device-config") == "config"
    assert routes.get("/fm-data") == "data"
    assert routes.get("/reports-config") == "config"
