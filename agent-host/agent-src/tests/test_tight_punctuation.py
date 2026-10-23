"""No space before ":" ";" "!" "?" in anything the agent sends, in every language (owner, 2026-10-23: "remove the
redundant space character before the ':', so it should look like 'à: JM' or 'To: JM'… fix it consistently
everywhere"). Synthetic text only."""
from __future__ import annotations

import asyncio

from telegram_fake import FakeTelegram
from vesta_agent.telegram import layout
from vesta_shared import status_words
from vesta_shared.messaging import no_platform_name_in, tight_punctuation


def test_a_space_before_high_punctuation_goes_and_nothing_else_moves():
    assert tight_punctuation("(à : FM)") == "(à: FM)"
    assert tight_punctuation("Toujours ouvert :\n- #75") == "Toujours ouvert:\n- #75"
    assert tight_punctuation("Remarque : ok ; fin ! Voulez-vous ?") == "Remarque: ok; fin! Voulez-vous?"
    assert tight_punctuation("a : b, c : d") == "a: b, c: d"
    # a time, a link, code and French quotes stay as written
    for kept in ("à 14:38", "https://x.y/a?b=1", "voir `a : b` ici", "la serrure est « indisponible »"):
        assert tight_punctuation(kept) == kept


def test_every_message_and_every_edit_reaching_telegram_is_tight():
    assert [p.text for p in layout("Statut :\n- Rappel envoyé (à : FM)")] == ["Statut:\n- Rappel envoyé (à: FM)"]
    tg = FakeTelegram()
    asyncio.run(tg.edit(1, 2, "Résolu le 23/10/2026 14:56 : elle n'est plus signalée."))
    assert tg.edits[-1][2] == "Résolu le 23/10/2026 14:56: elle n'est plus signalée."


def test_the_french_status_words_and_a_pages_notes_are_written_tight():
    assert status_words.to_tail("FM", "fr") == " (à: FM)"
    assert status_words.closing("elle n'est plus signalée", "fr").startswith("Résolu le {time}: ")
    # the tables themselves, every language: what a Kiosk note or a stored line keeps reads the same
    for lang, words in status_words.WORDS.items():
        assert tight_punctuation(repr(words)) == repr(words), lang
    assert no_platform_name_in({"lead": "En bref : la pompe faiblit."}) == {"lead": "En bref: la pompe faiblit."}
