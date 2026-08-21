"""How a briefing LOOKS on a phone. One vocabulary, both narrators.

⚠️ EMOJI ARE THE ONLY FORMATTING THAT SURVIVES EVERY DESTINATION. `deliver.py`
sends the intersection of what notify platforms accept — `title` and `message`,
plain text — because markdown renders as literal asterisks somewhere and HTML
renders as literal tags somewhere else. This project has now paid for that twice
over: a platform that parses markup by DEFAULT italicised half a brief, and the
fix was to remove every markup-active character rather than to escape them.

Emoji are not markup. Nothing parses them, nothing escapes them, and every
destination this add-on can reach — the HA companion apps, the notification
panel, a chat bot — draws them. So they are the whole formatting budget, and
they buy the one thing plain text cannot: a line you can find without reading.

⚠️ AND THE VILLA ALREADY SPEAKS THIS WAY. Its own automations title their
alerts `🪫 Low Battery Alert` and `🪫 Battery Maintenance Required` — read from
the deployment, not invented here. A brief that arrives in the same inbox in a
different visual language reads as coming from somewhere else, which for a
document about the property is exactly wrong.

⚠️ `•` RATHER THAN `-` FOR A BULLET, AND THAT IS A CORRECTNESS CHOICE. A
leading `- ` is a list marker in every markdown dialect; `•` is a character. On
a platform that parses, the first turns into a rendered list whose indentation
the sender does not control, and the second is what was sent.

⚠️ NOTHING HERE IS VILLA-SPECIFIC. These are section names for a document whose
sections are fixed by `SECTIONS_FOR`; no room, entity or tariff appears.
"""

from __future__ import annotations

# Re-exported, not defined here: `discovery` needs it too and may not
# import upward into the renderer. See `reports.text`.
from ..text import name_of as name_of

from typing import Dict

#: A bullet that is a character, not a list marker. See the header.
BULLET = "• "

#: How urgent this brief is, at a glance, in the TITLE.
#:
#: ⚠️ THE TITLE IS OFTEN ALL THAT IS READ. A push notification shows the title
#: and about two lines; a chat list shows the title alone. So the one thing a
#: reader needs before opening — is anything actually wrong — belongs there
#: rather than in the third paragraph of the body.
SEVERITY_MARK: Dict[str, str] = {
    "critical": "\U0001F534",   # red circle
    "warning": "\U0001F7E0",    # orange circle
    "notice": "\U0001F535",     # blue circle
    "info": "✅",           # check mark
}

#: One marker per section of the brief, keyed by `SECTIONS_FOR`'s own names so
#: a section cannot gain a heading here and be absent there.
SECTION_MARK: Dict[str, str] = {
    # ⚠️ A BELL, NOT A SECOND WARNING SIGN. This section and `critical` sit
    # next to each other and answer different questions — what is wrong NOW
    # against what went wrong THIS PERIOD — so they must not open with the same
    # glyph. A reader skimming a phone notification distinguishes them by that
    # character before they read either heading.
    "standing": "\U0001F514",      # bell
    "critical": "⚠️",     # warning sign
    "money": "\U0001F4B0",          # money bag
    # ⚠️ THE `fixed` SECTION RENDERS THREE HEADINGS AND THEY HAD ONE GLYPH
    # BETWEEN THEM. "Followed up", "Closed by itself" and "For the facility
    # manager" all came out as 🔧, so two consecutive headings in one section
    # were visually identical and the reader had only the words to separate
    # them — reported as exactly that. A marker whose whole job is to be findable
    # without reading cannot be shared by the things it distinguishes.
    "fixed": "\U0001F527",          # wrench — the tasks somebody has been given
    "verified": "\u2611\ufe0f",         # ballot box with check — confirmed over
    "selfclear": "\U0001F504",     # arrows counterclockwise — resolved on its own
    "preventive": "\U0001F4C5",     # calendar
    "trends": "\U0001F4C8",         # chart increasing
    "health": "\U0001FA7A",         # stethoscope
    # ⚠️ A SUB-HEADING INSIDE `health` STILL NEEDS ITS OWN GLYPH. It first
    # rendered under the stethoscope — the same mark as the section that
    # contains it — because the 2.577.0 rule was read as "one glyph per
    # SECTION" rather than per HEADING. Broken in the release that wrote it.
    "waiting": "\u23f3",           # hourglass — installed, never fired
    "coverage": "\U0001F6AB",       # prohibited
}


#: Characters a notify platform may read as MARKUP. See `inert`.
#:
#: ⚠️ REPLACED, NOT ESCAPED, and not merely dropped either — the replacement is
#: chosen so a real name stays readable. `Timmerflotte_8343` becoming
#: `Timmerflotte 8343` is what a person would have written anyway; becoming
#: `Timmerflotte8343` is a different string.
_MARKUP_ACTIVE = {
    "_": " ",    # Markdown italic. THE ONE THAT BROKE A DELIVERY — see `inert`.
    "*": "",     # Markdown bold/italic.
    "`": "'",    # Markdown code.
    "~": "-",    # MarkdownV2 strikethrough.
    # ⚠️ BACK IN THE LIST (2.578.0) AFTER A ROUND TRIP THROUGH THE PLATFORM.
    # 2.577.0 took them out so the report could quote a rule name as
    # "[roi_baseline_deviation]", reasoning that only `_ * ` and a backtick open
    # an entity in Telegram's legacy Markdown, so a bare bracket would print.
    # It does not: the DELIVERED message came back with every bracket silently
    # gone, while the units and the headings from the same release arrived
    # intact. Telegram's Markdown parser consumes them as link syntax whether or
    # not a `(url)` follows.
    #
    # ⚠️ AND THE TEST THAT "PROVED" IT PASSED, because it exercised `inert` in
    # isolation and nothing exercised the platform. The report quotes with
    # APOSTROPHES now — `style.name_of` — which the preflight line has been
    # delivering intact all along, and which is the owner's own suggestion.
    "[": "(",    # Markdown link syntax; Telegram eats these either way.
    "]": ")",
    "<": "(",    # HTML parse mode.
    ">": ")",
}
#: ⚠️ `#` IS DELIBERATELY ABSENT. It is a Markdown HEADING marker, not an
#: entity delimiter — an unpaired one never produces `Can't parse entities`, it
#: just prints. Adding it would mangle a real name like `Room #2` to fix
#: nothing. `providers._flatten` strips leading `### ` from a model's answer,
#: which is a different job on a different input.


def inert(text: str) -> str:
    """Text that cannot be parsed as markup by anything, in any mode.

    ⚠️ THIS FILE'S OPENING RULE, FINALLY ENFORCED RATHER THAN ASSERTED. The
    header above has said since it was written that emoji are the only
    formatting that survives every destination and that the fix for a
    markup-active character is to REMOVE it. Nothing did. The deterministic
    renderer emits no markup of its own, so the rule held for as long as every
    string it printed came from somewhere already sanitised.

    ⚠️ IT STOPPED HOLDING THE DAY THE BRIEF STARTED PRINTING DEVICE NAMES
    (2.571.0). Standing state puts Home Assistant friendly names into prose, and
    a real one on the reference villa is `Timmerflotte_8343 Temperature`. That
    is a perfectly good name — it has a space, so it is not a raw slug and is
    shown verbatim, correctly — and to a platform with `parse_mode: markdown`
    the underscore opens an italic that never closes:

        telegram.error.BadRequest: Can't parse entities:
        can't find end of the entity starting at byte offset 400

    Home Assistant returns that to the caller as an HTTP 500, so every delivery
    to that target failed and the brief reached nobody. Offset 400 is where the
    new section landed: it leads, so it is the first prose in the message.

    ⚠️ APPLIED ONCE, AT THE BOUNDARY, ON THE WHOLE MESSAGE. Sanitising per call
    site is the version of this that ships broken again the first time a name
    reaches a site nobody thought of. The KINDS of human-supplied string already
    here are device labels, room names, ticket and schedule titles, a delivery
    target's own name inside a preflight notice, and a blueprint's `label` — and
    counting them would be the mistake, not the reassurance: a comment naming
    "six sites" is the `HOLD_MS_HUD` failure waiting for its seventh. The set
    grows with ordinary work; a boundary does not. The renderer emits no
    intentional markup anywhere, so there is nothing for a whole-message pass to
    damage, and after it there is no site left that can forget.
    """
    return "".join(_MARKUP_ACTIVE.get(character, character) for character in text)


def heading(section: str, text: str) -> str:
    """A section heading: marker, then the words, then nothing else.

    ⚠️ NO COLON AND NO UNDERLINE. A colon reads as "a list follows" and the
    line beneath already is one; an underline of dashes is markdown's `setext`
    heading on the platforms that parse. The blank line above a heading is what
    separates sections, and it works everywhere.
    """
    mark = SECTION_MARK.get(section, "")
    return f"{mark} {text}".strip()


def title_mark(severity: str) -> str:
    """The title's leading marker for a report of this severity."""
    return SEVERITY_MARK.get(severity, SEVERITY_MARK["info"])
