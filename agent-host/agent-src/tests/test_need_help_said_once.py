"""Need help pressed on Telegram or on the tablet's copy of an alert is said once (architecture review 23, card 4): its
answer, "🆘 Need help on … (Luc): Owner is asked to act.", stood under a "- 🆘 Need help on … (Luc)" line of its own
in every chat and on the tablet's card, until someone acted — pressed in the Cockpit it was said once. A button whose
answer says the press (skill.yaml `tells`) keeps no line of it, as a closing button. Synthetic villa; names invented."""
from __future__ import annotations

import re

from types import SimpleNamespace

import pytest

from test_cockpit_languages import FM_DE, FM_FR, GROUP, run, status, villa


async def _toast(_text):
    pass


@pytest.mark.parametrize("chat,anywhere", [(FM_FR, False), (FM_DE, True)])   # a Telegram chat, the tablet's copy
def test_need_help_is_said_once_in_every_chat_and_on_the_tablet(tmp_path, chat, anywhere):
    v, k, _uid = villa(tmp_path)
    person = SimpleNamespace(name="Luc", role="fm", telegram_id=chat)
    run(v.buttons.press(chat, ["1", "need_help"], person, _toast, name="Luc", anywhere=anywhere))
    said = {GROUP: "Need help at", FM_FR: "Besoin d'aide à", FM_DE: "Brauche Hilfe um"}
    for c, words in said.items():
        lines = status(v, c)
        assert sum(words in ln for ln in lines) == 1, (c, lines)
    assert status(v, GROUP)[-1].endswith(": Owner is asked to act. (to: Owner)"), status(v, GROUP)
    card = k.messages["incident:1"]["status"]                       # the tablet's card, in English
    assert sum("Need help at" in ln for ln in card) == 1 and card[-1].endswith("Owner is asked to act."), card
    # once something follows, the press keeps its own line: who asked for help is never lost
    owner = SimpleNamespace(name="JM", role="owner", telegram_id=GROUP)
    run(v.buttons.press(GROUP, ["1", "done"], owner, _toast, name="JM"))
    assert any(ln.startswith("- 🆘 Besoin d'aide à ") and ln.endswith("(Luc)") for ln in status(v, FM_FR)), status(v, FM_FR)
    # where it was pressed, as the fault's line says it (status_story: one wording, the moment apart)
    assert any(re.match(r"- 🆘 Need help (on Telegram|in the VESTA UI) at ", ln) for ln in status(v, GROUP)), status(v, GROUP)
