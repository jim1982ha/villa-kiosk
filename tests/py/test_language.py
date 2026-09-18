"""The language a chat thread is being held in.

⚠️ THE DEFECT, REPORTED FROM THE VILLA 2026-09-18: two answers in French and
then, with nothing having changed, a third in English. 2.975.0 answered it with
an instruction in the prompt, which weakens exactly when it matters — `MAX_TURNS`
trims the OLDEST turns first and those are the ones that established the
language. 2.977.0 pins it on the thread instead.

⚠️ THE FIXTURES BELOW ARE THE REAL CONVERSATION'S SHAPE, including the two-word
turn ("Ben vas-y") that no detector can call. That turn is the whole reason
`sticky` exists, and a test suite that only fed this full sentences would pass
while the mechanism flipped to English on the first short reply.
"""

import os
import sys
from collections import Counter

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import language  # noqa: E402


def test_the_stop_word_sets_are_disjoint():
    """⚠️ ASSERTED, NOT REVIEWED. A word in two sets adds to BOTH scores, so it
    decides nothing while making both look more confident — and the margin rule
    then reads a tie as a refusal for the wrong reason. The first cut of this
    module shared eight words across the Romance sets and the comment claimed
    otherwise; this is that comment made true."""
    counts = Counter(w for words in language._STOP_WORDS.values() for w in words)
    shared = {w: [lang for lang, ws in language._STOP_WORDS.items() if w in ws]
              for w, n in counts.items() if n > 1}
    assert not shared, f"stop words in more than one language: {shared}"


@pytest.mark.parametrize("text,expected", [
    ("Salut Vesta ! Dis-moi, combien de lumieres sont allumes dans la maison ?",
     "French"),
    # ⚠️ AN ENGLISH TECHNICAL WORD IN A FRENCH SENTENCE. Stop words are chosen
    # so vocabulary cannot swing this: "devices" is not one of them.
    ("Mais tu as les devices Shelby qui donne l'info", "French"),
    ("What is the house using right now and how much of that was yesterday?",
     "English"),
    ("Wie viel Strom verbraucht das Haus und wo ist der Fehler?", "German"),
])
def test_a_full_sentence_is_identified(text, expected):
    assert language.detect(text) == expected


@pytest.mark.parametrize("text", [
    "Ben vas-y",          # the real turn this design exists for
    "ok",
    "8.8",
    "",
    "   ",
    "Vesta",
])
def test_a_turn_too_short_to_call_is_refused(text):
    """⚠️ None IS THE CORRECT ANSWER, NOT A FAILURE. Chat turns are short; a
    detector that answered every one of these would flip a French thread to
    whatever it guessed from two words."""
    assert language.detect(text) is None


def test_a_script_it_cannot_name_is_refused_rather_than_guessed():
    """⚠️ A SCRIPT IS NOT A LANGUAGE. Cyrillic is not Russian and Han is not
    Mandarin. Refusing leaves the prompt's own rule in charge, which is what
    every such thread already relied on."""
    assert language.detect("Сколько электроэнергии потребляет дом?") is None
    assert language.detect("この家は今どのくらい電気を使っていますか") is None


def test_a_few_latin_words_do_not_rename_a_non_latin_message():
    """⚠️ THE CASE THAT MAKES THE SCRIPT CHECK LOAD-BEARING, and without it the
    test above proves nothing: those two fixtures contain no Latin stop words,
    so they would be refused by the scorer whether or not the script check
    existed. Caught by mutation — deleting the check left the suite green.

    A person writing Russian who drops an English phrase in is still writing
    Russian, and naming the message English because of three borrowed words is
    the confident-wrong this module refuses.
    """
    mixed = "Сколько электроэнергии потребляет дом и what is the house using"
    assert language.detect(mixed) is None


def test_an_unidentifiable_turn_inherits_the_thread():
    assert language.sticky("French", "Ben vas-y") == "French"
    assert language.sticky("French", "ok") == "French"
    assert language.sticky("", "ok") == ""


def test_a_confident_switch_moves_the_thread():
    """The reader changing language mid-conversation is a real thing to do, and
    following them is not the same defect as drifting on your own."""
    assert language.sticky(
        "French",
        "What is the house using and how are you getting on with that?",
    ) == "English"


def test_the_instruction_says_nothing_when_nothing_is_known():
    """⚠️ EMPTY, NEVER A DEFAULT OF ENGLISH. Injecting one would make every
    thread this module cannot name WORSE than before the mechanism existed."""
    assert language.instruction("") == ""
    assert language.instruction("   ") == ""


def test_the_instruction_names_the_language_and_allows_a_switch():
    line = language.instruction("French")
    assert "French" in line
    # It must not trap the reader: a message in another language still wins.
    assert "another" in line or "unless" in line


def test_a_tie_identifies_nothing():
    """Two languages scoring equally is not a 50/50 guess to be taken — it is
    a message that has not been identified."""
    # One hit each: below _MIN_HITS and with no margin either way.
    assert language.detect("the und") is None


def test_the_module_names_no_entity_of_any_property():
    """The first hard rule, checked in the file itself — this module is pure
    text handling and must never grow a villa-shaped literal."""
    from conftest import code_of
    src = code_of(language)
    for domain in ("sensor" ".", "switch" ".", "light" ".", "binary_sensor" "."):
        assert domain not in src, f"{domain} literal in shipped code"
