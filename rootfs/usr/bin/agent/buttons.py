"""Buttons on a delivered alert, and what happens when somebody presses one.

⚠️ THIS FILE IS DELIBERATELY THE ONLY PLATFORM-SPECIFIC ONE, AND THAT IS WHY IT
EXISTS AT ALL. `reports/deliver.py`'s header is emphatic: the payload it sends
is the INTERSECTION of what every notify platform accepts — `title` and
`message`, plain text, no `data` block — because "the moment this file sends
one it has a Telegram branch in it, which is the first step toward a platform
table". An inline keyboard is exactly such a branch. So delivery is unchanged
and this sits BESIDE it: `outbox` offers each send here first, and anything this
declines falls through to the agnostic path byte for byte.

⚠️ SENDING IS TELEGRAM-ONLY; HANDLING IS OURS. That split is the whole design,
and it is what the retired `vesta_task_actions.yaml` could not do. A blueprint
had to wait for its own button inside a `wait_for_trigger`, so the buttons died
when the automation's timeout expired, a restart lost the wait entirely, and a
second instance could act on the same press. Here the press arrives as an
ordinary event on the websocket `collect.py` already holds, is matched against
the STORE rather than against a waiting script, and therefore never expires.

⚠️ NO STATE OF ITS OWN. A press does nothing here — it is decoded and handed to
`actions.apply`, which is the same function the tablet calls. This module knows
how to draw a button and how to read a press, and nothing whatsoever about what
pressing one means. That is what makes the owner's requirement structural:
there is no second implementation to fall out of step with the first.

⚠️ THE MESSAGE IS EDITED, NOT LEFT. Three things follow a press: the spinner is
stopped (`answer_callback_query` — without it Telegram spins until it times out,
observed directly during the 2026-08-22 probe), the keyboard is removed, and the
text says what happened and who did it. A stale button that still LOOKS live is
the one way the two surfaces can visibly disagree.

⚠️ AND A PRESS IS NOT THE ONLY WAY AN ALERT MOVES. Somebody may acknowledge it
on the tablet, or tick its job in Home Assistant's own panel, and the phone's
buttons would sit there offering to do it again. `reconcile` closes that: it
runs on the chase clock and retires the keyboard of any message whose alert has
since been dealt with. Immediate on this side, eventually consistent from the
other — which is the strongest promise a chat platform allows, because there is
no way to subscribe to "this message is now wrong".
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from reports.log import log, stage, swallow, warn

#: The HA event a press arrives as. ⚠️ ADDED TO THE CHAT SUBSCRIPTION RATHER
#: THAN A NEW ONE — one more type on a websocket already held, which is the same
#: reasoning `collect.CHAT_EVENT_TYPES` records for the chat event itself.
EVENT_TYPE: str = "telegram_callback"

#: The services this needs, and the one place their names appear.
#:
#: ⚠️ ALL THREE SCHEMAS WERE READ OFF THE RUNNING INSTANCE ON 2026-08-28, NOT
#: ASSUMED, because `feedback_guessed-field-shapes` is what happens otherwise —
#: the field NAME right and the TYPE or the requiredness wrong, hidden for the
#: life of the feature by a degrade-never-fail wrapper. What was confirmed:
#:
#:   send_message              entity_id, title, message, inline_keyboard
#:                             (`object`; its own example is exactly the nested
#:                             `[[[label, data], …], …]` form built below)
#:   edit_message              message_id REQUIRED, entity_id, message, and an
#:                             OPTIONAL inline_keyboard — omitting it is what
#:                             removes the buttons
#:   answer_callback_query     callback_query_id, message AND show_alert all
#:                             REQUIRED, and it takes NO entity_id at all
#:
#: ⚠️ THAT LAST ONE IS THE TRAP. Every other service here is addressed by
#: entity; this one is addressed by the query id alone, so passing an entity is
#: a 400 and forgetting `show_alert` is another. A press left unanswered spins
#: until Telegram times out.
SEND_SERVICE: Tuple[str, str] = ("telegram_bot", "send_message")
ANSWER_SERVICE: Tuple[str, str] = ("telegram_bot", "answer_callback_query")
EDIT_SERVICE: Tuple[str, str] = ("telegram_bot", "edit_message")

#: ⚠️ THE PLATFORM AS THE ENTITY REGISTRY SPELLS IT. `chat.target_for` matches
#: the same string for the same reason — a notify entity and a notify service
#: are the same shape, so only the registry can say which integration is behind
#: one. Naming a platform is not the hard rule: nothing VILLA-specific may ship,
#: and "Telegram" is not a fact about anybody's property.
PLATFORM: str = "telegram_bot"

#: ⚠️ ONE CHARACTER OF NAMESPACE, BECAUSE TELEGRAM CAPS `callback_data` AT 64
#: BYTES and it has to carry an act and an alert id. `v` for VESTA, so a press
#: meant for something else in the same chat is ignored rather than misread —
#: the retired blueprint used `vd:`/`vh:` and this is deliberately the same
#: grammar, so a button still sitting in somebody's history from before the
#: cutover decodes to the act it always meant.
PREFIX: str = "v"

#: How long the resolved set of Telegram entities is trusted. A registry does
#: not change often and re-reading it per delivery would put a websocket round
#: trip in front of every alert.
REGISTRY_TTL_S: float = 300.0

#: The resolved set and when it was read. ⚠️ A LIST OF ONE TUPLE rather than two
#: module globals, so the pair can only ever be replaced together — a set
#: refreshed without its timestamp is a cache that never expires again.
_ENTITIES: List[Tuple["frozenset[str]", float]] = [(frozenset(), 0.0)]


@dataclass(frozen=True)
class Ref:
    """One sent message, enough to edit it later."""

    entity_id: str
    message_id: str


# ── the wire form ───────────────────────────────────────────────────────────
def encode(code: str, concern_id: str) -> str:
    """`vd:c7`. ⚠️ SHORT BY REQUIREMENT, not by taste — see `PREFIX`."""
    return f"{PREFIX}{code}:{concern_id}"


def decode(data: Any) -> Tuple[str, str]:
    """`vd:c7` → `("done", "c7")`, or `("", "")` for anything not ours.

    ⚠️ EVERY PRESS IN THE CHAT ARRIVES HERE, including presses on buttons put
    there by somebody else's automation. Returning a pair of empty strings for
    an unrecognised one is what keeps this from acting on them, and it is
    checked before the sender is, because a payload must never decide anything.
    """
    from agent import actions as actions_mod

    text = str(data or "")
    if not text.startswith(PREFIX) or ":" not in text:
        return "", ""
    body = text[len(PREFIX):]
    code, _, concern_id = body.partition(":")
    act = actions_mod.act_by_code(code)
    if act is None or not concern_id.strip():
        return "", ""
    return act.id, concern_id.strip()


def keyboard_for(concern: Mapping[str, Any],
                 config: Optional[Mapping[str, Any]] = None) -> List[List[List[str]]]:
    """The inline keyboard for this alert, in Telegram's own nested shape.

    ⚠️ ROWS ARE CHOSEN FOR A PHONE, NOT FOR THE MODEL. Telegram gives every
    button in a row an equal share of the width, so five in a line is five
    unreadable slivers; the two acts that discharge the alert share the top row,
    anything else gets its own, and the thumbs pair at the bottom where a
    verdict belongs. `[[label, data], …]` per row is the structure the service
    documents and the retired blueprint sent.

    ⚠️ AN EMPTY LIST IS A REAL ANSWER and means "this alert wants no buttons" —
    it is settled, and `outbox` sends it through the ordinary path instead.
    """
    from agent import actions as actions_mod

    acts = actions_mod.available_for(concern, config)
    if not acts:
        return []
    ident = str(concern.get("id") or "")
    thumbs = [a for a in acts if a.id in ("useful", "not_useful")]
    rest = [a for a in acts if a.id not in ("useful", "not_useful")]

    rows: List[List[List[str]]] = []
    if len(rest) >= 2:
        rows.append([[a.label, encode(a.code, ident)] for a in rest[:2]])
        rest = rest[2:]
    for act in rest:
        rows.append([[act.label, encode(act.code, ident)]])
    if thumbs:
        rows.append([[a.label, encode(a.code, ident)] for a in thumbs])
    return rows


# ── which targets can carry a button ────────────────────────────────────────
async def telegram_entities(session: Any, *,
                            now: Optional[float] = None) -> "frozenset[str]":
    """Every notify entity on this platform. Cached; `frozenset()` on failure.

    ⚠️ EMPTY ON FAILURE IS THE SAFE DIRECTION. It means "no target can carry
    buttons", so every alert goes out through the ordinary agnostic path — the
    message still arrives, without buttons. Guessing the other way would post an
    `inline_keyboard` to a service that does not take one and lose the alert.
    """
    at = time.time() if now is None else now
    cached, read_at = _ENTITIES[0]
    if cached and (at - read_at) < REGISTRY_TTL_S:
        return cached
    try:
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            entries = await hass.command("config/entity_registry/list")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the entity registry for button targets", err)
        return frozenset()
    ids = frozenset(
        str(e.get("entity_id") or "") for e in entries if isinstance(e, Mapping)
        and str(e.get("platform") or "") == PLATFORM and e.get("entity_id"))
    _ENTITIES[0] = (ids, at)
    return ids


def forget_entities() -> None:
    """Drop the cached registry. For tests, and for a registry that changed."""
    _ENTITIES[0] = (frozenset(), 0.0)


def _bare(target: str) -> str:
    """`entity:notify.x` → `notify.x`. ⚠️ ONLY AN ENTITY TARGET CAN CARRY ONE:
    `telegram_bot.send_message` takes `entity_id` and has no `chat_id` and no
    `target` field — verified against the running instance by `chat.target_for`,
    whose comment says so — so a legacy notify SERVICE has no route here."""
    from reports import deliver as deliver_mod
    return target[len(deliver_mod.ENTITY_PREFIX):] \
        if target.startswith(deliver_mod.ENTITY_PREFIX) else ""


# ── sending ─────────────────────────────────────────────────────────────────
async def send(session: Any, targets: Sequence[str], title: str, body: str,
               keyboard: Sequence[Sequence[Sequence[str]]]) -> List[Dict[str, Any]]:
    """Send with buttons to whichever targets can take them.

    Returns `deliver.deliver`'s own result shape, plus a `ref` on the ones that
    landed — ⚠️ THE SAME SHAPE ON PURPOSE, so `outbox` can treat this and the
    agnostic path identically and neither becomes the special case.

    ⚠️ A TARGET THIS CANNOT SERVE IS REPORTED `skipped`, NOT `failed`. The
    caller sends those through `deliver` afterwards; collapsing the two would
    make a mixed villa — a phone on one platform, Telegram on another — look
    half-broken every time an alert went out.
    """
    known = await telegram_entities(session)
    results: List[Dict[str, Any]] = []
    for target in targets:
        entity_id = _bare(target)
        if not entity_id or entity_id not in known:
            results.append({"target": target, "status": "skipped"})
            continue
        ref = await _send_one(session, entity_id, title, body, keyboard)
        if ref is None:
            # ⚠️ `failed`, AND THE CALLER RETRIES IT PLAINLY. A Telegram that
            # refused an inline keyboard must not cost the alert — the message
            # matters and the buttons are an affordance on top of it.
            results.append({"target": target, "status": "failed",
                            "detail": "the message with buttons was refused"})
            continue
        results.append({"target": target, "status": "sent",
                        "ref": ref, "entity_id": entity_id})
        log(f"delivered to {target} with {sum(len(r) for r in keyboard)} button(s)")
    return results


async def _send_one(session: Any, entity_id: str, title: str, body: str,
                    keyboard: Sequence[Sequence[Sequence[str]]]) -> Optional[Ref]:
    """One message with its keyboard. `None` on any failure. Never raises.

    ⚠️ IT ASKS FOR THE MESSAGE ID AND SURVIVES NOT GETTING ONE. `message_id` is
    the only way a message can ever be edited, so without it the buttons can
    never be retired — but an alert that arrived with live buttons is still far
    better than one that did not arrive. Every use of the ref is guarded, which
    is the same shape the blueprint used (`sent_id | default('')`) and for the
    same reason. `no message id` is logged so this degradation cannot be silent.
    """
    domain, service = SEND_SERVICE
    payload: Dict[str, Any] = {
        "entity_id": entity_id, "title": title, "message": body,
        "inline_keyboard": [[list(b) for b in row] for row in keyboard],
    }
    try:
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            result = await hass.command(
                "call_service", domain=domain, service=service,
                service_data=payload, return_response=True)
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not send a message with buttons to {entity_id}", err)
        return None

    # ⚠️ THE SHAPE IS `{chats: [{chat_id, message_id, entity_id}]}` — VERIFIED
    # against this Home Assistant when the retired blueprint was written, and
    # not merely from a schema: that blueprint's live run captured a real
    # message id and then edited that exact message. Read defensively anyway, a
    # service response is somebody else's data structure.
    #
    # ⚠️ `return_response` IS THE ONE THING HERE NOT PROVEN ON HARDWARE. Home
    # Assistant refuses it for a service that does not declare a response, and
    # the blueprint's `response_variable` is the YAML spelling of the same
    # request — so the service does declare one. If that is ever wrong the
    # command raises, this returns None, and `outbox` sends the alert down the
    # plain path: the owner is still told, without buttons. The failure mode was
    # chosen before the call was written.
    response = result.get("response") if isinstance(result, Mapping) else None
    chats = response.get("chats") if isinstance(response, Mapping) else None
    first = chats[0] if isinstance(chats, list) and chats else None
    message_id = str(first.get("message_id") or "") if isinstance(first, Mapping) else ""
    if not message_id:
        log(f"sent with buttons to {entity_id} but got no message id back — "
            f"they cannot be retired later")
    return Ref(entity_id=entity_id, message_id=message_id)


# ── answering a press ───────────────────────────────────────────────────────
async def handle(event: Mapping[str, Any], *, session: Any,
                 config: Optional[Mapping[str, Any]] = None) -> str:
    """One `telegram_callback` → at most one act. Returns why it stopped.

    ⚠️ THE ORDER OF THE CHECKS IS THE DESIGN, and it is `chat.handle_event`'s
    order for the same reasons: not ours → who is this → only then is anything
    written. Nothing in the payload may influence which role the presser is
    treated as, so the role is resolved from the sender id alone, exactly as a
    typed message is.

    ⚠️ IT RETURNS A REASON RATHER THAN A BOOLEAN. "Nothing happened" has six
    causes here and an operator needs different things from each.
    """
    if str(event.get("event_type") or "") != EVENT_TYPE:
        return ""
    data = event.get("data")
    if not isinstance(data, Mapping):
        return ""
    action_id, concern_id = decode(data.get("data"))
    if not action_id:
        return ""                        # somebody else's button

    from agent import actions as actions_mod
    from agent import policy as policy_mod

    query_id = str(data.get("id") or "")
    message = data.get("message")
    message_id = ""
    if isinstance(message, Mapping):
        message_id = str(message.get("message_id") or "")

    role = policy_mod.sender_role(config, channel="telegram",
                                  sender_id=data.get("user_id"))
    if role not in actions_mod.MAY_ACT:
        # ⚠️ ANSWERED, UNLIKE AN UNKNOWN TYPED MESSAGE. Silence is right for a
        # message from a stranger — it tells a prober nothing — but a button is
        # only visible to somebody already in the chat, and leaving their press
        # spinning forever is a broken app rather than a closed door.
        await _answer(session, query_id, "You cannot act on this alert")
        return "presser may not act"

    who = str(data.get("from_first") or "").strip() or role
    outcome = await actions_mod.apply(session, action_id, concern_id,
                                      by=who, config=config)
    await _answer(session, query_id, outcome.note or
                  ("Done" if outcome.ok else "That did not work"))
    if outcome.ok or outcome.spent:
        # ⚠️ RETIRED ON A REFUSAL TOO, and that is the point rather than an
        # oversight: `spent` means the store says this alert is already dealt
        # with, so the buttons the presser is looking at are the stale ones. The
        # press that discovered it is the best moment to correct them.
        await retire(session, Ref(await _entity_of(session, data), message_id),
                     _closing_line(data, outcome.note))
    stage("button", f"{concern_id} {action_id} by {who}: "
                    f"{'ok' if outcome.ok else outcome.note}")
    return "" if outcome.ok else outcome.note


async def _entity_of(session: Any, data: Mapping[str, Any]) -> str:
    """Which notify entity this press came back through, or "".

    ⚠️ A CALLBACK NAMES A CHAT, NOT AN ENTITY, and `chat.target_for` ALREADY
    OWNS THAT MAPPING — including the `rsplit` that a negative group id needs
    and the cache that keeps it off the per-press path. Walking the registry
    again here would be a second chance to get both wrong, on the one code path
    where being wrong means editing somebody else's message.
    """
    from agent import chat as chat_mod
    target = await chat_mod.target_for(session, str(data.get("chat_id") or ""))
    return _bare(target)


def _closing_line(data: Mapping[str, Any], note: str) -> str:
    """What the message says once its buttons are gone.

    ⚠️ IT NAMES WHO, WHICH THE CALLBACK CARRIES EVEN IN A GROUP CHAT. In a
    shared facility manager chat "Marked done" with nobody's name against it is
    the message everyone assumes somebody else answered.
    """
    who = str(data.get("from_first") or "").strip()
    return f"{note} — {who}" if who else note


async def _answer(session: Any, query_id: str, text: str) -> None:
    """Stop the button spinning. Never raises.

    ⚠️ WITHOUT THIS THE BUTTON SPINS UNTIL TELEGRAM TIMES OUT — observed
    directly during the 2026-08-22 probe and recorded in the blueprint this
    replaces. It is the only feedback a presser gets before the message itself
    is edited, so its text is the outcome in a person's words.
    """
    if not query_id:
        return
    domain, service = ANSWER_SERVICE
    try:
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            await hass.command("call_service", domain=domain, service=service,
                               service_data={"callback_query_id": query_id,
                                             "message": text[:180],
                                             "show_alert": False})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not answer a button press", err)


async def retire(session: Any, ref: Ref, closing: str) -> bool:
    """Remove a message's buttons and say what became of it. Never raises.

    ⚠️ OMITTING `inline_keyboard` IS WHAT REMOVES THE BUTTONS — sending an empty
    one is not the same call, and this is the half the old mobile-app path could
    not do at all. Without it a stale button sits there forever and a second tap
    acts again on an alert already dealt with.
    """
    if not ref.entity_id or not ref.message_id or not closing:
        return False
    domain, service = EDIT_SERVICE
    try:
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            await hass.command("call_service", domain=domain, service=service,
                               service_data={"entity_id": ref.entity_id,
                                             "message_id": ref.message_id,
                                             "message": closing})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not retire the buttons on message {ref.message_id}", err)
        return False
    return True


# ── keeping the phone in step with the tablet ───────────────────────────────
async def reconcile(session: Any, *,
                    config: Optional[Mapping[str, Any]] = None) -> int:
    """Retire the buttons of every alert dealt with somewhere else. Never raises.

    ⚠️ THIS IS THE HALF THAT MAKES THE OWNER'S REQUIREMENT TRUE RATHER THAN
    NEARLY TRUE. A press is answered instantly, but an alert also moves when
    somebody acknowledges it on the tablet, ticks its job in Home Assistant's
    own to-do panel, or when the verification sweep settles it — and none of
    those can reach into a chat. Telegram offers no way to be told a message has
    gone stale, so the only honest mechanism is to ask, on a clock.

    ⚠️ IT RIDES THE CHASE CLOCK RATHER THAN OWNING ONE, exactly as the daily
    digest does. It decides its own work from the store, so all a loop provides
    is somewhere to ask often enough.
    """
    from agent import concerns as concerns_mod

    retired = 0
    for row in concerns_mod.read():
        refs = row.get("messages")
        if not isinstance(refs, list) or not refs:
            continue
        from agent import actions as actions_mod
        if actions_mod.available_for(row, config):
            continue                     # still live: its buttons are correct
        closing = _settled_line(row)
        kept: List[Dict[str, str]] = []
        for raw in refs:
            if not isinstance(raw, Mapping):
                continue
            ok = await retire(session,
                              Ref(str(raw.get("entity_id") or ""),
                                  str(raw.get("message_id") or "")), closing)
            retired += 1 if ok else 0
            # ⚠️ A RETIRED MESSAGE IS FORGOTTEN, which is what stops this
            # rewriting the same message on every tick for the life of the
            # store. One that could not be edited is KEPT and tried again — a
            # Telegram outage must not silently give up on a stale button.
            if not ok:
                kept.append(dict(raw))
        concerns_mod.set_messages(str(row.get("id") or ""), kept)
    if retired:
        stage("button", f"retired the buttons on {retired} message(s)")
    return retired


def _settled_line(row: Mapping[str, Any]) -> str:
    """What a message says once its alert has been dealt with elsewhere.

    ⚠️ IT SAYS WHERE, BECAUSE "these buttons no longer work" without a reason is
    the message that sends somebody to the tablet to check whether it is broken.
    """
    title = " ".join(str(row.get("title") or "").split())
    who = str(row.get("acknowledged_by") or "").strip()
    state = str(row.get("state") or "open")
    from agent import concerns as concerns_mod
    if state in concerns_mod.SETTLED:
        tail = f"Closed ({state})."
    elif who:
        tail = f"Picked up by {who}."
    else:
        tail = "Already dealt with."
    return f"{title}\n\n{tail} Nothing more is needed here."
