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
    if "_" not in text and "--" not in text:
        return text
    text = re.sub(r"-{2,}", " — ", text)
    text = re.sub(r"[_\-]+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:1].upper() + text[1:]
