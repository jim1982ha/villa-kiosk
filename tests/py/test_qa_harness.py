"""The QA harness reads the backend's JSON by field name, and nothing else
keeps the two in step.

⚠️ SAME SHAPE AS `test_store_envelope`, ONE LEVEL OUT. `tests/qa/briefings-qa.js`
is pasted into a browser console to validate a release on real hardware: it
fetches the reports endpoints and asserts on `next_runs`, `notify_targets`,
`_payload`, `withheld` and a dozen more. Every one of those is a string literal
in JavaScript matching a string literal in Python, with nothing between them —
the defect family that cost six releases across v2.544.0–v2.546.0.

A QA script that silently stops seeing a field is worse than no QA script: it
reports PASS for a check it is no longer performing, on the one pass whose
entire job is to be believed. So the names are checked here, cheaply, against
the source that produces them.

⚠️ IT VALIDATES NAMES, NOT BEHAVIOUR. Whether the harness ASKS the right
questions is a judgement no test can make; whether it is still asking them of
the fields that exist is exactly what a test can. Scope stated so the next
reader does not mistake a green run here for a green run there.
"""

from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HARNESS = os.path.join(REPO_ROOT, "tests", "qa", "briefings-qa.js")
BIN = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")
PROXY = os.path.join(BIN, "supervisor-proxy.py")
PIPELINE = os.path.join(BIN, "reports", "pipeline.py")
DISCOVERY = os.path.join(BIN, "vesta", "adapters", "discovery.py")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _harness() -> str:
    return _read(HARNESS)


def test_the_harness_exists_and_parses_as_one_expression() -> None:
    """⚠️ VACUOUS-PASS GUARD, and a real one: this file is PASTED. An unbalanced
    brace makes the console reject the whole thing with a syntax error and no
    output at all, which is indistinguishable from "nothing ran"."""
    source = _harness()
    assert source.strip().startswith("/*"), "the harness lost its header"
    assert source.count("(") == source.count(")"), "unbalanced parentheses"
    assert source.count("{") == source.count("}"), "unbalanced braces"
    assert source.rstrip().endswith("})();"), (
        "the harness must remain a single self-invoking async expression — it "
        "is pasted into a console, where a trailing statement changes what the "
        "REPL echoes")


def test_every_endpoint_it_fetches_is_routed() -> None:
    """A path the proxy does not route is answered with the SPA's index.html at
    status 200 — see `test_nginx_routes`. The harness checks the content-type
    for exactly that, but only for paths it knows to ask about."""
    # ⚠️ FROM THE PATH LIST AND THE POST, NOT FROM EVERY `.get("…")` IN THE
    # FILE. The first draft matched `headers.get("content-type")` and reported
    # `content-type` as an unrouted endpoint — /dry-audit's step 7 in this
    # test's own first run: a finding that is the grep rather than the code.
    proxy = _read(PROXY)
    source = _harness()
    block = re.search(r"const paths = \[(.*?)\];", source, re.DOTALL)
    assert block, "the harness's endpoint list moved — this check is now blind"
    asked = set(re.findall(r'"([\w-]+)"', block.group(1)))
    asked |= set(re.findall(r'base \+ "([\w-]+)"', source))
    assert asked, "the harness fetches nothing — its call idiom moved"
    missing = sorted(p for p in asked if f'"/{p}"' not in proxy)
    assert not missing, (
        f"the harness fetches routes the proxy does not register: {missing}")


def _produced_keys() -> Set[str]:
    """Every JSON key the reports endpoints emit, from the source that emits."""
    keys: Set[str] = set()
    for path in (PROXY, PIPELINE, DISCOVERY):
        # ⚠️ `[A-Za-z0-9_]`, NOT `[a-z_]`. A lowercase-only class truncates
        # `findingCount` to `finding` and reports a field that exists as
        # missing — the `signedArea2` false positive this project has already
        # paid for once, reproduced here on the first run.
        keys |= set(re.findall(r'"(_?[A-Za-z][A-Za-z0-9_]*)":', _read(path)))
        keys |= set(re.findall(r'entry\["(_[a-z_]+)"\]', _read(path)))
    return keys


#: Names the harness reads that are produced somewhere this test does not scan
#: (aggregate.summary, collect.state) or are the harness's own locals. Listed
#: rather than widening the scan, because a wider scan matches more by accident
#: and this list is short enough to adjudicate by eye.
ELSEWHERE = {
    "events_seen", "groups", "configured", "body", "problems", "withheld",
    "mode", "declined", "title", "description", "requires", "audiences",
    "min_days", "service", "name", "broadcast", "needs_target", "severity",
    "detail", "reason", "module", "cadence", "hour", "minute", "weekday",
    "day", "audience", "targets", "id", "enabled", "schedules", "narration",
    "notify_targets", "min_history_days", "capabilities",
    "capabilities_missing", "preflight", "modules", "inventory", "at",
    "reachable", "error", "next_runs", "config", "history", "ran", "skipped",
    "aggregated",
}


def test_every_backend_field_it_reads_is_produced_somewhere() -> None:
    """⚠️ THE CHECK THAT MATTERS. A renamed field turns a harness assertion into
    a permanent PASS on a question nobody is asking any more."""
    produced = _produced_keys()
    source = _harness()

    read: Set[str] = set()
    for holder in ("diag", "prev", "cfg", "pay"):
        read |= set(re.findall(rf'\b{holder}\.(_?[A-Za-z][A-Za-z0-9_]*)', source))
    assert read, "the harness reads no backend fields — its access idiom moved"

    unknown = sorted(f for f in read if f not in produced and f not in ELSEWHERE)
    assert not unknown, (
        f"the harness reads fields no backend source produces: {unknown}. "
        f"Either they were renamed — in which case the harness is now checking "
        f"nothing — or this test's scan needs widening.")


def test_it_only_ever_reads_and_previews() -> None:
    """⚠️ A QA SCRIPT THAT MUTATES IS NOT A QA SCRIPT. This is pasted into a
    console on a LIVE villa by someone who has been told it changes nothing, so
    the one POST it makes must be the preview — which delivers nothing and
    records nothing — and there must be no PUT at all."""
    source = _harness()
    methods = set(re.findall(r'method:\s*"(\w+)"', source))
    assert methods <= {"POST"}, f"the harness uses {sorted(methods)}"
    posts = re.findall(r'base \+ "([\w-]+)".{0,400}?method:\s*"POST"',
                       source, re.DOTALL)
    assert posts == ["reports-run-now"], f"unexpected POST target: {posts}"
    assert '"preview": true' in source or "preview: true" in source, (
        "the only POST must carry `preview: true` — without it this script "
        "DELIVERS a briefing to the household on every QA run")


def test_it_cannot_print_a_credential() -> None:
    """`/reports-secret` returns booleans by construction, and the harness reads
    only those — but it also greps its own response for a credential-shaped
    string, so a backend change that started returning one would be caught by
    the pass rather than pasted into a chat."""
    source = _harness()
    assert "secret.configured" in source, (
        "the harness must read only the `configured` booleans from "
        "/reports-secret")
    assert re.search(r"\{25,\}", source), (
        "the harness's own credential-shaped-string guard is gone — it is what "
        "stops a future backend leak being pasted into a support thread")
