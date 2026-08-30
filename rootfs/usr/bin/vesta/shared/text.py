"""Turning an identifier into something a person can read. One rule, one place.

⚠️ THIS LIVED IN `aggregate.py` UNTIL 2.568.0 AND MOVED FOR A LAYERING REASON,
not a tidying one. `analysis/__init__` states the layering it depends on —
"registry <- gating and execution. Imports base." — and the gate now has to name
a blueprint in prose it writes for the reader. Importing `aggregate` from
`registry` would have reversed an arrow the package docstring promises points
the other way, so the shared rule moved DOWN to where both layers can reach it
rather than one layer reaching up. `aggregate` re-exports it, so its existing
readers are unchanged.
"""

from __future__ import annotations

import re

def name_of(text: str) -> str:
    """A rule, blueprint, automation or file name, quoted so the sentence parses.

    ⚠️ APOSTROPHES, NOT BRACKETS, AND THE PLATFORM DECIDED THAT. Brackets were
    tried in 2.577.0 and arrived stripped: Telegram's Markdown parser consumes
    them as link syntax with or without a following `(url)`, so the delivered
    message read "covered by Roi baseline deviation" — exactly the unquoted
    prose the change was meant to fix — while the units and headings from the
    same release came through fine. An apostrophe is not markup in any dialect
    and the owner quoted the preflight line back to me with its apostrophes
    intact — "the same way you are doing it already for 'iphone 16 fab'" —
    which is the evidence, not the line's age. ⚠️ This docstring claimed that
    line had been delivering one "for months"; it shipped 2026-08-20, the
    day before. A rendering rule is proved by a DELIVERED message (see
    `feedback_report-prose-rules`), and one delivery is enough — reaching for
    duration instead was reaching for a weaker argument that also happened to
    be false.

    ⚠️ ONE FUNCTION, SO THE NEXT SITE GETS IT BY CALLING. The renderer's five
    sites each had their own literal before this existed. ⚠️ This docstring
    carried that FIVE as a present-tense count of the callers, and went stale in
    the release that moved the function here — which added two. A count of call
    sites is a claim that ages every time the function succeeds, so the number
    is gone and `test_inert.test_no_module_quotes_a_name_by_hand` is the pin: it
    scans the shipped source for the SHAPE (an apostrophe-wrapped
    interpolation), so it stays true as callers come and go.
    It lives HERE and not in `narrate/style` for the reason stated at the top
    of this module: `discovery` writes the preflight line quoted above and
    must not import upward into the renderer, so the rule sits at the layer
    both can reach. `narrate.style` re-exports it — every existing caller is
    unchanged.
    """
    return f"'{text}'"


#: The `domain.` an entity id starts with, and nothing else. ⚠️ ANCHORED, AND
#: THE LOOKAHEAD MATTERS: `3.5` and `v2.913` must not lose a "domain", so the
#: prefix has to start with a letter and be followed by one. Matched only on a
#: value with NO SPACE, which `readable_label` has already established is an
#: identifier rather than something a person typed.
_ENTITY_DOMAIN = re.compile(r"^[a-z][a-z0-9_]*\.(?=[a-z])")


def readable_label(value: str) -> str:
    """A name for a reader. An identifier becomes prose; prose is left alone.

    ⚠️ THE FIRST FIX FOR THIS WAS ON THE WRONG PATH AND I SHIPPED IT AS DONE.
    v2.555.0 humanised the FALLBACK in `to_findings` — `g.blueprint or
    g.category`, reached only when a blueprint supplies neither label nor bucket
    — and the very next capture still read "What went wrong: -
    critical_schedule---pool_pump — still unresolved". Because that string is
    not a fallback: it is the `label` the automation actually sent, so the
    renderer read it straight out of the group and never touched the code I had
    changed. One construction site fixed, a different reader shipping the
    defect: /dry-audit's opening sentence, paid for again.

    ⚠️ SO IT IS APPLIED WHERE A NAME IS READ, NOT WHERE ONE IS BUILT, and there
    is ONE of it. Ten call sites across `aggregate`, `narrate.deterministic` and
    `analysis.registry` — the count is not the point and will drift; the point
    is that no reader may humanise a name any other way, because the two spellings
    then differ by which code path a name arrived through. (This docstring said
    "`to_findings` and the renderer's `_name` both call this" and was already
    wrong by eight sites when it moved here — a list of call sites is a claim
    that rots, so this one names the files instead.)

    ⚠️ AND IT MUST NOT TOUCH A HUMAN LABEL. Blanket humanising would turn the
    same property's real "Lights - monitored rooms" into "Lights monitored
    rooms" — damage done in the name of tidiness. Whitespace is the tell: an
    identifier has none, a label written by a person does. So a value with a
    space is returned exactly as it arrived, and only a spaceless
    `snake_case`/`kebab---case` token is rewritten.

    No villa data and no table: punctuation, applied to whatever arrives.
    """
    text = str(value or "").strip()
    if not text or " " in text:
        return text
    # ⚠️ THE DOMAIN IS NOT PART OF A NAME, AND KEEPING IT MANUFACTURED FAKE
    # ENTITY IDS (2026-08-30). Humanising the whole id turned an `input_number`
    # helper into "Input number.<first word> <rest>" — underscores replaced,
    # domain and dot KEPT — so the label contained a real HA domain followed by
    # a lower-case word, which is exactly an entity id to any reader of one.
    # The leak detector matched it, the redaction audit refused the whole tool
    # result, and one live pass discarded FOUR of them (`read_salient` twice,
    # `read_state` and `read_history` once each), leaving that investigation
    # blind to the villa's own ranking. Measured, not guessed: the refusal named
    # the field (`unscorable[N].label`) and printed the text around the match.
    # ⚠️ NO EXAMPLE ID IS WRITTEN HERE ON PURPOSE — the first draft of this
    # comment put two REAL ones into tracked source while explaining why ids
    # must not travel, and the hard-rules gate caught it. Third time.
    #
    # ⚠️ AND IT WAS ALWAYS A BAD LABEL. "Electricity tariff kwh" is what a
    # person calls that helper; the domain is plumbing, and this function's one
    # job is a name for a READER.
    stripped = _ENTITY_DOMAIN.sub("", text, count=1)
    if stripped != text:
        text = stripped
    elif "_" not in text and "--" not in text:
        return text
    text = re.sub(r"-{2,}", " — ", text)
    text = re.sub(r"[_\-]+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:1].upper() + text[1:]
