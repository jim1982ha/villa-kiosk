"""One conversation, owned by VESTA. The inbound half. ADR-003.

⚠️ VESTA OWNS THIS THREAD RATHER THAN DELEGATING IT, AND THE REASON IS
DECISIVE. Handing the chat channel to Home Assistant's own conversation agent
is cheaper by about 400 lines and it SPLITS THE CONVERSATION IN TWO: VESTA
pushes an alert through `notify`, the owner replies "why?", and an agent that
never saw that alert answers from a blank context. `conversation.process` is
request/response — there is no supported way to push a VESTA-originated turn
into an HA conversation thread — so alerts can never join it. Two API keys was
the visible symptom; the broken follow-up was the actual cost.

⚠️ INBOUND RIDES THE WEBSOCKET `collect.py` ALREADY HOLDS. One more event type
on a connection that is already open: no webhook, no public URL, no inbound
firewall hole, and nothing new to supervise. A villa behind a Cloudflare tunnel
keeps reaching OUT, which is the same posture that made `Polling` the right
Telegram platform for this property.

⚠️ THREAD CONTEXT IS IN MEMORY AND MUST NOT BE PERSISTED. A durable chat log is
a transcript of a household — who was home, who asked about whom, what a guest
complained about — kept on a machine in a rental villa. It survives a restart
nowhere, and that is a feature: the cost is that a question asked before a
restart loses its thread, which is a conversation people re-open in one line.

⚠️ AND A THREAD CARRIES EVERY CONCERN VESTA DELIVERED INTO IT. That is what
makes "why?" resolve without the reader naming the subject, and it is the whole
product difference in §6.2 of the plan. Without it this is a chatbot that
happens to share a channel with an alerting system.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from reports.narrate.style import inert

#: The HA event this listens for. ⚠️ LOW-VOLUME BY NATURE — a person typing.
#: Subscribing to a high-volume type here would put the loop behind the villa's
#: own state traffic, which is what `observe/journal.py` exists to absorb.
EVENT_TYPE: str = "telegram_text"

#: How long a thread stays warm. Long enough that a reply to an alert lands in
#: context, short enough that an abandoned conversation is not re-sent as
#: context to a model an hour later.
THREAD_TTL_S: int = 30 * 60

#: ⚠️ A CAP IN TURNS, BECAUSE THE API IS STATELESS AND RE-SENDS THE WHOLE
#: CONVERSATION EVERY TIME. An uncapped thread is a bill that grows
#: quadratically with the length of one afternoon's chat.
MAX_TURNS: int = 12

#: Concerns kept per thread. The most recent are what "why?" refers to.
MAX_CONCERNS: int = 8

#: ⚠️ HOW OLD A MESSAGE MAY BE, AND THIS CONSTANT IS AN EMPIRICAL FINDING RATHER
#: THAN A TASTE. Telegram queues undelivered updates for ~24 h, so the moment
#: polling starts — after any restart or platform change — THE BACKLOG REPLAYS.
#: Observed at this property on 2026-08-22: three `telegram_text` events arrived
#: at once, typed hours earlier while the bot was send-only. An agent that
#: answers those as though they were just sent replies to a question the owner
#: has forgotten asking, about a villa state that no longer exists.
MAX_MESSAGE_AGE_S: int = 15 * 60

#: ⚠️ THE SECOND HALF OF THAT GUARD, AND IT EXISTS BECAUSE I HAVE NOT VERIFIED
#: THE FIELD NAME. The `telegram_callback` payload was captured whole from a
#: real event; `telegram_text`'s was not, so `date` may be absent or spelled
#: differently here. Defaulting an unknown date to "fresh" would defeat the
#: backlog guard entirely; defaulting it to "stale" would make chat silently
#: dead if the field is simply named something else — which is exactly how the
#: mobile-app buttons shipped non-functional. So an unknown date is judged on
#: the CONNECTION's age instead: a backlog arrives in the first seconds after
#: subscribing and never later, so a dateless message is dropped only inside
#: that window. Neither failure mode is reachable, and the honest reason is
#: that a field name is being guessed.
BACKLOG_GRACE_S: int = 60

#: Replies are capped. A message a phone shows as "…" is a message nobody read.
MAX_REPLY_CHARS: int = 3_500


@dataclass
class Message:
    """One inbound turn, normalised out of an HA event."""

    channel: str = "telegram"
    chat_id: str = ""
    sender_id: str = ""
    sender_name: str = ""
    text: str = ""
    #: Unix seconds as the platform reported it, or 0 for "not stated".
    sent_at: int = 0

    @property
    def thread_key(self) -> str:
        return f"{self.channel}:{self.chat_id}"


@dataclass
class Turn:
    role: str            # "user" | "assistant"
    text: str
    at: float = 0.0


@dataclass
class Thread:
    """One conversation's warm context. In memory only."""

    key: str
    turns: List[Turn] = field(default_factory=list)
    #: `(concern_id, title)` for every concern delivered into this thread.
    concerns: List[Tuple[str, str]] = field(default_factory=list)
    touched: float = 0.0


_THREADS: Dict[str, Thread] = {}


def _now() -> float:
    return time.time()


def parse(event: Mapping[str, Any]) -> Optional[Message]:
    """One HA event into a `Message`, or None if it is not one of ours.

    ⚠️ DEFENSIVE ABOUT EVERY FIELD, INCLUDING WHERE THE DATE LIVES. The
    `telegram_callback` payload nests its timestamp under `message.date` while
    the flat fields sit at the top level; `telegram_text` was never captured, so
    both are tried. A guessed field that is absent reads as 0, which
    `is_fresh` treats as "not stated" rather than as "now".
    """
    if str(event.get("event_type") or "") != EVENT_TYPE:
        return None
    data = event.get("data")
    if not isinstance(data, Mapping):
        return None
    text = str(data.get("text") or "").strip()
    chat_id = data.get("chat_id")
    sender = data.get("user_id")
    if not text or chat_id is None or sender is None:
        return None

    nested = data.get("message")
    nested = nested if isinstance(nested, Mapping) else {}
    # ⚠️ AN EXPLICIT None CHECK, NOT `get(key, default)`. A payload carrying
    # `"date": null` has the KEY, so the two-argument form returns None and
    # never looks at the nested one — which is exactly the shape a platform
    # sends when it has no timestamp for a field it always emits.
    raw_date = data.get("date")
    if raw_date is None:
        raw_date = nested.get("date")
    try:
        sent_at = int(str(raw_date))
    except (TypeError, ValueError):
        sent_at = 0

    first = str(data.get("from_first") or "").strip()
    last = str(data.get("from_last") or "").strip()
    return Message(chat_id=str(chat_id), sender_id=str(sender),
                   sender_name=" ".join(p for p in (first, last) if p),
                   text=text, sent_at=sent_at)


def is_fresh(message: Message, *, connected_since: float = 0.0,
             now: Optional[float] = None) -> bool:
    """Should this message be answered at all? See `MAX_MESSAGE_AGE_S`.

    ⚠️ TWO RULES, NOT ONE, AND THE SECOND CANNOT BE DROPPED AS REDUNDANT. A
    stated date older than the window is stale. An UNSTATED date is stale only
    while the connection is younger than `BACKLOG_GRACE_S`, because that is the
    only window a replayed backlog can arrive in. Keeping just the first rule
    trusts a field name I have not verified; keeping just the second answers
    every hours-old message that arrives a minute after a restart.
    """
    at = _now() if now is None else now
    if message.sent_at > 0:
        return (at - message.sent_at) <= MAX_MESSAGE_AGE_S
    if connected_since <= 0:
        return True
    return (at - connected_since) > BACKLOG_GRACE_S


def thread_for(key: str, *, now: Optional[float] = None) -> Thread:
    """The warm thread for this conversation, expiring stale ones first."""
    at = _now() if now is None else now
    expire(now=at)
    thread = _THREADS.get(key)
    if thread is None:
        thread = Thread(key=key, touched=at)
        _THREADS[key] = thread
    thread.touched = at
    return thread


def expire(*, now: Optional[float] = None) -> int:
    """Drop threads past their TTL. Returns how many went.

    ⚠️ IT SWEEPS EVERY THREAD, NOT ONLY THE ONE BEING ASKED FOR. A villa whose
    owner asks one question and never returns would otherwise keep that
    conversation in memory until the add-on restarts, which is the durable log
    this module refuses to keep, arrived at by neglect.
    """
    at = _now() if now is None else now
    dead = [k for k, t in _THREADS.items() if (at - t.touched) > THREAD_TTL_S]
    for key in dead:
        _THREADS.pop(key, None)
    return len(dead)


def record_turn(key: str, role: str, text: str,
                *, now: Optional[float] = None) -> Thread:
    """Append a turn, keeping the thread within `MAX_TURNS`."""
    at = _now() if now is None else now
    thread = thread_for(key, now=at)
    thread.turns.append(Turn(role=str(role), text=str(text), at=at))
    if len(thread.turns) > MAX_TURNS:
        # ⚠️ THE OLDEST GO. Dropping the NEWEST would make a long conversation
        # answer its own opening line forever.
        thread.turns = thread.turns[-MAX_TURNS:]
    return thread


def note_delivered(key: str, concern_id: str, title: str,
                   *, now: Optional[float] = None) -> None:
    """Record that a concern was delivered into this thread.

    ⚠️ THIS IS WHAT MAKES "why?" WORK, and it is the single line that separates
    this from a chatbot sharing a channel with an alerting system. The reader
    replies to an alert without naming its subject, because a person answering
    a message never does.
    """
    thread = thread_for(key, now=now)
    thread.concerns = [c for c in thread.concerns if c[0] != str(concern_id)]
    thread.concerns.append((str(concern_id), str(title)))
    if len(thread.concerns) > MAX_CONCERNS:
        thread.concerns = thread.concerns[-MAX_CONCERNS:]


def context_for(message: Message, *,
                now: Optional[float] = None) -> List[Dict[str, str]]:
    """The messages a chat run starts from: prior turns, then this one.

    ⚠️ THE CONCERNS ARE STATED AS CONTEXT, NOT AS A TOOL RESULT. A model told
    "these are the concerns I have sent into this conversation" resolves "why?"
    in its first turn; one that has to call a tool to find out spends a round
    trip discovering something the runtime already knew.

    ⚠️ AND THE CONCERN TITLES ARE PASSED THROUGH `inert`. They are written by a
    model from villa data and are about to be re-sent to a model; whatever the
    downstream path, a title carrying markup or control characters has no
    business travelling as-is.
    """
    thread = thread_for(message.thread_key, now=now)
    out: List[Dict[str, str]] = []
    if thread.concerns:
        listed = "; ".join(f"{cid}: {inert(title)}"
                           for cid, title in thread.concerns)
        out.append({
            "role": "user",
            "content": ("Concerns already delivered into this conversation, "
                        f"most recent last — {listed}. If this message refers "
                        "to one without naming it, it is the most recent."),
        })
    for turn in thread.turns:
        out.append({"role": turn.role, "content": turn.text})
    out.append({"role": "user", "content": message.text})
    return out


def clean_reply(text: str) -> str:
    """A reply as it may leave: inert, capped, and never empty-but-truthy.

    ⚠️ `inert` HERE AND AT THE MESSAGE LEVEL BOTH. A delivered brief is
    sanitised whole, after every narrator, precisely so no call site can be the
    one nobody thought of. This is a second application and is deliberate: a
    reply leaves through a different path, and the cost of doing it twice is
    nothing while the cost of assuming is a day of failed deliveries.

    ⚠️ AND THE EMPTINESS TEST IS ON THE FLATTENED TEXT. `"   \\n "` is truthy
    and pure markup flattens to nothing — the narration layer already paid for
    this once, reporting success and spending budget on an empty string.
    """
    body = inert(str(text or "")).strip()
    if not body:
        return ""
    if len(body) > MAX_REPLY_CHARS:
        body = body[:MAX_REPLY_CHARS].rstrip() + "…"
    return body


def reset() -> None:
    """Forget every thread. For tests, and for a kill switch flip."""
    _THREADS.clear()


def stats() -> Dict[str, int]:
    """What the diagnostics panel shows. Counts only — never a turn's text."""
    return {"threads": len(_THREADS),
            "turns": sum(len(t.turns) for t in _THREADS.values()),
            "concerns": sum(len(t.concerns) for t in _THREADS.values())}


# ── the entry point ─────────────────────────────────────────────────────────
async def handle_event(event: Mapping[str, Any], *, session: Any,
                       config: Optional[Mapping[str, Any]] = None,
                       targets: Sequence[str] = (),
                       document: str = "",
                       provider: Any = None,
                       model: str = "") -> str:
    """One HA event → at most one run. Returns why it stopped, for the log.

    ⚠️ THE ORDER OF THESE CHECKS IS THE DESIGN, AND EACH ONE REFUSES BEFORE THE
    NEXT COSTS ANYTHING. Not ours → not enabled → not fresh → not permitted →
    only then is a model asked. Reordering any pair either spends money on a
    message that will be discarded, or reads a message before deciding whether
    its sender may be listened to at all.

    ⚠️ AND IT RETURNS A REASON RATHER THAN A BOOLEAN. "Nothing happened" has six
    causes here and they need different responses from an operator — a
    misconfigured allow-list, a switched-off trigger, a replayed backlog and a
    spent budget all look identical from outside.
    """
    message = parse(event)
    if message is None:
        return ""

    from agent import config as agent_config
    if not agent_config.trigger_enabled(config, "chat"):
        return "chat trigger disabled"

    from reports import collect
    if not is_fresh(message, connected_since=collect.connected_seconds()):
        # ⚠️ COUNTED IN THE LOG, NOT SILENTLY DROPPED. A villa whose clock or
        # whose Telegram platform is wrong would otherwise answer nothing with
        # no explanation anywhere.
        return "message too old to answer"

    from agent import audit as audit_mod
    from agent import policy as policy_mod
    role = policy_mod.sender_role(config, channel=message.channel,
                                  sender_id=message.sender_id)
    if not role:
        # ⚠️ ONE AUDIT ROW AND NO REPLY. Silence is the answer — an error reply
        # confirms the bot is live to whoever is probing it. The row is what
        # makes "somebody is trying to talk to the villa" visible to the owner
        # without telling the prober anything.
        audit_mod.record_run(f"chat{int(_now())}", actor="unknown",
                             trigger="chat", verdict="refused",
                             detail="sender not in allowed_senders")
        return "sender not allowed"

    if provider is None or not provider.configured():
        return "no model provider configured"

    from agent.registry import build_registry, run as run_loop
    from agent.tools import reply as reply_mod

    record_turn(message.thread_key, "user", message.text)
    registry = build_registry()
    # ⚠️ THE REPLY TOOL IS BUILT HERE, BOUND TO THIS MESSAGE'S CHAT, AND ADDED
    # TO A COPY OF THE REGISTRY. It is deliberately absent from `ALL_TOOLS`,
    # because an unbound one can reach nobody and would be offered to every
    # scheduled run as a verb the model cannot use.
    replier = reply_mod.build(targets=targets, session=session,
                              thread_key=message.thread_key)
    registry = registry.with_tool(replier)

    policy = policy_mod.for_run(config, tier="reason",
                                tool_names=[t["name"] for t in registry.describe()])
    result = await run_loop(
        run_id=f"chat{int(_now())}", provider=provider, registry=registry,
        policy=policy, model=model,
        system=[{"type": "text", "text": document}],
        messages=context_for(message),
        config=config, actor=role, trigger="chat", kind="chat")

    # ⚠️ A DECLINE MUST NOT BE SILENCE — SOMEBODY IS WAITING FOR AN ANSWER.
    # The degradation ladder's rule is that nothing on it is silent, and in
    # chat the person who typed the question IS the instrument: they cannot
    # read the add-on log, so an unspoken decline is indistinguishable from a
    # broken bot and they retry, which costs another turn and another refusal.
    # Measured: a spent API balance declined every message and the villa said
    # nothing at all.
    #
    # ⚠️ ONLY TO AN ALREADY-AUTHORISED SENDER, which is guaranteed here — the
    # allow-list was checked far above, before the text was read. The silence
    # rule applies to STRANGERS, and telling an owner why their villa cannot
    # answer is the opposite of leaking anything to one.
    #
    # ⚠️ AND IT REPORTS OUR OWN REASON, WHICH IS ALREADY REDACTED. Provider
    # error text reaches here through `anthropic_sdk._redacted`, so a client
    # that echoed its request headers has had the key removed before this
    # point; `clean_reply` then flattens and caps it.
    if result.status == "declined" and result.declined_reason:
        await replier.call({"text": f"I could not answer that. "
                                    f"{result.declined_reason}"})
    return result.status
