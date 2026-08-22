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


#: Routed stores with no SPA client, each for a stated reason. ⚠️ A store
#: absent from here AND with no client found means the client exists but was
#: written in a shape `_uses` cannot see — which is the blind spot below.
NO_CLIENT_BY_DESIGN: Dict[str, str] = {}


def test_every_routed_store_actually_HAS_a_client_this_test_can_see() -> None:
    """⚠️ THE BLIND SPOT THIS TEST HAD, AND IT LET A NEW STORE THROUGH.

    `_uses` finds clients by searching for `ingressPath("route")`. A client
    written any other way — a template literal, a helper, a constant — yields
    ZERO matches, and zero matches meant the loop below simply did not run.
    "No client" and "a client I cannot read" were indistinguishable, and the
    second one is exactly the case this module exists to catch.

    Found when `/agent-config` was added: its client fetched
    `` `${base}/agent-config` `` and the whole suite passed green while checking
    nothing about it. Deliberately breaking that client's envelope key still
    passed — the proof that it was vacuous.
    """
    routes = store_keys()
    unseen = sorted(r for r in routes
                    if not _uses(r) and r not in NO_CLIENT_BY_DESIGN)
    assert not unseen, (
        f"routed store(s) with no client this test can see: {unseen}. Either "
        f"the client does not exist (add it to NO_CLIENT_BY_DESIGN with a "
        f"reason), or it fetches the route in a shape `_uses` cannot find — "
        f"use `ingressPath(\"route\")` like every sibling client, or this "
        f"module silently stops covering that store.")


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


# ── the keys INSIDE the envelope ────────────────────────────────────────────

REPORTS_API = os.path.join(SRC, "reports", "reportsApi.ts")

#: The client's `wire: "clientName"` table. One place, used by both the parse
#: and the serialise, so the two directions cannot drift from each other — the
#: only remaining question is whether the table itself is complete.
WIRE_TABLE = re.compile(r"const CONFIG_WIRE_KEYS = \{(.*?)\n\} as const;", re.DOTALL)
WIRE_ENTRY = re.compile(r"^\s*(\w+):\s*\"(\w+)\",", re.MULTILINE)


def config_defaults() -> List[str]:
    """The reports config's top-level keys, from `store.CONFIG_DEFAULTS`."""
    path = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports", "store.py")
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    block = source[source.index("CONFIG_DEFAULTS"):]
    block = block[:block.index("\n}")]
    return re.findall(r"^\s{4}\"(\w+)\":", block, re.MULTILINE)


def test_the_client_speaks_every_key_the_store_defines() -> None:
    """⚠️ THE STORE SPEAKS snake_case AND THE APP SPEAKS camelCase, and a key
    that differs between them is ACCEPTED AND IGNORED rather than refused:
    `validate_config` only checks keys it knows, and `config_view` deliberately
    keeps unknown ones so a newer add-on's settings survive a downgrade. So a
    save of `notifyTargets` returns 200, and the scheduler then reads
    `notify_targets`, finds nothing, and delivers a composed brief nowhere.

    Two of the seven keys are two words long, which is why five of them worked
    and hid it — and why the schedule ITEM fields, all single words, worked
    too."""
    with open(REPORTS_API, encoding="utf-8") as handle:
        source = handle.read()
    table = WIRE_TABLE.search(source)
    assert table, ("CONFIG_WIRE_KEYS is gone from reportsApi.ts — the mapping "
                   "this test checks no longer exists in one place")
    mapped = dict(WIRE_ENTRY.findall(table.group(1)))

    missing = [k for k in config_defaults() if k not in mapped]
    assert not missing, (
        f"the store defines these config keys and the client's wire table does "
        f"not name them, so they are written under a name nothing reads: "
        f"{missing}")


def test_the_client_reads_the_wire_name_for_every_two_word_key() -> None:
    """The table governs the WRITE path. The read path is hand-written per key,
    so the ones that can differ are checked directly — a `c.notifyTargets` in
    the parser degrades to absent and renders as "nothing configured", which is
    the same silent shape as the envelope bug's GET half."""
    with open(REPORTS_API, encoding="utf-8") as handle:
        source = handle.read()
    problems: List[str] = []
    for key in config_defaults():
        if "_" not in key:
            continue  # single words are identical in both vocabularies
        camel = re.sub(r"_(\w)", lambda m: m.group(1).upper(), key)
        if f"c.{camel}" in source:
            problems.append(
                f"reportsApi.ts parses `c.{camel}` but the store writes "
                f"`{key}` — the read degrades to absent and looks like an "
                f"unconfigured property")
    assert not problems, "\n".join(problems)


NARRATION_TABLE = re.compile(
    r"const NARRATION_WIRE_KEYS = \{(.*?)\n\} as const;", re.DOTALL)


def test_the_client_speaks_every_key_the_narration_slice_reads() -> None:
    """⚠️ THE SAME RULE ONE LEVEL DOWN, AND IT HIDES BETTER THERE. A nested key
    written under the wrong name arrives inside a slice that is otherwise
    correct, so the feature WORKS and only that setting is ignored — here, a
    monthly ceiling an operator set to 20 silently running at the default 200.
    The top-level version at least makes a whole feature inert.

    Derived from `providers.shared`'s own `settings.get(...)` calls, so a fourth
    narration setting is covered on the day it is read."""
    providers = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "reports",
                             "narrate", "providers.py")
    with open(providers, encoding="utf-8") as handle:
        block = handle.read()
    block = block[block.index("def shared("):]
    wanted = set(re.findall(r"settings\.get\(\"(\w+)\"", block))
    assert wanted, "providers.shared reads no settings — this anchor moved"

    with open(REPORTS_API, encoding="utf-8") as handle:
        source = handle.read()
    table = NARRATION_TABLE.search(source)
    assert table, "NARRATION_WIRE_KEYS is gone from reportsApi.ts"
    mapped = dict(WIRE_ENTRY.findall(table.group(1)))

    # ⚠️ THE `provider` EXEMPTION IS GONE. It was excused as "read with a
    # default and not operator-facing yet"; v2.551.0 put a Service selector in
    # the UI, so it is now a stored setting like the others and an exemption
    # would be exactly the blind spot this test exists for. An exemption that
    # outlives its reason is worse than no test — it reads as covered.
    missing = sorted(wanted - set(mapped))
    assert not missing, (
        f"providers.shared reads these narration settings and the client's "
        f"wire table does not name them: {missing}")


def test_the_three_known_stores_are_covered() -> None:
    """The list this test would otherwise have hard-coded, asserted as an
    OUTCOME of the derivation instead of as its input — so it proves the regex
    works without becoming the thing that has to be maintained."""
    routes = store_keys()
    assert routes.get("/device-config") == "config"
    assert routes.get("/fm-data") == "data"
    assert routes.get("/reports-config") == "config"
