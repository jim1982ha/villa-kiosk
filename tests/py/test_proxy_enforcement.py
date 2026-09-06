"""The proxy's refusals, driven — the ones CI has never run.

⚠️ 3,114 LINES OF AUTH AND RBAC WITH ONE BEHAVIOURAL PIN IN CI. Every
enforcement decision in `supervisor-proxy.py` was pinned only in
`tests/security_test.py`, and:

    git check-ignore -v tests/security_test.py -> .gitignore:10:tests/*
    git ls-files tests/security_test.py        -> (nothing)

CI runs `pytest tests/py`, `mypy --strict rootfs/usr/bin/vesta` (which does not
cover this file) and two offline greps. So on a fresh clone the suite that
holds the allowlists did not exist. Counted both directions when this file was
written:

    _rest_call_allowed      tests/py 0   security_test.py 11
    _fm_write_guard         tests/py 0   security_test.py 15
    _lockout_remaining      tests/py 0   security_test.py  4
    ALLOWED_WS_TYPES        tests/py 0   security_test.py  3
    _sign_session           tests/py 0   security_test.py  2
    _mint_elevation         tests/py 0   security_test.py  2
    _service_call_allowed   tests/py 0   security_test.py  0   <- nowhere
    _consume_elevation      tests/py 0   security_test.py  0   <- nowhere
    _model_authorized       tests/py 0   security_test.py  0   <- nowhere

⚠️ FIVE OF THEM WERE PINNED NOWHERE AT ALL, including on the machine that runs
the gitignored suite. `_rest_call_allowed`'s own docstring is the argument for
why that matters: it enumerates six inputs that DID reach Core from a guest
session, and ends "An allowlist that fails open is not an allowlist."

⚠️ THIS DOES NOT REPLACE `tests/security_test.py`, which is far wider (272
checks) and is the owner's own instrument. It carries the decisions that must
not be able to regress on a fresh clone, which is a strictly smaller set.

`test_ingress_privilege.py` established the loader; this file follows it.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from typing import Any, Dict, Optional

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROXY_PATH = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")

pytest.importorskip("aiohttp", reason="proxy requires aiohttp")


def _load_proxy() -> Any:
    spec = importlib.util.spec_from_file_location("proxy_enforcement", PROXY_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["proxy_enforcement"] = module
    spec.loader.exec_module(module)
    return module


proxy = _load_proxy()


class Req:
    """Enough of a `web.Request` for a guard to read a role off."""

    def __init__(self, role: Optional[str] = None, ingress: bool = False) -> None:
        self.cookies: Dict[str, str] = (
            {proxy.SESSION_COOKIE: proxy._make_session_token(role)} if role else {})
        self.headers: Dict[str, str] = {"X-VK-Ingress": "1"} if ingress else {}
        self.remote = "127.0.0.1"


# ── the REST allowlist, and the six inputs that got past it ────────────────

#: ⚠️ VERBATIM FROM `_rest_call_allowed`'s OWN DOCSTRING. Each of these reached
#: Core from a guest session when the function ended in `return True`. They are
#: the worked example the code carries, so they are the fixture: a reader who
#: changes the predicate can run the exact six.
FAILED_OPEN_ONCE = (
    "SERVICES/lock/unlock",              # capitals
    "./services/lock/unlock",            # dot-relative
    "services//lock/unlock",             # empty segment
    "services/../services/lock/unlock",  # traversal
    "services/lock/unlock%00",           # null byte
    "services/lock/unlock;a=b",          # parameter
    "./template",                        # arbitrary Jinja2 against all of HA
)


@pytest.mark.parametrize("tail", FAILED_OPEN_ONCE)
def test_the_six_tails_that_reached_core_are_refused_for_a_guest(tail: str) -> None:
    assert proxy._rest_call_allowed("guest", tail) is False, (
        "%r reached Core from a guest session once. An allowlist that fails "
        "open is not an allowlist." % tail)


@pytest.mark.parametrize("tail", FAILED_OPEN_ONCE)
def test_those_tails_are_refused_for_every_non_owner_role(tail: str) -> None:
    """⚠️ NOT JUST `guest`. The rule is "non-owner", and a fixture that only
    ever asks about one role cannot see a predicate that special-cases it."""
    for role in (r for r in proxy.AUTH_ROLES if r != "owner"):
        assert proxy._rest_call_allowed(role, tail) is False, (role, tail)


#: ⚠️ A TAIL THAT ESCAPES AN *ALLOWED* PREFIX. The six above are all refused by
#: the default-deny even with the traversal guard deleted — I mutated it out and
#: this file stayed green — because none of them matches a permitted prefix in
#: the first place. These do: they open with `history/period/`, which IS
#: permitted, and then climb out of it. They are what the `..` / `//` / `./`
#: check is actually load-bearing for, and the only inputs that can prove it is
#: still there.
ESCAPES_AN_ALLOWED_PREFIX = (
    "history/period/../../services/lock/unlock",
    "history/period/..",
    "camera_proxy//../services/homeassistant/restart",
    "camera_proxy_stream/../../template",
)


@pytest.mark.parametrize("tail", ESCAPES_AN_ALLOWED_PREFIX)
def test_a_permitted_prefix_cannot_be_climbed_out_of(tail: str) -> None:
    assert proxy._rest_call_allowed("guest", tail) is False, (
        "%r starts inside a permitted prefix and then leaves it. Without the "
        "traversal check this reaches Core, because the prefix test alone "
        "says yes." % tail)


def test_the_rest_allowlist_defaults_to_DENY() -> None:
    """⚠️ THE PROPERTY, NOT A LIST OF PATHS. A path nobody thought to name must
    be refused; naming them one at a time is what the old shape did."""
    for tail in ("template", "config", "error_log", "services",
                 "calendars", "states/lock.front", "", "/"):
        assert proxy._rest_call_allowed("guest", tail) is False, tail


def test_the_paths_the_kiosk_itself_asks_for_are_permitted() -> None:
    """The converse — a default-deny that denies everything is not a gate, it
    is an outage, and this file must be able to tell them apart."""
    for tail in ("history/period/2026-01-01T00:00:00",
                 "camera_proxy/camera.example_one",
                 "camera_proxy_stream/camera.example_one"):
        assert proxy._rest_call_allowed("ops", tail) is True, tail


def test_a_guest_may_not_pull_camera_frames() -> None:
    """`permissions.ts` denies the camera type to a guest client-side; the
    intent is mirrored here because an image request needs no metadata lookup
    to recognise. `ops` keeps it — see the test above."""
    for tail in ("camera_proxy/camera.example_one",
                 "camera_proxy_stream/camera.example_one"):
        assert proxy._rest_call_allowed("guest", tail) is False, tail


def test_the_owner_is_exempt_from_the_rest_allowlist() -> None:
    for tail in FAILED_OPEN_ONCE + ("template", "config"):
        assert proxy._rest_call_allowed("owner", tail) is True, tail


# ── the service allowlist, pinned nowhere before this file ─────────────────

def test_a_non_owner_may_not_call_a_service_outside_the_domains() -> None:
    for domain in ("automation", "script", "shell_command", "hassio",
                   "persistent_notification", "input_boolean"):
        assert proxy._service_call_allowed("guest", domain, "turn_on") is False, domain


def test_homeassistant_admits_only_the_generic_toggle() -> None:
    """⚠️ THE DOMAIN CARRIES `restart`, `stop`, `reload_core_config` AND
    `set_location`. Admitting the domain rather than the service is the whole
    difference between a light switch and control of the installation."""
    assert proxy._service_call_allowed("guest", "homeassistant", "toggle") is True
    for service in ("restart", "stop", "reload_core_config", "set_location",
                    "update_entity", "check_config"):
        assert proxy._service_call_allowed("guest", "homeassistant", service) is False, service


def test_the_rest_service_path_and_the_websocket_frame_decide_alike() -> None:
    """⚠️ ONE OWNER FOR ONE PREDICATE. HA accepts `POST /api/services/<d>/<s>`
    as an exact equivalent of the websocket's `call_service`, so a rule
    enforced on one and not the other is not enforced."""
    for domain, service in (("light", "turn_on"), ("homeassistant", "restart"),
                            ("automation", "trigger"), ("lock", "unlock"),
                            ("homeassistant", "toggle"), ("script", "reload")):
        by_frame = proxy._service_call_allowed("guest", domain, service)
        by_path = proxy._rest_call_allowed("guest", "services/%s/%s" % (domain, service))
        assert by_frame == by_path, (
            "the websocket says %s and the REST path says %s for %s.%s"
            % (by_frame, by_path, domain, service))


def test_the_websocket_frame_types_are_an_allowlist_not_a_blocklist() -> None:
    for kind in ("call_service/unsafe", "supervisor/api", "config/auth/create",
                 "auth/long_lived_access_token", "execute_script",
                 "render_template", "hassio/",):
        assert kind not in proxy.ALLOWED_WS_TYPES, kind
    for kind in ("auth", "get_states", "call_service", "subscribe_events"):
        assert kind in proxy.ALLOWED_WS_TYPES, kind


# ── the session cookie ──────────────────────────────────────────────────────

def test_a_forged_or_edited_session_token_proves_nothing() -> None:
    good = proxy._make_session_token("owner")
    assert proxy._session_role(good) == "owner"
    role, exp, sig = good.split(".")
    for token in (
        "owner.%s.%s" % (exp, "0" * len(sig)),       # wrong signature
        "owner.%s.%s" % (int(exp) + 3600, sig),      # extended lifetime
        "%s.%s.%s" % ("ops", exp, sig),              # role swapped under it
        "owner.%s" % exp,                            # malformed
        "owner..%s" % sig,
        "",
    ):
        assert proxy._session_role(token) is None, token


def test_an_expired_token_proves_nothing() -> None:
    exp = int(time.time()) - 1
    token = "owner.%d.%s" % (exp, proxy._sign_session("owner", exp))
    assert proxy._session_role(token) is None, (
        "a correctly signed token past its expiry still names a role")


def test_a_role_the_installation_does_not_have_is_refused() -> None:
    """A signature is not enough — the role must be one this proxy knows."""
    exp = int(time.time()) + 600
    token = "superuser.%d.%s" % (exp, proxy._sign_session("superuser", exp))
    assert proxy._session_role(token) is None


def test_bumping_the_epoch_invalidates_every_outstanding_token(tmp_path,
                                                               monkeypatch) -> None:
    """⚠️ THIS IS WHAT "log everyone out" IS MADE OF. The epoch is mixed into
    the signature, so a bump must make every token minted before it fail."""
    monkeypatch.setattr(proxy, "SESSION_EPOCH_FILE", str(tmp_path / "epoch"))
    proxy._session_epoch.cache_clear() if hasattr(
        proxy._session_epoch, "cache_clear") else None
    before = proxy._make_session_token("owner")
    assert proxy._session_role(before) == "owner"
    proxy._bump_session_epoch()
    assert proxy._session_role(before) is None, (
        "a token minted before the epoch bump still names a role, so "
        "'log everyone out' logs nobody out")
    assert proxy._session_role(proxy._make_session_token("owner")) == "owner", (
        "no token minted after the bump is valid either — the bump broke "
        "signing rather than rotating it")


# ── the single-use elevation ────────────────────────────────────────────────

def test_an_elevation_token_is_spent_exactly_once() -> None:
    token = proxy._mint_elevation()
    assert proxy._consume_elevation(token) is True
    assert proxy._consume_elevation(token) is False, (
        "a replayed elevation token still authorises a destructive write")


def test_a_token_nobody_minted_authorises_nothing() -> None:
    for token in ("", None, 0, "not-a-token", b"bytes"):
        assert proxy._consume_elevation(token) is False, repr(token)


def test_an_expired_elevation_is_refused() -> None:
    token = proxy._mint_elevation()
    proxy._elevation_tokens[token] = time.monotonic() - 1
    assert proxy._consume_elevation(token) is False


def test_outstanding_elevations_cannot_grow_without_bound() -> None:
    proxy._elevation_tokens.clear()
    for _ in range(proxy.ELEVATION_MAX_OUTSTANDING + 20):
        proxy._mint_elevation()
    assert len(proxy._elevation_tokens) <= proxy.ELEVATION_MAX_OUTSTANDING + 20, (
        "minting without spending grows the dict without limit")
    proxy._elevation_tokens.clear()


# ── the Facility record write guard ─────────────────────────────────────────

def _doc(**over: Any) -> Dict[str, Any]:
    doc: Dict[str, Any] = {name: [] for name in proxy.FM_RECORD_COLLECTIONS}
    doc.update(over)
    return doc


#: ⚠️ THE SHAPE THE GUARD ACTUALLY REQUIRES, not the shape a ticket looks like.
#: My first fixture here was `{"id": "t2"}` and the guard refused it — a guest
#: report must be OPEN, unresolved, uncosted and self-declared, and a fixture
#: missing those would have made every assertion below pass for the wrong
#: reason (`feedback_fixtures-must-match-the-property`).
def _report(ident: str, **over: Any) -> Dict[str, Any]:
    ticket = {"id": ident, "status": "open", "reportedBy": "guest",
              "resolvedAt": None, "costId": None}
    ticket.update(over)
    return ticket


def test_a_guest_may_add_a_fault_report_and_nothing_else() -> None:
    old = _doc(tickets=[_report("t1")])
    assert proxy._fm_guest_write_ok(
        old, _doc(tickets=[_report("t1"), _report("t2")])) is True
    # editing their own filed report — refused, including their own
    assert proxy._fm_guest_write_ok(
        old, _doc(tickets=[_report("t1", cost=9)])) is False
    # removing one
    assert proxy._fm_guest_write_ok(old, _doc(tickets=[])) is False
    # a write that adds nothing is not a guest write at all
    assert proxy._fm_guest_write_ok(old, _doc(tickets=[_report("t1")])) is False


def test_a_guest_cannot_pre_resolve_backdate_or_cost_their_own_report() -> None:
    """⚠️ TRIAGE, STATUS, COST AND RESOLUTION STAY WITH owner/ops. A guest who
    could file a report already closed, or already carrying a cost, would be
    writing the maintenance record through the one door left open to them."""
    old = _doc(tickets=[])
    for over in ({"status": "closed"}, {"status": "in_progress"},
                 {"resolvedAt": "2026-01-01T00:00:00Z"}, {"costId": "c1"},
                 {"reportedBy": "owner"}):
        new = _doc(tickets=[_report("t1", **over)])
        assert proxy._fm_guest_write_ok(old, new) is False, over


def test_a_guest_cannot_reorder_existing_reports_to_hide_an_edit() -> None:
    """Element-wise, not by id — a reordering that leaves the same set is how
    an edit hides inside an append."""
    a, b = _report("t1"), _report("t2")
    old = _doc(tickets=[a, b])
    assert proxy._fm_guest_write_ok(old, _doc(tickets=[b, a, _report("t3")])) is False


def test_a_guest_cannot_file_an_unbounded_batch() -> None:
    old = _doc(tickets=[])
    many = [_report("t%d" % i) for i in range(proxy.FM_GUEST_MAX_NEW_TICKETS + 1)]
    assert proxy._fm_guest_write_ok(old, _doc(tickets=many)) is False


def test_a_guest_may_not_touch_any_other_collection() -> None:
    for name in proxy.FM_RECORD_COLLECTIONS:
        if name == "tickets":
            continue
        old = _doc(**{name: [{"id": "a"}]})
        new = _doc(**{name: [{"id": "a"}, {"id": "b"}]})
        assert proxy._fm_guest_write_ok(old, new) is False, name


def test_a_field_this_server_does_not_know_is_not_a_licence_to_rewrite_it() -> None:
    """A newer client's key must be as protected as a known one, or the guard
    is bypassed by naming the field something this version has not heard of.

    ⚠️ THE WRITE MUST BE OTHERWISE VALID, and my first version was not. It
    edited the unknown key while adding no ticket, so the append rule refused
    it and deleting the unknown-key loop left this green — a test passing for a
    reason other than the one it names. The only thing that may refuse this
    write is the rule under test.
    """
    old = _doc(tickets=[])
    old["future_collection"] = [{"id": "a"}]
    ok = _doc(tickets=[_report("t1")])
    ok["future_collection"] = [{"id": "a"}]
    assert proxy._fm_guest_write_ok(old, ok) is True, (
        "the control case is refused for some other reason, so the assertion "
        "below would prove nothing")

    tampered = _doc(tickets=[_report("t1")])
    tampered["future_collection"] = []
    assert proxy._fm_guest_write_ok(old, tampered) is False


def test_deleting_a_protected_record_needs_a_fresh_elevation(monkeypatch) -> None:
    """⚠️ THE STORE TAKES WHOLE DOCUMENTS, so a client that simply OMITS a
    record IS a delete. Gating the button would leave the capability open to
    anyone with a session and a JSON editor."""
    monkeypatch.setattr(proxy, "_configured_superadmin_pin", lambda: "0000")
    name = sorted(proxy.FM_PROTECTED_COLLECTIONS)[0]
    old = _doc(**{name: [{"id": "keep"}, {"id": "erase"}]})
    new = _doc(**{name: [{"id": "keep"}]})
    request = Req("owner")

    refused = proxy._fm_write_guard(request, {}, old, new)
    assert refused is not None, (
        "an owner erased an evidence record with no elevation at all")
    assert getattr(refused, "status", None) == 403

    token = proxy._mint_elevation()
    assert proxy._fm_write_guard(request, {"elevation": token}, old, new) is None
    assert proxy._fm_write_guard(request, {"elevation": token}, old, new) is not None, (
        "the same elevation erased a second record — it is not single use")


def test_the_guest_shape_rule_is_reached_through_the_guard_a_request_hits() -> None:
    """⚠️ PINNED AT THE CALLER. Every other assertion in this file calls
    `_fm_guest_write_ok` directly, and deleting the branch in `_fm_write_guard`
    that calls it left all of them green — a guest write then took the
    owner/ops path and was refused only if it happened to erase something.

    `feedback_pin-the-caller`: a test of the predicate survives the bug that
    nobody consulted it.
    """
    guest = next(r for r in proxy.AUTH_ROLES if r not in proxy.FM_FULL_WRITER_ROLES)
    old = _doc(tickets=[_report("t1")])

    edit = _doc(tickets=[_report("t1", status="closed")])
    refused = proxy._fm_write_guard(Req(guest), {}, old, edit)
    assert refused is not None and getattr(refused, "status", None) == 403, (
        "a %s session closed a fault report through the write guard" % guest)

    name = sorted(proxy.FM_PROTECTED_COLLECTIONS)[0]
    other = _doc(tickets=[_report("t1")], **{name: [{"id": "invented"}]})
    assert proxy._fm_write_guard(Req(guest), {}, old, other) is not None, (
        "a %s session wrote %s, which is not a fault report" % (guest, name))

    append = _doc(tickets=[_report("t1"), _report("t2")])
    assert proxy._fm_write_guard(Req(guest), {}, old, append) is None, (
        "a %s session could not file a fault report at all — the guard is "
        "refusing the one write it is supposed to allow" % guest)


def test_adding_and_amending_stay_open_to_the_full_writers(monkeypatch) -> None:
    monkeypatch.setattr(proxy, "_configured_superadmin_pin", lambda: "0000")
    name = sorted(proxy.FM_PROTECTED_COLLECTIONS)[0]
    old = _doc(**{name: [{"id": "a"}]})
    new = _doc(**{name: [{"id": "a", "cost": 12}, {"id": "b"}]})
    for role in proxy.FM_FULL_WRITER_ROLES:
        assert proxy._fm_write_guard(Req(role), {}, old, new) is None, role


def test_deletion_is_refused_outright_when_no_superadmin_is_configured(
        monkeypatch) -> None:
    """⚠️ FAIL CLOSED. An installation with no superadmin code must not fall
    back to "anyone may delete" — the record is the evidence."""
    monkeypatch.setattr(proxy, "_configured_superadmin_pin", lambda: "")
    name = sorted(proxy.FM_PROTECTED_COLLECTIONS)[0]
    old = _doc(**{name: [{"id": "a"}]})
    refused = proxy._fm_write_guard(Req("owner"), {"elevation": proxy._mint_elevation()},
                                    old, _doc(**{name: []}))
    assert refused is not None and getattr(refused, "status", None) == 403


# ── the upload magic ────────────────────────────────────────────────────────

def test_an_upload_must_look_like_what_it_claims_to_be() -> None:
    """The floor plan is executed by the browser's glTF loader; a kind whose
    signature nobody checks is an arbitrary file reaching that loader."""
    assert proxy.UPLOAD_MAGIC["glb"] == (b"glTF",)
    assert b"{" in proxy.UPLOAD_MAGIC["rooms"]
    assert b"\xef\xbb\xbf{" in proxy.UPLOAD_MAGIC["rooms"], (
        "a BOM-prefixed JSON sidecar is what Windows editors write")


# ── the public-model escape hatch ───────────────────────────────────────────

def test_public_model_access_is_off_unless_the_option_says_otherwise(
        monkeypatch) -> None:
    """⚠️ IT WIDENS TWO ROUTES AND MUST NOT WIDEN `/core/*`. Read fresh on every
    call, so this pins the default AND the opt-in."""
    monkeypatch.setattr(proxy, "_read_options", lambda: {})
    assert proxy._public_model_access() is False
    assert proxy._model_authorized(Req()) is False, (
        "an unauthenticated caller reached the floor plan with the option off")

    monkeypatch.setattr(proxy, "_read_options", lambda: {"public_model_access": True})
    assert proxy._model_authorized(Req()) is True
    assert proxy._authorized(Req()) is False, (
        "the escape hatch widened `_authorized` itself, so it reaches /core/* "
        "— it is supposed to widen the floor plan and the add-on config only")


# ── the brute-force limiter ─────────────────────────────────────────────────

def _reset_limiter() -> None:
    proxy._auth_failures.clear()
    for hits in proxy._auth_failures_global.values():
        hits.clear()


def test_a_lockout_punishes_the_guesser_and_not_the_villa() -> None:
    """⚠️ THE RULE THE WHOLE LIMITER EXISTS FOR. It used to be keyed by ROLE
    ALONE, so anyone on the internet could send five wrong PINs and lock the
    real owner out of their own villa, repeatedly and indefinitely."""
    _reset_limiter()
    role = "owner"
    guesser, victim = "203.0.113.7", "192.168.1.50"
    now = time.monotonic()
    proxy._auth_failures[(role, guesser)] = {
        "count": proxy.AUTH_MAX_FAILURES, "last": now}

    assert proxy._lockout_remaining(role, guesser) > 0, "the guesser is not locked out"
    assert proxy._lockout_remaining(role, victim) == 0, (
        "the villa's own tablet is locked out because somebody else guessed")
    _reset_limiter()


class AuthReq:
    """A `/auth/verify` request, enough of one for the handler."""

    def __init__(self, role: str, pin: str, ip: str = "203.0.113.7") -> None:
        self._body = {"role": role, "pin": pin}
        self.headers: Dict[str, str] = {"X-Forwarded-For": ip}
        self.cookies: Dict[str, str] = {}
        self.remote = ip

    async def json(self) -> Any:
        return self._body


def _verify(role: str, pin: str, ip: str = "203.0.113.7") -> Any:
    """Drive the real handler. ⚠️ THE HANDLER, NOT THE STATE IT TOUCHES."""
    import asyncio

    return asyncio.run(proxy.auth_verify_handler(AuthReq(role, pin, ip)))


def test_a_trickle_of_honest_mistakes_never_locks_the_villa_out(monkeypatch) -> None:
    """⚠️ THE PROPERTY THE 2.962.0 FIX CLAIMED AND DID NOT DELIVER.

    That release added ageing keyed on `gst["last"]` — which is refreshed on
    EVERY failure — so any trickle faster than one mistake per window never
    ages at all. It is a quiet-period reset, not a rate. Driven against the
    shipped code before this test was written:

        one honest mistake every 14 minutes
        -> LOCKED OUT after 50 mistakes, 11.4 hours elapsed, every address

    Slower than the lifetime accumulator it replaced, and the same defect: the
    villa is punished for its guests mistyping, which is what this limiter's
    own preamble says must never happen.

    ⚠️ THE FIXTURE IS THE POINT. A test that fires fifty failures back to back
    proves nothing here — that is the burst case, which always locked and still
    must. The interval has to be long enough that no reasonable person calls it
    an attack, and short enough that the old code still accumulated.
    """
    _reset_limiter()
    role = "owner"
    window = proxy.AUTH_GLOBAL_LOCKOUT_SECONDS
    step = window / 4.0                       # four honest mistakes per window
    start = time.monotonic()

    for i in range(proxy.AUTH_GLOBAL_MAX_FAILURES * 3):
        now = start + i * step
        proxy._note_global_failure(role, now)
        assert proxy._global_locked_for(role, now) <= 0, (
            "one mistyped PIN every %.0f minutes locked the whole villa out "
            "of the %s profile after %d of them (%.1f hours) — nobody at this "
            "rate is guessing" % (step / 60, role, i + 1, i * step / 3600))
    _reset_limiter()


def test_a_real_burst_still_trips_the_global_backstop() -> None:
    """The converse, and the reason the tier exists: per-client limiting alone
    is defeated by rotating source addresses, so a distributed guess has to be
    bounded by something. A fix that only relaxes is not a fix."""
    _reset_limiter()
    role = "owner"
    now = time.monotonic()
    for i in range(proxy.AUTH_GLOBAL_MAX_FAILURES):
        proxy._note_global_failure(role, now + i)      # a second apart
    assert proxy._global_locked_for(role, now + proxy.AUTH_GLOBAL_MAX_FAILURES) > 0, (
        "%d failures inside one window did not lock anything"
        % proxy.AUTH_GLOBAL_MAX_FAILURES)
    _reset_limiter()


def test_the_global_tier_cannot_grow_without_bound() -> None:
    """A windowed count keeps timestamps; an attacker must not be able to make
    that list the memory-exhaustion vector the per-client table was bounded
    against."""
    _reset_limiter()
    now = time.monotonic()
    for i in range(50_000):
        proxy._note_global_failure("owner", now + i * 0.001)
    held = len(proxy._auth_failures_global["owner"])
    assert held <= proxy.AUTH_GLOBAL_MAX_FAILURES * 2, (
        "the global tier is holding %d timestamps" % held)
    _reset_limiter()


def test_a_correct_pin_clears_the_caller_and_not_the_global_tier(monkeypatch) -> None:
    """One correct PIN must not reset a distributed guess in progress.

    ⚠️ THIS TEST WROTE THE LINE IT THEN ASSERTED ABOUT, and its name is a claim
    about `auth_verify_handler` that it never called. It set the per-client
    counter to 0 itself — "what a correct PIN does" — and checked the global
    tier was untouched, so adding `gst["count"] = 0` to the handler's own `if
    ok:` arm left all fifty tests in this file green. Measured, not argued.

    `feedback_pin-the-caller` for the fourth time in this repository, in the
    commit whose message said it had caught that defect twice.
    """
    monkeypatch.setattr(proxy, "_configured_pin", lambda role: "1234")
    _reset_limiter()
    role, ip = "owner", "203.0.113.7"

    for _ in range(3):
        _verify(role, "0000", ip)
    assert proxy._auth_failures[(role, ip)]["count"] == 3
    assert len(proxy._auth_failures_global[role]) == 3, (
        "the global tier did not see the failures")

    _verify(role, "1234", ip)                      # the correct PIN, for real
    assert proxy._auth_failures[(role, ip)]["count"] == 0, (
        "a correct PIN did not clear the caller's own counter")
    assert len(proxy._auth_failures_global[role]) == 3, (
        "one correct PIN emptied the global tier, so a distributed guess is "
        "reset by any one guesser getting it right")
    _reset_limiter()


def test_the_handler_refuses_once_the_caller_is_locked_out(monkeypatch) -> None:
    """⚠️ DRIVEN, because `_lockout_remaining` returning a number proves
    nothing about whether the handler consults it."""
    monkeypatch.setattr(proxy, "_configured_pin", lambda role: "1234")
    _reset_limiter()
    role, ip = "owner", "203.0.113.7"
    for _ in range(proxy.AUTH_MAX_FAILURES):
        _verify(role, "0000", ip)

    locked = _verify(role, "0000", ip)
    assert getattr(locked, "status", None) == 429, (
        "the caller sent %d wrong PINs and the handler kept checking"
        % (proxy.AUTH_MAX_FAILURES + 1))
    # ⚠️ AND THE CORRECT PIN IS REFUSED TOO. A lockout that a right answer walks
    # through is not a lockout — it is exactly the state a guesser reaches.
    assert getattr(_verify(role, "1234", ip), "status", None) == 429
    # A different address is unaffected: the guesser is punished, not the villa.
    assert getattr(_verify(role, "1234", "192.168.1.50"), "status", None) != 429
    _reset_limiter()


def test_the_tracked_client_table_cannot_grow_without_bound() -> None:
    """The old role-keyed dict was fixed-size by construction; keying on the
    source address replaced that with an explicit bound, which has to hold."""
    _reset_limiter()
    now = time.monotonic()
    for i in range(proxy.AUTH_TRACK_MAX_CLIENTS + 100):
        proxy._auth_failures[("owner", "10.%d.%d.%d" % (i // 65536, i // 256 % 256, i % 256))] = {
            "count": 1, "last": now}
    proxy._prune_auth_failures(now)
    assert len(proxy._auth_failures) <= proxy.AUTH_TRACK_MAX_CLIENTS, (
        "an attacker cycling source addresses grew the table to %d"
        % len(proxy._auth_failures))
    _reset_limiter()
