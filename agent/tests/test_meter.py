"""The meter is the only number anyone may quote.

⚠️ THIS PROJECT HAS BEEN WRONG BY ~115x ON ARITHMETIC. A cost figure written
into a document read as live for months: $5.00/day against $0.043 measured. The
rule that came out of it is that a cost claim comes from a printed measurement
or it is not made — so this file exists before anything can spend a cent, and
the behaviour it pins hardest is what the meter does when it CANNOT price a
call.
"""
import pytest

from agent.meter import Meter, Usage, price_of


def test_a_known_model_is_priced_from_its_own_rate():
    m = Meter()
    m.record(Usage(model="claude-haiku-4-5", input_tokens=1_000_000,
                   output_tokens=1_000_000))
    # $1.00/MTok in + $5.00/MTok out.
    assert m.spent_usd == pytest.approx(6.00)


def test_cached_reads_are_a_tenth_and_cache_writes_a_quarter_more():
    m = Meter()
    m.record(Usage(model="claude-haiku-4-5", cache_read_tokens=1_000_000))
    assert m.spent_usd == pytest.approx(0.10)
    m2 = Meter()
    m2.record(Usage(model="claude-haiku-4-5", cache_write_tokens=1_000_000))
    assert m2.spent_usd == pytest.approx(1.25)


def test_an_UNKNOWN_model_is_UNPRICED_never_zero():
    """⚠️ THE WHOLE POINT. A model id the table does not know must not read as
    a free call — that is how a bill arrives that nothing predicted."""
    m = Meter()
    reading = m.record(Usage(model="claude-not-a-real-model",
                             input_tokens=500, output_tokens=500))
    assert reading.usd is None
    assert m.unpriced_calls == 1
    assert "UNPRICED" in m.line()
    # And the tokens are still counted — only the money is unknown.
    assert m.input_tokens == 500 and m.output_tokens == 500


def test_nothing_called_reads_zero_and_says_so():
    """The state this ticket ships in: the meter exists, nothing spends."""
    m = Meter()
    assert m.spent_usd == 0.0
    assert m.calls == 0
    assert "calls=0" in m.line() and "usd=0.0000" in m.line()
    assert "UNPRICED" not in m.line()


def test_the_line_carries_every_figure_the_ticket_asks_for():
    m = Meter()
    m.record(Usage(model="claude-haiku-4-5", input_tokens=10,
                   cache_read_tokens=20, cache_write_tokens=5, output_tokens=30))
    line = m.line()
    for part in ("calls=1", "in=10", "cached=20", "cache_write=5", "out=30", "usd="):
        assert part in line, f"{part!r} missing from {line!r}"


def test_the_daily_limit_is_a_question_the_meter_answers():
    m = Meter(daily_usd_limit=1.00)
    assert m.remaining_usd == pytest.approx(1.00)
    assert not m.exhausted
    m.record(Usage(model="claude-haiku-4-5", output_tokens=200_000))  # $1.00
    assert m.remaining_usd == pytest.approx(0.0)
    assert m.exhausted


def test_a_zero_limit_means_no_limit_not_no_spending():
    """0 is the 'off' value for every clamp in this repo; it must not read as
    'you may never spend', which would brick the layer on a default."""
    m = Meter(daily_usd_limit=0.0)
    m.record(Usage(model="claude-haiku-4-5", output_tokens=1_000_000))
    assert not m.exhausted
    assert m.remaining_usd is None


def test_an_unpriced_call_can_never_make_the_layer_look_under_budget():
    """If we cannot price it, we cannot claim there is budget left."""
    m = Meter(daily_usd_limit=1.00)
    m.record(Usage(model="claude-not-a-real-model", output_tokens=10))
    assert m.exhausted, "an unpriceable spend must close the gate, not open it"


def test_the_day_rolls_over():
    m = Meter(daily_usd_limit=1.00, today="2026-09-19")
    m.record(Usage(model="claude-haiku-4-5", output_tokens=200_000))
    assert m.exhausted
    m.roll_to("2026-09-20")
    assert not m.exhausted
    assert m.spent_usd == 0.0
    # The lifetime figures survive the rollover.
    assert m.calls_all_time == 1


def test_price_of_is_explicit_about_not_knowing():
    assert price_of("claude-haiku-4-5") is not None
    assert price_of("gpt-4") is None
    assert price_of("") is None


def test_every_model_call_PRINTS_its_own_figures(capsys):
    """The ticket's words: 'prints input, cached and output tokens plus a
    running cost for EVERY model call'. Running totals cannot answer 'what did
    that one cost', which is the question this project has got wrong by two
    orders of magnitude."""
    m = Meter()
    m.record(Usage(model="claude-haiku-4-5", input_tokens=100,
                   cache_read_tokens=7, cache_write_tokens=3, output_tokens=50))
    line = capsys.readouterr().out
    assert "claude-haiku-4-5" in line
    assert "in=100" in line and "cached=7" in line and "cache_write=3" in line
    assert "out=50" in line and "usd=0." in line


def test_an_unpriced_call_says_UNPRICED_on_its_own_line(capsys):
    m = Meter()
    m.record(Usage(model="claude-not-a-real-model", output_tokens=10))
    assert "usd=UNPRICED" in capsys.readouterr().out


def test_zero_calls_print_zero_lines(capsys):
    Meter()
    assert capsys.readouterr().out == ""
