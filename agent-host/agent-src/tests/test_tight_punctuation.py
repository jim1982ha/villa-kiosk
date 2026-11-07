"""No space before ":" ";" "!" "?" in anything the agent sends, in every language (owner, 2026-10-23: "remove the
redundant space character before the ':', so it should look like 'à: JM' or 'To: JM'… fix it consistently
everywhere"). Synthetic text only."""
from __future__ import annotations


from vesta_shared.messaging import tight_punctuation


def test_a_space_before_high_punctuation_goes_and_nothing_else_moves():
    assert tight_punctuation("(à : FM)") == "(à: FM)"
    assert tight_punctuation("Toujours ouvert :\n- #75") == "Toujours ouvert:\n- #75"
    assert tight_punctuation("Remarque : ok ; fin ! Voulez-vous ?") == "Remarque: ok; fin! Voulez-vous?"
    assert tight_punctuation("a : b, c : d") == "a: b, c: d"
    # a time, a link, code and French quotes stay as written
    for kept in ("à 14:38", "https://x.y/a?b=1", "voir `a : b` ici", "la serrure est « indisponible »"):
        assert tight_punctuation(kept) == kept


