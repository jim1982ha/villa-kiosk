#!/usr/bin/env python3
"""Security regression tests for the add-on's supervisor proxy.

Run from the villa-kiosk directory:  python3 tests/security_test.py

Every assertion here corresponds to a hole that was actually open at some
point, so a failure means a real vulnerability has come back — not that a
style rule moved:

  * session forgery, role swapping, expiry, and revocation-by-epoch
  * the lockout DoS (one caller could lock everyone out of a profile)
  * path traversal into the evidence store and the upload target
  * the fail-OPEN REST allowlist (SERVICES/lock/unlock, ./template, ...)
  * websocket frames that bypass the service allowlist (execute_script)

It imports the real module rather than re-implementing its logic, so it
cannot drift from what actually runs.
"""
import importlib.util
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROXY = os.path.join(HERE, "..", "rootfs", "usr", "bin", "supervisor-proxy.py")
_spec = importlib.util.spec_from_file_location("proxy", PROXY)
proxy = importlib.util.module_from_spec(_spec)
sys.modules["proxy"] = proxy
_spec.loader.exec_module(proxy)

# Keep the test off the real /data volume.
_TMP = tempfile.mkdtemp()
proxy.SESSION_SECRET_FILE = os.path.join(_TMP, "secret")
proxy.SESSION_EPOCH_FILE = os.path.join(_TMP, "epoch")
proxy._session_secret_cache = None

PASSED = FAILED = 0


def t(name, got, want):
    global PASSED, FAILED
    ok = got == want
    PASSED, FAILED = PASSED + ok, FAILED + (not ok)
    print(f"{'PASS' if ok else 'FAIL'} {name}: {got!r} (want {want!r})")


def section(title):
    print(f"\n--- {title} ---")


# --------------------------------------------------------------- sessions
section("session tokens: forgery, escalation, expiry")
tok = proxy._make_session_token("owner")
t("valid token resolves to its role", proxy._session_role(tok), "owner")
t("garbage rejected", proxy._session_role("nonsense"), None)
t("empty rejected", proxy._session_role(None), None)

role, exp, _sig = tok.split(".")
t("forged signature rejected", proxy._session_role(f"{role}.{exp}.{'0' * 64}"), None)

# Escalation: keep a valid guest signature, swap the role field to owner.
g_role, g_exp, g_sig = proxy._make_session_token("guest").split(".")
t("role swapped inside a valid token rejected",
  proxy._session_role(f"owner.{g_exp}.{g_sig}"), None)

past = int(time.time()) - 10
t("expired token rejected",
  proxy._session_role(f"owner.{past}.{proxy._sign_session('owner', past)}"), None)

section("revocation: /auth/logout-all must invalidate live sessions")
live = proxy._make_session_token("owner")
t("valid before revocation", proxy._session_role(live), "owner")
proxy._bump_session_epoch()
t("INVALID after revocation", proxy._session_role(live), None)
t("freshly minted session works again",
  proxy._session_role(proxy._make_session_token("owner")), "owner")

# ---------------------------------------------------------- rate limiting
section("brute-force limiter: must punish the guesser, not the victim")
proxy._auth_failures.clear()
for _st in proxy._auth_failures_global.values():
    _st["count"], _st["last"] = 0, 0.0

ATTACKER, VICTIM = "203.0.113.9", "198.51.100.7"


def _fail(role_name, ip):
    st = proxy._auth_failures.setdefault((role_name, ip), {"count": 0, "last": 0.0})
    st["count"] += 1
    st["last"] = time.monotonic()
    g = proxy._auth_failures_global[role_name]
    g["count"] += 1
    g["last"] = time.monotonic()


for _ in range(proxy.AUTH_MAX_FAILURES):
    _fail("owner", ATTACKER)
t("attacker locked out", proxy._lockout_remaining("owner", ATTACKER) > 0, True)
t("VICTIM can still log in (the DoS fix)", proxy._lockout_remaining("owner", VICTIM), 0)
t("lockout does not leak across roles", proxy._lockout_remaining("ops", ATTACKER), 0)

for i in range(proxy.AUTH_GLOBAL_MAX_FAILURES):
    _fail("owner", f"10.0.{i // 256}.{i % 256}")
t("distributed guessing hits the global backstop",
  proxy._lockout_remaining("owner", "192.0.2.1") > 0, True)

for i in range(proxy.AUTH_TRACK_MAX_CLIENTS + 500):
    proxy._auth_failures[("guest", f"172.16.{i // 256}.{i % 256}")] = {
        "count": 1, "last": time.monotonic()}
proxy._prune_auth_failures(time.monotonic())
t("tracked clients stay bounded (no memory-exhaustion vector)",
  len(proxy._auth_failures) <= proxy.AUTH_TRACK_MAX_CLIENTS, True)

section("PIN format")
t("4 digits accepted", bool(proxy.PIN_RE.fullmatch("0427")), True)
for bad in ("", "123", "12345", "abcd", "12 4", "0427\n", "١٢٣٤"):
    t(f"malformed rejected {bad!r}", bool(proxy.PIN_RE.fullmatch(bad)), False)

# -------------------------------------------------------- path traversal
section("evidence ids: path traversal")
for attack in ("../../etc/passwd", "..%2f..%2fetc%2fpasswd", "....//....//etc/passwd",
               "/etc/passwd", "a/../../../root/.ssh/id_rsa", "..\\..\\windows",
               "photo.jpg\x00.txt", "photo\n../../etc/passwd", "%2e%2e%2f",
               "....", "..", ".", "", "a" * 65, "abc", "has.dots", "has spaces"):
    t(f"rejected {attack!r}", bool(proxy.FM_EVIDENCE_ID_RE.fullmatch(attack)), False)
for good in ("abc123", "a_b-c_123", "A" * 64, "mv0k2j1x9wq7"):
    t(f"legitimate id accepted {good!r}", bool(proxy.FM_EVIDENCE_ID_RE.fullmatch(good)), True)

section("upload destination stays inside the data root")
for kind in ("glb", "rooms"):
    dest = proxy._resolve_upload_target(kind)
    t(f"{kind} contained", dest.startswith(os.path.realpath(proxy.DATA_ROOT)), True)

# ------------------------------------------------------- REST allowlist
section("REST allowlist must FAIL CLOSED (these all reached Core before)")
proxy._read_options = lambda: {"guest_pin": "1234"}
for path in ("SERVICES/lock/unlock", "./services/lock/unlock", "services//lock/unlock",
             "services/../services/lock/unlock", "services/lock/unlock%00",
             "services/lock/unlock;a=b", "services/lock%2funlock", "./template",
             "TEMPLATE", "template", "config/core/check_config", "states",
             "/services/lock/unlock", "services/light/turn on",
             "services/light/turn_on\n"):
    t(f"blocked {path!r}", proxy._rest_call_allowed("guest", path), False)

section("guests open doors — deliberate; the PIN is what authenticates them")
# A guest is the person staying in the villa. This is intended behaviour and is
# asserted here so a future 'hardening' pass does not quietly take it away and
# lock a paying guest out of the house.
proxy._read_options = lambda: {"guest_pin": "1234"}
for domain, service in (("lock", "unlock"), ("lock", "open"), ("cover", "open_cover")):
    t(f"PIN'd guest allowed {domain}/{service}",
      proxy._rest_call_allowed("guest", f"services/{domain}/{service}"), True)

section("legitimate kiosk traffic still works")
t("guest light/turn_on", proxy._rest_call_allowed("guest", "services/light/turn_on"), True)
t("guest history", proxy._rest_call_allowed("guest", "history/period/2026-01-01T00:00:00Z"), True)
t("history with a +08:00 offset",
  proxy._rest_call_allowed("guest", "history/period/2026-01-01T00:00:00+08:00"), True)
t("ops camera_proxy", proxy._rest_call_allowed("ops", "camera_proxy/camera.gate"), True)
t("ops camera stream", proxy._rest_call_allowed("ops", "camera_proxy_stream/camera.gate"), True)
t("guest camera denied", proxy._rest_call_allowed("guest", "camera_proxy/camera.gate"), False)
t("owner exempt", proxy._rest_call_allowed("owner", "anything/at/all"), True)
t("trailing slash tolerated", proxy._rest_call_allowed("guest", "services/light/turn_on/"), True)

section("privileged domains blocked for every non-owner role")
for path in ("services/homeassistant/restart", "services/hassio/host_reboot",
             "services/shell_command/x", "services/persistent_notification/create"):
    t(f"blocked {path}", proxy._rest_call_allowed("ops", path), False)

# --------------------------------------------------- websocket allowlist
section("websocket frames: default deny (execute_script bypassed the allowlist)")
for frame in ("execute_script", "render_template", "supervisor/api", "config/auth/create",
              "auth/long_lived_access_token", "persistent_notification/create",
              "config/entity_registry/update", "backup/generate", "hassio/host/reboot"):
    t(f"{frame} denied", frame in proxy.ALLOWED_WS_TYPES, False)
for frame in ("auth", "ping", "pong", "subscribe_events", "get_states",
              "call_service", "camera/stream"):
    t(f"{frame} permitted", frame in proxy.ALLOWED_WS_TYPES, True)

# ------------------------------------------- shared store write boundary
# The two mutable shared stores are built by ONE factory whose writer_roles
# parameter is the whole access rule. The FM store previously had a
# hand-written duplicate handler; folding it back onto the factory is what
# gave it the revision check, so these assertions pin BOTH the roles and the
# fact that the concurrency protection exists on both stores.
section("shared JSON stores: who may write, and CAS is present")

import inspect  # noqa: E402
_factory_src = inspect.getsource(proxy._json_store_handlers)
t("store PUT enforces writer_roles", "writer_roles" in _factory_src, True)
t("store PUT checks the revision", "expected_rev" in _factory_src, True)
t("store PUT serialises writes", "async with lock" in _factory_src, True)
t("store GET returns a revision", '"rev": _store_revision(path)' in _factory_src, True)

# Both stores must come from that factory — a bespoke handler is how the
# protections got lost last time.
_proxy_src = open(PROXY).read()
t("device-config uses the factory",
  "device_config_get_handler, device_config_put_handler = proxy._json_store_handlers".replace("proxy.", "")
  in _proxy_src, True)
t("fm-data uses the factory",
  "fm_data_get_handler, fm_data_put_handler = _json_store_handlers" in _proxy_src, True)
t("no bespoke fm-data PUT handler",
  "async def fm_data_put_handler" in _proxy_src, False)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
