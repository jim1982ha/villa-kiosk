"""The renderer and the delivery payload.

Two rules pinned here that no type checker can see, and both of which decide
whether the owner trusts the thing:

  AN EMPTY REPORT MUST NOT READ AS "ALL IS WELL". Phase 2 has no analysis
  modules, so every report is empty. "Nothing to report" is a conclusion, and
  nothing has drawn it.

  THE DELIVERY PAYLOAD IS THE INTERSECTION OF WHAT PLATFORMS ACCEPT. The owner
  is moving to Telegram later; a renderer that emits markdown would show
  literal asterisks on the platforms that do not parse it, and the moment
  delivery carries a `parse_mode` it has a platform table in it.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from reports.deliver import _service_path, deliver, deliver_one
from reports.narrate import DeterministicNarrator, ReportContext


def _ctx(**kw: Any) -> ReportContext:
    base: Dict[str, Any] = {
        "audience": "owner", "cadence": "weekly", "period": "2026-W34",
        "generated_at": "2026-08-20T07:00:00+08:00",
        "discovery": {
            "reachable": True,
            "capabilities": ["statistics", "energy_grid"],
            "capabilities_missing": ["energy_cost"],
            "capability_meaning": {
                "energy_cost": "A tariff is configured, so consumption can be "
                               "expressed as money.",
            },
            "preflight": [],
        },
        "findings": [], "skipped": [],
    }
    base.update(kw)
    return ReportContext(**base)


# ── the renderer ─────────────────────────────────────────────────────────────

def test_an_empty_report_does_not_claim_all_is_well() -> None:
    """⚠️ The sentence that keeps a Phase 2 report honest."""
    _, body = DeterministicNarrator().render(_ctx())
    assert "nothing has been assessed" in body
    for forbidden in ("all is well", "everything is fine", "no issues", "all good"):
        assert forbidden not in body.lower()


def test_blind_spots_travel_with_the_report() -> None:
    """An owner reading a summary with no mention of cost must be told no
    tariff is configured, not left to assume energy was free."""
    _, body = DeterministicNarrator().render(_ctx(discovery={
        **_ctx().discovery,
        "capability_absent": {"energy_cost": "No tariff is configured."},
    }))
    assert "Not covered by this report" in body
    assert "tariff" in body


def test_blind_spots_use_the_absent_voice() -> None:
    """⚠️ THE BUG A RENDERED SAMPLE CAUGHT.

    `capability_meaning` says what a capability ENABLES. Printed under "not
    covered by this report" it asserts the OPPOSITE of the truth — "A tariff is
    configured, so consumption can be expressed as money" about a property with
    no tariff — in the section whose whole job is honesty about blind spots.
    Grammatical, plausible, and wrong; only reading the output finds it.
    """
    _, body = DeterministicNarrator().render(_ctx(discovery={
        **_ctx().discovery,
        "capability_meaning": {"energy_cost": "A tariff is configured, so "
                                              "consumption can be expressed as money."},
        "capability_absent": {"energy_cost": "No tariff is configured, so "
                                             "consumption cannot be expressed as money."},
    }))
    assert "No tariff is configured" in body
    assert "A tariff is configured" not in body


def test_a_capability_explained_by_preflight_is_not_repeated() -> None:
    """Said once, under "needs attention", where it is actionable — rather
    than there AND again two lines later in slightly different words."""
    _, body = DeterministicNarrator().render(_ctx(discovery={
        **_ctx().discovery,
        "capabilities_missing": ["energy_cost"],
        "capability_absent": {"energy_cost": "No tariff is configured."},
        "preflight": [{"severity": "notice", "capability": "energy_cost",
                       "detail": "No tariff is configured on the Energy dashboard."}],
    }))
    # ⚠️ THE INVARIANT IS "SAID ONCE", NOT THE HEADING IT IS SAID UNDER. Phase D
    # moved preflight into "Monitoring health", where a stale configuration
    # belongs — it is a fault in the monitoring, not a limit of the property.
    assert body.count("tariff is configured") == 1, body
    assert "Monitoring health" in body
    assert "Not covered by this report" not in body, (
        "the only missing capability was already explained under monitoring health")


def test_the_date_is_readable() -> None:
    """An ISO timestamp in a message on a phone is not prose."""
    _, body = DeterministicNarrator().render(_ctx())
    assert "2026-08-20T07:00:00" not in body
    assert "Thursday" in body and "August" in body


def test_an_unreachable_pass_says_so_plainly() -> None:
    """Silence is indistinguishable from a healthy quiet week."""
    _, body = DeterministicNarrator().render(_ctx(discovery={
        "reachable": False, "error": "connection refused",
        "capabilities": [], "capabilities_missing": [], "preflight": [],
    }))
    assert "could not be reached" in body
    assert "connection refused" in body
    assert "Not covered by this report" not in body, (
        "a blind-spot list built from an outage would imply the capabilities "
        "were measured and found missing")


def test_critical_preflight_is_not_buried(  ) -> None:
    """A stale configuration EXPLAINS an empty report; under a pile of notices
    it goes unread for months."""
    _, body = DeterministicNarrator().render(_ctx(discovery={
        **_ctx().discovery,
        "preflight": [
            {"severity": "notice", "detail": "A notice."},
            {"severity": "critical", "detail": "Configuration is stale."},
            {"severity": "warning", "detail": "A warning."},
        ],
    }))
    # ⚠️ ASSERT THE ORDERING, NOT POSITION 0 IN THE DOCUMENT. `lines[0]` was a
    # proxy that held only while preflight was the one bulleted section; Phase D
    # added seven more. The rule was always "critical above notice", and reading
    # it off the whole body made a section ABOVE preflight look like a
    # regression when it was the new structure working.
    order = [body.index(t) for t in
             ("Configuration is stale.", "A warning.", "A notice.")]
    assert order == sorted(order), (
        "critical preflight must sort above warning and notice")


def test_findings_are_rendered_when_present() -> None:
    _, body = DeterministicNarrator().render(_ctx(findings=[
        {"label": "Pool pump", "severity": "warning", "area": "Plant room",
         "detail": "drawing more than its own baseline"},
    ]))
    # Phase D routes findings into the eight sections by KIND rather than
    # listing them under one heading. What must survive is every FIELD: the
    # label, the AREA (the only thing distinguishing two identically named
    # devices) and the detail.
    assert "1 finding" in body
    assert "Pool pump" in body and "Plant room" in body
    assert "drawing more than its own baseline" in body
    assert "nothing has been assessed" not in body


def test_the_body_is_plain_text() -> None:
    """⚠️ No markdown. Telegram would parse it; persistent_notification would
    print the asterisks. Plain text reads correctly on both."""
    _, body = DeterministicNarrator().render(_ctx(findings=[
        {"label": "X", "severity": "info", "detail": "y"}]))
    for markup in ("**", "__", "<b>", "<br", "```", "* "):
        assert markup not in body, f"{markup!r} found in body"


def test_the_title_names_the_period_and_audience() -> None:
    title, _ = DeterministicNarrator().render(_ctx())
    assert "2026-W34" in title
    assert "Weekly" in title


def test_the_renderer_never_invents_a_number() -> None:
    """No "0 kWh" for a meter that reported nothing — that states a
    measurement nobody took."""
    _, body = DeterministicNarrator().render(_ctx())
    assert "0 kWh" not in body and "0kWh" not in body


def test_skipped_modules_are_named() -> None:
    _, body = DeterministicNarrator().render(_ctx(skipped=[
        {"module": "standby_creep", "reason": "insufficient history"}]))
    assert "standby_creep" in body and "insufficient history" in body


# ── delivery ─────────────────────────────────────────────────────────────────

def test_service_path_accepts_both_forms() -> None:
    """A config written by hand without the domain must still work, rather
    than failing at delivery time with a 404 nobody can interpret."""
    assert _service_path("notify.persistent_notification") == "notify/persistent_notification"
    assert _service_path("persistent_notification") == "notify/persistent_notification"
    assert _service_path("  notify.telegram  ") == "notify/telegram"


def test_a_target_outside_the_notify_domain_keeps_its_domain() -> None:
    """⚠️ THE DOMAIN WAS HARD-CODED AND THE HEADER CLAIMED IT WAS NOT. This
    file says moving to Telegram is "a configuration change rather than a code
    change"; it was not, because the modern `telegram_bot` integration
    registers `telegram_bot.send_message` and NO `notify.telegram_*` service —
    so the target was rewritten to `notify/telegram_bot.send_message` and 404'd.

    Found on the reference villa: a loaded telegram_bot entry, nine notify
    services, none of them Telegram, and an owner asking where it had gone."""
    assert _service_path("telegram_bot.send_message") == "telegram_bot/send_message"
    assert _service_path("  telegram_bot.send_message  ") == "telegram_bot/send_message"


def test_only_services_that_take_a_required_message_are_offered() -> None:
    """⚠️ A CAPABILITY TEST, NOT A SECOND DOMAIN NAME. What makes a service a
    valid destination is that it speaks the payload `deliver` sends — a
    REQUIRED `message` plus a `title`. Requiring `message` to be REQUIRED is
    what keeps the other twenty telegram actions (send_photo, edit_caption,
    delete_message) out of a list the operator picks a destination from."""
    from reports.discovery import _speaks_message
    assert _speaks_message({"message": {"required": True}, "title": {}})
    # title-only, message-optional, and message-absent are all not destinations
    assert not _speaks_message({"title": {}})
    assert not _speaks_message({"message": {"required": False}, "title": {}})
    assert not _speaks_message({"message": {"required": True}})
    assert not _speaks_message({"message": "not a schema", "title": {}})


class _FakeResponse:
    def __init__(self, status: int, body: str = "") -> None:
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self) -> "_FakeResponse":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeSession:
    """Records what was actually sent, which is the point of these tests."""

    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.calls: List[Dict[str, Any]] = []

    def post(self, url: str, headers: Optional[Dict[str, str]] = None,
             json: Optional[Dict[str, Any]] = None, **kw: Any) -> _FakeResponse:
        self.calls.append({"url": url, "json": json})
        return _FakeResponse(self.status)


def test_the_payload_is_title_and_message_only() -> None:
    """⚠️ THE PLATFORM-AGNOSTIC RULE, pinned.

    Adding `data` here would be the first step toward a per-platform table, and
    the owner is moving to Telegram — the exact moment that temptation arrives.
    """
    session = _FakeSession()
    asyncio.run(deliver_one(session, "notify.x", "T", "B"))  # type: ignore[arg-type]
    assert session.calls[0]["json"] == {"title": "T", "message": "B"}


def test_no_platform_name_appears_in_the_delivery_module() -> None:
    """The target is a service id discovered at runtime. A platform name in
    this file would be villa-specific data AND a maintenance trap.

    ⚠️ DOCSTRINGS ARE STRIPPED WITH `ast`, NOT WITH A LINE FILTER. The first
    version of this test checked `line.startswith(('#', '"'))` and failed on
    deliver.py's own module docstring — which names Telegram precisely to
    explain why the CODE must not. Matching prose in a comment is the classic
    false positive this project's /dry-audit skill warns about, and this test
    committed it against itself on its first run. Parsing is the fix: a real
    parse cannot confuse a docstring for a string literal in a call.
    """
    import ast
    import inspect

    from reports import deliver as deliver_module

    tree = ast.parse(inspect.getsource(deliver_module))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    code = ast.unparse(tree).lower()

    for platform in ("telegram", "mobile_app", "pushbullet", "slack", "smtp"):
        assert platform not in code, f"{platform} named in deliver.py's CODE"


def test_the_stripper_can_still_see_real_code() -> None:
    """Guard against the test above passing vacuously — if the ast stripping
    removed everything, every assertion would hold over an empty string."""
    import ast
    import inspect

    from reports import deliver as deliver_module

    tree = ast.parse(inspect.getsource(deliver_module))
    code = ast.unparse(tree)
    assert "notify/" in code, "the stripper ate the code it was meant to check"


def test_one_failed_target_does_not_block_another() -> None:
    """A report that reached the owner and failed to reach the facility
    manager is not "failed"."""
    class Mixed(_FakeSession):
        def post(self, url: str, headers: Any = None, json: Any = None,
                 **kw: Any) -> _FakeResponse:
            self.calls.append({"url": url, "json": json})
            return _FakeResponse(500 if "bad" in url else 200, "boom")

    session = Mixed()
    results = asyncio.run(deliver(
        session, ["notify.bad", "notify.good"], "T", "B"))  # type: ignore[arg-type]
    assert [r["status"] for r in results] == ["failed", "sent"]
    assert "500" in results[0]["detail"]


def test_no_targets_is_a_state_not_an_error() -> None:
    """A report with nowhere to go is a configuration the operator can see and
    fix; raising would turn it into a scheduler crash."""
    assert asyncio.run(deliver(_FakeSession(), [], "T", "B")) == []  # type: ignore[arg-type]


def test_a_refusing_target_is_reported_not_raised() -> None:
    session = _FakeSession(status=400)
    results = asyncio.run(deliver(session, ["notify.x"], "T", "B"))  # type: ignore[arg-type]
    assert results[0]["status"] == "failed"
    assert "400" in results[0]["detail"]


# ── history entry identity ───────────────────────────────────────────────────
# ⚠️ FOUND BY QA ON REAL HARDWARE. The entry id was built from
# cadence/period/audience, so two schedules of the same cadence on the same day
# produced two rows reading `daily:<date>:owner`, distinguishable only by their
# timestamp. A history whose rows cannot be told apart is not much of an audit.

def test_a_scheduled_entry_is_identified_by_its_idempotency_key() -> None:
    """That key is the only thing that actually guarantees uniqueness — one
    send per schedule per period."""
    import asyncio
    from datetime import datetime, timezone

    from reports import pipeline

    entry = asyncio.run(pipeline.run_report(
        _FakeSession(), "owner", "daily", [],  # type: ignore[arg-type]
        datetime(2026, 8, 20, 18, 29, tzinfo=timezone.utc),
        found={"reachable": True, "preflight": []},
        entry_id="qa2:2026-08-20"))
    assert entry["id"] == "qa2:2026-08-20"


def test_two_schedules_on_one_day_produce_distinct_entries() -> None:
    """The exact regression, at the size it was observed."""
    import asyncio
    from datetime import datetime, timezone

    from reports import pipeline

    moment = datetime(2026, 8, 20, 18, 29, tzinfo=timezone.utc)
    found = {"reachable": True, "preflight": []}
    first = asyncio.run(pipeline.run_report(
        _FakeSession(), "owner", "daily", [], moment,  # type: ignore[arg-type]
        found=found, entry_id="qa2:2026-08-20"))
    second = asyncio.run(pipeline.run_report(
        _FakeSession(), "owner", "daily", [], moment,  # type: ignore[arg-type]
        found=found, entry_id="qa-asleep:2026-08-20"))
    assert first["id"] != second["id"]


def test_a_manual_send_is_marked_manual_and_carries_the_clock() -> None:
    """A manual send has no uniqueness guarantee — it can be repeated within a
    period deliberately — so it gets the time, and says who asked."""
    import asyncio
    from datetime import datetime, timezone

    from reports import pipeline

    entry = asyncio.run(pipeline.run_report(
        _FakeSession(), "owner", "weekly", [],  # type: ignore[arg-type]
        datetime(2026, 8, 20, 9, 9, 55, tzinfo=timezone.utc),
        found={"reachable": True, "preflight": []}))
    assert entry["id"].startswith("manual:")
    assert entry["id"].endswith(":090955")


def test_findings_are_counted_in_readable_english() -> None:
    """"1 finding(s)" is machine output; this is read by the villa's owner."""
    one = DeterministicNarrator().render(_ctx(findings=[
        {"label": "A", "severity": "info", "detail": "x"}]))[1]
    two = DeterministicNarrator().render(_ctx(findings=[
        {"label": "A", "severity": "info", "detail": "x"},
        {"label": "B", "severity": "info", "detail": "y"}]))[1]
    assert "1 finding" in one and "(s)" not in one
    assert "2 findings" in two and "(s)" not in two


# ── preview ──────────────────────────────────────────────────────────────────

def test_a_preview_composes_everything_and_sends_nothing() -> None:
    """⚠️ An operator deciding whether to switch reports on needs to READ one
    first. "Enable it and see what arrives" means finding out that a module is
    noisy on somebody's phone."""
    import asyncio
    from datetime import datetime, timezone

    from reports import pipeline

    session = _FakeSession()
    entry = asyncio.run(pipeline.run_report(
        session, "owner", "weekly", ["notify.somewhere"],  # type: ignore[arg-type]
        datetime(2026, 8, 20, 7, 0, tzinfo=timezone.utc),
        found={"reachable": True, "preflight": []}, preview=True))

    assert session.calls == [], "a preview must not call a notify service"
    assert entry["deliveries"] == []
    assert entry["_title"] and entry["_body"], "a preview must return the prose"


def test_a_real_send_still_delivers() -> None:
    """Guard against the preview flag defaulting the wrong way — which would
    silently stop every scheduled report."""
    import asyncio
    from datetime import datetime, timezone

    from reports import pipeline

    session = _FakeSession()
    asyncio.run(pipeline.run_report(
        session, "owner", "weekly", ["notify.somewhere"],  # type: ignore[arg-type]
        datetime(2026, 8, 20, 7, 0, tzinfo=timezone.utc),
        found={"reachable": True, "preflight": []}))
    assert len(session.calls) == 1


def test_history_stores_no_prose_and_no_findings(tmp_path: Any) -> None:
    """⚠️ The ring is capped by ENTRY COUNT. An entry whose size depends on how
    much a narrator wrote makes that cap meaningless — 200 entries could be a
    megabyte or fifty."""
    from reports import pipeline, store

    original = store.REPORTS_HISTORY_FILE
    store.REPORTS_HISTORY_FILE = str(tmp_path / "h.json")
    try:
        pipeline.append_history({
            "id": "x", "at": "now", "findingCount": 3,
            "_title": "T", "_body": "B" * 5000, "_findings": [{"a": 1}],
        })
        stored = store.read_json(store.REPORTS_HISTORY_FILE, store.EMPTY_HISTORY)
    finally:
        store.REPORTS_HISTORY_FILE = original

    entry = stored["entries"][0]
    assert entry["findingCount"] == 3
    assert not [k for k in entry if k.startswith("_")], entry


# ── which kind of empty? ─────────────────────────────────────────────────────
# ⚠️ FOUND ON THE FIRST LIVE RUN AGAINST REAL METERS. The report said "No
# automated checks are configured yet" about a property where a check had just
# run and found nothing. Three different empties, one sentence — the same
# failure as the blind-spot section asserting a tariff was configured.

def test_a_check_that_ran_and_found_nothing_says_so() -> None:
    _, body = DeterministicNarrator().render(_ctx(ran=["standby_creep"]))
    assert "1 check ran and found nothing" in body
    assert "not configured" not in body and "configured yet" not in body


def test_several_checks_that_ran_are_counted_in_english() -> None:
    _, body = DeterministicNarrator().render(_ctx(ran=["a", "b", "c"]))
    assert "3 checks ran and found nothing" in body


def test_no_modules_at_all_is_a_different_sentence() -> None:
    _, body = DeterministicNarrator().render(_ctx(ran=[]))
    assert "No automated checks are configured yet" in body


def test_everything_skipped_is_a_third_sentence() -> None:
    _, body = DeterministicNarrator().render(_ctx(
        ran=[], skipped=[{"module": "x", "reason": "not enough history yet"}]))
    assert "see the reasons below" in body
    assert "configured yet" not in body


def test_unreachable_still_wins_over_all_of_them() -> None:
    _, body = DeterministicNarrator().render(_ctx(
        ran=["standby_creep"],
        discovery={"reachable": False, "error": "down", "capabilities": [],
                   "capabilities_missing": [], "preflight": []}))
    assert "could not be reached" in body


def test_no_empty_sentence_claims_all_is_well() -> None:
    """Whichever of the three it is, none may read as a conclusion."""
    for kw in ({"ran": ["a"]}, {"ran": []},
               {"ran": [], "skipped": [{"module": "x", "reason": "y"}]}):
        _, body = DeterministicNarrator().render(_ctx(**kw))
        for forbidden in ("all is well", "everything is fine", "no issues",
                          "all good", "healthy"):
            assert forbidden not in body.lower(), (kw, forbidden)


# ── where one schedule's brief goes ─────────────────────────────────────────

def test_a_schedule_without_targets_inherits_the_shared_list() -> None:
    """The common case, and why the shared list exists at all: one property,
    one or two destinations, every brief to both."""
    from reports.pipeline import targets_for
    config = {"notify_targets": ["notify.a", "notify.b"]}
    assert targets_for(config, {"cadence": "daily"}) == ["notify.a", "notify.b"]


def test_a_schedule_with_its_own_targets_overrides_the_shared_list() -> None:
    from reports.pipeline import targets_for
    config = {"notify_targets": ["notify.a"]}
    assert targets_for(config, {"targets": ["telegram_bot.send_message"]}) == \
        ["telegram_bot.send_message"]


def test_an_EMPTY_own_list_means_nowhere_not_inherit() -> None:
    """⚠️ ABSENT MEANS INHERIT, EMPTY MEANS NOWHERE — the same distinction the
    whole config layer turns on, and it was not implemented here: an empty own
    list fell through to the shared one while the docstring above it said the
    opposite. Latent until the dialog could express it. An operator who gives a
    schedule its own destinations and then removes them all must not silently
    resume delivering to everyone."""
    from reports.pipeline import targets_for
    config = {"notify_targets": ["notify.a", "notify.b"]}
    assert targets_for(config, {"targets": []}) == []
