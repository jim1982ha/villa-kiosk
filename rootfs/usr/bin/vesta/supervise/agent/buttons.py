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
runs on the chase clock and brings the keyboard of any such message back into
step. Immediate on this side, eventually consistent from the other — which is
the strongest promise a chat platform allows, because there is no way to
subscribe to "this message is now wrong".

⚠️ AN ALERT HAS THREE STATES, NOT TWO, AND RECONCILE MISSED THE MIDDLE ONE
(2026-08-28). It asked one question — is this alert SETTLED? — and read every
other answer as "still live: its buttons are correct". But acknowledging an
alert does not settle it: it withdrew exactly ONE act (`Seen — stop chasing`,
now spent) and left the other four live. So the set CHANGED without EMPTYING,
which was the one transition nothing handled, and a message drawn with five
buttons kept offering a fifth the store would refuse. ⚠️ THAT EXAMPLE IS
HISTORY — `Seen` merged into the closer the same day — and the RULE it bought is
not: the set still changes without emptying every time somebody rates an alert,
because a rating may be given once and its pair withdraws. Found on the owner's phone
after they pressed the thumb and Done on the tablet; the log had said `with 5
button(s)` while the store offered four, and both numbers were on screen at once
without being subtracted. **The question is now "do the drawn buttons still
match", and retiring is what happens when the answer is none.**

⚠️ WHICH MEANS A MESSAGE HAS TO REMEMBER WHAT IT WAS DRAWN WITH — `Ref.acts` —
and that record is DERIVED FROM THE KEYBOARD THAT WAS SENT (`acts_of`), never
passed alongside it. A second parameter saying what the first one contains is a
pair that can disagree, and this module's whole premise is that there is no
second implementation to fall out of step with the first.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters.log import log, stage, swallow, warn

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
#:   edit_replymarkup          message_id AND inline_keyboard both REQUIRED,
#:                             entity_id optional (read 2026-08-28). It changes
#:                             the buttons and NOT the text, which is what a
#:                             redraw needs: rewriting the body of an alert
#:                             somebody has already read would move it back to
#:                             the bottom of nothing and reword a message they
#:                             may have acted on.
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
EDIT_MARKUP_SERVICE: Tuple[str, str] = ("telegram_bot", "edit_replymarkup")

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
    """One sent message, enough to edit it later AND to know when to.

    ⚠️ `acts` IS WHAT THE MESSAGE IS SHOWING, not what the alert deserves. The
    second is recomputed on every tick from the store; only the first can say
    whether the phone has fallen behind it, and Telegram will not tell us. It is
    the comma-joined act ids in drawn order, so a change of ORDER counts as a
    change too — the buttons are laid out for a thumb and their positions are
    muscle memory.
    """

    entity_id: str
    message_id: str
    acts: str = ""


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
    from vesta.supervise.agent import actions as actions_mod

    text = str(data or "")
    if not text.startswith(PREFIX) or ":" not in text:
        return "", ""
    body = text[len(PREFIX):]
    code, _, concern_id = body.partition(":")
    act = actions_mod.act_by_code(code)
    if act is None or not concern_id.strip():
        return "", ""
    return act.id, concern_id.strip()


def acts_of(keyboard: Sequence[Sequence[Sequence[str]]]) -> str:
    """What a drawn keyboard is offering, as `Ref.acts`. Reads its OWN buttons.

    ⚠️ DERIVED, NEVER DECLARED. The alternative — `send` taking both a keyboard
    and a list of what is in it — is two statements of one fact, and the one
    that drifts is always the one nobody looks at. Decoding the callback data
    the buttons actually carry means the record cannot describe a message that
    was never sent.

    ⚠️ A BUTTON THIS CANNOT DECODE CONTRIBUTES NOTHING, which is deliberate: a
    row put there by somebody else is not ours to reconcile, exactly as `decode`
    refuses to act on one.
    """
    ids: List[str] = []
    for row in keyboard or []:
        for button in row or []:
            pair = list(button or [])
            action_id, _ = decode(pair[1]) if len(pair) > 1 else ("", "")
            if action_id:
                ids.append(action_id)
    return ",".join(ids)


def keyboard_for(concern: Mapping[str, Any],
                 config: Optional[Mapping[str, Any]] = None) -> List[List[List[str]]]:
    """The inline keyboard for this alert, in Telegram's own nested shape.

    ⚠️ ROWS ARE CHOSEN FOR A PHONE, NOT FOR THE MODEL. Telegram gives every
    button in a row an equal share of the width, so five in a line is five
    unreadable slivers. Three groups: everything that leaves the villa's problem
    STANDING shares the top row, the one irreversible act gets a row to itself so
    it cannot be hit while aiming at a neighbour, and the rating pair sits last
    where a verdict belongs. `[[label, data], …]` per row is the structure the service
    documents and the retired blueprint sent.

    ⚠️ AN EMPTY LIST IS A REAL ANSWER and means "this alert wants no buttons" —
    it is settled, and `outbox` sends it through the ordinary path instead.
    """
    from vesta.supervise.agent import actions as actions_mod

    acts = actions_mod.available_for(concern, config)
    if not acts:
        return []
    ident = str(concern.get("id") or "")
    button = [[a.label, encode(a.code, ident)] for a in acts]
    by_id = {a.id: b for a, b in zip(acts, button)}

    # ⚠️ THE CLEARING PAIR GETS THE WIDE ROW, THE REST SHARE THE NARROW ONE
    # (owner, 2026-08-28: "3/4 for the ✅ and the 🚫 buttons, and 1/4 for both
    # ⬇️ and ⬆️").
    #
    # ⚠️ THE EXACT RATIO IS NOT EXPRESSIBLE AND THIS IS THE CLOSEST THAT IS.
    # Telegram gives every button in a ROW an equal share of the width — there
    # is no span, no weight, no width field — so proportions can only be chosen
    # by how many buttons share a line. Two on the first line is half the width
    # each; three on the second is a third each. The ASKED-FOR 3:1 would need a
    # button to occupy two slots, which the platform does not offer. What the
    # ruling wanted is what this delivers: the two ways to clear an alert are
    # the biggest targets on the message, and the ratings are visibly smaller.
    #
    # ⚠️ AND IT IS ONLY LEGIBLE BECAUSE THE LABELS ARE GLYPHS. Three WORDED
    # buttons on one line are three unreadable slivers on a phone — the reason
    # this was three rows before the emoji ruling. If a label ever grows words
    # again, the layout must be revisited with it.
    wide = [by_id[i] for i in ("done", "dismiss") if i in by_id]
    narrow = [by_id[a.id] for a in acts
              if a.id not in ("done", "dismiss")]
    return [row for row in (wide, narrow) if row]


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
        from vesta.adapters.hass import HassClient
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
    from vesta.adapters import deliver as deliver_mod
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
        from vesta.adapters.hass import HassClient
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
    return Ref(entity_id=entity_id, message_id=message_id,
               acts=acts_of(keyboard))


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

    from vesta.supervise.agent import actions as actions_mod
    from vesta.supervise.agent import policy as policy_mod

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
        # ⚠️ ACTED ON A REFUSAL TOO, and that is the point rather than an
        # oversight: `spent` means the store says this alert is already dealt
        # with, so the buttons the presser is looking at are the stale ones. The
        # press that discovered it is the best moment to correct them.
        #
        # ⚠️ AND WHAT THE MESSAGE BECOMES IS DECIDED BY WHAT THE ALERT STILL
        # OFFERS — the SAME three-way question `reconcile` asks, because it is
        # the same question. This path retired the whole keyboard after ANY
        # press, which is right only for an act that DISCHARGES the alert.
        # `Seen — stop chasing` withdrew itself and left the other acts live
        # (it has since merged into the closer, and a RATING is what withdraws a
        # pair today); the tablet went on offering them while the phone offered
        # none, so the two surfaces disagreed again — the mirror image
        # of the defect fixed hours earlier, and the THIRD time in one day that
        # one rule was applied at one of its two call sites. The owner asked the
        # question that found it: "if I click stop chasing, I should still see
        # the done and thumb up/down buttons, right?" (2026-08-28).
        from vesta.supervise.agent import concerns as concerns_mod
        row = next((r for r in concerns_mod.read()
                    if str(r.get("id")) == str(concern_id)), {})
        remaining = actions_mod.available_for(row, config)
        ref = Ref(await _entity_of(session, data), message_id)
        if remaining:
            # ⚠️ THE TEXT IS REWRITTEN TOO, AND MUST CARRY THE ALERT'S OWN BODY.
            # Editing replaces everything the message showed, and for an alert
            # still open the body IS the content somebody acts on — dropping it
            # for a one-line receipt would leave live buttons under a message
            # that no longer says what they are for.
            keyboard = keyboard_for(row, config)
            if await restate(session, ref, _acted_text(row, outcome.note, who),
                             keyboard):
                concerns_mod.stamp_message(concern_id, message_id,
                                           acts_of(keyboard))
        # ⚠️ A RETIRED REF IS FORGOTTEN, BECAUSE RETIRING IS PERMANENT. A ref
        # exists only so a message can be edited later; this one has just had
        # its buttons removed and its text replaced, so there is nothing left to
        # keep in step. `reconcile` has always forgotten a ref it retired and
        # this path never did — harmless while reconciliation only ever REMOVED
        # buttons, and a live defect the moment it could also PUT THEM BACK.
        elif await retire(session, ref, _closing_line(data, outcome.note)):
            concerns_mod.forget_message(concern_id, message_id)
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
    from vesta.supervise.agent import chat as chat_mod
    target = await chat_mod.target_for(session, str(data.get("chat_id") or ""))
    return _bare(target)


def _acted_text(row: Mapping[str, Any], note: str, who: str) -> str:
    """What a message says after a press that left it with buttons.

    ⚠️ TITLE AND BODY, NOT JUST A RECEIPT. `_closing_line` is a receipt and is
    right for a message that is finished; this one still carries live buttons,
    and an edit replaces everything the message showed — so leaving the body out
    would put `Done` and `Need help` under a line that no longer says what the
    alert was about. The title goes back in for the same reason: editing a
    Telegram message takes text only, and the bold title sent with the original
    is not part of it.
    """
    title = " ".join(str(row.get("title") or "").split())
    body = str(row.get("body") or "").strip()
    tail = str(note or "").strip()
    if tail and who:
        tail = f"{tail} — {who}"
    return "\n\n".join(part for part in (title, body, tail) if part)


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
        from vesta.adapters.hass import HassClient
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
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            await hass.command("call_service", domain=domain, service=service,
                               service_data={"entity_id": ref.entity_id,
                                             "message_id": ref.message_id,
                                             "message": closing})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not retire the buttons on message {ref.message_id}", err)
        return False
    return True


async def restate(session: Any, ref: "Ref", text: str,
                  keyboard: Sequence[Sequence[Sequence[str]]]) -> bool:
    """Say what just happened AND leave the buttons that are still live.

    ⚠️ ONE CALL, BECAUSE TWO WOULD BE VISIBLE. `edit_message` takes an OPTIONAL
    `inline_keyboard`, so text and buttons move together; editing the text and
    then the markup would show a message with the new wording under the OLD
    buttons for as long as the second call takes, which is exactly the state a
    presser would act on.

    ⚠️ IT IS FOR A MESSAGE THAT KEEPS BUTTONS. With none left the call to make
    is `retire`, which OMITS the field — passing an empty list here would leave
    Telegram an empty keyboard rather than no keyboard, the distinction that
    function records.
    """
    if not ref.entity_id or not ref.message_id or not text or not keyboard:
        return False
    domain, service = EDIT_SERVICE
    try:
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            await hass.command(
                "call_service", domain=domain, service=service,
                service_data={
                    "entity_id": ref.entity_id,
                    "message_id": ref.message_id,
                    "message": text,
                    "inline_keyboard": [[list(b) for b in row]
                                        for row in keyboard],
                })
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not restate message {ref.message_id}", err)
        return False
    return True


async def redraw(session: Any, ref: "Ref",
                 keyboard: Sequence[Sequence[Sequence[str]]]) -> bool:
    """Replace a message's buttons with the ones its alert now offers.

    ⚠️ THE BUTTONS AND NOT THE TEXT, which is why this is `edit_replymarkup` and
    not `edit_message` with a keyboard. The body of an alert somebody has
    already read must not change under them: they may have acted on the words,
    and a redraw is not new information — it is the same alert, minus an act
    that has been spent.

    ⚠️ AN EMPTY KEYBOARD IS NOT THIS FUNCTION'S JOB. `inline_keyboard` is
    REQUIRED here, so "no buttons" would have to be expressed as an empty list,
    and Telegram treats that as a keyboard rather than as its absence. Removal
    is `retire`, which omits the field entirely — the same distinction that
    function already records, one call further down.
    """
    if not ref.entity_id or not ref.message_id or not keyboard:
        return False
    domain, service = EDIT_MARKUP_SERVICE
    try:
        from vesta.adapters.hass import HassClient
        async with HassClient(session) as hass:
            await hass.command(
                "call_service", domain=domain, service=service,
                service_data={
                    "entity_id": ref.entity_id,
                    "message_id": ref.message_id,
                    "inline_keyboard": [[list(b) for b in row]
                                        for row in keyboard],
                })
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow(f"could not redraw the buttons on message {ref.message_id}", err)
        return False
    return True


# ── keeping the phone in step with the tablet ───────────────────────────────
async def reconcile(session: Any, *,
                    config: Optional[Mapping[str, Any]] = None) -> int:
    """Bring every message back into step with its alert. Never raises.

    Returns the number of messages CHANGED — retired plus redrawn.

    ⚠️ THIS IS THE HALF THAT MAKES THE OWNER'S REQUIREMENT TRUE RATHER THAN
    NEARLY TRUE. A press is answered instantly, but an alert also moves when
    somebody acknowledges it on the tablet, ticks its job in Home Assistant's
    own to-do panel, or when the verification sweep settles it — and none of
    those can reach into a chat. Telegram offers no way to be told a message has
    gone stale, so the only honest mechanism is to ask, on a clock.

    ⚠️ THE QUESTION IS "DO THE DRAWN BUTTONS STILL MATCH", NOT "IS THIS SETTLED"
    — see the module docstring. Asking the second read an alert whose act set
    had merely CHANGED as one whose buttons were correct. Acknowledgement was
    that case when it withdrew `Seen`; today it is a RATING, which may be given
    once and takes its own pair away. Three outcomes, and the middle one is the
    one that was missing:

        no acts at all   → retire: buttons gone, text says what became of it
        acts differ      → redraw: same text, the buttons it now offers
        acts match       → nothing, and NOTHING IS THE COMMON CASE — a message
                           must not be rewritten on every tick of a 15-minute
                           clock for the life of the store

    ⚠️ A REF REMEMBERED BEFORE `acts` EXISTED HAS NONE, AND IS REDRAWN ONCE.
    An absent record cannot be compared, and treating "I do not know what this
    message shows" as "it is fine" is how the defect would survive its own fix
    on every villa with an alert already out. One redraw stamps it and it
    settles into the common case.

    ⚠️ IT RIDES THE CHASE CLOCK RATHER THAN OWNING ONE, exactly as the daily
    digest does. It decides its own work from the store, so all a loop provides
    is somewhere to ask often enough.
    """
    from vesta.supervise.agent import concerns as concerns_mod
    from vesta.supervise.agent import actions as actions_mod

    retired = redrawn = 0
    for row in concerns_mod.read():
        refs = row.get("messages")
        if not isinstance(refs, list) or not refs:
            continue
        want = actions_mod.available_for(row, config)
        keyboard = keyboard_for(row, config) if want else []
        # ⚠️ FROM THE KEYBOARD, NOT FROM `want`. The two agree today — the
        # rating pair is last in both — but that agreement is nobody's contract:
        # the row layout is a decision about phones and `available_for` is a
        # decision about acts, and the day one is reordered a stamp would
        # describe an order that was never drawn, or match nothing and redraw
        # the same message on every tick forever. Comparing what WILL be drawn
        # against what WAS drawn needs no agreement at all.
        drawn = acts_of(keyboard)
        closing = "" if want else _settled_line(row)
        kept: List[Dict[str, str]] = []
        for raw in refs:
            if not isinstance(raw, Mapping):
                continue
            ref = Ref(str(raw.get("entity_id") or ""),
                      str(raw.get("message_id") or ""),
                      str(raw.get("acts") or ""))
            if want and ref.acts == drawn:
                kept.append(dict(raw))      # in step; leave the message alone
                continue
            if want:
                ok = await redraw(session, ref, keyboard)
                redrawn += 1 if ok else 0
                # ⚠️ THE STAMP GOES ON ONLY IF THE EDIT LANDED. Recording what
                # we MEANT to draw would make the next tick believe a message
                # nobody could reach is correct — the same "an outage must not
                # look like agreement" rule the retire path states below.
                kept.append({**dict(raw), "acts": drawn} if ok else dict(raw))
                continue
            ok = await retire(session, ref, closing)
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
    if redrawn:
        stage("button", f"redrew the buttons on {redrawn} message(s)")
    return retired + redrawn


def _settled_line(row: Mapping[str, Any]) -> str:
    """What a message says once its alert has been dealt with elsewhere.

    ⚠️ IT SAYS WHERE, BECAUSE "these buttons no longer work" without a reason is
    the message that sends somebody to the tablet to check whether it is broken.
    """
    title = " ".join(str(row.get("title") or "").split())
    who = str(row.get("acknowledged_by") or "").strip()
    state = str(row.get("state") or "open")
    from vesta.supervise.agent import concerns as concerns_mod
    if state in concerns_mod.SETTLED:
        tail = f"Closed ({state})."
    elif who:
        tail = f"Picked up by {who}."
    else:
        tail = "Already dealt with."
    return f"{title}\n\n{tail} Nothing more is needed here."
