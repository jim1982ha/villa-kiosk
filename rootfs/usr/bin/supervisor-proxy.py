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
KNOWN_OPTION_KEYS = {"guest_pin", "owner_pin", "ops_pin"}

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
SESSION_SECRET_FILE = "/data/.session_secret"
SESSION_TTL = 30 * 24 * 3600  # 30 days — a kiosk stays "logged in" a long time.
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


def _sign_session(role: str, exp: int) -> str:
    return hmac.new(_session_secret(), f"{role}.{exp}".encode(), hashlib.sha256).hexdigest()


def _make_session_token(role: str) -> str:
    exp = int(time.time()) + SESSION_TTL
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
        max_age=SESSION_TTL, httponly=True, samesite="Lax", secure=True, path="/",
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


def _rest_call_allowed(role: str, tail: str) -> bool:
    """Whether a non-owner session's REST call may reach Core. Owner is exempt
    (mirrors _service_call_allowed)."""
    if role == "owner":
        return True
    m = _SERVICES_PATH_RE.match(tail)
    if m:
        # HA's REST API accepts POST /api/services/<domain>/<service> as an
        # exact equivalent of the websocket's call_service — same allowlist.
        return _service_call_allowed(role, m.group(1), m.group(2))
    if tail.startswith("template"):
        # Arbitrary Jinja2 template rendering — never called by the kiosk UI;
        # can read entity/attribute data across the WHOLE HA instance.
        return False
    if role == "guest" and tail.startswith("camera_proxy"):
        # permissions.ts denies the "camera" type to guest, but that's a
        # client-side render filter — mirror the intent here since a camera
        # image request needs no entity-metadata lookup to recognise.
        return False
    return True


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

    Fetch our own stored options and, if any key isn't in the current
    schema, write back only the known-good ones — using the exact same
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
        stale = sorted(set(options) - KNOWN_OPTION_KEYS)
        if not stale:
            return
        cleaned = {k: v for k, v in options.items() if k in KNOWN_OPTION_KEYS}
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
    return web.json_response(_effective_paths())


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
# Brute-force limiter: after this many consecutive failures for a role, verify
# refuses (HTTP 429) until the window has passed since the last failure. State
# is a fixed-size dict keyed by the three role names — bounded memory forever.
AUTH_MAX_FAILURES = 5
AUTH_LOCKOUT_SECONDS = 300
_auth_failures: dict = {r: {"count": 0, "last": 0.0} for r in AUTH_ROLES}


def _configured_pin(role: str) -> str:
    """The valid configured PIN for a role, or "" when unset/malformed.

    A malformed value (schema bypass via a hand-edited options.json) is
    treated as unset rather than comparable — never let a weird value widen
    what a submitted string could match.
    """
    raw = str(_read_options().get(PIN_OPTION[role], "") or "").strip()
    return raw if PIN_RE.fullmatch(raw) else ""


def _lockout_remaining(role: str) -> int:
    st = _auth_failures[role]
    if st["count"] < AUTH_MAX_FAILURES:
        return 0
    remaining = AUTH_LOCKOUT_SECONDS - (time.monotonic() - st["last"])
    if remaining <= 0:
        st["count"] = 0
        return 0
    return int(remaining) + 1


async def auth_roles_handler(request: web.Request) -> web.Response:
    """Report which profiles require a passcode — booleans only, no secrets."""
    return web.json_response(
        {"roles": {r: {"pinRequired": bool(_configured_pin(r))} for r in AUTH_ROLES}},
    )


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

    retry_after = _lockout_remaining(role)
    if retry_after > 0:
        return web.json_response(
            {"ok": False, "locked": True, "retryAfter": retry_after}, status=429,
        )

    ok = hmac.compare_digest(pin, configured)
    st = _auth_failures[role]
    if ok:
        st["count"] = 0
    else:
        st["count"] += 1
        st["last"] = time.monotonic()
    resp = web.json_response({"ok": ok})
    if ok:
        _set_session_cookie(resp, role)
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
        return web.json_response({"error": str(err)}, status=400)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    upload_id = request.query.get("upload_id", "").strip()
    if upload_id:
        return await _chunked_upload(request, kind, dest, upload_id)

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out:
            total = await _stream_upload_body(
                request, out, kind, check_magic=True, base=0)
        if total == 0:
            raise web.HTTPBadRequest(text="empty upload")
        # mkstemp() creates the temp file 0600 (root-only). nginx workers run
        # unprivileged, so a 0600 model file makes nginx return HTTP 403 when it
        # tries to serve /model/... . Relax to 0644 (world-readable, matching a
        # file copied in via Samba/SSH) before the atomic replace.
        os.chmod(tmp, 0o644)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    _write_upload_sidecar(request, dest)
    rel = os.path.relpath(dest, os.path.realpath(DATA_ROOT))
    return web.json_response({"path": rel, "size": total})


# ── Shared JSON stores (kiosk scenes, device configuration) ──────────────────
# Both of these live HERE, in the add-on's own persistent /data volume, rather
# than in each browser's localStorage — so what one device saves is immediately
# available on every other device that connects, exactly like the uploaded GLB
# model above. They differ ONLY in filename, JSON key, empty shape and size
# cap, so one read/write pair and one handler factory serves both instead of
# two near-identical copies.
SCENES_FILE = "/data/scenes.json"
SCENES_MAX_BYTES = 1_000_000  # scenes are tiny; cap so a bad body can't fill /data
# The villa's DEVICE configuration: entity<->mesh bindings, per-device metadata
# (label, room, type, category, linked/motion entity, badge colour…), room
# definitions and device groups. Bigger than scenes (one entry per entity, plus
# room polygons), hence the roomier cap — still bounded so a bad body can't
# fill /data. See the frontend's config/deviceConfig.ts for exactly which
# AppConfig fields are shared (site-wide) vs kept per-device (look/feel).
DEVICE_CONFIG_FILE = "/data/device-config.json"
DEVICE_CONFIG_MAX_BYTES = 8_000_000


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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(payload)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _json_store_handlers(path: str, key: str, empty, max_bytes: int, what: str):
    """Build the (GET, PUT) handler pair for one shared store.

    GET is open to any authorized session — a guest still has to READ scenes to
    activate them, and read the device config to see the right badges/rooms at
    all. PUT is owner-only, matching the Settings UI's own gating: shared state
    is exactly what a non-owner profile must not be able to rewrite for
    everyone else.
    """
    async def get_handler(request: web.Request) -> web.Response:
        if not _authorized(request):
            return _unauthorized()
        return web.json_response({key: _read_json_store(path, empty)})

    async def put_handler(request: web.Request) -> web.Response:
        if not _authorized(request):
            return _unauthorized()
        if _role_for(request) != "owner":
            return _forbidden(f"Only the owner profile may edit {what}.")
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return web.json_response({"error": "invalid JSON"}, status=400)
        value = body.get(key) if isinstance(body, dict) else body
        if not isinstance(value, type(empty)):
            return web.json_response(
                {"error": f"{key} must be a {type(empty).__name__}"}, status=400)
        payload = json.dumps(value)
        if len(payload.encode("utf-8")) > max_bytes:
            return web.json_response({"error": f"{key} payload too large"}, status=413)
        _write_json_store(path, payload)
        return web.json_response({"ok": True, "count": len(value)})

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
TELEMETRY_MAX_EVENTS = 500
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
    del events[:-TELEMETRY_MAX_EVENTS]          # keep only the newest N
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
    return web.json_response({"events": events, "count": len(events)})


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
FM_EVIDENCE_RETENTION_DAYS = 550      # ~18 months: covers a 12-month agreement
                                      # plus the yield-up/dispute window after it
FM_EVIDENCE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_JPEG_MAGIC = b"\xff\xd8\xff"


def _prune_fm_evidence() -> int:
    """Delete evidence older than the retention window. Called opportunistically
    on upload — there is no scheduler in this process, and piggybacking on the
    write path means storage can only grow while it is actively being used."""
    cutoff = time.time() - FM_EVIDENCE_RETENTION_DAYS * 86400
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
    if _role_for(request) not in ("owner", "ops"):
        return _forbidden("Only the owner or facility manager may add evidence.")
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

    tmp = f"{dest}.part"
    with open(tmp, "wb") as out:
        out.write(body)
    os.chmod(tmp, 0o644)
    os.replace(tmp, dest)
    pruned = _prune_fm_evidence()
    return web.json_response({"ok": True, "id": photo_id, "bytes": len(body), "pruned": pruned})


async def fm_evidence_get_handler(request: web.Request) -> web.StreamResponse:
    """Serve one evidence photo back. Readable by any authorized session so a
    report opened by the owner can show the pictures behind each claim."""
    if not _authorized(request):
        return _unauthorized()
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


scenes_get_handler, scenes_put_handler = _json_store_handlers(
    SCENES_FILE, "scenes", [], SCENES_MAX_BYTES, "scenes")
device_config_get_handler, device_config_put_handler = _json_store_handlers(
    DEVICE_CONFIG_FILE, "config", {}, DEVICE_CONFIG_MAX_BYTES, "device configuration")
# Facility Manager working set. PUT is owner-only by the shared factory's rule;
# overridden below to also admit "ops", since the facility manager is precisely
# who maintains this data.
fm_data_get_handler, _fm_data_put_owner_only = _json_store_handlers(
    FM_DATA_FILE, "data", {}, FM_DATA_MAX_BYTES, "facility manager data")


async def fm_data_put_handler(request: web.Request) -> web.Response:
    """Replace the FM working set. Unlike the other shared stores this admits
    the facility manager as well as the owner — maintaining it IS their job."""
    if not _authorized(request):
        return _unauthorized()
    if _role_for(request) not in ("owner", "ops"):
        return _forbidden("Only the owner or facility manager may edit this.")
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"error": "invalid JSON"}, status=400)
    value = body.get("data") if isinstance(body, dict) else body
    if not isinstance(value, dict):
        return web.json_response({"error": "data must be an object"}, status=400)
    payload = json.dumps(value)
    if len(payload.encode("utf-8")) > FM_DATA_MAX_BYTES:
        return web.json_response({"error": "payload too large"}, status=413)
    _write_json_store(FM_DATA_FILE, payload)
    return web.json_response({"ok": True, "count": len(value)})


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
    app.router.add_get("/scenes", scenes_get_handler)
    app.router.add_put("/scenes", scenes_put_handler)
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
