"""A registry with no session publishes Home Assistant and cannot reach it.

⚠️ THIS IS THE DEFECT, IN ONE SENTENCE: `build_registry` folds the upstream MCP
catalogue in and binds each tool to `lambda: session`, so a session-less
registry PUBLISHES all of Home Assistant's tools and answers every call to one
with `no session to reach the MCP server` — into the TRANSCRIPT, where no log
line ever sees it. The model is told it can read the villa and then cannot.

The session existed the whole time and was dropped one frame up:
`scheduler._run_once` takes it and called `triage.run` / `reason.follow_up`
without it. Chat was the only path that passed one, which is why questions typed
at the villa worked while every scheduled investigation ran on the built-in
readers alone.

⚠️ SO THE PIN IS ON THE CALLERS, NOT ON `build_registry`. The function was
always correct — it has taken `session` since it was written. A test of it would
have stayed green through every release this was broken
(`feedback_pin-the-caller`, twice paid for in this repo).
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.supervise.agent import reason
from vesta.supervise.agent import registry as reg
from vesta.supervise.agent import runtime
from vesta.supervise.agent import triage
from vesta.supervise.agent import upstream

SHIPPED = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")

#: One READ tool, in the shape `tools/list` returns.
SPEC = {"name": "ha_get_state", "description": "read one entity",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True}}


def _with_catalogue(monkeypatch: Any) -> None:
    monkeypatch.setattr(upstream, "catalogue",
                        lambda: {"url": "http://x/mcp", "tools": [SPEC]})


# ── the symptom, reproduced ────────────────────────────────────────────────

def test_a_SESSIONLESS_registry_publishes_HA_and_cannot_call_it(
        monkeypatch: Any) -> None:
    """⚠️ THE VACUOUS-PASS GUARD IS THE FIRST ASSERT. If the catalogue patch
    ever stops taking, the tool is simply absent and every assertion below
    passes by measuring nothing."""
    _with_catalogue(monkeypatch)
    built = reg.build_registry(config={})
    tool = built.get("ha_get_state")
    assert tool is not None, "the catalogue patch did not take — this test is blind"

    blocks = asyncio.run(tool.call({}))
    assert blocks[0]["error"]["code"] == "unavailable"
    assert "no session" in blocks[0]["error"]["message"]


def test_a_session_REACHES_the_upstream_tool(monkeypatch: Any) -> None:
    """The same registry, built with a session, hands that session to the tool."""
    _with_catalogue(monkeypatch)
    seen: List[Any] = []

    async def fake_rpc(session: Any, url: str, method: str,
                       params: Any = None) -> Dict[str, Any]:
        seen.append(session)
        return {"content": [{"type": "text", "text": "on"}]}

    monkeypatch.setattr(upstream, "rpc", fake_rpc)
    marker = object()
    tool = reg.build_registry(config={}, session=marker).get("ha_get_state")
    assert tool is not None
    asyncio.run(tool.call({}))
    assert seen == [marker], "the session did not reach the upstream call"


# ── every path into the loop carries one ───────────────────────────────────

def _params(fn: Any) -> List[str]:
    return list(inspect.signature(fn).parameters)


def test_every_entry_point_ACCEPTS_a_session() -> None:
    """⚠️ THE FOUR PATHS, NAMED. `runtime.investigate` is the shared body, and
    the three that reach it each had to be widened — a session that stops at any
    one of them leaves that tier blind while the others work, which is the
    hardest version of this bug to notice."""
    for fn in (runtime.investigate, triage.run, reason.follow_up,
               reason.investigate_subject, reason.approve):
        assert "session" in _params(fn), f"{fn.__qualname__} drops the session"


def test_investigate_FORWARDS_it_rather_than_accepting_it_politely() -> None:
    """⚠️ A parameter that is accepted and unused is the worst outcome here: it
    reads as fixed at every call site and changes nothing."""
    src = inspect.getsource(runtime.investigate)
    assert "build_registry(config=config, session=session)" in src


def test_the_SCHEDULER_hands_its_session_to_both_tiers() -> None:
    """⚠️ WHERE IT WAS ACTUALLY DROPPED. `_run_once` has had the session since
    it was written and called both tiers without it."""
    from vesta.supervise.agent import scheduler
    src = inspect.getsource(scheduler._run_once)
    assert re.search(r"triage_mod\.run\((?:[^)]|\n)*session=session", src), (
        "the triage pass is started without the session")
    assert re.search(r"reason_mod\.follow_up\((?:[^)]|\n)*session=session", src), (
        "the reasoning tier is started without the session")


# ── and no NEW site may go dark ────────────────────────────────────────────

def test_NO_shipped_call_to_build_registry_omits_the_session() -> None:
    """⚠️ DERIVED FROM THE TREE, NEVER A LIST OF FILES. A pin that names its
    call sites is `grep -l` wearing a test's clothes: the site added tomorrow is
    the one that goes dark, exactly as four of them had.

    ⚠️ AND IT READS SOURCE RATHER THAN BEHAVIOUR ON PURPOSE. A session-less
    registry does not fail — it degrades to the built-in readers and answers
    plausibly, which is why this survived from the day the integration shipped.
    """
    offenders: List[str] = []
    checked = 0
    for root, _dirs, files in os.walk(SHIPPED):
        if "__pycache__" in root:
            continue
        for name in sorted(files):
            if not name.endswith(".py"):
                continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as handle:
                source = handle.read()
            for number, line in enumerate(source.splitlines(), 1):
                stripped = line.strip()
                # the definition, and prose ABOUT the call, are not calls
                if (stripped.startswith("#") or stripped.startswith("*")
                        or "def build_registry" in stripped):
                    continue
                if "build_registry(" not in stripped:
                    continue
                # ⚠️ PROSE MENTIONING THE CALL IS NOT THE CALL, and this file's
                # docstrings quote it repeatedly. Three of eight /dry-audit hits
                # on 2026-08-19 were this same mistake. A backtick immediately
                # before it is this repository's own citation style, so the
                # filter is dumb, explicit, and cannot go blind on a real call.
                if "`build_registry(" in stripped:
                    continue
                checked += 1
                if "session=" not in stripped:
                    offenders.append(
                        f"{os.path.relpath(path, REPO_ROOT)}:{number}")
    assert checked >= 4, (
        "fewer call sites than expected — the walk or the filter is wrong, and "
        "an empty scan reports health forever")
    assert not offenders, (
        "build_registry called without a session, so these paths publish Home "
        "Assistant's tools and cannot call any of them:\n  "
        + "\n  ".join(offenders))
