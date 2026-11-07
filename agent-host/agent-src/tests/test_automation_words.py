"""An automation in words (vesta_shared.automation_words): its own name, without a blueprint's prefix, in apostrophes,
the same in every message that names one (architecture review round 11, card 3)."""
from __future__ import annotations

from vesta_shared import automation_words as AW

RID = "automation.example_leak_watch"


def test_the_one_writer():
    assert AW.quoted("Critical --- Pool leak", RID) == "'Pool leak'"
    assert AW.words("Critical --- Pool leak", RID) == "automation 'Pool leak'"
    assert AW.words(None, "script.example_photo") == "script 'Example photo'"
    assert AW.quoted(RID, RID) == "'Example leak watch'"                      # the id given as its name: never shown


