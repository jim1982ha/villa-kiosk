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

Run: python3 tests/routes.py   (also `npm run test:routes`)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NGINX = ROOT / "rootfs" / "etc" / "nginx" / "nginx.conf"
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
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

print()
print("✅ the four path lists agree" if FAIL == 0 else "❌ THE PATH LISTS DISAGREE")
sys.exit(1 if FAIL else 0)
