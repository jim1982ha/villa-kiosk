#!/usr/bin/env python3
"""Token-injecting Supervisor proxy for the Villa Kiosk add-on.

The browser makes same-origin, *token-less* requests to this service — whether
the kiosk is opened through the HA sidebar (Ingress) OR directly on the add-on's
own hostname (e.g. via a Cloudflare Tunnel to the exposed port). We add the
add-on's SUPERVISOR_TOKEN server-side and forward to the Supervisor's Home
Assistant Core proxy, so no Home Assistant long-lived token is ever needed and
the powerful Supervisor token never reaches the browser.

  REST : /core/api/...    -> http://supervisor/core/api/...    (+ Bearer header)
  WS   : /core/websocket  -> ws://supervisor/core/websocket    (+ Bearer header,
         and the in-band `{"type":"auth"}` message's access_token is rewritten to
         the Supervisor token, since the HA websocket authenticates in-band).

It also serves local helper routes (no Supervisor token involved):
  GET  /addon-config  -> the non-sensitive model paths for the frontend.
  POST /model-upload?kind=glb|rooms -> writes the body to the central model file
       (GLB) or its room-data sidecar (.rooms.json) under the add-on's own
       persistent /data volume (atomic overwrite), so the kiosk can be re-skinned
       from its own Settings UI instead of SSH/Samba.
  GET  /auth/roles    -> which kiosk profiles require a passcode (booleans only).
  POST /auth/verify   -> server-side profile passcode check. The configured PINs
       (guest_pin/owner_pin/ops_pin add-on options) never leave this process:
       the frontend submits {role, pin} and gets back only an ok/locked verdict.
       Comparison is constant-time; repeated failures rate-limit the role. On
       success it SETS a signed session cookie (see below).
  GET  /auth/check    -> nginx auth_request backend: 200 when the caller holds a
       valid session (or arrives via Ingress), 401 otherwise. Gates /model/.

Access control (why this proxy authenticates at all):
  The Supervisor token this process injects grants full Home Assistant API
  access. Under Ingress that's safe because HA has already authenticated the
  user and nginx only accepts the Ingress gateway. But the add-on's port is now
  ALSO exposed directly (for Cloudflare/LAN access without the HA UI), so an
  unauthenticated request reaching /core/ would otherwise get that full access.
  Therefore every sensitive endpoint (/core/*, /model/*, /model-upload,
  /addon-config) requires a valid session:
    * Ingress-sourced requests are trusted (HA already authed them) — nginx
      tags them with `X-VK-Ingress: 1` based on the real gateway source IP,
      a header the client cannot forge because nginx overwrites it. Treated
      as owner-equivalent (see _role_for()) since reaching an add-on's
      Ingress panel already implies HA admin.
    * Direct requests must carry a `vk_session` cookie, an HMAC-signed token
      minted by /auth/verify once the profile passcode checks out. So the
      client-side profile gate is now backed by a real server-side session:
      no cookie -> no HA access, no floor-plan download.
    * EXCEPTION — /model/* and /addon-config only, and only when the add-on
      option `public_model_access` is enabled (default off): these become
      reachable with no session at all. This exists so the kiosk app can
      start decoding the (multi-second) GLB while the user is still on the
      profile-select/PIN screen instead of only after login — see
      _model_authorized() / _public_model_access(). /core/* (Home Assistant
      control) and the PINs are NEVER affected by this option.

  A valid session used to be the WHOLE story: any authenticated role (guest
  included) could reach the raw /core/websocket or /core/api/* bridge and,
  from a browser devtools console, call ANY Home Assistant service in ANY
  domain — automations, scripts, alarm_control_panel, config, arbitrary
  template rendering, homeassistant.restart/stop — none of which the guest/
  ops profiles in src/auth/permissions.ts are meant to reach. That matrix
  only ever filtered what the 3D view RENDERS; it was never enforced at the
  point a service call actually leaves the browser, because until this add-on's
  port was exposed directly, Ingress-only access meant the caller already had
  full HA admin access via the main HA UI anyway — the kiosk's own RBAC was UX,
  not a security boundary. Now that a `guest`/`ops` session can be established
  over the open internet via a 4-digit PIN, that gap is a real privilege
  escalation. _service_call_allowed() closes the dangerous part of it: for any
  non-owner role, call_service (WS) and /core/api/services/<domain>/<service>
  (REST) are restricted to the small, fixed set of domains the kiosk's own UI
  ever calls (see src/ha/HAServiceCalls.ts) — light/climate/lock/cover/fan/
  switch/media_player, plus homeassistant.toggle. Anything else reaching this
  proxy from a non-owner session is either a bug or someone driving the raw
  API from devtools, and is rejected before it reaches Core.
  This does NOT restrict what a non-owner session can READ (get_states /
  subscribe_events still stream every entity in the whole HA instance,
  cameras included) — the kiosk's category/type filtering
  (permissions.ts/deniedTypes) that hides those from guest is resolved from
  entityMap, which lives only in the browser's own localStorage and is never
  visible to this process, so a faithful server-side mirror of THAT part of
  the matrix isn't possible without moving entity metadata into the add-on's
  own storage — a larger change, not attempted here. Camera images
  specifically ARE blocked server-side for guest (see _rest_call_allowed),
  since that one denial needs no entity metadata, just the request path.

Security notes:
  * Request smuggling (aiohttp CVE-2025-53643) affects only aiohttp's *pure
    Python* HTTP parser; the Alpine `py3-aiohttp` package ships the compiled
    (llhttp) C extension, so that path is not in use. Keep the HA base image
    current so aiohttp stays patched.
  * `rest_handler` strips the client's `Transfer-Encoding`/`Content-Length`
    (see HOP_BY_HOP) and lets aiohttp re-frame the forwarded body, so a client
    cannot desync nginx and Core via conflicting framing headers.
  * This service binds to loopback only and is never directly reachable; nginx
    is the only thing in front of it.
"""
import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
from datetime import datetime, timezone

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

SUPERVISOR = "supervisor"
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
AUTH = {"Authorization": f"Bearer {TOKEN}"}

# The full set of options config.yaml's schema currently recognises. Kept
# separate from the schema itself so this can compare against it — see
# _cleanup_stale_options below. (model_path was dropped when central models
# moved into the add-on's own /data volume; leaving it here would make the
# self-heal below wrongly preserve a now-unknown key.)
# Options that USED to exist and no longer do. The self-heal strips exactly
# these and nothing else.
#
# This was an ALLOWLIST — "keep the keys this build knows, drop the rest" — and
# that is backwards for a component shipped inside a Docker image. config.yaml
# and translations/ come from the REPOSITORY and update the moment the add-on
# repo refreshes; this Python comes from the IMAGE and only updates when a new
# image is pulled. So between those two moments the UI offers an option that
# the running code has never heard of, and the self-heal helpfully deletes it
# on every start — the operator toggles it, restarts, and finds it off again,
# with no error anywhere. That is exactly what happened to
# `public_model_access`, which lived in config.yaml for many releases without
# ever being listed here.
#
# A denylist cannot do that. Its failure mode is a stale key lingering until
# someone names it here, which is a log warning; the allowlist's failure mode
# was silently discarding a setting the operator had deliberately chosen.
REMOVED_OPTION_KEYS = {"sh3d_path", "model_path"}

# The add-on's OWN persistent volume (Supervisor gives every add-on /data and
# preserves it across restarts/updates). Central model files live here now —
# NOT in the HA config's www folder — so the add-on no longer needs write
# access to /config and nothing sensitive is exposed on HA's unauthenticated
# /local/ static route. nginx serves it at /model/<path> (session-gated); the
# upload handler below writes into it.
DATA_ROOT = "/data/www"
# The single managed location an uploaded model lands at. addon_config_handler
# reports it as the effective path once the file exists, so an uploaded model
# lights up for every client with no Supervisor API call or add-on restart.
MANAGED_PATH = {"glb": "villa.glb"}

# ── Session auth ─────────────────────────────────────────────────────────────
SESSION_COOKIE = "vk_session"
SESSION_EPOCH_FILE = "/data/session-epoch"
SESSION_SECRET_FILE = "/data/.session_secret"
# How long a kiosk stays "logged in" — the DEFAULT; see _session_ttl(), which
# an operator can override through the add-on's session_days option.
_session_secret_cache: bytes | None = None


def _session_secret() -> bytes:
    """The per-install HMAC key for session tokens, persisted in /data so it
    survives restarts (existing sessions stay valid across an add-on update).
    Created once, 0600, on first use."""
    global _session_secret_cache
    if _session_secret_cache is not None:
        return _session_secret_cache
    try:
        with open(SESSION_SECRET_FILE, "rb") as f:
            existing = f.read().strip()
        if len(existing) >= 32:
            _session_secret_cache = existing
            return existing
    except OSError:
        pass
    fresh = secrets.token_hex(32).encode()
    try:
        with open(SESSION_SECRET_FILE, "wb") as f:
            f.write(fresh)
        os.chmod(SESSION_SECRET_FILE, 0o600)
    except OSError as err:  # /data unwritable is fatal-ish, but degrade to
        # a process-lifetime secret rather than crashing (sessions then reset
        # on restart, which just means re-entering the PIN).
        print(f"[supervisor-proxy] could not persist session secret: {err}", flush=True)
    _session_secret_cache = fresh
    return fresh


def _session_epoch() -> int:
    """Monotonic counter mixed into every session signature.

    Sessions are stateless signed tokens with a 30-day life, which is right for
    a kiosk that should not re-prompt daily — but it also meant a token that
    leaked (a browser left open, a shoulder-surfed PIN) stayed valid for a
    month with no way to invalidate it short of destroying the signing key.
    Bumping this epoch invalidates every outstanding session at once while
    KEEPING the signing key, so /auth/logout-all is a supported operation
    rather than a filesystem intervention."""
    try:
        with open(SESSION_EPOCH_FILE, "r", encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (OSError, ValueError):
        return 0


def _bump_session_epoch() -> int:
    nxt = _session_epoch() + 1
    try:
        with open(SESSION_EPOCH_FILE, "w", encoding="utf-8") as f:
            f.write(str(nxt))
        os.chmod(SESSION_EPOCH_FILE, 0o600)
    except OSError as err:
        print(f"[supervisor-proxy] could not persist session epoch: {err}", flush=True)
    return nxt


def _sign_session(role: str, exp: int) -> str:
    return hmac.new(
        _session_secret(),
        f"{role}.{exp}.{_session_epoch()}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _make_session_token(role: str) -> str:
    exp = int(time.time()) + _session_ttl()
    return f"{role}.{exp}.{_sign_session(role, exp)}"


def _session_role(token: str | None) -> str | None:
    """The role a session token proves, or None if malformed/expired/forged."""
    if not token:
        return None
    try:
        role, exp_s, sig = token.split(".")
        exp = int(exp_s)
    except (ValueError, AttributeError):
        return None
    if role not in AUTH_ROLES or exp < int(time.time()):
        return None
    if not hmac.compare_digest(sig, _sign_session(role, exp)):
        return None
    return role


def _is_ingress(request: web.Request) -> bool:
    """True when nginx tagged this as coming from the HA Ingress gateway. nginx
    sets X-VK-Ingress from the real source IP and overwrites any client-supplied
    value, so this cannot be forged from the outside."""
    return request.headers.get("X-VK-Ingress") == "1"


def _authorized(request: web.Request) -> bool:
    """Whether the caller may reach a sensitive endpoint: trusted via Ingress,
    or carrying a valid session cookie."""
    if _is_ingress(request):
        return True
    return _session_role(request.cookies.get(SESSION_COOKIE)) is not None


def _role_for(request: web.Request) -> str:
    """The caller's role, for authorization decisions beyond "is there any
    valid session at all" (see _authorized above). Ingress already means HA
    authenticated this browser as an admin (module docstring's Access control
    section) — treat it as owner-equivalent. A direct-path caller's role
    comes from its signed session cookie, which is always valid here in
    practice (callers only reach this after _authorized() passed) — the
    "guest" fallback is defense in depth for a should-never-happen None,
    failing toward the LEAST privileged role rather than trusting one."""
    if _is_ingress(request):
        return "owner"
    return _session_role(request.cookies.get(SESSION_COOKIE)) or "guest"


# The exact (domain, service) surface the kiosk's own UI ever calls — see
# src/ha/HAServiceCalls.ts and the one generic callService() use in
# SwitchPanel.tsx (homeassistant.toggle). Anything outside this reaching
# call_service/services/* from a non-owner session did not come from a kiosk
# button. Keep this in sync if a new panel starts calling a new domain —
# the failure mode of forgetting is a clear "service not permitted" error on
# that panel's very first click, not a silent gap.
ALLOWED_SERVICE_DOMAINS = {"light", "climate", "lock", "cover", "fan", "switch", "media_player"}
# homeassistant.* also holds system-level services (restart, stop,
# reload_core_config, set_location, ...) — only the generic toggle
# SwitchPanel actually uses is let through.
ALLOWED_HOMEASSISTANT_SERVICES = {"toggle"}


def _service_call_allowed(role: str, domain: str, service: str) -> bool:
    """Whether a call_service (WS) / services/<domain>/<service> (REST) frame
    from this role may reach Core. Owner administers the kiosk and is exempt
    (matches its "manageModel"/full capability set in permissions.ts); every
    other role is confined to the domains above regardless of what
    permissions.ts's category/type matrix would otherwise show them."""
    if role == "owner":
        return True
    if domain == "homeassistant":
        return service in ALLOWED_HOMEASSISTANT_SERVICES
    return domain in ALLOWED_SERVICE_DOMAINS


def _public_model_access() -> bool:
    """Opt-in add-on option (default off): treat /model/* and /addon-config as
    PUBLIC — reachable with no session at all. Deliberately narrow to those two
    routes; /core/* (Home Assistant control) always goes through _authorized()
    regardless. Read fresh on every call (not cached) so flipping the option
    takes effect without restarting this process."""
    return bool(_read_options().get("public_model_access", False))


def _model_authorized(request: web.Request) -> bool:
    """Gate for /model/* and /addon-config specifically — same as _authorized()
    PLUS the public_model_access escape hatch. See its docstring for the
    security trade-off this represents."""
    return _authorized(request) or _public_model_access()


def _set_session_cookie(resp: web.Response, role: str) -> None:
    resp.set_cookie(
        SESSION_COOKIE, _make_session_token(role),
        max_age=_session_ttl(), httponly=True, samesite="Lax", secure=True, path="/",
    )


def _unauthorized() -> web.Response:
    return web.json_response({"error": "unauthorized"}, status=401)


def _forbidden(message: str = "forbidden") -> web.Response:
    """Distinct from _unauthorized(): the session IS valid, its role just
    isn't allowed to do this specific thing."""
    return web.json_response({"error": message}, status=403)
# Safety cap on a single upload (the GLB is the big one, ~tens of MB).
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
# Leading bytes the upload must start with for its declared kind: a binary
# glTF container always begins with "glTF"; the room-data sidecar is JSON, so it
# starts with "{" (optionally a UTF-8 BOM). Files under /config/www are served by
# both this add-on (/model/) and HA itself (/local/), so without this check any
# bytes POSTed as kind=glb would be published there verbatim (unrestricted file
# upload).
UPLOAD_MAGIC = {
    "glb": (b"glTF",),
    "rooms": (b"{", b"\xef\xbb\xbf{"),
}

# Headers that must not be copied verbatim when relaying a proxied response.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
    "content-encoding",  # aiohttp already decompresses the upstream body
}


async def ws_handler(request: web.Request):
    """Bridge the browser websocket to Core, injecting the Supervisor token."""
    if not _authorized(request):
        # Cookies ARE sent on a same-origin WS handshake, so an unauthenticated
        # direct caller is rejected before any socket to Core is opened.
        return _unauthorized()
    role = _role_for(request)
    client = web.WebSocketResponse(heartbeat=30)
    await client.prepare(request)

    session: ClientSession = request.app["session"]
    async with session.ws_connect(
        f"ws://{SUPERVISOR}/core/websocket", headers=AUTH, heartbeat=30,
    ) as upstream:

        async def to_upstream() -> None:
            async for msg in client:
                if msg.type == WSMsgType.TEXT:
                    data = msg.data
                    # The browser has no token, so rewrite the auth handshake.
                    try:
                        obj = json.loads(data)
                        if obj.get("type") == "auth":
                            obj["access_token"] = TOKEN
                            data = json.dumps(obj)
                        elif role != "owner" and str(obj.get("type", "")) not in ALLOWED_WS_TYPES:
                            # Default deny — see ALLOWED_WS_TYPES.
                            await client.send_json({
                                "id": obj.get("id"),
                                "type": "result",
                                "success": False,
                                "error": {
                                    "code": "unauthorized",
                                    "message": "This profile may not send this command.",
                                },
                            })
                            continue
                        elif (role == "guest" and str(obj.get("type", "")) == "camera/stream"):
                            # Mirrors the camera_proxy denial for guest on REST.
                            await client.send_json({
                                "id": obj.get("id"),
                                "type": "result",
                                "success": False,
                                "error": {
                                    "code": "unauthorized",
                                    "message": "This profile may not view cameras.",
                                },
                            })
                            continue
                        elif obj.get("type") == "call_service" and not _service_call_allowed(
                            role, str(obj.get("domain", "")), str(obj.get("service", "")),
                        ):
                            # Reply to the BROWSER, not Core — mirrors HA's own
                            # websocket error shape (id + success:false) so the
                            # kiosk's pending call_service promise resolves
                            # (rejects) instead of hanging forever, and never
                            # forward the frame upstream.
                            await client.send_json({
                                "id": obj.get("id"),
                                "type": "result",
                                "success": False,
                                "error": {
                                    "code": "unauthorized",
                                    "message": "This profile may not call this service.",
                                },
                            })
                            continue
                    except (ValueError, TypeError):
                        pass
                    await upstream.send_str(data)
                elif msg.type == WSMsgType.BINARY:
                    await upstream.send_bytes(msg.data)
                else:
                    break
            await upstream.close()

        async def to_client() -> None:
            async for msg in upstream:
                if msg.type == WSMsgType.TEXT:
                    await client.send_str(msg.data)
                elif msg.type == WSMsgType.BINARY:
                    await client.send_bytes(msg.data)
                else:
                    break
            await client.close()

        await asyncio.gather(to_upstream(), to_client())
    return client


_SERVICES_PATH_RE = re.compile(r"^services/([^/]+)/([^/]+)/?$")
# A tail we are willing to reason about at all. Anything with %-encoding, a
# semicolon, a backslash, whitespace or a null is ambiguous — it may mean one
# thing to this regex and another to Core — so it is refused rather than
# interpreted. Refusing the ambiguous input is the whole point; trying to
# normalise it is how bypasses get written.
# ":" and "+" are here because history/period takes an ISO-8601 timestamp
# ("2026-01-01T00:00:00+08:00"). aiohttp decodes the path before match_info, so
# the client's encodeURIComponent output arrives as those literal characters.
# Neither can create a path segment or escape a directory, so admitting them
# costs nothing; omitting them silently broke every history chart for guest and
# facility-manager sessions, which is how this was caught.
_SAFE_TAIL_RE = re.compile(r"^[A-Za-z0-9_\-./:+]+$")
# The ONLY non-service REST paths the kiosk itself requests (see
# src/ha/HAHistoryAPI.ts, src/ha/HALogbookAPI.ts and HACameraProxy.ts).
# Everything else a non-owner might ask for is denied by default. "logbook/"
# is read-only (same category as history/period/ above it) — added for the
# Cockpit page's recent-activity feed, which reads Home Assistant's own
# Logbook rather than re-deriving readable event text client-side.
_NON_OWNER_REST_PREFIXES = ("history/period/", "logbook/", "camera_proxy/", "camera_proxy_stream/")
# Guests unlock doors — deliberately. A guest is the person staying in the
# villa, and permissions.ts puts access_control in their categories for exactly
# that reason. The guest profile is PIN-protected in this deployment, so the
# PIN is what authenticates them; there is no separate gate on lock/cover.
#
# The one configuration where that reasoning breaks is a guest profile with NO
# PIN set, which grants a session to whoever reaches the URL. config.yaml ships
# every PIN empty, so a fresh install is in that state until the operator sets
# one. See the Access control notes in this module's docstring.
# Websocket frame types the kiosk itself ever sends (src/ha/HAWebSocket.ts,
# HACameraProxy.ts). Non-owner sessions may send NOTHING else.
#
# The websocket previously inspected only "call_service" and forwarded every
# other frame untouched — but the browser is not a boundary, and a session can
# send any frame it likes. HA's websocket API accepts "execute_script", which
# runs a sequence of script actions INCLUDING service calls: a guest could have
# wrapped lock.unlock in one and stepped straight past the service allowlist
# that the call_service branch exists to enforce. "render_template" is the same
# arbitrary-Jinja2 exposure that the REST "template" path already blocks, and
# "supervisor/api" reaches the Supervisor itself. Enumerating the dangerous
# frames would have repeated the REST mistake, so this is an allowlist.
#
# The four *_registry/list + get_config entries below are READ-only (HA's
# websocket API has no "list"-suffixed frame that mutates anything — writes are
# separate "*/create"/"*/update"/"*/delete" frames, e.g. the already-blocked
# "config/entity_registry/update"). This module's own docstring is explicit
# that reads are not the boundary this allowlist enforces (get_states/
# subscribe_events already stream every entity to every role); these four were
# simply added to the kiosk's client code (src/ha/HAWebSocket.ts, src/ha/
# HAStateStore.tsx) after this allowlist was written, and nobody revisited it —
# not a deliberate decision to keep guest/ops blind to room/area names. Kept
# them out of "the kiosk itself ever sends" framing above since they widen who
# may send them (every role now, not just owner), not what may be sent.
#
# The three energy/recorder entries below are the same category again, added
# for the Cockpit page's "Energy today" tile: energy/get_prefs reads which
# statistic IDs the Energy Dashboard is configured against (not the values),
# recorder/list_statistic_ids lists which of those actually have recorded
# data (an Energy Dashboard source can reference a statistic ID that no
# longer resolves — e.g. after an unrelated entity rename — so the client
# cross-checks before trusting one), and recorder/statistics_during_period
# reads the pre-aggregated "change" for a real statistic over a period. All
# three are read-only, same as the registry list calls above.
ALLOWED_WS_TYPES = frozenset({
    "auth", "ping", "pong",
    "subscribe_events", "unsubscribe_events",
    "get_states", "call_service", "camera/stream",
    "get_config",
    "config/entity_registry/list", "config/device_registry/list", "config/area_registry/list",
    "energy/get_prefs", "recorder/list_statistic_ids", "recorder/statistics_during_period",
})


def _rest_call_allowed(role: str, tail: str) -> bool:
    """Whether a non-owner session's REST call may reach Core. Owner is exempt.

    DEFAULT DENY. This function used to end in `return True`, so it only
    blocked the paths someone had thought to name — and a path that merely
    LOOKED different from the pattern sailed through. Every one of these
    reached Core from a guest session, because none matched the services regex
    and none started with the literal strings being checked:

        SERVICES/lock/unlock            (capitals)
        ./services/lock/unlock          (dot-relative)
        services//lock/unlock           (empty segment)
        services/../services/lock/unlock
        services/lock/unlock%00 , ...;a=b

    The same hole let `./template` past the template block, which is arbitrary
    Jinja2 evaluation against the entire HA instance. An allowlist that fails
    open is not an allowlist. Now: refuse anything ambiguous, then permit only
    what the kiosk actually asks for."""
    if role == "owner":
        return True
    if not tail or not _SAFE_TAIL_RE.fullmatch(tail):
        return False
    if ".." in tail or "//" in tail or tail.startswith(("./", "/")):
        return False

    t = tail.rstrip("/")
    m = _SERVICES_PATH_RE.match(t)
    if m:
        # HA's REST API accepts POST /api/services/<domain>/<service> as an
        # exact equivalent of the websocket's call_service — same allowlist.
        return _service_call_allowed(role, m.group(1), m.group(2))
    if role == "guest" and t.startswith(("camera_proxy/", "camera_proxy_stream/")):
        # permissions.ts denies the "camera" type to guest, but that's a
        # client-side render filter — mirror the intent here since a camera
        # image request needs no entity-metadata lookup to recognise.
        return False
    return t.startswith(_NON_OWNER_REST_PREFIXES)


async def rest_handler(request: web.Request) -> web.StreamResponse:
    """Relay a REST call to Core, adding the Supervisor Bearer token."""
    if not _authorized(request):
        return _unauthorized()
    role = _role_for(request)
    tail = request.match_info.get("path", "")
    if not _rest_call_allowed(role, tail):
        return _forbidden("This profile may not access this endpoint.")
    session: ClientSession = request.app["session"]
    url = f"http://{SUPERVISOR}/core/api/{tail}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    headers["Authorization"] = f"Bearer {TOKEN}"

    body = await request.read()
    async with session.request(
        request.method, url, params=request.query, data=body or None,
        headers=headers, allow_redirects=False,
    ) as upstream:
        resp = web.StreamResponse(status=upstream.status)
        for k, v in upstream.headers.items():
            if k.lower() not in HOP_BY_HOP:
                resp.headers[k] = v
        await resp.prepare(request)
        async for chunk in upstream.content.iter_chunked(8192):
            await resp.write(chunk)
        await resp.write_eof()
        return resp


def _read_options() -> dict:
    try:
        with open("/data/options.json") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


async def _cleanup_stale_options(session: ClientSession) -> None:
    """Self-heal an add-on options key left over from a dropped schema field.

    Supervisor persists the add-on's raw configured options independently of
    config.yaml's current schema — a field removed from the schema (e.g. the
    old `sh3d_path`, or `model_path` once central models moved into the add-on's
    own /data volume) stays in that stored config forever, on every install that
    had ever set it, unless something explicitly clears it. Supervisor
    re-validates the stored config against the CURRENT schema on basically
    every poll/reload cycle, so an orphaned key logs a
    "does not exist in the schema" warning continuously — and that kind of
    persistent validation error is a known way for Supervisor/Core to lose
    sync on the add-on's state (e.g. the Update button not registering as
    clickable until a full HA restart forces a clean reload).

    Fetch our own stored options and, if any key is one this add-on has
    actually retired, write back everything else — using the exact same
    Supervisor endpoint the Configuration tab's Save button uses. Runs once
    at every startup; a no-op once nothing stale remains. Best-effort: never
    let this block or fail startup — an API shape mismatch on some future
    Supervisor version should degrade to "warning keeps appearing", not
    "add-on won't start".
    """
    try:
        async with session.get(
            f"http://{SUPERVISOR}/addons/self/info", headers=AUTH,
        ) as resp:
            if resp.status != 200:
                return
            body = await resp.json()
        options = (body.get("data") or {}).get("options") or {}
        stale = sorted(set(options) & REMOVED_OPTION_KEYS)
        if not stale:
            return
        cleaned = {k: v for k, v in options.items() if k not in REMOVED_OPTION_KEYS}
        async with session.post(
            f"http://{SUPERVISOR}/addons/self/options", headers=AUTH,
            json={"options": cleaned},
        ) as resp:
            if resp.status == 200:
                print(f"[supervisor-proxy] cleared stale option key(s): {stale}", flush=True)
            else:
                print(
                    f"[supervisor-proxy] stale option key(s) {stale} found but "
                    f"clearing them failed (HTTP {resp.status})", flush=True,
                )
    except Exception as err:  # noqa: BLE001 — best-effort, must never block startup
        print(f"[supervisor-proxy] stale-option cleanup skipped: {err}", flush=True)


def _rooms_rel(model_rel: str) -> str:
    """The room-data sidecar path (<model>.glb → <model>.rooms.json) that sits
    next to the GLB. The kiosk reads this tiny file instead of the full .sh3d."""
    if model_rel.lower().endswith(".glb"):
        return model_rel[:-4] + ".rooms.json"
    return model_rel + ".rooms.json"


def _upload_meta(rel: str) -> dict | None:
    """The ORIGINAL browser-side filename + time recorded for the file at ``rel``
    by the upload handler, or None if placed manually / never uploaded here."""
    if not rel:
        return None
    try:
        with open(os.path.join(DATA_ROOT, rel) + ".upload.json", encoding="utf-8") as f:
            meta = json.load(f)
        if isinstance(meta, dict):
            return {
                "original_name": str(meta.get("original_name", "")),
                "uploaded_at": str(meta.get("uploaded_at", "")),
            }
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    return None


def _effective_paths() -> dict:
    """The model path the frontend should use, plus upload provenance.

    There's now a single managed location (MANAGED_PATH) inside the add-on's
    /data volume — the model is uploaded through the kiosk's own Settings UI,
    never placed manually. Report it once the file exists; otherwise "" so the
    frontend shows its inline uploader.

    model_upload / rooms_upload carry the ORIGINAL browser-side filename + time
    recorded by the upload handler. A central upload overwrites the managed file
    in place, so the served name never changes (always villa.glb) no matter what
    file was picked — which read as "the info panel is wrong" until the panel
    could show what was actually uploaded. The room-data sidecar (.rooms.json)
    is derived from the GLB path, not separately configurable.
    """
    model_rel = MANAGED_PATH["glb"] if os.path.exists(
        os.path.join(DATA_ROOT, MANAGED_PATH["glb"])) else ""
    return {
        "model_path": model_rel,
        "model_upload": _upload_meta(model_rel) if model_rel else None,
        "rooms_upload": _upload_meta(_rooms_rel(model_rel)) if model_rel else None,
    }


def _resolve_upload_target(kind: str) -> str:
    """Absolute, traversal-checked destination path for an upload of this kind.

    The GLB writes to the single managed location; the room-data sidecar is
    derived from it (<model>.rooms.json), so both files always sit together.
    Raises ValueError if the resolved path escapes the data root.
    """
    rel = MANAGED_PATH["glb"] if kind == "glb" else _rooms_rel(MANAGED_PATH["glb"])
    root = os.path.realpath(DATA_ROOT)
    dest = os.path.realpath(os.path.join(root, rel))
    if dest != root and not dest.startswith(root + os.sep):
        raise ValueError("resolved path escapes the data root")
    return dest


async def addon_config_handler(request: web.Request) -> web.Response:
    """Expose the non-sensitive model paths to the frontend (session-gated,
    unless public_model_access is on — see _model_authorized()).

    The full /data/options.json is never forwarded — only the model-path fields
    are returned, so options with credentials (the profile PINs) stay
    server-side.
    """
    if not _model_authorized(request):
        return _unauthorized()
    # Same reasoning as the shared-store GETs above: this changes the moment
    # an owner uploads a new model, every client is expected to notice within
    # one refresh, and the standalone/direct-hostname path is exactly where a
    # user's own reverse proxy/tunnel/CDN could otherwise cache a stale
    # model_path indefinitely.
    return web.json_response(_effective_paths(), headers={"Cache-Control": "no-store"})


async def auth_check_handler(request: web.Request) -> web.Response:
    """nginx auth_request backend for the static /model/ route: 200 when the
    caller is authorized (valid session cookie, trusted Ingress, or
    public_model_access is on — see _model_authorized()), else 401. Body is
    intentionally empty — nginx only reads the status."""
    return web.Response(status=200 if _model_authorized(request) else 401)


# ── Profile passcode verification ────────────────────────────────────────────
# The kiosk's role-based access control gates each profile behind a 4-digit
# PIN configured in the add-on options. Verification lives HERE so the PINs
# never reach the browser (the /addon-config route deliberately omits them).

AUTH_ROLES = ("guest", "owner", "ops")
PIN_OPTION = {"guest": "guest_pin", "owner": "owner_pin", "ops": "ops_pin"}
PIN_RE = re.compile(r"^[0-9]{4}$")

# ── Superadmin elevation ─────────────────────────────────────────────────
# NOT a fourth profile: it never appears in the profile picker, mints no
# session, and cannot be "logged in as". It is a one-shot elevation used to
# authorise a single DESTRUCTIVE write that the caller's normal role is not
# allowed to make — today, permanently deleting a Facility Manager record.
#
# It is ADDITIVE, never a bypass: the store's own writer_roles check still
# applies, so deleting FM records requires (owner or ops) AND a valid
# elevation. Knowing the code does not turn a guest into an administrator.
#
# Six digits rather than four: this authorises irreversible destruction of the
# maintenance record, so it should not share the guessing surface of the
# everyday profile PINs (and the same two-tier rate limiter still applies).
SUPERADMIN = "superadmin"
SUPERADMIN_PIN_OPTION = "superadmin_pin"
SUPERADMIN_PIN_RE = re.compile(r"^[0-9]{6}$")
# Short window purely to cover the round-trip between "PIN accepted" and "the
# write arrives". A token is consumed by the FIRST write that uses it, so this
# is a ceiling on an unused one, not a period of standing privilege.
ELEVATION_TTL_SECONDS = 120
ELEVATION_MAX_OUTSTANDING = 32
_elevation_tokens: dict = {}     # token -> expiry (time.monotonic)
# Brute-force limiter. Two tiers, because one alone is wrong in a different way.
#
# PER-CLIENT (role + source IP) is the primary gate. The limiter used to be
# keyed by ROLE ALONE, shared across every caller — which meant anyone on the
# internet could send five wrong PINs and lock the real owner out of their own
# villa for five minutes, repeatedly and indefinitely. A lockout must punish
# the guesser, not the victim.
#
# PER-ROLE (global) is kept as a much looser backstop, because per-client
# limiting alone is defeated by rotating source IPs. A 4-digit PIN is only
# 10,000 possibilities, so the global tier is what bounds a distributed guess.
#
# Both dicts are pruned (see _prune_auth_failures) so an attacker cycling
# source addresses cannot grow them without limit — the fixed-size-by-
# construction property of the old role-keyed dict had to be replaced with an
# explicit bound, not dropped.
AUTH_MAX_FAILURES = 5            # per client IP, per role
AUTH_GLOBAL_MAX_FAILURES = 50    # per role, all clients combined
AUTH_GLOBAL_LOCKOUT_SECONDS = 900
AUTH_TRACK_MAX_CLIENTS = 2048    # hard cap on tracked (role, ip) pairs
_auth_failures: dict = {}                                    # (role, ip) -> state
_auth_failures_global: dict = {r: {"count": 0, "last": 0.0}
                              for r in (*AUTH_ROLES, SUPERADMIN)}


def _option_int(key: str, default: int, lo: int, hi: int) -> int:
    """A numeric add-on option, read fresh and clamped.

    These exist so an operator can tune the add-on from the Supervisor UI
    instead of editing constants in a Python file they would lose on the next
    update. Every one of them is a POLICY choice — how long evidence is kept,
    how long a session lasts — where no single number is right for every
    property, which is the test for whether something belongs here at all.

    Read on every call rather than cached, so a change takes effect without
    restarting this process (same as _public_model_access). Clamped rather
    than trusted: the schema validates what the UI writes, but /data/options.
    json can be hand-edited, and a retention of -1 or 10**9 must not turn into
    "delete everything" or "never delete".
    """
    raw = _read_options().get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


def _session_ttl() -> int:
    """How long a signed-in profile stays signed in, in seconds."""
    return _option_int("session_days", 30, 1, 365) * 86400


def _evidence_retention_days() -> int:
    """Age at which an evidence photo is deleted. 0 disables the sweep — for
    an operator whose own retention obligation outlives any default we could
    pick. Referenced-photo garbage collection is unaffected either way: this
    is about age, not about whether anything still points at the file."""
    return _option_int("evidence_retention_days", 550, 0, 3650)


def _telemetry_max_events() -> int:
    """How many diagnostic events the ring keeps."""
    return _option_int("telemetry_max_events", 500, 50, 5000)


def _auth_lockout_seconds() -> int:
    """How long a client is locked out after too many wrong passcodes."""
    return _option_int("pin_lockout_minutes", 5, 1, 1440) * 60


def _client_ip(request: web.Request) -> str:
    """Best-effort source address for rate-limiting.

    Behind Cloudflare + nginx the socket peer is always 127.0.0.1, so the
    forwarded header is what distinguishes callers. It is client-controllable,
    which is precisely why it is used ONLY to make the limiter finer-grained
    and never to grant anything: a forged header can at worst give the forger
    their own bucket, and the global tier still bounds the total. Falls back to
    the peer address when the header is absent."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    peer = request.remote or "?"
    return str(peer)[:64]


def _prune_auth_failures(now: float) -> None:
    """Drop expired per-client entries, and hard-trim if still oversized."""
    for key in [k for k, st in _auth_failures.items()
                if now - st["last"] > _auth_lockout_seconds()]:
        _auth_failures.pop(key, None)
    if len(_auth_failures) > AUTH_TRACK_MAX_CLIENTS:
        # Oldest-first eviction. Evicting a still-locked attacker is acceptable:
        # the global tier remains, and the alternative (unbounded growth) is a
        # memory-exhaustion vector that is strictly worse.
        for key, _ in sorted(_auth_failures.items(), key=lambda kv: kv[1]["last"])[
                :len(_auth_failures) - AUTH_TRACK_MAX_CLIENTS]:
            _auth_failures.pop(key, None)


def _configured_pin(role: str) -> str:
    """The valid configured PIN for a role, or "" when unset/malformed.

    A malformed value (schema bypass via a hand-edited options.json) is
    treated as unset rather than comparable — never let a weird value widen
    what a submitted string could match.
    """
    raw = str(_read_options().get(PIN_OPTION[role], "") or "").strip()
    return raw if PIN_RE.fullmatch(raw) else ""


def _configured_superadmin_pin() -> str:
    """The configured 6-digit superadmin code, or "" when unset/malformed.

    Empty means the whole capability is OFF: no elevation can be minted, so no
    destructive delete can be authorised by anyone. That is the default."""
    raw = str(_read_options().get(SUPERADMIN_PIN_OPTION, "") or "").strip()
    return raw if SUPERADMIN_PIN_RE.fullmatch(raw) else ""


def _mint_elevation() -> str:
    """One single-use token authorising one destructive write."""
    now = time.monotonic()
    for tok in [t for t, exp in _elevation_tokens.items() if exp <= now]:
        _elevation_tokens.pop(tok, None)
    # Bound the dict: a caller who elevates repeatedly without spending the
    # tokens must not be able to grow it without limit.
    if len(_elevation_tokens) >= ELEVATION_MAX_OUTSTANDING:
        for tok, _ in sorted(_elevation_tokens.items(), key=lambda kv: kv[1])[:8]:
            _elevation_tokens.pop(tok, None)
    token = secrets.token_urlsafe(24)
    _elevation_tokens[token] = now + ELEVATION_TTL_SECONDS
    return token


def _consume_elevation(token) -> bool:
    """Spend a token. Single use by construction — it is removed here, so a
    replayed write is rejected exactly like one that never elevated."""
    if not isinstance(token, str) or not token:
        return False
    exp = _elevation_tokens.pop(token, None)
    return exp is not None and exp > time.monotonic()


def _lockout_remaining(role: str, ip: str) -> int:
    """Seconds this caller must wait, from whichever tier is stricter."""
    now = time.monotonic()
    _prune_auth_failures(now)
    worst = 0
    for st, limit, window in (
        (_auth_failures.get((role, ip)), AUTH_MAX_FAILURES, _auth_lockout_seconds()),
        (_auth_failures_global[role], AUTH_GLOBAL_MAX_FAILURES, AUTH_GLOBAL_LOCKOUT_SECONDS),
    ):
        if not st or st["count"] < limit:
            continue
        remaining = window - (now - st["last"])
        if remaining <= 0:
            st["count"] = 0
            continue
        worst = max(worst, int(remaining) + 1)
    return worst


async def auth_roles_handler(request: web.Request) -> web.Response:
    """Report which profiles require a passcode — booleans only, no secrets."""
    return web.json_response(
        {"roles": {r: {"pinRequired": bool(_configured_pin(r))} for r in AUTH_ROLES}},
    )


async def auth_elevate_handler(request: web.Request) -> web.Response:
    """Exchange the superadmin code for ONE single-use elevation token.

    Deliberately not a login: no session is minted or changed, so there is no
    such thing as "being" superadmin and nothing to forget to sign out of. The
    token authorises exactly one destructive write and is consumed by it.

    Rate-limited on the same two-tier limiter as the profile PINs (per client
    IP and globally), and requires an already-authorized session — the code is
    an extra factor on top of a normal profile, never a way in from nothing."""
    if not _authorized(request):
        return _unauthorized()
    configured = _configured_superadmin_pin()
    if not configured:
        # Capability disabled (no code set). Say so plainly: this is an
        # operator configuration state, not a wrong-code answer, and pretending
        # otherwise sends someone hunting for a code that does not exist.
        return web.json_response(
            {"error": "Superadmin actions are not enabled on this installation."},
            status=403)

    ip = _client_ip(request)
    wait = _lockout_remaining(SUPERADMIN, ip)
    if wait > 0:
        return web.json_response({"error": "too many attempts", "retryAfter": wait},
                                 status=429)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return web.json_response({"error": "invalid JSON body"}, status=400)
    submitted = str(body.get("pin", "") or "")
    ok = hmac.compare_digest(submitted, configured)
    # Same two-tier bookkeeping as auth_verify_handler: clear only THIS
    # client's counter on success and let the global tier decay on its own, so
    # one correct entry cannot reset a distributed guessing campaign.
    now = time.monotonic()
    st = _auth_failures.setdefault((SUPERADMIN, ip), {"count": 0, "last": 0.0})
    gst = _auth_failures_global[SUPERADMIN]
    if ok:
        st["count"] = 0
    else:
        st["count"] += 1
        st["last"] = now
        gst["count"] += 1
        gst["last"] = now
        return web.json_response({"error": "incorrect code"}, status=401)
    return web.json_response({"token": _mint_elevation(),
                              "expiresIn": ELEVATION_TTL_SECONDS})


# Collections in the FM document whose records are individually addressable by
# `id`. Kept here (not imported from the frontend) because the server must be
# able to tell "a record was removed" on its own — a rule that only the client
# knows is not a rule.
FM_RECORD_COLLECTIONS = ("schedules", "completions", "costs", "tickets", "savedDocuments")

# The subset whose records are EVIDENCE of something that happened: a fault
# that was raised, money that was spent, work that was signed off. Those are
# what an audit rests on, so destroying one needs the superadmin code.
#
# The other two are deliberately NOT protected. A schedule is a plan, not a
# record — deleting it changes what is due next week and destroys no history
# (the completions it produced survive). A saved document is a snapshot that
# can be regenerated from the records it was built from. Both already have
# plain delete buttons that owner/ops use as routine housekeeping; putting a
# code in front of those would be friction bought with nothing.
FM_PROTECTED_COLLECTIONS = ("completions", "costs", "tickets")

# Roles that may edit the maintenance record itself. A guest is a writer of
# the store (see _fm_guest_write_ok) but not one of these.
FM_FULL_WRITER_ROLES = ("owner", "ops")

# A guest may append at most this many reports in one write. One is the normal
# case; the cap only exists so a scripted session cannot bulk-fill the store.
FM_GUEST_MAX_NEW_TICKETS = 3


def _fm_ids(doc) -> dict:
    """{collection: {id, ...}} for whatever this document actually contains."""
    out = {}
    for name in FM_RECORD_COLLECTIONS:
        items = doc.get(name) if isinstance(doc, dict) else None
        out[name] = {
            str(it.get("id")) for it in items
            if isinstance(it, dict) and it.get("id") is not None
        } if isinstance(items, list) else set()
    return out


def _fm_guest_write_ok(old, new) -> bool:
    """True when this write is one a GUEST is allowed to make.

    A guest living in the villa is the person most likely to NOTICE something
    broken, and until now had no way to say so — the Facility workspace is
    owner/ops only, so a broken air-conditioner reached the record only if the
    guest happened to tell someone. Letting them raise a fault closes that,
    but a guest must not be able to edit the maintenance record itself.

    So the rule is not a role, it is the SHAPE of the change: every collection
    except `tickets` must be byte-identical, and `tickets` may only gain
    entries — no removal, no edit of one that already exists. A guest can add
    a report and nothing else, including to their own report once it is filed.
    Triage, status, cost and resolution stay with owner/ops.
    """
    if not isinstance(old, dict) or not isinstance(new, dict):
        return False
    for name in FM_RECORD_COLLECTIONS:
        if name == "tickets":
            continue
        if old.get(name, []) != new.get(name, []):
            return False
    # Any key this server version doesn't know about must also be untouched —
    # a newer client's field is not a licence to rewrite it from a guest
    # session.
    known = set(FM_RECORD_COLLECTIONS)
    for key in set(old) | set(new):
        if key not in known and old.get(key) != new.get(key):
            return False

    old_tickets = old.get("tickets") or []
    new_tickets = new.get("tickets") or []
    if not isinstance(new_tickets, list) or len(new_tickets) < len(old_tickets):
        return False
    # Existing tickets must survive UNCHANGED and in place; only appended
    # entries are new. Comparing element-wise rather than by id also rejects
    # a reordering that hides an edit.
    if new_tickets[:len(old_tickets)] != old_tickets:
        return False
    added = new_tickets[len(old_tickets):]
    if not added or len(added) > FM_GUEST_MAX_NEW_TICKETS:
        return False
    for t in added:
        if not isinstance(t, dict):
            return False
        # A guest files an OPEN report and cannot pre-resolve it, backdate it,
        # or attach a cost to the villa's accounts.
        if t.get("status") != "open":
            return False
        if t.get("resolvedAt") is not None or t.get("costId") is not None:
            return False
        if t.get("reportedBy") != "guest":
            return False
    return True


def _fm_write_guard(request: web.Request, body, old, new):
    """Erasing an evidence record needs a superadmin elevation.

    Adding and amending stays open to owner/ops — that is their job. REMOVING
    one of FM_PROTECTED_COLLECTIONS is different in kind: the record is the
    evidence that a fault existed, money was spent or work was done, and losing
    it cannot be undone from the app.

    Enforced here rather than in the UI because the store takes whole
    documents: a client that simply omits a record IS a delete, so gating only
    the button would leave the capability wide open to anyone holding a normal
    session and a JSON editor.
    """
    # Guests get a deliberately narrow write: appending a fault report, and
    # nothing else. Checked FIRST because it is the tighter rule — a guest
    # write that isn't a plain report is refused whatever else it contains.
    if _role_for(request) not in FM_FULL_WRITER_ROLES:
        if not _fm_guest_write_ok(old, new):
            return _forbidden("A guest may only add a fault report.")
        return None

    new_ids = _fm_ids(new)
    removed = {
        name: _fm_ids(old)[name] - new_ids[name]
        for name in FM_PROTECTED_COLLECTIONS
    }
    if not any(removed.values()):
        return None                      # nothing destroyed — ordinary write
    if not _configured_superadmin_pin():
        return _forbidden("Deleting records requires the superadmin code, "
                          "which is not configured on this installation.")
    token = body.get("elevation") if isinstance(body, dict) else None
    if not _consume_elevation(token):
        return _forbidden("Deleting a record requires a fresh superadmin "
                          "authorisation for that specific action.")
    return None


def _fm_referenced_photo_ids(doc) -> set:
    """Every evidence photo id the document still points at, anywhere."""
    ids = set()
    if not isinstance(doc, dict):
        return ids
    for name in FM_RECORD_COLLECTIONS:
        items = doc.get(name)
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            for field in ("photoIds",):
                photos = it.get(field)
                if isinstance(photos, list):
                    ids.update(str(p) for p in photos)
            # A fault's per-stage updates carry their own photos (see
            # FmTicketUpdate) — missing these would delete a live photo.
            updates = it.get("updates")
            if isinstance(updates, list):
                for u in updates:
                    if isinstance(u, dict) and isinstance(u.get("photoIds"), list):
                        ids.update(str(p) for p in u["photoIds"])
    return ids


def _delete_evidence(photo_id: str) -> bool:
    """Remove one evidence JPEG, with the id and the resolved path both
    checked — this deletes a file from a path built out of stored data."""
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id):
        return False
    path = os.path.join(FM_EVIDENCE_DIR, f"{photo_id}.jpg")
    if os.path.realpath(os.path.dirname(path)) != os.path.realpath(FM_EVIDENCE_DIR):
        return False
    try:
        os.unlink(path)
        return True
    except OSError:
        return False


def _fm_after_write(old, new) -> None:
    """Collect evidence photos the maintenance record no longer points at.

    Runs on EVERY write, not only on a delete. The earlier version only fired
    when a whole record was erased, which left two ways for JPEGs to pile up
    in /data forever:

      * editing a record to remove one photo (the x on a thumbnail) dropped
        the reference and kept the file;
      * a photo uploaded into a form that was then cancelled was never
        referenced by anything at all.

    Both are now handled by the same rule — a file nobody references is
    garbage — with a grace period so a photo attached to a form that is still
    open on someone's phone is never swept out from under them. The retention
    sweep is separate and answers a different question (old evidence, still
    referenced), so both run here.
    """
    referenced = _fm_referenced_photo_ids(new)

    # 1. Anything this write dropped a reference to goes immediately: it was
    #    referenced a moment ago, so there is no in-flight form to protect.
    for photo_id in _fm_referenced_photo_ids(old) - referenced:
        _delete_evidence(photo_id)

    # 2. Anything on disk that nothing has EVER referenced and is older than
    #    the grace window — the cancelled-form case.
    cutoff = time.time() - FM_EVIDENCE_ORPHAN_GRACE_SECONDS
    try:
        names = os.listdir(FM_EVIDENCE_DIR)
    except OSError:
        names = []
    for name in names:
        if not name.endswith(".jpg"):
            continue
        photo_id = name[:-4]
        if photo_id in referenced:
            continue
        path = os.path.join(FM_EVIDENCE_DIR, name)
        try:
            if os.path.getmtime(path) >= cutoff:
                continue      # still inside the grace window
        except OSError:
            continue
        _delete_evidence(photo_id)

    # 3. Retention: referenced or not, evidence past the window goes. Kept on
    #    this path as well as the upload path so a villa that stops uploading
    #    still ages out its old evidence.
    _prune_fm_evidence()


async def auth_verify_handler(request: web.Request) -> web.Response:
    """Establish a session for a profile.

    Constant-time, rate-limited check of a submitted passcode for PIN-gated
    profiles; for an un-PIN'd profile (no passcode configured) `pin` may be
    omitted and the session is granted directly. On success a signed session
    cookie is set — that cookie, not the client-side profile UI, is what
    actually authorizes /core, /model and uploads on the directly-exposed port.
    """
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return web.json_response({"error": "invalid JSON body"}, status=400)
    role = body.get("role")
    pin = body.get("pin")
    # Whitelist validation: role must be one of the three known profiles.
    if role not in AUTH_ROLES:
        return web.json_response({"error": "unknown role"}, status=400)

    configured = _configured_pin(role)
    if not configured:
        if role != "guest":
            # owner/ops are privileged roles — an unset PIN must mean "this
            # profile isn't available on this path", never "open to anyone
            # who asks". Only "guest" may be intentionally left PIN-less (a
            # villa that wants a no-PIN "just look around" mode); config.yaml
            # ships all three PINs empty by default, and before this check an
            # unconfigured owner/ops PIN silently minted a full-access session
            # for ANY caller who reached this endpoint — see the module
            # docstring's Access control section.
            return web.json_response(
                {"error": f"the {role} profile has no PIN configured"}, status=403,
            )
        # Un-PIN'd guest profile: grant a session without touching the rate
        # limiter or requiring a pin. (A pin sent anyway is simply ignored.)
        resp = web.json_response({"ok": True})
        _set_session_cookie(resp, role)
        return resp

    # PIN-gated profile: the pin must be exactly four digits — anything else is
    # rejected before any comparison or counter is touched.
    if not isinstance(pin, str) or not PIN_RE.fullmatch(pin):
        return web.json_response({"error": "pin must be 4 digits"}, status=400)

    ip = _client_ip(request)
    retry_after = _lockout_remaining(role, ip)
    if retry_after > 0:
        return web.json_response(
            {"ok": False, "locked": True, "retryAfter": retry_after}, status=429,
        )

    ok = hmac.compare_digest(pin, configured)
    now = time.monotonic()
    st = _auth_failures.setdefault((role, ip), {"count": 0, "last": 0.0})
    gst = _auth_failures_global[role]
    if ok:
        # Clear only THIS client's counter. The global tier is left to decay on
        # its own window, so one correct PIN cannot reset a distributed guess.
        st["count"] = 0
    else:
        st["count"] += 1
        st["last"] = now
        gst["count"] += 1
        gst["last"] = now
    resp = web.json_response({"ok": ok})
    if ok:
        _set_session_cookie(resp, role)
    return resp


async def auth_logout_handler(request: web.Request) -> web.Response:
    """End THIS browser's session by clearing its cookie.

    The token stays cryptographically valid until it expires — that is inherent
    to stateless sessions — so this is the ordinary "I'm done on this device"
    path, not a revocation. For a token believed to be COMPROMISED, use
    /auth/logout-all, which invalidates every session everywhere."""
    resp = web.json_response({"ok": True})
    resp.del_cookie(SESSION_COOKIE, path="/")
    return resp


async def auth_logout_all_handler(request: web.Request) -> web.Response:
    """Invalidate every outstanding session on this install (owner-only).

    Bumps the session epoch, which is mixed into every signature, so all
    previously issued cookies stop verifying — including the caller's own.
    This is the answer to "a device was lost / a PIN was seen"."""
    if not _authorized(request) or _role_for(request) != "owner":
        return _unauthorized() if not _authorized(request) else web.json_response(
            {"error": "forbidden"}, status=403)
    epoch = _bump_session_epoch()
    resp = web.json_response({"ok": True, "epoch": epoch})
    resp.del_cookie(SESSION_COOKIE, path="/")
    return resp


async def _stream_upload_body(request: web.Request, out, kind: str,
                              check_magic: bool, base: int) -> int:
    """Stream the request body into `out`, returning the bytes written.

    check_magic — validate the stream head against UPLOAD_MAGIC[kind] (the
    check accumulates across 64 KiB reads, since a read can in principle be
    shorter than the longest signature).
    base — bytes already accumulated for this upload (non-zero in chunked
    mode) so the MAX_UPLOAD_BYTES cap applies to the WHOLE file, not to each
    individual chunk.
    """
    total = 0
    head = b""
    head_checked = not check_magic
    async for chunk in request.content.iter_chunked(64 * 1024):
        if not head_checked:
            head += chunk[: 8 - len(head)]
            if len(head) >= 4:
                if not head.startswith(UPLOAD_MAGIC[kind]):
                    raise web.HTTPBadRequest(
                        text=f"upload does not look like a {kind} file",
                    )
                head_checked = True
        total += len(chunk)
        if base + total > MAX_UPLOAD_BYTES:
            raise web.HTTPRequestEntityTooLarge(
                max_size=MAX_UPLOAD_BYTES, actual_size=base + total,
            )
        out.write(chunk)
    if check_magic and not head_checked and total > 0:
        # Body shorter than any valid signature — cannot be a real file.
        raise web.HTTPBadRequest(text=f"upload does not look like a {kind} file")
    return total


def _write_upload_sidecar(request: web.Request, dest: str) -> None:
    """Record what was ACTUALLY uploaded. The overwrite keeps the configured
    filename forever, so without this sidecar the info panel can only show
    the server-side name — which users read as "wrong file loaded" after
    uploading e.g. villa_1F_2048.glb over TheLysHouse_1F.glb. Best-effort:
    a failed sidecar write must never fail the (already completed) upload."""
    original_name = os.path.basename(request.query.get("name", "").strip())[:120]
    if not original_name:
        return
    try:
        with open(dest + ".upload.json", "w", encoding="utf-8") as f:
            json.dump({
                "original_name": original_name,
                "uploaded_at": datetime.now(timezone.utc)
                               .isoformat(timespec="seconds"),
            }, f)
        os.chmod(dest + ".upload.json", 0o644)
    except OSError:
        pass


# Chunked uploads: HA's Ingress gateway rejects any single request over about
# 16 MB (413) — a Supervisor-level cap this add-on cannot raise. A baked villa
# GLB easily exceeds that, so the frontend slices big files into ~8 MB pieces
# and POSTs them sequentially with upload_id/offset/last query params; pieces
# accumulate in a client-named .part file next to the destination and the last
# piece atomically replaces the live model, exactly like a single-shot upload.
CHUNK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
STALE_PART_SECONDS = 24 * 3600


def _sweep_stale_parts(dirname: str) -> None:
    """Delete abandoned chunked-upload .part files older than a day."""
    try:
        cutoff = time.time() - STALE_PART_SECONDS
        for fn in os.listdir(dirname):
            if ".upload-" not in fn or not fn.endswith(".part"):
                continue
            p = os.path.join(dirname, fn)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.unlink(p)
            except OSError:
                pass
    except OSError:
        pass


async def _chunked_upload(request: web.Request, kind: str, dest: str,
                          upload_id: str) -> web.Response:
    """One piece of a chunked upload (see the CHUNK_ID_RE comment above)."""
    if not CHUNK_ID_RE.fullmatch(upload_id):
        return web.json_response({"error": "bad upload_id"}, status=400)
    try:
        offset = int(request.query.get("offset", ""))
    except ValueError:
        return web.json_response(
            {"error": "chunked upload needs an integer offset"}, status=400)
    if offset < 0:
        return web.json_response({"error": "negative offset"}, status=400)
    last = request.query.get("last") == "1"
    part = f"{dest}.upload-{upload_id}.part"

    if offset == 0:
        _sweep_stale_parts(os.path.dirname(dest))
    else:
        # The offset doubles as a sequence check: a dropped or duplicated
        # piece shows up as a size mismatch and the client restarts cleanly
        # instead of assembling a corrupt file.
        try:
            have = os.path.getsize(part)
        except OSError:
            return web.json_response(
                {"error": "unknown upload_id — restart the upload"}, status=409)
        if have != offset:
            return web.json_response(
                {"error": f"offset mismatch (server has {have}, client sent "
                          f"{offset}) — restart the upload"}, status=409)

    try:
        with open(part, "wb" if offset == 0 else "ab") as out:
            n = await _stream_upload_body(
                request, out, kind, check_magic=(offset == 0), base=offset)
        if n == 0:
            raise web.HTTPBadRequest(text="empty chunk")
        if not last:
            return web.json_response({"ok": True, "received": offset + n})
        # See the single-shot handler for why 0644 before the atomic replace.
        os.chmod(part, 0o644)
        os.replace(part, dest)
    except BaseException:
        try:
            os.unlink(part)
        except OSError:
            pass
        raise

    _write_upload_sidecar(request, dest)
    rel = os.path.relpath(dest, os.path.realpath(DATA_ROOT))
    return web.json_response({"path": rel, "size": offset + n})


async def model_upload_handler(request: web.Request) -> web.Response:
    """Stream an uploaded GLB or .rooms.json to its central file (atomic overwrite).

    The body is written to a temp file in the destination directory, then
    os.replace()'d over the existing file — so a partial/failed upload never
    corrupts the live model, and a success cleanly erases the previous file.
    With upload_id/offset/last query params the body is one piece of a chunked
    upload instead (files above HA Ingress's ~16 MB per-request cap).
    """
    if not _authorized(request):
        return _unauthorized()
    if _role_for(request) != "owner":
        # manageModel is an owner-only capability in permissions.ts — a
        # guest/ops session could otherwise overwrite the villa model every
        # kiosk loads. (Ingress requests resolve to "owner" — see _role_for.)
        return _forbidden("Only the owner profile may upload a model.")
    kind = request.query.get("kind", "")
    if kind not in ("glb", "rooms"):
        return web.json_response({"error": "kind must be 'glb' or 'rooms'"}, status=400)

    try:
        dest = _resolve_upload_target(kind)
    except ValueError as err:
        # Detail to the log, generic message to the caller. The current text is
        # our own fixed string and leaks nothing, but returning exception text
        # verbatim is the habit that eventually leaks a filesystem path.
        print(f"[supervisor-proxy] upload target rejected: {err}", flush=True)
        return web.json_response({"error": "invalid upload target"}, status=400)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    upload_id = request.query.get("upload_id", "").strip()
    if upload_id:
        return await _chunked_upload(request, kind, dest, upload_id)

    # Atomic temp-file-then-replace, with 0644 so nginx (running unprivileged)
    # can serve the result — see atomic_write, which owns both rules now.
    async def _stream(out):
        total = await _stream_upload_body(
            request, out, kind, check_magic=True, base=0)
        if total == 0:
            # Raised INSIDE the writer so atomic_write_async's cleanup runs and
            # the half-written temp file goes away — the live model is never
            # touched, since the replace hasn't happened yet.
            raise web.HTTPBadRequest(text="empty upload")
        return total

    total = await atomic_write_async(dest, _stream)

    _write_upload_sidecar(request, dest)
    rel = os.path.relpath(dest, os.path.realpath(DATA_ROOT))
    return web.json_response({"path": rel, "size": total})


# ── Shared JSON stores (device configuration, facility manager data) ─────────
# These live HERE, in the add-on's own persistent /data volume, rather than in
# each browser's localStorage — so what one device saves is immediately
# available on every other device that connects, exactly like the uploaded GLB
# model above. One read/write pair and one handler factory serves all of them,
# differing only in filename, JSON key, empty shape and size cap.
#
# Scenes used to be a third store here (kiosk-authored whole-villa state
# snapshots, replayed via /scenes). Removed: it duplicated Home Assistant's
# own Scene Editor / scene.* entities with a second, disconnected place to
# author them. The kiosk now reads HA's own scenes live (their entity_id
# attribute already lists every entity a scene touches) instead of storing
# anything of its own — see src/config/haScenes.ts.
# The villa's DEVICE configuration: entity<->mesh bindings, per-device metadata
# (label, room, type, category, linked/motion entity, badge colour…), room
# definitions and device groups. Bigger than scenes (one entry per entity, plus
# room polygons), hence the roomier cap — still bounded so a bad body can't
# fill /data. See the frontend's config/deviceConfig.ts for exactly which
# AppConfig fields are shared (site-wide) vs kept per-device (look/feel).
DEVICE_CONFIG_FILE = "/data/device-config.json"
DEVICE_CONFIG_MAX_BYTES = 8_000_000


def atomic_write(dest: str, write_body, binary: bool = True, mode: int = 0o644) -> None:
    """Write `dest` atomically: a fresh temp file in the SAME directory, then
    os.replace() over the target. A reader (or nginx) therefore sees either the
    whole previous file or the whole new one, never a half-written one, and a
    failure part-way through leaves the existing file untouched.

    `write_body(out)` receives the open temp file handle and does the actual
    writing; it may be a plain function or a coroutine (awaited by
    atomic_write_async below), which is what lets a streamed upload and a
    small in-memory blob share this one implementation.

    THIS EXISTS BECAUSE IT WAS WRITTEN THREE TIMES. The JSON store and the
    model upload each had a correct copy; the FM evidence-photo write had a
    THIRD that looked equivalent and was not — it used a predictable
    "<dest>.part" name instead of mkstemp (so two concurrent uploads of the
    same id raced each other, and a pre-existing file or symlink at that path
    was inherited rather than refused), and it had no failure cleanup at all,
    so any exception mid-write orphaned a .part file in /data forever. Three
    copies of a security-relevant primitive is three chances to get it subtly
    wrong, and that is exactly what happened; there is now one.

    mkstemp() creates the file 0600 (root-only). nginx workers run
    unprivileged, so anything nginx must later serve (the model, evidence
    photos) needs the default 0644 before the replace — hence `mode` rather
    than leaving it at mkstemp's default.
    """
    directory = os.path.dirname(dest)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".part")
    try:
        opener = os.fdopen(fd, "wb" if binary else "w",
                           **({} if binary else {"encoding": "utf-8"}))
        with opener as out:
            write_body(out)
        os.chmod(tmp, mode)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


async def atomic_write_async(dest: str, write_body, binary: bool = True,
                             mode: int = 0o644):
    """`atomic_write` for an async producer — a streamed request body. Same
    guarantees, same cleanup; `write_body(out)` is awaited and its return value
    is passed back to the caller (the upload handlers use it for the byte
    count). Kept separate rather than making atomic_write itself async so the
    many synchronous callers don't all have to await."""
    directory = os.path.dirname(dest)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".part")
    try:
        opener = os.fdopen(fd, "wb" if binary else "w",
                           **({} if binary else {"encoding": "utf-8"}))
        with opener as out:
            result = await write_body(out)
        os.chmod(tmp, mode)
        os.replace(tmp, dest)
        return result
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json_store(path: str, empty):
    """Parse a shared store, degrading to `empty` for absent/corrupt/wrong-typed
    files — a store that can't be read must never take the kiosk down, it just
    reads as "nothing configured yet"."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return empty
    return data if isinstance(data, type(empty)) else empty


def _write_json_store(path: str, payload: str) -> None:
    """Atomic overwrite (temp file + os.replace) so a partial or failed write
    can never leave the live store truncated — readers either see the whole
    previous version or the whole new one."""
    def _write(out):
        out.write(payload)
    atomic_write(path, _write, binary=False)


def _store_revision(path: str) -> str:
    """A cheap, persistent (survives a proxy restart, unlike an in-memory
    counter) revision marker for optimistic-concurrency writes — the file's
    own mtime, which _write_json_store's atomic replace always advances.
    Absent file (nothing stored yet) reads as "0".

    Returned as a STRING, and that is not cosmetic. This was an int of
    nanoseconds (~1.8e18), which is ~198x past JavaScript's MAX_SAFE_INTEGER:
    at that magnitude doubles are 256 apart, so a browser client physically
    cannot hold the value. It parsed a rounded number, sent that back, and the
    comparison below never matched — so EVERY conditional write was rejected
    with 409, on every retry, permanently. The symptom in the field was a
    device that could read the shared config forever but never write to it,
    reporting "conflict-retries-exhausted" with an unchanging revision.
    An opaque string is immune to numeric precision by construction; nothing
    outside this function needs to know it derives from a timestamp."""
    try:
        return str(os.stat(path).st_mtime_ns)
    except OSError:
        return "0"


def _json_store_handlers(path: str, key: str, empty, max_bytes: int, what: str,
                         writer_roles: tuple = ("owner",),
                         write_guard=None, after_write=None):
    """Build the (GET, PUT) handler pair for one shared store.

    GET is open to any authorized session — a guest still has to read the
    device config to see the right badges/rooms at all. PUT is restricted to
    `writer_roles`, which defaults to owner-only (shared state is exactly what
    a non-owner profile must not rewrite for everyone else); the FM store also
    admits "ops", because maintaining it IS the facility manager's job.

    `write_guard(request, body, old, new)` may veto a write by returning a
    response (used to require a superadmin elevation before any record is
    DELETED); `after_write(old, new)` runs once the write has landed (used to
    purge evidence photos an authorised delete orphaned). Both are optional
    hooks on this one factory rather than a reason to fork it again.

    That role difference used to be the excuse for a SECOND, hand-written PUT
    handler for the FM store. Copying the handler copied its auth/validation
    but silently NOT its revision check or its lock, so the FM store — the
    maintenance and cost records — had no concurrency protection at all while
    the device-config store did. One parameter is cheaper than one duplicate.

    PUT optionally carries a `rev` (the revision the caller last read, from
    GET's own response) for optimistic concurrency: villa-kiosk is routinely
    open on several devices at once, and a blind overwrite here would let
    the last PUT to arrive silently erase whatever a different device wrote
    moments earlier. When `rev` is present and stale, the write is rejected
    (409) with the current value + revision instead of applied — the caller
    is expected to rebase its own change onto that fresher copy and retry
    (see the frontend's DeviceConfigSync). Omitting `rev` keeps the old
    unconditional-overwrite behaviour, which is what fm-data's single-writer
    store still uses. The lock makes the read-check-write atomic against a
    second PUT landing on this same store mid-request.
    """
    lock = asyncio.Lock()

    async def get_handler(request: web.Request) -> web.Response:
        if not _authorized(request):
            return _unauthorized()
        # This store changes on every edit from any device and every client
        # is expected to see the current value within one heartbeat (see
        # useStoreRefresh) — not "eventually", and never a stale copy served
        # by something outside this add-on's own control. Under Ingress
        # there is no intermediary to worry about (HA's Supervisor proxies
        # straight through); the direct/standalone hostname is exactly where
        # a user-added reverse proxy, tunnel or CDN sits in front of this
        # response, and none of those honour a cache policy this handler
        # never stated. no-store is explicit rather than assumed — confirmed
        # in the field as the cause of one client's shared config silently
        # disagreeing with every other client's.
        return web.json_response(
            {key: _read_json_store(path, empty), "rev": _store_revision(path)},
            headers={"Cache-Control": "no-store"},
        )

    async def put_handler(request: web.Request) -> web.Response:
        if not _authorized(request):
            return _unauthorized()
        if _role_for(request) not in writer_roles:
            return _forbidden(f"Only the owner profile may edit {what}."
                              if writer_roles == ("owner",)
                              else f"You do not have permission to edit {what}.")
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return web.json_response({"error": "invalid JSON"}, status=400)
        value = body.get(key) if isinstance(body, dict) else body
        if not isinstance(value, type(empty)):
            return web.json_response(
                {"error": f"{key} must be a {type(empty).__name__}"}, status=400)
        # Only a STRING rev participates in the concurrency check — see
        # _store_revision. A client sending the old numeric form has already
        # lost precision, so its value could never match; treating it as
        # absent lets those (currently unable to write at all) through
        # unconditionally rather than failing them forever.
        raw_rev = body.get("rev") if isinstance(body, dict) else None
        expected_rev = raw_rev if isinstance(raw_rev, str) else None
        payload = json.dumps(value)
        if len(payload.encode("utf-8")) > max_bytes:
            return web.json_response({"error": f"{key} payload too large"}, status=413)
        async with lock:
            stored = _read_json_store(path, empty)
            if expected_rev is not None:
                current_rev = _store_revision(path)
                if expected_rev != current_rev:
                    # The fresher copy a caller rebases its retry onto — an
                    # intermediary caching THIS would be actively harmful,
                    # not just stale, so it gets the same explicit no-store
                    # as the GET above rather than relying on 409 responses
                    # not normally being cacheable.
                    return web.json_response(
                        {"error": "conflict", key: stored, "rev": current_rev},
                        status=409, headers={"Cache-Control": "no-store"})
            if write_guard is not None:
                veto = write_guard(request, body, stored, value)
                if veto is not None:
                    return veto
            _write_json_store(path, payload)
            new_rev = _store_revision(path)
            if after_write is not None:
                after_write(stored, value)
        return web.json_response({"ok": True, "count": len(value), "rev": new_rev})

    return get_handler, put_handler


# ── Telemetry ────────────────────────────────────────────────────────────────
# A bounded, append-only ring of events reported BY the clients (load timings,
# JS errors, WebGL context loss, iOS background/restore). Exists because the
# failures that matter here only ever reproduce on someone else's device — an
# iPhone in another country going white after an app switch is not something
# any amount of local testing finds. Kept deliberately small and dumb: newest
# N events in one JSON file, no rotation logic, no index, no PII beyond the
# user-agent the browser already sends on every request.
TELEMETRY_FILE = "/data/telemetry.json"
TELEMETRY_MAX_BODY = 64_000


async def telemetry_post_handler(request: web.Request) -> web.Response:
    """Append one client event. Open to ANY authorized session (a guest's
    iPhone failing is exactly the case worth capturing), unlike the owner-only
    config stores. Silently bounded so a looping client can't fill /data."""
    if not _authorized(request):
        return _unauthorized()
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "event must be an object"}, status=400)
    if len(json.dumps(body).encode("utf-8")) > TELEMETRY_MAX_BODY:
        return web.json_response({"error": "event too large"}, status=413)

    # Server-stamped fields win over anything the client sent, so a bad/spoofed
    # client can't forge them.
    body["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    body["ua"] = request.headers.get("User-Agent", "")[:300]
    body["role"] = _role_for(request)

    events = _read_json_store(TELEMETRY_FILE, [])
    events.append(body)
    del events[:-_telemetry_max_events()]       # keep only the newest N
    _write_json_store(TELEMETRY_FILE, json.dumps(events))
    return web.json_response({"ok": True, "stored": len(events)})


async def telemetry_get_handler(request: web.Request) -> web.Response:
    """Read the ring back (owner only — it carries other people's user-agents
    and error text). `?clear=1` empties it after reading."""
    if not _authorized(request):
        return _unauthorized()
    if _role_for(request) != "owner":
        return _forbidden("Only the owner profile may read telemetry.")
    events = _read_json_store(TELEMETRY_FILE, [])
    if request.query.get("clear") == "1":
        _write_json_store(TELEMETRY_FILE, json.dumps([]))
    return web.json_response(
        {"events": events, "count": len(events)}, headers={"Cache-Control": "no-store"})


# ── Facility Manager data + photo evidence ───────────────────────────────────
# One store holds the whole FM working set (maintenance schedules, completions,
# cost entries, fault tickets). It is a single JSON document rather than four
# because every write comes from one operator on one device at a time, and an
# atomic whole-document replace is far easier to reason about than four stores
# that can disagree with each other mid-edit.
FM_DATA_FILE = "/data/fm-data.json"
FM_DATA_MAX_BYTES = 4_000_000

# Evidence photos back the compliance record — a maintenance completion or a
# resolved fault is much weaker without one. Stored as plain files beside the
# data rather than base64 inside it, so the JSON stays small and a photo can be
# served with normal HTTP caching.
#
# Deliberately NOT chunked (unlike the GLB upload): the client downscales to
# ~1600px JPEG before sending, which lands around 200 KB — comfortably inside
# the Supervisor ingress body cap, so the chunking machinery would be pure
# complexity for no benefit.
FM_EVIDENCE_DIR = "/data/fm-evidence"
FM_EVIDENCE_MAX_BYTES = 3_000_000     # generous headroom over a downscaled JPEG
# Evidence age limit — the DEFAULT is ~18 months (a 12-month agreement plus the
# yield-up/dispute window after it). See _evidence_retention_days().
FM_EVIDENCE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
# How long an unreferenced photo is kept before it is treated as garbage. It
# exists solely to cover the gap between "uploaded" and "saved": the client
# uploads a photo the moment it is picked, and the record referencing it is
# not written until the operator presses Save. A form left open over lunch
# must not have its attachments deleted underneath it.
FM_EVIDENCE_ORPHAN_GRACE_SECONDS = 12 * 3600
_JPEG_MAGIC = b"\xff\xd8\xff"


def _prune_fm_evidence() -> int:
    """Delete evidence older than the retention window. Called opportunistically
    on upload — there is no scheduler in this process, and piggybacking on the
    write path means storage can only grow while it is actively being used."""
    days = _evidence_retention_days()
    if days <= 0:
        return 0                      # retention sweep switched off
    cutoff = time.time() - days * 86400
    removed = 0
    try:
        for name in os.listdir(FM_EVIDENCE_DIR):
            path = os.path.join(FM_EVIDENCE_DIR, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.unlink(path)
                    removed += 1
            except OSError:
                pass
    except OSError:
        pass
    return removed


async def fm_evidence_post_handler(request: web.Request) -> web.Response:
    """Store one evidence photo. Owner or facility manager only — this is an
    operator action, never a guest one."""
    if not _authorized(request):
        return _unauthorized()
    # Guests too: a photo of the cracked panel is the most useful thing a
    # guest can contribute, and is worthless if they cannot attach it. What a
    # guest may then DO with it stays narrow — see _fm_guest_write_ok.
    if _role_for(request) not in ("owner", "ops", "guest"):
        return _forbidden("You do not have permission to add evidence.")
    photo_id = request.query.get("id", "")
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id):
        return web.json_response({"error": "bad photo id"}, status=400)

    os.makedirs(FM_EVIDENCE_DIR, exist_ok=True)
    dest = os.path.join(FM_EVIDENCE_DIR, f"{photo_id}.jpg")
    if os.path.realpath(os.path.dirname(dest)) != os.path.realpath(FM_EVIDENCE_DIR):
        return web.json_response({"error": "bad path"}, status=400)

    body = bytearray()
    async for chunk in request.content.iter_chunked(64 * 1024):
        body.extend(chunk)
        if len(body) > FM_EVIDENCE_MAX_BYTES:
            return web.json_response({"error": "photo too large"}, status=413)
    # Same defence as the GLB upload: validate the stream head so this endpoint
    # can't be used to publish an arbitrary file type into /data.
    if not bytes(body).startswith(_JPEG_MAGIC):
        return web.json_response({"error": "not a JPEG"}, status=400)

    # Was a hand-rolled temp-then-replace using a PREDICTABLE "<dest>.part"
    # path and no failure cleanup: two concurrent posts of the same id raced
    # each other through the same temp file, an existing file/symlink at that
    # path was inherited rather than refused, and any exception mid-write
    # orphaned the .part in /data permanently. atomic_write has none of those
    # (fresh mkstemp name, cleanup on every failure path) and is the same
    # primitive the model upload and the JSON stores use.
    atomic_write(dest, lambda out: out.write(body))
    pruned = _prune_fm_evidence()
    return web.json_response({"ok": True, "id": photo_id, "bytes": len(body), "pruned": pruned})


async def fm_evidence_get_handler(request: web.Request) -> web.StreamResponse:
    """Serve one evidence photo back — owner/ops only.

    These are maintenance photographs of the villa's interior, and they were
    readable by ANY authorized session. That included "guest", which on a villa
    configured for a no-PIN look-around mode means anybody who can reach the
    add-on. Confidentiality rested entirely on the photo id being unguessable,
    which is an accident of the id format rather than an access-control
    decision. The stated reason for the open rule — "so a report can show the
    pictures behind each claim" — is unaffected: reports are opened by owner
    and facility-manager profiles, both of which still pass."""
    if not _authorized(request):
        return _unauthorized()
    if _role_for(request) not in ("owner", "ops"):
        return web.json_response({"error": "forbidden"}, status=403)
    photo_id = request.match_info.get("id", "")
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id):
        return web.json_response({"error": "bad photo id"}, status=400)
    path = os.path.join(FM_EVIDENCE_DIR, f"{photo_id}.jpg")
    if not os.path.isfile(path):
        return web.json_response({"error": "not found"}, status=404)
    return web.FileResponse(path, headers={
        # Content-addressed by a random id that is never reused, so this can be
        # cached hard — an evidence photo never changes once written.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Type": "image/jpeg",
    })


device_config_get_handler, device_config_put_handler = _json_store_handlers(
    DEVICE_CONFIG_FILE, "config", {}, DEVICE_CONFIG_MAX_BYTES, "device configuration")
# Facility Manager working set — same factory as the device config, so it gets
# the same revision check, the same write lock and the same validation. The
# only difference is who may write it.
fm_data_get_handler, fm_data_put_handler = _json_store_handlers(
    FM_DATA_FILE, "data", {}, FM_DATA_MAX_BYTES, "facility manager data",
    # "guest" is admitted at the ROLE gate but constrained by the write guard
    # to appending a fault report (see _fm_guest_write_ok) — the role check
    # alone would be far too broad. Everything else about the maintenance
    # record stays owner/ops.
    writer_roles=("owner", "ops", "guest"),
    write_guard=_fm_write_guard, after_write=_fm_after_write)


def main() -> None:
    app = web.Application()

    async def on_start(a: web.Application) -> None:
        a["session"] = ClientSession(timeout=ClientTimeout(total=None))
        os.makedirs(DATA_ROOT, exist_ok=True)
        _session_secret()  # create the signing key on first boot
        await _cleanup_stale_options(a["session"])

    async def on_cleanup(a: web.Application) -> None:
        await a["session"].close()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/addon-config", addon_config_handler)
    app.router.add_post("/model-upload", model_upload_handler)
    app.router.add_get("/device-config", device_config_get_handler)
    app.router.add_get("/fm-data", fm_data_get_handler)
    app.router.add_put("/fm-data", fm_data_put_handler)
    app.router.add_post("/fm-evidence", fm_evidence_post_handler)
    app.router.add_get("/fm-evidence/{id}", fm_evidence_get_handler)
    app.router.add_post("/telemetry", telemetry_post_handler)
    app.router.add_get("/telemetry", telemetry_get_handler)
    app.router.add_put("/device-config", device_config_put_handler)
    app.router.add_get("/auth/roles", auth_roles_handler)
    app.router.add_post("/auth/verify", auth_verify_handler)
    app.router.add_post("/auth/elevate", auth_elevate_handler)
    app.router.add_post("/auth/logout", auth_logout_handler)
    app.router.add_post("/auth/logout-all", auth_logout_all_handler)
    app.router.add_get("/auth/check", auth_check_handler)
    app.router.add_get("/core/websocket", ws_handler)
    app.router.add_route("*", "/core/api/{path:.*}", rest_handler)
    # aiohttp's own shutdown_timeout defaults to 60s: on SIGTERM it waits that
    # long for in-flight connections to finish naturally before exiting. The
    # kiosk keeps a long-lived proxied websocket open continuously (see
    # ws_handler) that will never close on its own during a stop, and neither
    # Supervisor's outer stop timeout nor s6-overlay's own per-service grace
    # period before it escalates to SIGKILL are anywhere near 60s — so
    # something up that chain was sending SIGKILL (exit 137, seen in the
    # field) long before aiohttp's own graceful window ever elapsed.
    # `init: false` in config.yaml means s6-overlay owns PID 1 and forwards
    # SIGTERM straight to this process (the run script already `exec`s into
    # it, so there's no shell in the way either) — the slow shutdown was
    # entirely aiohttp's own default, not a signal-delivery problem. A short
    # timeout here — comfortably under both of those outer grace periods —
    # lets aiohttp actually exit promptly: the open websocket/streaming
    # handlers get cancelled (CancelledError propagates cleanly through
    # their async for/with blocks, closing the upstream connection) instead
    # of waited-out.
    web.run_app(app, host="127.0.0.1", port=8100, print=None, shutdown_timeout=3.0)


if __name__ == "__main__":
    main()
