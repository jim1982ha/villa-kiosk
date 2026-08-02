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

# The revision must stay a STRING. As an int of nanoseconds (~1.8e18) it was
# ~198x past JavaScript's MAX_SAFE_INTEGER, so every browser client rounded it
# and every conditional write was rejected 409 forever — the store became
# readable but permanently unwritable. Nothing here parses it as a number.
_tmp_rev = os.path.join(tempfile.mkdtemp(), "rev-probe.json")
proxy._write_json_store(_tmp_rev, '{"a":1}')
_rev = proxy._store_revision(_tmp_rev)
t("revision is a string", isinstance(_rev, str), True)
t("revision of an absent store is a string", isinstance(proxy._store_revision("/nope/x"), str), True)
# Positive proof of WHY it must stay a string: the underlying value is past
# the range a JS number can hold exactly, so any numeric representation is
# lossy. If someone "simplifies" this back to an int, this fails.
t("revision is past JS MAX_SAFE_INTEGER (so a number would be lossy)",
  int(_rev) > 2**53 - 1, True)
t("revision would be corrupted if sent as a number",
  str(int(float(_rev))) != _rev, True)
t("revision changes when the store is written",
  (lambda before: (time.sleep(0.01),
                   proxy._write_json_store(_tmp_rev, '{"a":2}'),
                   proxy._store_revision(_tmp_rev) != before)[-1])(_rev), True)

# ------------------------------------------ superadmin erasure boundary
# Deleting an evidence record (a fault, a spend, a logged completion) needs a
# single-use elevation minted from the 6-digit superadmin code. The rule lives
# HERE and not in the UI because the store takes whole documents: a client
# that simply omits a record IS a delete, so a client-side check would be no
# check at all.
section("superadmin: erasing an evidence record needs an elevation")

t("elevation route exists",
  '"/auth/elevate"' in _proxy_src, True)
t("superadmin code is 6 digits", bool(proxy.SUPERADMIN_PIN_RE.fullmatch("123456")), True)
for bad in ("1234", "1234567", "12345a", "", "12 456"):
    t(f"superadmin code rejects {bad!r}", bool(proxy.SUPERADMIN_PIN_RE.fullmatch(bad)), False)
t("elevation code compared in constant time",
  "hmac.compare_digest" in inspect.getsource(proxy.auth_elevate_handler), True)
t("elevation attempts are rate limited",
  "_auth_failures" in inspect.getsource(proxy.auth_elevate_handler), True)

# _fm_write_guard reads the caller's role; stub it rather than faking a
# request object, so each block below states plainly which role it is testing.
proxy._role_for = lambda request: "owner"

_doc = {
    "tickets": [{"id": "tk1", "photoIds": ["p1"]}, {"id": "tk2", "photoIds": []}],
    "costs": [{"id": "co1", "photoIds": ["p1", "p2"]}],
    "completions": [{"id": "cp1", "photoIds": []}],
    "schedules": [{"id": "sc1"}],
    "savedDocuments": [{"id": "doc1"}],
}


def without(collection, ident):
    d = {k: list(v) for k, v in _doc.items()}
    d[collection] = [it for it in d[collection] if it["id"] != ident]
    return d


# With no code configured the capability is OFF — erasure is impossible for
# everyone rather than open to anyone.
proxy._read_options = lambda: {}
t("no code configured → erasing a fault is refused",
  proxy._fm_write_guard(None, {}, _doc, without("tickets", "tk1")) is not None, True)

proxy._read_options = lambda: {proxy.SUPERADMIN_PIN_OPTION: "654321"}
t("erasing a fault without an elevation is refused",
  proxy._fm_write_guard(None, {}, _doc, without("tickets", "tk1")) is not None, True)
t("erasing a spend without an elevation is refused",
  proxy._fm_write_guard(None, {}, _doc, without("costs", "co1")) is not None, True)
t("erasing a completion without an elevation is refused",
  proxy._fm_write_guard(None, {}, _doc, without("completions", "cp1")) is not None, True)
t("a bogus elevation token is refused",
  proxy._fm_write_guard(None, {"elevation": "not-a-token"}, _doc,
                        without("tickets", "tk1")) is not None, True)

# Adding and amending stay open — this must not become a gate on ordinary work.
_added = {k: list(v) for k, v in _doc.items()}
_added["tickets"] = _added["tickets"] + [{"id": "tk3", "photoIds": []}]
t("adding a fault needs no elevation", proxy._fm_write_guard(None, {}, _doc, _added), None)
_amended = {k: list(v) for k, v in _doc.items()}
_amended["tickets"] = [{"id": "tk1", "photoIds": ["p1"], "status": "resolved"},
                       {"id": "tk2", "photoIds": []}]
t("resolving a fault needs no elevation", proxy._fm_write_guard(None, {}, _doc, _amended), None)
# Plans and regenerable snapshots are deliberately NOT protected: they are
# routine housekeeping for owner/ops and destroy no history.
t("deleting a schedule needs no elevation",
  proxy._fm_write_guard(None, {}, _doc, without("schedules", "sc1")), None)
t("deleting a saved document needs no elevation",
  proxy._fm_write_guard(None, {}, _doc, without("savedDocuments", "doc1")), None)

# A valid token authorises exactly ONE erasure and is then spent.
_tok = proxy._mint_elevation()
t("a valid elevation authorises the erasure",
  proxy._fm_write_guard(None, {"elevation": _tok}, _doc, without("tickets", "tk1")), None)
t("the same elevation cannot be replayed",
  proxy._fm_write_guard(None, {"elevation": _tok}, _doc,
                        without("tickets", "tk2")) is not None, True)
# An expired token is worthless even if never used.
_stale = proxy._mint_elevation()
proxy._elevation_tokens[_stale] = time.monotonic() - 1
t("an expired elevation is refused",
  proxy._fm_write_guard(None, {"elevation": _stale}, _doc,
                        without("tickets", "tk1")) is not None, True)

# "Delete" must mean the JPEG leaves /data too. Reference counting is what
# decides that now — every photo the document still points at, anywhere,
# including a fault's per-stage update photos.
t("referenced ids include every record's photos",
  proxy._fm_referenced_photo_ids(_doc), {"p1", "p2"})
t("referenced ids include a fault update's photos",
  proxy._fm_referenced_photo_ids(
      {"tickets": [{"id": "t", "photoIds": [],
                    "updates": [{"photoIds": ["u1"]}]}]}), {"u1"})
t("a photo shared with a surviving record is still referenced",
  "p1" in proxy._fm_referenced_photo_ids(without("costs", "co1")), True)
t("a photo only the erased record held is no longer referenced",
  "p2" in proxy._fm_referenced_photo_ids(without("costs", "co1")), False)
t("evidence deletion rejects a traversing id", proxy._delete_evidence("../../etc/passwd"), False)
t("evidence deletion rejects an empty id", proxy._delete_evidence(""), False)

# ------------------------------------------------- guest fault reporting
# A guest may APPEND a fault report and do nothing else. The rule is the shape
# of the change, not the role — a role check alone would hand the whole
# maintenance record to anyone holding a guest session.
section("guests: may add a fault report, and nothing else")

_g_old = {"tickets": [{"id": "t1", "status": "open"}], "costs": [{"id": "c1"}],
          "completions": [], "schedules": [], "savedDocuments": []}


def guest_write(new):
    proxy._role_for = lambda request: "guest"
    try:
        return proxy._fm_write_guard(None, {}, _g_old, new) is None
    finally:
        proxy._role_for = lambda request: "owner"


def with_tickets(tickets, **rest):
    d = {k: list(v) for k, v in _g_old.items()}
    d["tickets"] = tickets
    d.update(rest)
    return d


_good = {"id": "t2", "status": "open", "reportedBy": "guest", "photoIds": []}
t("guest may append an open report",
  guest_write(with_tickets([_g_old["tickets"][0], _good])), True)
t("guest may not remove a fault", guest_write(with_tickets([])), False)
t("guest may not edit an existing fault",
  guest_write(with_tickets([{"id": "t1", "status": "resolved"}, _good])), False)
t("guest may not reorder to hide an edit",
  guest_write(with_tickets([_good, _g_old["tickets"][0]])), False)
t("guest may not file an already-resolved fault",
  guest_write(with_tickets([_g_old["tickets"][0], {**_good, "status": "resolved"}])), False)
t("guest may not attach a cost to their report",
  guest_write(with_tickets([_g_old["tickets"][0], {**_good, "costId": "c1"}])), False)
t("guest may not omit the guest marker",
  guest_write(with_tickets([_g_old["tickets"][0], {**_good, "reportedBy": None}])), False)
t("guest may not touch spend",
  guest_write(with_tickets([_g_old["tickets"][0], _good], costs=[])), False)
t("guest may not touch schedules",
  guest_write(with_tickets([_g_old["tickets"][0], _good], schedules=[{"id": "s"}])), False)
t("guest may not rewrite an unknown future field",
  guest_write(with_tickets([_g_old["tickets"][0], _good], somethingNew=[1])), False)
t("guest may not bulk-fill the store",
  guest_write(with_tickets([_g_old["tickets"][0]]
                           + [{**_good, "id": f"t{i}"} for i in range(9)])), False)
t("guest write with no new report is refused",
  guest_write(with_tickets([_g_old["tickets"][0]])), False)
t("an owner is not held to the guest shape",
  proxy._fm_write_guard(None, {}, _g_old,
                        with_tickets([_g_old["tickets"][0]], schedules=[{"id": "s"}])), None)

# ------------------------------------------------- tunable policy options
# These are operator-facing knobs, so the schema is not the only guard: a
# hand-edited /data/options.json bypasses it entirely, and a retention of -1
# or 10**9 must not become "delete everything" or "never delete".
section("policy options: clamped, and malformed values fall back")

_saved_read_options = proxy._read_options


def with_options(**opts):
    proxy._read_options = lambda: opts


t("retention default with no option set",
  (with_options(), proxy._evidence_retention_days())[1], 550)
t("retention honours a real value",
  (with_options(evidence_retention_days=30), proxy._evidence_retention_days())[1], 30)
t("retention 0 means the sweep is off",
  (with_options(evidence_retention_days=0), proxy._evidence_retention_days())[1], 0)
t("negative retention clamps to off, never to 'delete everything'",
  (with_options(evidence_retention_days=-5), proxy._evidence_retention_days())[1], 0)
t("absurd retention clamps to the ceiling",
  (with_options(evidence_retention_days=10**9), proxy._evidence_retention_days())[1], 3650)
for junk in ("", "abc", None, [], {}):
    t(f"malformed retention {junk!r} falls back to the default",
      (with_options(evidence_retention_days=junk), proxy._evidence_retention_days())[1], 550)

t("session default", (with_options(), proxy._session_ttl())[1], 30 * 86400)
t("session honours a real value",
  (with_options(session_days=1), proxy._session_ttl())[1], 86400)
t("session can never be zero-length",
  (with_options(session_days=0), proxy._session_ttl())[1], 86400)
t("telemetry ring cannot be shrunk to nothing",
  (with_options(telemetry_max_events=0), proxy._telemetry_max_events())[1], 50)
t("lockout cannot be disabled",
  (with_options(pin_lockout_minutes=0), proxy._auth_lockout_seconds())[1], 60)

# Every option the schema offers must be recognised by the self-heal that
# strips unknown keys, or the Supervisor UI would write a value this process
# then deletes on the next start.
import yaml  # noqa: E402
with open(os.path.join(HERE, "..", "villa-kiosk", "config.yaml"), encoding="utf-8") as _f:
    _cfg = yaml.safe_load(_f)
t("every configured option is a known key",
  set(_cfg["options"]) - proxy.KNOWN_OPTION_KEYS, set())
t("every option has a schema entry", set(_cfg["options"]) - set(_cfg["schema"]), set())

proxy._read_options = _saved_read_options

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
