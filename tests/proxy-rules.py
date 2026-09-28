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
   _enclosing("_auth_failed(SUPERADMIN,") == "auth_elevate_handler")
ck("  ...and the caller's-role charge sits in the passcode handler",
   _enclosing("_auth_failed(role,") == "auth_verify_handler")
ck("  ...and the agent's in the agent's gate",
   _enclosing("_auth_failed(AGENT,") == "_agent_refuse")

# ── the limiter's interface: ask, fail, succeed ───────────────────────────
# Every door that takes a secret goes through `_lockout_remaining`,
# `_auth_failed` and `_auth_succeeded`; the write side used to be copied into
# three handlers. Driven here by value, per bucket and per caller.
print("\n  the limiter (ask · fail · succeed):")
proxy._auth_failures.clear()
reset()
A, B = "203.0.113.9", "198.51.100.7"
for _ in range(proxy.AUTH_MAX_FAILURES - 1):
    proxy._auth_failed(role, A)
ck("one short of the per-caller limit is not locked",
   proxy._lockout_remaining(role, A) == 0)
proxy._auth_failed(role, A)
ck("the limit locks that caller", proxy._lockout_remaining(role, A) > 0)
ck("...not another caller", proxy._lockout_remaining(role, B) == 0)
ck("...nor the same caller in another bucket",
   proxy._lockout_remaining(proxy.SUPERADMIN, A) == 0)
ck("each failure also counts toward the bucket's global rate",
   len(proxy._auth_failures_global[role]) == proxy.AUTH_MAX_FAILURES)
proxy._auth_failures.clear()
reset()
for _ in range(proxy.AUTH_MAX_FAILURES - 1):
    proxy._auth_failed(role, A)
proxy._auth_succeeded(role, A)
proxy._auth_failed(role, A)
ck("a success clears that caller's count",
   proxy._lockout_remaining(role, A) == 0
   and proxy._auth_failures[(role, A)]["count"] == 1)
ck("...and leaves the global rate alone (one right PIN cannot reset a campaign)",
   len(proxy._auth_failures_global[role]) == proxy.AUTH_MAX_FAILURES)
proxy._auth_succeeded(role, "192.0.2.77")
ck("a success from an unknown caller tracks nothing",
   (role, "192.0.2.77") not in proxy._auth_failures)
proxy._auth_failed("agent-" + role, A)
ck("a new bucket needs no registration",
   len(proxy._auth_failures_global["agent-" + role]) == 1)
proxy._auth_failures.clear()
reset()
# ...and nothing else touches its state: a fourth door copying the write side
# is exactly what this interface exists to stop.
_LIMITER = {"_prune_auth_failures", "_lockout_remaining", "_auth_failed",
            "_auth_succeeded", "_note_global_failure", "_global_locked_for"}
_touching = sorted(
    name for name, fn in inspect.getmembers(proxy, inspect.isfunction)
    if fn.__module__ == proxy.__name__ and name not in _LIMITER
    and re.search(r"\b_auth_failures(_global)?\b",
                  re.sub(r"#.*", "", inspect.getsource(fn)).split('"""')[-1]))
ck(f"only the limiter touches the limiter's state {_touching or ''}", not _touching)

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
    proxy.DATA_DIR = tmp
    epoch_file = proxy._data(proxy.SESSION_EPOCH_NAME)
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
    proxy.DATA_DIR = tmp
    os.makedirs(proxy._data(proxy.FM_EVIDENCE_NAME))
    photo = os.path.join(proxy._data(proxy.FM_EVIDENCE_NAME), "a" * 32 + ".jpg")
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
SHARED = ("editConfig", "manageModel", "manageFacility", "reportFault", "viewAgent")
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

# ── every route is gated, or public on purpose (round 11, 2.496.169) ──────
# The gate was written out by hand at twelve handlers and had drifted into two
# 403 shapes; it is one call now (_refuse). A NEW handler that forgets it is an
# open endpoint with every other check green — so each routed handler must
# call _refuse (or the model gate, which adds the public_model_access option,
# or the VESTA Agent's bearer gate _agent_refuse — /agent/v1/*, and store
# handlers built with gate=_agent_refuse), or be named here with the reason it
# answers without a session.
PUBLIC_HANDLERS = {
    "auth_roles_handler": "the profile screen lists the roles before anyone signs in",
    "auth_session_handler": "answers 'is there a session' — to anyone, by design",
    "auth_verify_handler": "the sign-in itself (rate-limited)",
    "auth_logout_handler": "clears the caller's own cookie",
}
routed = re.findall(r'app\.router\.add_\w+\(\s*(?:"[A-Z*]+"\s*,\s*)?"[^"]+"\s*,\s*(\w+)',
                    PROXY.read_text())
ungated = sorted({h for h in routed if h not in PUBLIC_HANDLERS
                  and not re.search(r"\b_refuse\(request|\b_model_authorized\(request"
                                    r"|\b_agent_refuse\(request|\bgate\(request",
                                    inspect.getsource(getattr(proxy, h)))})
ck(f"all {len(set(routed))} routed handlers are gated (_refuse), or named public with a reason",
   len(routed) > 10 and not ungated)
if ungated:
    print(f"          answer without a session: {', '.join(ungated)}")
stale_public = sorted(h for h in PUBLIC_HANDLERS if h not in routed)
ck("  ...and every handler named public is still routed", not stale_public)
hand = [n for n, f in vars(proxy).items() if n.endswith("_handler") and callable(f)
        and re.search(r"if not _authorized\(request\)", inspect.getsource(f))]
ck("  ...no handler writes the gate out by hand again", not hand)
if hand:
    print(f"          by hand: {', '.join(hand)}")

# ── a guest reads NOTHING of the Facility record (round 13, 2.496.182) ────
# The GET was open to every session, so every guest phone downloaded every
# cost, note and fault. A profile without manageFacility now reads an empty
# record; what it writes is merged onto the real one, new reports only.
_real_role_for = proxy._role_for
STORED = {"schedules": [{"id": "s1"}], "completions": [{"id": "c1"}], "costs": [{"id": "k1", "amount": 9}],
          "tickets": [{"id": "t1", "status": "open", "reportedBy": "owner"}], "savedDocuments": []}
try:
    proxy._role_for = lambda _r: "guest"
    view = proxy._fm_reader_view(None, STORED)
    ck("a guest's view of the record is EMPTY — no cost, note, fault or completion",
       all(view[c] == [] for c in proxy.FM_RECORD_COLLECTIONS) and set(view) == set(proxy.FM_RECORD_COLLECTIONS))
    report = {"id": "t2", "status": "open", "reportedBy": "guest", "title": "AC dripping"}
    merged = proxy._fm_writer_merge(None, STORED, {**view, "tickets": [report]})
    ck("  ...its write (the empty view + one report) lands on the REAL record, nothing erased",
       merged["costs"] == STORED["costs"] and merged["tickets"] == STORED["tickets"] + [report])
    ck("  ...and the guest rule still judges it: an open guest report passes",
       proxy._fm_guest_write_ok(STORED, merged))
    bad = proxy._fm_writer_merge(None, STORED, {**view, "tickets": [{**report, "status": "resolved"}]})
    ck("  ...a pre-resolved one is still refused", not proxy._fm_guest_write_ok(STORED, bad))
    resent = proxy._fm_writer_merge(None, STORED, {**view, "tickets": [{"id": "t1", "status": "resolved", "reportedBy": "guest"}]})
    ck("  ...re-sending an EXISTING ticket id cannot edit it (only new ids are taken)", resent["tickets"] == STORED["tickets"])
    proxy._role_for = lambda _r: "owner"
    ck("the owner reads and writes the whole record, untouched",
       proxy._fm_reader_view(None, STORED) is STORED and proxy._fm_writer_merge(None, STORED, {"x": 1}) == {"x": 1})
finally:
    proxy._role_for = _real_role_for
# The view on the GET AND on the 409 body is driven over HTTP now:
# tests/store-doors.py ("a guest's STALE write gets the empty view back").

# ── A chunked upload survives a re-sent piece (round 11, 2.496.166) ──────────
# Driven through the real handler with a fake request: the client re-sends a
# piece whose reply it never got, so the server must accept the same offset
# twice — after the piece landed in full, and after the connection dropped
# half-way through it — and assemble exactly the file.
import asyncio  # noqa: E402
import os  # noqa: E402
import tempfile  # noqa: E402


class _Body:
    def __init__(self, data: bytes, drop_after: int | None = None):
        self.data, self.drop_after = data, drop_after

    async def iter_chunked(self, _n):
        if self.drop_after is None:
            yield self.data
            return
        yield self.data[: self.drop_after]
        raise ConnectionResetError("client went away")


class _Req:
    def __init__(self, query: dict, body: _Body):
        self.query, self.content = query, body


def _piece(dest, uid, offset, data, last=False, drop_after=None):
    q = {"offset": str(offset)}
    if last:
        q["last"] = "1"
    try:
        r = asyncio.run(proxy._chunked_upload(_Req(q, _Body(data, drop_after)), "glb", dest, uid))
        return r.status
    except ConnectionResetError:
        return "dropped"


with tempfile.TemporaryDirectory() as d:
    dest = os.path.join(d, "villa.glb")
    uid = "retrytest01"
    a, b, c = proxy.UPLOAD_MAGIC["glb"][0] + b"A" * 60, b"B" * 64, b"C" * 64
    st = [_piece(dest, uid, 0, a),
          _piece(dest, uid, 64, b),
          _piece(dest, uid, 64, b),                     # its reply was lost: sent again
          _piece(dest, uid, 128, c, drop_after=20),     # dropped half-way…
          _piece(dest, uid, 128, c, last=True)]         # …and re-sent
    got = open(dest, "rb").read() if os.path.exists(dest) else b""
    ck("a re-sent piece is accepted — landed in full, or dropped half-way",
       st == [200, 200, 200, "dropped", 200])
    if st != [200, 200, 200, "dropped", 200]:
        print(f"          statuses: {st}")
    ck("  ...and the file is exactly the three pieces, once each", got == a + b + c)
    ck("  ...a MISSING piece is still refused (409)",
       _piece(dest, "retrytest02", 0, a) == 200 and _piece(dest, "retrytest02", 128, c) == 409)
    try:
        _piece(dest, "retrytest03", 0, a)
        _piece(dest, "retrytest03", 64, b"")            # refused: an empty piece
        refused = False
    except proxy.web.HTTPException:
        refused = True
    ck("  ...a REFUSED piece ends the upload — its pieces go with it",
       refused and _piece(dest, "retrytest03", 64, b) == 409)

# ── the telemetry ring is bounded by COUNT and by BYTES ──────────────────
# At the count ceiling alone (5000 x 64 kB) the ring reached ~320 MB and was
# re-read and rewritten whole on every POST, on the event loop (2.496.196).
print("\n  the telemetry ring:")
ring = [{"i": i, "pad": "x" * 100} for i in range(50)]
ck("the newest N are kept", [e["i"] for e in proxy._telemetry_ring_after(ring, 10, 10**9)] == list(range(40, 50)))
small = proxy._telemetry_ring_after(ring, 50, 2_000)
ck("  ...and then the newest that FIT the byte cap", 0 < len(small) < 50
   and len(proxy.json.dumps(small).encode()) <= 2_000 and small[-1]["i"] == 49)
ck("  ...never trimming to nothing (one event always fits)", len(proxy._telemetry_ring_after(ring, 50, 1)) == 1)
ck("the ceiling the options allow is under the byte cap by construction",
   proxy.TELEMETRY_MAX_RING_BYTES < 5000 * proxy.TELEMETRY_MAX_BODY)
src = PROXY.read_text()
_update = inspect.getsource(proxy.JsonStore.update)
ck("a store change reads and writes OFF the event loop, inside its lock",
   "async with self.lock:" in _update and "await asyncio.to_thread(self.read_status)" in _update
   and "await _write_json_store_async(self.path, payload)" in _update
   and "asyncio.to_thread(_write_json_store, path, payload)" in src
   and "await asyncio.to_thread(after, stored, new)" in _update)
ck("  ...and the telemetry append is a change to its store (ONE lock)",
   "await TELEMETRY.update(" in inspect.getsource(proxy.telemetry_post_handler))

# ── the lockout bucket is keyed by what the caller CANNOT write ───────────
# _client_ip used to take the FIRST X-Forwarded-For hop — the one address in
# the request the caller writes — so five wrong passcodes "from" the owner's
# address locked the owner out, and a fresh address per attempt minted a fresh
# bucket (2.496.206). The key is now nginx's X-VK-Peer plus the LAST hop, which
# the gateway in front of us appends.
print("\n  the lockout key:")


class _HReq:
    def __init__(self, headers: dict, remote: str = "127.0.0.1", method: str = "POST"):
        self.headers, self.remote, self.method, self.cookies = headers, remote, method, {}


key = proxy._client_ip
ck("the peer nginx accepted is the key", key(_HReq({"X-VK-Peer": "10.0.0.5"})) == "10.0.0.5")
ck("  ...falling back to the socket peer without it", key(_HReq({}, remote="10.0.0.9")) == "10.0.0.9")
ck("a forwarded chain contributes its LAST hop, the one the gateway appended",
   key(_HReq({"X-VK-Peer": "10.0.0.5", "X-Forwarded-For": "1.2.3.4, 5.6.7.8"})) == "10.0.0.5|5.6.7.8")
victim = key(_HReq({"X-VK-Peer": "10.0.0.7"}))
forged = [key(_HReq({"X-VK-Peer": "10.0.0.5", "X-Forwarded-For": h})) for h in ("10.0.0.7", "10.0.0.7, 10.0.0.7", "")]
ck("no header a LAN forger writes reaches another peer's bucket", victim not in forged and len(set(forged)) <= 2)
ck("  ...and through a gateway the appended hop, not the forged one, names them",
   key(_HReq({"X-VK-Peer": "172.30.32.2", "X-Forwarded-For": "10.0.0.7, 10.0.0.5"}))
   != key(_HReq({"X-VK-Peer": "172.30.32.2", "X-Forwarded-For": "10.0.0.7"})))
ck("a monstrous header cannot bloat the table", len(key(_HReq({"X-VK-Peer": "x" * 500, "X-Forwarded-For": "y" * 500}))) <= 91)
snippet = (ROOT / "rootfs" / "etc" / "nginx" / "snippets" / "backend-proxy.conf").read_text()
ck("nginx writes X-VK-Peer from the socket, in the snippet every location includes",
   "proxy_set_header X-VK-Peer $remote_addr;" in snippet)

# ── the session cookie's attributes, and the browser's cross-site verdict ──
print("\n  the cookie and cross-site writes:")
proxy._session_secret_cache = b"t" * 32
resp = proxy.web.Response()
proxy._set_session_cookie(resp, "guest")
c = resp.cookies[proxy.SESSION_COOKIE]
ck("HttpOnly, Secure, SameSite=Lax, Path=/ — asserted, not assumed",
   bool(c["httponly"]) and bool(c["secure"]) and c["samesite"] == "Lax" and c["path"] == "/")
ck("the browser saying 'cross-site' is refused on a write, before any auth",
   proxy._cross_site(_HReq({"Sec-Fetch-Site": "cross-site"}))
   and proxy._refuse(_HReq({"Sec-Fetch-Site": "Cross-Site"})).status == 403)
ck("  ...but not on a read (Lax already sends the cookie there, nothing to gain)",
   proxy._refuse(_HReq({"Sec-Fetch-Site": "cross-site"}, method="GET")).status == 401)
ck("  ...and same-origin, same-site, none or ABSENT (older WebKit) all pass this gate",
   all(not proxy._cross_site(_HReq(h)) for h in ({"Sec-Fetch-Site": "same-origin"}, {"Sec-Fetch-Site": "same-site"}, {"Sec-Fetch-Site": "none"}, {})))

# ── a passcode-less profile is closed, except Guest inside Home Assistant ──
# With guest_pin empty, ANY caller reaching the direct port or the tunnel used
# to be handed a guest session — doors included (2.496.207).
print("\n  passcode-less profiles:")


class _JReq(_HReq):
    def __init__(self, body: dict, headers: dict | None = None):
        super().__init__(headers or {})
        self._body = body

    async def json(self):
        return self._body


proxy._read_options = lambda: {}  # no PIN configured for any profile
ck("no passcode: Guest opens only from Ingress",
   proxy._profile_enabled("guest", True) and not proxy._profile_enabled("guest", False))
ck("  ...owner and ops open nowhere", not any(proxy._profile_enabled(r, i) for r in ("owner", "ops") for i in (True, False)))
proxy._read_options = lambda: {"guest_pin": "1234"}
ck("a passcode opens the profile from anywhere", proxy._profile_enabled("guest", False))
proxy._read_options = lambda: {}
roles = _json.loads(asyncio.run(proxy.auth_roles_handler(_HReq({}, method="GET"))).text)["roles"]
ingress_roles = _json.loads(asyncio.run(proxy.auth_roles_handler(_HReq({"X-VK-Ingress": "1"}, method="GET"))).text)["roles"]
ck("/auth/roles says which profiles are ENABLED from here, not just which ask for a passcode",
   roles["guest"] == {"pinRequired": False, "enabled": False} and ingress_roles["guest"]["enabled"] is True
   and roles["owner"]["enabled"] is False)
direct = asyncio.run(proxy.auth_verify_handler(_JReq({"role": "guest"})))
via_ha = asyncio.run(proxy.auth_verify_handler(_JReq({"role": "guest"}, {"X-VK-Ingress": "1"})))
ck("a passcode-less guest is refused on the direct port (403, and it says why)",
   direct.status == 403 and "Home Assistant" in _json.loads(direct.text)["error"])
ck("  ...and granted a session through Ingress",
   via_ha.status == 200 and proxy.SESSION_COOKIE in via_ha.cookies)
ck("  ...while a passcode-less OWNER is refused on both", all(
   asyncio.run(proxy.auth_verify_handler(_JReq({"role": "owner"}, h))).status == 403 for h in ({}, {"X-VK-Ingress": "1"})))

# ── CSP violations reach the telemetry ring ───────────────────────────────
print("\n  CSP reports:")
csp = (ROOT / "rootfs" / "etc" / "nginx" / "snippets" / "csp.conf").read_text()
ck("the policy reports to the RELATIVE telemetry path (Ingress prefix and direct port alike)",
   "; report-uri telemetry\"" in csp)
ev = proxy._csp_event({"effective-directive": "script-src", "blocked-uri": "blob:e.js",
                       "source-file": "/assets/app.js", "line-number": 12, "document-uri": "/",
                       "original-policy": "x" * 5000, "sample": "<script>"})
ck("a report becomes a `csp` event with what was blocked and where, nothing else",
   ev == {"kind": "csp", "directive": "script-src", "blocked": "blob:e.js",
          "source": "/assets/app.js", "line": 12, "document": "/"})
ck("  ...values capped, a non-numeric line dropped, the older directive key honoured",
   len(proxy._csp_event({"blocked-uri": "x" * 900})["blocked"]) == 300
   and proxy._csp_event({"line-number": "12"})["line"] is None
   and proxy._csp_event({"violated-directive": "img-src"})["directive"] == "img-src")
ck("the telemetry POST recognises a browser's report body",
   'if isinstance(body.get("csp-report"), dict):\n        body = _csp_event(body["csp-report"])' in PROXY.read_text())

# ── signing every device out also replaces the signing key ────────────────
print("\n  the signing key:")
with tempfile.TemporaryDirectory() as d:
    proxy.DATA_DIR = d
    secret_file = proxy._data(proxy.SESSION_SECRET_NAME)
    proxy._session_secret_cache = None
    token = proxy._make_session_token("owner")
    ck("a fresh token verifies", proxy._session_role(token) == "owner")
    before = open(secret_file, "rb").read()
    proxy._rotate_session_secret()
    ck("after a rotation it does not, and the key on disk is new (0600)",
       proxy._session_role(token) is None and open(secret_file, "rb").read() != before
       and (os.stat(secret_file).st_mode & 0o777) == 0o600)
    ck("  ...and a token issued afterwards does", proxy._session_role(proxy._make_session_token("ops")) == "ops")
ck("sign-every-device-out rotates the key after bumping the epoch",
   "    epoch = _bump_session_epoch()\n    try:\n        _rotate_session_secret()" in PROXY.read_text())

# ── what a non-owner session may READ: domains, at the relay ──────────────
# get_states and subscribe_events used to stream every entity in the instance
# to a guest (persons, trackers, the alarm panel); the docstring called the
# per-entity mirror impossible, and it is — the DOMAIN line is not (2.496.208).
print("\n  reads narrowed by domain:")
relay = proxy._relay_to_client
states = _json.dumps({"id": 3, "type": "result", "success": True, "result": [
    {"entity_id": "light.pool", "state": "on"}, {"entity_id": "person.owner", "state": "home"},
    {"entity_id": "camera.gate", "state": "idle"}, {"entity_id": "sun.sun", "state": "above_horizon"},
    {"entity_id": "device_tracker.phone", "state": "home"}, {"entity_id": "alarm_control_panel.villa", "state": "armed"}]})
ids = lambda text: [e["entity_id"] for e in _json.loads(text)["result"]]
ck("a guest's get_states keeps the drawn domains and loses persons, trackers, alarms AND cameras",
   ids(relay("guest", states, {})) == ["light.pool", "sun.sun"])
ck("  ...ops (may view cameras) keeps the camera", ids(relay("ops", states, {})) == ["light.pool", "camera.gate", "sun.sun"])
ck("  ...the owner's frame is passed through untouched", relay("owner", states, {}) is states)
ev = lambda eid: _json.dumps({"type": "event", "event": {"event_type": "state_changed", "data": {"entity_id": eid, "new_state": {}}}})
ck("a state_changed for a person is dropped, for a light forwarded",
   relay("guest", ev("person.owner"), {}) is None and relay("guest", ev("light.pool"), {}) is not None)
reg = _json.dumps({"type": "event", "event": {"event_type": "entity_registry_updated", "data": {"action": "update", "entity_id": "device_tracker.phone"}}})
ck("  ...and so is a registry event naming one", relay("guest", reg, {}) is None)
registry = _json.dumps({"id": 4, "type": "result", "result": [{"entity_id": "person.owner", "name": "Owner"}, {"entity_id": "climate.ac", "name": "AC"}]})
ck("the entity registry listing is narrowed the same way", ids(relay("guest", registry, {})) == ["climate.ac"])
log = _json.dumps({"id": 5, "type": "result", "result": [
    {"when": 1, "entity_id": "lock.gate", "name": "Gate"}, {"when": 2, "entity_id": "person.owner", "name": "Owner arrived"},
    {"when": 3, "name": "Automation ran", "message": "triggered"}]})
pend = {5: "logbook/get_events"}
ck("a logbook result loses the person AND the entity-less entry (a name and a message)",
   [e["when"] for e in _json.loads(relay("guest", log, pend))["result"]] == [1] and pend == {})
devices = _json.dumps({"id": 6, "type": "result", "result": [{"id": "d1", "name": "Hub"}, {"id": "d2"}]})
ck("a list that names no entity (device registry) passes whole", relay("guest", devices, {}) is devices)
ck("a frame Core did not write as JSON is dropped, not passed on trust",
   relay("guest", "not json", {}) is None and relay("guest", "[1,2]", {}) is None)
ck("the relay records which requests are logbook ones",
   'elif obj.get("type") in _ENTITY_LIST_COMMANDS:\n                            pending[obj.get("id")] = obj["type"]' in PROXY.read_text()
   and "if (out := _relay_to_client(role, msg.data, pending)) is not None:" in PROXY.read_text())
q = proxy._rest_query_allowed
ck("REST history: a non-owner must name entities, and only readable ones",
   not q("guest", "history/period/2026-01-01T00:00:00Z", {}) and not q("guest", "history/period/x", {"filter_entity_id": "light.a,person.b"})
   and q("guest", "history/period/x", {"filter_entity_id": "sensor.power"}) and q("owner", "history/period/x", {}))
ck("  ...and the REST relay asks it", "if not _rest_query_allowed(role, tail, request.query):" in PROXY.read_text())
table = _json.loads((ROOT / "rootfs" / "usr" / "share" / "vesta" / "ha-commands.json").read_text())
ck("readDomains comes from the shared table, and holds the drawn domains plus sun/scene/weather",
   proxy.READ_DOMAINS == frozenset(table["readDomains"]) and {"light", "sensor", "sun", "scene", "weather"} <= proxy.READ_DOMAINS
   and not {"person", "device_tracker", "alarm_control_panel", "update", "calendar"} & proxy.READ_DOMAINS)

print()
print("✅ the proxy's pure rules hold" if FAIL == 0
      else "❌ A PROXY RULE IS BROKEN")
sys.exit(1 if FAIL else 0)
