"""The alert cards' translations, one per (sentence pattern, language): which answer is kept, which pattern is asked
again and when, and what is forgotten. translation.Translations masks a card's lines and asks the AI; every decision
about the answer and about asking is taken here, once.

⚠️ AN ECHO IS NOT A TRANSLATION (review, 2026-10-23, owner: "apply the recommended findings"). 0.12.334 kept any
answer that kept its slots: a model that answered the English unchanged had it kept for good — the French chat read
English on every later card, the AI was never asked again, and nothing could clear it. A line with words to translate
is kept only when its answer keeps every slot once (`fits`) AND differs from the English beyond case, spaces and
punctuation (`acceptable`).

⚠️ A FAILURE IS REMEMBERED (same review): a pattern whose run failed — the AI's error, its time limit, an answer that
is not the list asked for, a slot dropped, an echo — was asked again for every card, reminder and redraw: a paid run
per language each time, for the same failure. It now rests `alerts.translate_retry_hours` (that line stays English
meanwhile, said once in the log); a later success clears it.

⚠️ TIED TO THE INSTRUCTIONS (same review): a translation is kept under a `fingerprint` of the skill's translate
instructions and of the engine's slot rules. Changing either starts afresh: the older rows are never read again and
are deleted the first time the new ones are used. The VESTA Agent page can also forget them all, or one language's
(`forget`, Rules › AI brains and limits).

⚠️ AN ANSWER THE READER COULD NOT READ IS THE READER'S TO JUDGE AGAIN (owner, 2026-10-24: a French chat read "Master
Bedroom Aqara is unlocked for 10min" in English beside a translated title; the log said "not the list of lines asked
for"). Such a failure is kept with the version of translation.answer that could not read it (`READER`); a newer reader
asks again at once rather than after the rest, and every reader asks a second time within the run before it gives up.

Stored in State (`phrase:` BOUNDED by alerts.translations_kept; `untranslated:` with the records).
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta
from typing import Callable

from vesta_shared.limits import limit

from .state import utcnow

log = logging.getLogger("vesta.translation")

#: A slot in a skeleton: {1}, {2}… numbered left to right, so one pattern is one skeleton whatever its values.
SLOT = re.compile(r"\{(\d+)\}")
#: translation.answer's reading of an AI answer — raised whenever it reads more (2: a fenced list, words around it, an
#: object, one line asked answered as a line). A failure to read noted under an older one is asked again at once.
READER = 2
#: The failure "the answer could not be read" as 0.12.344–0.12.346 wrote it (no reader noted): an older reader's.
_UNREAD_BEFORE = "not the list of lines asked for"


def wordy(skeleton: str) -> bool:
    """Whether a skeleton has words to translate: one that is only slots, signs and icons ("⚡ {1}") reads the same in
    every language."""
    return bool(re.search(r"[^\W\d_]", SLOT.sub("", skeleton)))


def fits(translated, skeleton: str) -> bool:
    """A translation of `skeleton` keeps every one of its slots exactly once and invents none, on one line."""
    if not isinstance(translated, str) or not translated.strip() or "\n" in translated.strip():
        return False
    want = sorted(SLOT.findall(skeleton), key=int)
    return sorted(SLOT.findall(translated), key=int) == want


def _bare(text: str) -> str:
    """A line's letters and digits only, in one case: "{1} has been {2}." and "{1} Has been {2}" are one line."""
    return re.sub(r"[\W_]+", "", text).casefold()


def refused(translated, skeleton: str) -> str | None:
    """Why the answer for `skeleton` is not kept (None: it is kept): a slot dropped, doubled or invented, or the English
    given back for a line with words to translate."""
    if not fits(translated, skeleton):
        return "a value left out or added"
    if wordy(skeleton) and _bare(translated) == _bare(skeleton):
        return "the English given back"
    return None


def acceptable(translated, skeleton: str) -> bool:
    return refused(translated, skeleton) is None


def fingerprint(instructions: str, rules: str) -> str:
    """What a kept translation was made under: the skill's translate instructions and the engine's slot rules."""
    return hashlib.sha256(f"{instructions}\n\0\n{rules}".encode()).hexdigest()


def retry_hours() -> int:
    return limit("alerts.translate_retry_hours", 24, unit="hours", group="ai", lo=1, hi=720,
                 says="How long a line of an alert card the AI could not translate into a language waits before the "
                      "AI is asked again.",
                 reached="Until then that line stays in English in that language.", told="")


class Phrases:
    """The translations kept and the failures remembered (see the module). `now`: the clock (tests move it)."""

    def __init__(self, state, now: Callable[[], datetime] = utcnow):
        self.state, self.now = state, now
        self._current: str | None = None        # the fingerprint whose older rows were last deleted

    def _use(self, fp: str) -> None:
        """Instructions `fp` are the ones in use: rows of any others are deleted, once per change."""
        if fp != self._current:
            gone = self.state.keep_only_translations_of(fp)
            self._current = fp
            if gone:
                log.info("The alert translation's instructions changed: %d translations kept under the earlier ones "
                         "were dropped, each line is translated again", gone)

    def kept(self, lang: str, skeleton: str, fp: str) -> str | None:
        """The translation of `skeleton` into `lang` kept under instructions `fp`; None when there is none."""
        self._use(fp)
        return self.state.translation(lang, skeleton, fp)

    def resting(self, lang: str, skeleton: str, fp: str) -> bool:
        """Whether `skeleton` failed in `lang` less than retry_hours() ago: not asked, that line stays English."""
        rec = self.state.untranslated(lang, skeleton, fp)
        unread = (rec or {}).get("kind") == "unreadable" or (rec or {}).get("why") == _UNREAD_BEFORE
        if unread and (rec or {}).get("reader") != READER:
            return False                    # read by an older reader: this one may read it, ask again
        try:
            at = datetime.fromisoformat(str((rec or {}).get("at")))
        except ValueError:
            return False
        return self.now() - at < timedelta(hours=retry_hours())

    def to_ask(self, lang: str, skeletons, fp: str) -> list[str]:
        """The skeletons the AI is asked for: neither kept nor resting."""
        return [s for s in skeletons if self.kept(lang, s, fp) is None and not self.resting(lang, s, fp)]

    def take(self, lang: str, fp: str, asked: list[str], answers: dict | None, why: str | None = None,
             unreadable: bool = False) -> dict[str, str]:
        """A run's outcome for `asked`: each acceptable answer kept (and its failure forgotten); every other line
        remembered as failed — `answers` None: the run itself failed, for `why` (`unreadable`: it answered, and the
        reader could not read it). What was kept."""
        got, failed = {}, {}
        for skel in asked:
            tr = (answers or {}).get(skel)
            no = (why or "no answer") if answers is None else refused(tr, skel) if skel in answers else "no answer"
            if no is None:
                got[skel] = tr.strip()
                self.state.keep_translation(lang, skel, got[skel], fp)
                self.state.clear_untranslated(lang, skel, fp)
            else:
                failed[skel] = no
        if failed:
            self.failed(lang, fp, failed, "unreadable" if answers is None and unreadable else "")
        return got

    def failed(self, lang: str, fp: str, failed: dict[str, str], kind: str = "") -> None:
        """Lines that could not be translated into `lang` ({skeleton: why}): not asked again for retry_hours(), said
        once in the log (a line is asked, so said, at most once per rest)."""
        at = self.now().isoformat()
        for skel, why in failed.items():
            self.state.note_untranslated(lang, skel, fp, at, why, kind=kind, reader=READER if kind else None)
        log.info("%d line(s) of an alert card stay in English for %s for %d h, then the AI is asked again: %s",
                 len(failed), lang, retry_hours(), "; ".join(f"{s!r} ({w})" for s, w in failed.items()))

    def forget(self, lang: str | None = None) -> int:
        """Every translation kept and failure remembered, of `lang` or of every language: asked afresh."""
        return self.state.forget_translations(lang)
