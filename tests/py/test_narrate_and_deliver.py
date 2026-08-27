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

from datetime import datetime

import asyncio
from typing import Any, Dict, List, Optional

from reports.deliver import _service_path, deliver, deliver_one
from reports.narrate import ReportContext


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


def test_an_entity_target_goes_through_send_message_and_carries_its_entity() -> None:
    """⚠️ THE MODERN NOTIFY PLATFORM REGISTERS ONE SERVICE AND AN ENTITY PER
    DESTINATION, which the service list cannot reach and which is often the one
    the operator wants. A Telegram bot with two allowed chats appears as two
    notify ENTITIES and zero notify services — so addressing ONE of them (the
    group, not every chat the bot can reach) is only possible this way.

    The `entity:` prefix is load-bearing: `notify.mobile_app_x` is a SERVICE and
    `notify.living_room_bot_group` is an ENTITY, and nothing about the two
    strings distinguishes them.
    """
    from reports.deliver import _payload_for
    target = "entity:notify.living_room_bot_group"
    assert _service_path(target) == "notify/send_message"
    body = _payload_for(target, "T", "B")
    assert body == {"entity_id": "notify.living_room_bot_group",
                    "title": "T", "message": "B"}


def test_a_plain_target_carries_no_entity_id() -> None:
    """Still the intersection — `title` plus `message` — everywhere else.
    Sending a stray `entity_id` to a classic notify service is a 400."""
    from reports.deliver import _payload_for
    assert _payload_for("notify.mobile_app_x", "T", "B") == \
        {"title": "T", "message": "B"}
    assert _payload_for("telegram_bot.send_message", "T", "B") == \
        {"title": "T", "message": "B"}


def test_a_duplicate_route_to_an_offered_destination_is_not_offered() -> None:
    """⚠️ "IT FEELS LIKE REDUNDANT OPTIONS, RIGHT?" — it did, twice over on the
    reference villa, and offering a second name for one destination is worse
    than offering nothing: it invites a choice with no meaning, and in the
    telegram case one that quietly fans out where the operator picked a group.

    Both rules read data already fetched, and neither names an integration.
    """
    from reports.discovery import _redundant
    speaks = {"message": {"required": True}, "title": {}}

    # A: `notify.persistent_notification` exists, so `persistent_notification.*`
    # is the same place by another name.
    assert _redundant("persistent_notification", speaks, {"persistent_notification"})

    # B: the service addresses entities, so the ENTITIES are the real targets
    # and the bare service is the fan-out. Same rule `notify.send_message`
    # already got as `needs_target`, generalised.
    assert _redundant("telegram_bot", {**speaks, "entity_id": {}}, set())

    # ⚠️ CONSERVATIVE: nothing becomes unreachable. An integration that
    # registers neither a notify service nor notify entities keeps its own
    # service, because there it is the only route.
    assert not _redundant("some_integration", speaks, {"mobile_app_x", "notify"})


# ⚠️ test_the_history_entry_counts_the_findings_the_brief_actually_reports
# LEFT WITH TASK-071: its subject was blueprint GROUPS reaching the history
# entry's count and severity, and both the groups and their parser are gone —
# no producer, no rows, nothing to count. Module findings and preflight still
# reach the entry and are pinned elsewhere in this file.


def test_a_service_that_parses_markup_is_told_not_to() -> None:
    """⚠️ SENDING PLAIN TEXT IS NOT THE SAME AS IT ARRIVING PLAIN.

    The reference villa's Telegram integration has `parse_mode: markdown` as
    its DEFAULT, so it parsed our unmarked text on the way in and consumed
    every underscore as an italic marker. The delivered brief read
    `criticalschedule---poolpump`, `levelanomaly`, `sensorhealth`, `entityid`
    where the same brief in the console read `critical_schedule---pool_pump`.

    Lossy, silent and invisible from our end: the add-on logged `delivered`,
    and it had. Only comparing the message against the composed one found it —
    which is why the QA harness prints the composed brief.
    """
    from reports.deliver import _payload_for
    assert _payload_for("telegram_bot.send_message", "T", "B", "plain_text") == {
        "title": "T", "message": "B", "parse_mode": "plain_text"}
    # ⚠️ A SERVICE OFFERING NO SUCH OPTION GETS EXACTLY WHAT IT GOT BEFORE.
    assert _payload_for("notify.mobile_app_x", "T", "B") == {
        "title": "T", "message": "B"}
    # Both at once: an entity target on a parsing platform.
    assert _payload_for("entity:notify.bot_group", "T", "B", "none") == {
        "title": "T", "message": "B",
        "entity_id": "notify.bot_group", "parse_mode": "none"}


def test_the_no_parse_option_is_read_from_the_service_not_a_platform_list() -> None:
    """⚠️ A CAPABILITY TEST, like `_speaks_message`. The service DECLARES its
    `parse_mode` options; the question asked is "does it offer a way to switch
    parsing off", never "is this Telegram". Escaping instead would mean knowing
    which dialect each platform speaks — markdown, markdownv2 and html differ —
    which is the platform table this file exists to avoid."""
    from reports.discovery import _plain_mode
    telegram = {"parse_mode": {"selector": {"select": {
        "options": ["html", "markdown", "markdownv2", "plain_text"]}}}}
    assert _plain_mode(telegram) == "plain_text"
    assert _plain_mode({"parse_mode": {"selector": {"select": {
        "options": [{"value": "html"}, {"value": "none"}]}}}}) == "none"
    # A service with no parse_mode, or one offering only parsing modes.
    assert _plain_mode({"message": {"required": True}, "title": {}}) == ""
    assert _plain_mode({"parse_mode": {"selector": {"select": {
        "options": ["html", "markdown"]}}}}) == ""


def test_every_builder_of_a_target_record_sets_every_field() -> None:
    """⚠️ THIS IS WHY v2.559.0 DID NOTHING FOR THE ROUTE IT WAS WRITTEN FOR.

    `plain_mode` was added to the SERVICE loop in `_notify_targets` and the
    ENTITY builder beside it was left untouched, so every entity target carried
    no such key and `deliver` read "" for all of them. The owner's Telegram
    goes through an entity target, so the fix shipped, ran, and changed nothing
    they could see.

    Verbatim the `reachY` failure CLAUDE.md records in the badge tier: a second
    builder of the same record shape, copying nine fields and not the tenth.
    There is no type to enforce it — these are plain dicts crossing into JSON —
    so the shape is pinned here instead, derived from the builders themselves.
    """
    import asyncio
    from reports import discovery

    class _Hass:
        async def command(self, kind: str, **kw: object) -> object:
            if kind == "get_services":
                return {"notify": {"mobile_app_x": {
                    "name": "Mobile", "fields": {"message": {"required": True},
                                                 "title": {}}}}}
            return [{"entity_id": "notify.a_bot_chat",
                     "attributes": {"friendly_name": "A chat"}}]

    targets = asyncio.run(discovery._notify_targets(_Hass()))  # type: ignore[arg-type]
    services = [t for t in targets if not t["service"].startswith("entity:")]
    entities = [t for t in targets if t["service"].startswith("entity:")]
    assert services and entities, "the fixture must exercise BOTH builders"
    assert set(services[0]) == set(entities[0]), (
        f"the two builders disagree on the record shape: "
        f"only-in-service={set(services[0]) - set(entities[0])}, "
        f"only-in-entity={set(entities[0]) - set(services[0])}")


def test_an_entity_target_cannot_be_told_not_to_parse_and_says_so() -> None:
    """⚠️ THE SECOND REASON, AND IT IS STRUCTURAL RATHER THAN AN OVERSIGHT.

    An entity target is delivered through `notify.send_message`, whose live
    schema is `message` + `title` and nothing else — there is no `parse_mode`
    to set, so a platform that parses markup cannot be told to stop. That is
    why the identifiers were taken OUT of the prose (`readable_label`'s
    callers) rather than defended against at the wire.

    Pinned as an expectation so that if Home Assistant ever adds the field, the
    failure is a prompt to use it rather than a silent missed opportunity.
    """
    from reports.discovery import _plain_mode
    send_message_schema = {"message": {"required": True}, "title": {}}
    assert _plain_mode(send_message_schema) == "", (
        "notify.send_message now offers a parse mode — entity targets can be "
        "defended at the wire after all; wire it through _notify_entities")


# ⚠️ 19 RENDERER TESTS LEFT WITH THEIR RENDERER (TASK-073):
# test_an_empty_report_does_not_claim_all_is_well, test_blind_spots_travel_with_the_report, test_blind_spots_use_the_absent_voice, test_a_capability_explained_by_preflight_is_not_repeated, test_the_date_is_readable, test_an_unreachable_pass_says_so_plainly, test_critical_preflight_is_not_buried, test_findings_are_rendered_when_present, test_the_body_is_plain_text, test_the_title_names_the_period_and_audience, test_the_renderer_never_invents_a_number, test_skipped_modules_are_named, test_findings_are_counted_in_readable_english, test_a_check_that_ran_and_found_nothing_says_so, test_several_checks_that_ran_are_counted_in_english, test_no_modules_at_all_is_a_different_sentence, test_everything_skipped_is_a_third_sentence, test_unreachable_still_wins_over_all_of_them, test_no_empty_sentence_claims_all_is_well.
# Their subjects were sentences of `deterministic.py`'s document. The DELIVERY
# half of this file — service paths, target records, idempotency keys, history
# entries, the no-parse option — kept its subject and stays in full.


def test_a_history_ENTRY_carries_its_findings_not_just_a_count() -> None:
    """⚠️ MOVED FROM `test_shadow.py` WHEN THAT FILE LEFT WITH THE SHADOW STORE
    (2026-08-28) — the pin outlives the diff that first needed it, because the
    History tab and any later reader still depend on the entry's SHAPE.

    `store.py` has claimed since it was written that "a report entry is
    metadata plus findings, not the rendered prose, so entries are small".
    Only `findingCount` was ever stored, and the row that once decided the
    cutover was structurally always empty. Pinned on the RECORD BUILDER rather
    than on a live run, because the defect is the shape of the dict.
    """
    import inspect

    from reports import pipeline as pipeline_mod

    source = inspect.getsource(pipeline_mod.run_report)
    entry = source[source.index("entry: Dict[str, Any] = {"):]
    entry = entry[:entry.index("\n    }")]
    assert '"findings"' in entry, (
        "a history entry stores only a COUNT again — nothing downstream can "
        "read what a period actually found")
    assert "subject_key" in entry, (
        "the stored findings carry no subject_key, so nothing can join them "
        "to the agent's concerns")
    # ⚠️ AND NOT THE WHOLE FINDING. The ring is bounded at 200 entries; storing
    # detail and baselines is how "entries are small" stops being true.
    assert '"detail"' not in entry, (
        "the stored findings carry prose — the history ring is bounded and "
        "this is what makes it expensive")
