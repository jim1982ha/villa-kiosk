#!/usr/bin/env python3
"""Token-injecting Supervisor proxy for the Villa Kiosk add-on.

The browser (served behind Ingress) makes same-origin, *token-less* requests to
this service. We add the add-on's SUPERVISOR_TOKEN server-side and forward to the
Supervisor's Home Assistant Core proxy, so no Home Assistant long-lived token is
ever needed and the powerful Supervisor token never reaches the browser.

  REST : /core/api/...    -> http://supervisor/core/api/...    (+ Bearer header)
  WS   : /core/websocket  -> ws://supervisor/core/websocket    (+ Bearer header,
         and the in-band `{"type":"auth"}` message's access_token is rewritten to
         the Supervisor token, since the HA websocket authenticates in-band).

It also serves local helper routes (no Supervisor token involved):
  GET  /addon-config  -> the non-sensitive model paths for the frontend.
  POST /model-upload?kind=glb|rooms -> writes the body to the central model file
       (GLB) or its room-data sidecar (.rooms.json) under /config/www (atomic
       overwrite), so the kiosk can be re-skinned from its own Settings UI
       instead of SSH/Samba.
       Every write also refreshes PUBLIC_MANIFEST_REL (www/villa-kiosk/
       addon-config.json) — a plain static mirror of /addon-config's JSON, so
       a STANDALONE build (this app's dist/ copied into HA's own www/ folder,
       opened via HA's own /local/ route rather than through Ingress) can
       learn the real model_path — including a custom one — over plain HTTP,
       with no Supervisor API access needed.
  GET  /auth/roles    -> which kiosk profiles require a passcode (booleans only).
  POST /auth/verify   -> server-side profile passcode check. The configured PINs
       (guest_pin/owner_pin/ops_pin add-on options) never leave this process:
       the frontend submits {role, pin} and gets back only an ok/locked verdict.
       Comparison is constant-time; repeated failures rate-limit the role.

Runs on 127.0.0.1:8100; nginx proxies the Ingress `/core/` paths to it.

Security notes:
  * Request smuggling (aiohttp CVE-2025-53643) affects only aiohttp's *pure
    Python* HTTP parser; the Alpine `py3-aiohttp` package ships the compiled
    (llhttp) C extension, so that path is not in use. Keep the HA base image
    current so aiohttp stays patched.
  * `rest_handler` strips the client's `Transfer-Encoding`/`Content-Length`
    (see HOP_BY_HOP) and lets aiohttp re-frame the forwarded body, so a client
    cannot desync nginx and Core via conflicting framing headers.
  * nginx only accepts the HA Ingress gateway (172.30.32.2); this service binds
    to loopback only and is never directly reachable.
"""
import asyncio
import hmac
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

SUPERVISOR = "supervisor"
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
AUTH = {"Authorization": f"Bearer {TOKEN}"}

# The full set of options config.yaml's schema currently recognises. Kept
# separate from the schema itself so this can compare against it — see
# _cleanup_stale_options below.
KNOWN_OPTION_KEYS = {"model_path", "guest_pin", "owner_pin", "ops_pin"}

# HA www folder, mounted read-WRITE via the homeassistant_config:rw map. nginx
# serves it at /model/<path>; the upload handler below writes into it.
WWW_ROOT = "/homeassistant/www"
# Where an uploaded file lands when the admin hasn't set an explicit
# model_path — a managed location the add-on owns. addon_config_handler
# reports these as the effective paths once the files exist, so an uploaded model
# lights up for every client with no Supervisor API call or add-on restart.
MANAGED_PATH = {"glb": "villa-kiosk/villa.glb"}
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


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    """Bridge the browser websocket to Core, injecting the Supervisor token."""
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


async def rest_handler(request: web.Request) -> web.StreamResponse:
    """Relay a REST call to Core, adding the Supervisor Bearer token."""
    session: ClientSession = request.app["session"]
    tail = request.match_info.get("path", "")
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
    old `sh3d_path` option, replaced by `model_path` back when central-model
    hosting was added) stays in that stored config forever, on every install
    that had ever set it, unless something explicitly clears it. Supervisor
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
        with open(os.path.join(WWW_ROOT, rel) + ".upload.json", encoding="utf-8") as f:
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

    An explicit model_path option wins (back-compat with files placed manually
    via SSH/Samba). Otherwise, if a managed upload exists on disk, report that —
    so a UI upload is picked up with no option edit or restart.

    model_upload / rooms_upload carry the ORIGINAL browser-side filename + time
    recorded by the upload handler. A central upload overwrites the file AT the
    configured path, so the served name never changes (e.g. always
    TheLysHouse_1F.glb) no matter what file was picked — which read as "the info
    panel is wrong" until the panel could show what was actually uploaded. The
    room-data sidecar (.rooms.json) is derived from model_path, not separately
    configurable. None = placed manually (SSH/Samba), or uploaded before this
    existed.
    """
    opts = _read_options()
    explicit = (opts.get("model_path") or "").strip()
    if explicit:
        model_rel = explicit
    elif os.path.exists(os.path.join(WWW_ROOT, MANAGED_PATH["glb"])):
        model_rel = MANAGED_PATH["glb"]
    else:
        model_rel = ""
    return {
        "model_path": model_rel,
        "model_upload": _upload_meta(model_rel),
        "rooms_upload": _upload_meta(_rooms_rel(model_rel)) if model_rel else None,
    }


# Where _write_public_manifest below mirrors _effective_paths(), so a
# STANDALONE build (this app's dist/ copied into HA's own www/ folder, opened
# via HA's own /local/ route instead of through Ingress) can learn the real
# model_path — including a custom one, not just the MANAGED_PATH default —
# without any Supervisor API access. A fixed, well-known location regardless
# of what model_path itself is set to, so standalone always knows where to
# look for it.
PUBLIC_MANIFEST_REL = "villa-kiosk/addon-config.json"


def _write_public_manifest() -> None:
    """Mirror _effective_paths() into a plain static file inside the www
    folder this add-on already serves, so it's readable over plain HTTP (HA's
    own /local/ route) with no Ingress/Supervisor-token dance — see
    PUBLIC_MANIFEST_REL. Call after anything that can change the effective
    paths (startup, a completed upload). Best-effort: must never raise, since
    every caller is on a path that already succeeded at something real."""
    try:
        dest = os.path.join(WWW_ROOT, PUBLIC_MANIFEST_REL)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_effective_paths(), f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, dest)
    except OSError as err:
        print(f"[supervisor-proxy] public manifest write skipped: {err}", flush=True)


def _resolve_upload_target(kind: str) -> str:
    """Absolute, traversal-checked destination path for an upload of this kind.

    The GLB writes to the configured model_path (or the managed default); the
    room-data sidecar is derived from that GLB path (<model>.rooms.json), so both
    files always sit together no matter where the admin points model_path.
    Raises ValueError if the resolved path escapes the www root.
    """
    model_rel = (_read_options().get("model_path") or "").strip() or MANAGED_PATH["glb"]
    rel = model_rel if kind == "glb" else _rooms_rel(model_rel)
    root = os.path.realpath(WWW_ROOT)
    dest = os.path.realpath(os.path.join(root, rel))
    if dest != root and not dest.startswith(root + os.sep):
        raise ValueError("resolved path escapes the www root")
    return dest


async def addon_config_handler(request: web.Request) -> web.Response:
    """Expose the non-sensitive add-on options (model paths) to the frontend.

    The full /data/options.json is never forwarded — only the two model-path
    fields are returned, so options with credentials (the profile PINs) stay
    server-side.
    """
    return web.json_response(_effective_paths())


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
    """Constant-time, rate-limited check of a submitted profile passcode."""
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return web.json_response({"error": "invalid JSON body"}, status=400)
    role = body.get("role")
    pin = body.get("pin")
    # Whitelist validation: role must be one of the three known profiles and
    # the pin exactly four digits — anything else is rejected before any
    # comparison or counter is touched.
    if role not in AUTH_ROLES:
        return web.json_response({"error": "unknown role"}, status=400)
    if not isinstance(pin, str) or not PIN_RE.fullmatch(pin):
        return web.json_response({"error": "pin must be 4 digits"}, status=400)

    retry_after = _lockout_remaining(role)
    if retry_after > 0:
        return web.json_response(
            {"ok": False, "locked": True, "retryAfter": retry_after}, status=429,
        )

    configured = _configured_pin(role)
    # An unconfigured role needs no PIN — the frontend normally skips the pad
    # (see /auth/roles), but accept a direct verify too so the two endpoints
    # can never disagree.
    ok = not configured or hmac.compare_digest(pin, configured)
    st = _auth_failures[role]
    if ok:
        st["count"] = 0
    else:
        st["count"] += 1
        st["last"] = time.monotonic()
    return web.json_response({"ok": ok})


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
    _write_public_manifest()
    rel = os.path.relpath(dest, os.path.realpath(WWW_ROOT))
    return web.json_response({"path": rel, "size": offset + n})


async def model_upload_handler(request: web.Request) -> web.Response:
    """Stream an uploaded GLB or .rooms.json to its central file (atomic overwrite).

    The body is written to a temp file in the destination directory, then
    os.replace()'d over the existing file — so a partial/failed upload never
    corrupts the live model, and a success cleanly erases the previous file.
    With upload_id/offset/last query params the body is one piece of a chunked
    upload instead (files above HA Ingress's ~16 MB per-request cap).
    """
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
    _write_public_manifest()
    rel = os.path.relpath(dest, os.path.realpath(WWW_ROOT))
    return web.json_response({"path": rel, "size": total})


def main() -> None:
    app = web.Application()

    async def on_start(a: web.Application) -> None:
        a["session"] = ClientSession(timeout=ClientTimeout(total=None))
        await _cleanup_stale_options(a["session"])
        _write_public_manifest()

    async def on_cleanup(a: web.Application) -> None:
        await a["session"].close()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/addon-config", addon_config_handler)
    app.router.add_post("/model-upload", model_upload_handler)
    app.router.add_get("/auth/roles", auth_roles_handler)
    app.router.add_post("/auth/verify", auth_verify_handler)
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
