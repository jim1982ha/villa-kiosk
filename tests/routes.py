#!/usr/bin/env python3
"""Which paths this add-on answers, checked in every direction.

⚠️ THE PATH SET IS THE CENTRAL INTERFACE OF THE RUNTIME AND IT IS DECLARED
NOWHERE. You reconstruct it by reading four files — nginx's locations, the
proxy's router table, the service worker's never-cache list and Vite's dev
proxy — and by the time this was written they had already drifted in two
directions at once:

  · nginx published `location = /scenes` to a route the proxy had deleted, so
    an Ingress-reachable path could only ever 404. Nobody noticed for the life
    of the branch, because nothing walked nginx -> proxy.
  · Vite's dev proxy forwarded five of the nine prefixes the app actually
    fetches, so `npm run dev` silently 404'd the shared device configuration
    and the whole Facility workspace.

This walks all three directions. It cannot make the four files into one
declaration — that is the deeper fix — but it makes a disagreement loud.

⚠️ THE FOURTH LIST WAS NAMED ABOVE AND NEVER CHECKED (round 11, 2.496.168).
The service worker's never-cache rule decides whether a proxy GET is served
from a cache on the standalone hostname — the defect its own comment records
(a sync read returning a document 1.8 hours old). A new GET route the rule
does not cover is that defect again; now every one must be excluded, or be
named below as deliberately cacheable.

Run: python3 tests/routes.py   (also `npm run test:routes`)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NGINX = ROOT / "rootfs" / "etc" / "nginx" / "nginx.conf"
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
SW = ROOT / "public" / "sw.js"
VITE = ROOT / "vite.config.ts"

FAIL = 0


def ck(name: str, ok: bool, detail: str = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}")
    if detail and not ok:
        print(f"          {detail}")
    if not ok:
        FAIL += 1


def first_segment(path: str) -> str:
    return "/" + path.lstrip("/").split("/")[0]


# ── what nginx hands to the backend ──────────────────────────────────────
ng = NGINX.read_text()
# A location block that proxies to the add-on's own listener. `=` means exact.
forwarded = set()
for m in re.finditer(r"location\s+(=\s*)?(\S+)\s*\{([^}]*)\}", ng):
    body = m.group(3)
    if "127.0.0.1:8100" not in body:
        continue
    forwarded.add(first_segment(m.group(2)))

# ── what the proxy answers ───────────────────────────────────────────────
px = PROXY.read_text()
routes = set()
for m in re.finditer(r'app\.router\.add_\w+\(\s*(?:"[A-Z*]+"\s*,\s*)?"([^"]+)"', px):
    routes.add(first_segment(m.group(1)))

# ── what the dev server forwards ─────────────────────────────────────────
vt = VITE.read_text()
block = re.search(r"\[([^\]]*?)\]\.map\(\(p\) =>", vt, re.S)
dev = {first_segment(x) for x in re.findall(r'"(/[^"]+)"', block.group(1))} if block else set()

# ── what the app actually asks for ───────────────────────────────────────
asked = set()
for f in (ROOT / "src").rglob("*.ts*"):
    for m in re.finditer(r'ingressPath\("([^"]+)"', f.read_text(encoding="utf-8")):
        asked.add(first_segment(m.group(1)))

print(f"  nginx forwards : {' '.join(sorted(forwarded))}")
print(f"  proxy answers  : {' '.join(sorted(routes))}")
print(f"  dev forwards   : {' '.join(sorted(dev))}")
print(f"  app requests   : {' '.join(sorted(asked))}\n")

orphan_locations = sorted(forwarded - routes)
ck("every nginx location has a route behind it", not orphan_locations,
   f"published but unanswerable: {', '.join(orphan_locations)}")

# `/model` is served by nginx from disk with an auth subrequest, so it is
# deliberately not a proxy route; everything else the app asks for must be.
unreachable = sorted(asked - routes - {"/model"})
ck("every path the app requests is answered", not unreachable,
   f"the app fetches these and nothing answers: {', '.join(unreachable)}")

missing_dev = sorted(asked - dev - {"/model"})
ck("the dev server forwards everything the app requests", not missing_dev,
   f"`npm run dev` would 404: {', '.join(missing_dev)}")

# ── the owner credential every forwarded request carries ─────────────────
# `_is_ingress` trusts `X-VK-Ingress: 1` as the owner, which is only safe
# because nginx OVERWRITES the client's value — per location, since a location
# with any proxy_set_header of its own inherits none. One snippet sets it; each
# location reaching the proxy must include that snippet, and none may set the
# header by hand (a hand-written copy is the thing that drifts).
SNIPPET = NGINX.parent / "snippets" / "backend-proxy.conf"
INCLUDE = "include /etc/nginx/snippets/backend-proxy.conf;"
sn = SNIPPET.read_text() if SNIPPET.exists() else ""
ck("the backend snippet overwrites X-VK-Ingress from the trusted variable",
   re.search(r"^\s*proxy_set_header\s+X-VK-Ingress\s+\$vk_ingress;", sn, re.M) is not None)
to_backend = [(m.group(2), m.group(3)) for m in
              re.finditer(r"location\s+(=\s*)?(\S+)\s*\{([^}]*)\}", ng)
              if "127.0.0.1:8100" in m.group(3)]
missing = [loc for loc, body in to_backend if INCLUDE not in body]
ck(f"all {len(to_backend)} locations reaching the proxy include the snippet",
   bool(to_backend) and not missing,
   f"forwards the CLIENT's X-VK-Ingress (owner access): {', '.join(missing)}")
by_hand = [loc for loc, body in to_backend if "X-VK-Ingress" in body]
ck("no location sets X-VK-Ingress by hand", not by_hand,
   f"a hand-written copy: {', '.join(by_hand)}")

# ── what the service worker may serve from its cache ─────────────────────
# Its rule, read from sw.js: a path containing one of the `includes(...)`
# fragments, or ending with a NEVER_CACHE entry, goes to the network. Tried
# on the BARE path — the standalone hostname, where the add-on's endpoints
# are not under /api/ and only the explicit list protects them.
sw = SW.read_text()
nc = re.search(r"const NEVER_CACHE = \[(.*?)\];", sw, re.S)
never = re.findall(r'"([^"]+)"', nc.group(1)) if nc else []
guard = sw[nc.end():sw.index("return; // default network handling", nc.end())] if nc else ""
fragments = re.findall(r'url\.pathname\.includes\("([^"]+)"\)', guard)
ck("the service worker's never-cache rule was read", bool(never) and bool(fragments),
   f"list {never}, fragments {fragments}")


def sw_skips(path: str) -> bool:
    return any(f in path for f in fragments) or any(path.endswith(p) for p in never)


# Cacheable ON PURPOSE — and why. Anything else a GET reaches must be skipped.
SW_CACHEABLE = {
    "/fm-evidence/x": "a photo under a never-reused id: content-addressed",
    "/core/websocket": "a websocket, which never passes through a fetch event",
}
gets = [re.sub(r"\{[^}]*\}", "x", m.group(1)) for m in
        re.finditer(r'app\.router\.add_(?:get|route)\(\s*(?:"[A-Z*]+"\s*,\s*)?"([^"]+)"', px)]
cached = sorted(p for p in gets if not sw_skips(p) and p not in SW_CACHEABLE)
ck(f"every one of the proxy's {len(gets)} GET routes is kept out of the offline cache", bool(gets) and not cached,
   f"the service worker would serve these from its cache: {', '.join(cached)}")
stale = sorted(p for p in SW_CACHEABLE if p not in gets)
ck("  ...and every deliberately cacheable path is still a route", not stale,
   f"no longer routes: {', '.join(stale)}")

# ── the security headers are written once (round 11, 2.496.173) ──────────
# nginx drops every inherited add_header in a location that sets its own, so
# the five headers live in one snippet that the server level AND each such
# location include, and the CSP in another. They were also written out at the
# server level, the CSP twice word for word.
SNIPS = NGINX.parent / "snippets"
SEC = ("X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options",
       "Permissions-Policy", "Strict-Transport-Security", "Content-Security-Policy")
by_hand = [h for h in SEC if re.search(rf"^\s*add_header\s+{h}", ng, re.M)]
ck("nginx.conf writes no security header by hand (the snippets hold them)", not by_hand,
   f"written out in nginx.conf: {', '.join(by_hand)}")
snip_text = "".join(f.read_text() for f in sorted(SNIPS.glob("*.conf")))
csp_count = len(re.findall(r"^\s*add_header\s+Content-Security-Policy", snip_text, re.M))
ck("  ...the CSP is written exactly once", csp_count == 1, f"{csp_count} copies")
server_block = ng[re.search(r"^\s*server\s*\{", ng, re.M).start():]
first_loc = re.search(r"^\s*location\s", server_block, re.M).start()
ck("  ...the server level includes both snippets",
   all(f"include /etc/nginx/snippets/{n}.conf;" in server_block[:first_loc] for n in ("security-headers", "csp")))
own = [m.group(2) for m in re.finditer(r"location\s+(=\s*|~\*?\s*)?(\S+)\s*\{([^}]*)\}", ng)
       if "add_header" in m.group(3) and "include /etc/nginx/snippets/security-headers.conf;" not in m.group(3)]
ck("  ...and every location with an add_header of its own includes the headers again", not own,
   f"these drop them: {', '.join(own)}")

# ── each layer's body cap sits above the one inside it (round 11, 2.496.173) ─
# A body passes the client, then nginx, then the proxy. nginx's cap must not
# be the tighter one — its bare 413 would stand in for the proxy's own
# explanation ("event too large", "…exceeds the limit") — and the client's
# model upload must fit under HA Ingress's ~16 MB per-request cap, which no
# setting here can raise. Three files in three languages, ordered here.
def _num(expr: str) -> int:
    return int(eval(expr.replace("_", ""), {"__builtins__": {}}))  # constant arithmetic only


def _py(name: str) -> int:
    m = re.search(rf"^{name}\s*=\s*([0-9_ *]+)", px, re.M)
    return _num(m.group(1)) if m else -1


def _nginx_cap(loc: str) -> int:
    m = re.search(rf"location\s+(=\s*)?{re.escape(loc)}\s*\{{([^}}]*)\}}", ng)
    cap = re.search(r"client_max_body_size\s+(\d+)([kKmM]?)", m.group(2)) if m else None
    if not cap:
        return -1
    return int(cap.group(1)) * {"": 1, "k": 1024, "m": 1024 ** 2}[cap.group(2).lower()]


CAPS = {"/device-config": "DEVICE_CONFIG_MAX_BYTES", "/fm-data": "FM_DATA_MAX_BYTES",
        "/fm-evidence": "FM_EVIDENCE_MAX_BYTES", "/telemetry": "TELEMETRY_MAX_BODY",
        "/model-upload": "MAX_UPLOAD_BYTES"}
tighter = [f"{loc} nginx {_nginx_cap(loc)} < proxy {_py(name)}" for loc, name in CAPS.items()
           if _nginx_cap(loc) < _py(name) or _py(name) < 0]
ck(f"nginx's body cap is never tighter than the proxy's ({len(CAPS)} endpoints)", not tighter,
   "; ".join(tighter))
cm = (ROOT / "src" / "utils" / "centralModel.ts").read_text()
ts = {k: _num(re.search(rf"const {k} = ([0-9 *]+);", cm).group(1)) for k in ("SINGLE_SHOT_MAX_BYTES", "UPLOAD_CHUNK_BYTES")}
INGRESS_CAP = 16 * 1000 * 1000  # HA Ingress's per-request limit (~16 MB), Supervisor-side
ck("  ...and every model-upload request fits HA Ingress's ~16 MB (single shot and each chunk)",
   max(ts.values()) < INGRESS_CAP and max(ts.values()) <= _nginx_cap("/model-upload"), str(ts))

# ── what CI pulls in is named by commit, and the build is the lockfile's ──
# A moving tag (`@v4`) lets whoever holds that tag change what runs with the
# repository's own secrets; a commit cannot move (2.496.207). And `npm
# install` may rewrite the lockfile to satisfy package.json — the step after
# it fails the build if it did, which is what `npm ci` would have refused.
print("\n  supply chain:")
for wf in sorted((ROOT / ".github" / "workflows").glob("*.yaml")):
    loose = [l.strip() for l in wf.read_text().splitlines()
             if re.match(r"\s*(- )?uses: [^.]", l) and not re.search(r"@[0-9a-f]{40}\b", l)]
    ck(f"{wf.name}: every action is pinned to a commit", not loose, "; ".join(loose))
ci = (ROOT / ".github" / "workflows" / "ci.yaml").read_text()
ck("ci.yaml checks the lockfile after npm install, and reports a rewrite where it can be read",
   ci.index("run: npm install") < ci.index("git diff --quiet -- package-lock.json")
   and "::warning title=package-lock.json rewritten" in ci)

# ── the proxy runs unprivileged, and writes only where that user owns ──────
print("\n  who runs the proxy:")
run = (ROOT / "rootfs" / "etc" / "s6-overlay" / "s6-rc.d" / "supervisor-proxy" / "run").read_text()
dockerfile = (ROOT / "Dockerfile").read_text()
ck("the s6 run script drops to `vesta` after handing it /data",
   run.index("chown -R vesta:vesta /data") < run.index("exec s6-setuidgid vesta python3 /usr/bin/supervisor-proxy.py"))
ck("  ...and the image creates that account (no home, no shell)", re.search(r"adduser -D -H -s /sbin/nologin\b.* vesta\b", dockerfile) is not None)
# Filesystem paths only: a module-level `X_FILE/_DIR/_ROOT = "/…"` constant or
# a literal handed to open()/os.* — HTTP routes ("/auth/verify") are not files.
src = PROXY.read_text()
fs = set(re.findall(r'^[A-Z_]+(?:_FILE|_DIR|_ROOT) = "(/[^"]+)"', src, re.M))
fs |= set(re.findall(r'(?:open|os\.\w+)\(\s*"(/[^"]+)"', src))
outside = sorted(p for p in fs if not p.startswith(("/data/", "/usr/share/vesta/")))
ck(f"every filesystem path the proxy names ({len(fs)}) is under /data or the read-only table", fs and not outside, "; ".join(outside))
ck("an unreadable options file reads as nothing configured (closed), not a crash",
   "except (OSError, ValueError):\n        return {}" in PROXY.read_text())

print()
print("✅ the four path lists agree" if FAIL == 0 else "❌ THE PATH LISTS DISAGREE")
sys.exit(1 if FAIL else 0)
