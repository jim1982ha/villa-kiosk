"""The briefing reaches a formatting-capable destination as formatted text.

⚠️ THIS PINS A MECHANISM THAT SHIPPED ONCE AND COULD NEVER FIRE (2026-08-29).
`deliver` already upgraded a message when the target service PUBLISHED a
`parse_mode` field — correct, tested, and unreachable in production, because
briefings go out through `notify.send_message` and that service's schema is
`message` + `title` and nothing else. Read live from the reference villa: of
nine `notify` services, NONE declares `parse_mode`. The feature was green in
every test and the owner's phone showed a raw URL.

⚠️ SO THE INTERESTING ASSERTION IS THE NEGATIVE ONE, and it is
`test_the_schema_path_alone_can_never_carry_a_briefing` below. Pinning only
"the rich path formats" would pass on a tree where the rich path is never
selected — which is precisely the state that shipped. The pin has to say why
the OLD mechanism was insufficient, or the next person deletes the new one as
redundant.

⚠️ AND ONE PIN GUARDS THE VILLA THAT HAS NO SUCH INTEGRATION: an ordinary
target must produce the byte-identical payload it produced before this existed.
The upgrade is an addition, never a change to the common path.
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vesta.adapters import deliver as deliver_mod  # noqa: E402
from vesta.adapters import discovery as discovery_mod  # noqa: E402
from vesta.adapters import rich as rich_mod  # noqa: E402


class _Response:
    def __init__(self, status: int = 200) -> None:
        self.status = status

    async def text(self) -> str:
        return ""

    async def __aenter__(self) -> "_Response":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _Session:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def post(self, url: str, headers: Optional[Dict[str, str]] = None,
             json: Optional[Dict[str, Any]] = None, **kw: Any) -> _Response:
        self.calls.append({"url": url, "json": json})
        return _Response()


def _capable(*ids: str) -> Any:
    """Stand in for the entity-registry read, without a websocket."""
    async def fake(session: Any, *, now: Optional[float] = None) -> "frozenset[str]":
        return frozenset(ids)
    return fake


def _deliver(session: Any, targets: List[str], html: str = "") -> Any:
    return asyncio.run(deliver_mod.deliver(
        session, targets, "Daily report", "plain body", (), html))


# ── the negative pin: why the previous mechanism was not enough ─────────────
def test_the_schema_path_alone_can_never_carry_a_briefing() -> None:
    """⚠️ THE REASON `rich` EXISTS, ASSERTED RATHER THAN WRITTEN DOWN.

    `notify.send_message`'s real schema — the one every briefing is delivered
    through — offers no `parse_mode`, so the schema-reading upgrade returns ""
    and the message stays plain however good the html body is. If Home
    Assistant ever adds the field, this test goes red and the `rich` adapter
    becomes removable; that is a change worth being told about.
    """
    real_schema = {
        "message": {"required": True, "selector": {"text": {}}},
        "title": {"required": False, "selector": {"text": {}}},
    }
    assert discovery_mod._html_mode(real_schema) == "", (
        "notify.send_message now declares a parse_mode — the rich adapter may "
        "be redundant, check before deleting it")

    # …and with that "" the payload builder keeps the plain body, which is the
    # exact production behaviour the owner photographed.
    body = deliver_mod._payload_for(
        "entity:notify.bot", "T", "plain", "", "", "<b>rich</b>")
    assert body["message"] == "plain" and "parse_mode" not in body


# ── the positive pin ────────────────────────────────────────────────────────
def test_a_capable_entity_receives_the_html_body_on_the_rich_service(
        monkeypatch: Any) -> None:
    monkeypatch.setattr(rich_mod, "capable_entities", _capable("notify.bot"))
    session = _Session()
    _deliver(session, ["entity:notify.bot"], "<b>rich</b> body")

    assert len(session.calls) == 1
    call = session.calls[0]
    assert call["url"].endswith(rich_mod.service_path()), (
        f"a capable entity was posted to {call['url']}, not the rich service")
    assert call["json"]["message"] == "<b>rich</b> body"
    assert call["json"]["parse_mode"] == rich_mod.PARSE_MODE
    assert call["json"]["entity_id"] == "notify.bot"


def test_an_ordinary_target_is_untouched_by_any_of_this(monkeypatch: Any) -> None:
    """⚠️ THE COMMON PATH IS AN ADDITION, NOT A CHANGE. A villa with no such
    integration must send exactly what it sent before — the intersection
    payload, to the service the target names."""
    monkeypatch.setattr(rich_mod, "capable_entities", _capable())  # none capable
    session = _Session()
    _deliver(session, ["notify.mobile_app_phone"], "<b>rich</b> body")

    assert session.calls[0]["json"] == {"title": "Daily report",
                                        "message": "plain body"}
    assert "telegram" not in session.calls[0]["url"]


def test_a_service_target_is_never_upgraded_even_on_a_capable_villa(
        monkeypatch: Any) -> None:
    """⚠️ THE RICH SERVICE TAKES `entity_id` AND HAS NO `target` FIELD, so a
    legacy notify SERVICE has no route there. Upgrading one would 400 at
    delivery time — long after the operator chose it."""
    monkeypatch.setattr(rich_mod, "capable_entities", _capable("notify.bot"))
    session = _Session()
    _deliver(session, ["notify.bot"], "<b>rich</b> body")  # no entity: prefix

    assert not session.calls[0]["url"].endswith(rich_mod.service_path())
    assert "parse_mode" not in session.calls[0]["json"]


def test_no_rich_body_means_the_registry_is_never_even_asked(
        monkeypatch: Any) -> None:
    """⚠️ A PREVIEW, OR A VILLA THAT COMPOSES NO HTML, PAYS NOTHING. The lookup
    is a websocket round trip; putting it in front of every delivery would add
    a way for a report to fail that did not exist before."""
    asked = {"n": 0}

    async def counting(session: Any, *, now: Optional[float] = None) -> "frozenset[str]":
        asked["n"] += 1
        return frozenset()

    monkeypatch.setattr(rich_mod, "capable_entities", counting)
    _deliver(_Session(), ["entity:notify.bot"], "")  # no html body
    assert asked["n"] == 0


# ── one owner for the dialect ───────────────────────────────────────────────
def test_the_alert_path_and_the_briefing_share_one_parse_mode() -> None:
    """⚠️ TWO SPELLINGS OF "html" IS HOW AN ALERT AND A BRIEFING COME TO
    DISAGREE about how they are parsed. `buttons` re-exports rather than
    restates, so this is an identity check, not a comparison of two literals."""
    from vesta.supervise.agent import buttons as buttons_mod
    assert buttons_mod.PARSE_MODE is rich_mod.PARSE_MODE
    assert buttons_mod.PLATFORM is rich_mod.PLATFORM


def test_the_registry_lookup_has_exactly_one_implementation() -> None:
    """⚠️ `grep -L`, NOT `grep -l`. Two caches for one registry question is the
    defect this project has paid for repeatedly; `buttons` must DELEGATE, not
    keep a copy that ages differently."""
    import inspect
    src = inspect.getsource(
        __import__("vesta.supervise.agent.buttons", fromlist=["x"]))
    assert "config/entity_registry/list" not in src, (
        "buttons reads the entity registry again — that is a second cache with "
        "its own TTL and its own failure direction for one fact")
    assert "rich_mod.capable_entities" in src, (
        "buttons no longer delegates the lookup")


# ── the platform name and the payload have ONE owner ────────────────────────
def test_the_platform_name_is_declared_once_and_read_everywhere() -> None:
    """⚠️ /dry-audit Part 3, 2026-08-29. `rich.py` claimed the platform name
    lived there "and nowhere else" while it was a literal in seven places
    across three modules — a sentence written by generalising from the two
    constants in view. The tree was changed to match the claim; this is what
    keeps them together, since prose cannot go red."""
    import os
    import re

    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    offenders = []
    for dirpath, _dirs, files in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            # the declaration itself is the one legitimate literal
            if os.path.abspath(path) == os.path.abspath(rich_mod.__file__):
                continue
            for n, line in enumerate(src.splitlines(), 1):
                if line.lstrip().startswith("#"):
                    continue          # prose may name it; only CODE may not
                if re.search(r'"telegram_bot"', line):
                    offenders.append(f"{name}:{n}")

    assert not offenders, (
        f"the platform name is a literal outside its declaration: {offenders}. "
        "Read `rich.PLATFORM` — one owner, or the next rename misses one.")


def test_the_rich_payload_has_more_than_one_caller() -> None:
    """⚠️ ITS DOCSTRING SAYS "FOR BOTH CALLERS" — the `keyboard` parameter
    exists only for the agent's send. For one day it had a single caller and
    the parameter was dead, which is a claim and an export rotting together."""
    import os
    import re

    callers = set()
    root = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "vesta")
    for dirpath, _dirs, files in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for name in files:
            if not name.endswith(".py") or name == "rich.py":
                continue
            with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                if re.search(r"rich_mod\.payload\(", fh.read()):
                    callers.add(name)

    assert len(callers) >= 2, (
        f"only {sorted(callers) or 'nothing'} builds the rich payload through "
        "its owner; the other sender assembles the fields inline, so the two "
        "can disagree about parse_mode")


def test_the_button_only_services_stay_out_of_adapters() -> None:
    """⚠️ THE DELIBERATE NON-CONVERGENCE, RECORDED SO THE NEXT AUDIT DOES NOT
    "FINISH THE JOB". Answering a press and editing a keyboard have no briefing
    counterpart; moving them here would make an adapter the briefing depends on
    own the agent's button mechanics."""
    # ⚠️ STRING LITERALS IN THE AST, NOT `in src` — this module's own docstring
    # NAMES all three while explaining why they are absent, so a substring
    # search over the source reports the opposite of the truth. /dry-audit
    # step 7's comment trap, hit twice in two days by pins written to guard
    # against exactly this kind of drift.
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(rich_mod))
    literals = {n.value for n in ast.walk(tree)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    docstrings = {ast.get_docstring(n) for n in ast.walk(tree)
                  if isinstance(n, (ast.Module, ast.FunctionDef,
                                    ast.AsyncFunctionDef, ast.ClassDef))}
    literals -= {d for d in docstrings if d}

    for service in ("answer_callback_query", "edit_message", "edit_replymarkup"):
        assert service not in literals, (
            f"{service} moved into adapters — it is a button operation, and "
            "the briefing has no use for it")


def test_the_payload_carries_the_keyboard_it_was_given() -> None:
    """⚠️ FOUND BY MUTATION, NOT BY REVIEW (/dry-audit, 2026-08-29). Replacing
    the keyboard branch with `if False` — so every alert ships with no buttons
    at all — left 89 tests green. The suite pinned that the agent CALLS this
    builder and that the briefing passes no keyboard, and nothing checked that
    a keyboard handed in ever reaches the wire. The whole button subsystem
    hung off an unasserted branch."""
    rows = [[["✅", "vd:c1"], ["\U0001F6AB", "vx:c1"]]]
    body = rich_mod.payload("notify.bot", "T", "<b>b</b>", rows)
    assert body["inline_keyboard"] == [[["✅", "vd:c1"], ["\U0001F6AB", "vx:c1"]]], (
        "the keyboard handed to the payload builder never reached it — every "
        "alert would arrive with no buttons")

    # ⚠️ AND ABSENT, NOT EMPTY, WHEN THERE IS NONE. `inline_keyboard: []` is a
    # field the service must still parse; the briefing sends no keyboard at all.
    assert "inline_keyboard" not in rich_mod.payload("notify.bot", "T", "b")
