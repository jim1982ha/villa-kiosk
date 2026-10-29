#!/usr/bin/env python3
"""Token-injecting Supervisor proxy for the VESTA add-on.

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
  What a non-owner session can READ is narrowed by DOMAIN (2.496.208):
  get_states, state_changed events, the entity registry and
  REST history are filtered to ha-commands.json's `readDomains` — the
  domains the kiosk draws or scans — by _read_allowed / _relay_to_client /
  _rest_query_allowed. A person, a tracker, an alarm panel or a calendar
  never leaves this process for a guest or ops session, and camera states
  go only to a profile that may view cameras. The kiosk's finer
  category/type filtering (permissions.ts, per mapped entity) is NOT
  mirrored here: the effective category depends on the live device_class and
  the mapping the browser holds, and the guest surfaces scan whole domains
  (power sensors, the weather station), so a per-entity mirror would either
  duplicate that rule or break those surfaces. Domain is the line this
  process can hold on its own.

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
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone

from aiohttp import ClientError, ClientSession, ClientTimeout, WSMsgType, web

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
#: Each a PATH (a nested option is under its group): the agent's message retention left with its messages (2.496.445),
#: in both places it was ever stored; how long maintenance records are kept became a VESTA setting (2.496.454,
#: _evidence_retention_days) — a value stored here is not carried over: the setting starts at its default.
REMOVED_OPTIONS = {("sh3d_path",), ("model_path",),
                   ("agent_message_retention_days",), ("vesta_agent", "message_retention_days"),
                   ("evidence_retention_days",)}

# The add-on's OWN persistent volume (Supervisor gives every add-on /data and
# preserves it across restarts/updates). Central model files live here now —
# NOT in the HA config's www folder — so the add-on no longer needs write
# access to /config and nothing sensitive is exposed on HA's unauthenticated
# /local/ static route. nginx serves it at /model/<path> (session-gated); the
# upload handler below writes into it.
#: ⚠️ EVERY PATH THIS PROCESS PERSISTS IS RESOLVED AGAINST THIS, AT CALL TIME.
#: The Supervisor mounts the add-on's volume at /data; `build_app(data_dir=…)`
#: points the whole process somewhere else in one move (the tests' temp
#: directory). Paths used to be captured as "/data/…" constants when the module
#: loaded, in two binding styles, so a test had to rewrite the SOURCE TEXT to
#: keep off the real volume. Below, only NAMES inside it are declared.
DATA_DIR = "/data"


def _data(*names: str) -> str:
    """A path inside the data directory, resolved now."""
    return os.path.join(DATA_DIR, *names)


WWW_NAME = "www"
# The single managed location an uploaded model lands at. addon_config_handler
# reports it as the effective path once the file exists, so an uploaded model
# lights up for every client with no Supervisor API call or add-on restart.
MANAGED_PATH = {"glb": "villa.glb"}

# ── Session auth ─────────────────────────────────────────────────────────────
SESSION_COOKIE = "vk_session"
SESSION_EPOCH_NAME = "session-epoch"
SESSION_SECRET_NAME = ".session_secret"
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
        with open(_data(SESSION_SECRET_NAME), "rb") as f:
            existing = f.read().strip()
        if len(existing) >= 32:
            _session_secret_cache = existing
            return existing
    except OSError:
        pass
    fresh = secrets.token_hex(32).encode()
    try:
        # atomic_write, like every other write under /data: a torn secret is
        # not a corrupt file you notice, it is a file shorter than 32 bytes,
        # which the reader above silently rejects and this function then
        # REPLACES — logging every session out with no error anywhere.
        atomic_write(_data(SESSION_SECRET_NAME), lambda out: out.write(fresh), mode=0o600)
    except OSError as err:  # /data unwritable is fatal-ish, but degrade to
        # a process-lifetime secret rather than crashing (sessions then reset
        # on restart, which just means re-entering the PIN).
        print(f"[supervisor-proxy] could not persist session secret: {err}", flush=True)
    _session_secret_cache = fresh
    return fresh


def _rotate_session_secret() -> None:
    """A NEW signing key: every token ever issued stops verifying, whoever holds
    it. Sign-every-device-out used to bump only the epoch, which invalidates
    tokens but leaves the key itself standing — so a copy of /data taken
    before the sign-out could still mint valid sessions afterwards (2.496.207).
    Raises OSError when /data cannot be written; the caller decides."""
    global _session_secret_cache
    fresh = secrets.token_hex(32).encode()
    atomic_write(_data(SESSION_SECRET_NAME), lambda out: out.write(fresh), mode=0o600)
    _session_secret_cache = fresh


#: (mtime_ns, epoch) — see `_session_epoch`. Invalidated by the file changing,
#: which `_bump_session_epoch`'s atomic replace always does.
_EPOCH_CACHE = None


def _session_epoch() -> int:
    """Monotonic counter mixed into every session signature.

    Sessions are stateless signed tokens with a 30-day life, which is right for
    a kiosk that should not re-prompt daily — but it also meant a token that
    leaked (a browser left open, a shoulder-surfed PIN) stayed valid for a
    month with no way to invalidate it short of destroying the signing key.
    Bumping this epoch invalidates every outstanding session at once while
    KEEPING the signing key, so /auth/logout-all is a supported operation
    rather than a filesystem intervention.

    ⚠️ CACHED ON THE FILE'S OWN mtime. This is read on every signature
    computation — twice per authorised request, since `_authorized` and
    `_role_for` each resolve the session separately — and now once per
    re-validated websocket frame as well. Keying the cache on `st_mtime_ns`
    keeps the property the docstring above promises (a bump takes effect at
    once, with no restart) while making the common case a stat instead of an
    open-read-parse.
    """
    global _EPOCH_CACHE
    try:
        stamp = os.stat(_data(SESSION_EPOCH_NAME)).st_mtime_ns
    except OSError:
        return 0
    cached = _EPOCH_CACHE
    if cached is not None and cached[0] == stamp:
        return cached[1]
    try:
        with open(_data(SESSION_EPOCH_NAME), "r", encoding="utf-8") as f:
            value = int(f.read().strip() or "0")
    except (OSError, ValueError):
        return 0
    _EPOCH_CACHE = (stamp, value)
    return value


def _bump_session_epoch() -> int:
    nxt = _session_epoch() + 1
    try:
        # A torn epoch reads back as 0 (the int() falls over and _session_epoch
        # returns 0), which silently re-validates every token logout-all was
        # called to kill. Atomic or not at all.
        atomic_write(_data(SESSION_EPOCH_NAME), lambda out: out.write(str(nxt)),
                     binary=False, mode=0o600)
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


def _load_vesta_table(name: str, refusal: str) -> dict:
    """One of the add-on's own JSON tables (/usr/share/vesta/<name>, or the
    repo's rootfs copy beside this file when run from a checkout).

    FAIL CLOSED, for every table: unreadable or unparsable returns {} — which
    grants nothing — and says what is refused because of it. Written out four
    times (roles, ha-commands, fm-records, agent-contract) until 2.496.263."""
    here = os.path.dirname(os.path.abspath(__file__))
    for path in ("/usr/share/vesta/" + name,
                 os.path.join(here, "..", "share", "vesta", name)):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            continue
    print(f"[proxy] {name} unreadable: {refusal}", flush=True)
    return {}


# ── WHAT EACH ROLE MAY DO — ONE TABLE, READ HERE AND BY THE APP ──────────
# Every authorization decision below asks `_may(role, capability)`; none names
# a role. The rights themselves live in /usr/share/vesta/roles.json
# (rootfs/usr/share/vesta/ in the repo), which src/auth/permissions.ts imports
# too — the ha-commands.json precedent. They used to be written twice, here and
# in the app, kept equal by a test that scraped the TypeScript as text.
#
# Two names are derived or proxy-only:
#   viewCameras — held exactly when "camera" is not among a profile's
#                 deniedTypes, so what the app hides and what the proxy refuses
#                 cannot disagree.
#   administer  — exempt from the websocket/REST allowlists and the service
#                 confinement, may revoke every session and read telemetry.
#
# ⚠️ THE VESTA AGENT IS NOT A PROFILE (docs/agent-integration/PLAN.md A3). Its
# row is roles.json's "agent": it never appears on the profile picker, never
# holds a cookie, and is not in AUTH_ROLES — it reaches only /agent/v1/*, by
# bearer token (_agent_refuse), and _authorized() never looks at its token.
#
# FAIL CLOSED: an unreadable table grants nothing to anyone.
def _load_roles() -> dict:
    return _load_vesta_table("roles.json", "every profile refused")


def _role_capabilities(table: dict) -> dict:
    """roles.json → {role: frozenset of capabilities}, viewCameras derived."""
    out = {}
    for role, row in (table.get("profiles") or {}).items():
        caps = set(row.get("capabilities") or ())
        if "camera" not in (row.get("deniedTypes") or ()):
            caps.add("viewCameras")
        out[role] = frozenset(caps)
    out["agent"] = frozenset((table.get("agent") or {}).get("capabilities") or ())
    return out


ROLES_TABLE = _load_roles()
ROLE_CAPABILITIES = _role_capabilities(ROLES_TABLE)
# The Guest profile's display name — what the app stamps on a guest's own report (roles.json `profiles.guest.label`,
# src/auth/roles.ts ROLE_LABELS), read from the one table (architecture review, 2026-10-19: it was the literal "Guest"
# here and in tests/proxy-rules.py). FAIL CLOSED: no table, no name — only an unsigned raising step passes.
GUEST_LABEL = ((ROLES_TABLE.get("profiles") or {}).get("guest") or {}).get("label")


def _may(role: str, capability: str) -> bool:
    """Whether this role holds this capability. An unknown role holds none."""
    return capability in ROLE_CAPABILITIES.get(role, frozenset())


# ── WHAT THE KIOSK SENDS HOME ASSISTANT: ONE TABLE, READ HERE AND BY THE APP ─
# /usr/share/vesta/ha-commands.json (rootfs/usr/share/vesta/ in the repo) lists
# every websocket type, camera command, service domain and homeassistant.*
# service the kiosk's own UI sends. This file used to keep its own copy "in
# sync" by a comment, and it drifted: the Energy window's `energy/info` (added
# client-side in 2.496.105), scene.turn_on and input_boolean.toggle were all
# refused for every non-owner profile while the app offered them (round 10,
# 2.496.151). tests/oracles/ha_commands.mjs now fails when the app sends
# something the table does not list.
#
# FAIL CLOSED: an unreadable table allows nothing beyond the owner's
# exemption — never everything.
def _load_ha_commands() -> dict:
    return _load_vesta_table("ha-commands.json", "non-owner Home Assistant access refused")


HA_COMMANDS = _load_ha_commands()
# Anything outside these reaching call_service/services/* from a non-owner
# session did not come from a kiosk button.
ALLOWED_SERVICE_DOMAINS = frozenset(HA_COMMANDS.get("serviceDomains", ()))
# homeassistant.* also holds system-level services (restart, stop,
# reload_core_config, set_location, ...) — only the generic toggle.
ALLOWED_HOMEASSISTANT_SERVICES = frozenset(HA_COMMANDS.get("homeassistantServices", ()))


# A light's scene choice (ha-commands.json `sceneSelect`): the one select a non-owner reads and calls a service on.
# FAIL CLOSED: an unreadable rule matches nothing.
_SCENE = HA_COMMANDS.get("sceneSelect") if isinstance(HA_COMMANDS.get("sceneSelect"), dict) else {}
SCENE_SELECT_DOMAIN = str(_SCENE.get("domain") or "")
try:
    SCENE_SELECT_RE = re.compile(str(_SCENE["objectId"])) if _SCENE.get("objectId") else None
except re.error:
    SCENE_SELECT_RE = None
SCENE_SELECT_SERVICES = frozenset(_SCENE.get("services") or ())


# ⚠️ ...AND ON A LIGHT'S DEVICE (architecture review #5, 2026-10-20): the name alone let any select called "…_scene"
# through, a boiler's or a camera's too; the screen offers only one on a light's device (panelRules.sceneSelectOf).
# Core says which selects sit on a device with a light (one template, every LIGHT_SCENES_REFRESH_S); until it has
# answered, none does — FAIL CLOSED.
_LIGHT_SCENE_SELECTS: frozenset[str] = frozenset()
LIGHT_SCENES_REFRESH_S = 300
LIGHT_SCENES_TEMPLATE = (
    "{% set ns = namespace(out=[]) %}{% for s in states.select %}{% set d = device_id(s.entity_id) %}"
    "{% if d and device_entities(d) | select('match', 'light\\.') | list | count > 0 %}"
    "{% set ns.out = ns.out + [s.entity_id] %}{% endif %}{% endfor %}{{ ns.out | tojson }}"
)


def _scene_named(entity_id: str) -> bool:
    """Whether this entity is NAMED as a scene choice (ha-commands.json `sceneSelect`)."""
    domain, _, obj = str(entity_id).partition(".")
    return bool(SCENE_SELECT_RE and SCENE_SELECT_DOMAIN and domain == SCENE_SELECT_DOMAIN and obj
                and SCENE_SELECT_RE.fullmatch(obj))


def _scene_select(entity_id: str) -> bool:
    """Whether this entity is a light's scene choice: so named, and on a device that has a light."""
    return _scene_named(entity_id) and str(entity_id) in _LIGHT_SCENE_SELECTS


def _light_scenes_from(answer: object) -> frozenset[str] | None:
    """The scene choices in Core's answer to LIGHT_SCENES_TEMPLATE (a list of select ids), or None when it is not one
    — an unreadable answer keeps the last good set rather than opening or closing anything on its say-so."""
    if isinstance(answer, str):
        try:
            answer = json.loads(answer)
        except ValueError:
            return None
    if not isinstance(answer, list) or not all(isinstance(e, str) for e in answer):
        return None
    return frozenset(e for e in answer if _scene_named(e))


async def _learn_light_scenes(session: ClientSession) -> None:
    """Ask Core which scene choices sit on a light's device, every LIGHT_SCENES_REFRESH_S. Best-effort: a failed
    ask keeps the last answer (none before the first)."""
    global _LIGHT_SCENE_SELECTS
    while True:
        try:
            async with session.post(f"http://{SUPERVISOR}/core/api/template", headers=AUTH,
                                    json={"template": LIGHT_SCENES_TEMPLATE},
                                    timeout=ClientTimeout(total=20)) as resp:
                if resp.status == 200 and (found := _light_scenes_from(await resp.text())) is not None:
                    _LIGHT_SCENE_SELECTS = found
        except (ClientError, OSError, asyncio.TimeoutError, ValueError) as e:
            print(f"[supervisor-proxy] light scenes: {type(e).__name__}", flush=True)
        await asyncio.sleep(LIGHT_SCENES_REFRESH_S)


def _call_targets(obj: dict) -> list[str] | None:
    """The entity ids a call_service frame names (its target and its service_data), or None when it names none or
    aims at an area, a device, a floor or a label — a target this process cannot judge entity by entity."""
    ids: list[str] = []
    for part in (obj.get("target"), obj.get("service_data")):
        if part is None:
            continue
        if not isinstance(part, dict):
            return None
        if any(k in part for k in ("area_id", "device_id", "floor_id", "label_id")):
            return None
        e = part.get("entity_id")
        if e is None:
            continue
        for x in (e if isinstance(e, list) else [e]):
            if not isinstance(x, str):
                return None
            ids.append(x)
    return ids or None


# The entity domains a non-owner session may read — see the docstring's
# "What a non-owner session can READ". FAIL CLOSED like the rest of the table.
READ_DOMAINS = frozenset(HA_COMMANDS.get("readDomains", ()))

def _read_allowed(role: str, entity_id: str) -> bool:
    """Whether this role may see this entity at all. Owner is exempt; everyone
    else is held to READ_DOMAINS, and to `viewCameras` for a camera."""
    if _may(role, "administer"):
        return True
    if _scene_select(entity_id):
        return True                      # a light's scene choice: read by every profile (ha-commands.json)
    domain = str(entity_id).partition(".")[0]
    if domain not in READ_DOMAINS:
        return False
    return domain != "camera" or _may(role, "viewCameras")


def _relay_to_client(role: str, text: str) -> str | None:
    """The one place a Core→browser websocket frame is judged for a non-owner
    session: the text to forward — narrowed when it lists entities — or None
    to drop it.

    A bus event of a type not in ALLOWED_EVENT_TYPES is dropped whole, and so
    is a state_changed event (or any event naming an entity) for an entity the
    role may not read. A result that is a list of entities
    keeps only what the role may read. Anything unreadable as JSON is dropped: Core speaks
    JSON, and a frame this process cannot judge must not pass on its say-so."""
    if _may(role, "administer"):
        return text
    try:
        obj = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    kind = obj.get("type")
    if kind == "event":
        event = obj.get("event")
        if not isinstance(event, dict):
            return None
        # A bus event (it has an event_type or data) only of a type the gate lets
        # a non-owner subscribe to — the second lock behind _ws_frame_refusal. A
        # command's own stream (a camera's WebRTC answer) carries neither.
        et = event.get("event_type")
        if ("event_type" in event or "data" in event) and not (isinstance(et, str) and et in ALLOWED_EVENT_TYPES):
            return None
        data = event.get("data")
        eid = data.get("entity_id") if isinstance(data, dict) else None
        if eid is not None and not _read_allowed(role, str(eid)):
            return None
        return text
    if kind == "result":
        res = obj.get("result")
        if isinstance(res, list) and any(isinstance(e, dict) and "entity_id" in e for e in res):
            obj["result"] = [
                e for e in res
                if not isinstance(e, dict) or "entity_id" not in e or _read_allowed(role, str(e["entity_id"]))
            ]
            return json.dumps(obj, separators=(",", ":"))
        return text
    return text


def _rest_query_allowed(role: str, tail: str, query) -> bool:
    """The REST twin of _relay_to_client, for the one relayed read that names
    entities in its QUERY: history/period without `filter_entity_id` returns
    every entity's history, so a non-owner must name what it asks for, and
    every id named must be one it may read."""
    if _may(role, "administer"):
        return True
    if not tail.startswith("history/period/"):
        return True
    ids = [i.strip() for i in str(query.get("filter_entity_id", "")).split(",") if i.strip()]
    return bool(ids) and all(_read_allowed(role, i) for i in ids)


def _service_call_allowed(role: str, domain: str, service: str, targets: list[str] | None = None) -> bool:
    """Whether a call_service (WS) / services/<domain>/<service> (REST) frame
    from this role may reach Core. Owner administers the kiosk and is exempt
    (matches its "manageModel"/full capability set in permissions.ts); every
    other role is confined to the domains above regardless of what
    permissions.ts's category/type matrix would otherwise show them."""
    if _may(role, "administer"):
        return True
    if domain == "homeassistant":
        return service in ALLOWED_HOMEASSISTANT_SERVICES
    if SCENE_SELECT_DOMAIN and domain == SCENE_SELECT_DOMAIN and domain not in ALLOWED_SERVICE_DOMAINS:
        # a light's scene choice only, named entity by entity (`targets`; the REST twin names none: refused)
        return service in SCENE_SELECT_SERVICES and bool(targets) and all(_scene_select(t) for t in targets)
    return domain in ALLOWED_SERVICE_DOMAINS


def _public_model_access() -> bool:
    """Opt-in add-on option (default off): treat /model/* and /addon-config as
    PUBLIC — reachable with no session at all. Deliberately narrow to those two
    routes; /core/* (Home Assistant control) always goes through _authorized()
    regardless. Read fresh on every call (not cached) so flipping the option
    takes effect without restarting this process."""
    return opt("public_model_access")


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


def _refuse(request: web.Request, capability: str | None = None,
            message: str = "forbidden") -> web.Response | None:
    """The gate at the top of a handler: 401 without a valid session, 403
    (with `message`) when its role lacks `capability`, None to proceed.

    ⚠️ WRITTEN OUT BY HAND AT TWELVE HANDLERS BEFORE (round 11, 2.496.169),
    as `_authorized` then `_may(_role_for(...))`, and they had drifted into
    two 403 shapes — `_forbidden(message)` at most, a bare {"error":
    "forbidden"} at two. tests/proxy-rules.py requires every routed handler
    to call this (or to be named there as public, with its reason)."""
    if request.method not in ("GET", "HEAD", "OPTIONS") and _cross_site(request):
        return _forbidden("cross-site request refused")
    if not _authorized(request):
        return _unauthorized()
    if capability is not None and not _may(_role_for(request), capability):
        return _forbidden(message)
    return None


async def _json_body(request: web.Request) -> object:
    """The request's JSON, or the 400 to answer when it is not JSON — the caller returns a web.Response it is given.

    ⚠️ PARSED FIVE TIMES BEFORE (2026-10-22), with two except-tuples and two wordings ("invalid JSON", "invalid JSON
    body"); one now. ValueError covers both a decode error and bytes that are not UTF-8 (each is a subclass)."""
    try:
        return await request.json()
    except ValueError:
        return web.json_response({"error": "invalid JSON body"}, status=400)


async def _json_object(request: web.Request) -> dict | web.Response:
    """_json_body that must be an object. ⚠️ AN ARRAY WAS A 500 at the login and the superadmin code: both called
    body.get on whatever came; it is the same 400 as a body that is not JSON."""
    body = await _json_body(request)
    if isinstance(body, web.Response) or isinstance(body, dict):
        return body
    return web.json_response({"error": "invalid JSON body"}, status=400)


def _cross_site(request: web.Request) -> bool:
    """A write the browser itself says came from another site. Defence in
    depth behind the cookie's SameSite=Lax: that attribute is what stops a
    hostile page from riding a signed-in session, and this is the second
    layer that holds if it ever regresses. Only the browser's own verdict is
    used, and only a definite one — the header is absent on older WebKit and
    may be dropped by a gateway, and absence must never lock the kiosk out."""
    return request.headers.get("Sec-Fetch-Site", "").strip().lower() == "cross-site"
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
    # Cookies ARE sent on a same-origin WS handshake, so an unauthenticated
    # direct caller is rejected before any socket to Core is opened.
    if (refused := _refuse(request)) is not None:
        return refused
    role = _role_for(request)
    # ⚠️ THE SESSION IS RE-RESOLVED FOR THE LIFE OF THE SOCKET, AND IT USED NOT
    # TO BE. `role` was decided here, at the handshake, and captured into the
    # relay loop below — which never looked at the cookie again. So
    # `/auth/logout-all`, whose whole docstring calls it "the answer to 'a
    # device was lost / a PIN was seen'", could not reach a tablet that was
    # already connected: it bumps the epoch, every COOKIE stops verifying, and
    # an open socket carries on relaying `call_service` frames. The websocket is
    # where the kiosk's service calls go — it is the control path, so it was the
    # lenient one of the two transports. `session_days` had the same hole: a
    # shorter window did not shorten a connection opened before it.
    #
    # ⚠️ RE-CHECKED ON EVERY PRIVILEGED FRAME, AND OTHERWISE ON A CADENCE. A
    # `call_service` is re-validated before it is relayed, whatever the clock
    # says; everything else pays at most one check per RECHECK_SECONDS. With the
    # epoch now cached on its mtime, the common case is a stat.
    last_check = time.monotonic()

    def _still_valid(force: bool = False) -> bool:
        nonlocal role, last_check
        now = time.monotonic()
        if not force and now - last_check < WS_RECHECK_SECONDS:
            return True
        last_check = now
        # Ingress is re-checked too: the tag is set by nginx per request and a
        # socket that arrived through it stays owner-equivalent for its life.
        if _is_ingress(request):
            role = "owner"
            return True
        fresh = _session_role(request.cookies.get(SESSION_COOKIE))
        if fresh is None:
            return False
        role = fresh
        return True

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
                        # ⚠️ BEFORE ANYTHING IS RELAYED. A `call_service` is
                        # re-validated unconditionally — it is the frame that
                        # operates the villa's doors — and every other frame at
                        # most once per WS_RECHECK_SECONDS. A session that has
                        # been logged out, expired, or had its epoch bumped ends
                        # the socket here rather than living until the tablet
                        # happens to disconnect.
                        if not _still_valid(force=obj.get("type") == "call_service"):
                            await client.close(code=4401, message=b"session ended")
                            return
                        if obj.get("type") == "auth":
                            obj["access_token"] = TOKEN
                            data = json.dumps(obj)
                        elif (refusal := _ws_frame_refusal(role, obj)):
                            # Answered HERE, never relayed — see
                            # _ws_frame_refusal. Mirrors HA's own websocket
                            # error shape (id + success:false) so the kiosk's
                            # pending promise rejects instead of hanging.
                            await client.send_json({
                                "id": obj.get("id"),
                                "type": "result",
                                "success": False,
                                "error": {"code": "unauthorized", "message": refusal},
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
                    if (out := _relay_to_client(role, msg.data)) is not None:
                        await client.send_str(out)
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
# src/ha/HAHistoryAPI.ts and HACameraProxy.ts). Everything else a non-owner
# might ask for is denied by default.
_NON_OWNER_REST_PREFIXES = ("history/period/", "camera_proxy/", "camera_proxy_stream/")
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
# reads the pre-aggregated "change" for a real statistic over a period.
#
# config/floor_registry/list, same category as the other three registry list
# calls: HA's own Floors feature (an Area's optional parent grouping), read
# so a device's storey can resolve from HA the same way its room already
# does (see HAStateStore.tsx's entityFloorNumbers) instead of only from the
# floor-plan's own static per-room data.
#
# All of the above are read-only, same as the registry list calls above.
# Every websocket command that opens a camera's picture. ONE set, because the
# guest refusal below has to cover all of them: it used to name `camera/stream`
# alone, which was the whole set only while HLS was the only way in. WebRTC is
# four more commands (capabilities, client config, offer, candidate), and a
# guest who could send `camera/webrtc/offer` would watch the same feed the
# HLS refusal exists to withhold.
CAMERA_WS_TYPES = frozenset(HA_COMMANDS.get("camera", ()))

# Read from the one table (see _load_ha_commands above).
ALLOWED_WS_TYPES = frozenset({*HA_COMMANDS.get("websocket", ()), *CAMERA_WS_TYPES})
# The event types a non-owner may subscribe to, and the only bus events relayed
# to one (ha-commands.json `events`). subscribe_events used to be allowed with
# ANY event_type, or none (= every event), and the relay forwarded each event
# that named no entity: a guest could read telegram_text, i.e. people's
# messages to the villa's bot. Empty table = nothing subscribable: default deny.
ALLOWED_EVENT_TYPES = frozenset(HA_COMMANDS.get("events", ()))


def _ws_frame_refusal(role: str, obj: dict) -> str | None:
    """Why this websocket frame is refused for this role, or None to relay it.

    The websocket twin of _rest_call_allowed, and the WHOLE decision: the
    relay loop only forwards or answers with this text. `administer` is exempt.
    Everyone else is DEFAULT DENY against ALLOWED_WS_TYPES; a camera command
    needs `viewCameras`; a call_service is judged per domain/service by
    _service_call_allowed — which used to be decided inline in the relay loop,
    where nothing but a search of the source text could reach it."""
    if _may(role, "administer"):
        return None
    msg_type = str(obj.get("type", ""))
    if msg_type not in ALLOWED_WS_TYPES:
        return "This profile may not send this command."
    if msg_type in CAMERA_WS_TYPES and not _may(role, "viewCameras"):
        return "This profile may not view cameras."
    if msg_type == "subscribe_events" and not (
        isinstance(obj.get("event_type"), str) and obj["event_type"] in ALLOWED_EVENT_TYPES
    ):
        # No event_type means EVERY event on the bus; refused like any other.
        return "This profile may not subscribe to these events."
    if msg_type == "call_service" and not _service_call_allowed(
        role, str(obj.get("domain", "")), str(obj.get("service", "")), _call_targets(obj),
    ):
        return "This profile may not call this service."
    return None


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
    if _may(role, "administer"):
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
    if t.startswith(("camera_proxy/", "camera_proxy_stream/")) and not _may(role, "viewCameras"):
        # The same capability the websocket's camera commands ask for — see
        # _ws_frame_refusal. permissions.ts hides cameras from such a role,
        # but that is a render filter; this is the refusal.
        return False
    return t.startswith(_NON_OWNER_REST_PREFIXES)


async def rest_handler(request: web.Request) -> web.StreamResponse:
    """Relay a REST call to Core, adding the Supervisor Bearer token."""
    if (refused := _refuse(request)) is not None:
        return refused
    role = _role_for(request)
    tail = request.match_info.get("path", "")
    if not _rest_call_allowed(role, tail):
        return _forbidden("This profile may not access this endpoint.")
    if not _rest_query_allowed(role, tail, request.query):
        return _forbidden("This profile may not read these entities.")
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
    """The add-on's options, or {} — which every reader treats as "nothing
    configured": no passcode verifies, no profile opens. That is the CLOSED
    failure, and it is what an unreadable file must produce: the proxy runs
    unprivileged (2.496.208) and the Supervisor rewrites this file as root on
    every option save, so between a save and the restart Home Assistant asks
    for, a read may be refused rather than merely absent."""
    try:
        with open(_data("options.json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


# ── THE ADD-ON'S OPTIONS: ONE TABLE ─────────────────────────────────────────
# Every option the Configuration page offers, one row each: its kind, its
# default, its range or pattern, and any OLDER place an install may still have
# it stored. Every reader asks opt(name); the start-up self-heal asks
# migrate_options(stored). tests/addon-manifest.py checks villa-kiosk/
# config.yaml against this table BY VALUE — default, range and pattern.
#
# Before 2.496.223 an option's default and range were written in the manifest
# AND in each reader, never compared, and the three moves of the agent
# settings in one day each touched seven or eight places.
#
# A dotted name is a field inside a group on the page (`vesta_agent.token`).
# Values are read fresh on every call (a change needs no restart) and never
# trusted: the schema validates what the form writes, but /data/options.json
# can be hand-edited, so a malformed value falls back to the default (for a
# code or token: to "not configured", the closed failure) and a number is
# clamped — a retention of -1 or 10**9 must not become "delete everything" or
# "never delete".
PIN_RE = re.compile(r"^[0-9]{4}$")
SUPERADMIN_PIN_RE = re.compile(r"^[0-9]{6}$")
#: ⚠️ A SHORT TOKEN IS A GUESSABLE ONE. The option is a masked `password`
#: field (config.yaml), which cannot also carry a pattern, so THIS is the one
#: check of its shape: a token that fails it is treated as NOT CONFIGURED — the
#: closed failure — and the start-up log says so (_agent_config_warning).
AGENT_TOKEN_RE = re.compile(r"^[A-Za-z0-9._~+/=-]{16,128}$")


class Option:
    """One row of OPTIONS. `kind` is "text" (fullmatch `pattern`, else ""),
    "secret" (the same, shown masked), "bool" (only a real true/false counts)
    or "int" (clamped to lo..hi). `older` lists the places an earlier release
    stored it, as key paths; while one is still stored it WINS, and
    migrate_options moves it here."""
    __slots__ = ("kind", "default", "lo", "hi", "pattern", "older")

    def __init__(self, kind, default, lo=None, hi=None, pattern=None, older=()):
        self.kind, self.default, self.lo, self.hi = kind, default, lo, hi
        self.pattern, self.older = pattern, tuple(older)


OPTIONS = {
    "guest_pin": Option("text", "", pattern=PIN_RE),
    "owner_pin": Option("text", "", pattern=PIN_RE),
    "ops_pin": Option("text", "", pattern=PIN_RE),
    "superadmin_pin": Option("text", "", pattern=SUPERADMIN_PIN_RE),
    "public_model_access": Option("bool", False),
    "session_days": Option("int", 30, 1, 365),
    "telemetry_max_events": Option("int", 500, 50, 5000),
    "pin_lockout_minutes": Option("int", 5, 1, 1440),
    # THE agent switch sits above its group, so the page shows it with the
    # group folded; in 2.496.218 it was inside the group as `enabled`.
    "agent_enabled": Option("bool", False, older=[("vesta_agent", "enabled")]),
    # Before 2.496.218 the agent's settings were flat keys.
    "vesta_agent.token": Option("secret", "", pattern=AGENT_TOKEN_RE, older=[("agent_token",)]),
    "vesta_agent.offline_after_minutes": Option("int", 5, 1, 60, older=[("agent_offline_after_minutes",)]),
}


def _stored_at(options, path):
    """(True, value) when `path` is stored in `options`, else (False, None)."""
    node = options
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return False, None
        node = node[key]
    return True, node


def _stored_value(options, name):
    """The raw stored value of option `name` — an older place first — or its
    default when it is stored nowhere."""
    row = OPTIONS[name]
    for path in row.older + (tuple(name.split(".")),):
        found, value = _stored_at(options, path)
        if found:
            return value
    return row.default


def opt(name: str, options: dict | None = None):
    """Option `name`, read fresh from /data/options.json (or `options`), in
    the shape its row promises. Never raises."""
    row = OPTIONS[name]
    raw = _stored_value(_read_options() if options is None else options, name)
    if row.kind == "bool":
        return raw if isinstance(raw, bool) else row.default
    if row.kind == "int":
        if isinstance(raw, bool):
            return row.default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return row.default
        return max(row.lo, min(row.hi, value))
    if row.kind == "secret":
        text = raw if isinstance(raw, str) else ""
    else:
        text = str(raw or "").strip()
    return text if row.pattern.fullmatch(text) else ""


def migrate_options(stored: dict) -> dict | None:
    """The stored options to write back, or None when nothing is stale:
    retired options (REMOVED_OPTIONS) dropped, and every option still in an
    OLDER place moved to its current one, value kept — the owner's token and
    switch must survive an update. Pure: tests/agent-interface.py drives it."""
    out = json.loads(json.dumps(stored))
    changed = False
    for path in REMOVED_OPTIONS:
        found, _ = _stored_at(out, path)
        if found:
            parent = out
            for key in path[:-1]:
                parent = parent[key]
            del parent[path[-1]]
            changed = True
    for name, row in OPTIONS.items():
        path = tuple(name.split("."))
        found_any, kept = False, None
        for older in row.older:
            found, value = _stored_at(out, older)
            if not found:
                continue
            if not found_any:
                found_any, kept = True, value   # the first older place wins
            parent = out
            for key in older[:-1]:
                parent = parent[key]
            del parent[older[-1]]
        if found_any:
            target = out
            for key in path[:-1]:
                if not isinstance(target.get(key), dict):
                    target[key] = {}
                target = target[key]
            target[path[-1]] = kept
            changed = True
    return out if changed else None


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
        cleaned = migrate_options(options)
        if cleaned is None:
            return
        stale = sorted((set(options) - set(cleaned))
                       | {".".join(p) for p in REMOVED_OPTIONS if _stored_at(options, p)[0]})
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


#: Files this process once kept in /data and no longer reads: removed at start, once, so a retired store never lingers
#: on an install (2.496.445: the agent's messages and the answers to them).
RETIRED_DATA_FILES = ("agent-messages.json", "agent-choices.json")


def _remove_retired_data() -> list[str]:
    """Delete RETIRED_DATA_FILES from the data directory; the names actually removed. Best-effort: a file that will not
    go stays, and the next start tries again."""
    gone = []
    for name in RETIRED_DATA_FILES:
        try:
            os.unlink(_data(name))
            gone.append(name)
        except FileNotFoundError:
            pass
        except OSError as err:
            print(f"[supervisor-proxy] retired file {name} kept: {err}", flush=True)
    return gone


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
        with open(os.path.join(_data(WWW_NAME), rel) + ".upload.json", encoding="utf-8") as f:
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
        os.path.join(_data(WWW_NAME), MANAGED_PATH["glb"])) else ""
    return {
        "model_path": model_rel,
        "model_upload": _upload_meta(model_rel) if model_rel else None,
        "rooms_upload": _upload_meta(_rooms_rel(model_rel)) if model_rel else None,
        "model_version": _file_version(model_rel) if model_rel else "",
        "rooms_version": _file_version(_rooms_rel(model_rel)) if model_rel else "",
    }


def _file_version(rel: str) -> str:
    """The version of a central file as the Kiosk stamps its URL (?v=), "" when
    it does not exist. Exactly nginx's ETag for the same file — "<mtime in
    seconds, hex>-<size, hex>" (ngx_http_set_etag) — which is what the Kiosk
    read from a HEAD request before the add-on reported it here: a device's
    cached model keeps its URL across that change and is not downloaded again.
    A replaced file changes its mtime (an upload writes a new file), so the
    version changes with it."""
    try:
        st = os.stat(os.path.join(_data(WWW_NAME), rel))
    except OSError:
        return ""
    return f"{int(st.st_mtime):x}-{st.st_size:x}"


def _resolve_upload_target(kind: str) -> str:
    """Absolute, traversal-checked destination path for an upload of this kind.

    The GLB writes to the single managed location; the room-data sidecar is
    derived from it (<model>.rooms.json), so both files always sit together.
    Raises ValueError if the resolved path escapes the data root.
    """
    rel = MANAGED_PATH["glb"] if kind == "glb" else _rooms_rel(MANAGED_PATH["glb"])
    root = os.path.realpath(_data(WWW_NAME))
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


async def healthz_handler(request: web.Request) -> web.Response:
    """The image's Docker HEALTHCHECK (Dockerfile), which the Supervisor's
    watchdog acts on: 200 means nginx reached this process and it answered.
    PUBLIC on purpose and says nothing — no version, no option, no state —
    because the check carries no session, and anything it said would be
    readable by anyone who can reach the port. A hung proxy fails it (the
    check times out); a dead one fails it too (nginx answers 502)."""
    return web.Response(text="ok", headers={"Cache-Control": "no-store"})


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
# PIN_RE: see OPTIONS.

# ── Superadmin elevation ─────────────────────────────────────────────────
# NOT a fourth profile: it never appears in the profile picker, mints no
# session, and cannot be "logged in as". It is a one-shot elevation used to
# authorise a single DESTRUCTIVE write that the caller's normal role is not
# allowed to make — today, permanently deleting a Facility Manager record.
#
# It is ADDITIVE, never a bypass: the store's own capability check still
# applies, so deleting FM records requires manageFacility (owner or ops) AND a
# valid elevation. Knowing the code does not turn a guest into an administrator.
#
# Six digits rather than four: this authorises irreversible destruction of the
# maintenance record, so it should not share the guessing surface of the
# everyday profile PINs (and the same two-tier rate limiter still applies).
SUPERADMIN = "superadmin"
SUPERADMIN_PIN_OPTION = "superadmin_pin"
# SUPERADMIN_PIN_RE: see OPTIONS.
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
#: How often an OPEN websocket re-resolves its session. Short enough that
#: "log out all devices" takes effect while somebody is still walking to the
#: tablet; long enough that an idle socket is not doing work.
WS_RECHECK_SECONDS = 30

AUTH_MAX_FAILURES = 5            # per client IP, per role
AUTH_GLOBAL_MAX_FAILURES = 50    # per role, all clients combined
AUTH_GLOBAL_LOCKOUT_SECONDS = 900
AUTH_TRACK_MAX_CLIENTS = 2048    # hard cap on tracked (role, ip) pairs
_auth_failures: dict = {}                                    # (role, ip) -> state

#: ⚠️ TIMESTAMPS, NOT A COUNT, AND THE DIFFERENCE IS A LOCKED-OUT VILLA. This
#: was `{"count": 0, "last": 0.0}` per role, written in exactly two places —
#: incremented on a wrong PIN, and reset inside `_lockout_remaining` only AFTER
#: it had already fired. Nothing aged it while it was still below the limit, so
#: it was monotonic from process start to 50: the fiftieth CUMULATIVE mistyped
#: PIN for a role, across every guest and every tablet, on an add-on that runs
#: for weeks, locked that role out from every source address for 900 s — the
#: owner included.
#:
#: That is the outcome this limiter was rewritten to prevent, in the note eight
#: lines above: "A lockout must punish the guesser, not the victim." A backstop
#: against a distributed guess has to be a RATE, and a rate needs the window
#: applied while the count is still below the limit.
#:
#: Bounded by construction: `_note_global_failure` drops what has aged out and
#: keeps only the newest `AUTH_GLOBAL_MAX_FAILURES`, which is all the question
#: "are there N inside the window" can need.
#:
#: Keyed by BUCKET — a profile, SUPERADMIN or AGENT — and created on first use,
#: so a new door needs no entry here (the agent's used to be a bare "agent"
#: literal, 1,500 lines before the AGENT constant it had to equal).
_auth_failures_global: dict = defaultdict(list)


def _note_global_failure(role: str, now: float = None) -> None:
    """Record one wrong PIN against a role, from any source address."""
    moment = time.monotonic() if now is None else now
    hits = _auth_failures_global[role]
    hits.append(moment)
    fresh = [t for t in hits if moment - t < AUTH_GLOBAL_LOCKOUT_SECONDS]
    hits[:] = fresh[-AUTH_GLOBAL_MAX_FAILURES:]


def _global_locked_for(role: str, now: float = None) -> int:
    """Seconds this ROLE is locked out for, from every address, or 0.

    ⚠️ A RATE: `AUTH_GLOBAL_MAX_FAILURES` failures inside one window. The wait
    ends when the OLDEST of them ages out, so a guesser who stops is released on
    the window and one who continues is not.
    """
    moment = time.monotonic() if now is None else now
    hits = [t for t in _auth_failures_global[role]
            if moment - t < AUTH_GLOBAL_LOCKOUT_SECONDS]
    _auth_failures_global[role][:] = hits
    if len(hits) < AUTH_GLOBAL_MAX_FAILURES:
        return 0
    remaining = AUTH_GLOBAL_LOCKOUT_SECONDS - (moment - hits[0])
    return int(remaining) + 1 if remaining > 0 else 0


def _session_ttl() -> int:
    """How long a signed-in profile stays signed in, in seconds."""
    return opt("session_days") * 86400


#: How long the Facility record is kept, in days — its photos, repaired faults, work done and money spent; 0 keeps them
#: for ever. The villa's shared setting `recordsKeptDays` (device-config.json), set by the owner in Advanced Settings ›
#: System (owner, 2026-10-20: "more a setting that shall be available to set in the UI"; the add-on option
#: evidence_retention_days until 2.496.454). The default and ceiling are the app's (AppConfig RECORDS_KEPT_DAYS_*).
RECORDS_KEPT_DAYS = Option("int", 365, 0, 3650)


def _evidence_retention_days() -> int:
    """Age at which an evidence photo and the records are deleted. 0 disables the sweep — for an operator whose own
    retention obligation outlives any default we could pick. Referenced-photo garbage collection is unaffected either
    way: this is about age, not about whether anything still points at the file.

    ⚠️ AN UNREADABLE SETTINGS FILE KEEPS EVERYTHING (0). This decides what is DELETED: falling back to the default
    while the file cannot be read would delete, under an owner's "keep for ever", what that owner chose to keep. Not
    stored, or not a number: the default, clamped like an option."""
    stored, readable = DEVICE_CONFIG.read_status()
    if not readable:
        return 0
    raw = stored.get("recordsKeptDays", RECORDS_KEPT_DAYS.default) if isinstance(stored, dict) else RECORDS_KEPT_DAYS.default
    if isinstance(raw, bool):
        return RECORDS_KEPT_DAYS.default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return RECORDS_KEPT_DAYS.default
    return max(RECORDS_KEPT_DAYS.lo, min(RECORDS_KEPT_DAYS.hi, value))


def _telemetry_max_events() -> int:
    """How many diagnostic events the ring keeps."""
    return opt("telemetry_max_events")


def _auth_lockout_seconds() -> int:
    """How long a client is locked out after too many wrong passcodes."""
    return opt("pin_lockout_minutes") * 60


def _client_ip(request: web.Request) -> str:
    """The key of a caller's lockout bucket: `<peer>` or `<peer>|<last hop>`.

    The peer is X-VK-Peer, which nginx sets from the socket it accepted (and
    overwrites, like X-VK-Ingress — see snippets/backend-proxy.conf); the last
    hop is the LAST address in X-Forwarded-For, which the gateway in front of
    us APPENDS: Home Assistant's Ingress appends the browser it authed,
    Cloudflare's edge appends the true client. Both parts are written by
    something the caller is not.

    ⚠️ IT USED TO BE THE FIRST FORWARDED HOP — the one address in the request
    that the caller writes. The docstring reasoned that a forged header "at
    worst gives the forger their own bucket"; it missed that the forger could
    pick someone ELSE's: five wrong passcodes with the owner's address in the
    header locked the owner's device out, repeatably, and a fresh address per
    attempt minted a fresh bucket, leaving only the global tier to bound
    guessing (2.496.206). Now a forged header can only fill buckets under the
    forger's OWN peer — which is the property the old text claimed."""
    peer = (request.headers.get("X-VK-Peer") or str(request.remote or "?")).strip()[:45]
    fwd = request.headers.get("X-Forwarded-For", "")
    last = fwd.rsplit(",", 1)[-1].strip()[:45] if fwd else ""
    return f"{peer}|{last}" if last else peer


def _prune_auth_failures(now: float) -> None:
    """Drop expired per-client entries, age the global tier, and hard-trim if
    still oversized.

    ⚠️ THE GLOBAL TIER HAD NO DECAY AT ALL — see `_auth_failures_global`. This
    is the one place that can age it while it is still below the limit, which is
    what makes it a rate rather than a lifetime accumulator.

    ⚠️ AND THE WINDOW IS READ ONCE. `_auth_lockout_seconds()` was called inside
    the comprehension's condition, i.e. once per tracked client, and each call
    opens and parses `/data/options.json` — up to 2,048 blocking file reads, on
    the auth path, on the same event loop as every camera stream, driven by the
    one request an attacker controls.
    """
    window = _auth_lockout_seconds()
    for key in [k for k, st in _auth_failures.items()
                if now - st["last"] > window]:
        _auth_failures.pop(key, None)
    for hits in _auth_failures_global.values():
        hits[:] = [t for t in hits if now - t < AUTH_GLOBAL_LOCKOUT_SECONDS]
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
    return opt(PIN_OPTION[role])


def _configured_superadmin_pin() -> str:
    """The configured 6-digit superadmin code, or "" when unset/malformed.

    Empty means the whole capability is OFF: no elevation can be minted, so no
    destructive delete can be authorised by anyone. That is the default."""
    return opt(SUPERADMIN_PIN_OPTION)


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
    st = _auth_failures.get((role, ip))
    window = _auth_lockout_seconds()
    if st and st["count"] >= AUTH_MAX_FAILURES:
        remaining = window - (now - st["last"])
        if remaining <= 0:
            st["count"] = 0
        else:
            worst = int(remaining) + 1
    return max(worst, _global_locked_for(role, now))


def _auth_failed(bucket: str, ip: str, now: float = None) -> None:
    """Charge one wrong secret to this caller's bucket AND the bucket's global
    rate. The one write side of the limiter: `_lockout_remaining` asks, this
    and `_auth_succeeded` answer. Every door that takes a secret (passcode,
    superadmin code, agent token) calls exactly these three."""
    moment = time.monotonic() if now is None else now
    st = _auth_failures.setdefault((bucket, ip), {"count": 0, "last": 0.0})
    st["count"] += 1
    st["last"] = moment
    _note_global_failure(bucket, moment)


def _auth_succeeded(bucket: str, ip: str) -> None:
    """Clear only THIS caller's counter. The global tier is left to decay on
    its own window, so one correct entry cannot reset a distributed guess."""
    st = _auth_failures.get((bucket, ip))
    if st:
        st["count"] = 0


def _profile_enabled(role: str, ingress: bool) -> bool:
    """Whether a profile can be entered from where the caller stands.

    A passcode enables a profile anywhere. Without one, only the Guest profile
    is open — and only through Home Assistant's own sign-in (Ingress), where
    the person has already proved who they are. On the direct port and the
    tunnel an empty guest passcode used to mean "anyone who finds the hostname
    may open the doors" (2.496.207). The option text said so; it was still the
    wrong default for a hostname that is one guess away."""
    if _configured_pin(role):
        return True
    return role == "guest" and ingress


def _profile_disabled_text(role: str) -> str:
    if role == "guest":
        return ("The Guest profile has no passcode set, so it can only be opened "
                "from inside Home Assistant.")
    return f"the {role} profile has no PIN configured"


async def auth_roles_handler(request: web.Request) -> web.Response:
    """Report which profiles require a passcode and which can be entered from
    here at all — booleans only, no secrets."""
    ingress = _is_ingress(request)
    return web.json_response({"roles": {
        r: {"pinRequired": bool(_configured_pin(r)), "enabled": _profile_enabled(r, ingress)}
        for r in AUTH_ROLES}})


async def auth_session_handler(request: web.Request) -> web.Response:
    """Which profile this browser's session cookie is already signed in as, if
    any — so a returning device stops re-asking for a passcode it has already
    answered.

    The kiosk used to keep the active profile in the browser's sessionStorage
    only. That dies whenever the PWA's document is torn down, which on Android
    is CONSTANT (the OS evicts a backgrounded PWA and relaunches it fresh), so
    every relaunch showed the passcode pad again even though the signed
    vk_session cookie was still perfectly valid and still authorizing every
    API call the app makes. Field telemetry measured that redundant re-entry
    at 2.4-3.1s per launch — more than the villa's entire load.

    Deliberately reads the COOKIE ONLY (_session_role), never _role_for():
    _role_for treats any Ingress request as owner-equivalent, and reusing it
    here would mean nobody browsing through the HA sidebar could ever see the
    profile picker or use the kiosk as a guest — the session would silently
    resolve to owner for everyone. Null here just means "show the picker".

    No authorization check on purpose: an unauthorized caller is precisely the
    one that must receive null, and this discloses nothing the caller's own
    cookie doesn't already state. Expiry is the cookie's own — an operator
    shortens the leash with the existing `session_days` option rather than a
    second, competing setting here."""
    return web.json_response({"role": _session_role(request.cookies.get(SESSION_COOKIE))})


async def auth_elevate_handler(request: web.Request) -> web.Response:
    """Exchange the superadmin code for ONE single-use elevation token.

    Deliberately not a login: no session is minted or changed, so there is no
    such thing as "being" superadmin and nothing to forget to sign out of. The
    token authorises exactly one destructive write and is consumed by it.

    Rate-limited on the same two-tier limiter as the profile PINs (per client
    IP and globally), and requires an already-authorized session — the code is
    an extra factor on top of a normal profile, never a way in from nothing."""
    if (refused := _refuse(request)) is not None:
        return refused
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
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    submitted = str(body.get("pin", "") or "")
    if not hmac.compare_digest(submitted, configured):
        # ⚠️ SUPERADMIN, NOT THE SESSION'S ROLE. This handler is reached by an
        # owner or a facility manager, so `role` here is theirs — recording a
        # wrong SUPERADMIN code against it would both blame the wrong bucket
        # and leave the superadmin tier never accumulating at all.
        _auth_failed(SUPERADMIN, ip)
        return web.json_response({"error": "incorrect code"}, status=401)
    _auth_succeeded(SUPERADMIN, ip)
    return web.json_response({"token": _mint_elevation(),
                              "expiresIn": ELEVATION_TTL_SECONDS})


# Collections in the FM document whose records are individually addressable by
# `id`. Kept here (not imported from the frontend) because the server must be
# able to tell "a record was removed" on its own — a rule that only the client
# knows is not a rule. Equal to fm-records.json's "collections" (the app reads
# that; tests/proxy-rules.py fails when the two differ) — a literal, not a
# load, because an unreadable table must not empty it (see _load_fm_records).
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


# ── HOW LONG A CLOSED FAULT IS KEPT ─────────────────────────────────────────
# Until 2.496.342 a fault was kept FOREVER: the VESTA Agent raises and clears
# several a day, the whole record is one document with a 4 MB cap
# (FM_DATA_MAX_BYTES), so the list grew until every write would be refused
# (owner, 2026-10-14: "I hope it's not growing indefinitely?").
#
# Two windows, both counted from the fault's last resolution:
#   * closed with NO work done (its last resolving step is kind "cleared": the
#     Kiosk's "Close", the agent clearing a problem that went away) —
#     FM_CLEARED_FAULT_RETENTION_DAYS. It evidences nothing that happened.
#   * repaired — as long as its photos (_evidence_retention_days), the window
#     the owner sets in Advanced Settings; 0 there keeps them for ever.
# A close written before steps carried a kind falls in the second, longer
# window: kept too long is the safe direction.
#
# ⚠️ THE SERVER EXPIRES, NOBODY DELETES. Applied to the stored document AND to
# every write before the guards judge it (the stores' `tidy`), so an expired
# fault is never "removed by" a write (no superadmin code; the agent's
# no-delete rule untouched), and a stale copy sent back cannot resurrect it.
FM_CLEARED_FAULT_RETENTION_DAYS = 90


def _fm_ticket_expired(ticket, now: float) -> bool:
    """True when this closed fault is past its retention window."""
    if not isinstance(ticket, dict) or ticket.get("status") != "resolved":
        return False
    last = _fm_last_resolution(ticket)
    resolved_at = _iso_epoch(last.get("at")) if last else None
    if resolved_at is None:
        resolved_at = _iso_epoch(ticket.get("resolvedAt"))
    if resolved_at is None:
        return False                      # cannot tell when: kept
    days = FM_CLEARED_FAULT_RETENTION_DAYS if last and _fm_cleared_step(last) else _evidence_retention_days()
    return days > 0 and now - resolved_at > days * 86400


# ⚠️ HOW A FAULT WAS CLOSED: THE APP'S ANSWER, NOT A COPY (architecture review, 2026-10-15). This took the last step
# saying "resolved" in list order — a title change or a Telegram line written after the close carries "resolved" too,
# so a cleared Wi-Fi blip renamed afterwards was kept the full evidence window instead of 90 days. The same reading as the app's
# fmEngine.lastResolution / isClearedStep, from the same lists (agent-contract.json ticketUpdate).
def _fm_last_resolution(ticket):
    """The step that last resolved `ticket`: of the steps that change its status, in time order."""
    table = AGENT_CONTRACT_TABLE.get("ticketUpdate") or {}
    skip = set(table.get("notStatusChanges") or ())
    steps = [(i, u) for i, u in enumerate(ticket.get("updates") or [])
             if isinstance(u, dict) and u.get("status") and u.get("kind") not in skip]
    steps.sort(key=lambda p: (_iso_epoch(p[1].get("at")) or 0.0, p[0]))
    done = [u for _, u in steps if u.get("status") == "resolved"]
    return done[-1] if done else None


def _fm_cleared_step(step) -> bool:
    """A close with no work done: kind "cleared", or — written before kinds — one of the agreement's notes."""
    if step.get("kind"):
        return step.get("kind") == "cleared"
    table = AGENT_CONTRACT_TABLE.get("ticketUpdate") or {}
    note = str(step.get("note") or "")
    return note in (table.get("clearedNotes") or ()) or note.startswith(tuple(table.get("clearedNotePrefixes") or ()))


def _fm_retention() -> dict:
    """The windows above, as the app reads them beside the record (`retention` on GET /fm-data): its Tickets
    figures name the period the record still holds, never a copy of these numbers (architecture review, 2026-10-19:
    "Resolved (all time)" counted only what had not expired yet). Days; 0 = kept for ever. `recordsDays` is the
    window of completions and costs (_fm_expire) — the repaired fault's, said under its own name."""
    days = _evidence_retention_days()
    return {"retention": {"clearedDays": FM_CLEARED_FAULT_RETENTION_DAYS, "repairedDays": days, "recordsDays": days}}


# ── AND HOW LONG WORK DONE AND MONEY SPENT ARE KEPT (owner, 2026-10-20) ─────
# Completions (work signed off) and costs (money spent) were kept FOREVER while closed faults expired: "It shouldn't
# be kept forever: apply the same consistent retention policy". They are records of work done, so they take the
# repaired fault's window — _evidence_retention_days, counted from their own date (`at`); 0 keeps them for ever. Two
# completions are kept past it, because what they answer still matters: a scheduled task's LATEST completion (its
# next due date is counted from it: a task every 2 years must not read "never done") and one tied to a fault the
# record still holds (the fault and the work that fixed it go together).
def _fm_dated_expired(rec, now: float, days: int) -> bool:
    """True when this dated record (a completion, a cost) is past `days` — never when its date cannot be read."""
    at = _iso_epoch(rec.get("at")) if isinstance(rec, dict) else None
    return days > 0 and at is not None and now - at > days * 86400


def _fm_expire(doc, now: float | None = None):
    """The Facility record without the closed faults, completions and costs past their window."""
    if not isinstance(doc, dict):
        return doc
    now = time.time() if now is None else now
    out = dict(doc)
    if isinstance(doc.get("tickets"), list):
        out["tickets"] = [t for t in doc["tickets"] if not _fm_ticket_expired(t, now)]
    days = _evidence_retention_days()
    if isinstance(doc.get("completions"), list):
        held = {t.get("id") for t in out.get("tickets") or () if isinstance(t, dict)}
        latest: dict = {}
        for c in doc["completions"]:
            if isinstance(c, dict) and c.get("scheduleId") and _iso_epoch(c.get("at")) is not None:
                best = latest.get(c["scheduleId"])
                if best is None or _iso_epoch(c["at"]) > _iso_epoch(best.get("at")):
                    latest[c["scheduleId"]] = c
        keep_ids = {id(c) for c in latest.values()}
        out["completions"] = [c for c in doc["completions"]
                              if not _fm_dated_expired(c, now, days) or id(c) in keep_ids
                              or (isinstance(c, dict) and c.get("ticketId") and c.get("ticketId") in held)]
    if isinstance(doc.get("costs"), list):
        out["costs"] = [k for k in doc["costs"] if not _fm_dated_expired(k, now, days)]
    changed = any(isinstance(doc.get(k), list) and len(out[k]) != len(doc[k]) for k in ("tickets", "completions", "costs"))
    return out if changed else doc


# A guest may append at most this many reports in one write. One is the normal
# case; the cap only exists so a scripted session cannot bulk-fill the store.
FM_GUEST_MAX_NEW_TICKETS = 3


# ── THE FACILITY RECORD'S CHANGE MODULE ─────────────────────────────────────
# Three doors write the Facility record — a guest's report, owner/ops at work,
# the VESTA Agent — and each used to re-derive "what did this write change?"
# on its own (removed ids, dropped photos, unknown keys; the id index and the
# photo walk existed twice). And nothing on the server said what a VALID
# record is, so the agent's door could store a fault marked resolved with no
# resolution date, a cost whose amount is text, or a completion tied to
# nothing (2.496.223).
#
# Now one classifier (_fm_classify) says what a write changes, one validator
# (_fm_record_errors) says what is wrong with a record, and each door is a
# short POLICY on top: the guest may only append a report, deleting evidence
# needs the superadmin code, the agent may delete nothing.
#
# ⚠️ ONLY NEW PROBLEMS ARE REFUSED. A record already stored with a problem is
# not this write's fault: refusing every later write over it would lock the
# owner out of their own record. A write is refused for a problem the record
# did not have before it (_FmChange.invalid holds only those).

def _fm_by_id(doc, name: str) -> dict:
    """{id: record} for one collection — the ONE index every rule uses."""
    items = doc.get(name) if isinstance(doc, dict) else None
    return {str(it.get("id")): it for it in items
            if isinstance(it, dict) and it.get("id") not in (None, "")} if isinstance(items, list) else {}


def _fm_ids(doc) -> dict:
    """{collection: {id, ...}} for whatever this document actually contains."""
    return {name: set(_fm_by_id(doc, name)) for name in FM_RECORD_COLLECTIONS}


# THE KINDS OF EVIDENCE a record points at: its field → the file each id names in the evidence store. A photo
# (photoIds, a JPEG) and — since 2.496.326 — a document (documentIds, an HTML page: the VESTA Agent's investigation
# report on the fault it raised; owner, 2026-10-11). ONE walk, ONE sweep for both: a document nothing points at any
# more (its fault deleted by the superadmin) is deleted exactly as a photo is.
FM_EVIDENCE_KINDS = (("photoIds", ".jpg"), ("documentIds", ".html"))


def _fm_record_evidence_ids(record, field: str) -> set:
    """Every id of one kind (`field`) one record points at, its per-stage updates included — the ONE evidence walk.
    A fault's per-stage updates carry their own photos (see FmTicketUpdate); missing those would delete a live one."""
    ids = set()
    if not isinstance(record, dict):
        return ids
    if isinstance(record.get(field), list):
        ids.update(str(p) for p in record[field])
    if isinstance(record.get("updates"), list):
        for u in record["updates"]:
            if isinstance(u, dict) and isinstance(u.get(field), list):
                ids.update(str(p) for p in u[field])
    return ids


def _fm_record_photo_ids(record) -> set:
    """Every photo one record points at (_fm_record_evidence_ids)."""
    return _fm_record_evidence_ids(record, "photoIds")


def _fm_referenced_evidence_ids(doc, field: str) -> set:
    """Every evidence id of one kind the document still points at, anywhere."""
    ids = set()
    if not isinstance(doc, dict):
        return ids
    for name in FM_RECORD_COLLECTIONS:
        items = doc.get(name)
        if isinstance(items, list):
            for it in items:
                ids |= _fm_record_evidence_ids(it, field)
    return ids


def _fm_referenced_photo_ids(doc) -> set:
    """Every evidence photo id the document still points at, anywhere."""
    return _fm_referenced_evidence_ids(doc, "photoIds")


# THE FACILITY RECORD'S VOCABULARY: /usr/share/vesta/fm-records.json (the
# roles.json precedent) — a fault's statuses, a cost's categories and the
# record collections, read here AND by the app (src/fm/fmTypes.ts), so the
# words the kiosk writes and the words this server accepts cannot drift apart.
# tests/proxy-rules.py and tests/oracles/fm_records.mjs hold both sides to it.
#
# FAIL CLOSED: unreadable, there are no valid statuses or categories, so every
# new or edited fault and cost is refused as invalid — never everything
# accepted. FM_RECORD_COLLECTIONS above stays a literal ON PURPOSE: an empty
# collection list would make the protected-record and guest-shape guards see
# nothing removed or changed, which fails OPEN. The test pins it to the table.
def _load_fm_records() -> dict:
    return _load_vesta_table("fm-records.json", "every new or edited fault and cost is refused")


FM_RECORDS_TABLE = _load_fm_records()


def _fm_words(key: str) -> tuple:
    """One list of words from the table; anything but a list of strings is none."""
    words = FM_RECORDS_TABLE.get(key) if isinstance(FM_RECORDS_TABLE, dict) else None
    return tuple(words) if isinstance(words, list) and all(isinstance(w, str) for w in words) else ()


FM_TICKET_STATUSES = _fm_words("ticketStatuses")
FM_COST_CATEGORIES = _fm_words("costCategories")


def _fm_record_errors(name: str, record) -> set:
    """What is wrong with one record of collection `name` — empty when valid.

    The rules the app's own code always meets (src/fm/fmEngine.ts), so a
    kiosk write never trips them; they exist for a writer that is not the
    kiosk. Each is a sentence a person can act on."""
    if not isinstance(record, dict):
        return {"is not an object"}
    errors = set()
    if record.get("id") in (None, ""):
        errors.add("has no id")
    if "photoIds" in record and not (isinstance(record["photoIds"], list)
                                     and all(isinstance(p, str) for p in record["photoIds"])):
        errors.add("photoIds is not a list of photo ids")
    if "documentIds" in record and not (isinstance(record["documentIds"], list)
                                        and all(isinstance(p, str) for p in record["documentIds"])):
        errors.add("documentIds is not a list of document ids")
    if name == "tickets":
        if record.get("status") not in FM_TICKET_STATUSES:
            errors.add(f"status is not one of {', '.join(FM_TICKET_STATUSES)}")
        # withTicketPatch / withTicketAdvanced stamp it on the way in; the
        # time-to-resolve figures rest on it.
        if record.get("status") == "resolved" and not (
                isinstance(record.get("resolvedAt"), str) and record["resolvedAt"]):
            errors.add("is resolved with no resolvedAt")
    elif name == "costs":
        amount = record.get("amountIdr")
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) \
                or amount != amount or amount in (float("inf"), float("-inf")) or amount < 0:
            errors.add("amountIdr is not a number of zero or more")
        if record.get("category") not in FM_COST_CATEGORIES:
            errors.add(f"category is not one of {', '.join(FM_COST_CATEGORIES)}")
    elif name == "completions":
        # A completion answers a schedule OR a fault (withTicketAdvanced files
        # scheduleId "" with a ticketId); tied to neither it evidences nothing.
        if not record.get("scheduleId") and not record.get("ticketId"):
            errors.add("is tied to no schedule and no fault")
    return errors


class _FmChange:
    """What one write does to the Facility record. Built by _fm_classify."""
    __slots__ = ("removed", "added", "changed", "dropped_photos", "dropped_documents", "unknown_keys", "invalid")

    def __init__(self):
        self.removed = {}         # {collection: set of ids no longer present}
        self.added = {}           # {collection: [records with a new id]}
        self.changed = {}         # {collection: [ids whose record differs]}
        self.dropped_photos = {}  # {(collection, id): photos a KEPT record lost}
        self.dropped_documents = {}  # {(collection, id): documents a KEPT record lost}
        self.unknown_keys = set() # top-level keys this server does not know, changed
        self.invalid = []         # [(collection, id or "#index", problem)] NEW problems only


def _fm_classify(old, new) -> _FmChange:
    """The one statement of what a write changes. `old` may be anything (an
    unreadable or empty store); `new` is what would be stored."""
    old = old if isinstance(old, dict) else {}
    new = new if isinstance(new, dict) else {}
    ch = _FmChange()
    known = set(FM_RECORD_COLLECTIONS)
    ch.unknown_keys = {k for k in set(old) | set(new) if k not in known and old.get(k) != new.get(k)}
    for name in FM_RECORD_COLLECTIONS:
        before, after = _fm_by_id(old, name), _fm_by_id(new, name)
        ch.removed[name] = set(before) - set(after)
        ch.added[name] = [after[i] for i in after if i not in before]
        ch.changed[name] = [i for i in after if i in before and after[i] != before[i]]
        for i in set(before) & set(after):
            lost = _fm_record_photo_ids(before[i]) - _fm_record_photo_ids(after[i])
            if lost:
                ch.dropped_photos[(name, i)] = lost
            lost = _fm_record_evidence_ids(before[i], "documentIds") - _fm_record_evidence_ids(after[i], "documentIds")
            if lost:
                ch.dropped_documents[(name, i)] = lost
        items = new.get(name, [])
        if not isinstance(items, list):
            if items != old.get(name, []):
                ch.invalid.append((name, "", "is not a list"))
            continue
        # A record without a usable id cannot be addressed, kept or deleted.
        # Judged by count, so one already stored is not held against a write.
        if _fm_idless_count(items) > _fm_idless_count(old.get(name)):
            ch.invalid.append((name, "", "a record is not an object with an id"))
        seen, old_dupes = set(), _fm_duplicate_ids(old.get(name))
        for it in items:
            rid = str(it.get("id")) if isinstance(it, dict) and it.get("id") not in (None, "") else None
            if rid is None:
                continue
            if rid in seen and rid not in old_dupes:
                ch.invalid.append((name, rid, "appears twice"))
            seen.add(rid)
        for rid in [r["id"] for r in ch.added[name]] + ch.changed[name]:
            rid = str(rid)
            new_problems = _fm_record_errors(name, after[rid]) - (
                _fm_record_errors(name, before[rid]) if rid in before else set())
            ch.invalid.extend((name, rid, p) for p in sorted(new_problems))
    return ch


def _fm_idless_count(items) -> int:
    return sum(1 for it in items if not isinstance(it, dict) or it.get("id") in (None, "")) \
        if isinstance(items, list) else 0


def _fm_duplicate_ids(items) -> set:
    seen, dupes = set(), set()
    for it in items if isinstance(items, list) else ():
        if isinstance(it, dict) and it.get("id") not in (None, ""):
            rid = str(it["id"])
            (dupes if rid in seen else seen).add(rid)
    return dupes


def _fm_invalid_response(ch: _FmChange):
    """400 naming the first few new problems, or None."""
    if not ch.invalid:
        return None
    said = "; ".join(f"{n} {i} {p}".replace("  ", " ") for n, i, p in ch.invalid[:5])
    return web.json_response({"error": f"This write would store an invalid Facility record: {said}."},
                             status=400)


# ── the three policies ──────────────────────────────────────────────────────

def _fm_guest_write_ok(old, new) -> bool:
    """True when this write is one a GUEST is allowed to make.

    A guest living in the villa is the person most likely to NOTICE something
    broken, and until now had no way to say so — the Facility workspace is
    owner/ops only, so a broken air-conditioner reached the record only if the
    guest happened to tell someone. Letting them raise a fault closes that,
    but a guest must not be able to edit the maintenance record itself.

    So the rule is not a role, it is the SHAPE of the change: nothing removed,
    nothing edited, no unknown key touched, and only `tickets` may gain
    entries — open reports, marked as a guest's, with no cost, at most
    FM_GUEST_MAX_NEW_TICKETS. Triage, status, cost and resolution stay with
    owner/ops.
    """
    if not isinstance(old, dict) or not isinstance(new, dict):
        return False
    ch = _fm_classify(old, new)
    if ch.unknown_keys or ch.invalid or any(ch.removed.values()) or any(ch.changed.values()):
        return False
    # Records without an id are invisible to the index; a guest's write must
    # leave every collection but tickets exactly as it was, and the existing
    # tickets unchanged and IN PLACE — comparing element-wise also rejects a
    # reordering that hides an edit.
    if any(old.get(n, []) != new.get(n, []) for n in FM_RECORD_COLLECTIONS if n != "tickets"):
        return False
    old_tickets, new_tickets = old.get("tickets") or [], new.get("tickets") or []
    if not isinstance(new_tickets, list) or new_tickets[:len(old_tickets)] != old_tickets:
        return False
    added = new_tickets[len(old_tickets):]
    if not added or len(added) > FM_GUEST_MAX_NEW_TICKETS \
            or len(ch.added["tickets"]) != len(added):
        return False
    # A guest files an OPEN report and cannot pre-resolve it, backdate it, or
    # attach a cost to the villa's accounts. Its one history step is the raising
    # (the app stamps it since 2.496.350): open, and signed as a guest's or not
    # at all — never a step in someone else's name.
    return all(t.get("status") == "open" and t.get("resolvedAt") is None
               and t.get("costId") is None and t.get("reportedBy") == "guest"
               and _fm_guest_steps_ok(t.get("updates")) for t in added)


def _fm_guest_steps_ok(updates) -> bool:
    """A guest report's history: none, or the one raising step — open, no kind, by the Guest profile's name
    (GUEST_LABEL, the role table's) or nobody."""
    if updates is None:
        return True
    return (isinstance(updates, list) and len(updates) <= 1
            and all(isinstance(u, dict) and u.get("status") == "open" and not u.get("kind")
                    and u.get("by") in (None, GUEST_LABEL) and not u.get("who") for u in updates))


def _fm_reader_view(request: web.Request, stored):
    """What this session may READ of the Facility record.

    ⚠️ A GUEST READ EVERYTHING (round 13, 2.496.182). The GET was open to any
    session because a guest's device must write fault reports, and the client
    can only write against a copy it has read — so every guest phone downloaded
    every cost, note, fault and completion in the villa, which the guest report
    dialog itself says a guest must not see. A profile without manageFacility
    now reads an EMPTY record (with the real revision, so its writes still
    carry optimistic concurrency); _fm_writer_merge files what it sends onto
    the real one.
    """
    if _may(_role_for(request), "manageFacility"):
        return stored
    return {name: [] for name in FM_RECORD_COLLECTIONS}


def _fm_writer_merge(request: web.Request, stored, value):
    """A restricted session's write, merged onto the REAL record.

    It read an empty view (_fm_reader_view), so what it sends is that view plus
    its new reports — writing it as-is would erase the villa's record. Only the
    tickets it ADDED (ids the store does not have) are taken, appended after
    the stored ones; _fm_guest_write_ok then judges the merged document exactly
    as before (open, reported by a guest, no cost, at most
    FM_GUEST_MAX_NEW_TICKETS).
    """
    if _may(_role_for(request), "manageFacility") or not isinstance(stored, dict) \
            or not isinstance(value, dict):
        return value
    have = _fm_ids(stored)["tickets"]
    sent = value.get("tickets") if isinstance(value.get("tickets"), list) else []
    added = [t for t in sent if isinstance(t, dict) and str(t.get("id")) not in have]
    merged = dict(stored)
    merged["tickets"] = list(stored.get("tickets") or []) + added
    return merged


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
    # Editing the maintenance record itself needs manageFacility; a role that
    # may only reportFault is a writer of the store, but not of this.
    if not _may(_role_for(request), "manageFacility"):
        if not _fm_guest_write_ok(old, new):
            return _forbidden("A guest may only add a fault report.")
        return None

    ch = _fm_classify(old, new)
    if (bad := _fm_invalid_response(ch)) is not None:
        return bad
    if not any(ch.removed[name] for name in FM_PROTECTED_COLLECTIONS):
        return None                      # nothing destroyed — ordinary write
    if not _configured_superadmin_pin():
        return _forbidden("Deleting records requires the superadmin code, "
                          "which is not configured on this installation.")
    token = body.get("elevation") if isinstance(body, dict) else None
    if not _consume_elevation(token):
        return _forbidden("Deleting a record requires a fresh superadmin "
                          "authorisation for that specific action.")
    return None


def _delete_evidence(photo_id: str, ext: str = ".jpg") -> bool:
    """Remove one evidence file — a JPEG, or a document's page (`ext`, one of FM_EVIDENCE_KINDS) — with the id, the
    kind and the resolved path all checked: this deletes a file from a path built out of stored data."""
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id) or ext not in {e for _, e in FM_EVIDENCE_KINDS}:
        return False
    path = os.path.join(_data(FM_EVIDENCE_NAME), f"{photo_id}{ext}")
    if os.path.realpath(os.path.dirname(path)) != os.path.realpath(_data(FM_EVIDENCE_NAME)):
        return False
    try:
        os.unlink(path)
        return True
    except OSError:
        return False


def _fm_after_write(old, new, baseline_readable: bool = True) -> None:
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
    # ⚠️ NOTHING REFERENCE-BASED RUNS ON A BASELINE WE COULD NOT READ. Steps 1
    # and 2 both answer "does anything still point at this photo?", and both
    # read that answer out of documents. If the stored document was unusable,
    # `old` is an empty stand-in and every photo looks unreferenced — so the
    # sweep would delete exactly the evidence belonging to the records that
    # could not be read. The PUT handler already refuses such a write; this is
    # the second lock on the same door, because the caller is the only thing
    # that knows, and a future third caller will not.
    #
    # Step 3 (retention) still runs: it is time-based, asks no document
    # anything, and is what keeps a villa that stops uploading from growing
    # forever.
    if not baseline_readable:
        _prune_fm_evidence()
        return

    # Every kind of evidence by the same two steps (FM_EVIDENCE_KINDS): a fault the superadmin deletes takes its
    # photos AND its documents with it.
    cutoff = time.time() - FM_EVIDENCE_ORPHAN_GRACE_SECONDS
    try:
        names = os.listdir(_data(FM_EVIDENCE_NAME))
    except OSError:
        names = []
    for field, ext in FM_EVIDENCE_KINDS:
        # a page a kept report names is referenced too: it no longer goes with a ticket (ticket 20 of "One inbox")
        referenced = _fm_referenced_evidence_ids(new, field) | (_report_pages() if ext == ".html" else set())
        # 1. Anything this write dropped a reference to goes immediately: it was
        #    referenced a moment ago, so there is no in-flight form to protect.
        for photo_id in _fm_referenced_evidence_ids(old, field) - referenced:
            _delete_evidence(photo_id, ext)

        # 2. Anything on disk that nothing has EVER referenced and is older than
        #    the grace window — the cancelled-form case.
        for name in names:
            if not name.endswith(ext):
                continue
            photo_id = name[:-len(ext)]
            if photo_id in referenced:
                continue
            path = os.path.join(_data(FM_EVIDENCE_NAME), name)
            try:
                if os.path.getmtime(path) >= cutoff:
                    continue      # still inside the grace window
            except OSError:
                continue
            _delete_evidence(photo_id, ext)

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
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    role = body.get("role")
    pin = body.get("pin")
    # Whitelist validation: role must be one of the three known profiles.
    if role not in AUTH_ROLES:
        return web.json_response({"error": "unknown role"}, status=400)

    configured = _configured_pin(role)
    if not configured:
        # An unset PIN means "this profile isn't available on this path",
        # never "open to anyone who asks" — config.yaml ships all three PINs
        # empty, and before this check an unconfigured owner/ops PIN minted a
        # full-access session for ANY caller. The one exception, a PIN-less
        # guest inside Home Assistant, is _profile_enabled's to make.
        if not _profile_enabled(role, _is_ingress(request)):
            return web.json_response({"error": _profile_disabled_text(role)}, status=403)
        # Grant the session without touching the rate limiter or requiring a
        # pin. (A pin sent anyway is simply ignored.)
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
    if ok:
        _auth_succeeded(role, ip)
    else:
        _auth_failed(role, ip)
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
    previously issued cookies stop verifying — including the caller's own —
    and replaces the signing key, so nothing copied from /data before this
    moment can sign a session either. This is the answer to "a device was
    lost / a PIN was seen"."""
    if (refused := _refuse(request, "administer",
                           "Only the owner profile may sign every device out.")) is not None:
        return refused
    epoch = _bump_session_epoch()
    try:
        _rotate_session_secret()
    except OSError as err:  # the epoch bump above already ended every session
        print(f"[supervisor-proxy] could not rotate the session secret: {err}", flush=True)
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
    uploading e.g. villa_1F_2048.glb over villa_1F.glb. Best-effort:
    a failed sidecar write must never fail the (already completed) upload."""
    original_name = os.path.basename(request.query.get("name", "").strip())[:120]
    if not original_name:
        return
    try:
        atomic_write(
            dest + ".upload.json",
            lambda out: json.dump({
                "original_name": original_name,
                "uploaded_at": datetime.now(timezone.utc)
                               .isoformat(timespec="seconds"),
            }, out),
            binary=False,
        )
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
        # The offset doubles as a sequence check: a MISSING piece (the server
        # holds less than the offset) is refused and the client restarts
        # instead of assembling a corrupt file.
        #
        # ⚠️ HOLDING MORE IS A RETRY, NOT AN ERROR (round 11, 2.496.166). The
        # client re-sends a piece whose reply it never got (postUploadRequest)
        # — the piece may have landed in full, or in part before the
        # connection dropped. This required `have == offset` and appended, so
        # every such retry was a 409 and the upload failed on the very case
        # the retry exists for. The piece is written AT its offset instead:
        # the file is cut back to it first, so re-sending is idempotent.
        try:
            have = os.path.getsize(part)
        except OSError:
            return web.json_response(
                {"error": "unknown upload_id — restart the upload"}, status=409)
        if have < offset:
            return web.json_response(
                {"error": f"offset mismatch (server has {have}, client sent "
                          f"{offset}) — restart the upload"}, status=409)

    # ⚠️ DELIBERATELY NOT atomic_write / atomic_write_async (/dry-audit note).
    # Every other write under /data goes through those two, and this is the one
    # exception: a chunked upload APPENDS across several HTTP requests, while
    # atomic_write takes a single writer callback and completes within one call —
    # it cannot express a file whose content arrives over minutes. The atomicity
    # guarantee is kept by hand and is the same one: all chunks land in `.part`,
    # never at `dest`, and only the final chunk chmods and os.replace()s it into
    # place. A reader therefore sees the old file or the new one, never a
    # half-assembled GLB.
    #
    # Recorded here because a bare `open(..., "ab")` in this file reads exactly
    # like a missed atomic_write, and an audit that re-flags it every time
    # eventually gets someone to "fix" it into something that cannot work.
    # (/dry-audit: adjudicated — this token is what keeps the sweep quiet here.)
    try:
        with open(part, "wb" if offset == 0 else "r+b") as out:
            if offset:
                out.seek(offset)
                out.truncate()
            n = await _stream_upload_body(
                request, out, kind, check_magic=(offset == 0), base=offset)
        if n == 0:
            raise web.HTTPBadRequest(text="empty chunk")
        if not last:
            return web.json_response({"ok": True, "received": offset + n})
        # See the single-shot handler for why 0644 before the atomic replace.
        os.chmod(part, 0o644)
        os.replace(part, dest)
    except web.HTTPException:
        # REFUSED (not a GLB, over the size cap, an empty piece): the upload
        # is over, and its pieces go with it.
        try:
            os.unlink(part)
        except OSError:
            pass
        raise
    # Anything else — the connection dropped mid-piece — keeps the pieces
    # already received: the client's retry re-writes this one at its offset.
    # (Deleting them here turned that retry into "unknown upload_id".) A
    # .part nobody finishes is swept after a day (_sweep_stale_parts).

    _write_upload_sidecar(request, dest)
    rel = os.path.relpath(dest, os.path.realpath(_data(WWW_NAME)))
    return web.json_response({"path": rel, "size": offset + n})


async def model_upload_handler(request: web.Request) -> web.Response:
    """Stream an uploaded GLB or .rooms.json to its central file (atomic overwrite).

    The body is written to a temp file in the destination directory, then
    os.replace()'d over the existing file — so a partial/failed upload never
    corrupts the live model, and a success cleanly erases the previous file.
    With upload_id/offset/last query params the body is one piece of a chunked
    upload instead (files above HA Ingress's ~16 MB per-request cap).
    """
    # manageModel is an owner-only capability in permissions.ts — a
    # guest/ops session could otherwise overwrite the villa model every
    # kiosk loads. (Ingress requests resolve to "owner" — see _role_for.)
    if (refused := _refuse(request, "manageModel",
                           "Only the owner profile may upload a model.")) is not None:
        return refused
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
    rel = os.path.relpath(dest, os.path.realpath(_data(WWW_NAME)))
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
# (label, room, type, category, linked entity, badge colour…), room
# definitions and device groups. Bigger than scenes (one entry per entity, plus
# room polygons), hence the roomier cap — still bounded so a bad body can't
# fill /data. See the frontend's config/deviceConfig.ts for exactly which
# AppConfig fields are shared (site-wide) vs kept per-device (look/feel).
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


def _read_json_store_status(path: str, empty) -> tuple[object, bool]:
    """Parse a shared store, returning (value, readable).

    ⚠️ "ABSENT" AND "UNREADABLE" ARE DIFFERENT ANSWERS, AND CONFLATING THEM
    DESTROYED DATA. Both used to degrade to `empty`, which is right for a store
    that is merely not configured yet — and catastrophic for one the facility
    manager's delete guard diffs against. That guard's whole question is *what
    disappeared*: with `old` forced to empty, every removed-id set came out
    empty, `removed` was falsy, the superadmin elevation requirement evaporated,
    and the write was waved through. The evidence sweep then ran with the same
    empty baseline and deleted every photo the lost records referenced. The
    caller saw {"ok": true}.

    A missing file IS legitimately empty — nothing has been written yet. A file
    that exists and will not parse, or holds the wrong top-level type, is a
    question, and the callers below are the ones that must answer it.
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return empty, True          # never written — genuinely empty
    except (json.JSONDecodeError, OSError):
        return empty, False         # present and unusable — say so
    if not isinstance(data, type(empty)):
        return empty, False         # wrong shape is also unusable
    return data, True


def _read_json_store(path: str, empty):
    """The degrading read, for callers with nothing destructive behind them.

    Kept because a store that can't be read must never take the kiosk down —
    a GET that returns "nothing configured yet" is the right answer for a
    client that is only going to render it. Anything that DELETES on the
    strength of the result must use _read_json_store_status instead."""
    value, _ = _read_json_store_status(path, empty)
    return value


def _write_json_store(path: str, payload: str) -> None:
    """Atomic overwrite (temp file + os.replace) so a partial or failed write
    can never leave the live store truncated — readers either see the whole
    previous version or the whole new one. SYNCHRONOUS: request handlers use
    _write_json_store_async, see there."""
    def _write(out):
        out.write(payload)
    atomic_write(path, _write, binary=False)


async def _write_json_store_async(path: str, payload: str) -> None:
    """_write_json_store on a worker thread. ⚠️ THIS PROCESS HAS ONE EVENT
    LOOP, and it also relays every kiosk's HA websocket frames (lock, cover,
    light). A device-config PUT may carry 8 MB and an fm-data PUT 4 MB; writing
    that inline stalled every relay for the write's duration — "save my
    settings" and "unlock the front door" shared a thread (2.496.196). The
    caller's asyncio.Lock still serialises writes to one store; only the
    blocking part leaves the loop."""
    await asyncio.to_thread(_write_json_store, path, payload)


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


class StoreUnreadable(Exception):
    """The document on disk exists and will not parse (see
    _read_json_store_status): a change cannot be checked against it."""


class StoreTooLarge(Exception):
    """The changed document would exceed the store's byte cap."""


class Veto(Exception):
    """Raised by a change to refuse it; carries the answer for the caller."""

    def __init__(self, response: web.Response):
        super().__init__(response.status)
        self.response = response


class JsonStore:
    """ONE JSON document in the data directory, and everything that makes
    writing it safe: its path (resolved at call time, see DATA_DIR), its lock,
    its revision, its byte cap, the refusal to change a document that cannot be
    read, and the write off the event loop.

    ⚠️ ONE INSTANCE PER FILE, SHARED BY EVERY DOOR THAT OPENS IT. /fm-data and
    /agent/v1/fm-data change the same document; each door used to be handed a
    lock, and two locks on one file is no lock — the read-check-write of one
    door could interleave with the other's. The lock now lives with the file.

    Doors (_store_get_handler, _store_put_handler, and the append door for
    telemetry) decide WHO may do WHAT; this decides nothing
    about callers.
    """

    def __init__(self, name: str, empty, max_bytes: int):
        self.name = name
        self.empty = empty
        self.max_bytes = max_bytes
        self.lock = asyncio.Lock()

    @property
    def path(self) -> str:
        return _data(self.name)

    def read(self):
        """The degrading read — see _read_json_store."""
        return _read_json_store(self.path, self.empty)

    def read_status(self) -> tuple[object, bool]:
        """(value, readable) — see _read_json_store_status."""
        return _read_json_store_status(self.path, self.empty)

    def rev(self) -> str:
        """The revision a conditional write names — see _store_revision."""
        return _store_revision(self.path)

    async def replace(self, value) -> None:
        """Overwrite whole, for a document nobody reads-then-changes (the
        agent's heartbeat). Anything that depends on what is stored uses
        `update`."""
        async with self.lock:
            await _write_json_store_async(self.path, json.dumps(value))

    async def update(self, change, after=None) -> tuple[object, object, str]:
        """Read, change, write — atomically against every other change to
        this file. Returns (stored, new, revision after the write).

        `change(stored)` returns the new document, or raises Veto. Raises
        StoreUnreadable when the stored document cannot be read (nothing is
        written: a change computed against a baseline nobody has would replace
        records unchecked), StoreTooLarge past the byte cap. `after(stored,
        new)` runs once the write has landed, still inside the lock (the
        evidence sweep: a photo it judges orphaned must not be re-referenced
        by a write that has not happened yet). It runs on a worker thread."""
        async with self.lock:
            stored, readable = await asyncio.to_thread(self.read_status)
            if not readable:
                raise StoreUnreadable(self.name)
            new = change(stored)
            payload = json.dumps(new)
            if len(payload.encode("utf-8")) > self.max_bytes:
                raise StoreTooLarge(self.name)
            await _write_json_store_async(self.path, payload)
            if after is not None:
                # On a worker thread too: the evidence sweep lists and deletes
                # files, and this loop relays every kiosk's websocket.
                await asyncio.to_thread(after, stored, new)
            return stored, new, self.rev()


def _store_unreadable_response(key: str) -> web.Response:
    """⚠️ REFUSED, NOT DEGRADED. Every write is computed by the client against a
    document it fetched; if the copy on disk is now unusable, this write's diff
    describes a baseline nobody has. Accepting it silently replaces records the
    guard could not check and orphans the photos they referenced. Failing
    loudly keeps both, and the file is still on disk to recover from — the GET
    degrades to empty on purpose, so a client can still read, re-enter and push
    a whole document once someone has looked."""
    return web.json_response(
        {"error": f"the stored {key} document could not be read, so this "
                  f"write cannot be checked against it. Nothing has been "
                  f"changed or deleted. Check /data for a corrupt file."},
        status=409, headers={"Cache-Control": "no-store"})


def _store_get_handler(store: JsonStore, key: str, what: str, *,
                       capability: str | None = None, view=None, gate=None, tidy=None, published=None):
    """The GET door of one store: `{key: document, "rev": revision}`.

    `capability` gates it (None = any authorized caller — a guest still has to
    read the device config to see the right badges and rooms at all).
    `view(request, stored)` is what THIS caller may read (default: the whole
    document). `gate(request, capability, message)` replaces _refuse for a
    caller that is not a browser session — the VESTA Agent's bearer token
    (_agent_refuse). `tidy(stored)` drops what the store no longer keeps (the
    closed faults past their window, _fm_expire) before anyone sees it.
    `published()` is what the store says ABOUT itself beside the document (the
    Facility record's retention windows, _fm_retention) — never inside it, so
    a client writing its copy back never stores it."""
    gate = gate or _refuse

    async def get_handler(request: web.Request) -> web.Response:
        if (refused := gate(request, capability,
                            f"You do not have permission to read {what}.")) is not None:
            return refused
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
        stored = await asyncio.to_thread(store.read)
        if tidy is not None:
            stored = tidy(stored)
        return web.json_response(
            {key: view(request, stored) if view else stored, "rev": store.rev(), **(published() if published else {})},
            headers={"Cache-Control": "no-store"},
        )

    return get_handler


def _store_put_handler(store: JsonStore, key: str, what: str, *,
                       capability: str = "editConfig", merge=None, guard=None,
                       after=None, view=None, require_rev: bool = False, gate=None, tidy=None):
    """The whole-document PUT door of one store: `{key: document, "rev"?}`.

    `capability` defaults to editConfig — owner-only, because shared state is
    exactly what a non-owner profile must not rewrite for everyone else. The FM
    store asks for reportFault instead, which every profile holds, and its
    guard then confines what a write may contain.

    `merge(request, stored, sent)` turns what a restricted caller sent into
    the document to write; `guard(request, body, stored, new)` then judges the
    merged result and may refuse it by returning a response (a superadmin
    elevation before any record is DELETED); `after(stored, new)` runs once the
    write has landed (the evidence sweep). `tidy(document)` drops what the
    store no longer keeps — from the stored copy AND from what was sent, before
    merge and guard, so an expired record is never a removal a guard judges nor
    one a stale copy brings back (_fm_expire). `view` is applied to the 409 body
    too — a stale write must not be a way to read what a GET withholds.

    PUT optionally carries a `rev` (the revision the caller last read, from
    GET's own response) for optimistic concurrency: villa-kiosk is routinely
    open on several devices at once, and a blind overwrite would let the last
    PUT to arrive silently erase whatever a different device wrote moments
    earlier. A stale `rev` is refused (409) with the current value + revision
    — the caller rebases onto that fresher copy and retries (DeviceConfigSync,
    fm/fmApi). `require_rev` refuses a PUT without one (428): the agent must
    always say which copy it changed.

    ⚠️ TWO STORES ARE DELIBERATELY *NOT* WHOLE-DOCUMENT DOORS, AND CONVERGING
    EITHER ONE WOULD BE A PRIVILEGE BUG, NOT A TIDY-UP (found by /dry-audit,
    2026-08-19):

      * TELEMETRY is the mirror image of this contract. Its WRITE is open to
        any authorized session, because a guest's iPhone going white after an
        app switch is precisely the event worth capturing; its READ is
        owner-only, because the ring carries other people's user-agent strings
        and error text. It appends one event into a bounded ring.
      * EVIDENCE PHOTOS are binary blobs on their own POST/GET pair, streamed
        and content-checked rather than parsed as JSON.

    That role difference was once the excuse for a SECOND, hand-written PUT
    handler for the FM store. Copying the handler copied its auth/validation
    but silently NOT its revision check or its lock, so the FM store had no
    concurrency protection at all while the device-config store did. The
    protections now live in JsonStore.update, which no door can skip.
    """
    gate = gate or _refuse
    owner_only = [r for r in AUTH_ROLES if _may(r, capability)] == ["owner"]
    refusal = (f"Only the owner profile may edit {what}." if owner_only
               else f"You do not have permission to edit {what}.")

    async def put_handler(request: web.Request) -> web.Response:
        if (refused := gate(request, capability, refusal)) is not None:
            return refused
        # any JSON: a store takes its bare value as well as {key: value, rev}
        body = await _json_body(request)
        if isinstance(body, web.Response):
            return body
        sent = body.get(key) if isinstance(body, dict) else body
        if not isinstance(sent, type(store.empty)):
            return web.json_response(
                {"error": f"{key} must be a {type(store.empty).__name__}"}, status=400)
        # Only a STRING rev participates in the concurrency check — see
        # _store_revision. A client sending the old numeric form has already
        # lost precision, so its value could never match; treating it as
        # absent lets those through unconditionally rather than failing them
        # forever.
        raw_rev = body.get("rev") if isinstance(body, dict) else None
        expected_rev = raw_rev if isinstance(raw_rev, str) else None
        if require_rev and expected_rev is None:
            return web.json_response(
                {"error": "rev is required: send the revision you last read"}, status=428)

        def change(stored):
            if tidy is not None:
                stored = tidy(stored)
            if expected_rev is not None and expected_rev != (current := store.rev()):
                # The fresher copy a caller rebases its retry onto — an
                # intermediary caching THIS would be actively harmful, not
                # just stale, hence the explicit no-store.
                raise Veto(web.json_response(
                    {"error": "conflict", key: view(request, stored) if view else stored,
                     "rev": current},
                    status=409, headers={"Cache-Control": "no-store"}))
            new = merge(request, stored, sent) if merge is not None else sent
            if tidy is not None:
                new = tidy(new)
            if guard is not None and (veto := guard(request, body, stored, new)) is not None:
                raise Veto(veto)
            return new

        try:
            _, _, rev = await store.update(change, after)
        except Veto as refused:
            return refused.response
        except StoreUnreadable:
            return _store_unreadable_response(key)
        except StoreTooLarge:
            return web.json_response({"error": f"{key} payload too large"}, status=413)
        return web.json_response({"ok": True, "rev": rev})

    return put_handler


# ── Telemetry ────────────────────────────────────────────────────────────────
# A bounded, append-only ring of events reported BY the clients (load timings,
# JS errors, WebGL context loss, iOS background/restore). Exists because the
# failures that matter here only ever reproduce on someone else's device — an
# iPhone in another country going white after an app switch is not something
# any amount of local testing finds. Kept deliberately small and dumb: newest
# N events in one JSON file, no rotation logic, no index, no PII beyond the
# user-agent the browser already sends on every request.
TELEMETRY_MAX_BODY = 64_000
# The ring is bounded by COUNT (telemetry_max_events, up to 5000) AND by
# serialised size: at the count ceiling alone, 5000 x 64 kB events made a
# ~320 MB file that every POST re-read and rewrote whole (2.496.196).
TELEMETRY_MAX_RING_BYTES = 2_000_000
# The ring trims itself to the byte cap, so the store's own cap (a refusal) is
# only ever reached by one event over it — which TELEMETRY_MAX_BODY refuses
# first. The store's lock is what keeps two POSTs from each appending to the
# same old ring and one event being lost.
TELEMETRY = JsonStore("telemetry.json", [], TELEMETRY_MAX_RING_BYTES + TELEMETRY_MAX_BODY)


def _telemetry_ring_after(events: list, max_events: int, max_bytes: int) -> list:
    """The ring to keep: the newest `max_events`, then the newest that fit in
    `max_bytes` once serialised. Pure — tests/proxy-rules.py drives it."""
    kept = events[-max_events:] if max_events > 0 else []
    while len(kept) > 1 and len(json.dumps(kept).encode("utf-8")) > max_bytes:
        # Halve the excess per step rather than one event per step: a ring
        # far over the cap (a raised ceiling later lowered) trims in a few
        # passes, not thousands of full serialisations.
        drop = max(1, len(kept) // 8)
        kept = kept[drop:]
    return kept


def _csp_event(r: dict) -> dict:
    """A browser's Content-Security-Policy violation report, as a telemetry
    event. The policy ships Report-Only (snippets/csp.conf) and until 2.496.207
    reported to nowhere; `report-uri telemetry` now sends each violation here.
    Only the fields that say what was blocked and where are kept, each capped
    — the report body is written by the browser, but its values (the blocked
    URL, the document) are whatever the page held."""
    def text(key: str, cap: int) -> str:
        return str(r.get(key) or "")[:cap]
    line = r.get("line-number")
    return {
        "kind": "csp",
        "directive": text("effective-directive", 120) or text("violated-directive", 120),
        "blocked": text("blocked-uri", 300),
        "source": text("source-file", 300),
        "line": line if isinstance(line, int) and not isinstance(line, bool) else None,
        "document": text("document-uri", 300),
    }


async def telemetry_post_handler(request: web.Request) -> web.Response:
    """Append one client event. Open to ANY authorized session (a guest's
    iPhone failing is exactly the case worth capturing), unlike the owner-only
    config stores. Silently bounded so a looping client can't fill /data."""
    if (refused := _refuse(request)) is not None:
        return refused
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    if isinstance(body.get("csp-report"), dict):
        body = _csp_event(body["csp-report"])
    if len(json.dumps(body).encode("utf-8")) > TELEMETRY_MAX_BODY:
        return web.json_response({"error": "event too large"}, status=413)

    # Server-stamped fields win over anything the client sent, so a bad/spoofed
    # client can't forge them.
    body["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    body["ua"] = request.headers.get("User-Agent", "")[:300]
    body["role"] = _role_for(request)

    max_events = _telemetry_max_events()
    try:
        _, ring, _ = await TELEMETRY.update(lambda events: _telemetry_ring_after(
            events + [body], max_events, TELEMETRY_MAX_RING_BYTES))
    except StoreUnreadable:
        # A corrupt ring is diagnostics, not a record: start a fresh one
        # rather than lose every event from here on.
        ring = [body]
        await TELEMETRY.replace(ring)
    return web.json_response({"ok": True, "stored": len(ring)})


async def telemetry_get_handler(request: web.Request) -> web.Response:
    """Read the ring back (owner only — it carries other people's user-agents
    and error text). `?clear=1` empties it after reading."""
    if (refused := _refuse(request, "administer",
                           "Only the owner profile may read telemetry.")) is not None:
        return refused
    if request.query.get("clear") == "1":
        try:
            events, _, _ = await TELEMETRY.update(lambda _events: [])
        except StoreUnreadable:
            events = []
            await TELEMETRY.replace(events)
    else:
        events = await asyncio.to_thread(TELEMETRY.read)
    return web.json_response(
        {"events": events, "count": len(events)}, headers={"Cache-Control": "no-store"})


# ── Facility Manager data + photo evidence ───────────────────────────────────
# One store holds the whole FM working set (maintenance schedules, completions,
# cost entries, fault tickets). It is a single JSON document rather than four
# because every write comes from one operator on one device at a time, and an
# atomic whole-document replace is far easier to reason about than four stores
# that can disagree with each other mid-edit.
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
FM_EVIDENCE_NAME = "fm-evidence"
FM_EVIDENCE_MAX_BYTES = 3_000_000     # generous headroom over a downscaled JPEG
# Evidence age limit: the owner's setting in Advanced Settings, 365 days by
# default (one year of history). See _evidence_retention_days().
FM_EVIDENCE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
# How long an unreferenced photo is kept before it is treated as garbage. It
# exists solely to cover the gap between "uploaded" and "saved": the client
# uploads a photo the moment it is picked, and the record referencing it is
# not written until the operator presses Save. A form left open over lunch
# must not have its attachments deleted underneath it.
FM_EVIDENCE_ORPHAN_GRACE_SECONDS = 12 * 3600
_JPEG_MAGIC = b"\xff\xd8\xff"
# A document (FM_EVIDENCE_KINDS): one self-contained HTML page the VESTA Agent made (an investigation report, ~60 KB:
# its style and charts inline, nothing fetched). The cap is the photo's: generous, and never a way to fill /data.
FM_DOCUMENT_MAX_BYTES = 3_000_000
_HTML_MAGIC = b"<!doctype html"
# ⚠️ A DOCUMENT IS SERVED SANDBOXED (2.496.326). It is HTML from another program, served from the kiosk's own origin —
# where the session cookie and every route live. `sandbox` without allow-scripts gives it a unique origin and no
# script at all; nothing may be fetched (default-src 'none'): only its inline style and data: images (the page's icon,
# its charts are inline SVG). A page made wrong, or by a token that leaked, can show text and nothing else.
FM_DOCUMENT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"


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
        for name in os.listdir(_data(FM_EVIDENCE_NAME)):
            path = os.path.join(_data(FM_EVIDENCE_NAME), name)
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
    # Guests too: a photo of the cracked panel is the most useful thing a
    # guest can contribute, and is worthless if they cannot attach it. What a
    # guest may then DO with it stays narrow — see _fm_guest_write_ok.
    if (refused := _refuse(request, "reportFault",
                           "You do not have permission to add evidence.")) is not None:
        return refused
    return await _store_evidence(request)


async def _store_evidence(request: web.Request, ext: str = ".jpg") -> web.Response:
    """The upload itself, for whichever door let the caller in: the app's
    (/fm-evidence) or the VESTA Agent's (/agent/v1/fm-evidence, /agent/v1/fm-document). Same id rule,
    size cap, type check and atomic write for every kind — one copy of the checks. `ext`: .jpg a photo, .html a
    document (FM_EVIDENCE_KINDS)."""
    photo_id = request.query.get("id", "")
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id) or ext not in {e for _, e in FM_EVIDENCE_KINDS}:
        return web.json_response({"error": "bad photo id"}, status=400)
    limit = FM_DOCUMENT_MAX_BYTES if ext == ".html" else FM_EVIDENCE_MAX_BYTES

    os.makedirs(_data(FM_EVIDENCE_NAME), exist_ok=True)
    dest = os.path.join(_data(FM_EVIDENCE_NAME), f"{photo_id}{ext}")
    if os.path.realpath(os.path.dirname(dest)) != os.path.realpath(_data(FM_EVIDENCE_NAME)):
        return web.json_response({"error": "bad path"}, status=400)

    body = bytearray()
    async for chunk in request.content.iter_chunked(64 * 1024):
        body.extend(chunk)
        if len(body) > limit:
            return web.json_response({"error": "photo too large" if ext == ".jpg" else "document too large"}, status=413)
    # Same defence as the GLB upload: validate the stream head so this endpoint
    # can't be used to publish an arbitrary file type into /data.
    if ext == ".jpg" and not bytes(body).startswith(_JPEG_MAGIC):
        return web.json_response({"error": "not a JPEG"}, status=400)
    if ext == ".html" and not bytes(body).lstrip()[:len(_HTML_MAGIC)].lower() == _HTML_MAGIC:
        return web.json_response({"error": "not an HTML page"}, status=400)

    # Was a hand-rolled temp-then-replace using a PREDICTABLE "<dest>.part"
    # path and no failure cleanup: two concurrent posts of the same id raced
    # each other through the same temp file, an existing file/symlink at that
    # path was inherited rather than refused, and any exception mid-write
    # orphaned the .part in /data permanently. atomic_write has none of those
    # (fresh mkstemp name, cleanup on every failure path) and is the same
    # primitive the model upload and the JSON stores use.
    await asyncio.to_thread(atomic_write, dest, lambda out: out.write(body))
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
    if (refused := _refuse(request, "manageFacility",
                           "Only the owner and facility-manager profiles may view evidence.")) is not None:
        return refused
    photo_id = request.match_info.get("id", "")
    if not FM_EVIDENCE_ID_RE.fullmatch(photo_id):
        return web.json_response({"error": "bad photo id"}, status=400)
    path = os.path.join(_data(FM_EVIDENCE_NAME), f"{photo_id}.jpg")
    if not os.path.isfile(path):
        return web.json_response({"error": "not found"}, status=404)
    return web.FileResponse(path, headers={
        # Content-addressed by a random id that is never reused, so this can be
        # cached hard — an evidence photo never changes once written.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Type": "image/jpeg",
    })


async def fm_document_get_handler(request: web.Request) -> web.StreamResponse:
    """Serve one document of a fault (an investigation report) — owner and facility manager only, as a photo is, and
    sandboxed (FM_DOCUMENT_CSP): it opens on the iPad from the fault's card, offline, and can run nothing."""
    if (refused := _refuse(request, "manageFacility",
                           "Only the owner and facility-manager profiles may view evidence.")) is not None:
        return refused
    doc_id = request.match_info.get("id", "")
    if not FM_EVIDENCE_ID_RE.fullmatch(doc_id):
        return web.json_response({"error": "bad document id"}, status=400)
    path = os.path.join(_data(FM_EVIDENCE_NAME), f"{doc_id}.html")
    if os.path.realpath(os.path.dirname(path)) != os.path.realpath(_data(FM_EVIDENCE_NAME)) or not os.path.isfile(path):
        return web.json_response({"error": "not found"}, status=404)
    return web.FileResponse(path, headers={
        "Cache-Control": "private, max-age=31536000, immutable",      # a random id, never reused: never changes
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": FM_DOCUMENT_CSP,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    })


DEVICE_CONFIG = JsonStore("device-config.json", {}, DEVICE_CONFIG_MAX_BYTES)
device_config_get_handler = _store_get_handler(
    DEVICE_CONFIG, "config", "device configuration")
device_config_put_handler = _store_put_handler(
    DEVICE_CONFIG, "config", "device configuration")
# Facility Manager working set — a whole-document store like the device
# config, so it gets the same revision check, lock and validation. The only
# difference is who may write it. /agent/v1/fm-data opens the SAME store.
FM_DATA = JsonStore("fm-data.json", {}, FM_DATA_MAX_BYTES)
fm_data_get_handler = _store_get_handler(
    FM_DATA, "data", "facility manager data", view=_fm_reader_view, tidy=_fm_expire, published=_fm_retention)
fm_data_put_handler = _store_put_handler(
    FM_DATA, "data", "facility manager data",
    # "guest" is admitted at the ROLE gate but constrained by the write guard
    # to appending a fault report (see _fm_guest_write_ok) — the role check
    # alone would be far too broad. Everything else about the maintenance
    # record stays owner/ops.
    capability="reportFault", view=_fm_reader_view, merge=_fm_writer_merge,
    guard=_fm_write_guard, after=_fm_after_write, tidy=_fm_expire)


# ══ The VESTA Agent interface v1 ═════════════════════════════════════════════
# docs/agent-integration/PLAN.md, workstream A. The VESTA Agent is an OUTSIDE
# client (F1) that always starts the exchange (F2): this add-on never calls it
# and needs no address for it. Everything is under /agent/v1, JSON, and gated
# by one bearer token — the `agent_token` option. Empty token: every route
# answers 404 and the rest of the kiosk behaves exactly as before (F8).
#
# The VESTA Kiosk OWNS this contract. The agent host's self-test checks
# `contract: 1` on /agent/v1/info; a change a v1 client cannot survive is a
# new version, not an edit to this one.

AGENT = "agent"
#: THE AGREEMENT WITH THE AGENT: /usr/share/vesta/agent-contract.json (the
#: roles.json precedent) — version, the fault's shape, the entity-id pattern,
#: read here, by the app, and by the agent host's copy (its CI compares the
#: two). FAIL CLOSED: unreadable, the agent door answers nothing (version 0,
#: no entity id passes). Its message channel (/agent/v1/messages, /choices, and
#: the Kiosk's agent window) was removed in 2.496.445: the agent never used it —
#: people talk to it on Telegram (decision D4, 2026-09-30).
def _load_agent_contract() -> dict:
    return _load_vesta_table("agent-contract.json", "the agent interface refuses every request")


AGENT_CONTRACT_TABLE = _load_agent_contract()
AGENT_CONTRACT = int(AGENT_CONTRACT_TABLE.get("version") or 0)
#: Its settings are rows of OPTIONS: `agent_enabled` (THE switch, above the
#: group on the page) and the `vesta_agent.*` fields.
#: An entity id as the agent may name one (kiosk-rooms, villa-model): checked before an id reaches a template.
AGENT_ENTITY_RE = re.compile(AGENT_CONTRACT_TABLE.get("entityPattern") or r"(?!)")
#: What every Facility record the agent creates or changes carries (PLAN F6) — the agreement's `ticket` (the agent tells
#: its own steps from a person's by them: declared once, architecture review 2026-10-15). Unreadable agreement: the
#: words this server always wrote, so a stamp never goes missing.
_AGENT_TICKET = AGENT_CONTRACT_TABLE.get("ticket") or {}
AGENT_SOURCE = str(_AGENT_TICKET.get("source") or "vesta_agent")
AGENT_NAME = str(_AGENT_TICKET.get("agentStamp") or "VESTA Agent")
AGENT_PRESENCE = JsonStore("agent-presence.json", {}, 10_000)

#: This add-on's own version, for /agent/v1/info. Read once from the Supervisor
#: at start-up (_learn_own_version); the image deliberately does not carry it
#: (see the Dockerfile's LABEL note).
_own_version = "unknown"


def _agent_token() -> str:
    """The configured token, or "" when the agent interface is off.

    ⚠️ THE SWITCH FIRST (`enabled`, default off). A token alone used to be the
    switch; the owner asked for an explicit one, so "is there an agent" is a
    yes/no a person sets — and a token left in the field while the switch is
    off opens nothing. Only `True` counts: a hand-edited "yes" is not a yes."""
    return opt("vesta_agent.token") if opt("agent_enabled") else ""


def _agent_config_warning() -> str | None:
    """What the log says at start when the switch is on and the token cannot
    be used — the Supervisor's form cannot make the token required only while
    the switch is on, so this is where "required" is enforced."""
    if not opt("agent_enabled") or _agent_token():
        return None
    return ("the VESTA Agent is switched on but its token is empty or invalid "
            "(at least 16 characters: letters, digits and . _ ~ + / = -): "
            "the agent stays off until one is set")


def _agent_offline_minutes() -> int:
    return opt("vesta_agent.offline_after_minutes")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _iso_epoch(value) -> float | None:
    """An ISO-8601 timestamp as epoch seconds, or None if it is not one."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _agent_refuse(request: web.Request, capability: str | None = None,
                  message: str = "forbidden") -> web.Response | None:
    """The gate at the top of every /agent/v1 handler — _refuse's twin for a
    caller that is not a browser.

    404 while no token is configured: the interface does not exist, and says
    nothing about why. Otherwise `Authorization: Bearer <agent_token>`,
    compared in constant time.

    ⚠️ A WRONG OR MISSING TOKEN COUNTS TOWARD THE SAME LOCKOUT AS A WRONG
    PASSCODE (PLAN A3): per source address, with the global rate as the
    backstop, in the agent's own bucket so it can never lock a profile out.

    ⚠️ NEVER A COOKIE, NEVER INGRESS. A signed-in browser, or Home Assistant's
    own Ingress, gets no further here than anyone else without the token —
    this door is the agent's alone, and _authorized() (the kiosk's door) in
    turn never looks at the token.
    """
    configured = _agent_token()
    if not configured:
        return web.json_response({"error": "not found"}, status=404)
    ip = _client_ip(request)
    retry_after = _lockout_remaining(AGENT, ip)
    if retry_after > 0:
        return web.json_response({"error": "locked", "retryAfter": retry_after}, status=429)
    header = request.headers.get("Authorization", "")
    sent = header[7:].strip() if header[:7].lower() == "bearer " else ""
    if not sent or not hmac.compare_digest(sent.encode(), configured.encode()):
        _auth_failed(AGENT, ip)
        return _unauthorized()
    _auth_succeeded(AGENT, ip)
    if capability is not None and not _may(AGENT, capability):
        return _forbidden(message)
    return None


# ── Facility records written by the agent (PLAN A5) ─────────────────────────

def _fm_agent_merge(request: web.Request, stored, value):
    """Stamp every record the agent created or changed (PLAN A5, F6).

    ⚠️ STAMPED HERE, NOT TRUSTED FROM THE AGENT. `source: "vesta_agent"` is
    what the Kiosk shows as "By VESTA Agent", and a marker the writer sets
    itself is a marker the writer can forget. A record the agent sends back
    exactly as it read it is left untouched — reading and re-saving the
    document must not claim every record in the villa.
    """
    if not isinstance(stored, dict) or not isinstance(value, dict):
        return value
    now = _now_iso()
    out = dict(value)
    for name in FM_RECORD_COLLECTIONS:
        items = value.get(name)
        if not isinstance(items, list):
            continue
        before = _fm_by_id(stored, name)
        stamped = []
        for it in items:
            old = before.get(str(it.get("id"))) if isinstance(it, dict) else None
            if not isinstance(it, dict) or it.get("id") is None or old == it:
                stamped.append(it)
                continue
            it = dict(it, source=AGENT_SOURCE, updatedAt=now)
            if name == "completions":
                it["by"] = AGENT_NAME
            if name == "tickets" and isinstance(it.get("updates"), list):
                prior = len(old.get("updates") or []) if isinstance(old, dict) else 0
                it["updates"] = [
                    dict(u, by=u.get("by") or AGENT_NAME)
                    if i >= prior and isinstance(u, dict) else u
                    for i, u in enumerate(it["updates"])]
            stamped.append(it)
        out[name] = stamped
    return out


def _fm_agent_write_guard(request: web.Request, body, old, new):
    """What the agent may NOT do to the Facility record (PLAN A5, F6).

    It may read, create and update records. It may never remove one: a whole
    document that omits a record IS a delete, so the rule is on the shape of
    the change, like the guest's. There is no elevation path for the agent —
    the superadmin code is a person's.

    ⚠️ NOR MAY IT DROP A PHOTO FROM A RECORD IT KEEPS. _fm_after_write deletes
    a photo file the moment nothing references it, so removing a photo id is a
    delete of evidence by another name — the loophole the plan's "the agent
    cannot delete, so cannot orphan photos" did not see.
    """
    ch = _fm_classify(old, new)
    if ch.unknown_keys:
        return _forbidden(f"The VESTA Agent may not change `{sorted(ch.unknown_keys)[0]}`.")
    if (bad := _fm_invalid_response(ch)) is not None:
        return bad
    if any(ch.removed.values()):
        what = ", ".join(f"{len(v)} from {n}" for n, v in ch.removed.items() if v)
        return _forbidden(f"The VESTA Agent may not delete Facility records (this write "
                          f"removes {what}). Deleting stays with people.")
    if ch.dropped_photos:
        name, rid = sorted(ch.dropped_photos)[0]
        return _forbidden(f"The VESTA Agent may not remove photos from a record "
                          f"({name} {rid}): that would delete the evidence.")
    if ch.dropped_documents:
        name, rid = sorted(ch.dropped_documents)[0]
        return _forbidden(f"The VESTA Agent may not remove documents from a record "
                          f"({name} {rid}): that would delete the evidence.")
    return None


agent_fm_get_handler = _store_get_handler(
    FM_DATA, "data", "the Facility records", capability="agentRead", gate=_agent_refuse, tidy=_fm_expire)
agent_fm_put_handler = _store_put_handler(
    FM_DATA, "data", "the Facility records", capability="agentWrite",
    merge=_fm_agent_merge, guard=_fm_agent_write_guard, after=_fm_after_write,
    require_rev=True, gate=_agent_refuse, tidy=_fm_expire)


async def agent_fm_evidence_handler(request: web.Request) -> web.Response:
    """Attach a photo: the same checks and limits as the app's upload."""
    if (refused := _agent_refuse(request, "agentWrite")) is not None:
        return refused
    return await _store_evidence(request)


async def agent_fm_document_handler(request: web.Request) -> web.Response:
    """Store one HTML page: a fault's (the investigation report a person asked to keep with it: owner, 2026-10-11),
    referenced by its documentIds and deleted with it (_fm_after_write); or a report's (ticket 20 of "One inbox"), named
    by a kept VESTA message's `page` and kept while that message is (_report_pages), then the records-kept days."""
    if (refused := _agent_refuse(request, "agentWrite")) is not None:
        return refused
    return await _store_evidence(request, ".html")


# ── Presence (PLAN A7) ───────────────────────────────────────────────────────

async def agent_heartbeat_handler(request: web.Request) -> web.Response:
    """The agent says it is alive, with an optional status text.

    ⚠️ PERSISTED, SO A RESTART NEVER SHOWS A FALSE "ONLINE". Presence is
    computed from the last heartbeat's time on every read; an in-memory flag
    would come back from a restart either stale or wrong."""
    if (refused := _agent_refuse(request, "agentPresence")) is not None:
        return refused
    status = cadence = None
    if request.can_read_body:
        # any JSON: a beat whose body is not an object still counts (no status, no cadence)
        body = await _json_body(request)
        if isinstance(body, web.Response):
            return body
        status = body.get("status") if isinstance(body, dict) else None
        if status is not None and (not isinstance(status, str) or len(status) > 200):
            return web.json_response({"error": "status must be a string of at most 200 characters"},
                                     status=400)
        cadence = body.get("cadence") if isinstance(body, dict) else None
    # ⚠️ A MALFORMED CADENCE NEVER REFUSES THE BEAT (owner, 2026-10-19). It answered 400 before the beat was recorded,
    # so a running Agent whose timing had one wrong field showed Offline for good. The beat counts; the timing is
    # dropped (stored null: the Kiosk then gives no number), logged once, and the answer says why.
    why = _agent_cadence_problem(cadence) if cadence is not None else None
    await AGENT_PRESENCE.replace({"last_seen": time.time(), "status": status,
                                  "cadence": _agent_cadence(cadence)})
    answer = {"ok": True, "offline_after_minutes": _agent_offline_minutes(),
              "unavailableByDesign": _unavailable_by_design()}
    global _CADENCE_REFUSAL_LOGGED
    if why is not None:
        answer["cadence"] = f"refused: {why}"
        if _CADENCE_REFUSAL_LOGGED != why:
            print(f"[supervisor-proxy] agent heartbeat: cadence dropped ({why}); the beat still counts", flush=True)
            _CADENCE_REFUSAL_LOGGED = why
    else:
        _CADENCE_REFUSAL_LOGGED = None
    return web.json_response(answer)


def _unavailable_by_design() -> list[str]:
    """The villa's devices asleep by design (device-config.json `unavailableByDesign`, picked in Advanced Settings ›
    Devices): their "unavailable" is normal, and the VESTA Agent skips its offline checks for them (agent-contract.json
    `heartbeat.answer`). ⚠️ THE KIOSK OWNS THE LIST (owner, 2026-10-21): the Kiosk is always installed, the Agent may
    not be — the Agent reads it in every heartbeat's answer. Entity ids only (AGENT_ENTITY_RE), each once, sorted; an
    unreadable or absent setting is an empty list, never a refused beat."""
    cfg = DEVICE_CONFIG.read()
    raw = cfg.get("unavailableByDesign") if isinstance(cfg, dict) else None
    return sorted({e for e in raw if isinstance(e, str) and AGENT_ENTITY_RE.fullmatch(e)}) if isinstance(raw, list) else []


#: The last malformed-cadence reason logged — one line per new reason, not one per beat (every few minutes).
_CADENCE_REFUSAL_LOGGED: str | None = None


def _agent_cadence_problem(value) -> str | None:
    """Why a heartbeat's `cadence` is not agent-contract.json's shape, or None when it is (_agent_cadence's rule)."""
    if not isinstance(value, dict):
        return "cadence must be an object {checkMinutes, nightlyAt}"
    minutes, nightly = value.get("checkMinutes"), value.get("nightlyAt")
    if not (isinstance(minutes, int) and not isinstance(minutes, bool) and 1 <= minutes <= 1440):
        return "checkMinutes must be a whole number 1-1440"
    if not (isinstance(nightly, str) and _HHMM.fullmatch(nightly)):
        return "nightlyAt must be HH:MM"
    return None


#: A villa time as the heartbeat's cadence says it.
_HHMM = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")


def _agent_cadence(value) -> dict | None:
    """The agent's own timing as its heartbeat says it (agent-contract.json `heartbeat.cadence`), or None when it is
    not that shape. ⚠️ THE AGENT'S CLOCK, TOLD — NOT COPIED (architecture review, 2026-10-15): the Overview's (i) said
    "checks every 5 minutes, nightly check at 02:00" whatever the villa had set. Only these three are kept: anything else
    an older Agent sends is dropped, never refused."""
    if _agent_cadence_problem(value) is not None:
        return None
    # when its look last started (owner, 2026-10-21: the Next check's time moved every minute, "now + 5 min"): kept
    # only as a moment that parses; anything else is dropped like any other key
    look = value.get("lastLookAt")
    return {"checkMinutes": value["checkMinutes"], "nightlyAt": value["nightlyAt"],
            **({"lastLookAt": look} if isinstance(look, str) and len(look) <= 40 and _iso_epoch(look) is not None else {})}


def _agent_presence() -> dict:
    """not_configured / offline / online, from the token and the last heartbeat.

    ⚠️ THE CADENCE ONLY WHILE ONLINE (architecture review, 2026-10-19): the last heartbeat's stored timing was answered
    whatever the state, so every card read "Next check: within 5 min" and the (i) "it checks every 5 minutes" days
    after the Agent had stopped. ONE owner of "is there a clock": an offline Agent has none (null), and the Kiosk then
    says "by the VESTA Agent" / "it checks regularly" on its own."""
    if not _agent_token():
        return {"state": "not_configured"}
    minutes = _agent_offline_minutes()
    doc = AGENT_PRESENCE.read()
    last = doc.get("last_seen") if isinstance(doc, dict) else None
    last = float(last) if isinstance(last, (int, float)) else None
    online = last is not None and 0 <= time.time() - last < minutes * 60
    return {
        "state": "online" if online else "offline",
        "last_seen": datetime.fromtimestamp(last, timezone.utc).isoformat(timespec="seconds")
        .replace("+00:00", "Z") if last else None,
        "status": doc.get("status") if isinstance(doc, dict) else None,
        "cadence": _agent_cadence(doc.get("cadence")) if online and isinstance(doc, dict) else None,
        "offline_after_minutes": minutes,
    }


async def agent_status_handler(request: web.Request) -> web.Response:
    """The Kiosk's view of the agent, for owner and facility manager."""
    if (refused := _refuse(request, "viewAgent")) is not None:
        return refused
    return web.json_response(_agent_presence(), headers={"Cache-Control": "no-store"})


# ── The villa's announcements (ha-commands.json `announcement`) ─────────────
# What the villa's automations announce — the doorbell, an alarm, the weekly test — as the one event they fire beside
# their Telegram message. ⚠️ ONE LISTENER, AND IT IS THIS PROCESS (owner, 2026-10-28, "One inbox"): not each page,
# which would lose what arrived while no tablet was open and would have to hear the bus event itself (a guest session
# relayed a raw bus event is the leak 2.496.556 closed); not the VESTA Agent, so a ring reaches the tablet with the
# Agent stopped. Kept for the villa's records-kept days, like the Facility record; a page reads the store, and waits on
# it for the next one (ANNOUNCEMENT_WAIT_S), so the event type never joins the non-owner `events` list.
ANNOUNCEMENT_EVENT = str(HA_COMMANDS.get("announcement") or "")
#: One announcement's finished text, at most (the layout's HTML; a Telegram message is 4096 characters).
ANNOUNCEMENT_TEXT_MAX = 16_000
ANNOUNCEMENTS_MAX_BYTES = 2_000_000
class Feed:
    """A numbered list the add-on keeps for every page, and wakes them on (review Q 4, 2026-10-28): each record one
    `seq` above the last, tidied under its store's lock (`tidy`: what is still kept; `after`: run once a write landed,
    a photo sweep), read whole or after a page's last, a read held open until the next one comes. ⚠️ ONE PLACE for the
    numbering, the tidying, the waking and the answer to a page whose store started again: the announcements are its
    first kind; the reports and VESTA's conversation (tickets 20-21 of "One inbox") bring only their record, their
    merge and their tidy."""

    def __init__(self, store: "JsonStore", tidy, after=None):
        self.store, self.tidy, self.after = store, tidy, after
        # ⚠️ THE LAST NUMBER GIVEN, KEPT APART (review Q round 2): numbered from what is stored, a store tidied empty
        # (every record past the records-kept days) started again at 1, and an open page took the next one for a store
        # started again and showed it as no news. Only a reinstall (both files gone) starts again.
        self.mark = JsonStore(f"{store.name.removesuffix('.json')}-last.json", 0, 64)
        # set when one is kept, then replaced: a read waits on the one current when it read
        self._kept = asyncio.Event()

    def _last(self, items: list) -> int:
        """The last number given: the highest kept, or the mark when every one since was tidied away."""
        mark = self.mark.read()
        return max([a["seq"] for a in items if isinstance(a, dict) and isinstance(a.get("seq"), int)]
                   + [mark if isinstance(mark, int) else 0])

    def items(self) -> list:
        """What is kept now (tidied, records with a number only). Blocking: called on a worker thread."""
        return self.tidy(self.store.read())

    async def add(self, make, merge=lambda stored, rec: stored + [rec]) -> dict:
        """Keep the record `make(seq)` makes, numbered one above the last, `merge`d into what is kept (one line per
        key, for the announcements), and wake every page waiting for it."""
        made: dict = {}

        def change(stored):
            stored = stored if isinstance(stored, list) else []
            made["rec"] = make(self._last(stored) + 1)
            return self.tidy(merge(stored, made["rec"]))

        try:
            await self.store.update(change, after=self.after)
        except StoreUnreadable:
            # Not a record anyone else writes: a corrupt file starts again rather than lose every one from here on,
            # numbered on from the mark (the pages hold numbers up to it).
            made["rec"] = make(self._last([]) + 1)
            await self.store.replace([made["rec"]])
        await self.mark.replace(made["rec"]["seq"])
        woken, self._kept = self._kept, asyncio.Event()
        woken.set()
        return made["rec"]

    async def remove(self, seq: int) -> bool:
        """Remove the record numbered `seq` (a superadmin's erase, message_erase_handler); whether one was kept. Every
        page waiting is woken: its next read names what is still kept, so it drops the record too."""
        hit: dict = {}

        def change(stored):
            stored = stored if isinstance(stored, list) else []
            left = [a for a in stored if not (isinstance(a, dict) and a.get("seq") == seq)]
            hit["was"] = len(left) < len(stored)
            return self.tidy(left)

        await self.store.update(change, after=self.after)
        if hit.get("was"):
            woken, self._kept = self._kept, asyncio.Event()
            woken.set()
        return bool(hit.get("was"))

    async def read(self, after: int | None, wait_s: float) -> tuple[list, int, int]:
        """(the records after `after` — all with None —, the last number given, and the FIRST still kept: a page drops
        what it holds below it, so a tablet left on lists exactly what the add-on keeps, never a record tidied away
        long ago — review Q round 2). With `after`, an answer with nothing waits up to `wait_s` for the next one. A
        last number below the page's own means the store started again (a reinstall): answered at once, so the page
        reads it whole."""
        def answer() -> tuple[list, int, int, bool]:
            stored = self.store.read()
            items = self.tidy(stored)
            last = self._last(items)
            first = min((a["seq"] for a in items), default=last + 1)
            pruned = isinstance(stored, list) and len(items) < len(stored)
            return [a for a in items if after is None or a["seq"] > after], last, first, pruned

        # Taken BEFORE the read: one kept between the read and the wait has already set this event, never a newer one.
        kept = self._kept
        items, last, first, pruned = await asyncio.to_thread(answer)
        if pruned:
            # Past what is kept (the records-kept days): deleted now, under the store's lock, not at the next one (a
            # "keep for ever" set afterwards must not bring them back).
            try:
                await self.store.update(self.tidy, after=self.after)
            except (StoreUnreadable, StoreTooLarge, OSError):
                pass
        if after is not None and not items and last >= after:
            try:
                await asyncio.wait_for(kept.wait(), wait_s)
            except asyncio.TimeoutError:
                pass
            items, last, first, _ = await asyncio.to_thread(answer)
        return items, last, first


ANNOUNCEMENTS = JsonStore("announcements.json", [], ANNOUNCEMENTS_MAX_BYTES + ANNOUNCEMENT_TEXT_MAX)
#: How long a page's read waits for the next announcement before answering "nothing new" (under every proxy's idle
#: timeout on the way: Ingress, nginx's 60s, a tunnel's 100s).
ANNOUNCEMENT_WAIT_S = 25
#: The listener's pause before reconnecting after the villa's system went away, doubled up to the ceiling.
ANNOUNCEMENT_RETRY_S = (5, 60)
#: What an announcement may say about itself beside its text (2026-10-28): `key` ties a first message to its rewrite
#: (the doorbell's ring and its "Opened at …"), `buttons` are telegram_bot's own ([[label, command], …]).
ANNOUNCEMENT_KEY_MAX = 200
ANNOUNCEMENT_BUTTONS_MAX = 6
ANNOUNCEMENT_BUTTON_TEXT_MAX = 64
#: The villa's media folder (config.yaml `map: media`, read-only): where an announcement's `photo` is, a camera's
#: snapshot taken for it. The add-on copies it into its own store the moment the announcement arrives, so the next
#: ring cannot change it and it lives exactly as long as its announcement.
MEDIA_DIR = "/media"
ANNOUNCEMENT_PHOTO_DIR = "announcement-photos"
#: A photo's name ending → (the name it is kept under, its type, its first bytes). Its cap is an evidence photo's.
ANNOUNCEMENT_PHOTO_TYPES = {".jpg": (".jpg", "image/jpeg", _JPEG_MAGIC), ".jpeg": (".jpg", "image/jpeg", _JPEG_MAGIC),
                            ".png": (".png", "image/png", b"\x89PNG")}
ANNOUNCEMENT_PHOTO_MAX_BYTES = FM_EVIDENCE_MAX_BYTES
ANNOUNCEMENT_PHOTO_RE = re.compile(r"^[0-9a-f]{32}\.(?:jpg|png)$")


def _announcement_buttons(raw) -> list:
    """telegram_bot's keyboard ([[label, command], …] per row, or one row) as rows of [label, command] strings."""
    if not isinstance(raw, list) or not raw:
        return []
    rows = raw if all(isinstance(r, list) and r and isinstance(r[0], list) for r in raw) else [raw]
    out, n = [], 0
    for row in rows:
        keep = []
        for b in row if isinstance(row, list) else []:
            if (isinstance(b, list) and len(b) == 2 and all(isinstance(x, str) and 0 < len(x) <= ANNOUNCEMENT_BUTTON_TEXT_MAX
                                                             for x in b) and n < ANNOUNCEMENT_BUTTONS_MAX):
                keep.append([b[0], b[1]])
                n += 1
        if keep:
            out.append(keep)
    return out


def _announcement_record(event, seq: int) -> dict | None:
    """The record kept for one bus event, or None when it is not an announcement. Pure — tests/store-doors.py
    drives it. `seq` orders them: a page asks for what came after the last one it holds. The photo is not in it: the
    file is copied apart (_announcement_photo_source)."""
    if not ANNOUNCEMENT_EVENT or not isinstance(event, dict) or event.get("event_type") != ANNOUNCEMENT_EVENT:
        return None
    data = event.get("data")
    message = data.get("message") if isinstance(data, dict) else None
    if not isinstance(message, str) or not message.strip():
        return None
    at = event.get("time_fired")
    rec = {"seq": seq, "at": at if isinstance(at, str) else _now_iso(), "message": message[:ANNOUNCEMENT_TEXT_MAX]}
    key = data.get("key")
    if isinstance(key, str) and key.strip():
        rec["key"] = key.strip()[:ANNOUNCEMENT_KEY_MAX]
    if buttons := _announcement_buttons(data.get("buttons")):
        rec["buttons"] = buttons
    # the automation run that announced it (the bus event's context): the VESTA Agent names the runs it took over
    # (vestaMessage `takes`), so the tablet shows VESTA's card in place of the villa's own message of that run
    run = (event.get("context") or {}).get("id") if isinstance(event.get("context"), dict) else None
    if isinstance(run, str) and run.strip():
        rec["run"] = run.strip()[:ANNOUNCEMENT_KEY_MAX]
    return rec


def _announcement_photo_source(event) -> str | None:
    """The announcement's photo as a real file inside the villa's media folder, or None. ⚠️ THE PATH COMES FROM AN
    EVENT: anything outside the media folder (a `..`, a link out of it, another folder) or of another type is
    refused, whoever fired it."""
    data = event.get("data") if isinstance(event, dict) else None
    raw = data.get("photo") if isinstance(data, dict) else None
    if not isinstance(raw, str) or not raw.strip():
        return None
    root = os.path.realpath(MEDIA_DIR)
    path = os.path.realpath(os.path.join(root, raw.strip().removeprefix(MEDIA_DIR).lstrip("/")))
    if not path.startswith(root + os.sep) or os.path.splitext(path)[1].lower() not in ANNOUNCEMENT_PHOTO_TYPES:
        return None
    return path if os.path.isfile(path) else None


def _copy_announcement_photo(src: str) -> str | None:
    """The photo copied into the add-on's store under a new id ("<hex>.jpg"), or None when it is not the picture its
    name says (its first bytes) or past the evidence photo's cap. Blocking: called on a worker thread."""
    kept_as, _, magic = ANNOUNCEMENT_PHOTO_TYPES[os.path.splitext(src)[1].lower()]
    try:
        with open(src, "rb") as f:
            body = f.read(ANNOUNCEMENT_PHOTO_MAX_BYTES + 1)
    except OSError:
        return None
    if len(body) > ANNOUNCEMENT_PHOTO_MAX_BYTES or not body.startswith(magic):
        return None
    return _write_announcement_photo(body, kept_as)


def _write_announcement_photo(body: bytes, kept_as: str) -> str:
    """`body` written under a new id ("<hex>.jpg") in the photo folder; its name. ONE FOLDER FOR EVERY KEPT PHOTO (a ring's,
    a snapshot under VESTA's alert): one sweep, one serving rule. Blocking: called on a worker thread."""
    name = secrets.token_hex(16) + kept_as
    os.makedirs(_data(ANNOUNCEMENT_PHOTO_DIR), exist_ok=True)
    atomic_write(_data(ANNOUNCEMENT_PHOTO_DIR, name), lambda out: out.write(body))
    return name


def _keep_pushed_photo(raw) -> str | None:
    """A photo the VESTA Agent pushed (base64 of a JPEG or a PNG) kept in the photo folder, or None when it is not the
    picture it says (its first bytes) or is past the contract's cap. Blocking: called on a worker thread."""
    cap = int(VESTA_MESSAGE_LIMITS.get("photoBytes") or 0)
    if not isinstance(raw, str) or not raw or len(raw) > cap * 4 // 3 + 8:
        return None
    try:
        body = base64.b64decode(raw, validate=True)
    except ValueError:
        return None
    for kept_as, _ctype, magic in ANNOUNCEMENT_PHOTO_TYPES.values():
        if len(body) <= cap and body.startswith(magic):
            return _write_announcement_photo(body, kept_as)
    return None


#: ⚠️ A GUEST SEES ONLY THE CURRENT NOTIFICATION'S PHOTO (owner, 2026-10-28: "a guest shall only see the photo of the
#: current notification"). A profile that may not view cameras gets a photo only from the newest announcement, and only
#: this long after it arrived: the longest a ring stays on a screen as it comes in. Never a past ring's picture.
ANNOUNCEMENT_CURRENT_S = 60


def _current_photo(items: list, now: float) -> str | None:
    """The photo of the current notification, or None: the newest announcement's, while it is new. Pure —
    tests/store-doors.py drives it."""
    newest = max((a for a in items if isinstance(a, dict) and isinstance(a.get("seq"), int)),
                 key=lambda a: a["seq"], default=None)
    at = _iso_epoch(newest.get("at")) if newest else None
    if newest is None or at is None or not 0 <= now - at <= ANNOUNCEMENT_CURRENT_S:
        return None
    return newest.get("photo") or None


#: A copy younger than this is never swept: it is copied BEFORE its record is written (outside the store's lock, the
#: copy reads the villa's file), so a sweep running in between must not take it for an orphan.
ANNOUNCEMENT_PHOTO_GRACE_S = 120


def _sweep_announcement_photos(_stored, kept) -> None:
    """Delete every kept photo no kept announcement or VESTA message names: its record expired, or a rewrite brought its
    own."""
    named = {a.get("photo") for a in kept if isinstance(a, dict)} if isinstance(kept, list) else set()
    for feed in (ANNOUNCED, MESSAGED):          # ⚠️ BOTH FEEDS SHARE THE FOLDER: this one names its own from `kept`
        named |= {a.get("photo") for a in feed.items() if isinstance(a, dict)}
    try:
        files = os.listdir(_data(ANNOUNCEMENT_PHOTO_DIR))
    except OSError:
        return
    young = time.time() - ANNOUNCEMENT_PHOTO_GRACE_S
    for name in files:
        path = _data(ANNOUNCEMENT_PHOTO_DIR, name)
        try:
            fresh = os.path.getmtime(path) > young
        except OSError:
            continue
        if name not in named and ANNOUNCEMENT_PHOTO_RE.match(name) and not fresh:
            try:
                os.remove(_data(ANNOUNCEMENT_PHOTO_DIR, name))
            except OSError:
                pass


def _announcements_with(stored: list, rec: dict) -> list:
    """The store with `rec` added. ⚠️ ONE LINE PER KEY: an announcement naming the key of a kept one REPLACES it (the
    ring becomes "Opened at …"); a rewrite with no photo keeps the first one's — and VESTA's report its job and page
    (the night check's message rewritten by a later check stays a report). Pure — tests/store-doors.py drives it."""
    if "key" in rec:
        old = next((a for a in stored if isinstance(a, dict) and a.get("key") == rec["key"]), None)
        if old is not None:
            rec = {**{f: old[f] for f in KEPT_ON_REWRITE if f not in rec and old.get(f)}, **rec}
            stored = [a for a in stored if a is not old]
    return stored + [rec]


def _announcements_kept(items: list, now: float, days: int, max_bytes: int) -> list:
    """The announcements still kept: none older than `days` (0 = for ever), then the newest that fit `max_bytes`.
    Pure — tests/store-doors.py drives it."""
    kept = [a for a in items if isinstance(a, dict) and isinstance(a.get("seq"), int)]
    if days > 0:
        cutoff = now - days * 86400
        kept = [a for a in kept if (_iso_epoch(a.get("at")) or now) >= cutoff]
    return _telemetry_ring_after(kept, len(kept), max_bytes)


def _announcements_tidy(items) -> list:
    return _announcements_kept(items if isinstance(items, list) else [], time.time(),
                               _evidence_retention_days(), ANNOUNCEMENTS_MAX_BYTES)


#: The villa's announcements, the feed's first kind: one line per key, kept the records-kept days, a photo swept with
#: the announcement that named it.
ANNOUNCED = Feed(ANNOUNCEMENTS, _announcements_tidy, after=_sweep_announcement_photos)


async def _record_announcement(_app: web.Application, event) -> dict | None:
    """Keep one announcement (its photo copied first) and wake every page waiting for it (Feed.add)."""
    if _announcement_record(event, 0) is None:
        return None
    src = await asyncio.to_thread(_announcement_photo_source, event)
    photo = await asyncio.to_thread(_copy_announcement_photo, src) if src else None

    def record(seq: int) -> dict:
        rec = _announcement_record(event, seq)
        return {**rec, "photo": photo} if photo else rec

    return await ANNOUNCED.add(record, _announcements_with)


async def _listen_announcements(app: web.Application) -> None:
    """The add-on's own subscription to the announcement event, for its whole life; reconnects when the villa's
    system restarts. Says each change of state once, never once per retry."""
    if not ANNOUNCEMENT_EVENT:
        print("[supervisor-proxy] announcements: no event named in ha-commands.json, none are kept", flush=True)
        return
    pause, ceiling = ANNOUNCEMENT_RETRY_S
    wait, said = pause, None
    while True:
        try:
            async with app["session"].ws_connect(
                f"ws://{SUPERVISOR}/core/websocket", headers=AUTH, heartbeat=30,
            ) as ws:
                await ws.receive_json(timeout=30)                       # auth_required
                await ws.send_json({"type": "auth", "access_token": TOKEN})
                if (await ws.receive_json(timeout=30)).get("type") != "auth_ok":
                    raise ConnectionError("the villa's system refused the add-on's token")
                await ws.send_json({"id": 1, "type": "subscribe_events", "event_type": ANNOUNCEMENT_EVENT})
                if not (await ws.receive_json(timeout=30)).get("success"):
                    raise ConnectionError("the villa's system refused the subscription")
                if said != "on":
                    print("[supervisor-proxy] announcements: listening", flush=True)
                    said = "on"
                wait = pause
                async for msg in ws:
                    if msg.type != WSMsgType.TEXT:
                        break
                    try:
                        obj = json.loads(msg.data)
                    except ValueError:
                        continue
                    if isinstance(obj, dict) and obj.get("type") == "event":
                        try:
                            await _record_announcement(app, obj.get("event"))
                        except (OSError, StoreTooLarge) as exc:
                            # One not kept, the listener goes on: a full disk must not also lose the next ring.
                            print(f"[supervisor-proxy] announcements: one not kept ({type(exc).__name__})", flush=True)
                raise ConnectionError("the villa's system closed the connection")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — any failure here means "reconnect", never "stop listening"
            if said != "off":
                print(f"[supervisor-proxy] announcements: not listening ({type(exc).__name__}: {exc}); retrying",
                      flush=True)
                said = "off"
        await asyncio.sleep(wait)
        wait = min(wait * 2, ceiling)


async def _current_photos() -> set:
    """The photo of the current notification now, as a set of one name or none: the newest record of the villa's
    announcements and VESTA's messages together (a snapshot under VESTA's alert is a notification's photo too, and a newer
    notice of either kind takes the current place), while it is new (_current_photo). The two feeds number apart, so each
    gives its newest and the later of the two decides."""
    newest = []
    for feed in (ANNOUNCED, MESSAGED):
        items = [a for a in await asyncio.to_thread(feed.items) if isinstance(a, dict)]
        newest += [max(items, key=lambda a: a["seq"])] if items else []
    newest.sort(key=lambda a: _iso_epoch(a.get("at")) or 0)
    photo = _current_photo(newest[-1:], time.time())
    return {photo} if photo else set()


def _feed_handler(feed: "Feed", field: str):
    """A page's read of one feed — `{field: [...], "last": seq, "first": seq}`, every profile. With `?after=<seq>`, only
    the newer ones, the answer waiting up to ANNOUNCEMENT_WAIT_S for one to arrive. ⚠️ ONE READ FOR EVERY FEED (owner,
    2026-10-28: "the same code … consistently used"): the villa's announcements and VESTA's messages are answered by
    this one, the guest's photo rule included — a profile that may not view cameras is told only the current
    notification's photo (_current_photos; announcement_photo_handler refuses it the others too)."""
    async def handler(request: web.Request) -> web.Response:
        if (refused := _refuse(request)) is not None:
            return refused
        try:
            after = int(request.query["after"]) if "after" in request.query else None
        except ValueError:
            return web.json_response({"error": "after must be a number"}, status=400)
        items, last, first = await feed.read(after, ANNOUNCEMENT_WAIT_S)
        # every number still kept: a page drops what it holds that is not (one erased: message_erase_handler)
        kept = [a["seq"] for a in await asyncio.to_thread(feed.items)]
        if not _may(_role_for(request), "viewCameras"):
            current = await _current_photos()
            items = [a if a.get("photo") in current else {k: v for k, v in a.items() if k != "photo"} for a in items]
        return web.json_response({field: items, "last": last, "first": first, "kept": kept},
                                 headers={"Cache-Control": "no-store"})
    return handler


announcements_handler = _feed_handler(ANNOUNCED, "announcements")


async def announcement_photo_handler(request: web.Request) -> web.StreamResponse:
    """One announcement's photo, by the id its record names — to a profile that may view cameras, and to any other
    only while it is the current notification's (ANNOUNCEMENT_CURRENT_S)."""
    if (refused := _refuse(request)) is not None:
        return refused
    name = request.match_info.get("id", "")
    path = _data(ANNOUNCEMENT_PHOTO_DIR, name)
    if not ANNOUNCEMENT_PHOTO_RE.match(name) or not os.path.isfile(path):
        return web.json_response({"error": "no such photo"}, status=404)
    if not _may(_role_for(request), "viewCameras") and name not in await _current_photos():
        return _forbidden("This profile sees a ring's photo only while it is the current notification.")
    _, ctype, _ = ANNOUNCEMENT_PHOTO_TYPES[os.path.splitext(name)[1]]
    return web.FileResponse(path, headers={"Content-Type": ctype, "Cache-Control": "no-store"})


# ── VESTA's messages, as they stand (agent-contract.json `vestaMessage`) ─────────────────────────────────────────────
# Every message the VESTA Agent writes on Telegram is also kept here for the tablet, as it stands now (ticket 25 of "One
# inbox", owner 2026-10-28: everything Telegram shows is reproduced on the tablet). ⚠️ THE AGENT WRITES, THE ADD-ON KEEPS:
# one record per thread (`key`), added or REPLACED when the Agent rewrites it, never removed by the Agent; tidied after the
# records-kept days like the announcements, and served to every page by the SAME Feed (the second kind it was made for).
# The Agent's push is in the background with a time limit on its side: an alert never waits on it, and with the Agent down
# the villa's own first version (an announcement) stays.
VESTA_MESSAGE_LIMITS: dict = dict((AGENT_CONTRACT_TABLE.get("vestaMessage") or {}).get("limits") or {})
#: What a rewrite that names none keeps of the record it replaces (agent-contract.json vestaMessage.keptOnRewrite): one
#: list, read here and by the Agent's test Kiosk (architecture review 2026-10-29, round 2)
# (the agreement unreadable: the same three, never fewer: a rewritten report would lose its page — review round 3)
KEPT_ON_REWRITE: tuple = tuple((AGENT_CONTRACT_TABLE.get("vestaMessage") or {}).get("keptOnRewrite")
                               or ("photo", "page", "report"))
VESTA_MESSAGES_MAX_BYTES = 2_000_000
VESTA_MESSAGE_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$")


def _vm_text(value, limit_name: str) -> str:
    """A text field: a string, stripped, cut at its contract limit; anything else is empty."""
    return value.strip()[:int(VESTA_MESSAGE_LIMITS.get(limit_name) or 0)] if isinstance(value, str) else ""


def _vm_lines(value, list_name: str, line_name: str) -> list:
    """A list of texts: the first entries up to the contract's count, each cut, none empty."""
    out = [_vm_text(x, line_name) for x in value] if isinstance(value, list) else []
    return [x for x in out if x][:int(VESTA_MESSAGE_LIMITS.get(list_name) or 0)]


def _vm_page(value) -> str:
    """A report's page: a document id as the upload takes it (FM_EVIDENCE_ID_RE); anything else is none."""
    return value if isinstance(value, str) and FM_EVIDENCE_ID_RE.fullmatch(value) else ""


def _vm_language(code) -> bool:
    """Whether `code` is a language code the record may name ("fr", "pt-BR")."""
    return (isinstance(code, str) and bool(VESTA_MESSAGE_LANGUAGE_RE.match(code))
            and len(code) <= int(VESTA_MESSAGE_LIMITS.get("language") or 0))


def _report_pages() -> set:
    """Every page a kept VESTA message names (a report's, in each of its languages): a fault's write never sweeps them as
    unattached — a report's page lives with its message, the records-kept days, never with a ticket (ticket 20)."""
    named = set()
    for m in MESSAGED.items():
        if isinstance(m, dict):
            named |= {m.get("page")} | {w.get("page") for w in (m.get("languages") or {}).values() if isinstance(w, dict)}
    return {p for p in named if isinstance(p, str) and p}


def _vesta_message_record(body, seq: int, now_iso: str) -> dict | None:
    """The record kept for one pushed message, or None when it names no key or says nothing. Pure — tests/store-doors.py
    drives it. The photo is not in it: the picture is kept apart (_keep_pushed_photo). Every limit is the agreement's."""
    if not VESTA_MESSAGE_LIMITS or not isinstance(body, dict):
        return None
    key = _vm_text(body.get("key"), "key")
    rec = {"seq": seq, "key": key, "at": body["at"] if _iso_epoch(body.get("at")) is not None else now_iso}
    for field in ("title", "to", "lead", "body", "stage", "mark"):
        if text := _vm_text(body.get(field), field):
            rec[field] = text
    if roles := _vm_lines(body.get("roles"), "roles", "role"):
        rec["roles"] = roles
    if status := _vm_lines(body.get("status"), "status", "statusLine"):
        rec["status"] = status
    if takes := _vm_lines(body.get("takes"), "takes", "key"):
        rec["takes"] = takes
    # a report (ticket 20 of "One inbox"): the scheduled job that sent it, its page (a document id: the add-on serves it
    # from its own folder, so nothing else is let through) and the language its words are in
    if report := _vm_text(body.get("report"), "report"):
        rec["report"] = report
    if page := _vm_page(body.get("page")):
        rec["page"] = page
    if _vm_language(body.get("language")):
        rec["language"] = body["language"]
    buttons = []
    for b in body.get("buttons") if isinstance(body.get("buttons"), list) else []:
        made = {f: _vm_text(b.get(f2), f2) for f, f2 in (("label", "label"), ("kind", "kind"), ("id", "id"))} \
            if isinstance(b, dict) else {}
        if all(made.values()) and len(buttons) < int(VESTA_MESSAGE_LIMITS.get("buttons") or 0):
            buttons.append(made)
    if buttons:
        rec["buttons"] = buttons
    langs = {}
    for code, words in (body.get("languages") or {}).items() if isinstance(body.get("languages"), dict) else ():
        if (_vm_language(code) and isinstance(words, dict)
                and len(langs) < int(VESTA_MESSAGE_LIMITS.get("languages") or 0)):
            one = {"body": _vm_text(words.get("body"), "body"), "status": _vm_lines(words.get("status"), "status", "statusLine"),
                   "page": _vm_page(words.get("page"))}
            if one["body"] or one["status"]:
                langs[code] = {k: v for k, v in one.items() if v}
    if langs:
        rec["languages"] = langs
    return rec if key and any(f in rec for f in ("title", "lead", "body", "status")) else None


MESSAGES = JsonStore("vesta-messages.json", [], VESTA_MESSAGES_MAX_BYTES + 100_000)


def _vesta_messages_tidy(items) -> list:
    """The records still kept: the announcements' rule (the records-kept days, then the newest that fit the cap)."""
    return _announcements_kept(items if isinstance(items, list) else [], time.time(), _evidence_retention_days(),
                               VESTA_MESSAGES_MAX_BYTES)


#: VESTA's messages, the feed's second kind: one line per key (a rewrite REPLACES, keeping the first one's photo), a photo
#: swept with the record that named it.
MESSAGED = Feed(MESSAGES, _vesta_messages_tidy, after=_sweep_announcement_photos)


async def agent_vesta_message_handler(request: web.Request) -> web.Response:
    """The Agent's push of one message as it stands (token-gated, `agentWrite`): added, or replacing the record of its
    key. 404 when the agreement names no limits (the door says nothing); 400 for a body with no key or no words."""
    if (refused := _agent_refuse(request, "agentWrite")) is not None:
        return refused
    if not VESTA_MESSAGE_LIMITS:
        return web.json_response({"error": "not found"}, status=404)
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    if _vesta_message_record(body, 0, _now_iso()) is None:
        return web.json_response({"error": "a message names a key and says something"}, status=400)
    photo = await asyncio.to_thread(_keep_pushed_photo, body["photo"]) if body.get("photo") else None

    def record(seq: int) -> dict:
        rec = _vesta_message_record(body, seq, _now_iso())
        return {**rec, "photo": photo} if photo else rec

    rec = await MESSAGED.add(record, _announcements_with)
    return web.json_response({"ok": True, "seq": rec["seq"]})


vesta_messages_handler = _feed_handler(MESSAGED, "messages")


# ── A message erased (owner, 2026-10-29) ─────────────────────────────────────────────────────────────────────────────
# A card left from an older format — the villa's message a VESTA card already stands for, a report kept as a
# notification — is removed as a Facility record is: held on the tablet, then the superadmin code (ErasableRow). The
# code is the gate, not the profile: one fresh elevation removes one record. Nothing else removes a message; the
# records-kept days still expire them all.
#: The two feeds a page lists, by the name the page gives them (announcements.ts `feed`).
ERASABLE_FEEDS = {"villa": ANNOUNCED, "vesta": MESSAGED}


async def message_erase_handler(request: web.Request) -> web.Response:
    """`{"feed": "villa"|"vesta", "seq", "elevation"}` — 200 once removed, 403 without a fresh superadmin authorisation
    (or none configured), 404 when no such record is kept, 400 for anything else."""
    if (refused := _refuse(request)) is not None:
        return refused
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    feed, seq = ERASABLE_FEEDS.get(body.get("feed")), body.get("seq")
    if feed is None or not isinstance(seq, int) or isinstance(seq, bool) or not set(body) <= {"feed", "seq", "elevation"}:
        return web.json_response({"error": "an erase names a feed, a number and its authorisation"}, status=400)
    if not _configured_superadmin_pin():
        return _forbidden("Deleting records requires the superadmin code, which is not configured on this installation.")
    if not _consume_elevation(body.get("elevation")):
        return _forbidden("Deleting a record requires a fresh superadmin authorisation for that specific action.")
    if not await feed.remove(seq):
        return web.json_response({"error": "This message is no longer kept."}, status=404)
    return web.json_response({"ok": True})


# ── A button an announcement offers, pressed on a tablet (ha-commands.json `press`) ─────────────────────────────────
# The doorbell's Unlock (ticket 15 of "One inbox", owner 2026-10-28: every profile, no PIN). ⚠️ THE PAGE NEVER FIRES AN
# EVENT: it names a button by its announcement's key and its command, and this process fires the one press event with
# exactly those two, only while an announcement it keeps still offers that button — a rewrite without buttons (the
# ring answered, opened at the gate, or timed out) withdraws it. The opening stays in the villa's automation, which
# waits for the press as it waits for Telegram's: a press after its wait opens nothing. No websocket fire_event is
# admitted, so no profile chooses an event's type or its data.
ANNOUNCEMENT_PRESS = str(HA_COMMANDS.get("press") or "")


def _offers_button(items: list, key, command) -> bool:
    """Whether a kept announcement with this key offers a button with this command. Pure — tests/store-doors.py
    drives it through the door."""
    if not isinstance(key, str) or not key or not isinstance(command, str) or not command:
        return False
    return any(isinstance(a, dict) and a.get("key") == key
               and any(b[1] == command for row in a.get("buttons") or [] for b in row)
               for a in items)


async def _fire_press(app: web.Application, data: dict) -> bool:
    """Fire the press event on the villa's bus with the add-on's own token; whether the villa's system took it."""
    try:
        async with app["session"].post(f"http://{SUPERVISOR}/core/api/events/{ANNOUNCEMENT_PRESS}", headers=AUTH,
                                       json=data, timeout=ClientTimeout(total=10)) as resp:
            return resp.status == 200
    except (ClientError, OSError, asyncio.TimeoutError):
        return False


async def announcement_press_handler(request: web.Request) -> web.Response:
    """`{"key", "command"}` — every profile: 200 once the press is on the villa's bus, 409 when no kept announcement
    offers that button (any more), 502 when the villa's system was not reached."""
    if (refused := _refuse(request)) is not None:
        return refused
    body = await _json_object(request)
    if isinstance(body, web.Response):
        return body
    if not ANNOUNCEMENT_PRESS or set(body) != {"key", "command"}:
        return web.json_response({"error": "a press names a key and a command, nothing else"}, status=400)
    items = await asyncio.to_thread(ANNOUNCED.items)
    if not _offers_button(items, body["key"], body["command"]):
        return web.json_response({"error": "This button is no longer offered."}, status=409)
    if not await _fire_press(request.app, {"command": body["command"], "key": body["key"]}):
        return web.json_response({"error": "The villa's system was not reached."}, status=502)
    return web.json_response({"ok": True})


# ── The villa's critical devices (agent-contract.json criticalDevices) ───────
# ⚠️ ONE LIST (owner, 2026-10-18 — architecture review, offline devices #2): the
# Kiosk painted every offline device red, the agent's night check called locks,
# motors and scheduled assets critical, its reports security devices only. The
# list is the one the villa's "critical devices offline" rule watches: every
# automation built from the agreement's blueprint, its input. Read HERE, with the
# add-on's own access, so no browser is given automation configs (no new
# passthrough type) — it gets the entity ids only, no more than get_states shows.
CRITICAL_TTL_SECONDS = 300
_critical_cache: dict = {"at": 0.0, "body": None}


def _critical_from_configs(configs, rule: dict) -> tuple[list[str], list[str]]:
    """(the critical entity ids, the automations they came from) from
    [(automation entity id, its config)] and the agreement's {blueprint, input}.
    A blueprint is matched by its path's last part without .yaml (it may sit in
    a sub-folder); the input may be one id or a list. Pure."""
    want, key = str(rule.get("blueprint") or ""), str(rule.get("input") or "")
    ents: set[str] = set()
    used: list[str] = []
    for eid, cfg in configs:
        bp = (cfg or {}).get("use_blueprint") if isinstance(cfg, dict) else None
        if not want or not key or not isinstance(bp, dict):
            continue
        name = str(bp.get("path") or "").rsplit("/", 1)[-1]
        if name.removesuffix(".yaml") != want:
            continue
        val = (bp.get("input") or {}).get(key)
        ids = [val] if isinstance(val, str) else val if isinstance(val, list) else []
        got = {i for i in ids if isinstance(i, str) and AGENT_ENTITY_RE.fullmatch(i)}
        if got:
            ents |= got
            used.append(eid)
    return sorted(ents), sorted(used)


async def _critical_read(session: ClientSession) -> dict:
    """The villa's critical devices, read now from Home Assistant."""
    base = f"http://{SUPERVISOR}/core/api"
    t = ClientTimeout(total=20)
    async with session.get(f"{base}/states", headers=AUTH, timeout=t) as resp:
        resp.raise_for_status()
        states = await resp.json()
    configs = []
    for st in states:
        eid = str(st.get("entity_id") or "")
        aid = (st.get("attributes") or {}).get("id")
        if not eid.startswith("automation.") or not aid:
            continue
        async with session.get(f"{base}/config/automation/config/{aid}", headers=AUTH, timeout=t) as resp:
            if resp.status == 200:
                configs.append((eid, await resp.json()))
    ents, used = _critical_from_configs(configs, AGENT_CONTRACT_TABLE.get("criticalDevices") or {})
    return {"entities": ents, "rules": used, "at": _now_iso()}


async def critical_devices_handler(request: web.Request) -> web.Response:
    """GET /critical-devices: {entities, rules, at} (+ error when the read failed:
    the last good answer, else an empty list — never a 500)."""
    if (refused := _refuse(request)) is not None:
        return refused
    now = time.monotonic()
    body = _critical_cache["body"]
    if body is None or now - _critical_cache["at"] >= CRITICAL_TTL_SECONDS:
        try:
            body = await _critical_read(request.app["session"])
            _critical_cache.update(at=now, body=body)
        except Exception as err:  # noqa: BLE001 — Home Assistant unreachable: say so, keep the last answer
            last = _critical_cache["body"] or {"entities": [], "rules": [], "at": None}
            body = {**last, "error": f"could not read the villa's rules: {type(err).__name__}"}
    return web.json_response(body, headers={"Cache-Control": "no-store"})


# ── The rooms the Kiosk shows (the villa model's fallback) ───────────────────
# "Which room is this device in" is the Kiosk's rule (EntityMap.ts
# resolveEntityRoom): Home Assistant's area, else the drawn room the device's
# 3D anchor sits in. The second half exists only in a browser with the scene
# loaded, so an owner's or facility manager's device SHARES its resolved rooms
# here (RoomShare.tsx) and the villa model uses them for a device Home Assistant
# has no area for — the add-on is told the Kiosk's answer, never re-derives it.
KIOSK_ROOMS = JsonStore("kiosk-rooms.json", {"rooms": {}}, 1_000_000)


def _kiosk_rooms_merge(request: web.Request, stored, value):
    """Keep `rooms` — and each device's `names` and `categories` as the Kiosk shows them (agentView.deviceViews) —
    stamped with when and by whom they were shared."""
    value = value if isinstance(value, dict) else {}
    return {"rooms": value.get("rooms"), "names": value.get("names") or {}, "categories": value.get("categories") or {},
            "at": _now_iso(), "by": _role_for(request)}


def _kiosk_rooms_guard(request: web.Request, body, old, new):
    for key, what in (("rooms", "room names"), ("names", "device names"), ("categories", "categories")):
        m = new.get(key)
        if not isinstance(m, dict) or len(m) > 10_000 or not all(
                isinstance(k, str) and AGENT_ENTITY_RE.fullmatch(k)
                and isinstance(v, str) and 0 < len(v) <= 100 for k, v in m.items()):
            return web.json_response(
                {"error": f"{key} must map entity ids to {what} (at most 100 characters)"}, status=400)
    return None


kiosk_rooms_put_handler = _store_put_handler(
    KIOSK_ROOMS, "data", "the shared rooms", capability="viewAgent",
    merge=_kiosk_rooms_merge, guard=_kiosk_rooms_guard)


# ── Info and the villa model (PLAN A4) ───────────────────────────────────────

async def _learn_own_version(session: ClientSession) -> None:
    global _own_version
    try:
        async with session.get(f"http://{SUPERVISOR}/addons/self/info", headers=AUTH,
                               timeout=ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                _own_version = str(((await resp.json()).get("data") or {}).get("version") or "unknown")
    except Exception as err:  # noqa: BLE001 — best-effort, never blocks start-up
        print(f"[supervisor-proxy] own version unknown: {err}", flush=True)


async def agent_info_handler(request: web.Request) -> web.Response:
    """The compatibility check: contract version, Kiosk version, capabilities."""
    if (refused := _agent_refuse(request, "agentRead")) is not None:
        return refused
    return web.json_response({
        "contract": AGENT_CONTRACT,
        "version": _own_version,
        "capabilities": sorted(ROLE_CAPABILITIES[AGENT]),
        # the fault step kinds this Kiosk shows (agent-contract.json ticketUpdate): the agent writes a newer one only
        # when it is listed here ("noted", 2.496.356)
        "step_kinds": list((AGENT_CONTRACT_TABLE.get("ticketUpdate") or {}).get("kinds") or []),
        # the fault fields this Kiosk reads (agent-contract.json ticket.fields): the agent writes a newer one ("titlePattern",
        # 2.496.382) only when it is listed here — an older Kiosk would show "{since}" as it is
        "ticket_fields": sorted(((AGENT_CONTRACT_TABLE.get("ticket") or {}).get("fields") or {}).keys()),
        # how this Kiosk reads a fault being read again (agent-contract.json ticket.checks): the agent writes "day"
        # (2.496.429: night-check faults read again during the day) only when it is listed here — an older Kiosk would
        # show such a fault with no Next check time
        "ticket_checks": list((AGENT_CONTRACT_TABLE.get("ticket") or {}).get("checks") or []),
        "offline_after_minutes": _agent_offline_minutes(),
    }, headers={"Cache-Control": "no-store"})


_VILLA_AREAS_CACHE: dict = {"key": None, "at": 0.0, "value": None}
VILLA_AREAS_TTL = 60


async def _ha_areas(session: ClientSession, ids: list) -> dict | None:
    """{entity_id: [area, floor, friendly_name]} from Home Assistant, or None.

    ⚠️ HOME ASSISTANT'S AREA IS THE KIOSK'S OWN FIRST ANSWER to "which room is
    this device in" (EntityMap.ts resolveEntityRoom); its fallback — which drawn
    room the device's 3D anchor sits in — exists only inside the browser's
    scene, so it is not repeated here. One template render for every id:
    `area_name()` follows an entity to its device's area, as the Kiosk does.

    The ids are embedded in the template, so every one has passed
    AGENT_ENTITY_RE: a template is code Home Assistant runs."""
    if not ids:
        return {}
    key = hashlib.sha256("\n".join(ids).encode()).hexdigest()
    cache = _VILLA_AREAS_CACHE
    if cache["key"] == key and time.monotonic() - cache["at"] < VILLA_AREAS_TTL:
        return cache["value"]
    template = ("{% set ns = namespace(o={}) %}{% for e in " + json.dumps(ids) + " %}"
                "{% set a = area_name(e) %}"
                "{% set ns.o = dict(ns.o, **{e: [a, floor_name(e) if a else none, "
                "state_attr(e, 'friendly_name')]}) %}{% endfor %}{{ ns.o | tojson }}")
    try:
        async with session.post(f"http://{SUPERVISOR}/core/api/template", headers=AUTH,
                                json={"template": template},
                                timeout=ClientTimeout(total=20)) as resp:
            if resp.status != 200:
                return None
            value = json.loads(await resp.text())
    except Exception:  # noqa: BLE001 — the model is still useful without rooms
        return None
    if not isinstance(value, dict):
        return None
    cache.update(key=key, at=time.monotonic(), value=value)
    return value


async def agent_villa_model_handler(request: web.Request) -> web.Response:
    """Rooms, devices, entity ids, names and the room of each device, as this
    Kiosk models the villa — read-only, derived from the shared device
    configuration, the floor plan's room file and Home Assistant's areas."""
    if (refused := _agent_refuse(request, "agentRead")) is not None:
        return refused
    cfg = DEVICE_CONFIG.read()
    cfg = cfg if isinstance(cfg, dict) else {}
    entity_map = cfg.get("entityMap") if isinstance(cfg.get("entityMap"), dict) else {}
    mesh = cfg.get("meshBindings") if isinstance(cfg.get("meshBindings"), dict) else {}
    groups = [g for g in cfg.get("deviceGroups") or [] if isinstance(g, dict)]
    dismissed = {str(e) for e in cfg.get("dismissedEntityIds") or []}
    group_of = {}
    for g in groups:
        for eid in [g.get("primaryEntityId"), *(g.get("memberEntityIds") or [])]:
            if isinstance(eid, str):
                group_of.setdefault(eid, str(g.get("id", "")))
    ids = sorted({e for e in (*entity_map, *mesh.values(), *group_of)
                  if isinstance(e, str) and AGENT_ENTITY_RE.fullmatch(e) and e not in dismissed})
    areas = await _ha_areas(request.app["session"], ids)
    shared = KIOSK_ROOMS.read()
    told = lambda key: shared.get(key) if isinstance(shared, dict) and isinstance(shared.get(key), dict) else {}  # noqa: E731
    kiosk_rooms = told("rooms")
    # each device's name and category as the Kiosk shows them (agentView.deviceViews, shared beside the rooms):
    # this module never re-derives the Kiosk's label or category rule (architecture review scan 3, 2026-10-19)
    kiosk_names, kiosk_categories = told("names"), told("categories")
    devices = []
    for eid in ids:
        mapping = entity_map.get(eid) if isinstance(entity_map.get(eid), dict) else {}
        area, floor, friendly = (areas or {}).get(eid) or [None, None, None]
        fallback = kiosk_rooms.get(eid) if not area and isinstance(kiosk_rooms.get(eid), str) else None
        devices.append({
            "entity_id": eid,
            "name": kiosk_names.get(eid) or mapping.get("label") or friendly or eid,
            "type": mapping.get("type") or eid.partition(".")[0],
            "category": kiosk_categories.get(eid) or mapping.get("category"),
            "disabled": bool(mapping.get("disabled")),
            "group_id": group_of.get(eid),
            "room": area or fallback or None,
            "floor": floor or None,
            # ha_area: Home Assistant's own area. kiosk: the drawn room the
            # Kiosk places it in (shared by an owner/ops device). None: neither.
            "room_source": "ha_area" if area else ("kiosk" if fallback else None),
        })
    rooms = []
    model = _effective_paths().get("model_path")
    if model:
        sidecar = _read_json_store(os.path.join(_data(WWW_NAME), _rooms_rel(model)), {})
        for r in (sidecar.get("rooms") or []) if isinstance(sidecar, dict) else []:
            if isinstance(r, dict) and isinstance(r.get("name"), str) and r["name"]:
                rooms.append({"name": r["name"], "floor": r.get("floor", 1), "source": "floor_plan"})
    for p in cfg.get("teleportPoints") or []:
        if isinstance(p, dict) and isinstance(p.get("name"), str) and not p.get("fitted"):
            rooms.append({"name": p["name"], "floor": p.get("floor", 1), "source": "added"})
    return web.json_response({
        "rooms": rooms,
        "devices": devices,
        "groups": [{"id": g.get("id"), "primary_entity_id": g.get("primaryEntityId"),
                    "member_entity_ids": g.get("memberEntityIds") or [],
                    "label": g.get("label")} for g in groups],
        "ha_areas": areas is not None,
    }, headers={"Cache-Control": "no-store"})


def build_app(data_dir: str | None = None) -> web.Application:
    """The application with every route — what main() serves.

    Split out so tests/agent-interface.py drives THIS route table over real
    HTTP rather than a copy of it: a handler that exists but is not routed, or
    is routed to the wrong path, is exactly what a copy would not show.

    `data_dir` moves everything this process persists — options, sessions,
    every store, evidence, the model — to another directory (see DATA_DIR).
    main() passes nothing: the Supervisor's /data."""
    global DATA_DIR, _session_secret_cache, _EPOCH_CACHE
    if data_dir is not None:
        DATA_DIR = data_dir
        # Both caches describe files in the OLD directory.
        _session_secret_cache = None
        _EPOCH_CACHE = None
    app = web.Application()

    async def on_start(a: web.Application) -> None:
        a["session"] = ClientSession(timeout=ClientTimeout(total=None))
        os.makedirs(_data(WWW_NAME), exist_ok=True)
        _session_secret()  # create the signing key on first boot
        await _cleanup_stale_options(a["session"])
        if (gone := _remove_retired_data()):
            print(f"[supervisor-proxy] removed retired file(s): {gone}", flush=True)
        await _learn_own_version(a["session"])
        a["light_scenes"] = asyncio.create_task(_learn_light_scenes(a["session"]))
        a["announcements"] = asyncio.create_task(_listen_announcements(a))
        if (warning := _agent_config_warning()) is not None:
            print(f"[supervisor-proxy] {warning}", flush=True)

    async def on_cleanup(a: web.Application) -> None:
        a["light_scenes"].cancel()
        a["announcements"].cancel()
        await a["session"].close()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/healthz", healthz_handler)
    app.router.add_get("/addon-config", addon_config_handler)
    app.router.add_post("/model-upload", model_upload_handler)
    app.router.add_get("/device-config", device_config_get_handler)
    app.router.add_get("/fm-data", fm_data_get_handler)
    app.router.add_put("/fm-data", fm_data_put_handler)
    app.router.add_post("/fm-evidence", fm_evidence_post_handler)
    app.router.add_get("/fm-evidence/{id}", fm_evidence_get_handler)
    app.router.add_get("/fm-document/{id}", fm_document_get_handler)
    app.router.add_post("/telemetry", telemetry_post_handler)
    app.router.add_get("/telemetry", telemetry_get_handler)
    app.router.add_put("/device-config", device_config_put_handler)
    app.router.add_get("/auth/roles", auth_roles_handler)
    app.router.add_get("/auth/session", auth_session_handler)
    app.router.add_post("/auth/verify", auth_verify_handler)
    app.router.add_post("/auth/elevate", auth_elevate_handler)
    app.router.add_post("/auth/logout", auth_logout_handler)
    app.router.add_post("/auth/logout-all", auth_logout_all_handler)
    app.router.add_get("/auth/check", auth_check_handler)
    app.router.add_get("/core/websocket", ws_handler)
    app.router.add_route("*", "/core/api/{path:.*}", rest_handler)
    # The Kiosk's side of the VESTA Agent (owner and facility manager).
    app.router.add_get("/critical-devices", critical_devices_handler)
    app.router.add_get("/agent-status", agent_status_handler)
    # The villa's announcements, kept by this process (every profile).
    app.router.add_get("/announcements", announcements_handler)
    app.router.add_get("/announcement-photo/{id}", announcement_photo_handler)
    app.router.add_get("/vesta-messages", vesta_messages_handler)
    app.router.add_post("/announcement-press", announcement_press_handler)
    app.router.add_post("/message-erase", message_erase_handler)
    app.router.add_put("/kiosk-rooms", kiosk_rooms_put_handler)
    # The VESTA Agent interface v1 (bearer token; 404 while agent_token is empty).
    app.router.add_get("/agent/v1/info", agent_info_handler)
    app.router.add_get("/agent/v1/villa-model", agent_villa_model_handler)
    app.router.add_get("/agent/v1/fm-data", agent_fm_get_handler)
    app.router.add_put("/agent/v1/fm-data", agent_fm_put_handler)
    app.router.add_post("/agent/v1/fm-evidence", agent_fm_evidence_handler)
    app.router.add_post("/agent/v1/fm-document", agent_fm_document_handler)
    app.router.add_post("/agent/v1/vesta-message", agent_vesta_message_handler)
    app.router.add_post("/agent/v1/heartbeat", agent_heartbeat_handler)
    return app


def main() -> None:
    app = build_app()
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
