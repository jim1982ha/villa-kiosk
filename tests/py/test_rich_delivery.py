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
