"""The Brief's title is as loud as its body.

⚠️ THE TITLE IS OFTEN ALL THAT IS READ — `style.py` says so: a push notification
shows the title and about two lines. The mark was computed from `preflight +
findings`, module output only, while `compose.brief` puts CONCERNS and STANDING
STATE at the TOP of the body. So a Brief opening "N thing(s) need attention
right now" over a list of unavailable devices was titled ✅.

⚠️ AND IT SHIPPED ONCE ALREADY. `pipeline.py` records it: "A live QA run
recorded `findings=0 severity=notice` for a brief that opened '1 critical alert
from this period is still unresolved'." That fix widened the walk to the
blueprint layer; the layer was retired, the walk narrowed back, and the concerns
and standing that replaced it were never added.

Nothing in `tests/py` called `severity_line` on a briefing path before this.
"""

from vesta.brief import pipeline as pipeline_mod
from vesta.brief import standing as standing_mod


def test_a_quiet_villa_is_quiet():
    assert pipeline_mod.brief_severity([], [], [], []) == "info"


def test_a_critical_FINDING_is_heard():
    assert pipeline_mod.brief_severity(
        [], [{"severity": "critical"}], [], []) == "critical"


def test_a_critical_CONCERN_is_heard():
    """⚠️ THE CASE THAT WAS SILENT. A concern is drawn at the top of the body
    and contributed nothing to the mark above it."""
    assert pipeline_mod.brief_severity(
        [], [], [{"severity": "critical"}], []) == "critical"


def test_STANDING_STATE_is_heard():
    """Four unavailable devices must not be titled ✅."""
    got = pipeline_mod.brief_severity(
        [], [], [], [{"kind": "unavailable"}, {"kind": "unavailable"}])
    assert got == standing_mod.severity_of("unavailable") != "info", got


def test_the_LOUDEST_wins_wherever_it_came_from():
    assert pipeline_mod.brief_severity(
        [{"severity": "info"}], [{"severity": "notice"}],
        [{"severity": "critical"}], [{"kind": "stale"}]) == "critical"


def test_standing_goes_through_the_ONE_kind_table():
    """⚠️ `severity_of` IS THE mapping, and had no production caller until now.
    Its own comment: "a second opinion computed at the call site is how the
    tablet and the notification came to be able to disagree at all.\""""
    for kind, severity in standing_mod.SEVERITY_OF_KIND.items():
        got = pipeline_mod.brief_severity([], [], [], [{"kind": kind}])
        assert got == severity, (kind, got, severity)


def test_an_unknown_kind_falls_back_rather_than_vanishing():
    got = pipeline_mod.brief_severity([], [], [], [{"kind": "a-kind-nobody-added"}])
    assert got == standing_mod.DEFAULT_KIND_SEVERITY


def test_junk_rows_are_skipped_not_crashed_on():
    assert pipeline_mod.brief_severity(
        ["not a mapping"], [None], ["nope"], [42]) == "info"


def test_the_title_and_the_history_row_use_ONE_answer():
    """Pins the direction: the mark and the recorded severity cannot diverge,
    because there is one function and one call."""
    import inspect

    from conftest import strip_prose

    code = strip_prose(inspect.getsource(pipeline_mod.run_report))
    assert code.count("brief_severity(") == 1, (
        "the loudness is computed more than once, so the title and the history "
        "row can disagree")
    assert 'severity_line(severity, f"{cadence} report"' in code
