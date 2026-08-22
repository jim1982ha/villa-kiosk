"""The built-in renderer. Offline, dependency-free, always available.

⚠️ THIS IS THE PRODUCT, not a fallback that happens to exist. Everything an
LLM adds in Phase 6 is on top of what this writes; if this reads badly, no
provider rescues it, because the provider is handed the same facts.

Three rules it follows, all of which exist to keep the report trustworthy
rather than merely full:

  SAY WHAT COULD NOT BE SEEN. A section quietly omitted reads as "there was
  nothing to report", which is a claim nobody checked. A thin deployment should
  get a SHORT report that says what it cannot measure — not a complete-looking
  one built from silence.

  NEVER STATE A NUMBER NOBODY MEASURED. A meter that reported nothing is not a
  meter that consumed nothing. There is no "0 kWh" here for an absent reading,
  and no currency total assembled out of findings that carried no cost.

  PLAIN TEXT, NO MARKUP. `deliver.py` sends the intersection of what notify
  platforms accept. Asterisks would render literally on the ones that do not
  parse them, and the moment this file knows which platform it is writing for,
  delivery has a platform table in it.

⚠️ NOTHING VILLA-SPECIFIC. Every name, count and id in the output comes from
the context it was handed. There is no example device, no seeded threshold and
no sample sentence with a room in it.

⚠️ EIGHT SECTIONS, SEVEN OF THEM THE WORKBOOK'S — AND THE COUNT IS A
COINCIDENCE THAT HID THE DRIFT FOR A RELEASE. This line read "the eight sections
are the workbook's". The workbook's eight were headline, critical recap, money,
fixed and suggested, preventive, trends, monitoring health, coverage. 2.571.0
added `standing` (the only present-tense section, and the owner's request, not
the workbook's) while `headline` is not a gateable section at all — it renders
unconditionally above them. So membership changed twice and the total did not
move, which is precisely why nobody noticed. `ALL_SECTIONS` is the list and
`test_sections` pins it against the builders — AND pins that `standing` leads,
which this comment called load-bearing while nothing checked it. This sentence
is not the list.
A SECTION IS SKIPPED ONLY WHEN IT
HAS NOTHING TO SAY *AND* NOTHING TO ADMIT. Those are different conditions: a
Money section with no priced findings is omitted, but a Money section on a
property with no tariff configured is REPLACED BY THE ADMISSION, because its
silence would otherwise read as "nothing was wasted".

⚠️ THE CURRENCY IS ASKED FOR, NEVER GUESSED, AND FOR A LONG TIME IT WAS
NEITHER. `cost_local` is in the operator's own currency, chosen per blueprint
instance, and every amount printed bare — on the reasoning that guessing a
symbol from a locale the add-on cannot see is how a report claims dollars about
a figure computed in rupiah. That is right about guessing and it stopped one
question short: Home Assistant carries the operator's own `currency` setting,
`discovery` was already calling the command that returns it, and it was thrown
away beside the version and the timezone. So a delivered brief opened
"Avoidable cost identified: 2,146" and the owner asked what 2,146 stood for.
An ISO code is now appended where Home Assistant has one; an unset currency
still prints bare, which is the old behaviour and the only honest fallback.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Sequence, Tuple

from ..analysis.registry import BLUEPRINT_GRACE_DAYS
# ⚠️ ALIASED. This file ALREADY has a `PERIOD_WORD` ({'daily': 'Daily'}) for
# the title, and importing schedule's under the same name shadowed it: every
# scoped heading rendered "What went wrong Weekly". The tests could not see
# it — they derive the heading from `section_heading`, so they agreed with
# the wrong expression. Reading the output caught it, again.
from ..schedule import PERIOD_SCOPE_WORD, WINDOW_PHRASE, period_span
from ..standing import severity_of as standing_severity
from ..devices import prettify_entity_slug
from .. import links as links_mod
from .. import trend as trend_mod
from ..text import readable_label
from .style import BULLET, heading, name_of, title_mark
from ..contracts import ZONE, severity_rank
from .base import ReportContext

#: Human wording for a cadence, in the possessive form the title uses.
PERIOD_WORD = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}

#: How an audience is addressed. Owner gets the property; facility gets the
#: work. Both read the same facts.
AUDIENCE_WORD = {"owner": "property brief", "facility": "facility brief"}

#: How many lines a list section prints before it summarises the tail. A report
#: read on a phone that opens with forty bullet points is one nobody finishes,
#: and the ranked sections put the ones that matter first.
MAX_LINES = 8

#: The four standing kinds, in the order the Cockpit paints them and with the
#: word each is summarised by when a group is truncated.
#: ⚠️ DERIVED FROM NOTHING — it is a presentation order, and the KINDS
#: themselves come from `standing.py`, which is pinned against the kiosk. A kind
#: added there and missing here would be built, counted toward the title's
#: severity, and then print no lines at all — so `test_standing.py` derives the
#: emitted kinds from that module and asserts each one has a heading.
#: ⚠️ THE LABELS NAME THE THINGS, BECAUSE THEY ARE NOW SUB-HEADINGS. They used
#: to be invisible — the section printed a flat list and used these only for a
#: truncation note — so "Devices not reporting" was fine as a description. As a
#: heading over its own bullets it has to name what the bullets ARE, so the
#: state word on each line stops being needed. "Open tickets" (not "Open
#: faults") because that is what the Facility Manager tab calls them and the
#: owner's own example asked for tickets.
KIND_HEADINGS: Tuple[Tuple[str, str], ...] = (
    ("unavailable", "Unavailable devices"),
    ("alarm", "Alarms"),
    ("fault", "Open tickets"),
    ("schedule", "Overdue maintenance"),
)

#: ⚠️ WHICH SECTIONS EACH AUDIENCE READS — AND THE SPLIT IS DELIBERATELY TINY.
#: The first cut also withheld `preventive` from the owner, on the reasoning
#: that a maintenance worklist is the facility manager's job. That reasoning was
#: fine and the consequence was not: `SECTION_FOR_KIND` routes FORECAST findings
#: to `preventive`, so a projection about failing equipment was computed, gated,
#: counted — and then rendered for one reader and silently dropped for the
#: other. A finding must never vanish because of WHO IS READING.
#:
#: So only `money` is withheld, from the audience that does not act on a cost
#: ranking, and every section any kind routes to is in BOTH lists. Pinned.
#:
#: ⚠️ `standing` LEADS, AND IT IS THE ONLY SECTION IN THE PRESENT TENSE. Every
#: other section reports the PERIOD; this one reports the moment of composing,
#: and it is exactly what the kiosk's Cockpit is showing at the same instant.
#: It leads because it is the actionable half — and because a reader comparing
#: the notification against the tablet in their other hand should meet the
#: matching list first, not three sections down.
#: Sections whose heading names the reporting PERIOD, and therefore may carry
#: "today" / "this week" / "this month".
#:
#: ⚠️ THE OMISSIONS ARE THE POINT, NOT AN OVERSIGHT. `verified` spans the whole
#: retained ring (`pipeline`: "a problem reported two months ago and fixed last
#: week is still a verification"); `preventive`'s carried tasks are BY
#: DEFINITION from earlier; `standing` is the present tense and says so;
#: `health`, `waiting` and `coverage` describe the monitoring rather than the
#: period. A suffix on any of those turns a true heading into a false one.
#: ⚠️ `trends` IS NOT ONE, AND PUTTING IT HERE WAS A REGRESSION I SHIPPED. A
#: trend is a statement ABOUT a span longer than the period — the modules read
#: `min_history_days` (14 by default) whatever the cadence is, because a
#: baseline cannot be computed from one day. So "📈 Trends today" over a
#: fourteen-day finding asserts precisely the thing the owner asked me to
#: guarantee could never happen: "make sure the report is contextually
#: reflecting numbers and counts based on the selected time granularity".
#: The window is a STATISTICAL requirement, not a reporting period, so the fix
#: is to state it (see `_finding_line`) rather than shrink it to one day and
#: report noise.
PERIOD_SCOPED = frozenset({"critical", "money", "selfclear", "fixed"})


#: ⚠️ EVERY HEADING'S WORDS, IN ONE PLACE, BECAUSE THE TESTS KEPT PINNING THEM
#: AS LITERALS. Adding the period word broke SEVEN tests that had the old text
#: typed into an assertion — the fourth time this session a test anchored on
#: prose and failed for a change that was correct. A heading is presentation and
#: gets reworded on owner feedback roughly every release; nothing that checks
#: STRUCTURE should have to be edited when it does. Tests call `section_heading`.
SECTION_TITLE = {
    "critical": "What went wrong",
    "money": "What the waste cost",
    "money_unpriced": "Waste found but not priced",
    "verified": "Followed up — including before this period",
    "selfclear": "Closed by itself",
    "fixed": "For the facility manager",
    "preventive_open": "Still open from earlier",
    "preventive": "Maintenance signals",
    "trends": "Trends",
    "standing": "Right now",
    "health": "Monitoring health",
    "waiting": "Checks waiting on a rule that has never reported",
    "coverage": "Not covered by this report",
}


#: Which zone each section belongs to, and the order zones appear in.
#:
#: ⚠️ THE BRIEF USED TO BE NINE SECTIONS IN COMPOSITION ORDER, and on a real
#: delivered one that came to eight lines about the VILLA and eight about the
#: REPORTING SYSTEM, interleaved. A reader on a phone cannot separate them, and
#: the half that needs a human is not the half that is longest. Zones sort by
#: demand on attention: what a person must act on, what merely happened, and the
#: instrument talking about itself.
#:
#: ⚠️ EVERY SECTION HAS ONE — asserted, not assumed. A section missing from this
#: table would render in no zone, which is the silent disappearance
#: `SECTION_FOR_KIND` already exists to prevent one layer down.
#: ⚠️ THE CONTRACT'S OWN TUPLE, NOT A SECOND COPY. This restated
#: `contracts.ZONE` verbatim, so the renderer and the value validated on its way
#: to a narration provider were two declarations of one set — add a zone to
#: either and the other never hears about it. The ORDER is meaningful here and
#: the contract's tuple is already in reading order, which is why it can serve
#: both; if that ever stops being true, the fix is a derived ordering, never a
#: second list.
ZONE_ORDER: Tuple[str, ...] = ZONE
ZONE_TITLE = {
    "needs_you": "NEEDS YOU",
    "this_period": "THIS PERIOD",
    "about_report": "ABOUT THIS REPORT",
}
ZONE_OF_SECTION = {
    "standing": "needs_you",
    "fixed": "needs_you",
    "preventive_open": "needs_you",
    "critical": "this_period",
    "money": "this_period",
    "money_unpriced": "this_period",
    "preventive": "this_period",
    "selfclear": "this_period",
    "closed": "this_period",
    "verified": "this_period",
    "trends": "this_period",
    "health": "about_report",
    "waiting": "about_report",
    "coverage": "about_report",
}

#: ⚠️ THE RULE IS A CHARACTER `inert()` LEAVES ALONE, and that was checked
#: rather than assumed — box-drawing passes, asterisks and backticks do not.
ZONE_RULE = "\u2501"


def add_heading(lines: List[str], key: str, cadence: str = "") -> None:
    """Append a section heading, with the blank line it needs if it follows text.

    ⚠️ THIS RULE HAS NOW BEEN MISSED THREE TIMES, EACH AT A NEW SITE, WHICH MAKES
    THE RULE THE DEFECT RATHER THAN ANY OF THE SITES. `render` only separates
    SECTIONS, so a section emitting two headings runs them together — first
    caught between "Closed by itself" and "For the facility manager", then
    before "Still open from earlier", then between "Followed up" and "Closed by
    itself" when that method was split. Each fix was an inline `if lines:
    lines.append("")` at the site somebody happened to be looking at, which is
    `grep -l` three releases running.

    A caller now gets the blank line by CALLING, and a fourth heading cannot
    forget it.

    ⚠️ AND THE PIN FOUND A FOURTH SITE ON ITS FIRST RUN — `_skipped_lines`,
    which wrote its own blank line and had always been CORRECT. That is the
    part worth keeping: a correct copy is why nobody saw the pattern, because
    it makes "four copies" look like "three bugs and some code". When the same
    shape is fixed twice, stop fixing sites and count the copies.

    ⚠️ A SECTION THAT STARTS WITH ITS HEADING DOES NOT CALL THIS, and must not.
    `render` prepends a blank line to every section block, so
    `lines = [section_heading(...)]` is separated already; calling here would
    put two blanks in. Four sections do that and they are correct. This function
    is for a heading that follows CONTENT.
    """
    if lines:
        lines.append("")
    lines.append(section_heading(key, cadence))


#: How much rule precedes a zone title. ⚠️ A FIXED PREFIX, NOT A PADDED WIDTH.
#: The first cut padded every separator to 44 characters, which is wider than a
#: phone: Telegram wraps at roughly 32, so all three rules arrived split across
#: two lines with a ragged stub on the second — reported from a screenshot.
#:
#: ⚠️ AND THE FIX IS NOT A NARROWER PAD. There is no width that is right, because
#: the destination's is unknown and varies with the reader's font size, their
#: language and their device. A decorative rule is the one element that MUST NOT
#: wrap — prose wrapping is normal and invisible, a broken box-drawing line is
#: neither. So the separator is short by construction and cannot reach any
#: plausible margin: three characters plus the longest title is 21.
ZONE_RULE_LEAD = 3


def zone_heading(zone: str) -> str:
    """A zone separator, short enough that no destination can wrap it."""
    return f"{ZONE_RULE * ZONE_RULE_LEAD} {ZONE_TITLE[zone]}"


def section_heading(key: str, cadence: str = "") -> str:
    """The rendered heading for a section, period word included where allowed.

    The ONE expression both the renderer and the tests read, so rewording a
    heading is a one-line change rather than a one-line change plus seven
    assertions nobody remembers are there.
    """
    # ⚠️ `preventive_open` KEEPS ITS OWN KEY so it can carry its own glyph; only
    # `money_unpriced` collapses to its section, because the two money headings
    # are mutually exclusive and can never appear together to be confused.
    section = "money" if key == "money_unpriced" else key
    word = PERIOD_SCOPE_WORD.get(cadence, "") if section in PERIOD_SCOPED else ""
    text = SECTION_TITLE[key]
    return heading(section, f"{text} {word}" if word else text)


SECTIONS_FOR = {
    "owner": ("standing", "critical", "money", "closed", "fixed",
              "preventive", "trends", "health", "coverage"),
    "facility": ("standing", "critical", "closed", "fixed", "preventive",
                 "trends", "health", "coverage"),
}
#: An unknown audience gets everything rather than nothing: a missing section is
#: invisible, and this subsystem's rule is that absence must never be silent.
ALL_SECTIONS = ("standing", "critical", "money", "closed", "fixed",
                "preventive", "trends", "health", "coverage")

#: ⚠️ EVERY `FINDING_KIND` HAS A SECTION, AND THAT IS AN INVARIANT, NOT A
#: CONVENIENCE. The first cut routed `ANOMALY` to trends and `DATA_QUALITY` to
#: monitoring health and said nothing about the other three, so an
#: `OBSERVATION`, a `FORECAST` or a `VERIFICATION` finding was computed, gated,
#: counted in `ran`, and then silently dropped between the analysis and the
#: page. "A module is never silently absent" is this subsystem's first rule and
#: the renderer was the one place it did not hold.
#:
#: Pinned against `contracts.FINDING_KIND`, so adding a kind fails the suite
#: rather than losing findings in the field.
#: ⚠️ KEYS THAT ARE HOUSEKEEPING, NOT MEASUREMENTS. Everything else a blueprint
#: puts in `data` is a number it measured, and `_measurement` prints those —
#: which is how a maintenance line stops being a bare label. Excluding by NAME
#: rather than listing the measurements by name is what keeps this universal: a
#: blueprint that reports something nobody here anticipated still gets it read
#: out, and the alternative is a per-blueprint table that goes stale the day
#: someone adds a mode.
NON_MEASUREMENT_KEYS = frozenset({
    "blueprint", "rule_id", "report_bucket", "entities", "entity_id",
    "timestamp", "task_text", "severity", "label", "phase", "detail",
    "finding", "basis", "mode", "reason", "routed_as",
    # Money and duration are rendered by their own sections, in their own words.
    "kwh", "cost_local", "watts", "wasted_minutes", "runtime_hours",
    # Structured lists that are not a single readable figure.
    "gap_descriptions", "details", "disabled_automations",
    "missing_automations", "expected_area",
})

#: ⚠️ AND EVERY AGGREGATE CATEGORY HAS ONE TOO — the same invariant one layer
#: out, and it was broken in two places at once. `audit` groups were claimed by
#: NO section, and an roi group that was neither priced nor a trend fell between
#: `_money`'s filter and `_trends`'s. Because `_found_anything` counts groups,
#: the "nothing to report" sentence was suppressed as well: a real finding
#: fired, was caught, persisted, aggregated — and the owner received a report
#: reading only "Prepared Friday 21 August, 01:50." Blank, and silent about
#: being blank, which is the worst of the three kinds of empty.
#:
#: Found from a live `_analysis` reading `groups: 6` against five rendered.
SECTION_FOR_CATEGORY = {
    "critical": "critical",
    "maintenance": "preventive",
    "audit": "health",        # the automation layer auditing ITSELF is monitoring health
    "roi": "money",           # except `basis: trend`, which has no money — see `_trends`
}

SECTION_FOR_KIND = {
    "DATA_QUALITY": "health",      # the instrument, not the equipment
    "FORECAST": "preventive",      # a projection about equipment, with a horizon
    "VERIFICATION": "fixed",       # something confirmed resolved (Phase 7)
    "ANOMALY": "trends",
    "OBSERVATION": "trends",
}


def _plural(count: int, singular: str, plural: str = "") -> str:
    """"1 finding" / "2 findings". Machine output says "1 finding(s)".

    ⚠️ THE -Y RULE IS HERE, NOT AT THE CALL SITES. Appending a bare "s" printed
    "2 categorys of automation alert" in the first rendered report — the one
    word in this file that needed it, missed because the rule lived in the
    caller's head. Handling it once means the next caller gets it by calling.
    Anything irregular still passes `plural` explicitly.
    """
    if count == 1:
        return f"{count} {singular}"
    if plural:
        return f"{count} {plural}"
    if singular.endswith("y") and not singular.endswith(("ay", "ey", "iy",
                                                         "oy", "uy")):
        return f"{count} {singular[:-1]}ies"
    if singular.endswith(("s", "x", "z", "ch", "sh")):
        return f"{count} {singular}es"
    return f"{count} {singular}s"


#: Key suffixes that name a UNIT, so the value belongs before them rather than
#: after. ⚠️ SUFFIX RULES, NOT A PER-BLUEPRINT TABLE. `flagged_after_minutes: 60`
#: humanised naively reads "flagged after minutes 60", which is what the first
#: live report printed. A lookup of every field every blueprint might emit goes
#: stale the day someone adds a mode; a rule about how the field is NAMED keeps
#: working on fields nobody here has seen.
_UNIT_SUFFIXES = ("minutes", "hours", "days", "seconds", "weeks", "months")


def _phrase(key: str, value: Any, unit: str = "") -> str:
    """One measured field, as a phrase rather than a dump.

    ⚠️ A NUMBER WITHOUT ITS UNIT IS USELESS, AND THIS PRINTED THREE OF THEM.
    A delivered brief read "current value 1694.7, baseline value 750.0" and
    "max transitions 6" — asked, fairly, what they were. The owner's rule:
    never state a number without its unit where one exists. Three shapes had
    no route to one:

      *_value    the unit belongs to the SENSOR, not to the field name, so it
                 comes from `unit_of_measurement` on the entity the group is
                 about — see `ReportContext.units`.
      *_<plural> a bare count whose noun IS its unit: `max_transitions` is six
                 TRANSITIONS, not six of nothing.
      anything   still falls through to the humanised dump, because a stiff
                 true phrase beats a fluent one about the wrong field — the
                 rule this function was written under and which still holds.
    """
    words = key.split("_")
    tail = words[-1]
    stem = " ".join(words[:-1])
    if tail == "pct" and stem:
        return f"{stem} {value}%"
    if tail == "count" and stem:
        return _plural(int(value), stem) if isinstance(value, (int, float)) \
            else f"{stem} {value}"
    if tail in _UNIT_SUFFIXES and stem:
        return f"{stem} {value} {tail}"
    # ⚠️ THE SUBJECT'S OWN UNIT. `current_value`/`baseline_value` are whatever
    # the watched sensor measures — watts for a pump, degrees for the meter
    # cabinet — and only Home Assistant knows which.
    if tail == "value" and stem and unit:
        return f"{stem} {value} {unit}"
    # A plural noun tail counts things, and the noun is the unit.
    if (stem and tail.endswith("s") and not tail.endswith("ss")
            and isinstance(value, (int, float)) and not isinstance(value, bool)):
        return f"{stem} {_plural(int(value), tail[:-1])}"
    return f"{key.replace('_', ' ')} {value}" + (f" {unit}" if unit else "")


def _capitalise(text: str) -> str:
    """First letter up, rest untouched — never `.capitalize()`, which lowercases
    the remainder and would turn "The Facility Manager" into "The facility
    manager", which is the trap readable_label's callers were warned about."""
    return f"{text[:1].upper()}{text[1:]}" if text else text


def _plural_label(label: str, count: int) -> str:
    """A group label that agrees with how many things are under it.

    ⚠️ "(s)" IS NOT A PLURAL, IT IS A SHRUG. The owner's worked example wrote
    "Unavailable device(s):" as shorthand for the shape they wanted, not as the
    wording — `_plural` exists in this file precisely because "2 categorys"
    reached a rendered report, and printing "(s)" would be that lesson unlearned
    one line further out. The count is known at the point of printing, so the
    label can simply be right.
    """
    if label.endswith("s") and count == 1:
        singular = label[:-3] + "y" if label.endswith("ies") else label[:-1]
        return singular
    return label


def _bound_for(key: str, bounds: Dict[str, Any]) -> Tuple[str, Any]:
    """The `max_`/`min_` entry that bounds `key`, if one is present.

    ⚠️ MATCHED ON THE NOUN, TOLERATING PLURALS AND A `_count` TAIL, because the
    blueprints do not agree with themselves: the pair that prompted this is
    `transition_count` against `max_transitions`. Requiring an exact stem would
    have matched none of the real payloads, which is a pairing rule that pairs
    nothing — worse than no rule, because it looks implemented.
    """
    stem = key[:-6] if key.endswith("_count") else key
    for candidate in (stem, stem + "s", stem.rstrip("s")):
        for prefix in ("max_", "min_"):
            name = prefix + candidate
            if name in bounds:
                return name, bounds[name]
    return "", None


def _amount(value: float, whole: bool = False, currency: str = "") -> str:
    """A cost, in the operator's own currency where Home Assistant knows it.

    ⚠️ `whole` IS DECIDED BY THE LIST, NOT BY THE VALUE. Choosing per value
    printed "799", "156" and "96.00" in one column of a real report. The
    currency is the operator's own and unknown here, so nothing can be inferred
    from magnitude alone — but within one list, consistency is available for
    free and its absence reads as a mistake.
    """
    text = f"{value:,.0f}" if whole or abs(value) >= 100 else f"{value:,.2f}"
    # ⚠️ THE CODE AFTER THE NUMBER, NOT A SYMBOL BEFORE IT. `get_config` returns
    # an ISO code (`IDR`, `EUR`), not a glyph, and inventing the glyph would be
    # the guess this deliberately does not make — `Rp` and `IDR` are not
    # interchangeable to everyone and a wrong symbol is worse than none.
    return f"{text} {currency}" if currency else text


class DeterministicNarrator:
    """Renders a report with no network, no provider and no dependencies."""

    name = "deterministic"

    #: ⚠️ SET PER RENDER, because `_money_line` formats one group and is not
    #: given the context. A renderer instance handles one report at a time —
    #: `pipeline` constructs it per pass — so this cannot leak between reports.
    _currency: str = ""
    _labels: Dict[str, str] = {}
    _units: Dict[str, str] = {}

    def render(self, context: ReportContext) -> Tuple[str, str]:
        self._currency = context.currency
        self._labels = context.labels or {}
        self._units = context.units or {}
        title = self._title(context)
        lines: List[str] = list(self._headline(context))

        wanted = SECTIONS_FOR.get(context.audience, ALL_SECTIONS)
        builders = {
            "standing": self._standing,
            "critical": self._critical_recap,
            "money": self._money,
            "closed": self._closed,
            "fixed": self._fixed_and_suggested,
            "preventive": self._preventive,
            "trends": self._trends,
            "health": self._monitoring_health,
            "coverage": self._coverage,
        }
        # ⚠️ ASKED OF THE FACTS, NOT OF THE RENDERED BLOCKS. The first cut
        # counted any non-empty section as content, and the Money ADMISSION
        # ("no tariff is configured, so waste cannot be priced") is a non-empty
        # section — so a property with no tariff silently lost the sentence
        # that says which kind of empty this is. That sentence exists because
        # v2.510.0 shipped "no automated checks are configured yet" about a
        # property where a check had just run; suppressing it is the same
        # defect wearing the opposite sign.
        if not self._found_anything(context):
            lines.append("")
            lines.append(self._nothing_to_report(context))

        # ⚠️ RENDERED FIRST, GROUPED SECOND. Every section is built exactly as
        # before and then filed under its zone, so zoning cannot change WHICH
        # sections appear or what they say — only the order they are read in and
        # the rule printed above each group. A zone with nothing in it prints
        # nothing at all: a "NEEDS YOU" header over silence is the loudest
        # possible way to say nothing is wrong, and would train the reader to
        # skip the one banner that must never be skipped.
        rendered: Dict[str, List[str]] = {z: [] for z in ZONE_ORDER}
        for name in wanted:
            block = builders[name](context)
            if not block:
                continue
            zone = ZONE_OF_SECTION.get(name)
            # A section nobody filed lands in the period zone rather than
            # vanishing — the same "never drop it" rule `_findings_for` follows.
            rendered[zone if zone in rendered else "this_period"].extend(
                [""] + block)

        for zone in ZONE_ORDER:
            if not rendered[zone]:
                continue
            lines.append("")
            lines.append(zone_heading(zone))
            lines.extend(rendered[zone])

        return title, "\n".join(lines).strip()

    def _found_anything(self, context: ReportContext) -> bool:
        """Did this report actually find something to say?

        Deliberately NOT "did any section render" — an admission renders, and
        admitting you could not measure something is the opposite of finding it.
        """
        return bool(self._list(context, "groups")
                    or context.findings
                    or self._list(context, "tasks")
                    # ⚠️ A STILL-OPEN JOB IS NEWS. A week whose only content is
                    # a task raised earlier and never done is not an empty week,
                    # and saying "found nothing" over the top of it would be the
                    # 2.530.0 defect in a new place.
                    or context.carried_tasks
                    # ⚠️ AND SO IS A DEVICE THAT IS OFF RIGHT NOW. Adding the
                    # standing section without adding it HERE printed "no
                    # automated checks are configured yet, so nothing has been
                    # assessed" directly above a list of eight things that were
                    # wrong — the report contradicting itself inside one
                    # message, which is the exact failure this whole exercise
                    # is about, committed while fixing it.
                    or context.standing)

    # ── framing ──────────────────────────────────────────────────────────────

    #: The prose a provider may replace, and nothing else.
    #:
    #: ⚠️ THE PROVIDER FILLS SLOTS; IT NO LONGER REBUILDS THE DOCUMENT. Whole-body
    #: replacement made the model responsible for structure it cannot be trusted
    #: with — sparklines, aligned columns and every number would be retyped by a
    #: language model, and a third of the prompt was format rules restating
    #: `style.py` in English where the two could drift. Worse, one weak answer
    #: cost the entire brief.
    #:
    #: With slots the renderer keeps the document — zones, charts, columns,
    #: figures, the footer — and the model writes the sentences it is actually
    #: good at. Degradation gets FINER, not weaker: an unusable slot falls back
    #: to its deterministic text on its own, so a bad answer costs one sentence.
    #: The safety property CLAUDE.md records ("a provider can only replace, so
    #: doing nothing is the fallback") is unchanged in kind and stronger in
    #: degree.
    SLOTS: Tuple[str, ...] = ("lead",)

    def slot_defaults(self, context: ReportContext) -> Dict[str, str]:
        """What each slot says when nobody improves on it."""
        return {"lead": self._lead_sentence(context)}

    def _lead_sentence(self, context: ReportContext) -> str:
        """The one line a push notification shows before it is cut off.

        ⚠️ IT NAMES THE LOUDEST THING, NOT THE FIRST. A notification preview is
        about two lines; if they are spent on a heading the reader learns
        nothing. Standing state leads when there is any, because it is the only
        section in the present tense — what is wrong RIGHT NOW outranks what
        happened earlier today, however expensive.
        """
        standing = [i for i in (context.standing or []) if isinstance(i, dict)]
        if standing:
            kinds = {str(i.get("kind") or "") for i in standing}
            for kind, label in KIND_HEADINGS:
                if kind in kinds:
                    n = sum(1 for i in standing if i.get("kind") == kind)
                    # ⚠️ THE VERB AGREES TOO. `_plural` handles the noun and
                    # this read "1 unavailable device NEED attention" — the
                    # exact shape of the "2 categorys" defect `_plural` exists
                    # to prevent, one word to the right of where it looks.
                    return (f"{_plural(n, _plural_label(label, 1).lower())} "
                            f"{'needs' if n == 1 else 'need'} attention right "
                            f"now.")
        incidents = [g for g in self._groups(context, "critical")
                     if self._is_open(g)]
        if incidents:
            return f"{_plural(len(incidents), 'critical alert')} still open."
        return ""

    def _title(self, context: ReportContext) -> str:
        """⚠️ THE TITLE IS OFTEN ALL THAT IS READ — a push notification shows it
        and about two lines, a chat list shows it alone. So it leads with how
        urgent this one is, in the same visual language the villa's own
        automations already use (`🪫 Low Battery Alert`). The words after the
        marker are unchanged: a title that also changed its wording would break
        every reader's sense of which message this is."""
        # ⚠️ THE SPAN, NOT THE CADENCE AND THE SEND DATE. "Daily property brief
        # — 2026-08-21" drew two questions at once: "would that always be
        # daily?" and "based on what start/end date?". The cadence is a SETTING
        # and the date was when it was SENT, so between them they never named
        # the days the contents describe. The span answers both and makes the
        # cadence redundant rather than restated. Falls back to the stored
        # period key when the timestamp will not parse — a title is never worth
        # failing a delivery over.
        audience = AUDIENCE_WORD.get(context.audience, "brief")
        try:
            span = period_span(context.cadence,
                               datetime.fromisoformat(context.generated_at))
        except (TypeError, ValueError):
            span = context.period
        # ⚠️ NO "Property" PREFIX — `AUDIENCE_WORD` ALREADY CARRIES IT. Adding
        # one rendered "Property property brief". The cadence word it replaced
        # sat in the same slot, which is why the doubling was not obvious from
        # the diff; it was obvious from one line of output.
        return f"{title_mark(self._worst(context))} {audience.title()} — {span}"

    def _worst(self, context: ReportContext) -> str:
        """The loudest thing in this brief, for the title's marker.

        ⚠️ THE SAME RANK THE HISTORY ENTRY RECORDS, over the same two sources —
        this add-on's own findings and the blueprint layer's groups. A title
        that said "all clear" over a brief opening with a critical alert would
        be the instrument lying, one surface further out than v2.555.0's.
        """
        worst = "info"
        for item in context.findings or []:
            if isinstance(item, dict):
                candidate = str(item.get("severity", "info"))
                if severity_rank(candidate) > severity_rank(worst):
                    worst = candidate
        for group in (context.aggregated.get("groups") or []):
            candidate = str(getattr(group, "severity", "info"))
            if severity_rank(candidate) > severity_rank(worst):
                worst = candidate
        # ⚠️ THE THIRD SOURCE, AND IT SHIPPED MISSING FOR ONE RENDER. A brief
        # listing five offline devices, a leak and an open fault was titled with
        # a green tick, because this read only the PERIOD's findings and standing
        # state is the present tense. The title is often all that is read, so
        # that tick is the whole message for most readers.
        #
        # ⚠️ THE MAPPING IS `standing.SEVERITY_OF_KIND`, NOT A LOCAL GUESS. The
        # kiosk already decides which kinds are "broken or unsafe right now" and
        # which are "needs doing" — a second opinion here would put the tablet on
        # red and the notification on amber for one villa. (This sentence named
        # `DANGER_KINDS` until 2.573.0, which is the constant the table is
        # derived from and pinned against, but not the one this line calls.)
        for row in context.standing or []:
            if not isinstance(row, dict):
                continue
            candidate = standing_severity(str(row.get("kind") or ""))
            if severity_rank(candidate) > severity_rank(worst):
                worst = candidate
        return worst

    def _when(self, iso: str) -> str:
        """A timestamp an owner reads, not one a machine parses.

        The ISO form is exact and unreadable — "Prepared
        2026-08-20T07:00:00+08:00." in a message on a phone. Degrades to the
        raw string rather than raising, because a badly formatted date must
        never be the reason a report does not arrive.
        """
        try:
            moment = datetime.fromisoformat(iso)
        except ValueError:
            return iso
        return moment.strftime("%A %-d %B, %H:%M")

    # ── 1. headline ──────────────────────────────────────────────────────────

    def _headline(self, context: ReportContext) -> List[str]:
        """The period, and the one number that matters.

        ⚠️ BULLETS, LIKE EVERY OTHER LINE OF FACT IN THE BRIEF. These were bare
        sentences under the "Prepared ..." line while every section below marked
        its lines with `BULLET` — so the two most important numbers in the whole
        message were the only ones a reader could not pick out by scanning.
        Asked for directly. The "Prepared ..." line stays unmarked: it is the
        dateline, not a finding.

        ⚠️ THE NUMBER IS OMITTED RATHER THAN ZEROED when nothing was priced.
        "0 wasted" is a measurement; "nothing priced" is the absence of one, and
        a property with no tariff configured would otherwise be congratulated
        every week on spending nothing.
        """
        discovery = context.discovery
        if not discovery.get("reachable", False):
            # The one case where there is nothing else honest to say.
            reason = str(discovery.get("error") or "reason unknown")
            return [
                "Home Assistant could not be reached while preparing this "
                "report, so nothing could be measured.",
                f"Reason: {reason}",
            ]

        # ⚠️ THE DATELINE CARRIES THE WINDOW, AND THE TWO TIMES ARE DIFFERENT.
        # "Prepared ... 23:35" is when it was composed; the counts reset at
        # midnight. A reader who has only the prepared time will infer a rolling
        # window from it, which is exactly what was asked. `standing` is
        # deliberately NOT covered by this sentence — it is the present tense
        # and says so in its own heading.
        lead = (context.slots or {}).get("lead") or self._lead_sentence(context)
        lines = [lead] if lead else []
        lines.append(f"Prepared {self._when(context.generated_at)}.")
        phrase = WINDOW_PHRASE.get(context.cadence)
        if phrase:
            lines.append(phrase)

        savings = self._savings(context)
        total = savings.get("total")
        # ⚠️ ONLY WHERE THE MONEY SECTION IS ACTUALLY RENDERED. The facility
        # brief withholds the cost ranking — that audience does not act on it —
        # and the headline was announcing the total anyway, so the facility
        # manager read "Avoidable cost identified: 1,051, across 3 findings; 1
        # further finding could not be priced" with NO breakdown anywhere below
        # it. That is v2.529.0's contradiction with the sign flipped: there the
        # headline priced what the section denied, here it prices what the
        # audience is never shown.
        shows_money = "money" in SECTIONS_FOR.get(context.audience, ALL_SECTIONS)
        if shows_money and isinstance(total, (int, float)) and savings.get("groups"):
            mix = savings.get("basis_mix") or {}
            estimated = int(mix.get("estimated", 0))
            counted = int(savings["groups"])
            qualifier = ""
            if estimated >= counted:
                # ⚠️ "across 1 finding, 1 of them estimated" — counting a subset
                # that is the whole set. Read on hardware in the first live
                # report; the arithmetic was right and the sentence was silly.
                qualifier = " — estimated from assumed loads rather than metered"
            elif estimated:
                qualifier = (f", {estimated} of them estimated rather than "
                             f"metered")
            # ⚠️ A TOTAL THAT EXCLUDES MEASURED WASTE MUST SAY SO. The headline
            # read "52.00, across 1 finding" while the section below listed two
            # — the second being real waste with no tariff behind it, so it is
            # absent from the total AND from its count. A reader seeing one
            # number and two lines is being quietly under-told, which is the
            # "say what could not be seen" rule failing in the one place
            # everybody reads.
            unpriced = max(0, len([g for g in self._groups(context, "roi")
                                   if self._text(g, "basis") != "trend"])
                           - counted)
            more = (f"; {_plural(unpriced, 'further finding')} "
                    f"{'was' if unpriced == 1 else 'were'} measured but could "
                    f"not be priced") if unpriced else ""
            lines.append(
                f"{BULLET}Avoidable cost identified: "
                f"{_amount(self._money_shown_total(context, self._money_whole(context)), whole=self._money_whole(context), currency=context.currency)}, across "
                f"{_plural(counted, 'finding')}{qualifier}{more}.")

        if context.findings:
            # ⚠️ READABLE ENGLISH, NOT "1 finding(s)". This is read by the
            # villa's owner every week and the sloppiness costs nothing to fix.
            #
            # ⚠️ AND IT SAID "from this property's own checks", WHICH WAS BOTH
            # VAGUE AND BACKWARDS. Asked directly where the number came from.
            # `context.findings` is the ADD-ON's built-in analysis PLUS
            # `verify`'s confirmations — so "this property's own checks" named
            # the one thing it is not (the property's own checks are its
            # blueprints, which feed `aggregated`). On the brief that prompted
            # the question the modules had all stood down and all three were
            # verifications, so the line counted things that went RIGHT and
            # filed them under a heading implying they went wrong.
            #
            # Split, because they are two different claims and a reader can act
            # on only one of them.
            confirmations = sum(1 for f in context.findings
                                if isinstance(f, dict)
                                and str(f.get("kind") or "") == "VERIFICATION")
            analysed = len(context.findings) - confirmations
            if analysed:
                lines.append(
                    f"{BULLET}{_plural(analysed, 'finding')} from VESTA's own "
                    f"analysis, alongside your automations' alerts.")
            if confirmations:
                lines.append(
                    f"{BULLET}{_plural(confirmations, 'earlier problem')} "
                    f"confirmed fixed — see Followed up below.")

        incidents = self._groups(context, "critical")
        if incidents:
            still_open = [g for g in incidents if self._is_open(g)]
            if still_open:
                lines.append(
                    f"{BULLET}{_plural(len(still_open), 'critical alert')} from "
                    f"this period {'is' if len(still_open) == 1 else 'are'} "
                    f"still unresolved.")
        return lines

    def _nothing_to_report(self, context: ReportContext) -> str:
        """⚠️ THE SENTENCE THAT KEEPS AN EMPTY REPORT HONEST, and it must say
        which KIND of empty this is. There are four now, and they mean
        different things:

          nothing could be measured    — Home Assistant was unreachable
          nothing was listening        — the collector was offline for the period
          nothing is configured        — no checks and no blueprints exist
          checks ran and found nothing — the good outcome

        This returned the "nothing is configured" sentence in every case for one
        release, so the first live run against real meters reported "no
        automated checks are configured yet" about a property where a check had
        just run and found nothing. Grammatical, plausible, and false — the same
        failure as the blind-spot section asserting a tariff was configured.

        None of them may read as "everything is fine": that is a conclusion, and
        only the last has drawn anything at all.
        """
        if not context.discovery.get("reachable", False):
            return "No checks ran, because Home Assistant could not be reached."

        listening = bool(context.collector.get("connected")) or bool(
            context.collector.get("online_since"))
        watched = context.collector.get("blueprint_categories") or []
        if watched and not listening:
            return ("Nothing was listening for this property's own automation "
                    "alerts during this period, so their findings were not "
                    "recorded. This is not the same as nothing happening.")

        if context.ran or watched:
            # ⚠️ THE VERB AGREES WITH THE SUBJECT. The first cut joined the
            # sources and appended "were in effect", which reads "1 check were
            # in effect" on the commonest deployment of all — a single module
            # and no blueprints.
            sources = []
            if context.ran:
                sources.append(_plural(len(context.ran), "check"))
            if watched:
                sources.append(
                    f"{_plural(len(watched), 'category')} of automation alert")
            subject = " and ".join(sources)
            verb = "ran and found" if len(sources) == 1 and context.ran \
                else "were in effect and found"
            return f"{subject} {verb} nothing worth reporting this period."

        if context.skipped:
            return "No checks ran this period — see the reasons below."
        return ("No automated checks are configured yet, so nothing has been "
                "assessed. This report confirms the schedule and delivery are "
                "working.")

    # ── 2. critical recap ────────────────────────────────────────────────────

    def _critical_recap(self, context: ReportContext) -> List[str]:
        groups = self._groups(context, "critical")
        if not groups:
            return []
        lines = [section_heading("critical", context.cadence)]
        for group in self._top(groups):
            lines.append(f"{BULLET}{self._incident_line(group)}")
        return lines + self._and_more(groups)

    def _occurrences(self, group: Any) -> str:
        """The group's name, with "(N times)" when it fired more than once.

        ⚠️ SHARED BY THE RECAP AND "CLOSED BY ITSELF", because they had two
        conventions for one fact four lines apart — one collapsing repeats into
        a count and the other repeating the name. Whatever the next section to
        list incidents is, it gets the count by CALLING rather than by
        remembering."""
        label = self._name(group, alert=True)
        count = self._count(group)
        return f"{label} ({_plural(count, 'time')})" if count > 1 else label

    def _incident_line(self, group: Any) -> str:
        """One incident, with whether it ENDED — which is the whole point.

        ⚠️ A duration is printed only when both ends were seen. The blueprints
        emit `raised` and `cleared` with no incident id, so an unmatched raise
        has no honest duration and gets "still unresolved" instead of a number.
        """
        opened = self._is_open(group)
        minutes = self._number(group, "duration_minutes")

        parts: List[str] = [self._occurrences(group)]
        if opened:
            parts.append("— still unresolved")
        elif minutes is not None:
            parts.append(f"— resolved after {self._duration(minutes)}")
        else:
            parts.append("— resolved")
        return " ".join(parts)

    # ── 3. money ─────────────────────────────────────────────────────────────

    def _money(self, context: ReportContext) -> List[str]:
        """Ranked waste, each figure carrying how it was arrived at.

        ⚠️ THE ADMISSION REPLACES THE SECTION, it does not accompany it. A
        property with no tariff cannot price anything, and printing an empty
        Money section under a heading reads as "nothing was wasted".
        """
        # ⚠️ EVERY NON-TREND roi GROUP, NOT ONLY THE PRICED ONES. `aggregate.rank`
        # already puts priced first and unpriced last precisely so this section
        # can show both; filtering here dropped "the jacuzzi ran 3.5 hours"
        # entirely because nobody had configured a tariff for it.
        billable = [g for g in self._groups(context, "roi")
                    if self._text(g, "basis") != "trend"]
        priced = [g for g in billable
                  if self._number(g, "total_cost") is not None]

        # ⚠️ THE `energy_cost` CAPABILITY DOES NOT GOVERN THIS SECTION WHEN THE
        # BLUEPRINTS HAVE PRICED THEIR OWN FINDINGS, AND CONFLATING THE TWO
        # PRINTED A FLAT CONTRADICTION. A live report read:
        #
        #     Avoidable cost identified: 26.00, across 1 finding
        #     ...
        #     Avoidable cost:
        #     - Not calculated — see monitoring health below.
        #
        # `energy_cost` means "a tariff is configured ON THE HOME ASSISTANT
        # ENERGY DASHBOARD" — the source the BUILT-IN MODULES would need. Every
        # roi blueprint carries its own `tariff_per_kwh` input and ships
        # `cost_local` already multiplied, so a property with no dashboard
        # tariff can still be told exactly what it wasted. The admission is for
        # having nothing priced, not for lacking a capability this section
        # never used.
        if billable:
            head = (section_heading("money", context.cadence) if priced
                    else section_heading("money_unpriced", context.cadence))
            # ⚠️ ONE FORMAT FOR THE WHOLE LIST. `_amount` decided per value —
            # two decimals below 100, none above — so a real report printed
            # "799", "156" and "96.00" in the same column. The currency is the
            # operator's own and unknown here, so the magnitude of the LIST
            # decides: if anything in it is large, minor units are noise
            # everywhere in it.
            whole = self._money_whole(context)
            # ⚠️ THE COMPARISON IS THE POINT, NOT THE DECORATION. "74 IDR" cannot
            # be judged; "74 IDR, up 21% on a normal day" can. The chart is eight
            # characters of block elements — checked against `inert()`, renders
            # on every destination, costs nothing offline, which a hosted image
            # does not.
            past = (context.history or {}).get("avoidableCost") or []
            shown_total = self._money_shown_total(context, whole)
            move = trend_mod.phrase(shown_total, past, context.currency,
                                    context.cadence)
            if move:
                head = f"{head}   {move}"
            lines = [head]
            # ⚠️ NO PRIOR PERIODS, NO CHART. The first brief after this shipped
            # drew "1 day: ▅" — a single bar, scaled against itself, saying
            # nothing whatsoever. A trend needs something to trend against, and
            # a chart that cannot show a shape is decoration where the rest of
            # this report is measurement.
            chart = (trend_mod.sparkline(list(past) + [shown_total])
                     if len(past) >= trend_mod.MIN_TREND_PERIODS else "")
            if chart:
                noun = trend_mod.PERIOD_NOUN.get(context.cadence, "period")
                lines.append(f"   {_plural(len(past) + 1, noun)}: {chart}")
            for group in self._top(billable):
                lines.append(self._money_line(group, whole=whole))
            # ⚠️ THE TAIL CARRIES ITS COST, OR THE TOTAL CANNOT BE REACHED.
            # `_and_more` prints "and N more." with no figure, so beyond
            # MAX_LINES the headline's total stopped being derivable from the
            # page — asked directly: "are you sure this number can be derived
            # from the rest of the report?". It was, in the brief that prompted
            # the question, because it had two lines. With nine it would not be.
            hidden = [g for g in billable[MAX_LINES:]
                      if self._number(g, "total_cost") is not None]
            extra = len(billable) - MAX_LINES
            if extra > 0:
                spent = sum(self._as_shown(self._number(g, "total_cost") or 0.0,
                                           whole) for g in hidden)
                tail = (f" — {_amount(spent, whole=whole, currency=context.currency)} "
                        f"between them") if hidden else ""
                lines.append(f"{BULLET}and {extra} more{tail}.")
            return lines

        if "energy_cost" in (context.discovery.get("capabilities_missing") or []):
            # ⚠️ THE SECTION STAYS AND THE REASON MOVES. Two rules pull opposite
            # ways here: the admission must exist, or Money's silence reads as
            # "nothing was wasted" — and a missing tariff must be SAID ONCE, or
            # it appears here and again under monitoring health in slightly
            # different words. So when preflight already explains it, this
            # points at that instead of restating it.
            head = section_heading("money", context.cadence)
            if self._explained(context, "energy_cost"):
                return [head, f"{BULLET}Not calculated — see monitoring health "
                              f"below."]
            return [head,
                    f"{BULLET}Not calculated. No electricity tariff is "
                    f"configured, so waste can be identified but not priced."]
        return []

    @staticmethod
    def _as_shown(value: float, whole: bool) -> float:
        """A cost rounded exactly as `_amount` will print it.

        ⚠️ THE HEADLINE SUMS THESE, NOT THE TRUE VALUES, AND THAT IS THE WHOLE
        FIX. Sharing the FORMAT between the headline and the list was not
        enough: 100.4 and 50.4 both print whole, as "100" and "50", while their
        true sum 150.8 prints as "151". A reader adding the column gets 150 and
        is told 151 — the arithmetic the report asks them to trust, failing by
        one, every time the decimals happen to carry.

        Costs a little precision in the headline and buys the only property that
        matters for it: a total a reader can reach from the page.
        """
        return round(value) if whole else round(value, 2)

    def _money_shown_total(self, context: ReportContext, whole: bool) -> float:
        """What the Money column adds up to, as printed."""
        return sum(self._as_shown(self._number(g, "total_cost") or 0.0, whole)
                   for g in self._groups(context, "roi")
                   if self._text(g, "basis") != "trend"
                   and self._number(g, "total_cost") is not None)

    def _money_whole(self, context: ReportContext) -> bool:
        """Whether money in THIS report prints without minor units.

        ⚠️ ONE DECISION FOR THE HEADLINE AND THE LIST. It was made twice: the
        list asked "is anything in me large?" and `_amount` asked the TOTAL "are
        you large?". Two items of 100.4 and 50.4 printed as "100" and "50" over
        a headline of "151" — a reader adding the column up gets a different
        answer from the one they were given, which is exactly the arithmetic
        this report asks them to trust.
        """
        return any((self._number(g, "total_cost") or 0) >= 100
                   for g in self._groups(context, "roi")
                   if self._text(g, "basis") != "trend")


    def _money_line(self, group: Any, whole: bool = False) -> str:

        cost = self._number(group, "total_cost")
        basis = self._text(group, "basis")
        label = self._name(group)
        note = ""
        if basis == "estimated":
            note = " (estimated from an assumed load, not metered)"
        elif basis == "measured":
            note = " (metered)"
        kwh = self._number(group, "total_kwh")
        energy = f"{kwh:.2f} kWh" if kwh is not None else ""

        # ⚠️ NO COST IS NOT ZERO COST. A rule can measure waste without anyone
        # having given it a tariff, and printing "0.00" would report the
        # opposite of what happened. Say what IS known — the energy, the
        # duration, the occurrences — and say nothing about money.
        if cost is None:
            # ⚠️ THE DURATION IS THE CONTENT HERE. `_measurement` excludes
            # `wasted_minutes` and `runtime_hours` because money and duration
            # normally have their own sections — but for an unpriced line THIS
            # is that section, and it printed "no figure supplied" about an
            # event carrying `runtime_hours: 3.5`.
            spent = self._number(group, "total_minutes")
            duration = self._duration(spent) if spent else self._runtime(group)
            said = ", ".join(p for p in (energy, duration) if p) \
                or self._measurement(group) or "no figure supplied"
            return f"{BULLET}{label}: {said}, not priced"
        parts = [_amount(float(cost), whole, currency=self._currency)]
        if energy:
            parts.append(energy)
        return f"{BULLET}{label}: {', '.join(parts)}{note}"

    # ── 4. fixed and suggested ───────────────────────────────────────────────

    def _phased_groups(self, context: ReportContext) -> List[Any]:
        """Every group whose blueprint reports a lifecycle, in any category.

        ⚠️ THIS WAS `critical` ONLY, AND THAT MADE A WHOLE HALF OF THE CATALOG
        INVISIBLE BEFORE IT WAS WRITTEN. Every PM row in the workbook defines a
        "Clear / recovery rule" and a "Re-arm / cooldown" — PM-04 clears at
        "Power factor > 0.70 for 3 runs", re-arms after 7 days — and none of the
        `maintenance_*` blueprints emit one yet. When they do, the report would
        have thrown the clear away: `_closed` asked only `critical` groups
        whether they had ended, so a resolved pump alert would still have read
        as an open one, and the operator's work would have produced no visible
        change. Found by reading the catalog against this renderer rather than
        by waiting for the field report.

        ⚠️ ASKED OF THE DATA, NOT OF A CATEGORY LIST. A group qualifies because
        one of its events carries a `phase`, so a category that starts reporting
        a lifecycle is included the day it does — no table to edit, which is the
        `grep -l` mistake this project keeps paying for.

        `_critical_recap` deliberately stays critical-only: "What went wrong" is
        about incidents, and a pump drifting is not one.
        """
        out: List[Any] = []
        for category in SECTION_FOR_CATEGORY:
            for group in self._groups(context, category):
                if any(self._text(i, "phase") for i in self._items(group)):
                    out.append(group)
        return out

    def _closed(self, context: ReportContext) -> List[str]:
        """What ENDED: confirmed fixed, and what cleared without anybody acting.

        ⚠️ SPLIT OUT OF `_fixed_and_suggested` WHEN ZONES ARRIVED, and the split
        is the point rather than tidying. That method emitted four headings —
        two describing work a human must still do, two describing work that is
        over — so once sections were grouped by demand on the reader it could
        not be filed at all: half of it belongs in NEEDS YOU and half in THIS
        PERIOD. One builder, one zone.
        """
        verified = self._findings_for(context, "fixed")
        resolved = [g for g in self._phased_groups(context)
                    if not self._is_open(g)]
        if not verified and not resolved:
            return []
        lines: List[str] = []
        if verified:
            # ⚠️ THE SHARED SENTENCE IS WRITTEN ONCE. Three lines ended with the
            # same eleven words — "The Facility Manager marked it done, and it
            # has not recurred since" — which is a third of the section spent
            # restating one fact. Same treatment the `waiting` group already
            # gets, and the note is NOT bulleted: it is about the list, not in it.
            # ⚠️ ITS OWN HEADING. These rendered as bare bullets above
            # "Raised for the caretaker", orphaned under nothing — and a
            # verification is the one line in the report that says a story
            # ENDED, which is precisely the line a reader should be able to
            # find. "Followed up" describes the ACTION, which is evidenced;
            # the sentence itself never says more than "has not recurred".
            add_heading(lines, "verified")
            shown = verified[:MAX_LINES]
            tails = [self._verified_tail(i) for i in shown]
            # ⚠️ ONLY HOIST WHEN THERE IS A GROUP TO HOIST TO. The first cut
            # computed `shared` from a single item too, stripped the clause off
            # it, and then declined to print the note because there was nothing
            # to share it between — so a lone verification silently lost the
            # only sentence that said it had been fixed.
            shared = (tails[0] if len(shown) > 1 and tails
                      and len(set(tails)) == 1 else "")
            for item, tail in zip(shown, tails):
                line = self._finding_line(item)
                if shared and line.endswith(shared):
                    line = line[: -len(shared)].rstrip(" .,;—-")
                lines.append(line)
            if shared:
                lines.append(_capitalise(shared.strip(" .,;—-")) + ".")
        if resolved:
            # ⚠️ A BULLET UNDER A HEADING, NOT A BARE SENTENCE. It used to sit
            # unmarked directly above "For the caretaker", so once headings
            # carried markers every other top-level line in the body was either
            # a marked heading or a bullet and this one was neither — it read as
            # a heading that had lost its icon. Found by rendering a brief from
            # real data and looking at it, which is the only thing that finds a
            # line that is grammatical and misplaced.
            add_heading(lines, "selfclear", context.cadence)
            # ⚠️ NAMED, NOT COUNTED. This printed "3 alerts resolved without
            # intervention." directly under a section that had just listed
            # those same three with their durations — a number the reader has to
            # reconcile against the lines above it, adding nothing. Asked
            # outright: "what are these alerts?". A count is only worth a line
            # when the things counted are not already on the page.
            for group in resolved[:MAX_LINES]:
                # ⚠️ THE SAME "(N times)" THE RECAP USES. Listing one incident
                # per occurrence put "Entrance unlocked while vacant" on two
                # consecutive lines with nothing to tell them apart, while the
                # section directly above it collapsed the identical events into
                # "(6 times)". Two conventions for one fact, four lines apart.
                lines.append(f"{BULLET}{self._occurrences(group)}")
            if len(resolved) > MAX_LINES:
                lines.append(f"{BULLET}and {len(resolved) - MAX_LINES} more.")
        return lines

    def _fixed_and_suggested(self, context: ReportContext) -> List[str]:
        """What closed by itself, and what somebody has been asked to do.

        ⚠️ THE TASKS ARE REPORTED, NOT CREATED. Nine blueprints call
        `todo.add_item` beside their event; this says what they raised. The
        report never writes to the caretaker list or the Facility Manager
        store — reconciling the two is Phase B, and a report generator that
        mutates the record it reports on is one nobody can trust.
        """
        tasks = self._list(context, "tasks")
        if not tasks and not context.carried_tasks:
            return []
        lines: List[str] = []
        if tasks:
            # ⚠️ A SECTION CAN HOLD MORE THAN ONE HEADING, AND `render` ONLY
            # SEPARATES SECTIONS. So two headings inside this one ran together
            # with no blank line between them — visible in the first delivered
            # brief that had both. The separator belongs wherever a heading
            # follows content, not only at a section boundary.
            # ⚠️ "FACILITY MANAGER", NOT "CARETAKER". The kiosk calls this
            # person the Facility Manager everywhere — the workspace, the role,
            # the permission — and the brief was the only surface using a
            # second word for them. The blueprints' own `caretaker_todo_list`
            # input keeps its name; that is the operator's YAML, not ours.
            add_heading(lines, "fixed", context.cadence)
            for task in tasks[:MAX_LINES]:
                if isinstance(task, dict):
                    where = str(task.get("bucket") or "").strip()
                    text = str(task.get("text") or "").strip()
                    # ⚠️ AND WHAT IT IS ABOUT. "Re-enable, or document as a
                    # deliberate, intentional decision. (Critical automation
                    # health)" is a blueprint's own task text plus its bucket —
                    # correct, and unusable without knowing what to re-enable.
                    # ⚠️ `readable_label` ON THE HA NAME TOO, NOT ONLY ON THE
                    # FALLBACK. See `_entity_names` for the whole argument; this
                    # is the line the owner read it on — "Critical automation
                    # health 'critical doorbell---parking gate'".
                    who = ", ".join(
                        name_of(readable_label(self._labels.get(e) or "")
                                or prettify_entity_slug(e))
                        for e in (task.get("entities") or [])[:3])
                    # ⚠️ THE SUBJECT LEADS, BECAUSE THIS IS A WORKLIST. A
                    # Telegram screenshot showed seven of these, each opening
                    # with a different instruction and wrapping to three lines,
                    # so the left edge — the only part a reader scans — said
                    # nothing about which piece of equipment each one was. The
                    # instruction is what you read AFTER deciding a line is
                    # yours. Same facts, same order of importance, reversed on
                    # the page.
                    head = " ".join(p for p in (where, who) if p)
                    lines.append(f"{BULLET}{head} — {text}" if head
                                 else f"{BULLET}{text}")
            if len(tasks) > MAX_LINES:
                lines.append(f"{BULLET}and {len(tasks) - MAX_LINES} more.")

        # ⚠️ A SEPARATE HEADING, NOT MORE BULLETS UNDER THE ONE ABOVE. These
        # were raised in an EARLIER period and are still open; folding them in
        # would report old work as this week's, and the count of new tasks is
        # the thing an owner reads that list for. Already deduplicated by
        # `ledger.reconcile`, so nothing here was also stated above.
        if context.carried_tasks:
            add_heading(lines, "preventive_open")
            for task in context.carried_tasks[:MAX_LINES]:
                lines.append(f"{BULLET}{task.get('text', '')}".rstrip())
            extra = len(context.carried_tasks) - MAX_LINES
            if extra > 0:
                lines.append(f"{BULLET}and {extra} more.")
        return lines

    # ── 5. preventive ────────────────────────────────────────────────────────

    def _by_severity(self, groups: Sequence[Any]) -> List[Any]:
        """Worst first, stable within a rank.

        ⚠️ WITHOUT THIS, EMITTING SEVERITY CHANGES NOTHING. `aggregate.rank`
        orders by COST, which is right for the money section and leaves every
        unpriced group in arrival order — so a P2 maintenance finding rendered
        below a P4 one purely because its event arrived second. The catalog
        distinguishes them (PM-04 is P3, PM-08 is P4) and the report could not.
        Advising the operator to emit severity while ignoring it would have been
        advice with no effect.
        """
        return sorted(groups, key=lambda g: -severity_rank(
            self._text(g, "severity") or ""))

    def _preventive(self, context: ReportContext) -> List[str]:
        groups = self._by_severity(self._groups(context, "maintenance"))
        # ⚠️ BOTH SOURCES. `SECTION_FOR_KIND` sends FORECAST findings here, and
        # a section that reads only the aggregation would route them into
        # silence — the table naming a section that renders nothing is a
        # different failure from the table not naming them at all, and the
        # first cut had it.
        forecast = self._findings_for(context, "preventive")
        if not groups and not forecast:
            return []
        lines = [section_heading("preventive")]
        for group in self._top(groups):
            label = self._name(group)
            # ⚠️ THE MEASUREMENT, NOT JUST THE NAME. A live report printed
            # "- Pump short-cycling" and "- Pump power factor" — two bare
            # labels, saying only that something was flagged, while the events
            # carried `transition_count`, `max_transitions` and `deviation_pct`.
            # The maintenance blueprints emit no `detail` field at all; the
            # numbers ARE the detail, and the section was redundant with the
            # caretaker list above it until it printed them.
            said = self._detail(group) or self._measurement(group)
            lines.append(f"{BULLET}{label}: {said}" if said else f"{BULLET}{label}")
        for item in forecast[:MAX_LINES]:
            lines.append(self._finding_line(item))
        return lines + self._and_more(groups)

    # ── 6. trends ────────────────────────────────────────────────────────────

    def _trends(self, context: ReportContext) -> List[str]:
        """Drift, and the built-in modules' own findings.

        ⚠️ A TREND IS NOT A COST AND MUST NOT BE PRICED. `basis: trend` means a
        value moved against its own baseline; there is no kWh behind it, which
        is why `savings_total` excludes it and why it is stated here instead.
        """
        drifting = [g for g in self._groups(context, "roi")
                    if self._text(g, "basis") == "trend"]
        module_findings = self._findings_for(context, "trends")
        if not drifting and not module_findings:
            return []

        lines = [section_heading("trends", context.cadence)]
        for group in self._top(drifting):
            label = self._name(group)
            # ⚠️ THE NUMBER IF THERE IS ONE. A live report printed
            # "- Night standby: drifting" while the event carried
            # `deviation_pct: 26.9` — the word for the thing instead of the
            # measurement of it, which is the whole point of a trends section.
            said = self._detail(group) or self._measurement(group) or "drifting"
            lines.append(f"{BULLET}{label}: {said}")
        for item in module_findings[:MAX_LINES]:
            lines.append(self._finding_line(item))
        return lines

    # ── 0. standing state — the present tense, and the tablet's own list ─────

    def _standing(self, context: ReportContext) -> List[str]:
        """What is wrong RIGHT NOW, in the words the kiosk uses for it.

        ⚠️ THIS SECTION EXISTS SO THE TWO SURFACES CANNOT CONTRADICT EACH OTHER.
        Before it, a briefing could report nothing while the Cockpit listed four
        offline devices, because `ReportContext` had no live state and no
        facility record — see `standing.py`. The owner found that by comparing
        two screens, which is how every divergence in this subsystem has been
        found, and asked for it not to be possible.

        ⚠️ ITS TENSE IS THE WHOLE POINT AND IS SAID OUT LOUD. Every other
        section covers the PERIOD. A device that failed and recovered inside the
        window belongs to "what went wrong" and not here; one that failed before
        the window and is still down belongs here and not there. Both are
        correct and both read as a contradiction unless the reader is told which
        question was answered — so the heading carries the moment.

        ⚠️ GROUPED BY KIND, NOT RANKED. `MAX_LINES` truncation on a flat list
        would silently drop whichever kind sorted last, and "3 more" is a
        legitimate summary where "the alarms are missing" is not.
        """
        items = context.standing or []
        if not items:
            # ⚠️ SILENT WHEN CLEAN, and that is not the same as hiding it. The
            # headline already says whether anything is wrong, and a section
            # reading "nothing is wrong right now" in every healthy brief is the
            # line a reader learns to skip — taking the section with it.
            return []

        by_kind: Dict[str, List[Dict[str, Any]]] = {}
        for item in items:
            if isinstance(item, dict):
                by_kind.setdefault(str(item.get("kind") or ""), []).append(item)

        lines = [section_heading("standing")]
        for kind, label in KIND_HEADINGS:
            group = by_kind.get(kind) or []
            if not group:
                continue
            # ⚠️ THE GROUP IS NAMED OUT LOUD. It was already grouped by kind
            # internally and printed FLAT, so the reader saw four bullets with
            # the kind repeated on each — "LG webOS TV — Unavailable",
            # "Timmerflotte 2623 Temperature — Unavailable" — and no visible
            # structure. Asked for directly, with the wanted shape written out.
            # The label is not bulleted: it is not one of the things, it is what
            # they are, and the same rule the group note under `waiting` follows.
            shown = group[:MAX_LINES]
            lines.append(f"{_plural_label(label, len(group))}:")
            for entry in shown:
                where = str(entry.get("room") or "")
                what = str(entry.get("title") or "")
                detail = str(entry.get("detail") or label)
                # ⚠️ NOT REPEATED WHEN THE HEADING ALREADY SAYS IT. "Unavailable"
                # under "Unavailable device(s)" is the same word twice on one
                # line; "Open fault" under "Opened ticket(s)" is extra
                # information and stays. Containment either way decides, which
                # is what the owner's own worked example does.
                said = detail.strip().lower()
                heading_words = label.strip().lower()
                redundant = said in heading_words or heading_words in said
                tail = "" if redundant else f" — {detail}"
                lines.append(f"{BULLET}{what}{tail}"
                             + (f", {where}" if where else ""))
            if len(group) > len(shown):
                lines.append(f"{BULLET}and {len(group) - len(shown)} more")
        return lines

    # ── 7. monitoring health ─────────────────────────────────────────────────

    def _noise_lines(self, context: ReportContext) -> List[str]:
        """Rules that fire and are never acknowledged — the catalog's own rule.

        ⚠️ THE THRESHOLD IS PRINTED, NOT JUST APPLIED. "fired 23 times, never
        acknowledged" invites "so what?"; naming the bar the reader's own
        configuration sets makes the line a judgement they can disagree with.
        Units on both numbers, per `feedback_report-prose-rules`.

        ⚠️ THREE OUTCOMES AND THEY ARE NOT COLLAPSED. Rules found; asked and
        none found (silent, because a clean answer every week is noise of a
        different kind); and COULD NOT ASK, which is stated. The third is the
        one that matters: the collector's ring is bounded, so a busy property
        can hold fewer than `noise_window_days` of events, every count is then a
        floor, and a floor compared against a threshold reports the noisiest
        rules as fine. Silence there would be a counter reading 0 for the exact
        case it exists to measure — this project's most-repeated defect.
        """
        noise = context.noise or {}
        if not noise:
            return []
        days = int(noise.get("window_days") or 0)
        if not noise.get("known"):
            return [f"{BULLET}Alert noise could not be assessed — the event "
                    f"buffer does not reach back {days} days."]
        rules = noise.get("rules") or []
        out: List[str] = []
        for row in rules[:MAX_LINES]:
            if not isinstance(row, dict):
                continue
            fires = int(row.get("fires") or 0)
            acks = int(row.get("acks") or 0)
            label = str(row.get("label") or "").strip() or str(row.get("rule_id"))
            # ⚠️ TWO KINDS OF NOISE, TWO ACTIONS. "Nobody is responding" and
            # "responding is not stopping it" both mean retune-or-retire, but a
            # reader who has been ticking these off every week needs to be told
            # that the ticking is the evidence, not the fix.
            tail = (f"was never acknowledged"
                    if not acks else
                    f"was acknowledged {_plural(acks, 'time')} and kept firing")
            out.append(
                # ⚠️ `_plural` CARRIES THE COUNT. This read `fired {fires}
                # {_plural(fires, 'time')}` and rendered "fired 23 23 times".
                # The test asserted `"23 times" in body`, which the doubled
                # string satisfies — a weak substring assertion agreeing with a
                # broken line. Read the rendered output.
                f"{BULLET}{name_of(readable_label(label))} fired "
                f"{_plural(fires, 'time')} in {_plural(days, 'day')} and "
                f"{tail} — retune or retire it.")
        return out

    def _monitoring_health(self, context: ReportContext) -> List[str]:
        """Whether the monitoring itself is working.

        ⚠️ THIS IS WHERE A RULE THAT COULD NOT EVALUATE GOES — never into the
        savings total, and never silently nowhere. A property whose meters went
        quiet produces the same empty Money section as one that wasted nothing,
        and this is the only place that difference is stated.
        """
        # ⚠️ PREFLIGHT LEADS, and it belongs to THIS section rather than to
        # coverage. "The Energy dashboard's grid statistic is 404ing" is a fault
        # in the monitoring, not a limit of the property — and it EXPLAINS a
        # thin report, so burying it in the last section is how it goes unread
        # for months.
        lines: List[str] = list(self._preflight_lines(context))

        quality = self._findings_for(context, "health")
        for item in quality[:MAX_LINES]:
            lines.append(self._finding_line(item, fallback="not reporting"))

        # ⚠️ THE `audit` CATEGORY LIVES HERE AND USED TO LIVE NOWHERE. These are
        # the automation layer checking ITSELF — a critical rule found switched
        # off, an alert channel that did not answer its weekly test — which is
        # monitoring health by definition.
        for group in self._top(self._groups(context, "audit")):
            label = self._name(group)
            said = self._detail(group) or self._measurement(group)
            # ⚠️ WHICH ONE. See `_subjects` — this line is the reason it exists.
            who = self._subjects(group)
            body = f"{label}: {said}" if said else label
            lines.append(f"{BULLET}{body}" + (f" — {who}" if who else ""))

        lines.extend(self._noise_lines(context))

        # ⚠️ WHY THERE IS NO LINK, WHEN THE OWNER CAN FIX IT. See `links.reason`.
        why = links_mod.reason(
            (context.discovery.get("inventory") or {}).get("urls"),
            context.discovery.get("ingress_entry") or "")
        if why:
            lines.append(f"{BULLET}{why}")

        silent = context.collector.get("silent_types") or []
        if silent and context.collector.get("connected"):
            # ⚠️ NAME THEM. "1 category of automation alert produced nothing
            # this period" told a reader a count and left them unable to act on
            # it; the category is the whole content of the line. The hedge that
            # followed — "either a quiet period or rules that do not report; it
            # cannot tell which" — is honest and cost twenty words to say
            # "unknown", so it is now four.
            names = ", ".join(readable_label(str(t).replace("vesta_", "")
                                             .replace("_event", ""))
                              for t in silent[:3])
            lines.append(f"{BULLET}No {names} alerts this period — either "
                         f"nothing happened, or those rules do not report.")

        drift = (context.aggregated.get("schema_drift") or {})
        for entry in (drift.get("blueprints") or [])[:MAX_LINES]:
            if not isinstance(entry, dict):
                continue
            # ⚠️ CAPITALISED AT THE CALL SITE, NOT IN `readable_label`. A
            # blueprint FAMILY is a bare lowercase word ("critical") that
            # `readable_label` correctly returns untouched — it has no
            # separator to humanise — and it opens a sentence here. Doing it
            # inside the shared helper would turn a real label like "iPhone 16
            # Fab" into "IPhone 16 Fab".
            # ⚠️ A PARENTHESISED CATEGORY IS THE DRIFT ITSELF, AND IT USED TO
            # BE THE WHOLE ANSWER. `schema_drift` keys by blueprint where the
            # payload names one and falls back to the CATEGORY where it does
            # not — so a brief read "(critical) uses an older alert format",
            # naming one of thirteen rules and identifying none. The offending
            # events still carry a `report_bucket`, which is the operator's own
            # words for what the rule is; printing it turns an unactionable
            # line into a place to look.
            raw = readable_label(str(entry.get("blueprint") or "an automation"))
            name = raw[:1].upper() + raw[1:]
            # ⚠️ THE BUCKET LEADS AND THE CATEGORY FOLLOWS IN PARENTHESES.
            # Written the other way it read "(critical) — Pool pump schedule
            # uses an older alert format", which parses as a category doing the
            # using. The subject of the sentence is the rule, and the category
            # is the only thing left to qualify it with.
            buckets = [readable_label(str(b)) for b in (entry.get("buckets") or [])][:3]
            name = (f"{', '.join(name_of(b) for b in buckets)} {name}"
                    if buckets and not entry.get("named") else name_of(name))
            # ⚠️ FIELD NAMES ARE IDENTIFIERS TOO. This printed `entity_id (use
            # entities)` verbatim — the same defect as the rule id, one line
            # over, and the reason the whole sentence came out italic on a
            # platform that reads `_` as emphasis.
            fields = [readable_label(str(f)) for f in
                      (list(entry.get("missing") or []) + list(entry.get("legacy") or []))]
            # ⚠️ THE ACTION FIRST, THE REASSURANCE SECOND, AND BOTH SHORTER.
            # "Its findings are still counted; updating it would make them more
            # precise" is two clauses for one idea, in a section already dense
            # with them.
            lines.append(
                f"{BULLET}{name} uses an older alert format — still counted, "
                f"less precise. Update it to send: {', '.join(fields)}.")

        dropped = context.aggregated.get("events_dropped")
        if isinstance(dropped, int) and dropped > 0:
            lines.append(
                f"{BULLET}{_plural(dropped, 'alert')} could not be read and "
                f"{'was' if dropped == 1 else 'were'} left out.")

        lines.extend(self._skipped_lines(context))

        return ([section_heading("health")] + lines) if lines else []

    def _skipped_lines(self, context: ReportContext) -> List[str]:
        """Why checks did not run — GROUPED BY REASON, one line each.

        ⚠️ THIS WAS THREE LINES SAYING THE SAME TWENTY WORDS. A delivered brief
        carried "… did not run: covered by this property's own automation
        layer, which sees occupancy and cost context these checks cannot" three
        times over, one per check — sixty words to say one thing, in the
        section a reader is least likely to reach. Grouping keeps every fact
        and costs a third of the space.
        """
        by_reason: Dict[str, List[str]] = {}
        # ⚠️ ONE SHAPE OF SKIP GETS ITS OWN SUB-HEADING. "X did not run: covered
        # by Y, which has not reported since it was installed — check that rule"
        # is a sentence repeated verbatim on every line but the rule name, and
        # the brief carried three of them scattered among unrelated skips.
        # Asked for: group them, one bullet each, under one explanation.
        silent: List[Tuple[str, str]] = []
        for item in context.skipped:
            if not isinstance(item, dict):
                continue
            # ⚠️ QUOTED HERE, ONCE, FOR EVERY ARM BELOW. Reported: "Equipment
            # drawing more at rest did not run: your own automations already
            # cover this" — the check's NAME runs straight into the sentence, so
            # the reader cannot see where it ends. Worse, the "covered by" arm
            # quoted the BLUEPRINT and left the check beside it bare, on one
            # line. Three call sites printed this name and one of them had the
            # rule; building it quoted at its single source is what stops a
            # fourth from diverging.
            name = name_of(str(item.get("title") or "") or readable_label(
                str(item.get("module") or "a check")))
            # ⚠️ ON THE CODE, NEVER ON THE SENTENCE. `reason` below is prose and
            # is reworded whenever a reader complains; `code` is the contract.
            if str(item.get("code") or "") == "covered_but_silent":
                silent.append((name, str(item.get("detail")
                                         or item.get("reason") or "")))
                continue
            reason = str(item.get("detail") or item.get("reason")
                         or "no reason given")
            by_reason.setdefault(reason, []).append(name)

        out: List[str] = []
        for reason, names in list(by_reason.items())[:MAX_LINES]:
            if len(names) == 1:
                out.append(f"{BULLET}{names[0]} did not run: {reason}")
            else:
                out.append(f"{BULLET}{_plural(len(names), 'check')} did not "
                           f"run — {reason}: {', '.join(names)}")

        if silent:
            # ⚠️ THE FOURTH SITE, AND IT WAS CORRECT BY HAND. It wrote its own
            # blank line and always had — so it never produced the bug, and that
            # is exactly why it stayed invisible while three other sites were
            # fixed one at a time. A rule kept by four independent copies, three
            # of which have already failed it, is not a rule.
            add_heading(out, "waiting")
            for name, blueprint in silent[:MAX_LINES]:
                out.append(f"{BULLET}{name} — covered by {name_of(blueprint)}"
                           if blueprint else f"{BULLET}{name}")
            # ⚠️ NO BULLET. This is the group's EXPLANATION, not a member of
            # it — bulleted, it reads as a third check that did not run, and a
            # reader counting the list gets three where there are two. The
            # dateline sets the precedent: a line that is not a finding does not
            # carry the mark that means "finding".
            # ⚠️ THREE SENTENCES, ONE JOB EACH: what is not happening, what to
            # do, what happens if nobody does. The first attempt said "Each of
            # those rules is installed and has produced no event since. Check
            # them, or the check they stand in for runs by itself after 45
            # days" — reported as "very bad details, barely understandable",
            # and it was: "the check they stand in for" means the BUILT-IN
            # check while "they" are the blueprints, so the sentence inverts
            # what stands in for what, and nowhere does it say the plain fact
            # that these checks are not running.
            # ⚠️ WRITTEN OUT IN FULL PER NUMBER, NOT ASSEMBLED WORD BY WORD.
            # The first draft interpolated each clause ("it defers"/"each
            # defers", "that rule has"/"none of those rules has") and produced
            # "None of these checks is NOT running" and "that rule has ever
            # fired" — a double negative and a dropped "never", both of which
            # reverse the meaning, and neither of which any test could see. Two
            # literals cost one duplicated noun and cannot do that.
            out.append(
                (f"This check is not running: it defers to the rule beside it, "
                 f"and that rule has never fired. Check the rule works — after "
                 f"{BLUEPRINT_GRACE_DAYS} days with no event the check runs "
                 f"anyway.")
                if len(silent) == 1 else
                (f"None of these checks is running: each defers to the rule "
                 f"beside it, and none of those rules has ever fired. Check "
                 f"the rules work — after {BLUEPRINT_GRACE_DAYS} days with no "
                 f"event each check runs anyway."))
        return out

    def _coverage(self, context: ReportContext) -> List[str]:
        """⚠️ What this property cannot be asked about.

        Travels with the report rather than living in a developer's diagnostics
        panel, because it is the difference between a thin report and a
        dishonest one: an owner reading a summary with no mention of cost
        should be told that no tariff is configured, not left to assume energy
        was free.
        """
        if not context.discovery.get("reachable", False):
            return []
        lines: List[str] = []

        # ⚠️ THE COLLECTOR'S OWN GAP FIRST — it is the one that invalidates
        # everything above rather than merely narrowing it.
        watched = context.collector.get("blueprint_categories") or []
        if watched and not context.collector.get("connected"):
            lines.append(
                f"{BULLET}This property's own automation alerts were not "
                "being recorded for part of this period, so some findings may "
                "be missing.")

        missing = context.discovery.get("capabilities_missing") or []
        absent_voice = context.discovery.get("capability_absent") or {}
        for capability in missing:
            # ⚠️ Said ONCE — see `_explained`.
            if self._explained(context, capability):
                continue
            # ⚠️ THE ABSENT VOICE, never `capability_meaning` — that table says
            # what a capability ENABLES and reads as a statement of fact about
            # a property that does not have it.
            lines.append(f"{BULLET}{absent_voice.get(capability) or capability}")

        return ([section_heading("coverage")] + lines) if lines else []

    def _preflight_lines(self, context: ReportContext) -> List[str]:
        items = context.discovery.get("preflight") or []
        if not items:
            return []
        # No heading of its own — these are the first bullets under
        # "Monitoring health", which is what they are.
        # Critical first — a stale configuration explains an empty report, and
        # burying it under notices is how it goes unread for months.
        # ⚠️ NEGATED `severity_rank`, NOT A LOCAL TABLE. This was
        # `{"critical": 0, "warning": 1, "notice": 2}` — a fourth copy of the
        # order, descending, and silently missing "info" so an info item sorted
        # last by falling through to a default rather than by a decision.
        ranked = sorted(
            (i for i in items if isinstance(i, dict)),
            key=lambda i: -severity_rank(str(i.get("severity") or "")))
        return [f"{BULLET}{item.get('detail', '')}" for item in ranked]

    # ── reading the aggregation ──────────────────────────────────────────────
    #
    # ⚠️ THROUGH ACCESSORS, NEVER BY ATTRIBUTE. `aggregated` arrives as a dict
    # of `aggregate.Group` objects on the live path and as plain dicts from a
    # stored history entry or a test fixture, and a renderer that reaches for
    # `group.total_cost` works in one and raises in the other. A narrator that
    # raises takes the whole report down (see `narrate/base.py`), so every read
    # here tolerates both shapes.

    @staticmethod
    def _explained(context: ReportContext, capability: str) -> bool:
        """Has a preflight item already accounted for this capability?

        ⚠️ ONE OWNER FOR THIS QUESTION. Two sections need it — Money, to decide
        whether to restate why it cannot price anything, and Coverage, to decide
        whether to list the capability at all — and a missing tariff said in
        both places, in slightly different words, is the exact repetition this
        guards against.
        """
        return any(
            isinstance(item, dict) and str(item.get("capability")) == capability
            for item in (context.discovery.get("preflight") or []))

    @staticmethod
    @staticmethod
    def _verified_tail(item: Dict[str, Any]) -> str:
        """The evidence clause of a verification, if it has one.

        ⚠️ SPLIT ON THE SENTENCE THE RENDERER DID NOT WRITE. `verify._detail`
        composes "reported N times, last on D. <evidence>, and it has not
        recurred since." — the second sentence is identical across every line in
        a period where one person closed everything, which is the common case.
        Matching on the punctuation rather than the words means rewording the
        evidence (as v2.587.0 did) cannot silently stop the hoisting.
        """
        detail = str(item.get("detail") or "")
        head, sep, tail = detail.partition(". ")
        return f". {tail}" if sep and tail else ""

    @staticmethod
    def _finding_line(item: Dict[str, Any], fallback: str = "") -> str:
        """One module finding. ⚠️ CARRIES `area`, which the first cut dropped.

        It is the only field that says WHERE, so without it two identically
        named devices in different rooms render as the same line — and `ref` is
        deliberately opaque, so the reader has nothing else to tell them apart.
        """
        label = str(item.get("label") or item.get("ref") or "unnamed")
        area = str(item.get("area") or "")
        where = f" ({area})" if area else ""
        detail = str(item.get("detail") or fallback)
        # ⚠️ THE WINDOW TRAVELS WITH THE FINDING, BECAUSE IT IS NOT THE REPORT'S.
        # A module reads `min_history_days` (14) whatever the cadence, since a
        # baseline cannot be built from one day — so a DAILY brief can carry a
        # fourteen-day finding, and until this line it presented one under a
        # heading reading "today". The reader was being handed a number and a
        # period that did not belong to each other, which is the one thing the
        # owner asked to be guaranteed against.
        span = item.get("window_days")
        over = (f" — measured over {_plural(int(span), 'day')}"
                if isinstance(span, (int, float)) and not isinstance(span, bool)
                and int(span) > 1 else "")
        return f"{BULLET}{label}{where}: {detail}{over}".rstrip(": ")

    def _findings_for(self, context: ReportContext, section: str) -> List[Dict[str, Any]]:
        """Module findings this section owns, by KIND.

        ⚠️ AN UNKNOWN KIND FALLS TO `trends` RATHER THAN NOWHERE. A finding with
        a kind this renderer has never heard of is still a finding somebody's
        module produced, and dropping it is exactly the failure `SECTION_FOR_KIND`
        exists to prevent.
        """
        out: List[Dict[str, Any]] = []
        for item in context.findings:
            if not isinstance(item, dict):
                continue
            if SECTION_FOR_KIND.get(str(item.get("kind")), "trends") == section:
                out.append(item)
        return out

    def _list(self, context: ReportContext, key: str) -> List[Any]:
        value = context.aggregated.get(key)
        return list(value) if isinstance(value, (list, tuple)) else []

    def _groups(self, context: ReportContext, category: str) -> List[Any]:
        return [g for g in self._list(context, "groups")
                if self._text(g, "category") == category]

    def _savings(self, context: ReportContext) -> Dict[str, Any]:
        value = context.aggregated.get("savings")
        return value if isinstance(value, dict) else {}

    def _name(self, group: Any, alert: bool = False) -> str:
        """What to call this group. The ONE answer, with its exception named.

        ⚠️ TWO ORDERINGS EXISTED AND THE REASON LIVED NOWHERE IN THE CODE.
        Four sections read `bucket or label`; `_incident_line` read
        `label or bucket`, and that difference is deliberate — for a critical
        alert `label` is the human alert name the operator wrote ("Water leak")
        while `report_bucket` only groups its instances, so the recap must
        prefer it. The reason was recorded in a test docstring and a commit
        message and in neither of the five sites, which is the shape
        /dry-audit's "check WHY the copies differ" section is about: a rule
        that exists twice in prose and nowhere in code.

        A caller now gets the exception by CHOOSING `alert=True`, not by
        remembering to reverse two operands.

        ⚠️ AND IT HUMANISES WHAT IT RETURNS. A blueprint may send an
        IDENTIFIER as its label — one on the reference villa sends
        `critical_schedule---pool_pump` — and this is the single place every
        section reads a name from, so it is the only place that fix reaches all
        of them. `readable_label` leaves anything containing a space exactly as
        it arrived, so a real label is never rewritten.
        """
        first, second = ("label", "bucket") if alert else ("bucket", "label")
        return readable_label(self._text(group, first) or self._text(group, second))

    def _items(self, group: Any) -> List[Any]:
        """A group's members, whether it is a `Group` object or a plain dict.

        ⚠️ WRITTEN THREE TIMES BEFORE THIS EXISTED — in `_measurement`,
        `_detail` and `_runtime`. Same tolerance rule as the other accessors
        here: the live path hands the renderer `aggregate.Group` objects and a
        stored history entry hands it dicts, and a narrator that raises takes
        the whole report down.
        """
        items = (group.get("items") if isinstance(group, dict)
                 else getattr(group, "items", None)) or []
        return list(items) if isinstance(items, (list, tuple)) else []

    @staticmethod
    def _text(group: Any, name: str) -> str:
        if isinstance(group, dict):
            return str(group.get(name) or "")
        return str(getattr(group, name, "") or "")

    @staticmethod
    def _number(group: Any, name: str) -> Any:
        value = group.get(name) if isinstance(group, dict) else getattr(group, name, None)
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    @staticmethod
    def _is_open(group: Any) -> bool:
        value = (group.get("open_incident") if isinstance(group, dict)
                 else getattr(group, "open_incident", False))
        return bool(value)

    @staticmethod
    def _count(group: Any) -> int:
        value = (group.get("occurrences") if isinstance(group, dict)
                 else getattr(group, "occurrences", 1))
        return int(value) if isinstance(value, int) else 1

    def _runtime(self, group: Any) -> str:
        """`runtime_hours`, the one duration `total_minutes` does not carry.

        `roi_runtime_cap` reports hours run rather than minutes wasted, so the
        aggregation's minute total is empty for it and the figure is on the
        event.
        """
        total = 0.0
        for item in self._items(group):
            data = (item.get("data") if isinstance(item, dict)
                    else getattr(item, "data", None)) or {}
            value = data.get("runtime_hours") if isinstance(data, dict) else None
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                total += float(value)
            elif isinstance(value, str):
                try:
                    total += float(value)
                except ValueError:
                    pass
        return f"{total:g} hours run" if total else ""

    def _unit_of(self, group: Any) -> str:
        """What the entities behind this group are measured in, if they agree.

        ⚠️ ONLY WHERE THEY AGREE. A group covering a pump's power sensor and its
        power-factor sensor has two units, and picking the first would label
        every number with one of them. Ambiguity prints nothing, which is the
        old behaviour and is honest; a wrong unit is worse than none.
        """
        units = {self._units.get(e, "") for e in
                 (getattr(group, "entities", None) or [])}
        units.discard("")
        return units.pop() if len(units) == 1 else ""

    def _measurement(self, group: Any) -> str:
        """The numbers a blueprint measured, in the order it supplied them.

        ⚠️ HUMANISED, NEVER TRANSLATED. `deviation_pct` prints as
        "deviation pct 26.9" rather than being mapped to a phrase, because a
        phrase table is per-blueprint knowledge that goes stale the day a mode
        is added — and a slightly stiff true sentence beats a fluent one about
        the wrong field.
        """
        for item in self._items(group):
            data = (item.get("data") if isinstance(item, dict)
                    else getattr(item, "data", None)) or {}
            if not isinstance(data, dict):
                continue
            unit = self._unit_of(group)
            # ⚠️ A BOUND IS NOT A MEASUREMENT, AND PRINTING IT AS ONE WAS
            # REPORTED AS UNREADABLE. `{transition_count: 7, max_transitions: 6}`
            # rendered as "7 transitions, max 6 transitions" — two readings of
            # the same thing, one of them mysteriously smaller, when the second
            # is the LIMIT the first one broke. Asked directly: "i don't get
            # what this means". A `max_`/`min_` prefix naming the same noun as a
            # measurement is a general shape, not per-blueprint knowledge, so
            # pairing them needs no phrase table — see this method's own rule.
            measured: Dict[str, Any] = {}
            bounds: Dict[str, Any] = {}
            for key, value in data.items():
                if key in NON_MEASUREMENT_KEYS or value in (None, "", [], {}):
                    continue
                if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                    continue
                (bounds if str(key).startswith(("max_", "min_")) else
                 measured)[str(key)] = value
            parts: List[str] = []
            for key, value in measured.items():
                text = _phrase(key, value, unit)
                bound_key, bound = _bound_for(key, bounds)
                if bound is not None:
                    bounds.pop(bound_key, None)
                    word = "limit" if bound_key.startswith("max_") else "minimum"
                    text = f"{text} ({word} {bound})"
                parts.append(text)
            # A bound with nothing to attach to still beats dropping it.
            parts.extend(_phrase(k, v, unit) for k, v in bounds.items())
            if parts:
                return ", ".join(parts[:3])
        return ""

    def _subjects(self, group: Any, limit: int = 3) -> str:
        """The equipment this group is about, named the way a person names it.

        ⚠️ THE FINDING WITHOUT ITS SUBJECT IS NOT A FINDING. A delivered brief
        read "Critical automation health: critical automation off" and the owner
        asked, reasonably, which automation — and neither the notification nor I
        could answer from it. The event had carried
        `entities: ["automation.outdoor_unified_doorbell_call_and_unlock"]` the
        whole time and `Group.entities` had been exposing it since the module
        was written; nothing called it.

        ⚠️ THROUGH `labels`, NEVER THE RAW ID. That automation's display name is
        `critical_doorbell---parking_gate` — it IS one of this villa's critical
        rules, and its entity_id is a stale slug from before it was renamed, so
        the id is the single form in which the word "critical" is invisible.
        Answering "which one?" with the id would name it in the way least likely
        to be recognised, which is the mistake I made answering by hand.

        ⚠️ CAPPED, AND THE REMAINDER COUNTED. A sweep can name twenty entities
        and a notification that lists twenty is one nobody reads to the end.
        """
        # ⚠️ `prettify_entity_slug`, NOT `readable_label`, FOR THE FALLBACK.
        # The latter humanises the underscores and keeps the domain, giving
        # "Automation.outdoor unified doorbell call and unlock" — a name with a
        # stray dot in the middle. The kiosk's own fallback drops the domain and
        # title-cases the rest, which is what `display_label` does when Home
        # Assistant has no friendly name either, so both surfaces degrade the
        # same way rather than two different ways.
        # ⚠️ AND `readable_label` WRAPS THE HA NAME, NOT ONLY THE FALLBACK
        # (2.601.0). The comment above explains why the FALLBACK is
        # `prettify_entity_slug`; nothing humanised the branch that actually
        # fires, because "Home Assistant supplied it" was treated as "it is
        # prose". It is not: this villa's automations are NAMED
        # `critical_doorbell---parking_gate`, so the friendly name IS an
        # identifier and arrived verbatim. `inert()` then turned the
        # underscores into spaces at the delivery boundary and left the `---`,
        # producing "critical doorbell---parking gate" — half-humanised by a
        # function whose job is markup safety, not readability, which is why it
        # read as a bug rather than a missing rule. `readable_label` returns
        # anything containing a space exactly as it arrived, so a real label is
        # never rewritten.
        names = [readable_label(self._labels.get(e) or "") or prettify_entity_slug(e)
                 for e in (getattr(group, "entities", None) or [])]
        if not names:
            return ""
        # ⚠️ QUOTED. "Critical automation health: critical automation off —
        # critical doorbell---parking gate" runs a rule NAME into the prose
        # around it with nothing to say where one stops and the other starts.
        # `style.name_of` owns the quoting for every site that names a rule —
        # see its docstring for why apostrophes and not brackets.
        marked = [name_of(name) for name in names]
        if len(marked) <= limit:
            return ", ".join(marked)
        return f"{', '.join(marked[:limit])} and {len(marked) - limit} more"

    def _detail(self, group: Any) -> str:
        for item in self._items(group):
            text = self._text(item, "detail")
            if text:
                return text
        return ""

    @staticmethod
    def _duration(minutes: float) -> str:
        if minutes < 60:
            return _plural(int(round(minutes)), "minute")
        hours = minutes / 60.0
        if hours < 24:
            return f"{hours:.1f} hours".replace(".0 ", " ")
        return f"{hours / 24:.1f} days".replace(".0 ", " ")

    @staticmethod
    def _top(groups: Sequence[Any]) -> Sequence[Any]:
        return groups[:MAX_LINES]

    @staticmethod
    def _and_more(groups: Sequence[Any]) -> List[str]:
        extra = len(groups) - MAX_LINES
        return [f"{BULLET}and {extra} more."] if extra > 0 else []
