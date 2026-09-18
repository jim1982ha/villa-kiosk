"""Which language a chat turn is in, well enough to hold one for a thread.

⚠️ WHAT THIS IS FOR, AND WHAT IT IS NOT. Reported from the villa 2026-09-18: two
replies in French and then, with nothing having changed, a third in English.
2.975.0 answered that with an INSTRUCTION in the chat prompt, which is a hope
rather than a mechanism — and a hope that weakens exactly when it is most
needed, because `MAX_TURNS` trims the oldest turns first and those are the ones
establishing the language. This pins the answer on the thread instead, so it
survives the trim.

⚠️ STICKY, AND THAT IS THE WHOLE DESIGN. Chat messages are short — "Ben vas-y"
is a real turn from that conversation and no detector on earth can call it from
two words. So a turn that cannot be identified INHERITS the thread's language
rather than resetting it, and only a confidently-different turn switches it. A
detector that answered on every message would flip the thread to English on the
first bare "ok".

⚠️ STOP WORDS, NOT A LIBRARY. The add-on must work on a villa with no internet
and ships no model for this; a dependency would be both. Stop words are the
crude end of language identification and are chosen deliberately: they are the
words a person cannot avoid using, they are not technical vocabulary (a French
sentence about "devices" stays French), and being crude they are honest —
`detect` says None far more readily than it guesses.

⚠️ AND IT NAMES ONLY WHAT IT KNOWS. A script this cannot identify returns None,
the caller falls back to "the language the question was asked in", and the model
does what it did before. The mechanism only ever ADDS certainty; it never
replaces a correct guess with a wrong assertion.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Optional, Tuple

#: Words a speaker of each language cannot write a sentence without. Kept short
#: on purpose: every addition is a chance to collide with another language's
#: vocabulary, and the goal here is a confident NO rather than a broad yes.
#:
#: ⚠️ NO WORD MAY APPEAR IN TWO SETS. A shared word contributes to both scores
#: and so decides nothing, while making both look more confident than they are.
#: `test_language` asserts the sets are disjoint rather than trusting review.
_STOP_WORDS: Dict[str, Tuple[str, ...]] = {
    "English": ("the", "and", "are", "what", "how", "you", "for", "of",
                "with", "there", "this", "that", "have", "does", "were"),
    "French": ("le", "la", "les", "des", "une", "est", "sont", "dans",
               "pour", "avec", "qui", "pas", "tu", "je", "elle",
               "nous", "vous", "combien", "quel", "quelle"),
    "Spanish": ("el", "los", "las", "una", "es", "son", "por", "pero",
                "muy", "también", "cuánto", "cómo", "dónde", "usted"),
    "German": ("der", "die", "das", "und", "ist", "sind", "nicht", "für",
               "mit", "wie", "wo", "ich", "sie", "wir", "auch"),
    "Italian": ("lo", "gli", "un", "è", "sono", "per", "che",
                "non", "come", "dove", "io", "noi", "voi"),
    "Portuguese": ("os", "as", "um", "uma", "é", "são", "com",
                   "não", "onde", "isso", "mas", "você"),
    "Dutch": ("de", "het", "een", "en", "zijn", "niet", "voor",
              "met", "hoe", "wat", "waar", "ik", "wij", "jij", "ook"),
    # ⚠️ ADDED 2026-09-18, AFTER A REAL QUESTION WENT UNRECOGNISED. Note the
    # absence of "di": it is a heavily used Italian preposition as well, and a
    # word that can swing two languages is exactly what the disjointness rule
    # above exists to keep out.
    "Indonesian": ("yang", "dan", "ini", "itu", "untuk", "dengan", "tidak",
                   "adalah", "saya", "anda", "apakah", "bagaimana", "berapa",
                   "sekarang", "bisakah", "atau", "sudah"),
}

#: Minimum hits before this will name a language at all. Two is the smallest
#: number that cannot be one coincidental loan word.
_MIN_HITS = 2

#: How far ahead the winner must be. A message scoring 2 for one language and
#: 2 for another has identified nothing, and saying so is the point.
_MARGIN = 2

#: Words above which a message is long enough to be judged at all.
#:
#: ⚠️ THE DISTINCTION THIS CONSTANT DRAWS IS THE ONE 2.977.0 GOT WRONG, AND IT
#: MADE THAT RELEASE WORSE THAN NO MECHANISM AT ALL. "Cannot identify" is two
#: different answers wearing one None: a two-word turn nobody could call, and a
#: twenty-word sentence in a language these sets do not cover. The first must
#: INHERIT the thread. The second must CLEAR it — it is plainly a language, and
#: carrying the previous one forward tells the model to answer a question in a
#: language the asker did not use.
#:
#: Reported from the villa the same day: a 20-word Indonesian question arrived
#: on an English thread, was not identified, inherited "English", and the model
#: was then explicitly INSTRUCTED to answer in English. Before the mechanism
#: existed it would have read the message and replied in Indonesian.
_ENOUGH_TO_JUDGE = 6

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def _words(text: str) -> List[str]:
    return [w.lower() for w in _WORD.findall(str(text or ""))]


def _script_of(text: str) -> str:
    """The dominant writing system, as a coarse bucket.

    ⚠️ USED ONLY TO REFUSE, NEVER TO NAME. Cyrillic does not mean Russian and
    Han does not mean Mandarin; naming a language from a script is the kind of
    confident-wrong this module exists to avoid. What it IS good for is knowing
    that the Latin stop-word sets below cannot possibly apply, so the answer is
    None rather than a spurious English.
    """
    counts: Dict[str, int] = {}
    for ch in str(text or ""):
        if not ch.isalpha():
            continue
        try:
            name = unicodedata.name(ch)
        except ValueError:
            continue
        bucket = name.split(" ")[0]
        counts[bucket] = counts.get(bucket, 0) + 1
    if not counts:
        return ""
    return max(counts, key=lambda k: counts[k])


def detect(text: str) -> Optional[str]:
    """The language of one message, or None when it cannot be said.

    None is the common and correct answer for short turns; the caller is
    expected to keep whatever the thread already had.
    """
    words = _words(text)
    if not words:
        return None
    if _script_of(text) not in ("LATIN", ""):
        return None

    scores: Dict[str, int] = {}
    for lang, stops in _STOP_WORDS.items():
        hit = sum(1 for w in words if w in stops)
        if hit:
            scores[lang] = hit
    if not scores:
        return None

    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    best, best_hits = ranked[0]
    if best_hits < _MIN_HITS:
        return None
    runner_up = ranked[1][1] if len(ranked) > 1 else 0
    if best_hits - runner_up < _MARGIN:
        return None
    return best


def sticky(previous: str, text: str) -> str:
    """The thread's language after this turn.

    Three outcomes, and conflating the last two is the defect `_ENOUGH_TO_JUDGE`
    describes:

    * identified        → that language
    * too short to tell → whatever the thread already had
    * long, unmatched   → NOTHING, because it is a language and not one of ours

    ⚠️ CLEARING IS THE SAFE ANSWER, NOT A GIVING-UP. An empty language produces
    an empty instruction, the prompt's own "answer in the language of the
    question" rule stays in charge, and the model reads the message in front of
    it — which is exactly what it did correctly before any of this existed. The
    mechanism must never be able to assert a language the asker did not use.
    """
    found = detect(text)
    if found:
        return found
    if len(_words(text)) >= _ENOUGH_TO_JUDGE:
        return ""
    return str(previous or "")


def instruction(language: str) -> str:
    """The line handed to the model, or "" when nothing is known.

    ⚠️ EMPTY MEANS SAY NOTHING, NOT "SAY ENGLISH". With no identification the
    prompt's own rule — answer in the language of the question — is already
    correct and is what the model followed for every language this module
    cannot name. Injecting a default here would make those cases WORSE.
    """
    name = str(language or "").strip()
    if not name:
        return ""
    return (f"Answer in {name}. This conversation has been in {name} and the "
            f"reader expects it to stay in {name}, even if earlier turns have "
            f"scrolled out of view — unless this message is itself in another "
            f"language, in which case follow it.")
