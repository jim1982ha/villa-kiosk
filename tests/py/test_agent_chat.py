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
    monkeypatch.setattr(audit_mod, "AUDIT_FILE", str(tmp_path / "audit.json"))


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
    cfg = {"allowed_senders": {"telegram:222": "owner",
                               "telegram:333": "facility"}}
    assert policy.sender_role(cfg, channel="telegram", sender_id="222") == "owner"
    assert policy.sender_role(cfg, channel="telegram", sender_id=333) == "facility"


def test_the_key_carries_the_CHANNEL_not_just_the_id() -> None:
    """⚠️ A Telegram user id and a future WhatsApp id are integers from
    different namespaces and would eventually collide, granting one person's
    role to a stranger on another platform."""
    cfg = {"allowed_senders": {"telegram:222": "owner"}}
    assert policy.sender_role(cfg, channel="whatsapp", sender_id="222") == ""


def test_an_unknown_role_is_NOBODY_not_a_default_one() -> None:
    """Defaulting would grant some access to a typo."""
    for junk in ("admin", "Owner ", "", "guest", None, 7, ["owner"]):
        cfg = {"allowed_senders": {"telegram:222": junk}}
        got = policy.sender_role(cfg, channel="telegram", sender_id="222")
        assert got in ("", "owner"), got
    assert policy.sender_role({"allowed_senders": {"telegram:222": "admin"}},
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
    assert _handle(_event()) == "answered"


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
    assert got == "message too old to answer"


def test_no_provider_means_no_run_rather_than_a_crash() -> None:
    assert _handle(_event(), provider=None) == "no model provider configured"


def test_the_checks_run_in_the_order_that_costs_least() -> None:
    """⚠️ A message that is BOTH stale AND from an unlisted sender must report
    the cheaper refusal, or the order has been changed to read a message before
    deciding whether its sender may be listened to."""
    got = _handle(_event(date=int(time.time()) - 6 * 3600),
                  config={"enabled": True, "triggers": {"chat": True},
                          "allowed_senders": {}})
    assert got == "message too old to answer"


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

    assert got == "declined"
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
        assert _handle(_event(), provider=FakeProvider([says("fine")])) == "answered"
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
