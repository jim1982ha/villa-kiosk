"""Getting a finished report to the people who asked for it.

⚠️ THIS IS BUILT, NOT REUSED, AND THE REASON MATTERS. `_service_call_allowed`
in the proxy gates which services a BROWSER FRAME may reach, and `notify` is
not in `ALLOWED_SERVICE_DOMAINS` — deliberately, because nothing in the kiosk
UI sends notifications and a compromised page must not be able to message the
household. A scheduled report is not a browser frame: it originates here, on
the server, from a schedule the owner configured. So delivery calls Core
directly and does not pass through that gate. Widening the browser allowlist to
cover this would hand every open tab the ability to notify.

⚠️ PLATFORM-AGNOSTIC BY CONSTRUCTION. A target is a service id discovered at
runtime; no platform name appears in this file. That is the hard rule about
nothing villa-specific shipping, and it is also what makes moving from
`persistent_notification` to Telegram — or anything else — a configuration
change rather than a code change.

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

from .hass import AUTH_HEADERS, REST_ROOT
from .log import log, warn

# One target's patience. Short: a notify platform that has not answered in this
# long is not going to, and a scheduled pass must not be held open by one
# unreachable service while the others wait behind it.
DELIVERY_TIMEOUT_S = 30.0


def _service_path(target: str) -> str:
    """`notify.mobile_app_x` -> `notify/mobile_app_x`.

    Accepts a bare service name too, so a config written by hand without the
    domain still works rather than failing at delivery time with a 404 the
    operator cannot interpret.
    """
    name = target.strip()
    if name.startswith("notify."):
        name = name[len("notify."):]
    return f"notify/{name}"


async def deliver_one(session: ClientSession, target: str,
                      title: str, message: str) -> Dict[str, Any]:
    """Send to one target. Never raises."""
    url = f"{REST_ROOT}/services/{_service_path(target)}"
    payload = {"title": title, "message": message}
    try:
        async with session.post(url, headers=AUTH_HEADERS, json=payload,
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
                  title: str, message: str) -> List[Dict[str, Any]]:
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

    results: List[Dict[str, Any]] = []
    for target in targets:
        result = await asyncio.wait_for(
            deliver_one(session, target, title, message),
            timeout=DELIVERY_TIMEOUT_S + 5)
        results.append(result)
        if result["status"] == "sent":
            log(f"delivered to {target}")
        else:
            warn(f"delivery to {target} failed: {result.get('detail', '')}")
    return results
