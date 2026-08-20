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
  meter that consumed nothing. There is no "0 kWh" here for an absent reading.

  PLAIN TEXT, NO MARKUP. `deliver.py` sends the intersection of what notify
  platforms accept. Asterisks would render literally on the ones that do not
  parse them, and the moment this file knows which platform it is writing for,
  delivery has a platform table in it.

⚠️ NOTHING VILLA-SPECIFIC. Every name, count and id in the output comes from
the context it was handed. There is no example device, no seeded threshold and
no sample sentence with a room in it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Tuple

from .base import ReportContext

#: Human wording for a cadence, in the possessive form the title uses.
PERIOD_WORD = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}

#: How an audience is addressed. Owner gets the property; facility gets the
#: work. Both read the same facts.
AUDIENCE_WORD = {"owner": "property brief", "facility": "facility brief"}


class DeterministicNarrator:
    """Renders a report with no network, no provider and no dependencies."""

    name = "deterministic"

    def render(self, context: ReportContext) -> Tuple[str, str]:
        title = self._title(context)
        lines: List[str] = []

        lines.extend(self._headline(context))

        findings = context.findings
        if findings:
            lines.append("")
            lines.extend(self._findings(findings))
        else:
            lines.append("")
            lines.append(self._nothing_to_report(context))

        preflight = self._preflight(context)
        if preflight:
            lines.append("")
            lines.extend(preflight)

        blind = self._blind_spots(context)
        if blind:
            lines.append("")
            lines.extend(blind)

        if context.skipped:
            lines.append("")
            lines.extend(self._skipped(context.skipped))

        return title, "\n".join(lines).strip()

    # ── pieces ───────────────────────────────────────────────────────────────

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

    def _headline(self, context: ReportContext) -> List[str]:
        discovery = context.discovery
        if not discovery.get("reachable", False):
            # The one case where there is nothing else honest to say.
            reason = str(discovery.get("error") or "reason unknown")
            return [
                "Home Assistant could not be reached while preparing this "
                "report, so nothing could be measured.",
                f"Reason: {reason}",
            ]
        capabilities = discovery.get("capabilities") or []
        return [
            f"Prepared {self._when(context.generated_at)}.",
            f"{len(capabilities)} of {len(capabilities) + len(discovery.get('capabilities_missing') or [])}"
            f" kinds of analysis are available on this property.",
        ]

    def _nothing_to_report(self, context: ReportContext) -> str:
        """⚠️ THE SENTENCE THAT KEEPS AN EMPTY REPORT HONEST, and it must say
        which KIND of empty this is. There are three, and they mean different
        things:

          nothing could be measured   — Home Assistant was unreachable
          nothing is configured       — no checks exist to run (Phase 2)
          checks ran and found nothing — the good outcome

        This returned the SECOND sentence in all three cases for one release,
        so the first live run against real meters reported "no automated checks
        are configured yet" about a property where a check had just run and
        found nothing. Grammatical, plausible, and false — the same failure as
        the blind-spot section asserting a tariff was configured.

        None of them may read as "everything is fine": that is a conclusion,
        and only the third has drawn anything at all.
        """
        if not context.discovery.get("reachable", False):
            return ("No checks ran, because Home Assistant could not be "
                    "reached.")
        if context.ran:
            count = len(context.ran)
            return (f"{count} check{'' if count == 1 else 's'} ran and found "
                    f"nothing worth reporting this period.")
        if context.skipped:
            return ("No checks ran this period — see the reasons below.")
        return ("No automated checks are configured yet, so nothing has been "
                "assessed. This report confirms the schedule and delivery are "
                "working.")

    def _findings(self, findings: List[Dict[str, Any]]) -> List[str]:
        # "1 finding(s)" is machine output. This is read by the villa's owner
        # every week, and the sloppiness costs nothing to fix and something to
        # leave.
        count = len(findings)
        lines = [f"{count} finding{'' if count == 1 else 's'}:"]
        for item in findings:
            label = str(item.get("label") or item.get("ref") or "unnamed")
            severity = str(item.get("severity") or "info")
            detail = str(item.get("detail") or "")
            area = str(item.get("area") or "")
            where = f" ({area})" if area else ""
            lines.append(f"- [{severity}] {label}{where}: {detail}".rstrip(": "))
        return lines

    def _preflight(self, context: ReportContext) -> List[str]:
        items = context.discovery.get("preflight") or []
        if not items:
            return []
        # Critical first — a stale configuration explains an empty report, and
        # burying it under notices is how it goes unread for months.
        order = {"critical": 0, "warning": 1, "notice": 2}
        ranked = sorted(
            (i for i in items if isinstance(i, dict)),
            key=lambda i: order.get(str(i.get("severity")), 9))
        lines = ["Needs attention:"]
        for item in ranked:
            lines.append(f"- {item.get('detail', '')}")
        return lines

    def _blind_spots(self, context: ReportContext) -> List[str]:
        """⚠️ What this property cannot be asked about.

        Travels with the report rather than living in a developer's diagnostics
        panel, because it is the difference between a thin report and a
        dishonest one: an owner reading a summary with no mention of cost
        should be told that no tariff is configured, not left to assume energy
        was free.
        """
        missing = context.discovery.get("capabilities_missing") or []
        absent_voice = context.discovery.get("capability_absent") or {}
        if not missing or not context.discovery.get("reachable", False):
            return []

        # ⚠️ Said ONCE. A preflight item may name the capability it accounts
        # for; that capability is dropped here, so a missing tariff appears
        # under "needs attention" (where it is actionable) rather than there
        # AND again in slightly different words two lines later.
        explained = {
            str(item.get("capability"))
            for item in (context.discovery.get("preflight") or [])
            if isinstance(item, dict) and item.get("capability")
        }
        remaining = [c for c in missing if c not in explained]
        if not remaining:
            return []

        lines = ["Not covered by this report:"]
        for capability in remaining:
            # ⚠️ THE ABSENT VOICE, never `capability_meaning` — that table says
            # what a capability ENABLES and reads as a statement of fact about
            # a property that does not have it.
            lines.append(f"- {absent_voice.get(capability) or capability}")
        return lines

    def _skipped(self, skipped: List[Dict[str, str]]) -> List[str]:
        lines = ["Checks that did not run:"]
        for item in skipped:
            name = item.get("module", "a check")
            reason = item.get("reason", "no reason given")
            lines.append(f"- {name}: {reason}")
        return lines
