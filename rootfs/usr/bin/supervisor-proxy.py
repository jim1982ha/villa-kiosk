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

It also serves two local helper routes (no Supervisor token involved):
  GET  /addon-config  -> the non-sensitive model paths for the frontend.
  POST /model-upload?kind=glb|sh3d -> writes the body to the central model file
       under /config/www (atomic overwrite), so the kiosk can be re-skinned from
       its own Settings UI instead of SSH/Samba.

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
import json
import os
import tempfile

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

SUPERVISOR = "supervisor"
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
AUTH = {"Authorization": f"Bearer {TOKEN}"}

# HA www folder, mounted read-WRITE via the homeassistant_config:rw map. nginx
# serves it at /model/<path>; the upload handler below writes into it.
WWW_ROOT = "/homeassistant/www"
# Where an uploaded file lands when the admin hasn't set an explicit
# model_path/sh3d_path — a managed location the add-on owns. addon_config_handler
# reports these as the effective paths once the files exist, so an uploaded model
# lights up for every client with no Supervisor API call or add-on restart.
MANAGED_PATH = {"glb": "villa-kiosk/villa.glb", "sh3d": "villa-kiosk/villa.sh3d"}
# Safety cap on a single upload (the GLB is the big one, ~tens of MB).
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
# Leading bytes the upload must start with for its declared kind: a binary
# glTF container always begins with "glTF"; a .sh3d is a ZIP. Files under
# /config/www are served by both this add-on (/model/) and HA itself
# (/local/), so without this check any bytes POSTed as kind=glb would be
# published there verbatim (unrestricted file upload).
UPLOAD_MAGIC = {
    "glb": (b"glTF",),
    "sh3d": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
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


def _effective_paths() -> dict:
    """The model paths the frontend should use.

    An explicit model_path/sh3d_path option wins (back-compat with files placed
    manually via SSH/Samba). Otherwise, if a managed upload exists on disk, report
    that — so a UI upload is picked up with no option edit or restart.
    """
    opts = _read_options()
    out = {}
    for opt_key, kind in (("model_path", "glb"), ("sh3d_path", "sh3d")):
        explicit = (opts.get(opt_key) or "").strip()
        if explicit:
            out[opt_key] = explicit
        elif os.path.exists(os.path.join(WWW_ROOT, MANAGED_PATH[kind])):
            out[opt_key] = MANAGED_PATH[kind]
        else:
            out[opt_key] = ""
    return out


def _resolve_upload_target(kind: str) -> str:
    """Absolute, traversal-checked destination path for an upload of this kind.

    Writes to the configured option path if set, else the managed default.
    Raises ValueError if the resolved path escapes the www root.
    """
    opt_key = "model_path" if kind == "glb" else "sh3d_path"
    rel = (_read_options().get(opt_key) or "").strip() or MANAGED_PATH[kind]
    root = os.path.realpath(WWW_ROOT)
    dest = os.path.realpath(os.path.join(root, rel))
    if dest != root and not dest.startswith(root + os.sep):
        raise ValueError("resolved path escapes the www root")
    return dest


async def addon_config_handler(request: web.Request) -> web.Response:
    """Expose the non-sensitive add-on options (model paths) to the frontend.

    The full /data/options.json is never forwarded — only the two model-path
    fields are returned, so future options with credentials stay server-side.
    """
    return web.json_response(_effective_paths())


async def model_upload_handler(request: web.Request) -> web.Response:
    """Stream an uploaded GLB/SH3D to the central model file (atomic overwrite).

    The body is written to a temp file in the destination directory, then
    os.replace()'d over the existing file — so a partial/failed upload never
    corrupts the live model, and a success cleanly erases the previous file.
    """
    kind = request.query.get("kind", "")
    if kind not in ("glb", "sh3d"):
        return web.json_response({"error": "kind must be 'glb' or 'sh3d'"}, status=400)

    try:
        dest = _resolve_upload_target(kind)
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    total = 0
    # Magic-byte check runs on the stream head (chunks can in principle arrive
    # smaller than 4 bytes, so accumulate until there is enough to compare).
    head = b""
    head_checked = False
    try:
        with os.fdopen(fd, "wb") as out:
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
                if total > MAX_UPLOAD_BYTES:
                    raise web.HTTPRequestEntityTooLarge(
                        max_size=MAX_UPLOAD_BYTES, actual_size=total,
                    )
                out.write(chunk)
        if total == 0:
            raise web.HTTPBadRequest(text="empty upload")
        if not head_checked:  # body shorter than any valid signature
            raise web.HTTPBadRequest(text=f"upload does not look like a {kind} file")
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

    rel = os.path.relpath(dest, os.path.realpath(WWW_ROOT))
    return web.json_response({"path": rel, "size": total})


def main() -> None:
    app = web.Application()

    async def on_start(a: web.Application) -> None:
        a["session"] = ClientSession(timeout=ClientTimeout(total=None))

    async def on_cleanup(a: web.Application) -> None:
        await a["session"].close()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/addon-config", addon_config_handler)
    app.router.add_post("/model-upload", model_upload_handler)
    app.router.add_get("/core/websocket", ws_handler)
    app.router.add_route("*", "/core/api/{path:.*}", rest_handler)
    web.run_app(app, host="127.0.0.1", port=8100, print=None)


if __name__ == "__main__":
    main()
