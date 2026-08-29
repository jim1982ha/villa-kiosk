"""Which destinations can render formatted text, and how to reach them.

⚠️ THIS EXISTS BECAUSE THE BRIEFING COULD NEVER TAKE THE HTML PATH, ON ANY
VILLA (owner, 2026-08-29, from a delivered brief: "it is not HTML formatted as
the spelling at the bottom of the notification appears in raw"). The mechanism
added a day earlier was correct and unreachable: `deliver` upgrades a message
when the target service PUBLISHES a `parse_mode` field, and
`discovery._html_mode` reads that field from the service's own schema — but the
briefing is delivered through `notify.send_message`, whose schema is exactly
`message` + `title`. Read live from the reference villa: of nine `notify`
services, **none** declares `parse_mode`. So `_html_mode` returned "" every
time, `deliver` fell to the plain body, and the link arrived as a bare URL that
Telegram auto-linked.

⚠️ THE ALERTS WERE FINE, AND THE DIFFERENCE IS THE SERVICE, NOT THE MESSAGE.
The agent's alert path never used `notify` at all — it calls
`telegram_bot.send_message`, which DOES publish `parse_mode`, and its hyperlink
was proven on the owner's phone on 2026-08-28. Two transports to one Telegram
bot: one that can format and one that cannot. The fix is to send the briefing
the way the alerts already go, not to teach `notify` a dialect it has no field
for.

⚠️ THE PLATFORM NAME IS DECLARED HERE AND READ EVERYWHERE ELSE. ⚠️ THIS
SENTENCE SAID "LIVES HERE AND NOWHERE ELSE" FOR ONE DAY AND WAS FALSE WHEN
WRITTEN (/dry-audit Part 3, 2026-08-29): `"telegram_bot"` was a literal in SEVEN
places across THREE modules at the time — `buttons.py`'s four service tuples and
`chat.py`'s two registry filters — and the claim was made by generalising from
the two constants in view, which is the exact failure mode that section
catalogues. They now read `PLATFORM` from here; the sentence describes the tree
because the tree was changed to match it, not because it was reworded.

⚠️ AND WHAT IS DELIBERATELY *NOT* HERE: `answer_callback_query`, `edit_message`
and `edit_replymarkup` stay in `buttons.py`. Answering a press and editing a
keyboard are BUTTON operations with no briefing counterpart, so an adapter the
briefing depends on has no business owning them. Only the platform name and the
send are shared. `deliver.py`'s header
that knows one integration can do more than the intersection is a separate
adapter that `deliver` consults, and the answer it gives is discovered from the
entity registry at runtime rather than configured. `supervise/agent/buttons.py`
held this lookup first, for its keyboards; it now delegates here, so "can this
destination take formatted text" has ONE owner for both callers. A second copy
would be this project's cardinal sin in the place it has already been paid for
twice — and the layer rule forbids the alternative outright: `brief` may import
`shared` and `adapters`, never `supervise`.

⚠️ EMPTY ON FAILURE IS THE SAFE DIRECTION, exactly as it was for buttons. It
means "nothing can take rich text", so every message goes out on the plain path
and still arrives. Guessing the other way posts a `parse_mode` to a service with
no such field and loses the message.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .log import swallow

#: The integration whose notify entities can render formatted text. ⚠️ A NAME,
#: NOT A LIST OF VILLAS — it identifies an integration, which is the same kind
#: of fact as `notify` being the default domain. No entity id, room or site
#: constant appears here, so the hard rule is untouched.
PLATFORM: str = "telegram_bot"

#: How to address one of those entities richly. ⚠️ IT TAKES `entity_id`, NOT
#: `chat_id` and NOT `target` — verified against the running instance; that is
#: why only an ENTITY target can be upgraded and a legacy notify SERVICE cannot.
SEND_DOMAIN: str = "telegram_bot"
SEND_SERVICE: str = "send_message"

#: ⚠️ HTML RATHER THAN MARKDOWN IS A MEASUREMENT (2026-08-28): the same message
#: in markdown returned HTTP 500, because a real device name and our own ingress
#: URL both contain underscores and one unclosed italic kills the send. In HTML
#: an underscore is an ordinary character.
PARSE_MODE: str = "html"

#: How long the registry answer is trusted. An integration is added or removed
#: by a person, so minutes is generous and a stale answer costs one plain
#: message rather than a lost one.
REGISTRY_TTL_S: float = 300.0

#: The resolved set and when it was read. ⚠️ A LIST OF ONE TUPLE rather than
#: two module globals, so the pair can only ever be replaced together — a set
#: refreshed without its timestamp is a cache that never expires again.
_ENTITIES: List[Tuple["frozenset[str]", float]] = [(frozenset(), 0.0)]


def service_path() -> str:
    """`telegram_bot/send_message` — the REST path segment `deliver` posts to."""
    return f"{SEND_DOMAIN}/{SEND_SERVICE}"


def forget_entities() -> None:
    """Drop the cached registry. For tests, and for a registry that changed."""
    _ENTITIES[0] = (frozenset(), 0.0)


async def capable_entities(session: Any, *,
                           now: Optional[float] = None) -> "frozenset[str]":
    """Every notify entity that can render formatted text. Cached.

    Returns bare entity ids (`notify.x`), never the `entity:` target form —
    the caller strips its own prefix, because the prefix is `deliver`'s
    vocabulary and this module should not have to know it.
    """
    at = time.time() if now is None else now
    cached, read_at = _ENTITIES[0]
    if cached and (at - read_at) < REGISTRY_TTL_S:
        return cached
    try:
        from .hass import HassClient
        async with HassClient(session) as hass:
            entries = await hass.command("config/entity_registry/list")
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the entity registry for rich-text targets", err)
        return frozenset()
    ids: "frozenset[str]" = frozenset(
        str(e.get("entity_id") or "") for e in entries if isinstance(e, Mapping)
        and str(e.get("platform") or "") == PLATFORM and e.get("entity_id"))
    _ENTITIES[0] = (ids, at)
    return ids


def payload(entity_id: str, title: str, html_body: str,
            keyboard: Optional[Sequence[Sequence[Sequence[str]]]] = None,
            ) -> Dict[str, Any]:
    """The rich service payload. ⚠️ ONE SPELLING OF `parse_mode` FOR BOTH
    CALLERS — the briefing passes no keyboard, the agent passes one, and
    everything else about the message is identical. That sameness is the point:
    an owner reading an alert and a briefing should not be able to tell that two
    code paths produced them.

    ⚠️ THAT WAS AN ASPIRATION FOR ONE DAY, NOT A DESCRIPTION (/dry-audit,
    2026-08-29). Only `deliver` called this; `buttons._send_one` went on
    assembling the same four fields inline, so `keyboard` was a parameter
    written for a caller that was never wired — dead on arrival, and the
    docstring above asserted the opposite. Both callers now come through here,
    which is what makes the claim checkable rather than hopeful.
    `test_rich_delivery` pins that this has more than one caller."""
    body: Dict[str, Any] = {
        "entity_id": entity_id,
        "title": title,
        "message": html_body,
        "parse_mode": PARSE_MODE,
    }
    if keyboard is not None:
        body["inline_keyboard"] = [[list(b) for b in row] for row in keyboard]
    return body
