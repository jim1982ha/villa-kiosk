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
    assert "Needs attention" in body
    assert "Not covered by this report" not in body, (
        "the only missing capability was already explained under Needs attention")


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
    lines = [ln for ln in body.splitlines() if ln.startswith("- ")]
    assert lines[0] == "- Configuration is stale."


def test_findings_are_rendered_when_present() -> None:
    _, body = DeterministicNarrator().render(_ctx(findings=[
        {"label": "Pool pump", "severity": "warning", "area": "Plant room",
         "detail": "drawing more than its own baseline"},
    ]))
    assert "1 finding:" in body
    assert "Pool pump" in body and "Plant room" in body
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
    assert "1 finding:" in one and "(s)" not in one
    assert "2 findings:" in two
