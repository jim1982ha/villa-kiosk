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


def _proxy_code() -> str:
    """The proxy with its COMMENTS BLANKED, line numbers preserved.

    ⚠️ SIXTH TIME IN THIS REPO A TEST HAS MATCHED THE PROSE EXPLAINING THE THING
    IT CHECKS. A comment saying "the first version did
    `_read_json_store(…).get(…)` and this test flagged it" is a description of
    the defect, and a source-reading check that greps raw text cannot tell it
    from the defect. Every other file that reads source here already strips
    comments (`test_cockpit_reach._code`, `test_editable_rows._no_comments`,
    `test_modal_shell`); this one did not, and the note explaining a fix is
    exactly the kind of line that lands next to the code being fixed.

    Blanked rather than deleted so the reported LINE NUMBERS still point at the
    real offender — a scanner that renumbers its own findings is a scanner
    nobody trusts twice.
    """
    out = []
    for line in _proxy().splitlines():
        stripped = line.lstrip()
        out.append("" if stripped.startswith("#") else line)
    return "\n".join(out)


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


#: An upper bound on how far to look for the envelope after a fetch. ⚠️ IT IS
#: NO LONGER THE ONLY DELIMITER — see `_uses`. It remains as a backstop for the
#: last client in a file, which has no following declaration to stop at.
WINDOW = 1400

#: ⚠️ THE REAL DELIMITER, AND IT REPLACED A PURE CHARACTER WINDOW THAT PRODUCED
#: A FALSE POSITIVE THE DAY A THIRD CLIENT WAS ADDED TO `agentApi.ts`. The
#: window's own comment claimed it was "narrow enough that the next function's
#: envelope cannot be mistaken for this one's" — which was true of the two
#: files that existed when it was written and stopped being true as soon as a
#: client with a long docstring sat between two others. It then read
#: `loadAgentRuns`' `{runs}` as `loadAgentConfig`'s envelope and reported a
#: mismatch in correct code. A test that cries wolf on correct code gets its
#: assertion loosened, which is how a real pin dies.
DECL = re.compile(r"\n(?:export\s+)?(?:async\s+)?function\s", re.MULTILINE)


def _uses(route: str) -> List[Tuple[str, str]]:
    """Every `(file, excerpt)` that fetches this route.

    The excerpt runs from the fetch to the START OF THE NEXT DECLARATION, or
    `WINDOW` characters, whichever comes first — so an envelope belonging to the
    next client can never be attributed to this one.
    """
    out: List[Tuple[str, str]] = []
    needle = f'ingressPath("{route.lstrip("/")}")'
    for path, source in _ts_sources():
        start = 0
        while True:
            at = source.find(needle, start)
            if at < 0:
                break
            chunk = source[at:at + WINDOW]
            boundary = DECL.search(chunk)
            out.append((path, chunk[:boundary.start()] if boundary else chunk))
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


def _no_comments(source: str) -> str:
    """Source with `//` and `/* */` removed.

    ⚠️ WITHOUT THIS, A TEST MATCHES THE PROSE EXPLAINING THE BUG IT CHECKS FOR.
    The first version of the revision pin below flagged `agentApi.ts` for the
    word `expected_rev` — which appears there only in the docstring recording
    that `expected_rev` was WRONG.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"//[^\n]*", "", source)


def test_every_store_client_sends_the_REVISION_KEY_THE_PROXY_READS() -> None:
    """⚠️ THE PROXY READS `body.get("rev")` AND TREATS ANYTHING ELSE AS ABSENT.

    That is the dangerous half: a client sending `expected_rev` is not refused,
    it is ACCEPTED and the conditional write is skipped entirely. Every write
    then goes through unconditionally, and a lost update looks exactly like a
    save that worked. `agentApi.ts` shipped that way and nothing noticed — the
    same shape as the 2.545.0 wire-key bug, one field along.

    ⚠️ SNAKE_CASE ONLY. `expectedRev` is the local VARIABLE every working client
    uses (`...(expectedRev === null ? {} : { rev: expectedRev })`) and is
    correct; the wire key is what must be `rev`.
    """
    proxy = _proxy()
    assert 'raw_rev = body.get("rev")' in proxy, (
        "the proxy's revision field changed; this test now checks a name "
        "nothing reads")
    offenders = []
    for path, source in _ts_sources():
        if "ingressPath(" not in source:
            continue
        if "expected_rev" in _no_comments(source):
            offenders.append(path)
    assert not offenders, (
        f"{offenders} send `expected_rev`. The proxy reads `rev` and silently "
        f"ignores any other name, so the conditional write is skipped and two "
        f"tabs overwrite each other with no 409.")


def test_the_agent_config_client_sends_a_WHOLE_DOCUMENT() -> None:
    """⚠️ THE STORES REPLACE THE WHOLE DOCUMENT — THEY DO NOT MERGE.

    `_json_store_handlers` writes `body[key]` verbatim, so a client sending only
    the keys it changed DELETES everything else. `saveAgentConfig` did exactly
    that: ticking the agent on wrote `{enabled: true}` as the entire config and
    destroyed the owner's `allowed_senders` list, reported the first time the
    switch was used. The reasoning behind it was a real merge in the wrong
    place — `agent.config.view` spreads DEFAULTS under stored values at READ
    time, which has nothing to do with what a write does.

    ⚠️ THIS PINS ONE CLIENT, NOT THE RULE IN GENERAL, AND THE LIMIT IS HONEST.
    "Sends a whole document" is not decidable from source shape: `deviceConfig`
    PUTs `{ config: merged }` where `merged` was assembled earlier and is
    perfectly correct. A general test would have to flag that or miss this, and
    a pin that cries wolf on correct code gets its assertion loosened — which is
    how a real pin dies. So this checks the one client that got it wrong, in the
    way it got it wrong: the carried copy must be a PARAMETER, so it cannot be
    forgotten at a call site without the compiler saying so.
    """
    import inspect
    import os

    path = os.path.join(SRC, "agent", "agentApi.ts")
    with open(path, encoding="utf-8") as handle:
        source = _no_comments(handle.read())
    assert "carryOver: Record<string, unknown>" in source, (
        "saveAgentConfig no longer takes the carried document as a parameter; "
        "a caller can now omit it and silently delete every key it did not set")
    assert "...carryOver, ...toWire(patch)" in source, (
        "the carried document is not spread UNDER the patch")


def test_no_SERVER_side_reader_unwraps_the_wire_envelope() -> None:
    """⚠️ THE ENVELOPE IS A WIRE FORMAT. IT IS NOT ON DISK.

    `_read_json_store` returns the stored DOCUMENT; the `{"config": …}` wrapper
    is added by `_json_store_handlers`' GET, for the browser. A server-side
    reader that unwraps it finds no such key and gets `{}` — which `view()` then
    fills with DEFAULTS, so the caller sees a perfectly valid config that is not
    the one the operator saved.

    Shipped exactly that: `_chat_dispatch` read `stored.get("config")`, so
    `enabled` was always False and every Telegram message was refused with
    "chat trigger disabled" while both switches showed ticked on screen. The
    mirror image of 2.545.0 — that was a client using the wrong wrapper, this
    was the server inventing one — and this module covered only the client half.

    ⚠️ THE FIX IS UNMISTAKEABLE AND THE BUG IS NOT: `view(_read_json_store(…))`
    versus `view(_read_json_store(…).get("config"))` differ by six words and
    behave identically until somebody changes a setting.
    """
    proxy = _proxy_code()
    keys = set(store_keys().values()) | {"config", "data", "history"}
    offenders = []
    for match in re.finditer(r"_read_json_store\([^)]*\)\s*\.get\(\s*[\"']"
                             r"(\w+)[\"']", proxy):
        if match.group(1) in keys:
            line = proxy[:match.start()].count("\n") + 1
            offenders.append(f"supervisor-proxy.py:{line} unwraps "
                             f"{match.group(1)!r}")
    # Two-step form: `stored = _read_json_store(…)` then `stored.get("config")`.
    for match in re.finditer(r"(\w+)\s*=\s*_read_json_store\(", proxy):
        name = match.group(1)
        window = proxy[match.end():match.end() + 400]
        hit = re.search(rf"{name}\.get\(\s*[\"'](\w+)[\"']", window)
        if hit and hit.group(1) in keys:
            line = proxy[:match.start()].count("\n") + 1
            offenders.append(f"supervisor-proxy.py:{line} unwraps "
                             f"{hit.group(1)!r} from {name}")
    assert not offenders, (
        f"{offenders}. `_read_json_store` returns the DOCUMENT — the envelope "
        f"is added by the GET handler and exists only on the wire. Unwrapping "
        f"it yields {{}}, which `view()` fills with defaults, so the operator's "
        f"saved settings are silently replaced by the shipped ones.")


def test_no_module_reads_a_PREFIXED_agent_config_key() -> None:
    """⚠️ THE THIRD INSTANCE OF ONE DEFECT, AND THE SECOND SWEEP THAT MISSED IT.

    `/agent-config` stores `monthly_limit`, `max_turns`, `act_enabled` and the
    rest UNPREFIXED. `policy.py` read `agent_act_enabled`, `agent_max_turns` and
    two more — fixed in 2.640.0 — and `budget.py` was still reading
    `agent_monthly_limit` two releases later, so an owner's spend ceiling was
    accepted, returned 200 and silently ignored while the budget ran on its
    shipped default.

    ⚠️ FIXING THE SITE IN VIEW RATHER THAN THE APPLICABLE SET IS THE ACTUAL
    BUG HERE — `feedback_audit-applicable-set`, twice paid for. This derives the
    key set from `config.DEFAULTS` and refuses `agent_<key>` anywhere under
    `agent/`, so the fourth instance cannot exist.
    """
    import ast
    import os
    import sys

    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import config as agent_config

    banned = {f"agent_{name}" for name in agent_config.DEFAULTS}
    assert banned, "no keys derived; this test is checking nothing"

    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent")
    offenders = []
    for base, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                source = handle.read()
            # ⚠️ AST, NOT A GREP — the comment recording this fix names the
            # prefixed keys, and a text search would match the explanation.
            for node in ast.walk(ast.parse(source)):
                if (isinstance(node, ast.Constant)
                        and isinstance(node.value, str)
                        and node.value in banned):
                    offenders.append(f"{name}:{node.lineno} {node.value}")
    assert not offenders, (
        f"{offenders} read a prefixed key nothing writes. The store's names are "
        f"{sorted(agent_config.DEFAULTS)}; read them through "
        f"`agent.config.view`.")


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


def test_the_agent_wire_map_covers_every_setting() -> None:
    """⚠️ A SETTING THE BACKEND HONOURS AND THE SPA CANNOT NAME IS UNREACHABLE,
    AND IT FAILS SILENTLY IN BOTH DIRECTIONS: `fromWire` drops it on read and
    `toWire` omits it on write, so the panel renders a default and a save leaves
    the stored value alone. Nothing 400s and nothing logs.

    `shadow` shipped this way — the single flag that decides whether the agent
    DELIVERS anything could only be changed by editing JSON on the box.

    ⚠️ DERIVED FROM `config.DEFAULTS`, never from a list here, for the same
    reason every other cross-artefact pin in this file is: a hand-kept copy of
    the thing under test agrees with itself forever.
    """
    import re
    import sys
    sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))
    from agent import config as agent_config

    with open(os.path.join(SRC, "agent", "agentApi.ts"),
              encoding="utf-8") as handle:
        src = handle.read()
    block = src[src.index("AGENT_WIRE_KEYS = {"):]
    block = block[:block.index("} as const;")]
    mapped = set(re.findall(r"^\s*([a-z_]+):\s*\"", block, re.M))

    missing = sorted(set(agent_config.DEFAULTS) - mapped)
    assert not missing, (
        f"these agent settings exist in the store and the SPA cannot read or "
        f"write them: {missing}")
