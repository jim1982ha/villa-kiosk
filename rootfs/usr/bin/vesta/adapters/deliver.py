"""Getting a finished report to the people who asked for it.

⚠️ THIS IS BUILT, NOT REUSED, AND THE REASON MATTERS. `_service_call_allowed`
in the proxy gates which services a BROWSER FRAME may reach, and `notify` is
not in `ALLOWED_SERVICE_DOMAINS` — deliberately, because nothing in the kiosk
UI sends notifications and a compromised page must not be able to message the
household. A scheduled report is not a browser frame: it originates here, on
the server, from a schedule the owner configured. So delivery calls Core
directly and does not pass through that gate. Widening the browser allowlist to
cover this would hand every open tab the ability to notify.

⚠️ PLATFORM-AGNOSTIC BY CONSTRUCTION. A target is an id DISCOVERED AT RUNTIME;
no platform name appears in this file. That is the hard rule about nothing
villa-specific shipping, and it is what makes moving from
`persistent_notification` to Telegram — or anything else — a configuration
change rather than a code change.

⚠️ AND A TARGET IS NOT ALWAYS A SERVICE. This sentence said "a service id"
until v2.552.0 and had been wrong since v2.549.0, which is the kind of stale
half-sentence that sends the next reader looking for the wrong thing. Three
forms, all discovered, none named here:

  `notify.mobile_app_x`       a classic notify service
  `telegram_bot.send_message` any domain, if it takes `message` + `title`
  `entity:notify.x`           an ENTITY on the modern notify platform

`discovery` decides what may be offered by reading each service's published
schema; `_service_path` and `_payload_for` below are the only two places that
care which form arrived.

The payload is therefore the INTERSECTION of what notify platforms accept:
`title` and `message`, both plain text. Not markdown, not HTML, no `data`
block. Telegram would happily take `data.parse_mode`, and the moment this file
sends one it has a Telegram branch in it, which is the first step toward a
platform table. A report that reads well as plain text reads well everywhere;
one built around a formatting feature reads as literal asterisks on the
platform that lacks it.

⚠️ ONE FAILED TARGET NEVER BLOCKS ANOTHER. A report that reached the owner and
failed to reach the facility manager is not "failed", and collapsing that into
one status is how a resend spams the person who already read it.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Sequence

from aiohttp import ClientError, ClientSession

# ⚠️ THE MODULE, NOT THE NAMES (TASK-115 step 4). `from .hass import
# AUTH_HEADERS` binds an import-time COPY, and `hass.configure()` exists
# precisely to change these after import — an external deployment that
# configured a remote villa would have delivered its notifications to the
# Supervisor address captured here at boot.
from . import hass as hass_mod
from .log import log, warn

# One target's patience. Short: a notify platform that has not answered in this
# long is not going to, and a scheduled pass must not be held open by one
# unreachable service while the others wait behind it.
DELIVERY_TIMEOUT_S = 30.0


#: The domain assumed when a target names none. `notify` because that is what
#: almost every target is, and because a config written by hand as
#: `mobile_app_phone` should work rather than 404 at delivery time — long after
#: the operator chose it.
DEFAULT_DOMAIN = "notify"


def _service_path(target: str) -> str:
    """`notify.mobile_app_x` -> `notify/mobile_app_x`. Any domain.

    ⚠️ THE DOMAIN USED TO BE HARD-CODED, AND THAT CONTRADICTED THIS FILE'S OWN
    HEADER. It claims to be platform-agnostic and says in as many words that
    moving to Telegram is "a configuration change rather than a code change" —
    which was false, because the modern `telegram_bot` integration registers
    `telegram_bot.send_message` and no `notify.telegram_*` service at all. A
    target naming any other domain was rewritten to `notify/<domain>.<service>`
    and 404'd. Found on the reference villa, which has a loaded telegram_bot
    entry and asked where Telegram was in the picker.

    Still no platform name here: the DOMAIN travels in the target string, and
    `discovery._speaks_message` decides what may be offered by reading each
    service's published schema. The payload is unchanged — `title` plus
    `message` is exactly what `telegram_bot.send_message` takes too, which is
    the whole reason this is a one-line generalisation rather than a branch.
    """
    name = target.strip()
    # ⚠️ AN ENTITY TARGET ALWAYS GOES THROUGH ONE SERVICE, whatever integration
    # the entity belongs to — that is the whole design of the entity-based
    # platform, and the reason this stays free of platform names.
    if name.startswith(ENTITY_PREFIX):
        return ENTITY_SERVICE
    domain, _, service = name.partition(".")
    if not service:
        return f"{DEFAULT_DOMAIN}/{domain}"
    return f"{domain}/{service}"


#: An entity-addressed destination, written by `discovery.ENTITY_TARGET_PREFIX`.
#: ⚠️ THE PREFIX EXISTS BECAUSE A SERVICE AND AN ENTITY ARE THE SAME SHAPE.
#: `notify.mobile_app_x` is a service; `notify.living_room_bot_group` is an
#: entity on the modern platform. Nothing about the string distinguishes them,
#: and calling one the other way 404s or 400s at delivery time — long after the
#: operator picked it from a list.
ENTITY_PREFIX = "entity:"

#: The one service that addresses a notify ENTITY. Not a platform name: it is
#: Home Assistant's own generic entry point for the entity-based platform.
ENTITY_SERVICE = "notify/send_message"


def _payload_for(target: str, title: str, message: str,
                 plain_mode: str = "", html_mode: str = "",
                 html_message: str = "") -> Dict[str, Any]:
    """The body for one target, and where it is posted.

    ⚠️ STILL THE INTERSECTION — `title` plus `message`, plain text — with
    `entity_id` added only where the service REQUIRES it to know what it is
    addressing. That is not a platform branch: `notify.send_message` takes an
    entity the way any entity service does, and `discovery` flags exactly this
    case as `needs_target`.

    ⚠️ AND `parse_mode` WHERE THE SERVICE OFFERS ONE, because SENDING plain
    text is not the same as it ARRIVING plain. The reference villa's Telegram
    integration defaults to `parse_mode: markdown`, so it parsed our unmarked
    text on the way in and consumed every underscore as an italic marker: the
    owner's delivered brief read `criticalschedule---poolpump` where the
    console read `critical_schedule---pool_pump`. Lossy, silent, and invisible
    from here — the log said delivered, and it was.

    The value is whatever THAT service calls its no-parsing option, read from
    its own published schema by `discovery._plain_mode`; a service offering
    none gets exactly the payload it got before.
    """
    body: Dict[str, Any] = {"title": title, "message": message}
    if target.startswith(ENTITY_PREFIX):
        body["entity_id"] = target[len(ENTITY_PREFIX):]
    # ⚠️ HTML WINS WHERE THE SERVICE OFFERS IT AND A RICH BODY EXISTS
    # (2026-08-30, owner: the briefing's link arrived as a raw URL beside
    # alerts carrying a hyperlink — one message model for everything). The
    # caller composes the html variant with the SAME tools the alert path
    # uses (`links.html_escape` + `links.html_line`), so there is one dialect
    # and one escaping rule in the tree. No html option, or no rich body
    # supplied, and this function behaves byte-identically to before.
    if html_mode and html_message:
        from vesta.adapters import links as links_mod
        body["message"] = html_message
        body["title"] = links_mod.html_escape(title)
        body["parse_mode"] = html_mode
    elif plain_mode:
        body["parse_mode"] = plain_mode
    return body


async def deliver_one(session: ClientSession, target: str,
                      title: str, message: str,
                      plain_mode: str = "", html_mode: str = "",
                      html_message: str = "") -> Dict[str, Any]:
    """Send to one target. Never raises."""
    url = f"{hass_mod.REST_ROOT}/services/{_service_path(target)}"
    payload = _payload_for(target, title, message, plain_mode,
                           html_mode, html_message)
    try:
        async with session.post(url, headers=hass_mod.AUTH_HEADERS, json=payload,
                                timeout=None) as response:
            if response.status in (200, 201):
                return {"target": target, "status": "sent"}
            body = (await response.text())[:200]
            return {"target": target, "status": "failed",
                    "detail": f"HTTP {response.status}: {body}".strip()}
    except asyncio.TimeoutError:
        return {"target": target, "status": "failed",
                "detail": f"no response within {DELIVERY_TIMEOUT_S:.0f}s"}
    except (ClientError, OSError) as err:
        return {"target": target, "status": "failed", "detail": str(err)}


async def deliver(session: ClientSession, targets: Sequence[str],
                  title: str, message: str,
                  known: Sequence[Dict[str, Any]] = (),
                  html_message: str = "") -> List[Dict[str, Any]]:
    """Send to every target, independently.

    Sequential rather than gathered, on purpose: a villa has a handful of
    targets, the ordering makes the log readable, and firing several
    notification services simultaneously at a Core that may be mid-restart is
    the kind of thundering herd the websocket client already avoids.

    An empty target list is `skipped`, not an error — a report with nowhere to
    go is a configuration state the operator can see and fix, and raising here
    would turn it into a scheduler crash.
    """
    if not targets:
        warn("no delivery target configured — report produced but not sent")
        return []

    # ⚠️ FROM DISCOVERY'S OWN TARGET RECORDS, not a second lookup. The schema
    # was already read this pass; asking Home Assistant again at delivery time
    # would be a second answer to a question already answered, and one more
    # thing to fail while a report is going out.
    plain = {str(t.get("service") or ""): str(t.get("plain_mode") or "")
             for t in known if isinstance(t, dict)}
    html = {str(t.get("service") or ""): str(t.get("html_mode") or "")
            for t in known if isinstance(t, dict)}

    results: List[Dict[str, Any]] = []
    for target in targets:
        result = await asyncio.wait_for(
            deliver_one(session, target, title, message, plain.get(target, ""),
                        html.get(target, ""), html_message),
            timeout=DELIVERY_TIMEOUT_S + 5)
        results.append(result)
        if result["status"] == "sent":
            log(f"delivered to {target}")
        else:
            warn(f"delivery to {target} failed: {result.get('detail', '')}")
    return results
