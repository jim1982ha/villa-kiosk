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
import asyncio
import importlib.util
import inspect
import json
import math
import os
import re
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

section("/auth/session: restore a profile ONLY from a valid signed cookie")


class _FakeReq:
    """Minimal stand-in — auth_session_handler touches nothing but cookies."""

    def __init__(self, cookie=None):
        self.cookies = {proxy.SESSION_COOKIE: cookie} if cookie else {}


def _session_endpoint(cookie):
    resp = asyncio.run(proxy.auth_session_handler(_FakeReq(cookie)))
    return json.loads(resp.body)["role"]


# This endpoint is what lets a returning device skip the passcode pad, so a
# regression here silently signs someone in. Each case mirrors an attack the
# token tests above already cover, asserted end-to-end through the handler.
t("no cookie -> null (the picker is shown)", _session_endpoint(None), None)
t("valid cookie -> its own role", _session_endpoint(proxy._make_session_token("ops")), "ops")
_ok_role, _ok_exp, _ok_sig = proxy._make_session_token("guest").split(".")
t("role swapped inside a valid cookie -> null",
  _session_endpoint(f"owner.{_ok_exp}.{_ok_sig}"), None)
t("forged signature -> null", _session_endpoint(f"owner.{_ok_exp}.{'0' * 64}"), None)
_past = int(time.time()) - 10
t("expired cookie -> null",
  _session_endpoint(f"owner.{_past}.{proxy._sign_session('owner', _past)}"), None)
_revoked = proxy._make_session_token("owner")
proxy._bump_session_epoch()
t("cookie revoked by logout-all -> null", _session_endpoint(_revoked), None)

# Reading the role from _role_for() instead of the cookie would hand EVERY
# Ingress visitor an owner session and remove the profile picker entirely —
# a silent privilege grant, and the one mistake this handler must not make.
# Asserted against the CODE only: the docstring deliberately names _role_for
# to explain the trap, and matching prose would make this test unfailable.
_sess_src = inspect.getsource(proxy.auth_session_handler)
_sess_code = _sess_src.split('"""')[-1]
t("reads the signed cookie", "_session_role" in _sess_code, True)
t("never uses the Ingress owner shortcut", "_role_for" in _sess_code, False)

# ---------------------------------------------------------- rate limiting
section("brute-force limiter: must punish the guesser, not the victim")
proxy._auth_failures.clear()
# ⚠️ THE GLOBAL TIER HOLDS TIMESTAMPS, NOT A COUNT (2.965.0). It was
# `{"count": n, "last": t}` aged on `last`, which every failure refreshed —
# a quiet-period reset that let one mistyped PIN every 14 minutes lock the
# whole villa out of a role in 11.4 hours. See `_note_global_failure`.
for _hits in proxy._auth_failures_global.values():
    _hits.clear()

ATTACKER, VICTIM = "203.0.113.9", "198.51.100.7"


def _fail(role_name, ip):
    st = proxy._auth_failures.setdefault((role_name, ip), {"count": 0, "last": 0.0})
    st["count"] += 1
    st["last"] = time.monotonic()
    proxy._note_global_failure(role_name)


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

# Read-only registry/config list frames — every role, not just owner (the
# per-entity room lookup added 2026-08-04 needs entity/device/area registry
# reads to work for guest/ops sessions too, not just owner). Deliberately
# separate from the mutating "config/entity_registry/update" above, which
# stays denied — these are the "list" reads, never a write.
section("websocket frames: read-only registry/config lists permitted for every role")
for frame in ("get_config", "config/entity_registry/list",
              "config/device_registry/list", "config/area_registry/list",
              "config/floor_registry/list",
              "energy/get_prefs", "recorder/list_statistic_ids", "recorder/statistics_during_period",
              "logbook/get_events"):
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
# The lossiness is a property of the RANGE, not of every individual value, and
# asserting it per-value was a 1-in-256 flake: at ~1.8e18 the representable
# doubles are 256 apart, so a mtime_ns that happens to land exactly on one
# round-trips through float() unchanged and the old assertion
# (`str(int(float(_rev))) != _rev`) then declared the protection broken. It
# fired four times in 500 runs on 2026-08-28 and had been carried as an
# unreproduced intermittent since 2026-08-26. `math.ulp` states the real
# property — the gap between adjacent JS numbers here is wider than 1, so this
# range cannot represent consecutive revisions at all — and is deterministic.
t("a JS number cannot hold consecutive revisions apart",
  math.ulp(float(_rev)) > 1, True)
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
section("facility manager task acknowledgement: who may tick, and WHAT may be ticked")

# ⚠️ THE FACILITY MANAGER LIST IS ALSO THE HOUSEHOLD'S SHOPPING LIST on the reference
# deployment — `todo.shopping_list`, 7 open items — because that is whatever
# `todo` entity the operator pointed their blueprints at. So the dangerous
# request is not "a guest ticks a pump task", it is "any authorized session
# ticks somebody's groceries through an endpoint whose stated purpose is
# maintenance". The filter that prevents it is `ledger.TASK_PREFIX`.
from vesta.brief import tasks as reports_tasks  # noqa: E402

_tasks_src = inspect.getsource(reports_tasks)
t("completion re-lists through the shared parser",
  "todo_tasks(hass, [entity_id]" in _tasks_src, True)
t("a uid from the browser is never trusted as-is",
  "next((t for t in ours if t.get(\"uid\") == uid)" in _tasks_src, True)
t("refusal does not confirm the uid exists",
  _tasks_src.count("no such maintenance task on that list") == 1, True)

# The write path must not go through the browser service gate. `todo` is
# deliberately absent from ALLOWED_SERVICE_DOMAINS, and widening it would hand
# every open tab the ability to edit any todo list on the property.
t("todo stays out of the browser service allowlist",
  "todo" in proxy.ALLOWED_SERVICE_DOMAINS, False)

_ack_src = inspect.getsource(proxy.reports_tasks_complete_handler)
t("completion requires a session", "_authorized(request)" in _ack_src, True)
t("completion is owner/ops only", "TASK_ACK_ROLES" in _ack_src, True)
t("guest cannot complete a task", "guest" in proxy.TASK_ACK_ROLES, False)
t("the facility manager CAN complete a task", "ops" in proxy.TASK_ACK_ROLES, True)
t("the owner can complete a task", "owner" in proxy.TASK_ACK_ROLES, True)

# Reading is deliberately open to any authorized session: the same tasks are
# already in a delivered brief and in the Facility tab. Only the WRITE is gated.
_list_src = inspect.getsource(proxy.reports_tasks_get_handler)
t("listing requires a session", "_authorized(request)" in _list_src, True)
t("listing is not role-gated", "TASK_ACK_ROLES" in _list_src, False)

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
# The self-heal must never delete an option the CURRENT config.yaml offers.
# It used to work off an allowlist baked into this image, which silently
# discarded any option added to config.yaml before a matching image shipped —
# the operator toggles it, restarts, finds it off, and nothing logs why.
t("the self-heal cannot strip a currently-offered option",
  set(_cfg["options"]) & proxy.REMOVED_OPTION_KEYS, set())
t("retired keys are still cleaned up", "model_path" in proxy.REMOVED_OPTION_KEYS, True)
t("every option has a schema entry", set(_cfg["options"]) - set(_cfg["schema"]), set())

# Help text is what the operator configuring this add-on actually reads. It
# lives in translations/en.yaml because that is the only place Supervisor
# renders — explanations in config.yaml comments are invisible in the UI. An
# option shipped without one shows as a bare key with no clue what it does,
# which for a security setting (passcodes, lockout, public model access) is
# how a villa ends up misconfigured.
with open(os.path.join(HERE, "..", "villa-kiosk", "translations", "en.yaml"),
          encoding="utf-8") as _f:
    _tr = yaml.safe_load(_f)
t("every option has a label and help text in the UI",
  set(_cfg["options"]) - set(_tr.get("configuration", {})), set())
t("no help text for an option that no longer exists",
  set(_tr.get("configuration", {})) - set(_cfg["options"]), set())
t("every exposed port is explained",
  set(_cfg.get("ports", {})) - set(_tr.get("network", {})), set())
t("no field is left with an empty name or description",
  [k for k, v in _tr["configuration"].items()
   if not str(v.get("name", "")).strip() or not str(v.get("description", "")).strip()], [])

# ------------------------------------------ the agent's own routes
# ⚠️ FIVE COOKIE-AUTHENTICATED ROUTES AND ONE THAT IS NOT, AND THE ONE THAT IS
# NOT IS THE INTERESTING ONE. `/agent-mcp` authenticates a PROCESS with a
# bearer token, not a browser with a session, so `_authorized` is correctly
# absent from it — which means the usual "every handler calls _authorized"
# sweep would have to be read carefully to notice that absence is deliberate
# rather than missing. It is asserted here in both directions.
section("agent routes: who may read, who may write, who may reach the seam")

_agent_handlers = {
    # ⚠️ `agent_chats_handler` WAS HERE AND THE ROUTE IS GONE (2.973.0, "the
    # Telegram chat IS the permission"). Deleting the second allow-list was
    # right; leaving a check pointing at its handler was not, and the cost was
    # not one failed check — `getattr` raised, the script died on the spot, and
    # EVERY SECTION BELOW STOPPED RUNNING: the concerns PUT route, and the whole
    # `/agent-mcp` seam (constant-time token comparison, refusal when no token
    # is set, no ACT tool exported, unreachable through ingress). The most
    # security-critical checks in this file, dark since 2.973.0, behind a
    # non-zero exit nobody read past the traceback of.
    "agent_audit_handler": ("session", True),
    "agent_run_now_handler": ("session", True),
}
# ⚠️ THE HANDLERS LIVE IN `vesta.supervise.api` SINCE TASK-115 STEP 6, with the
# proxy's auth machinery INJECTED as `deps.authorized`/`deps.role_for`. The
# properties are unchanged; the spelling the source shows is the deps seam.
import vesta.supervise.api as _agent_api  # noqa: E402
for _name, (_kind, _owner) in _agent_handlers.items():
    # ⚠️ A MISSING HANDLER IS A FAILED CHECK, NEVER A CRASH. This loop used to
    # `getattr` straight into `inspect.getsource`, so a handler that was
    # renamed or deleted took the entire suite down with it rather than
    # reporting one red line — see the note on the table above. A gate that
    # stops the run on its own staleness protects nothing after the line it
    # died on.
    _fn = getattr(_agent_api, _name, None)
    t(f"{_name} exists", _fn is not None, True)
    if _fn is None:
        continue
    _src = inspect.getsource(_fn)
    t(f"{_name} requires a session", "deps.authorized(request)" in _src, True)
    t(f"{_name} owner-only == {_owner}",
      'deps.role_for(request) != "owner"' in _src, _owner)

# The concerns store is server-written. Its PUT handler is built (the factory
# returns a pair) and must never be routed: a browser that could replace the
# document could rewrite what the agent concluded, which makes the record
# worthless as a description of what the agent concluded.
t("agent-concerns uses the factory",
  "agent_concerns_get_handler, _agent_concerns_put_unrouted = _json_store_handlers"
  in _proxy_src, True)
_api_src = inspect.getsource(_agent_api)
# ⚠️ THE READ IS SHAPED SINCE 2026-09-06 AND THE AUTH IS STILL THE FACTORY'S.
# It used to be wired straight to `deps.concerns_get`; it now goes through
# `agent_concerns_shaped_handler`, which adds each row's available acts so the
# tablet stops deciding for itself which buttons a concern offers. That wrapper
# must not become a second door into the store, so this checks MORE than the
# old literal did: the route exists, the handler delegates to the factory's
# handler, and it returns the factory's answer untouched unless that answer was
# a 200 — an unauthorized read is still the store's refusal, not the wrapper's
# opinion of it.
t("agent-concerns GET is routed",
  'web.get("/agent-concerns", agent_concerns_shaped_handler)' in _api_src
  or 'web.get("/agent-concerns", deps.concerns_get)' in _api_src, True)
_shaped = _api_src[_api_src.index("async def agent_concerns_shaped_handler"):] \
    if "async def agent_concerns_shaped_handler" in _api_src else ""
t("agent-concerns GET still goes through the factory handler",
  "deps.concerns_get(request)" in _shaped, True)
t("agent-concerns GET passes a non-200 straight back",
  'getattr(resp, "status", 500) != 200' in _shaped, True)
t("agent-concerns PUT is NOT routed",
  'web.put("/agent-concerns"' in _api_src
  or 'add_put("/agent-concerns"' in _proxy_src, False)

# ⚠️ THE SEAM. A session check here would be wrong, not missing.
_mcp_src = inspect.getsource(_agent_api.agent_mcp_handler)
t("agent-mcp does NOT use the browser session",
  "authorized(request)" in _mcp_src, False)
t("agent-mcp delegates to the one authorising module",
  "mcp_server" in _mcp_src, True)
import vesta.supervise.agent.mcp_server as _mcp  # noqa: E402
t("agent-mcp compares its token in constant time",
  "hmac.compare_digest" in inspect.getsource(_mcp.authorised), True)
t("agent-mcp refuses when no token is configured",
  _mcp.authorised("Bearer anything-at-all"), False)
t("agent-mcp exports no ACT tool",
  [m for m in _mcp.EXPORTED_MODES if m != "READ"], [])

# ⚠️ AND IT MUST NOT BE REACHABLE THROUGH INGRESS. nginx is an explicit
# per-endpoint allow-list; the danger is not a missing block but a TIDY one —
# a single `location /agent-` prefix would cover all five SPA routes and
# `/agent-mcp` with them, silently, with every other test still green.
_NGINX = os.path.join(os.path.dirname(PROXY), "..", "..", "etc", "nginx",
                      "nginx.conf")
_nginx_src = open(_NGINX).read()
_proxy_src = open(PROXY).read()
t("no nginx location matches /agent-mcp",
  [ln.strip() for ln in _nginx_src.splitlines()
   if ln.strip().startswith("location") and "/agent-mcp" in ln], [])
t("no /agent- PREFIX block exists (it would swallow /agent-mcp)",
  [ln.strip() for ln in _nginx_src.splitlines()
   if ln.strip().startswith("location /agent-")], [])
# ⚠️ DERIVED FROM THE ROUTER, NOT LISTED. The hand-written version of this
# loop named six routes and the router had eight — `/agent-feedback` had never
# been in it and `/agent-review` would not have been either. A list that has to
# be updated alongside the thing it audits is a list that silently stops
# auditing, which is this repo's most repeated defect and the reason
# `test_nginx_routes.py` derives the same fact the same way.
# ⚠️ SINCE TASK-115 STEP 6 THE AGENT'S ROUTES REGISTER IN `supervise/api.py`'s
# table (`web.get/post/put(...)`), mounted by the proxy in one call — so the
# derivation reads the TABLE. Same rule, new register.
_agent_routes = sorted(set(re.findall(
    r'web\.(?:get|put|post|delete)\(\s*"(/agent-[a-z-]+)"', _api_src)))
t("the router parse found the agent routes", len(_agent_routes) >= 8, True)
for _route in _agent_routes:
    if _route == "/agent-mcp":
        continue                      # deliberately unreachable — asserted above
    t(f"{_route} has an exact nginx location",
      f"location = {_route} {{" in _nginx_src, True)

# ⚠️ TASK-101. THE LOOP ABOVE CHECKS ROUTING, NOT AUTHORISATION — every one of
# these routes was asserted reachable and none was asserted GUARDED, which is
# the one thing this suite exists for. Seventeen agent-/reports- routes shipped
# across PH-0..PH-7 under that gap. The handlers were in fact correct; a pin
# that only proves the correct case was never written is still a pin missing.
#
# ⚠️ DERIVED FROM THE ROUTER, like its neighbour, and for the reason stated
# there: a hand-listed set stops auditing the moment someone adds a route.
_mutating = sorted(set(
    re.findall(r'app\.router\.add_(?:put|post|delete)\(\s*'
               r'"(/(?:agent|reports)-[a-z-]+)"\s*,\s*([a-z_]+)', _proxy_src)
    + re.findall(r'web\.(?:put|post)\(\s*"(/agent-[a-z-]+)"\s*,\s*'
                 r'(?:deps\.)?([a-z_.]+)\)', _api_src)))
t("the router parse found the mutating agent/reports routes",
  len(_mutating) >= 6, True)
for _route, _handler in _mutating:
    # ⚠️ /agent-mcp is deliberately unreachable through nginx (asserted above)
    # and carries its own token auth, not a session cookie.
    if _route == "/agent-mcp":
        continue
    # ⚠️ A STORE'S PUT IS NOT AN `async def` — it comes out of the
    # `_json_store_handlers` FACTORY, which applies `writer_roles` centrally
    # (owner-only by default). Asserting `_role_for` inside a body that does not
    # exist would fail a route that is MORE consistently guarded than a
    # hand-written one, so the factory's own guard is what is checked here.
    _made_by_factory = re.search(
        re.escape(_handler) + r"\s*=\s*_json_store_handlers\(", _proxy_src) \
        or re.search(r"[a-z_]+,\s*" + re.escape(_handler)
                     + r"\s*=\s*_json_store_handlers\(", _proxy_src)
    if _made_by_factory:
        t(f"{_route} is a store PUT and inherits the factory's role gate",
          "if _role_for(request) not in writer_roles:" in _proxy_src, True)
        continue
    _body = re.search(
        r"^async def " + re.escape(_handler) + r"\(.*?(?=\n(?:async )?def )",
        _proxy_src + _api_src, re.S | re.M)
    # /agent-config's PUT is factory-made and injected via bind();
    # it has no `async def` body in either file, by design.
    if _route == "/agent-config" and _handler.startswith("config"):
        t(f"{_route} is the factory PUT, injected via bind()",
          "config_put=agent_config_put_handler" in _proxy_src, True)
        continue
    t(f"{_route} resolves to a handler in the proxy", bool(_body), True)
    if not _body:
        continue
    # ⚠️ AUTHENTICATED **AND** ROLE-CHECKED. `_authorized` alone only proves a
    # session exists — a guest's phone has one, and every route here mutates
    # shared state or spends the villa's money.
    # ⚠️ THE SPELLING DIFFERS BY FILE AND THE PROPERTY DOES NOT: proxy-resident
    # handlers call `_authorized`/`_role_for`; api-resident ones call the SAME
    # functions through the injected `deps.` seam (TASK-115 step 6). Accepting
    # either spelling is not a loosening — both resolve to the one auth
    # machinery, bound once at startup.
    t(f"{_route} rejects an unauthenticated caller",
      "_authorized(request)" in _body.group(0)
      or "deps.authorized(request)" in _body.group(0), True)
    t(f"{_route} checks the caller's role",
      "_role_for(request)" in _body.group(0)
      or "deps.role_for(request)" in _body.group(0), True)

proxy._read_options = _saved_read_options

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
