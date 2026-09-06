"""Every survey obeys the same clock, and none erases what it knew.

⚠️ THE SKELETON WAS WRITTEN FOUR TIMES AND THE COVERAGE TRACKED THE DUPLICATION
RATHER THAN THE RISK. `refresh_capabilities` and `refresh_layout` had their
stale-check and their empty-refusal pinned; `refresh_measures` had NEITHER — and
it is the one whose failure re-tunes an owner's Ratings, by making every kind
unclassifiable. Its own docstring names that as the risk.

⚠️ AND THE CONSTANT WAS NAMED AFTER ONE OF FOUR. Three surveys read
`CAPABILITY_MAX_AGE_H` — the room layout, the capabilities and the measurement
classes — while `upstream` declared an identical `CATALOGUE_MAX_AGE_H = 24`.
Four surveys, two constants, one number.
"""

import time

import pytest

from vesta.supervise.agent import sources as sources_mod
from vesta.supervise.agent import survey as survey_mod
from vesta.supervise.agent import upstream as upstream_mod


def test_all_four_surveys_share_one_clock():
    assert sources_mod.CAPABILITY_MAX_AGE_H is survey_mod.MAX_AGE_H
    assert upstream_mod.CATALOGUE_MAX_AGE_H is survey_mod.MAX_AGE_H


def test_a_never_surveyed_villa_is_not_fresh(tmp_path):
    """⚠️ OTHERWISE IT SURVEYS NEVER RATHER THAN NEXT PASS."""
    assert not survey_mod.is_fresh(str(tmp_path / "absent.json"))


def test_a_just_written_survey_is_fresh(tmp_path):
    path = str(tmp_path / "s.json")
    now = time.time()
    assert survey_mod.save(path, {"sentences": ["a"]}, now=now)
    assert survey_mod.is_fresh(path, now=now)


def test_a_survey_older_than_the_clock_is_stale(tmp_path):
    path = str(tmp_path / "s.json")
    now = time.time()
    survey_mod.save(path, {"sentences": ["a"]}, now=now - 25 * 3600)
    assert not survey_mod.is_fresh(path, now=now)


def test_the_floor_stops_a_zero_max_age_from_meaning_never_fresh(tmp_path):
    """`max(1, hours)` — a survey asked for 0 hours must not re-survey on every
    pass of a six-hourly clock."""
    path = str(tmp_path / "s.json")
    now = time.time()
    survey_mod.save(path, {"x": 1}, now=now)
    assert survey_mod.is_fresh(path, now=now, max_age_h=0)


def test_a_corrupt_store_is_not_fresh(tmp_path):
    """A file that is not a mapping must re-survey, not crash and not persist."""
    path = tmp_path / "s.json"
    path.write_text("[]", encoding="utf-8")
    assert not survey_mod.is_fresh(str(path))


def test_save_stamps_the_answer_so_the_clock_can_read_it(tmp_path):
    from vesta.adapters import store

    path = str(tmp_path / "s.json")
    survey_mod.save(path, {"measures": {"sensor.x": {"u": "W"}}}, now=1234.0)
    raw = store.read_json(path, {})
    assert raw["at"] == 1234.0
    assert raw["measures"] == {"sensor.x": {"u": "W"}}


def test_a_failed_write_is_not_a_failed_pass(tmp_path, monkeypatch):
    """⚠️ NEVER RAISES. A survey sits on the path every check runs down."""
    from vesta.adapters import store

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(store, "write_json", boom)
    assert survey_mod.save(str(tmp_path / "s.json"), {"x": 1}) is False


# ── The gap the duplication was hiding ─────────────────────────────────────

def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_refresh_measures_respects_the_stale_check(tmp_path, monkeypatch):
    """⚠️ NO TEST HAD EVER ASKED THIS. Its two siblings were pinned; it was not.

    ⚠️ AND MY FIRST VERSION ASSERTED NOTHING. It monkeypatched a `_measure_rows`
    that does not exist, with `raising=False`, so the patch was a no-op and the
    "was it fetched" counter could only ever read 0. Removing the stale check
    from the subject left it green. It now counts a real `HassClient` build,
    which is what the fetch actually does.
    """
    path = str(tmp_path / "m.json")
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", path)
    now = time.time()
    survey_mod.save(path, {"measures": {"sensor.x": {"u": "W"}}}, now=now)

    built = {"n": 0}

    class Counted:
        def __init__(self, *_a, **_k):
            built["n"] += 1

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def command(self, *_a, **_k):
            return []

    monkeypatch.setattr("vesta.adapters.hass.HassClient", Counted)
    assert _run(sources_mod.refresh_measures(object(), now=now)) is False
    assert built["n"] == 0, (
        "a fresh survey still reached out to Home Assistant %d time(s)"
        % built["n"])


def test_a_stale_measures_survey_DOES_refetch(tmp_path, monkeypatch):
    """The other half — without this, the test above passes for a survey that
    never fetches at all."""
    path = str(tmp_path / "m.json")
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", path)
    now = time.time()
    survey_mod.save(path, {"measures": {"sensor.x": {"u": "W"}}}, now=now - 99 * 3600)

    built = {"n": 0}

    class Counted:
        def __init__(self, *_a, **_k):
            built["n"] += 1

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def command(self, *_a, **_k):
            return [{"entity_id": "sensor.y",
                     "attributes": {"unit_of_measurement": "W"}}]

    monkeypatch.setattr("vesta.adapters.hass.HassClient", Counted)
    _run(sources_mod.refresh_measures(object(), now=now))
    assert built["n"] == 1, "a stale survey did not re-fetch"


def test_refresh_measures_keeps_the_old_answer_when_the_villa_is_unreachable(
        tmp_path, monkeypatch):
    """⚠️ AN EMPTY ANSWER IS NOT A SURVEY, and this is the survey whose loss
    makes every kind unclassifiable — which silently re-tunes the owner's
    Ratings rather than failing."""
    from vesta.adapters import store

    path = str(tmp_path / "m.json")
    monkeypatch.setattr(sources_mod, "MEASURES_FILE", path)
    now = time.time()
    survey_mod.save(path, {"measures": {"sensor.x": {"u": "W"}}}, now=now - 99 * 3600)

    class Dead:
        async def __aenter__(self):
            raise OSError("unreachable")

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Dead())
    _run(sources_mod.refresh_measures(object(), now=now))
    kept = store.read_json(path, {})
    assert kept.get("measures") == {"sensor.x": {"u": "W"}}, (
        "an unreachable villa erased the measurement classes it already had")


# ── One statistics answer per pass ─────────────────────────────────────────

def test_the_same_window_is_fetched_ONCE_per_pass(monkeypatch):
    """⚠️ FOUR MODULES ASK, AND TWO ASK IDENTICALLY. `level_anomaly` and
    `level_shortfall` are two directions of one weekday-baseline question and
    call `context.stats(ids, 56)` with byte-identical arguments, against a
    fetcher that had no cache — so the recorder answered the same 56-day hourly
    query twice per Brief and the daily bucketing ran twice over identical rows.
    """
    import asyncio
    from datetime import datetime

    from vesta.adapters import stats as stats_mod

    calls = {"n": 0}

    async def fake(hass, ids, start, period=None, types=None):
        calls["n"] += 1
        return {i: [{"start": "x", "change": 1.0}] for i in ids}

    class Hass:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr(stats_mod, "statistics_during_period", fake)
    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Hass())

    tally: dict = {}
    fetch = stats_mod.statistics_fetcher(None, datetime(2026, 9, 6), tally)
    ids = ["sensor.one", "sensor.two"]
    asyncio.run(fetch(ids, 56))
    asyncio.run(fetch(ids, 56))
    assert calls["n"] == 1, (
        "the same window was fetched %d times in one pass" % calls["n"])
    assert tally.get("cache_hits") == 1


def test_a_DIFFERENT_window_is_still_fetched(monkeypatch):
    """The cache must not answer a question nobody asked."""
    import asyncio
    from datetime import datetime

    from vesta.adapters import stats as stats_mod

    calls = {"n": 0}

    async def fake(hass, ids, start, period=None, types=None):
        calls["n"] += 1
        return {i: [] for i in ids}

    class Hass:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr(stats_mod, "statistics_during_period", fake)
    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Hass())

    fetch = stats_mod.statistics_fetcher(None, datetime(2026, 9, 6), {})
    asyncio.run(fetch(["sensor.one"], 56))
    asyncio.run(fetch(["sensor.one"], 14))
    asyncio.run(fetch(["sensor.two"], 56))
    assert calls["n"] == 3, calls


def test_the_cache_dies_with_the_pass(monkeypatch):
    """⚠️ PER FETCHER, NOT MODULE-LEVEL — the defect `rejected` had. A fetcher is
    built once per pass, so a later Brief must not be served this one's window."""
    import asyncio
    from datetime import datetime

    from vesta.adapters import stats as stats_mod

    calls = {"n": 0}

    async def fake(hass, ids, start, period=None, types=None):
        calls["n"] += 1
        return {i: [] for i in ids}

    class Hass:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr(stats_mod, "statistics_during_period", fake)
    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Hass())

    for _ in range(2):
        fetch = stats_mod.statistics_fetcher(None, datetime(2026, 9, 6), {})
        asyncio.run(fetch(["sensor.one"], 56))
    assert calls["n"] == 2, "a new pass reused the previous pass's answer"


def test_both_weekday_modules_degrade_the_same_way_on_a_bad_index():
    """⚠️ ONE RULE, TWO MODULES, AND THE DEGRADATION HAD DRIFTED.
    `level_shortfall` guarded the index; `level_anomaly` did not."""
    from vesta.shared.analysis.modules import level_anomaly, level_shortfall

    assert level_anomaly._weekday_name(0) == level_shortfall.WEEKDAY_NAME[0]
    assert level_anomaly._weekday_name(99) == "that day"
    assert level_anomaly._weekday_name(-1) == "that day"


def test_an_outage_is_NOT_cached_as_an_empty_answer(monkeypatch):
    """⚠️ A FAILURE IS NOT AN ANSWER.

    Three of the four modules ask `context.stats` with byte-identical arguments
    — that is the cache's whole justification — so caching `{}` on
    `HassUnavailable` fanned ONE outage out to the other two as a successful
    empty result. They took the early-return path, reported nothing, and
    counted a cache hit. Before the cache each would have opened its own client
    and could have succeeded on a transient failure.

    Same confusion `total_change` returns `None` for rather than `0.0`: "this
    meter recorded no consumption" and "this meter reported nothing at all" are
    different findings.
    """
    import asyncio
    from datetime import datetime

    from vesta.adapters import stats as stats_mod
    from vesta.adapters.hass import HassUnavailable

    calls = {"n": 0}

    async def flaky(hass, ids, start, period=None, types=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise HassUnavailable("core restarting")
        return {i: [{"start": "x", "change": 1.0}] for i in ids}

    class Hass:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr(stats_mod, "statistics_during_period", flaky)
    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Hass())

    tally: dict = {}
    fetch = stats_mod.statistics_fetcher(None, datetime(2026, 9, 6), tally)
    first = asyncio.run(fetch(["sensor.one"], 56))
    assert first == {}, "an outage yields nothing"

    second = asyncio.run(fetch(["sensor.one"], 56))
    assert second, (
        "the second module inherited the first's outage from the cache — it "
        "must be free to try again")
    assert calls["n"] == 2, "the retry never reached Home Assistant"
    assert "cache_hits" not in tally, "an outage was counted as a cache hit"


def test_a_SUCCESS_is_still_cached_after_an_outage(monkeypatch):
    """The other half: recovering must not disable the cache for the pass."""
    import asyncio
    from datetime import datetime

    from vesta.adapters import stats as stats_mod
    from vesta.adapters.hass import HassUnavailable

    calls = {"n": 0}

    async def flaky(hass, ids, start, period=None, types=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise HassUnavailable("core restarting")
        return {i: [] for i in ids}

    class Hass:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

    monkeypatch.setattr(stats_mod, "statistics_during_period", flaky)
    monkeypatch.setattr("vesta.adapters.hass.HassClient", lambda *_a, **_k: Hass())

    fetch = stats_mod.statistics_fetcher(None, datetime(2026, 9, 6), {})
    asyncio.run(fetch(["sensor.one"], 56))     # fails
    asyncio.run(fetch(["sensor.one"], 56))     # succeeds, caches
    asyncio.run(fetch(["sensor.one"], 56))     # served from cache
    assert calls["n"] == 2, calls
