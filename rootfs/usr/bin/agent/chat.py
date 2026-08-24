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

from reports.log import log
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
#: ⚠️ 3,500 WAS A TRANSPORT LIMIT MASQUERADING AS AN EDITORIAL ONE. Telegram
#: accepts ~4,096 characters, so this only ever stopped a message being
#: REJECTED — it never stopped one being unreadable. An owner asked a two-part
#: question about a pump and received forty lines of tooling diagnostics.
#: This is now the backstop; `SYSTEM` below is what actually does the work,
#: because a cap truncates mid-sentence and instruction produces a short answer.
MAX_REPLY_CHARS: int = 1_200

#: ⚠️ THE CHAT PATH HAD NO SYSTEM PROMPT AT ALL — only the villa document — so
#: the model had nothing telling it who it was talking to or how long an answer
#: should be, and wrote an essay about its own plumbing. Reported from the
#: phone: "way too long … answer dozens and dozens of lines".
#:
#: ⚠️ NO VILLA FACTS, NO CLOCK, NO ENTITY IDS. It sits above the cache
#: breakpoint on every chat turn.
SYSTEM = """You are the villa itself, answering its owner or facility manager
in a chat app on a phone.

HOW TO ANSWER

Lead with the answer. First sentence, no preamble.

Be brief. Two or three sentences is normal. Six is the most you may ever send.
This is a text message, not a report — if it does not fit on a phone screen
without scrolling, it is too long.

Say what you know, then stop. Do not restate the question, do not narrate what
you tried, do not list the tools you used or explain how they work. Nobody
asked about the monitoring system.

⚠️ IF YOU CANNOT ANSWER, SAY SO IN ONE SENTENCE AND SAY WHAT WOULD FIX IT.
"I can't see the pool pump — the monitoring link is down" is the whole answer.
The reader does not need the diagnosis of your own instruments; they need to
know they are not covered and what to do about it.

Never say a number you did not read from a tool. Never present an absence of
data as good news. Name the thing you are talking about — a room, a device, a
ticket — never a rule or a check.

If they ask a follow-up, they will ask. Leave them room to."""


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


def _epoch_of(raw: Any) -> int:
    """A message timestamp as Unix seconds, or 0 for "not stated".

    ⚠️ IT WAS `int(str(raw))`, WHICH ACCEPTS ONLY AN EPOCH INTEGER, AND HOME
    ASSISTANT DOES NOT SEND ONE. `telegram_bot` passes python-telegram-bot's
    `message.date` through, which is a `datetime`, so `str()` gave
    `2026-08-24 07:47:00+00:00`, `int()` raised, and EVERY message has been
    parsed as dateless since this was written. Nothing showed it, because the
    fallback rule — drop a dateless message only in the first 60 s after
    connecting — is right almost always: it fires exactly once per restart, on
    whoever asks first. Which is the person testing a fresh build, every time.

    ⚠️ THE COMMENT ABOVE `BACKLOG_GRACE_S` PREDICTED THE FAILURE AND GUESSED THE
    CAUSE. It says `date` "may be absent or spelled differently". It is neither:
    it is present, correctly named, and a different TYPE. Guessing a field's
    NAME and never questioning its TYPE is how a defensive parse still lands on
    one branch forever.

    ⚠️ A NAIVE DATETIME IS READ AS UTC, which is Telegram's own convention for
    this field. Reading it as local time would shift a fresh message by the
    villa's offset — eight hours here, i.e. permanently stale in one direction
    and permanently fresh in the other.
    """
    if raw is None or isinstance(raw, bool):
        return 0
    if isinstance(raw, (int, float)):
        return int(raw) if raw > 0 else 0
    stamp = getattr(raw, "timestamp", None)       # a datetime, unstringified
    if callable(stamp):
        try:
            return int(stamp())
        except (OSError, OverflowError, ValueError):
            return 0
    text = str(raw).strip()
    if not text:
        return 0
    try:                                          # an epoch, as a string
        return int(float(text))
    except ValueError:
        pass
    try:
        import datetime as _dt
        parsed = _dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_dt.timezone.utc)
        return int(parsed.timestamp())
    except ValueError:
        return 0


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
    sent_at = _epoch_of(raw_date)
    if raw_date is not None and sent_at == 0:
        # ⚠️ SAID ONCE, WITH THE TYPE AND A CLIPPED VALUE. A date that is
        # PRESENT and unreadable is the case that cost a whole afternoon, and it
        # is invisible from "message too old to answer" — the two look
        # identical from outside and need opposite fixes.
        log(f"chat: unreadable message date ({type(raw_date).__name__}: "
            f"{str(raw_date)[:40]!r}) — treating it as unstated")

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
    connected = collect.connected_seconds()
    if not is_fresh(message, connected_since=connected):
        # ⚠️ COUNTED IN THE LOG, NOT SILENTLY DROPPED. A villa whose clock or
        # whose Telegram platform is wrong would otherwise answer nothing with
        # no explanation anywhere.
        #
        # ⚠️ AND IT NAMES WHICH OF THE TWO RULES REFUSED, WITH THE NUMBER. "Too
        # old to answer" is true of a message typed three hours ago AND of a
        # fresh one arriving 43 s after a restart, and those need opposite
        # fixes — the first is the guard working, the second is the guard
        # eating the question somebody just asked to test the build. One line
        # for both is the shape of instrument this repo has paid for five times.
        if message.sent_at > 0:
            return (f"message too old to answer "
                    f"(sent {int(_now() - message.sent_at)}s ago, "
                    f"limit {MAX_MESSAGE_AGE_S}s)")
        return (f"message too old to answer (no readable date; "
                f"{int(_now() - connected)}s after connecting, "
                f"backlog window {BACKLOG_GRACE_S}s)")

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

    from agent import playbooks
    from agent.registry import build_registry, run as run_loop
    from agent.tools import reply as reply_mod

    # ⚠️ THE CHAT THAT ASKED, RESOLVED THROUGH THE REGISTRY, BEFORE THE
    # CONFIGURED FALLBACK. Measured on the villa: without this the answer went
    # to the BRIEFING targets, so a question asked in a private chat was
    # answered in the group — every member reading a reply to somebody else,
    # and the asker seeing nothing.
    resolved = await target_for(session, message.chat_id)
    bound = [resolved] if resolved else list(targets)
    registry = build_registry(session=session)
    # ⚠️ THE REPLY TOOL IS BUILT HERE, BOUND TO THIS MESSAGE'S CHAT, AND ADDED
    # TO A COPY OF THE REGISTRY. It is deliberately absent from `ALL_TOOLS`,
    # because an unbound one can reach nobody and would be offered to every
    # scheduled run as a verb the model cannot use.
    replier = reply_mod.build(targets=bound, session=session,
                              thread_key=message.thread_key)
    registry = registry.with_tool(replier)

    policy = policy_mod.for_run(config, tier="reason",
                                tool_names=[t["name"] for t in registry.describe()])
    result = await run_loop(
        run_id=f"chat{int(_now())}", provider=provider, registry=registry,
        policy=policy, model=model,
        # ⚠️ THE CONSTITUTION FIRST, THEN THIS PATH'S OWN INSTRUCTIONS, THEN
        # THE VILLA. The `_system` playbooks were written, shipped and
        # CI-gated in 2.641.0 and NOTHING LOADED THEM — /dry-audit found
        # `playbooks.py` imported by nobody, so the agent had no constitution,
        # no severity scale, no evidence rule and no voice. The identical shape
        # as `build_registry()` building tools with no sources: the content
        # delivered, the wiring forgotten.
        #
        # ⚠️ THE VOICE FOLLOWS THE ASKER'S ROLE. A facility manager gets the
        # file that WANTS the entity id; an owner gets the one that forbids it.
        # They are deliberately contradictory and only one may load.
        system=[{"type": "text",
                 "text": playbooks.system_prompt(
                     playbooks.AUDIENCE_OF_ROLE.get(role, "owner"))},
                {"type": "text", "text": SYSTEM},
                {"type": "text", "text": document}],
        messages=context_for(message),
        config=config, actor=role, trigger="chat", kind="chat")

    # ⚠️ THE ANSWER ITSELF IS DELIVERED HERE, AND FORGETTING THAT COST THE
    # WHOLE FEATURE. `run_loop` returns the model's final prose in
    # `result.text` and stops; nothing downstream sent it. So a run that
    # WORKED — question read, tools called, answer written — logged `answered`
    # and reached nobody, in either chat. Measured on the villa, and the most
    # expensive kind of bug in this session precisely because every instrument
    # said success.
    #
    # ⚠️ ONLY IF THE MODEL DID NOT ALREADY REPLY. It has a `reply` tool and may
    # use it; `replier.sent` is the record of that. Sending unconditionally
    # would answer twice, which reads as a stutter and bills twice for one
    # question.
    #
    # ⚠️ AND THE `reply` TOOL STAYS ON THE REGISTRY EVEN SO. It is what lets a
    # model answer MID-RUN — say something now, keep working — and removing it
    # in favour of this line would take that away. The two are the same channel
    # reached two ways, not a duplicate.
    if result.status == "answered" and result.text and not replier.sent:
        await replier.call({"text": result.text})

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
    #
    # ⚠️ AND IT MUST NOT CONTRADICT AN ANSWER ALREADY DELIVERED. Every OTHER
    # decline can fire after a mid-run `reply` too — a deadline, a spent
    # budget, an open breaker — and "I could not answer that" on top of a
    # correct answer is worse than saying nothing, because it tells the reader
    # to distrust what they just read. So the message depends on whether this
    # run has already spoken, and NEITHER branch is silent: a person who got a
    # partial answer still needs to know it stopped early.
    elif result.status == "declined" and result.declined_reason:
        await replier.call({"text": (
            f"That is as far as I got. {result.declined_reason}"
            if replier.sent else
            f"I could not answer that. {result.declined_reason}")})

    # ⚠️ AN `answered` RUN THAT SAID NOTHING AT ALL IS STILL SILENCE, and the
    # silence rule does not care which status produced it. A model that ends its
    # turn with no prose and never called `reply` leaves the asker staring at a
    # bot that read their message and ignored it.
    elif not replier.sent:
        await replier.call({"text": "I could not answer that. The villa "
                                    "produced no reply."})
    # ⚠️ THE OUTCOME NAMES WHERE IT WENT. `answered` alone cost a round trip:
    # the run succeeded, the reply was delivered, and neither the log nor the
    # asker could say to WHOM — so "it worked" and "you got nothing" were the
    # same line. `bound` is an entity id, not a chat id, and it is the villa's
    # own configuration rather than anything a message supplied.
    where = bound[0] if bound else "nobody"
    return f"{result.status} -> {where}{'' if resolved else ' (fallback)'}"


# ── who to answer ───────────────────────────────────────────────────────────
#: `chat_id -> notify entity`, with the moment it was learned. The entity
#: registry changes when somebody adds a chat to the bot, which is rare, so a
#: lookup per message would be a websocket round trip per message for an answer
#: that is stable for weeks.
_TARGETS: Dict[str, Tuple[str, float]] = {}

TARGET_TTL_S: int = 15 * 60


async def target_for(session: Any, chat_id: str,
                     *, now: Optional[float] = None) -> str:
    """The notify entity that reaches THIS chat, or `""`.

    ⚠️ THIS IS WHY A REPLY MAY BE BOUND TO THE INBOUND MESSAGE AFTER ALL. The
    objection was that a recipient taken from the payload is a recipient an
    attacker can set, which is why `_chat_targets` read config instead — and the
    consequence was measured on the villa: the owner asked from their private
    chat and the answer arrived in the group, because config falls back to the
    BRIEFING targets.

    The resolution is that the chat id is not used as an ADDRESS. It is a lookup
    key into the entity registry, and Home Assistant's `telegram_bot` platform
    stamps each notify entity's `unique_id` as `<bot_id>_<chat_id>` — so only a
    chat that HA has already been configured for can be reached at all. An
    invented id resolves to nothing and the caller falls back. The sender was
    already checked against `allowed_senders` several steps earlier, so this is
    the second gate, not the first.

    ⚠️ AND `telegram_bot.send_message` TAKES ONLY `entity_id`. There is no
    `chat_id` and no `target` field on that service — verified against the
    running instance, not assumed — so a bare chat id could not be addressed
    even if it were trusted. The registry lookup is the only route.

    ⚠️ RETURNS `""` RATHER THAN RAISING OR GUESSING. A villa whose bot has one
    chat, or whose registry cannot be read, must fall back to configuration
    rather than send somebody else's answer to whoever is first in the list.
    """
    key = str(chat_id)
    at = _now() if now is None else now
    cached = _TARGETS.get(key)
    if cached and (at - cached[1]) < TARGET_TTL_S:
        return cached[0]

    try:
        from reports import deliver
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            entries = await hass.command("config/entity_registry/list")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        from reports.log import swallow
        swallow("could not read the entity registry for a chat target", err)
        return ""

    found = ""
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, Mapping):
            continue
        if str(entry.get("platform") or "") != "telegram_bot":
            continue
        unique = str(entry.get("unique_id") or "")
        # ⚠️ `rsplit`, NOT `split`. A chat id is NEGATIVE for a group —
        # `8859711452_-1003932943049` — so splitting on the first underscore
        # would compare the BOT id and match nothing, or worse, match one chat
        # for every entity the bot owns.
        if "_" in unique and unique.rsplit("_", 1)[1] == key:
            # ⚠️ ENTITY-PREFIXED, AND `deliver.py` PREDICTED THIS EXACT BUG IN A
            # COMMENT I DID NOT READ: "a service and an entity are the same
            # shape … calling one the other way 404s or 400s at delivery time".
            # A bare `notify.x` is treated as a legacy notify SERVICE and posted
            # to `notify/x`, which does not exist on the entity platform. What
            # this function resolves is an ENTITY, from the entity registry, so
            # it returns the entity-addressed form rather than leaving the
            # caller to know. Measured: `delivery to
            # notify.living_room_… failed: HTTP 400`, with the answer composed,
            # routed correctly and thrown away at the last step.
            found = f"{deliver.ENTITY_PREFIX}{entry.get('entity_id') or ''}"
            break

    _TARGETS[key] = (found, at)
    return found


def forget_targets() -> None:
    """Drop the resolved map. For tests, and for a registry that has changed."""
    _TARGETS.clear()


@dataclass
class Chat:
    """One conversation the bot can be reached in, as a person names it."""

    chat_id: str
    name: str
    #: `entity:notify.…`, ready for `deliver`.
    target: str


async def known_chats(session: Any) -> List[Chat]:
    """Every PRIVATE chat this villa's bot has, named as a person would.

    ⚠️ PRIVATE ONLY, AND THE EXCLUSION IS CORRECTNESS RATHER THAN TASTE.
    `allowed_senders` keys on WHO SPEAKS (`user_id`); a notify entity gives
    WHERE (`chat_id`). In a private chat those are the same number — verified
    on the reference villa, `765979167` for both. In a GROUP they differ: the
    chat id identifies the room and the user id identifies whichever member
    typed. Offering a group here would store a number that can never match a
    sender, and it would fail SILENTLY — the bot would simply keep ignoring
    everyone, which is indistinguishable from an empty list.

    ⚠️ TELEGRAM'S OWN CONVENTION IS THE DISCRIMINATOR: a private chat id is
    POSITIVE, a group or supergroup is NEGATIVE. Read off the id rather than
    off the name, because a name is whatever somebody typed.

    ⚠️ THE NAME COMES FROM THE STATE, NOT THE REGISTRY. Both registry entries
    on the reference villa carry `name: null` and `original_name: null`, and the
    human label lives in the state's `friendly_name` — checked against the
    running instance rather than assumed, which is how the last four bugs in
    this feature were found.
    """
    try:
        from reports import deliver
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            entries = await hass.command("config/entity_registry/list")
            states = await hass.command("get_states")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        from reports.log import swallow
        swallow("could not list the bot's chats", err)
        return []

    labels: Dict[str, str] = {}
    for state in states if isinstance(states, list) else []:
        if not isinstance(state, Mapping):
            continue
        attrs = state.get("attributes")
        if isinstance(attrs, Mapping) and attrs.get("friendly_name"):
            labels[str(state.get("entity_id") or "")] = \
                str(attrs["friendly_name"])

    out: List[Chat] = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, Mapping):
            continue
        if str(entry.get("platform") or "") != "telegram_bot":
            continue
        unique = str(entry.get("unique_id") or "")
        if "_" not in unique:
            continue
        chat_id = unique.rsplit("_", 1)[1]
        if chat_id.startswith("-"):
            continue                      # a group: see the docstring
        entity_id = str(entry.get("entity_id") or "")
        out.append(Chat(chat_id=chat_id,
                        name=labels.get(entity_id) or entity_id,
                        target=f"{deliver.ENTITY_PREFIX}{entity_id}"))
    out.sort(key=lambda c: c.name.lower())
    return out
