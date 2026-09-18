"""A survey from a PREVIOUS RUN of the add-on is not fresh, however young.

⚠️ THE DEFECT THIS PINS, AND IT WASTED A RELEASE. 2.983.0 taught the capability
survey to publish how the property is metered. The villa upgraded, the stored
survey was a few hours old and therefore "fresh", so the OLD shape kept being
read and the owner kept being told there was no whole-property meter. The code
was right; the cache was stale in a way age could not see; and nothing said so.

⚠️ WHY A PROCESS STAMP AND NOT A `SHAPE` CONSTANT. A version integer somebody
must remember to bump is a discipline, and the release that forgets it
reproduces this exactly — silently, and only on villas with a warm cache. Every
upgrade restarts the container, so the process start catches the real trigger
with nothing to remember.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.adapters import store  # noqa: E402
from vesta.supervise.agent import survey  # noqa: E402


def _stored(tmp_path, at):
    path = str(tmp_path / "survey.json")
    store.write_json(path, {survey.AT_KEY: at, "sentences": ["old shape"]})
    return path


def test_a_survey_from_this_run_stays_fresh(tmp_path):
    now = time.time()
    path = _stored(tmp_path, now - 60)
    assert survey.is_fresh(path, now=now, started=now - 3600) is True


def test_a_survey_from_a_PREVIOUS_run_is_stale_however_young(tmp_path):
    """⚠️ THE WHOLE POINT. One minute old, and useless: it was written by the
    code that shipped before the upgrade."""
    now = time.time()
    path = _stored(tmp_path, now - 60)
    assert survey.is_fresh(path, now=now, started=now - 30) is False


def test_age_still_expires_a_survey_from_this_run(tmp_path):
    """The original rule has not been replaced, only narrowed."""
    now = time.time()
    path = _stored(tmp_path, now - (survey.MAX_AGE_H + 1) * 3600)
    assert survey.is_fresh(path, now=now, started=0) is False


def test_a_villa_never_surveyed_is_not_fresh(tmp_path):
    assert survey.is_fresh(str(tmp_path / "absent.json"), now=time.time(),
                           started=0) is False
