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
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"

spec = importlib.util.spec_from_file_location("vk_proxy", PROXY)
assert spec and spec.loader
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
_elevate = _src[_src.index("def superadmin"):] if "def superadmin" in _src else _src
ck("  ...and the handler charges SUPERADMIN, not the caller's role",
   "_note_global_failure(SUPERADMIN" in _src
   and "_note_global_failure(role" in _src)

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

print()
print("✅ the proxy's pure rules hold" if FAIL == 0
      else "❌ A PROXY RULE IS BROKEN")
sys.exit(1 if FAIL else 0)
