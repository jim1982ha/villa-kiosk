"""The two options that used to be read and then ignored."""
from datetime import timezone

import pytest

from agent import log
from agent.clock import SystemClock


@pytest.fixture(autouse=True)
def restore_level():
    before = log.current_level()
    yield
    log.configure(before)


def test_raising_the_level_actually_silences_output(capsys):
    log.configure("warning")
    log.info("this must not appear")
    log.warning("this must")
    out = capsys.readouterr().out
    assert "must not appear" not in out
    assert "this must" in out


def test_lowering_it_reveals_debug(capsys):
    log.configure("debug")
    log.debug("now visible")
    assert "now visible" in capsys.readouterr().out


def test_the_default_hides_debug_and_shows_info(capsys):
    log.configure("info")
    log.debug("hidden")
    log.info("shown")
    out = capsys.readouterr().out
    assert "hidden" not in out and "shown" in out


def test_an_unknown_level_falls_back_to_info_rather_than_crashing():
    log.configure("shouty")
    assert log.current_level() == "info"


def test_an_empty_timezone_is_utc():
    clock = SystemClock("")
    assert clock.zone_name() == "UTC"
    assert clock.now().utcoffset() == timezone.utc.utcoffset(None)


def test_a_named_timezone_is_actually_used():
    clock = SystemClock("Europe/Paris")
    assert clock.zone_name() == "Europe/Paris"
    assert clock.now().tzinfo is not None
    assert clock.now().utcoffset() != timezone.utc.utcoffset(None)


def test_an_unknown_timezone_says_so_and_falls_back(capsys):
    clock = SystemClock("Mars/Olympus_Mons")
    assert clock.zone_name() == "UTC"
    assert "not one this system knows" in capsys.readouterr().out
