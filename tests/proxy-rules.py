#!/usr/bin/env python3
"""The proxy's pure security rules, pinned.

⚠️ THIS IS THE FIRST TEST ON THIS BRANCH THAT REACHES THE PROXY AT ALL. 2,073
lines of authentication, role gating and brute-force limiting shipped to a
production kiosk with nothing in the pipeline that so much as parsed them. A
large part of that logic is already pure — it takes strings and returns a
boolean — and needed no network, no filesystem and no aiohttp to exercise. It
simply had nothing to run it.

⚠️ `importlib`, BECAUSE THE FILENAME HAS A HYPHEN. `import supervisor_proxy` is
impossible, which is a small part of why nothing ever pinned this. Loading it by
path costs four lines and removes the excuse.

⚠️ AND IT IMPORTS THE SHIPPED FILE, not a copy. A transcription would agree with
itself forever while the module moved.

Run: python3 tests/proxy-rules.py   (also `npm run test:proxy`)
"""
from __future__ import annotations

import importlib.util
import inspect
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"

spec = importlib.util.spec_from_file_location("vk_proxy", PROXY)
assert spec and spec.loader
# ⚠️ NAME THE MISSING DEPENDENCY RATHER THAN TRACEBACK THROUGH IT. The proxy
# imports aiohttp at module scope, so on a machine without it this file dies
# 200 lines away from the cause, inside a module it was only trying to read.
try:
    import aiohttp  # noqa: F401
except ModuleNotFoundError:
    print("  FAIL  aiohttp is not installed — supervisor-proxy.py imports it at "
          "module scope, so none of the rules below can be checked. "
          "`python3 -m pip install aiohttp` (the image ships py3-aiohttp).")
    sys.exit(1)

proxy = importlib.util.module_from_spec(spec)
sys.modules["vk_proxy"] = proxy
spec.loader.exec_module(proxy)

FAIL = 0


def ck(name: str, ok: bool) -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAIL += 1


print(f"  loaded {PROXY.relative_to(ROOT)} "
      f"({len(PROXY.read_text().splitlines())} lines)\n")

# ── the brute-force backstop is a RATE, not a lifetime counter ────────────
# It counted wrong PINs per role from process start with nothing ageing it, so
# the 50th CUMULATIVE mistake — across every guest and every tablet, over weeks
# of uptime — locked that role out for everyone including the owner.
print("  the global lockout:")
role = proxy.AUTH_ROLES[0]
window = proxy.AUTH_GLOBAL_LOCKOUT_SECONDS
limit = proxy.AUTH_GLOBAL_MAX_FAILURES


def reset() -> None:
    for hits in proxy._auth_failures_global.values():
        hits[:] = []


reset()
for i in range(limit):
    proxy._note_global_failure(role, now=1000.0 + i)
locked_at_limit = proxy._global_locked_for(role, now=1000.0 + limit)

reset()
for i in range(limit - 1):
    proxy._note_global_failure(role, now=1000.0 + i)
quiet_below_limit = proxy._global_locked_for(role, now=1000.0 + limit)

# The trickle that shipped the defect: one mistake per window, forever.
reset()
trickle_locked = 0
for i in range(limit * 4):
    t = 1000.0 + i * (window + 1)
    proxy._note_global_failure(role, now=t)
    if proxy._global_locked_for(role, now=t) > 0:
        trickle_locked += 1

# ...and a guesser who stops is released when the OLDEST failure ages out.
reset()
for i in range(limit):
    proxy._note_global_failure(role, now=1000.0 + i)
released = proxy._global_locked_for(role, now=1000.0 + window + 1)

print(f"      {limit} inside the window   -> locked for {locked_at_limit}s")
print(f"      {limit - 1} inside the window   -> locked for {quiet_below_limit}s")
print(f"      {limit * 4} spread one per window -> locked {trickle_locked} time(s)")
print(f"      after the window passes -> locked for {released}s")

ck("the limit inside one window locks the role", locked_at_limit > 0)
ck("one short of the limit does not", quiet_below_limit == 0)
ck("a slow trickle NEVER locks the villa out", trickle_locked == 0)
ck("and a guesser who stops is released", released == 0)
ck("the bucket cannot grow without bound",
   all(len(h) <= limit for h in proxy._auth_failures_global.values()))

# ⚠️ THE TWO AGEING SITES ARE PINNED SEPARATELY, AND THEY HAVE TO BE. `_note…`
# applies the window when recording and `_global_locked_for` applies it when
# reading — so with only end-to-end assertions, breaking EITHER one leaves the
# other covering for it and the suite stays green. Mutation-testing this file
# caught exactly that: two of three lockout mutations passed.
reset()
for i in range(limit * 3):
    proxy._note_global_failure(role, now=1000.0 + i * (window + 1))
ck("  ...because RECORDING drops what has aged out",
   len(proxy._auth_failures_global[role]) == 1)

reset()
# A stale list planted directly: only the read side can age this.
# ⚠️ THE ASSERTION IS ON THE TRIM, NOT ON THE RETURN VALUE. Checking only that
# it answers "not locked" passed even with the read-side ageing removed — the
# `remaining <= 0` branch returns 0 for a stale bucket either way. What that
# line actually does is empty the list, so that is what this looks at.
proxy._auth_failures_global[role][:] = [500.0] * limit
answer = proxy._global_locked_for(role, now=500.0 + window + 1)
ck("  ...and READING ages a stale bucket too",
   answer == 0 and len(proxy._auth_failures_global[role]) == 0)

# The superadmin code is its own bucket: this handler is reached by an owner or
# a facility manager, so charging their role would blame the wrong one.
reset()
proxy._note_global_failure(proxy.SUPERADMIN, now=2000.0)
ck("a superadmin failure lands in the superadmin bucket",
   len(proxy._auth_failures_global[proxy.SUPERADMIN]) == 1
   and all(len(proxy._auth_failures_global[r]) == 0 for r in proxy.AUTH_ROLES))

# ⚠️ AND THE CALL SITE, NOT JUST THE HELPER. The helper being right says nothing
# about which bucket the handler charges — the superadmin code is entered by an
# owner or a facility manager, so passing that session's `role` would blame the
# wrong tier AND leave the superadmin one never accumulating. Testing the helper
# alone stays green straight through that; it did.
_src = PROXY.read_text()
# ⚠️ THE CALL SITE, AND THIS CHECK USED NOT TO FIND IT. It localised the
# superadmin handler into `_elevate` and then searched `_src` — the whole
# 2,200-line file — so it proved only that both strings exist SOMEWHERE. Move
# the SUPERADMIN charge out of the handler into any other function and it stayed
# green; a comment containing the text satisfied it too. `_elevate` was computed
# and never read: the vestige of the check that was intended.
# The old form searched for "def superadmin", which is not the handler's name —
# it is `auth_elevate_handler` — so the guard clause was never true and the
# check ALWAYS scanned the whole file. Asking which function ENCLOSES each call
# is the question that was meant, and it cannot be fooled by a rename.
_code = re.sub(r"#.*", "", _src)          # a mention in prose is not a call
def _enclosing(needle: str) -> str:
    """Which function contains the first CALL matching `needle`.

    ⚠️ SKIPS THE DEFINITION. The first attempt matched
    `def _note_global_failure(role: str, ...)` — the function's own signature —
    and reported it as the call site, which is the same mistake as pinning a
    symbol by its import line. Callers are matched by the argument list they
    pass, and any line beginning `def`/`async def` is refused outright.
    """
    i = -1
    while True:
        i = _code.find(needle, i + 1)
        if i < 0:
            return ""
        line_start = _code.rfind("\n", 0, i) + 1
        if not _code[line_start:i].lstrip().startswith(("def ", "async def ")):
            break
    if i < 0:
        return ""
    j = _code.rfind("\ndef ", 0, i)
    k = _code.rfind("\nasync def ", 0, i)
    start = max(j, k)
    if start < 0:
        return ""
    return _code[start + 1:_code.index("(", start)].replace("async def ", "").replace("def ", "")

ck("  the SUPERADMIN charge sits in the elevation handler",
   _enclosing("_note_global_failure(SUPERADMIN,") == "auth_elevate_handler")
ck("  ...and the caller's-role charge sits in the passcode handler",
   _enclosing("_note_global_failure(role,") == "auth_verify_handler")

# ── the REST allow-list fails CLOSED ──────────────────────────────────────
# Every string below reached Core from a guest session before the rule became a
# default-deny, and each is listed in the function's own docstring. They are the
# regression vector for the worst defect this file records.
print("\n  the REST allow-list (a non-owner session):")
BYPASSES = [
    "SERVICES/lock/unlock",
    "./services/lock/unlock",
    "services//lock/unlock",
    "services/../services/lock/unlock",
    "services/lock/unlock%00",
    "services/lock/unlock;a=b",
    "./template",
]
denied = [t for t in BYPASSES if not proxy._rest_call_allowed("guest", t)]
for t in BYPASSES:
    mark = "denied" if not proxy._rest_call_allowed("guest", t) else "ALLOWED"
    print(f"      {mark:>7}  {t}")
ck("every documented bypass is denied", len(denied) == len(BYPASSES))
ck("an empty tail is denied", not proxy._rest_call_allowed("guest", ""))
ck("the owner is exempt, as documented", proxy._rest_call_allowed("owner", "template"))

# ── an open websocket does not outlive its session ────────────────────────
# `role` was decided at the handshake and captured into the relay loop, which
# never looked at the cookie again — so "log out all devices" could not reach a
# tablet that was already connected, and the websocket is where service calls
# go. The loop itself needs aiohttp, so the wiring is pinned at the call site
# and the machinery it depends on is pinned behaviourally.
print("\n  the websocket's session lifetime:")
src = PROXY.read_text()
ck("the relay loop re-validates before relaying",
   "_still_valid(force=" in src and "await client.close(code=4401" in src)
ck("  ...and forces the check on a service call",
   'force=obj.get("type") == "call_service"' in src)
ck("the re-check reads the COOKIE, not a captured role",
   "_session_role(request.cookies.get(SESSION_COOKIE))" in src)

# The epoch is what logout-all bumps, and it is now cached — so the cache MUST
# notice a bump or the fix above is inert.
import os, tempfile, time as _t
with tempfile.TemporaryDirectory() as tmp:
    epoch_file = os.path.join(tmp, "session-epoch")
    proxy.SESSION_EPOCH_FILE = epoch_file
    proxy._EPOCH_CACHE = None
    with open(epoch_file, "w") as fh:
        fh.write("7")
    first = proxy._session_epoch()
    again = proxy._session_epoch()          # served from cache
    _t.sleep(0.01)
    with open(epoch_file, "w") as fh:
        fh.write("8")
    os.utime(epoch_file, ns=(_t.time_ns(), _t.time_ns()))
    after = proxy._session_epoch()
print(f"      epoch {first} -> cached {again} -> after a bump {after}")
ck("the epoch cache serves the same answer twice", first == 7 and again == 7)
ck("  ...and NOTICES a bump, or logout-all would be inert", after == 8)

# ── service calls are gated by role ───────────────────────────────────────
print("\n  service calls:")
ck("a guest may not call an arbitrary domain",
   not proxy._service_call_allowed("guest", "shell_command", "anything"))
ck("the owner may", proxy._service_call_allowed("owner", "shell_command", "anything"))

# ── a store that cannot be read is not an empty store ─────────────────────
# ⚠️ THE ONE THAT DESTROYED DATA. Absent and unreadable both degraded to
# `empty`, so the facility delete guard — whose entire question is "what
# disappeared" — diffed against nothing, found nothing removed, skipped the
# superadmin elevation, and let the write through. The evidence sweep then ran
# with the same empty baseline and deleted every photo the unreadable records
# referenced. The caller saw {"ok": true}.
print("\n  a store that cannot be read:")
with tempfile.TemporaryDirectory() as tmp:
    missing = os.path.join(tmp, "never-written.json")
    v, ok = proxy._read_json_store_status(missing, {})
    ck("an ABSENT store is empty, and readable — nothing has been written yet",
       v == {} and ok is True)

    corrupt = os.path.join(tmp, "corrupt.json")
    with open(corrupt, "w") as fh:
        fh.write("{not json at all")
    v, ok = proxy._read_json_store_status(corrupt, {})
    ck("a CORRUPT store reads as empty but is NOT readable", v == {} and ok is False)

    wrong = os.path.join(tmp, "wrong-type.json")
    with open(wrong, "w") as fh:
        fh.write('["a list where an object belongs"]')
    v, ok = proxy._read_json_store_status(wrong, {})
    ck("  ...and so does one holding the wrong top-level type",
       v == {} and ok is False)

    good = os.path.join(tmp, "good.json")
    with open(good, "w") as fh:
        fh.write('{"tickets": []}')
    v, ok = proxy._read_json_store_status(good, {})
    ck("a readable store comes back with its contents",
       v == {"tickets": []} and ok is True)

    ck("the degrading read still exists for callers that only render",
       proxy._read_json_store(corrupt, {}) == {})

# The sweep must not delete on a baseline nobody could read, whichever caller
# reaches it — the PUT path refuses such a write, and this is the second lock.
with tempfile.TemporaryDirectory() as tmp:
    proxy.FM_EVIDENCE_DIR = tmp
    photo = os.path.join(tmp, "a" * 32 + ".jpg")
    with open(photo, "wb") as fh:
        fh.write(b"\xff\xd8\xff")
    # ⚠️ A CURRENT MTIME, ON PURPOSE. The first attempt set this to epoch 0,
    # and the assertion failed on correct code: retention still runs on an
    # unreadable baseline (it is time-based and asks no document anything), so
    # an ancient file is collected whatever the references say. The fixture was
    # measuring retention while claiming to measure the reference sweep.
    old_doc = {"tickets": [{"id": "t", "photoIds": ["a" * 32]}]}
    proxy._fm_after_write({}, {"tickets": []}, False)
    ck("an unreadable baseline deletes NO referenced evidence",
       os.path.exists(photo))
    proxy._fm_after_write(old_doc, {"tickets": []}, True)
    ck("  ...while a real delete against a READ baseline still collects it",
       not os.path.exists(photo))

# ── the websocket gate: default deny, and no camera for guest ─────────────
# The guest refusal named `camera/stream` alone, which was every way into a
# camera's picture only while HLS was the only way. WebRTC added four more.
print("\n  the websocket gate:")
refuse = lambda role, t, **kw: proxy._ws_frame_refusal(role, {"type": t, **kw})
cams = sorted(proxy.CAMERA_WS_TYPES)
ck("every camera command is on the allowlist",
   proxy.CAMERA_WS_TYPES <= proxy.ALLOWED_WS_TYPES)
ck("the WebRTC offer is a camera command, so it is covered",
   "camera/webrtc/offer" in proxy.CAMERA_WS_TYPES)
ck("guest is refused EVERY camera command",
   all(refuse("guest", t) for t in cams))
ck("ops may open every camera command",
   not any(refuse("ops", t) for t in cams))
ck("owner is exempt, even from the allowlist",
   refuse("owner", "config/entity_registry/update") is None)

# ── one table for what the kiosk sends (round 10, 2.496.151) ──────────────
# The allow-lists were the proxy's own copy, "kept in sync" by a comment; the
# Energy window's energy/info, scene.turn_on and input_boolean.toggle were all
# refused for non-owners while the app offered them.
print("\n  what the kiosk sends — one table:")
import json as _json  # noqa: E402
_table = _json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                      "rootfs", "usr", "share", "vesta", "ha-commands.json"), encoding="utf-8"))
ck("the proxy's lists ARE the table's (websocket + camera, domains, homeassistant services)",
   proxy.ALLOWED_WS_TYPES == frozenset(_table["websocket"]) | frozenset(_table["camera"])
   and proxy.CAMERA_WS_TYPES == frozenset(_table["camera"])
   and proxy.ALLOWED_SERVICE_DOMAINS == frozenset(_table["serviceDomains"])
   and proxy.ALLOWED_HOMEASSISTANT_SERVICES == frozenset(_table["homeassistantServices"]))
ck("a guest's Energy window may read its cost (energy/info)", refuse("guest", "energy/info") is None)
ck("a guest may run a scene and toggle an input_boolean (the app offers both)",
   refuse("guest", "call_service", domain="scene", service="turn_on") is None
   and refuse("guest", "call_service", domain="input_boolean", service="toggle") is None)
ck("  ...still never a system service or a write frame",
   refuse("guest", "call_service", domain="homeassistant", service="restart") is not None
   and refuse("guest", "call_service", domain="script", service="turn_on") is not None
   and refuse("guest", "fire_event") is not None)
ck("an unreadable table fails CLOSED (no non-owner access), never open",
   'return {}' in inspect.getsource(proxy._load_ha_commands) and 'HA_COMMANDS.get("websocket", ())' in inspect.getsource(proxy))
ck("an unlisted command is refused for ops",
   refuse("ops", "config/entity_registry/update") is not None)
ck("  ...and for guest",
   refuse("guest", "render_template") is not None)
ck("guest keeps what is not a camera",
   refuse("guest", "get_states") is None)
# The call_service decision used to live inline in the relay loop, reachable
# only by searching the source text. It is the frame that operates the doors.
ck("a guest may unlock a door over the websocket (by design)",
   refuse("guest", "call_service", domain="lock", service="unlock") is None)
ck("a guest may NOT restart Home Assistant over the websocket",
   refuse("guest", "call_service", domain="homeassistant", service="restart") is not None)
ck("  ...nor run a script",
   refuse("ops", "call_service", domain="script", service="turn_on") is not None)

# ── one policy, two doors ────────────────────────────────────────────────
# REST and the websocket are two ways to ask Core the same things. Each used
# to carry its own `role == ...` copy of the rules; both now ask the one
# ROLE_CAPABILITIES table, and this holds them to the same answer per role.
print("\n  the two doors agree:")
SERVICE_CASES = [("lock", "unlock"), ("light", "turn_on"), ("homeassistant", "toggle"),
                 ("homeassistant", "restart"), ("script", "turn_on"), ("hassio", "addon_stop")]
disagree = []
for role in proxy.AUTH_ROLES:
    rest_cam = proxy._rest_call_allowed(role, "camera_proxy/camera.any")
    rest_mjpeg = proxy._rest_call_allowed(role, "camera_proxy_stream/camera.any")
    ws_cam = refuse(role, "camera/stream") is None
    if not (rest_cam == rest_mjpeg == ws_cam):
        disagree.append(f"{role}: cameras rest={rest_cam}/{rest_mjpeg} ws={ws_cam}")
    for d, sv in SERVICE_CASES:
        rest = proxy._rest_call_allowed(role, f"services/{d}/{sv}")
        ws = refuse(role, "call_service", domain=d, service=sv) is None
        if rest != ws:
            disagree.append(f"{role}: {d}.{sv} rest={rest} ws={ws}")
    print(f"      {role:>5}: cameras {'yes' if ws_cam else 'no ':>3} · services "
          + " ".join(f"{d}.{sv}={'y' if proxy._rest_call_allowed(role, f'services/{d}/{sv}') else 'n'}"
                     for d, sv in SERVICE_CASES))
ck("every role gets the same answer through both doors", not disagree)
for line in disagree:
    print(f"          {line}")
ck("guest cannot fetch a camera image over REST",
   not proxy._rest_call_allowed("guest", "camera_proxy/camera.any"))
ck("guest can still read history (the charts)",
   proxy._rest_call_allowed("guest", "history/period/2026-01-01T00:00:00+08:00"))

# ── the proxy's table and the kiosk's agree ──────────────────────────────
# permissions.ts decides what each profile is SHOWN; ROLE_CAPABILITIES what it
# may DO. Two halves of one rule, so the names they share must mean the same
# thing for every role, or the kiosk offers a button the proxy refuses (or
# hides one the proxy would allow).
print("\n  the proxy's roles and the kiosk's:")
PERMS = ROOT / "src" / "auth" / "permissions.ts"
pt = PERMS.read_text()
matrix = pt[pt.index("const PERMISSION_MATRIX"):]
client = {}
for role in proxy.AUTH_ROLES:
    m = re.search(rf"\b{role}:\s*\{{(.*?)\n  \}}", matrix, re.S)
    body = m.group(1) if m else ""
    caps = re.search(r"capabilities:\s*\[(.*?)\]", body, re.S)
    denied = re.search(r"deniedTypes:\s*\[(.*?)\]", body, re.S)
    client[role] = (set(re.findall(r'"(\w+)"', caps.group(1))) if caps else set(),
                    set(re.findall(r'"(\w+)"', denied.group(1))) if denied else set())
ck("the kiosk's matrix was read for every role",
   all(client[r][0] for r in proxy.AUTH_ROLES))
SHARED = ("editConfig", "manageModel", "manageFacility", "reportFault")
mismatch = [f"{r}.{c}" for r in proxy.AUTH_ROLES for c in SHARED
            if (c in client[r][0]) != proxy._may(r, c)]
ck("every shared capability means the same thing on both sides", not mismatch)
if mismatch:
    print(f"          the proxy and permissions.ts disagree on: {', '.join(mismatch)}")
cam_mismatch = [r for r in proxy.AUTH_ROLES
                if ("camera" not in client[r][1]) != proxy._may(r, "viewCameras")]
ck("viewCameras is exactly the roles the kiosk shows cameras to", not cam_mismatch)
if cam_mismatch:
    print(f"          disagree for: {', '.join(cam_mismatch)}")
ck("an unknown role holds nothing",
   not any(proxy._may("intruder", c) for caps in proxy.ROLE_CAPABILITIES.values() for c in caps))

print()
print("✅ the proxy's pure rules hold" if FAIL == 0
      else "❌ A PROXY RULE IS BROKEN")
sys.exit(1 if FAIL else 0)
