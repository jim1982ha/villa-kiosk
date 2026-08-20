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

⚠️ THE EIGHT SECTIONS ARE THE WORKBOOK'S, AND A SECTION IS SKIPPED ONLY WHEN IT
HAS NOTHING TO SAY *AND* NOTHING TO ADMIT. Those are different conditions: a
Money section with no priced findings is omitted, but a Money section on a
property with no tariff configured is REPLACED BY THE ADMISSION, because its
silence would otherwise read as "nothing was wasted".

⚠️ NO CURRENCY SYMBOL ANYWHERE. `cost_local` is in the operator's own currency,
chosen per blueprint instance; the amount is printed bare. Guessing a symbol
from a locale the add-on cannot see is how a report claims dollars about a
figure computed in rupiah.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Sequence, Tuple

from ..contracts import severity_rank
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
SECTIONS_FOR = {
    "owner": ("critical", "money", "fixed", "preventive", "trends", "health",
              "coverage"),
    "facility": ("critical", "fixed", "preventive", "trends", "health",
                 "coverage"),
}
#: An unknown audience gets everything rather than nothing: a missing section is
#: invisible, and this subsystem's rule is that absence must never be silent.
ALL_SECTIONS = ("critical", "money", "fixed", "preventive", "trends", "health",
                "coverage")

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


def _amount(value: float) -> str:
    """A cost, with no currency symbol — see the module docstring."""
    return f"{value:,.0f}" if abs(value) >= 100 else f"{value:,.2f}"


class DeterministicNarrator:
    """Renders a report with no network, no provider and no dependencies."""

    name = "deterministic"

    def render(self, context: ReportContext) -> Tuple[str, str]:
        title = self._title(context)
        lines: List[str] = list(self._headline(context))

        wanted = SECTIONS_FOR.get(context.audience, ALL_SECTIONS)
        builders = {
            "critical": self._critical_recap,
            "money": self._money,
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

        for name in wanted:
            block = builders[name](context)
            if block:
                lines.append("")
                lines.extend(block)

        return title, "\n".join(lines).strip()

    def _found_anything(self, context: ReportContext) -> bool:
        """Did this report actually find something to say?

        Deliberately NOT "did any section render" — an admission renders, and
        admitting you could not measure something is the opposite of finding it.
        """
        return bool(self._list(context, "groups")
                    or context.findings
                    or self._list(context, "tasks"))

    # ── framing ──────────────────────────────────────────────────────────────

    def _title(self, context: ReportContext) -> str:
        period = PERIOD_WORD.get(context.cadence, "Property")
        audience = AUDIENCE_WORD.get(context.audience, "brief")
        return f"{period} {audience} — {context.period}"

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

        lines = [f"Prepared {self._when(context.generated_at)}."]

        savings = self._savings(context)
        total = savings.get("total")
        if isinstance(total, (int, float)) and savings.get("groups"):
            mix = savings.get("basis_mix") or {}
            estimated = int(mix.get("estimated", 0))
            qualifier = ""
            if estimated:
                qualifier = (f", {estimated} of them estimated rather than "
                             f"metered")
            lines.append(
                f"Avoidable cost identified: {_amount(float(total))}, across "
                f"{_plural(int(savings['groups']), 'finding')}{qualifier}.")

        if context.findings:
            # ⚠️ READABLE ENGLISH, NOT "1 finding(s)". This is read by the
            # villa's owner every week and the sloppiness costs nothing to fix.
            lines.append(f"{_plural(len(context.findings), 'finding')} from "
                         f"this property's own checks.")

        incidents = self._groups(context, "critical")
        if incidents:
            still_open = [g for g in incidents if self._is_open(g)]
            if still_open:
                lines.append(
                    f"{_plural(len(still_open), 'critical alert')} from this "
                    f"period {'is' if len(still_open) == 1 else 'are'} still "
                    f"unresolved.")
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
        lines = ["What went wrong:"]
        for group in self._top(groups):
            lines.append(f"- {self._incident_line(group)}")
        return lines + self._and_more(groups)

    def _incident_line(self, group: Any) -> str:
        """One incident, with whether it ENDED — which is the whole point.

        ⚠️ A duration is printed only when both ends were seen. The blueprints
        emit `raised` and `cleared` with no incident id, so an unmatched raise
        has no honest duration and gets "still unresolved" instead of a number.
        """
        label = self._text(group, "label") or self._text(group, "bucket")
        count = self._count(group)
        opened = self._is_open(group)
        minutes = self._number(group, "duration_minutes")

        parts: List[str] = [label]
        if count > 1:
            parts.append(f"({_plural(count, 'time')})")
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
        if "energy_cost" in (context.discovery.get("capabilities_missing") or []):
            # ⚠️ THE SECTION STAYS AND THE REASON MOVES. Two rules pull opposite
            # ways here: the admission must exist, or Money's silence reads as
            # "nothing was wasted" — and a missing tariff must be SAID ONCE, or
            # it appears here and again under monitoring health in slightly
            # different words. So when preflight already explains it, this
            # points at that instead of restating it.
            if self._explained(context, "energy_cost"):
                return ["Avoidable cost:",
                        "- Not calculated — see monitoring health below."]
            return ["Avoidable cost:",
                    "- Not calculated. No electricity tariff is configured, so "
                    "waste can be identified but not priced."]

        priced = [g for g in self._groups(context, "roi")
                  if self._number(g, "total_cost") is not None]
        if not priced:
            return []

        lines = ["Avoidable cost, most expensive first:"]
        for group in self._top(priced):
            cost = self._number(group, "total_cost")
            basis = self._text(group, "basis")
            label = self._text(group, "bucket") or self._text(group, "label")
            note = ""
            if basis == "estimated":
                note = " (estimated from an assumed load, not metered)"
            elif basis == "measured":
                note = " (metered)"
            kwh = self._number(group, "total_kwh")
            energy = f", {kwh:.2f} kWh" if kwh is not None else ""
            lines.append(
                f"- {label}: {_amount(float(cost or 0.0))}{energy}{note}")
        return lines + self._and_more(priced)

    # ── 4. fixed and suggested ───────────────────────────────────────────────

    def _fixed_and_suggested(self, context: ReportContext) -> List[str]:
        """What closed by itself, and what somebody has been asked to do.

        ⚠️ THE TASKS ARE REPORTED, NOT CREATED. Nine blueprints call
        `todo.add_item` beside their event; this says what they raised. The
        report never writes to the caretaker list or the Facility Manager
        store — reconciling the two is Phase B, and a report generator that
        mutates the record it reports on is one nobody can trust.
        """
        resolved = [g for g in self._groups(context, "critical")
                    if not self._is_open(g)]
        tasks = self._list(context, "tasks")
        # ⚠️ AND THE VERIFICATION FINDINGS ROUTED HERE — see `_preventive`.
        verified = self._findings_for(context, "fixed")
        if not resolved and not tasks and not verified:
            return []

        lines: List[str] = []
        for item in verified[:MAX_LINES]:
            lines.append(self._finding_line(item))
        if resolved:
            lines.append(
                f"Resolved without intervention: "
                f"{_plural(len(resolved), 'alert')}.")
        if tasks:
            lines.append("Raised for the caretaker:")
            for task in tasks[:MAX_LINES]:
                if isinstance(task, dict):
                    where = str(task.get("bucket") or "").strip()
                    text = str(task.get("text") or "").strip()
                    lines.append(f"- {text}" + (f" ({where})" if where else ""))
            if len(tasks) > MAX_LINES:
                lines.append(f"- and {len(tasks) - MAX_LINES} more.")
        return lines

    # ── 5. preventive ────────────────────────────────────────────────────────

    def _preventive(self, context: ReportContext) -> List[str]:
        groups = self._groups(context, "maintenance")
        # ⚠️ BOTH SOURCES. `SECTION_FOR_KIND` sends FORECAST findings here, and
        # a section that reads only the aggregation would route them into
        # silence — the table naming a section that renders nothing is a
        # different failure from the table not naming them at all, and the
        # first cut had it.
        forecast = self._findings_for(context, "preventive")
        if not groups and not forecast:
            return []
        lines = ["Maintenance signals:"]
        for group in self._top(groups):
            label = self._text(group, "bucket") or self._text(group, "label")
            detail = self._detail(group)
            lines.append(f"- {label}: {detail}" if detail else f"- {label}")
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

        lines = ["Trends:"]
        for group in self._top(drifting):
            label = self._text(group, "bucket") or self._text(group, "label")
            lines.append(f"- {label}: {self._detail(group) or 'drifting'}")
        for item in module_findings[:MAX_LINES]:
            lines.append(self._finding_line(item))
        return lines

    # ── 7. monitoring health ─────────────────────────────────────────────────

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

        silent = context.collector.get("silent_types") or []
        if silent and context.collector.get("connected"):
            lines.append(
                f"- {_plural(len(silent), 'category')} of automation alert "
                f"produced nothing this period. That is either a quiet period "
                f"or rules that do not report; it cannot tell which.")

        drift = (context.aggregated.get("schema_drift") or {})
        for entry in (drift.get("blueprints") or [])[:MAX_LINES]:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("blueprint") or "an automation")
            fields = list(entry.get("missing") or []) + list(entry.get("legacy") or [])
            lines.append(
                f"- {name} reports in an older format ({', '.join(fields)}). "
                f"Its findings are still counted; updating it would make them "
                f"more precise.")

        dropped = context.aggregated.get("events_dropped")
        if isinstance(dropped, int) and dropped > 0:
            lines.append(
                f"- {_plural(dropped, 'alert')} could not be read and "
                f"{'was' if dropped == 1 else 'were'} left out.")

        lines.extend(self._skipped_lines(context))

        return (["Monitoring health:"] + lines) if lines else []

    def _skipped_lines(self, context: ReportContext) -> List[str]:
        out: List[str] = []
        for item in context.skipped[:MAX_LINES]:
            if not isinstance(item, dict):
                continue
            name = item.get("module", "a check")
            detail = item.get("detail") or item.get("reason", "no reason given")
            out.append(f"- {name} did not run: {detail}")
        return out

    # ── 8. coverage ──────────────────────────────────────────────────────────

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
                "- This property's own automation alerts were not being "
                "recorded for part of this period, so some findings may be "
                "missing.")

        missing = context.discovery.get("capabilities_missing") or []
        absent_voice = context.discovery.get("capability_absent") or {}
        for capability in missing:
            # ⚠️ Said ONCE — see `_explained`.
            if self._explained(context, capability):
                continue
            # ⚠️ THE ABSENT VOICE, never `capability_meaning` — that table says
            # what a capability ENABLES and reads as a statement of fact about
            # a property that does not have it.
            lines.append(f"- {absent_voice.get(capability) or capability}")

        return (["Not covered by this report:"] + lines) if lines else []

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
        return [f"- {item.get('detail', '')}" for item in ranked]

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
        return f"- {label}{where}: {detail}".rstrip(": ")

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

    def _detail(self, group: Any) -> str:
        items = (group.get("items") if isinstance(group, dict)
                 else getattr(group, "items", None)) or []
        for item in items:
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
        return [f"- and {extra} more."] if extra > 0 else []
