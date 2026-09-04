"""Turning an identifier into something a person can read. One rule, one place.

⚠️ THIS LIVED IN `aggregate.py` UNTIL 2.568.0 AND MOVED FOR A LAYERING REASON,
not a tidying one. `analysis/__init__` states the layering it depends on —
"registry <- gating and execution. Imports base." — and the gate now has to name
a blueprint in prose it writes for the reader. Importing `aggregate` from
`registry` would have reversed an arrow the package docstring promises points
the other way, so the shared rule moved DOWN to where both layers can reach it
rather than one layer reaching up. `aggregate` re-exported it at the time, so
its readers were unchanged by the move; that module has since been deleted
(TASK-115) and everything imports this directly.
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
    is ONE of it. The point is that no reader may humanise a name any other way,
    because the two spellings then differ by which code path a name arrived
    through. The readers are whatever imports this — `grep -rn readable_label`
    is the enumeration, and it is always right.

    ⚠️ THIS PARAGRAPH HAS NOW ROTTED TWICE, EACH TIME IN THE FORM THAT WAS
    ADOPTED TO STOP IT ROTTING (/dry-audit, 2026-09-01). First it said
    "`to_findings` and the renderer's `_name` both call this" and was wrong by
    eight sites when it moved here; so it was rewritten to name FILES instead,
    on the reasoning that a list of call sites is a claim that rots. Then every
    file it named stopped resolving: `aggregate` was deleted with the
    blueprint-event machinery (2.797.0), `narrate.deterministic` went with the
    renderer, and `analysis.registry` was RENAMED by TASK-115 into
    `brief/registry.py` — which still imports this, so that entry was not even
    wrong, merely unfindable.

    ⚠️ THE RENAME IS THE INTERESTING HALF. Deletion at least makes a list
    obviously stale; a rename leaves it looking plausible while pointing at
    nothing, and a reader greps the old name, finds none, and concludes the
    helper has no readers. A file list is a census with different nouns and it
    rots by MOVE as well as by delete. Name the RULE and the way to enumerate
    it; never the members.

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


#: Below this, say so in words rather than "for 0 minutes".
UNDER_A_MINUTE_MS = 60_000.0
#: Above this many hours, days read better than hours.
DAYS_FROM_HOURS = 48


def for_phrase(elapsed_ms: float) -> str:
    """"for 7 days" / "for 3 hours" / "for 12 minutes" — how long it has been so.

    ⚠️ THIS EXISTS BECAUSE THE SECTION STATED A FACT WITH NO DURATION, AND A
    TELEVISION IS WHAT FOUND IT (owner's brief, 2026-08-30). An LG webOS set
    drops its network connection when it is switched off, so it reports
    `unavailable` about twelve seconds later — and rendered as the bare word, a
    TV somebody turned off at bedtime was indistinguishable from two Zigbee
    sensors that had been dead for a week. All four sat under "needs attention
    right now" and only three of them did.
    ⚠️ THE FIX IS INFORMATION, NOT SUPPRESSION. Nothing is hidden and no grace
    window is applied: deciding a device is "not down enough to mention" is a
    judgement this tier should not make silently, whereas "down for 2 minutes"
    lets the reader make it in one glance. The owner chose this over a settling
    window, and the alternative is recorded here so it is not re-litigated.

    ⚠️ MOVED HERE FROM `brief/standing.py` ON 2026-09-04 FOR A LAYERING REASON.
    `observe/salience.score_duration` says how long a lock has been unlocked,
    and `supervise` may not import `brief`, so the one phrase both tiers print
    had to sit at the layer both can reach — the same move `name_of` above
    records. A second copy in salience would be the first place "for 90
    minutes" and "for 1 hour 30 minutes" could disagree across the kiosk and
    the brief, which is the consistency rule this whole subsystem is built on.
    """
    if elapsed_ms < UNDER_A_MINUTE_MS:
        return "for under a minute"
    minutes = int(elapsed_ms // 60_000)
    if minutes < 60:
        return f"for {minutes} minute{'' if minutes == 1 else 's'}"
    hours = minutes // 60
    if hours < DAYS_FROM_HOURS:
        return f"for {hours} hour{'' if hours == 1 else 's'}"
    # ⚠️ ALWAYS PLURAL, AND THAT IS FORCED BY THE CUTOVER ABOVE, NOT AN
    # OVERSIGHT. We only reach here at `DAYS_FROM_HOURS` (48) hours or more, so
    # `days` is never below 2 and a singular branch here could never run.
    # Mutation testing found the version that had one: deleting the singular
    # left every test green, which is the signature of an unreachable branch.
    # This repo's rule is that an unreachable case is worse than an absent one —
    # it reads as "handled" to the next person. If the cutover ever drops below
    # 48 hours, the singular comes back WITH a test that reaches it.
    days = hours // 24
    return f"for {days} days"
