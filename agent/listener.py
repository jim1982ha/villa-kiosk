"""The one direct connection: it is told things, and it is visible. It asks nothing.

⚠️ THE BOUNDARY IS A RULE, NOT A LIST (ADR-0012). If the layer is asking a
question about the villa it goes through the gateway; this connection exists
only for the two things the gateway structurally CANNOT carry:

1. **Being told.** ha-mcp cannot push — `initialize` declares
   `resources.subscribe: false`, `resources/subscribe` and
   `subscriptions/listen` both answer *Method not found*, every entry point is
   stateless, and the one tool that could pass a raw socket command refuses
   anything matching `subscribe`/`stream` by name, with upstream tests pinning
   it. That is a closed door, not an oversight.
2. **Being visible.** ha-mcp cannot set entity state: the only path that reaches
   `POST /api/states` is denylisted by name. Enabling writes there is
   all-or-nothing and would hand a suggest-only layer the ability to create,
   restore and DELETE backups — five tools can never be disabled. Publishing one
   status entity is not worth that.

The alternative — an automation on the villa that pokes the layer — was rejected
because it must name the watched entities, so every accepted Asset would have to
be added by hand in a second place, with silence as the failure mode.

Addressing is the Supervisor's Core API proxy, which `homeassistant_api: true`
grants along with SUPERVISOR_TOKEN. No `hassio_api`, no `hassio_role`.
"""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from agent.health import Link, LinkState

#: The Supervisor's proxy to Home Assistant Core. Not a third-party host: this
#: name resolves only inside the add-on network.
CORE_WS = "ws://supervisor/core/websocket"
CORE_API = "http://supervisor/core/api"

#: The domain the layer publishes its OWN status under.
#:
#: ⚠️ COMPOSED FROM CONSTANTS, AND THE REASON IS NOT REGEX-DODGING. The hard
#: rule forbids a VILLA's entity_id in shipped code, because it bakes one
#: property into an add-on meant for any of them. These are the layer's own
#: objects, identical on every install, which is the one thing an entity id here
#: may legitimately be — and keeping domain and object separate makes that
#: distinction visible instead of asserted.
STATUS_DOMAIN = "sensor"

WsConnect = Callable[[str], Any]
Post = Callable[[str, dict[str, Any], dict[str, str]], Awaitable[int]]


class Listener:
    """Subscribes to state changes, and publishes the layer's own status."""

    def __init__(self, token: str, ws_connect: WsConnect, post: Post) -> None:
        self._token = token
        self._ws_connect = ws_connect
        self._post = post
        self._link = Link(LinkState.UNKNOWN, "not connected yet")
        self._next_id = 1

    @property
    def link(self) -> Link:
        return self._link

    def _id(self) -> int:
        self._next_id += 1
        return self._next_id - 1

    async def listen(self, on_event: Callable[[dict[str, Any]], Any],
                     stop_after: int | None = None,
                     on_ready: Callable[[], Any] | None = None) -> Link:
        """Authenticate, subscribe, and pump events until the socket closes.

        `stop_after` bounds the pump for tests; None means "until it closes",
        which is what the running add-on wants.
        """
        if not self._token:
            self._link = Link(LinkState.DOWN, "no SUPERVISOR_TOKEN in the environment")
            return self._link
        try:
            async with self._ws_connect(CORE_WS) as ws:
                hello = await _recv(ws)
                if hello.get("type") != "auth_required":
                    self._link = Link(LinkState.DOWN,
                                      f"expected auth_required, got {hello.get('type')!r}")
                    return self._link
                await ws.send_json({"type": "auth", "access_token": self._token})
                ack = await _recv(ws)
                if ack.get("type") != "auth_ok":
                    self._link = Link(LinkState.DOWN,
                                      f"authentication refused: {ack.get('message', ack.get('type'))}")
                    return self._link
                sub_id = self._id()
                await ws.send_json({"id": sub_id, "type": "subscribe_events",
                                    "event_type": "state_changed"})
                result = await _recv(ws)
                if not result.get("success", False):
                    self._link = Link(LinkState.DOWN,
                                      f"subscribe_events refused: {result.get('error')}")
                    return self._link
                self._link = Link(LinkState.UP, "subscribed to state_changed")
                # ⚠️ SAY SO THE MOMENT IT IS TRUE. `listen` does not return
                # while the socket is healthy, so the only thing that published
                # a connected listener was the 5-minute heartbeat — and the
                # first real install sat reading `listener: unknown, not
                # connected yet` for five minutes while it was, in fact,
                # subscribed. A layer that works must not look broken, for the
                # same reason a half-broken one must not look healthy.
                if on_ready is not None:
                    await _maybe_await(on_ready())
                seen = 0
                closed = False
                while stop_after is None or seen < stop_after:
                    message = await _recv(ws)
                    if message is None:
                        closed = True
                        break
                    if message.get("type") == "event":
                        await _maybe_await(on_event(message.get("event", {})))
                    seen += 1
        except Exception as exc:
            self._link = Link(LinkState.DOWN, f"{type(exc).__name__}: {exc}")
            return self._link
        # ⚠️ "WE STOPPED PUMPING" IS NOT "THE SOCKET CLOSED", and the first cut
        # reported both as DOWN. Only the far end going away means the layer has
        # stopped being told things — which is the silence this whole connection
        # exists to make visible. A caller that asked for a bounded pump ended it
        # itself, and the link is still up.
        if closed:
            self._link = Link(LinkState.DOWN, "the socket closed")
        return self._link

    async def publish(self, object_id: str, state: str,
                      attributes: dict[str, Any]) -> None:
        """Assert one of the layer's own status entities.

        The only write this layer makes anywhere. Re-asserted on start, because
        a state set over the REST API does not survive a Home Assistant restart.
        """
        if not self._token:
            # Symmetric with `listen`: without the token there is nothing to try,
            # and a DNS failure is a worse way to learn that than a sentence.
            raise RuntimeError("no SUPERVISOR_TOKEN in the environment — cannot "
                               "publish this add-on's own status entity")
        entity_id = f"{STATUS_DOMAIN}.{object_id}"
        status = await self._post(
            f"{CORE_API}/states/{entity_id}",
            {"state": state, "attributes": attributes},
            {"Authorization": f"Bearer {self._token}",
             "Content-Type": "application/json"},
        )
        if status >= 400:
            raise RuntimeError(f"publishing {entity_id} was refused with HTTP {status}")


async def _recv(ws: Any) -> dict[str, Any] | None:
    message = await ws.receive_json()
    if message is None:
        return None
    if isinstance(message, str):
        return json.loads(message)
    return message


async def _maybe_await(value: Any) -> None:
    if hasattr(value, "__await__"):
        await value
