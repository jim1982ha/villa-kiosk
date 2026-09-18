"""One conversation, owned by VESTA. The inbound half. ADR-003.

⚠️ VESTA OWNS THIS THREAD RATHER THAN DELEGATING IT, AND THE REASON IS
DECISIVE. Handing the chat channel to Home Assistant's own conversation agent
is cheaper by about 400 lines and it SPLITS THE CONVERSATION IN TWO: VESTA
pushes an alert through `notify`, the owner replies "why?", and an agent that
never saw that alert answers from a blank context. `conversation.process` is
request/response — there is no supported way to push a VESTA-originated turn
into an HA conversation thread — so alerts can never join it. Two API keys was
the visible symptom; the broken follow-up was the actual cost.

⚠️ INBOUND RIDES THE WEBSOCKET `collect.py` ALREADY HOLDS. Two event types on a
connection that is already open — a typed message and, since 2026-08-28, a
button press: no webhook, no public URL, no inbound firewall hole, and nothing
new to supervise. Both are person-driven and therefore low-volume by nature,
which is the property that matters; `collect.CHAT_EVENT_TYPES` is the list. A villa behind a Cloudflare tunnel
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

# ⚠️ THE PLATFORM NAME HAS ONE OWNER (/dry-audit, 2026-08-29). These two
# filters ask a DIFFERENT question from `rich.capable_entities` — they map a
# chat id to an entity through `unique_id` — so the LOOKUPS stay separate;
# only the name they both match on is shared.
from vesta.adapters import rich as rich_mod

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters.log import log
from vesta.shared.style import inert
from vesta.supervise.agent import limits

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

⚠️ ANSWER IN THE LANGUAGE THEY WROTE IN, every time. Judge it from the message
in front of you, not from these instructions, which are in English whatever the
household speaks. Do not drift back to English part-way through a conversation.
If they switch language, follow them.

For "how much / how many / over what period": read_configuration with
energy/get_prefs tells you WHICH meter the property totals on, then
ha_get_history with source="statistics" gives that meter's figures over your
window in one call — pass statistic_types=["change"] and sum them. Use the
handles the first read gave you as arguments to the second. Prefer
ha_get_history over a raw recorder command: it takes a limit and a period, so
it comes back a size you can actually read.

⚠️ LOOK BEFORE YOU SAY THE VILLA CANNOT. You can search this property's devices,
read their state, compute over them, and ask Home Assistant to work something
out and hand back the answer. "There is no sensor for that" is a claim about
the property, and it needs a look first — saying it wrongly closes the question
for the reader.

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



def _now_sentence() -> str:
    """The villa's own wall clock, right now, for the turn that needs it.

    ⚠️ RELATIVE PHRASES ARE THE WHOLE POINT. "Since 5pm", "this morning", "in
    the last hour" are how people ask, and every one of them resolves against
    an instant the model was never given. Degrades to "" rather than raising:
    a clock this cannot read must not cost the reader their answer.
    """
    try:
        import datetime as _dt

        from vesta.shared import wallclock
        from vesta.supervise.agent import clock as clock_mod
        zone = clock_mod.villa_zone()
        # ⚠️ A datetime, NOT `_now()`. `for_reader` goes through
        # `instants.as_utc`, which reads ISO strings and datetimes and returns
        # "" for a float — so passing the unix seconds this module uses
        # everywhere else would have produced an EMPTY sentence on the villa
        # and looked exactly like a working change. Checked before shipping,
        # which is the only reason it is not the next silent no-op.
        stamp = wallclock.for_reader(
            _dt.datetime.now(_dt.timezone.utc), zone)
        if not stamp:
            return ""
        return (f"The time at the villa right now is {stamp}. Resolve every "
                "relative time in the message against it — and if a named hour "
                "is still ahead of it today, the reader means yesterday.")
    except Exception:  # noqa: BLE001 - a clock is not worth a failed answer
        return ""


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
    # ⚠️ THE CURRENT INSTANT, IN A MESSAGE, BECAUSE IT CANNOT GO IN THE PREFIX.
    # `playbooks._clock_sentence` says so in its own docstring — "NO INSTANT IN
    # IT" — and it is right: interpolating "now" into a SYSTEM block would
    # change the cached prefix on every single call. The consequence nobody
    # followed through was that the model then knows the villa's timezone and
    # not the time, so "how much since 5pm" is unanswerable — it cannot tell
    # how long ago that was. Asked exactly that, it asked the owner what time
    # it was, which is the only honest move it had.
    #
    # ⚠️ A MESSAGE IS THE RIGHT PLACE PRECISELY BECAUSE MESSAGES ARE NOT CACHED.
    # The cache boundary sits above them, so a value that changes every second
    # costs nothing here and would have cost the whole prefix up there. Same
    # reasoning as the concerns block and the language rule below it.
    out.append({"role": "user", "content": _now_sentence()})
    # ⚠️ ONE STATIC LINE, AND DELIBERATELY NOT A LANGUAGE DETECTOR (2.979.0).
    # 2.977.0 shipped one — stop-word scoring over seven European languages,
    # pinned on the thread — and it regressed every language outside that set
    # within the hour: a 20-word Indonesian question inherited the thread's
    # previous English and the model was INSTRUCTED to answer in English, which
    # it had never been told before the mechanism existed.
    #
    # ⚠️ THE MODEL IS BETTER AT THIS THAN ANY CLASSIFIER WE COULD SHIP, and it
    # is already reading the message. Word lists cannot separate Dutch from
    # German or Spanish from Portuguese; the tools that can are character
    # n-gram models (fastText, CLD3) and those are a dependency and a binary
    # blob for a judgement the model makes for free. So the rule is stated —
    # in the prompt, and again HERE, immediately before the question, because a
    # rule buried above a dozen turns of prior conversation is the one that
    # gets missed. Nothing is stored and nothing is inferred, so this cannot
    # assert a language the asker did not write in.
    #
    # ⚠️ IF DRIFT COMES BACK, THE NEXT STEP IS TO ASK THE MODEL, NOT TO GUESS:
    # have it state the language it read and pin that. Do not reintroduce a
    # heuristic — this one is on the record as having made things worse.
    # ⚠️ POSITIVE, AND IT NAMES NO LANGUAGE. The first cut read "...if it is not
    # English, do not answer in English", which is both anglocentric and the
    # wrong shape: naming a language in a prohibition puts that language in
    # front of the model. The test below forbids naming one at all.
    out.append({"role": "user", "content":
                "Answer in the language of the message below."})
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

    from vesta.supervise.agent import config as agent_config
    if not agent_config.trigger_enabled(config, "chat"):
        return "chat trigger disabled"

    from vesta.adapters import collect
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

    # ⚠️ THE VILLA NO LONGER RE-ASKS WHO SENT THIS (owner's ruling, 2026-09-13).
    # There used to be a per-person allow-list here, matched on the sender id —
    # a second gate beside Home Assistant's own `allowed_chat_ids`, which could
    # disagree with it and did. `telegram_bot` accepts updates only from its
    # configured chats, so a message that reaches this line already came from a
    # room the villa is configured to talk in. The owner's words: "the fact that
    # the person had access to the telegram chat is the first [gate] already."
    #
    # ⚠️ WHAT IS RESOLVED HERE IS VOICE, NOT ADMISSION. The profile decides which
    # system prompt loads — a facility manager gets the file that WANTS entity
    # ids, an owner gets the one that forbids them — so it is read from the CHAT
    # the question arrived in rather than from whoever typed it. An unknown chat
    # resolves to `""` and `AUDIENCE_OF_ROLE.get(role, "owner")` below falls
    # back to the owner voice, which is the WITHHOLDING one: the safe default is
    # to say less, not more.
    # ⚠️ `policy_mod` IS STILL NEEDED BELOW (`for_run`), and removing the gate
    # above took its import with it the first time — a NameError three hundred
    # lines further down, caught by the suite rather than by reading.
    from vesta.adapters import people as people_mod
    from vesta.supervise.agent import policy as policy_mod
    role = people_mod.role_for_chat(
        config, target=await target_for(session, message.chat_id))

    if provider is None or not provider.configured():
        return "no model provider configured"

    from vesta.supervise.agent import playbooks
    from vesta.supervise.agent.registry import build_registry
    from vesta.supervise.agent.registry import run as run_loop
    from vesta.supervise.agent.tools import reply as reply_mod

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

    # ⚠️ `tier="chat"`, NOT "reason". It borrowed the reason tier for its whole
    # life and inherited that tier's budget — the narrowest in the system —
    # while holding the broadest tool set. See `config.CHAT_BUDGET`.
    policy = policy_mod.for_run(config, tier="chat",
                                tool_names=[t["name"] for t in registry.describe()])
    with limits.scope() as run_limits:
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
            system=playbooks.system_blocks(
                playbooks.AUDIENCE_OF_ROLE.get(role, "owner"),
                instructions=SYSTEM, document=document),
            messages=context_for(message),
            config=config, actor=role or "chat", trigger="chat",
            kind="chat")
        noted = run_limits.collected()

    # ⚠️ THE TRACE CHAT HAS NEVER HAD, AND ITS ABSENCE COST THIS WHOLE DAY.
    # `runtime.investigate` logs "run <id> tools used: …" for every SCHEDULED
    # run; chat calls `registry.run` directly and bypasses it, so a chat run
    # that ANSWERED logged only which tools were PUBLISHED — never which were
    # CALLED. So "did it look at the Energy dashboard before saying it could
    # not?" was unanswerable from the log, and every diagnosis of a wrong chat
    # answer has been a guess dressed as an inference.
    #
    # ⚠️ AND A RUN THAT CALLED NOTHING SAYS SO EXPLICITLY. An empty `used` is
    # the single most diagnostic outcome here — a model that answered from the
    # document without touching a tool — and printing nothing for it would make
    # the most important case the invisible one, which is how this started.
    used: Dict[str, int] = {}
    for row in result.evidence:
        name = str(row.get("tool") or "")
        if name:
            used[name] = used.get(name, 0) + 1
    ranked = sorted(used.items(), key=lambda kv: (-kv[1], kv[0]))
    log(f"chat {result.run_id} {result.status} in {result.turns} turn(s), "
        f"{result.tool_calls} tool call(s); tools used: "
        + (" ".join(f"{n}x{c}" for n, c in ranked) if ranked else "NONE"))

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
    # ⚠️ ON HAVING TEXT, NOT ON THE STATUS BEING `answered`. A `partial` run
    # carries a real answer built from the evidence it did gather, and testing
    # the status dropped it on the floor — the shape of bug that appears the
    # moment another layer starts producing a status this one had not heard of.
    if result.text and not replier.sent:
        await replier.call({"text": result.text})

    # ── the management message ───────────────────────────────────────────
    # ⚠️ A SECOND BUBBLE, AND ONLY WHEN THERE IS SOMETHING TO SAY. Owner's
    # instruction, 2026-09-18: the reader must always be able to judge how
    # complete an answer is. Until now the only thing that could limit an
    # answer VISIBLY was a decline; a truncated search or an exhausted tool
    # budget produced an answer that looked exactly like a whole one.
    #
    # ⚠️ IT REPLACES THE OLD DECLINE BRANCH RATHER THAN SITTING BESIDE IT. That
    # branch sent "That is as far as I got. <reason>" as an ordinary reply, so
    # a decline and an answer were the same kind of bubble and a limitation
    # that was NOT a decline had nowhere to go at all. One channel now, one
    # shape, and the reason joins the other notes instead of outranking them.
    #
    # ⚠️ NEITHER BRANCH IS SILENT, which is the rule the old code was right
    # about and is kept: a person who got a partial answer still needs to know
    # it stopped early, and a person who got nothing needs to know why.
    notes = noted
    if result.declined_reason:
        notes = notes + [{"kind": "declined",
                          "detail": f"I stopped before finishing: "
                                    f"{result.declined_reason}."}]
    # ⚠️ AN `answered` RUN THAT SAID NOTHING AT ALL IS STILL SILENCE, and the
    # silence rule does not care which status produced it. A model that ends its
    # turn with no prose and never called `reply` leaves the asker staring at a
    # bot that read their message and ignored it.
    #
    # ⚠️ AND THIS MUST NOT CHAIN OFF THE MANAGEMENT MESSAGE. It briefly did: an
    # `elif` after it meant a run that produced NO answer but DID hit a
    # limitation sent the note alone — a "⚠️ About this answer" bubble with no
    # answer above it, which is worse than the silence it replaced. The two are
    # independent questions: "was anything said" and "was anything limited".
    if not replier.sent:
        await replier.call({"text": "I could not answer that. The villa "
                                    "produced no reply."})

    # ⚠️ LAST, SO IT SITS UNDER THE ANSWER IT IS ABOUT. Owner's instruction:
    # right after the response bubble, and only when there is something to say.
    management = limits.summary(notes)
    if management:
        await replier.call({"text": management})
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
        from vesta.adapters import deliver
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            entries = await hass.command("config/entity_registry/list")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        from vesta.adapters.log import swallow
        swallow("could not read the entity registry for a chat target", err)
        return ""

    found = ""
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, Mapping):
            continue
        if str(entry.get("platform") or "") != rich_mod.PLATFORM:
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
