"""The conversation: who may speak, what is remembered, and for how long.

⚠️ THE MOST IMPORTANT TEST HERE IS THE STALE ONE. Telegram queues undelivered
updates for ~24 h, so the moment polling starts — after any restart or platform
change — the backlog replays. Observed at this property on 2026-08-22: three
`telegram_text` events arrived at once, typed hours earlier. An agent that
answers those replies to a question the owner has forgotten asking, about a
villa state that no longer exists.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Mapping

import pytest

from agent import chat, policy
from agent.tools import reply as reply_mod


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch) -> None:
    chat.reset()
    # ⚠️ WITHOUT THIS THE AUDIT WRITES GO TO /data AND FAIL SILENTLY — `_append`
    # swallows, by design — so every assertion about a row would read an empty
    # list and pass vacuously.
    from agent import audit as audit_mod
    from agent import budget as budget_mod
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "audit.json"))
    # ⚠️ THE BUDGET PERSISTS TOO. Patching only the audit left three tests
    # failing on a PermissionError about the VILLA's /data path — the third
    # time this session that a rule was applied to the site in view instead of
    # to everything it applies to.
    monkeypatch.setattr(budget_mod, "BUDGET_FILE", str(tmp_path / "budget.json"))
    monkeypatch.setattr(budget_mod, "_BREAKER", None)
    chat.forget_targets()


def _event(**over: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {"text": "why?", "chat_id": 111, "user_id": 222,
                            "from_first": "Sam", "date": int(time.time())}
    data.update(over)
    return {"event_type": "telegram_text", "data": data}


# ── parsing ─────────────────────────────────────────────────────────────────
def test_a_telegram_text_event_becomes_a_message() -> None:
    msg = chat.parse(_event())
    assert msg is not None
    assert msg.chat_id == "111" and msg.sender_id == "222"
    assert msg.text == "why?" and msg.sender_name == "Sam"
    assert msg.thread_key == "telegram:111"


def test_another_event_type_is_not_ours() -> None:
    assert chat.parse({"event_type": "state_changed", "data": {}}) is None
    assert chat.parse(_event(text="   ")) is None, "empty text is not a turn"
    assert chat.parse(_event(chat_id=None)) is None
    assert chat.parse(_event(user_id=None)) is None
    assert chat.parse({"event_type": "telegram_text", "data": None}) is None


def test_the_date_is_read_from_either_place() -> None:
    """⚠️ `telegram_callback` nests its timestamp under `message.date` while
    the flat fields sit at the top; `telegram_text`'s payload was never
    captured, so both are tried rather than one being guessed."""
    flat = chat.parse(_event(date=1700000000))
    nested = chat.parse(_event(date=None, message={"date": 1700000000}))
    assert flat is not None and nested is not None
    assert flat.sent_at == nested.sent_at == 1700000000


def test_an_unreadable_date_is_zero_not_now() -> None:
    """0 means "not stated" and routes to the connection-age rule; coercing it
    to `now` would silently defeat the backlog guard."""
    msg = chat.parse(_event(date="yesterday"))
    assert msg is not None and msg.sent_at == 0


# ── the backlog guard ───────────────────────────────────────────────────────
def test_a_message_typed_hours_ago_is_NOT_answered() -> None:
    now = 1_700_000_000.0
    old = chat.Message(chat_id="1", sender_id="2", text="why?",
                       sent_at=int(now) - 6 * 3600)
    assert chat.is_fresh(old, connected_since=now - 5, now=now) is False


def test_a_message_typed_just_now_IS_answered() -> None:
    now = 1_700_000_000.0
    fresh = chat.Message(chat_id="1", sender_id="2", text="why?",
                         sent_at=int(now) - 5)
    assert chat.is_fresh(fresh, connected_since=now - 5, now=now) is True


def test_a_DATELESS_message_is_dropped_only_inside_the_backlog_window() -> None:
    """⚠️ THE SECOND RULE, AND IT IS NOT REDUNDANT.

    Keeping only the date rule trusts a field name nobody has verified, so a
    rename makes every message look fresh. Keeping only this rule answers every
    hours-old message that arrives a minute after a restart. Both, or one of
    the two failure modes is reachable.
    """
    now = 1_700_000_000.0
    dateless = chat.Message(chat_id="1", sender_id="2", text="why?", sent_at=0)
    # A second after subscribing: this is exactly when a backlog arrives.
    assert chat.is_fresh(dateless, connected_since=now - 1, now=now) is False
    # Ten minutes in: the backlog is long drained, so it is a live message.
    assert chat.is_fresh(dateless, connected_since=now - 600, now=now) is True


def test_a_dateless_message_with_no_connection_time_is_answered() -> None:
    """Unknown connection age must not make chat dead — that is the failure
    mode the second rule exists to avoid, not to cause."""
    msg = chat.Message(chat_id="1", sender_id="2", text="hi", sent_at=0)
    assert chat.is_fresh(msg, connected_since=0.0, now=1_700_000_000.0) is True


# ── who may speak ───────────────────────────────────────────────────────────
def test_an_unlisted_sender_resolves_to_nobody() -> None:
    assert policy.sender_role({}, channel="telegram", sender_id="222") == ""
    assert policy.sender_role({"allowed_senders": {}},
                              channel="telegram", sender_id="222") == ""


def test_a_listed_sender_gets_their_role() -> None:
    # ⚠️ `ops` IS THE FACILITY MANAGER — the app's own profile id, per
    # `src/auth/roles.ts`. This fixture said `facility`, which is an AUDIENCE
    # word and was never a profile; the picker offering it was the bug.
    cfg = {"allowed_senders": {"telegram:222": "owner",
                               "telegram:333": "ops",
                               "telegram:444": "guest"}}
    assert policy.sender_role(cfg, channel="telegram", sender_id="222") == "owner"
    assert policy.sender_role(cfg, channel="telegram", sender_id=333) == "ops"
    assert policy.sender_role(cfg, channel="telegram", sender_id=444) == "guest"


def test_the_key_carries_the_CHANNEL_not_just_the_id() -> None:
    """⚠️ A Telegram user id and a future WhatsApp id are integers from
    different namespaces and would eventually collide, granting one person's
    role to a stranger on another platform."""
    cfg = {"allowed_senders": {"telegram:222": "owner"}}
    assert policy.sender_role(cfg, channel="whatsapp", sender_id="222") == ""


def test_an_unknown_role_is_NOBODY_not_a_default_one() -> None:
    """Defaulting would grant some access to a typo."""
    for junk in ("admin", "Owner ", "", "facility", None, 7, ["owner"]):
        cfg = {"allowed_senders": {"telegram:222": junk}}
        got = policy.sender_role(cfg, channel="telegram", sender_id="222")
        assert got in ("", "owner"), got
    assert policy.sender_role({"allowed_senders": {"telegram:222": "admin"}},
                              channel="telegram", sender_id="222") == ""
    # ⚠️ `facility` IS NOT A PROFILE and must resolve to nobody — it is the
    # audience word, and admitting it here is what let one person have two
    # names.
    assert policy.sender_role({"allowed_senders": {"telegram:222": "facility"}},
                              channel="telegram", sender_id="222") == ""


def test_a_role_is_matched_case_and_space_insensitively() -> None:
    cfg = {"allowed_senders": {"telegram:222": "  Owner "}}
    assert policy.sender_role(cfg, channel="telegram", sender_id="222") == "owner"


def test_resolving_a_sender_takes_no_message_and_so_cannot_read_one() -> None:
    """⚠️ STRUCTURAL, NOT A CONVENTION. The chat channel is the one place an
    attacker can inject text, so nothing in a message may influence which role
    it is treated as. The function has no parameter for one."""
    import inspect
    params = set(inspect.signature(policy.sender_role).parameters)
    assert params == {"config", "channel", "sender_id"}


def test_the_allow_list_ships_empty() -> None:
    from agent import config as agent_config
    assert agent_config.DEFAULTS["allowed_senders"] == {}
    assert "allowed_senders" in agent_config.MUST_BE_EMPTY


# ── threads ─────────────────────────────────────────────────────────────────
def test_a_thread_remembers_turns_and_caps_them() -> None:
    for i in range(chat.MAX_TURNS + 5):
        chat.record_turn("telegram:1", "user", f"m{i}")
    thread = chat.thread_for("telegram:1")
    assert len(thread.turns) == chat.MAX_TURNS
    assert thread.turns[-1].text == f"m{chat.MAX_TURNS + 4}", (
        "the NEWEST turns must survive; dropping them would make a long "
        "conversation answer its own opening line forever")


def test_a_thread_expires_and_is_not_persisted_anywhere() -> None:
    now = 1_700_000_000.0
    chat.record_turn("telegram:1", "user", "hello", now=now)
    assert chat.stats()["threads"] == 1
    chat.expire(now=now + chat.THREAD_TTL_S + 1)
    assert chat.stats()["threads"] == 0


def test_expiry_sweeps_EVERY_thread_not_just_the_one_asked_for() -> None:
    """A conversation nobody returns to would otherwise sit in memory until the
    add-on restarts — the durable log this module refuses to keep, reached by
    neglect."""
    now = 1_700_000_000.0
    chat.record_turn("telegram:1", "user", "old", now=now)
    later = now + chat.THREAD_TTL_S + 1
    chat.record_turn("telegram:2", "user", "new", now=later)
    assert chat.stats()["threads"] == 1


def _imported_names(module: Any) -> set:
    """Every module `module` imports, from its AST.

    ⚠️ AN AST WALK, NOT A SOURCE GREP, AND THAT IS NOT FASTIDIOUSNESS. A grep
    matches the module's own PROSE: the first version of the webhook test below
    failed on the word "webhook" inside the docstring explaining why there is
    no webhook. The same mistake was made once before in `test_agent_policy`
    and caught the same way.
    """
    import ast
    import inspect

    found: set = set()
    for node in ast.walk(ast.parse(inspect.getsource(module))):
        if isinstance(node, ast.Import):
            found.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            found.add(base)
            found.update(f"{base}.{a.name}" for a in node.names)
    return found


def test_nothing_in_this_module_writes_to_disk() -> None:
    """⚠️ A durable chat log is a transcript of a household — who was home, who
    asked about whom — kept on a machine in a rental villa."""
    imported = _imported_names(chat)
    for writer in ("pathlib", "os", "json", "shutil", "reports.store",
                   "reports.store.write_json"):
        assert writer not in imported, f"agent/chat.py imports {writer}"
    import ast
    import inspect
    calls = {n.func.id for n in ast.walk(ast.parse(inspect.getsource(chat)))
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "open" not in calls


# ── the concern context — what makes "why?" work ────────────────────────────
def test_a_delivered_concern_is_in_the_next_message_s_context() -> None:
    chat.note_delivered("telegram:111", "c1", "The pool pump is short-cycling")
    msg = chat.parse(_event())
    assert msg is not None
    ctx = chat.context_for(msg)
    joined = " ".join(str(m["content"]) for m in ctx)
    assert "short-cycling" in joined, (
        "a reply to an alert cannot resolve without the alert in context")
    assert ctx[-1]["content"] == "why?", "the new message must come last"


def test_a_thread_with_no_concerns_adds_no_context_line() -> None:
    msg = chat.parse(_event())
    assert msg is not None
    ctx = chat.context_for(msg)
    assert len(ctx) == 1 and ctx[0]["content"] == "why?"


def test_re_delivering_a_concern_does_not_duplicate_it() -> None:
    for _ in range(3):
        chat.note_delivered("telegram:1", "c1", "same thing")
    assert len(chat.thread_for("telegram:1").concerns) == 1


def test_concern_titles_are_made_inert_before_they_re_enter_a_prompt() -> None:
    chat.note_delivered("telegram:1", "c1", "pump_A is *down* [urgent]")
    msg = chat.Message(chat_id="1", sender_id="2", text="why?")
    joined = " ".join(str(m["content"]) for m in chat.context_for(msg))
    assert "*" not in joined and "[" not in joined and "_" not in joined


def test_concerns_are_capped() -> None:
    for i in range(chat.MAX_CONCERNS + 4):
        chat.note_delivered("telegram:1", f"c{i}", f"t{i}")
    assert len(chat.thread_for("telegram:1").concerns) == chat.MAX_CONCERNS


# ── the reply tool ──────────────────────────────────────────────────────────
def _run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_a_reply_reaches_only_the_bound_conversation() -> None:
    tool = reply_mod.build(targets=["notify.owner"], thread_key="telegram:1")
    out = _run(tool.call({"text": "The pump restarted at 06:00."}))
    assert out and out[0].get("type") == "text"
    assert tool.sent == ["The pump restarted at 06:00."]


def test_a_tool_argument_cannot_redirect_a_reply() -> None:
    """⚠️ THE ABSENCE OF THE PARAMETER IS THE ENFORCEMENT — this asserts the
    consequence: extra arguments are inert, not authoritative."""
    tool = reply_mod.build(targets=["notify.owner"], thread_key="telegram:1")
    _run(tool.call({"text": "hi", "to": "notify.stranger",
                    "chat_id": "999", "targets": ["notify.stranger"]}))
    assert tool._targets == ("notify.owner",)


def test_an_unbound_reply_tool_reaches_nobody() -> None:
    """The agent cannot START a conversation — only answer one."""
    tool = reply_mod.build(targets=[], thread_key="")
    out = _run(tool.call({"text": "unsolicited"}))
    assert "error" in out[0] and out[0]["error"]["code"] == "unavailable"
    assert tool.sent == []


def test_a_reply_is_made_inert_and_capped() -> None:
    tool = reply_mod.build(targets=["notify.owner"], thread_key="telegram:1")
    _run(tool.call({"text": "pump_A is *down* " + "x" * 9000}))
    assert tool.sent and "_" not in tool.sent[0] and "*" not in tool.sent[0]
    assert len(tool.sent[0]) <= chat.MAX_REPLY_CHARS + 1


def test_a_reply_that_flattens_to_nothing_is_refused() -> None:
    """⚠️ `"   \\n "` is truthy and pure markup flattens to nothing. Reporting a
    successful send of an empty string is a correct-looking log for a message
    nobody received — the narration layer paid for this once already."""
    tool = reply_mod.build(targets=["notify.owner"], thread_key="telegram:1")
    for junk in ("   \n  ", "***", ""):
        out = _run(tool.call({"text": junk}))
        assert "error" in out[0], f"{junk!r} was sent"
    assert tool.sent == []
    # ⚠️ AND `"[]<>"` IS **NOT** IN THAT LIST, WHICH IS THE INTERESTING HALF.
    # `inert` MAPS brackets to parentheses rather than deleting them, so it
    # flattens to `"()()"` — meaningless but non-empty, and the rule is "empty
    # after cleaning", not "meaningful". Assuming every markup character
    # vanishes is how this test first failed, and the assumption was about
    # `inert`, not about the reply path.
    assert _run(tool.call({"text": "[]<>"}))[0].get("type") == "text"


def test_a_sent_reply_joins_the_thread_as_an_assistant_turn() -> None:
    """Without this the thread holds only the human's half, and a follow-up
    reads as though the villa never answered."""
    tool = reply_mod.build(targets=["notify.owner"], thread_key="telegram:1")
    _run(tool.call({"text": "It restarted at 06:00."}))
    turns = chat.thread_for("telegram:1").turns
    assert [t.role for t in turns] == ["assistant"]
    assert turns[0].text == "It restarted at 06:00."


def test_the_reply_tool_is_not_offered_to_a_scheduled_run() -> None:
    from agent.tools import ALL_TOOLS
    assert "reply" not in {cls().name for cls in ALL_TOOLS}, (
        "an unbound reply tool teaches the model a verb it cannot use")


# ── the subscription ────────────────────────────────────────────────────────
def test_the_chat_event_is_subscribed_on_every_path() -> None:
    """⚠️ INCLUDING THE FALLBACK. A property with no VESTA blueprints must still
    be able to answer a question; the conversation has nothing to do with the
    detection layer and must not degrade with it."""
    from reports import collect
    assert "telegram_text" in collect.CHAT_EVENT_TYPES
    assert "telegram_text" in collect._with_chat(collect.FALLBACK_EVENT_TYPES)
    assert "telegram_text" in collect._with_chat(["vesta_roi_event"])


def test_the_chat_event_is_not_duplicated() -> None:
    from reports import collect
    got = collect._with_chat(["telegram_text", "vesta_roi_event"])
    assert got.count("telegram_text") == 1


def test_no_webhook_and_no_port_were_added() -> None:
    """⚠️ Inbound rides the websocket collect.py already holds. A webhook would
    need a public URL and an inbound hole through the tunnel.

    ⚠️ AST, NOT A GREP — the first version of this test failed on the word
    "webhook" inside the docstring saying there is no webhook.
    """
    imported = _imported_names(chat)
    for server in ("aiohttp", "aiohttp.web", "http.server", "socket",
                   "socketserver"):
        assert server not in imported, f"agent/chat.py imports {server}"


# ── the whole path, with no network ─────────────────────────────────────────
def _handle(event: Dict[str, Any], **kw: Any) -> str:
    from fake_provider import FakeProvider, says

    kw.setdefault("session", None)
    kw.setdefault("provider", FakeProvider([says("The pump is fine.")]))
    kw.setdefault("model", "m")
    kw.setdefault("targets", ["notify.owner"])
    kw.setdefault("config", {"enabled": True,
                             "triggers": {"chat": True},
                             "allowed_senders": {"telegram:222": "owner"}})
    return asyncio.run(chat.handle_event(event, **kw))


def test_a_message_from_a_listed_sender_produces_a_run() -> None:
    got = _handle(_event())
    assert got.startswith("answered"), got
    assert "notify.owner" in got, (
        f"the outcome does not say where the answer went: {got!r} — "
        f'"it worked" and "you got nothing" must not be the same line')


def test_the_chat_trigger_switch_stops_it_before_anything_costs_anything() -> None:
    got = _handle(_event(), config={"enabled": True,
                                    "triggers": {"chat": False},
                                    "allowed_senders": {"telegram:222": "owner"}})
    assert got == "chat trigger disabled"


def test_the_master_switch_stops_it_too() -> None:
    got = _handle(_event(), config={"enabled": False,
                                    "triggers": {"chat": True},
                                    "allowed_senders": {"telegram:222": "owner"}})
    assert got == "chat trigger disabled"


def test_an_unlisted_sender_gets_no_run_and_no_reply() -> None:
    """TEST-029. ⚠️ EXACTLY ONE AUDIT ROW AND NO REPLY — silence is the answer,
    because an error reply confirms the bot is live to whoever is probing it."""
    from agent import audit as audit_mod

    before = len(audit_mod.rows(500))
    assert _handle(_event(), config={"enabled": True,
                                     "triggers": {"chat": True},
                                     "allowed_senders": {}}) == "sender not allowed"
    rows = audit_mod.rows(500)[before:]
    assert len(rows) == 1, f"expected one audit row, got {len(rows)}"
    assert rows[0]["verdict"] == "refused"
    assert "222" not in str(rows[0]), (
        "the row must not record the prober's id verbatim")


def test_a_replayed_backlog_message_is_refused_before_the_model() -> None:
    got = _handle(_event(date=int(time.time()) - 6 * 3600))
    assert got.startswith("message too old to answer"), got
    # ⚠️ AND IT SAYS WHICH RULE AND BY HOW MUCH. The bare string was
    # indistinguishable from a FRESH message dropped by the dateless backlog
    # window, which is the bug that made this instrument worth widening.
    assert "sent 21600s ago" in got and "limit 900s" in got, got


def test_no_provider_means_no_run_rather_than_a_crash() -> None:
    assert _handle(_event(), provider=None) == "no model provider configured"


def test_the_checks_run_in_the_order_that_costs_least() -> None:
    """⚠️ A message that is BOTH stale AND from an unlisted sender must report
    the cheaper refusal, or the order has been changed to read a message before
    deciding whether its sender may be listened to."""
    got = _handle(_event(date=int(time.time()) - 6 * 3600),
                  config={"enabled": True, "triggers": {"chat": True},
                          "allowed_senders": {}})
    assert got.startswith("message too old to answer"), got


def test_the_reply_tool_is_offered_only_on_the_chat_path() -> None:
    from fake_provider import FakeProvider, says

    seen: List[List[str]] = []

    class Watching(FakeProvider):
        async def run(self, **kw: Any) -> Any:
            seen.append([t["name"] for t in kw["tools"]])
            return await super().run(**kw)

    _handle(_event(), provider=Watching([says("ok")]))
    assert seen and "reply" in seen[0]


def test_adding_the_reply_tool_does_not_mutate_the_shared_registry() -> None:
    """⚠️ A mutated registry would leave a binding to whoever last messaged the
    villa in place for every later run, including scheduled briefs."""
    from agent.registry import build_registry
    from agent.tools import reply as reply_mod

    base = build_registry()
    before = set(base.names)
    widened = base.with_tool(reply_mod.build(targets=["notify.a"]))
    assert set(base.names) == before, "the shared registry was mutated"
    assert "reply" in set(widened.names)


# ── a decline is spoken, not swallowed ──────────────────────────────────────
def test_a_declined_run_TELLS_the_person_who_asked() -> None:
    """⚠️ THE PERSON WHO TYPED THE QUESTION IS THE INSTRUMENT.

    They cannot read the add-on log, so an unspoken decline is
    indistinguishable from a broken bot — they retry, which costs another turn
    and another refusal. Measured on the real villa: a spent API balance
    declined every message and nothing was said at all.
    """
    from fake_provider import FakeProvider, declines

    sent: List[str] = []

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = Recording  # type: ignore[misc]
    try:
        got = _handle(_event(),
                      provider=FakeProvider([declines("no credit left")]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert got.startswith("declined"), got
    assert sent and "could not answer" in sent[0]
    assert "no credit left" in sent[0], (
        "the reason was dropped, so the reader learns nothing actionable")


def test_a_successful_run_does_not_ALSO_send_a_decline() -> None:
    from fake_provider import FakeProvider, says

    sent: List[str] = []

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = Recording  # type: ignore[misc]
    try:
        assert _handle(_event(),
                       provider=FakeProvider([says("fine")])).startswith("answered")
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]
    assert not any("could not answer" in m for m in sent)


def test_an_UNLISTED_sender_is_never_told_anything() -> None:
    """⚠️ THE SILENCE RULE STILL HOLDS WHERE IT WAS WRITTEN FOR. It protects
    against a stranger learning the bot is live; it was never about hiding a
    fault from the owner. This is the boundary between the two."""
    from fake_provider import FakeProvider, declines

    sent: List[str] = []

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = Recording  # type: ignore[misc]
    try:
        got = _handle(_event(),
                      provider=FakeProvider([declines("no credit left")]),
                      config={"enabled": True, "triggers": {"chat": True},
                              "allowed_senders": {}})
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]
    assert got == "sender not allowed"
    assert sent == [], "a stranger was told the bot exists"


# ── who the answer goes to ──────────────────────────────────────────────────
class _Registry:
    """A fake HassClient serving one entity-registry listing."""

    def __init__(self, entries: List[Dict[str, Any]]) -> None:
        self.entries = entries
        self.calls = 0

    async def __aenter__(self) -> "_Registry":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def command(self, name: str, **_kw: Any) -> Any:
        assert name == "config/entity_registry/list"
        self.calls += 1
        return self.entries


REGISTRY_ROWS = [
    {"entity_id": "notify.bot_private", "platform": "telegram_bot",
     "unique_id": "8859711452_765979167"},
    {"entity_id": "notify.bot_group", "platform": "telegram_bot",
     "unique_id": "8859711452_-1003932943049"},
    {"entity_id": "notify.a_phone", "platform": "mobile_app",
     "unique_id": "8859711452_765979167"},
]


def _resolve(chat_id: str, rows: Any = None) -> str:
    import reports.hass as hass_mod

    fake = _Registry(REGISTRY_ROWS if rows is None else rows)
    original = hass_mod.HassClient
    hass_mod.HassClient = lambda session: fake   # type: ignore[assignment,misc]
    try:
        return asyncio.run(chat.target_for(None, chat_id))
    finally:
        hass_mod.HassClient = original           # type: ignore[assignment]


def test_a_private_chat_resolves_to_its_own_notify_entity() -> None:
    """⚠️ THE FIX FOR AN ANSWER THAT WENT TO THE WRONG ROOM. Measured on the
    villa: a question asked in a private chat was answered in the group,
    because the target came from the BRIEFING configuration."""
    assert _resolve("765979167") == "entity:notify.bot_private"


def test_the_resolved_target_is_ENTITY_ADDRESSED() -> None:
    """⚠️ `deliver.py` PREDICTED THIS BUG IN A COMMENT AND I DID NOT READ IT.

    "A service and an entity are the same shape … calling one the other way
    404s or 400s at delivery time." A bare `notify.x` is posted to the legacy
    service `notify/x`, which does not exist on the entity platform. Measured:
    the answer was composed, routed to the correct chat, and refused —
    `delivery to notify.living_room_… failed: HTTP 400`.

    What `target_for` resolves comes OUT OF THE ENTITY REGISTRY, so it is an
    entity by construction and returns the addressed form rather than leaving
    each caller to remember.
    """
    from reports import deliver

    got = _resolve("765979167")
    assert got.startswith(deliver.ENTITY_PREFIX), got
    assert deliver._service_path(got) == deliver.ENTITY_SERVICE, (
        "the target does not route through the entity service, so Home "
        "Assistant is asked to call a service by that name")
    body = deliver._payload_for(got, "", "hello")
    assert body["entity_id"] == "notify.bot_private", (
        "the entity id never reaches the payload")


def test_a_GROUP_chat_id_is_negative_and_still_resolves() -> None:
    """⚠️ `rsplit`, NOT `split`, AND THIS IS THE CASE THAT PROVES IT.

    HA stamps `unique_id` as `<bot_id>_<chat_id>` and a group's chat id is
    NEGATIVE — `8859711452_-1003932943049`. Splitting on the FIRST underscore
    compares the bot id, which matches nothing at best and one arbitrary chat
    at worst.
    """
    assert _resolve("-1003932943049") == "entity:notify.bot_group"


def test_an_unknown_chat_resolves_to_NOTHING_rather_than_a_guess() -> None:
    """⚠️ THE SECURITY PROPERTY. The chat id is a LOOKUP KEY into a set Home
    Assistant was configured with, never an address — so an invented one
    reaches nobody and the caller falls back, rather than a stranger's id
    addressing the first entity in the list."""
    assert _resolve("999999999") == ""


def test_only_the_telegram_platform_is_considered() -> None:
    """A mobile_app entity sharing the numeric suffix must not be picked."""
    assert _resolve("765979167") == "entity:notify.bot_private"


def test_an_unreadable_registry_falls_back_rather_than_raising() -> None:
    import reports.hass as hass_mod

    class _Broken:
        async def __aenter__(self) -> "_Broken":
            raise RuntimeError("core is restarting")

        async def __aexit__(self, *exc: Any) -> None:
            return None

    original = hass_mod.HassClient
    hass_mod.HassClient = lambda session: _Broken()  # type: ignore[assignment,misc]
    try:
        assert asyncio.run(chat.target_for(None, "765979167")) == ""
    finally:
        hass_mod.HassClient = original               # type: ignore[assignment]


def test_the_lookup_is_cached_rather_than_asked_per_message() -> None:
    """The registry changes when somebody adds a chat to the bot, which is
    rare; a websocket round trip per message is a cost with no answer."""
    import reports.hass as hass_mod

    fake = _Registry(REGISTRY_ROWS)
    original = hass_mod.HassClient
    hass_mod.HassClient = lambda session: fake       # type: ignore[assignment,misc]
    try:
        for _ in range(3):
            assert asyncio.run(
                chat.target_for(None, "765979167")) == "entity:notify.bot_private"
    finally:
        hass_mod.HassClient = original               # type: ignore[assignment]
    assert fake.calls == 1, f"asked the registry {fake.calls} times"


def test_a_PROSE_answer_is_delivered_even_though_no_tool_was_called() -> None:
    """⚠️ THE BUG THAT COST THE WHOLE FEATURE, AND EVERY INSTRUMENT SAID
    SUCCESS.

    A model asked a question answers in prose; it does not call a tool to
    speak. `run_loop` returns that prose in `result.text` and stops — and
    nothing sent it. The villa logged `answered`, the run had genuinely read
    the question, called tools and reasoned, and the reply reached NOBODY in
    either chat.
    """
    from fake_provider import FakeProvider, says

    sent: List[str] = []

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = Recording  # type: ignore[misc]
    try:
        got = _handle(_event(),
                      provider=FakeProvider([says("The pump is fine.")]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert got.startswith("answered"), got
    assert sent == ["The pump is fine."], (
        f"the answer was never delivered: {sent}")


def test_an_answer_the_model_ALREADY_replied_is_not_sent_twice() -> None:
    """⚠️ The model has a `reply` tool and may use it mid-run — say something
    now, keep working. Sending `result.text` unconditionally would answer
    twice, which reads as a stutter and bills twice for one question."""
    from fake_provider import FakeProvider, asks, says

    sent: List[str] = []

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = Recording  # type: ignore[misc]
    try:
        _handle(_event(), provider=FakeProvider([
            asks("reply", {"text": "Looking now."}),
            says("Looking now."),
        ]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert sent == ["Looking now."], f"answered twice: {sent}"


# ── naming the chats, so nobody copies a number ─────────────────────────────
def _chats(rows: Any = None, states: Any = None) -> List[Any]:
    import reports.hass as hass_mod

    class _Both(_Registry):
        async def command(self, name: str, **_kw: Any) -> Any:
            self.calls += 1
            if name == "get_states":
                return states if states is not None else [
                    {"entity_id": "notify.bot_private",
                     "attributes": {"friendly_name": "Jm"}},
                    {"entity_id": "notify.bot_group",
                     "attributes": {"friendly_name": "TheLysHouse"}},
                ]
            return self.entries

    fake = _Both(REGISTRY_ROWS if rows is None else rows)
    original = hass_mod.HassClient
    hass_mod.HassClient = lambda session: fake   # type: ignore[assignment,misc]
    try:
        return asyncio.run(chat.known_chats(None))
    finally:
        hass_mod.HassClient = original           # type: ignore[assignment]


def test_a_chat_is_offered_by_its_NAME() -> None:
    """Asked for directly: not a numeric id copied out of a raw payload."""
    found = _chats()
    assert [c.name for c in found] == ["Jm"]
    assert found[0].chat_id == "765979167"


def test_a_GROUP_is_NOT_offered_and_the_exclusion_is_correctness() -> None:
    """⚠️ `allowed_senders` KEYS ON WHO SPEAKS; A NOTIFY ENTITY GIVES WHERE.

    In a private chat those are the same number — verified on the reference
    villa, 765979167 for both. In a group they differ: the chat id names the
    room, the user id names whichever member typed. Offering a group would
    store a value that can never match a sender, and it would fail SILENTLY —
    the bot would go on ignoring everybody, which looks exactly like an empty
    list.

    ⚠️ Discriminated on TELEGRAM'S OWN CONVENTION — private ids are positive,
    groups negative — rather than on the name, because a name is whatever
    somebody typed.
    """
    assert all(not c.chat_id.startswith("-") for c in _chats())
    assert "TheLysHouse" not in [c.name for c in _chats()]


def test_the_name_comes_from_the_STATE_not_the_registry() -> None:
    """⚠️ Both registry entries on the reference villa carry `name: null` and
    `original_name: null`; the human label lives in the state's
    `friendly_name`. Checked against the running instance rather than assumed,
    which is how the last four bugs in this feature were found."""
    found = _chats(states=[{"entity_id": "notify.bot_private",
                            "attributes": {"friendly_name": "Jean-Marie"}}])
    assert found[0].name == "Jean-Marie"


def test_a_chat_with_no_friendly_name_falls_back_to_its_entity_id() -> None:
    """Never blank: a nameless row is unpickable and looks like a bug."""
    found = _chats(states=[])
    assert found[0].name == "notify.bot_private"


def test_each_chat_carries_a_target_deliver_can_actually_use() -> None:
    from reports import deliver

    found = _chats()
    assert found[0].target.startswith(deliver.ENTITY_PREFIX)
    assert deliver._service_path(found[0].target) == deliver.ENTITY_SERVICE


def test_an_unreachable_core_yields_an_EMPTY_list_not_an_error() -> None:
    """The panel falls back to typing the number, which is what existed
    before — a villa whose core is restarting must not lose the editor."""
    import reports.hass as hass_mod

    class _Broken:
        async def __aenter__(self) -> "_Broken":
            raise RuntimeError("core is restarting")

        async def __aexit__(self, *exc: Any) -> None:
            return None

    original = hass_mod.HassClient
    hass_mod.HassClient = lambda session: _Broken()  # type: ignore[assignment,misc]
    try:
        assert asyncio.run(chat.known_chats(None)) == []
    finally:
        hass_mod.HassClient = original               # type: ignore[assignment]


# ── how long an answer may be ───────────────────────────────────────────────
def test_the_chat_path_HAS_a_system_prompt() -> None:
    """⚠️ IT HAD NONE — only the villa document — so the model had nothing
    telling it who it was talking to or how long an answer should be, and
    replied to a two-part question about a pump with forty lines about its own
    plumbing. Reported from the phone."""
    import inspect
    source = inspect.getsource(chat.handle_event)
    assert '"text": SYSTEM' in source, "the chat run sends no system prompt"


def test_the_prompt_demands_brevity_in_a_checkable_way() -> None:
    flat = " ".join(chat.SYSTEM.split())
    assert "Six is the most you may ever send" in flat
    assert "Lead with the answer" in flat
    assert "do not list the tools you used" in flat


def test_the_cap_is_an_EDITORIAL_bound_not_a_transport_one() -> None:
    """⚠️ 3,500 was Telegram's ~4,096 limit with headroom, so it only ever
    stopped a message being REJECTED — never one being unreadable."""
    assert chat.MAX_REPLY_CHARS <= 1_500, (
        "the cap is back at transport size; a phone screen is the bound")


def test_the_prompt_carries_no_clock_and_no_villa() -> None:
    """It sits above the cache breakpoint on every chat turn."""
    import re
    assert not re.search(r"\d{4}-\d{2}-\d{2}|\{[a-z_]+\}", chat.SYSTEM)


# ── the reply tool and the decline notice are the same channel ───────────────
def _recording(sent: List[str]) -> Any:
    """A ReplyTool subclass that records instead of delivering."""

    class Recording(reply_mod.ReplyTool):
        async def _send(self, body: str) -> bool:
            sent.append(body)
            return True

    return Recording


def test_a_reply_ALREADY_SENT_is_not_followed_by_an_apology() -> None:
    """⚠️ ONE RUN, TWO MESSAGES, THE SECOND ONE WRONG. Measured on the villa:
    the model answered through the `reply` tool, its next turn had nothing to
    add, and the decline branch sent "I could not answer that" on top of a
    correct answer. Telling a reader to distrust what they just read is worse
    than saying nothing."""
    from fake_provider import FakeProvider, asks, declines

    sent: List[str] = []
    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = _recording(sent)  # type: ignore[misc]
    try:
        _handle(_event(), provider=FakeProvider([
            asks("reply", {"text": "Both gym lights are off."}),
            declines("the provider returned nothing usable")]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert sent, "the reply itself never went out"
    assert "Both gym lights are off." in sent[0]
    assert not any("could not answer" in m for m in sent), (
        f"an answer was delivered and then contradicted: {sent}")


def test_a_decline_AFTER_a_partial_reply_still_says_it_stopped() -> None:
    """⚠️ NEITHER BRANCH IS SILENT. Suppressing the notice outright would leave
    somebody who got a mid-run "working on it" waiting forever — the silence
    rule this branch was written for, broken by its own fix."""
    from fake_provider import FakeProvider, asks, declines

    sent: List[str] = []
    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = _recording(sent)  # type: ignore[misc]
    try:
        _handle(_event(), provider=FakeProvider([
            asks("reply", {"text": "Looking into the pump now."}),
            declines("this investigation ran out of time")]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert len(sent) == 2, f"the decline was swallowed: {sent}"
    assert "ran out of time" in sent[1], sent[1]


def test_an_ANSWERED_run_that_said_nothing_is_still_not_silence() -> None:
    """⚠️ THE SILENCE RULE DOES NOT CARE WHICH STATUS PRODUCED IT. A model that
    ends its turn with no prose and never called `reply` leaves the asker
    staring at a bot that read their message and ignored it."""
    from fake_provider import FakeProvider, says

    sent: List[str] = []
    original = reply_mod.ReplyTool
    reply_mod.ReplyTool = _recording(sent)  # type: ignore[misc]
    try:
        _handle(_event(), provider=FakeProvider([says("")]))
    finally:
        reply_mod.ReplyTool = original  # type: ignore[misc]

    assert sent, "the run answered with nothing and nobody was told"


# ── the message date: present, correctly named, and the WRONG TYPE ───────────
def _utc_now() -> "Any":
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc)


def test_HOME_ASSISTANT_SENDS_A_DATETIME_NOT_AN_EPOCH() -> None:
    """⚠️ THE DEFECT. `telegram_bot` passes python-telegram-bot's
    `message.date` through, which is a `datetime` — so `int(str(raw))` raised
    and EVERY message parsed as dateless from the day this was written. The
    comment above BACKLOG_GRACE_S guessed the field might be "absent or spelled
    differently"; it is neither, it is a different TYPE."""
    now = _utc_now()
    assert chat._epoch_of(now) == int(now.timestamp())
    assert chat._epoch_of(str(now)) == int(now.timestamp()), (
        "the datetime's str() form is exactly what the old parser was fed")


def test_every_shape_a_platform_might_send_reads_as_the_same_instant() -> None:
    now = _utc_now()
    want = int(now.timestamp())
    for shape in (now, str(now), int(now.timestamp()), str(int(now.timestamp())),
                  now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  now.strftime("%Y-%m-%d %H:%M:%S")):
        assert chat._epoch_of(shape) == want, f"{shape!r} read as a different time"


def test_a_naive_datetime_is_UTC_not_the_villa_s_local_time() -> None:
    """⚠️ Telegram's convention for this field is UTC. Reading it as local time
    shifts every message by the villa's offset — eight hours at this property,
    i.e. permanently stale one way and permanently fresh the other."""
    import datetime as dt
    naive = "2026-08-24 07:47:00"
    want = int(dt.datetime(2026, 8, 24, 7, 47, tzinfo=dt.timezone.utc).timestamp())
    assert chat._epoch_of(naive) == want


def test_an_unreadable_date_is_still_UNSTATED_rather_than_now() -> None:
    """Defaulting a junk date to "fresh" would defeat the backlog guard."""
    for junk in (None, "", "not a date", True, -1):
        assert chat._epoch_of(junk) == 0, junk


def test_a_FRESH_message_just_after_a_RESTART_is_answered() -> None:
    """⚠️ THE REPORTED SYMPTOM: restart the add-on, ask a question, get silence.
    The dateless fallback drops anything arriving inside BACKLOG_GRACE_S, which
    fires exactly once per restart — on whoever asks first, i.e. the person
    testing the build they just installed, every single time."""
    now = _utc_now()
    message = chat.parse({"event_type": "telegram_text",
                          "data": {"text": "how many fans are on?",
                                   "chat_id": 1, "user_id": 2, "date": now}})
    assert message is not None and message.sent_at > 0
    assert chat.is_fresh(message, connected_since=now.timestamp() - 5,
                         now=now.timestamp()), (
        "a question asked seconds after a restart was dropped as a backlog")


def test_a_REPLAYED_BACKLOG_message_is_still_refused() -> None:
    """The guard must keep doing its job: an hours-old message replayed after a
    reconnect is answered by nobody."""
    import datetime as dt
    now = _utc_now()
    old = now - dt.timedelta(hours=3)
    message = chat.parse({"event_type": "telegram_text",
                          "data": {"text": "is the pump ok?",
                                   "chat_id": 1, "user_id": 2, "date": old}})
    assert not chat.is_fresh(message, connected_since=now.timestamp() - 5,
                             now=now.timestamp())


def test_the_refusal_NAMES_WHICH_RULE_fired_and_by_how_much() -> None:
    """⚠️ "Too old to answer" is true of a message typed three hours ago AND of
    a fresh one arriving 43 s after a restart, and those need opposite fixes.
    One line for both is the shape of instrument this repo has paid for."""
    import inspect
    src = inspect.getsource(chat.handle_event)
    assert "no readable date" in src, "the two rules log identically"
    assert "backlog window" in src and "limit {MAX_MESSAGE_AGE_S}" in src
