"""The vocabulary shared by the reports backend and the SPA.

⚠️ THIS FILE HAS A TWIN: `src/reports/reportsTypes.ts`. Every tuple below is a
union type there, and `tests/py/test_contract_parity.py` FAILS THE BUILD if the
two disagree — in either direction, including a value added to only one side.

That test is the whole reason this file is a flat list of string tuples rather
than `enum.Enum`. An Enum is nicer Python and cannot be compared to a
TypeScript union without reimplementing half of it; the parity check is worth
more than the ergonomics, because the failure it prevents is silent. A backend
that emits `"critical"` against a frontend whose union stops at `"warning"`
does not crash — it renders an unstyled severity, or drops the finding, on a
tablet nobody is looking at.

⚠️ VALUES ARE PART OF THE STORED DOCUMENT. `reports-history.json` persists
these strings, so RENAMING one is a data migration, not a refactor: old entries
keep the old spelling forever. Add new values; do not repurpose existing ones.

CONTRACT_VERSION exists so a future migration can tell which spelling a stored
document uses. Bump it when a value's MEANING changes, never for an addition.

Imports nothing, by design — see the layering note in `__init__.py`.
"""

from __future__ import annotations

from typing import Dict, Final, Tuple

CONTRACT_VERSION: Final[int] = 1

# How loud a finding is. Ordered least to most urgent; the order is meaningful
# (report sections sort by it) so INSERT IN PLACE rather than appending.
#
# There is deliberately no "debug" level. Everything here is written to be read
# by the villa's owner, not by whoever wrote the module.
SEVERITY: Final[Tuple[str, ...]] = ("info", "notice", "warning", "critical")


def severity_rank(severity: str) -> int:
    """How loud, as a number. The ONE reader of `SEVERITY`'s order.

    ⚠️ THE COMMENT ABOVE PROMISED SOMETHING THE CODE COULD NOT DELIVER. It says
    the order is meaningful and to "INSERT IN PLACE rather than appending" — but
    two consumers had each hardcoded their own copy of it (`pipeline`'s
    `rank = {"info": 0, ...}` dict and `aggregate`'s `_SEVERITY_ORDER` tuple),
    so inserting a level here would have left both stale and the instruction was
    unfollowable as written. Found by /dry-audit 2026-08-21; the second copy was
    added the same day, which is how fast this shape reappears.

    An unknown value ranks lowest rather than raising: severity arrives from
    blueprint payloads and stored history, and a typo in one event must not take
    down the report that would have told you about it.
    """
    try:
        return SEVERITY.index(severity)
    except ValueError:
        return 0

# Who a report is written for. These are AUDIENCES, not roles: they choose
# which modules run and how the prose is pitched, and they intentionally do not
# map one-to-one onto `auth/permissions.ts` profiles — the owner may perfectly
# well read the facility brief.
AUDIENCE: Final[Tuple[str, ...]] = ("owner", "facility")

# Who a schedule is FOR — the app's own sign-in profiles, which is a different
# question from the one above and answers both halves of a briefing: the people
# table says where a profile is reached, `people.AUDIENCE_OF_ROLE` says which
# AUDIENCE it is written for. Two profiles map to the owner voice, which is
# exactly why the two vocabularies may not be merged.
#
# ⚠️ DELIBERATELY NOT IN `CONTRACT_SETS`, AND THAT IS NOT AN OVERSIGHT. Every
# other tuple here is mirrored in `src/reports/reportsTypes.ts`; this one's
# TypeScript twin is `src/auth/roles.ts`'s `ROLE_ORDER`, which has held the
# app's profiles since long before this subsystem existed. Registering it would
# demand a SECOND list of profiles in `reportsTypes.ts` for the parity test to
# compare against — a third copy of a fact, created by the machinery that exists
# to stop copies drifting. `supervisor-proxy.AUTH_ROLES` is the authority for
# all of them and `test_people` pins this against it.
PROFILE: Final[Tuple[str, ...]] = ("guest", "owner", "ops")

# What KIND of claim a finding makes. This is the distinction that keeps the
# report honest, and DATA_QUALITY is the one that earns its place: a sensor
# that stopped reporting is a measurement fault, not an equipment fault, and
# reporting "the freezer is warming" when the truth is "the freezer's
# thermometer went offline" is the fastest way to lose a reader's trust.
FINDING_KIND: Final[Tuple[str, ...]] = (
    "OBSERVATION",     # a fact worth stating; no judgement attached
    "ANOMALY",         # a departure from this equipment's own baseline
    "DATA_QUALITY",    # the instrument, not the thing being measured
    "FORECAST",        # a projection, always with its horizon stated
    "VERIFICATION",    # a previous finding confirmed resolved (Phase 7)
)

# How often a schedule fires. Not a cron expression: an operator configuring a
# villa dashboard from an iPad should never meet one, and the catch-up window
# in Phase 2 is far easier to reason about over a closed set.
CADENCE: Final[Tuple[str, ...]] = ("daily", "weekly", "monthly")

# The outcome of ONE delivery to ONE target. Per-target by design — a report
# that reached the owner's phone and failed to reach the facility manager's
# email is not "failed", and collapsing that to a single status is how you get
# a resend that spams the person who already read it.
DELIVERY_STATUS: Final[Tuple[str, ...]] = (
    "pending",         # queued, not yet attempted
    "sent",            # the service call returned success
    "failed",          # attempted, refused; `detail` says why
    "skipped",         # deliberately not attempted (target disabled/absent)
)

# Where a report's prose came from. Recorded on every history entry because a
# reader deserves to know, and because "the summaries changed tone last
# Tuesday" is otherwise an unanswerable question.
NARRATION_MODE: Final[Tuple[str, ...]] = (
    "deterministic",   # the built-in renderer. ALWAYS available, offline
    "provider",        # an LLM wrote it (Phase 6)
)

#: ⚠️ WHAT A HISTORY ENTRY MAY RECORD, WHICH IS NOT WHAT AN OPERATOR MAY
#: CONFIGURE. `NARRATION_MODE` is the setting; nobody can ask for a degraded
#: brief, so `fallback` belongs in the record and would be a meaningless radio
#: button in the settings tab. Splitting them is what keeps the config
#: vocabulary honest while the audit trail says what actually happened.
#:
#: `fallback` means the deterministic renderer RAISED and `agent.fallback`'s
#: ladder composed the brief instead (TASK-111). Recording `deterministic` there
#: would be the field's own docstring — "what actually wrote this one" — lying
#: about the single case it exists to make visible.
NARRATION_FALLBACK: Final[str] = "fallback"
NARRATION_RECORD: Final[Tuple[str, ...]] = NARRATION_MODE + (NARRATION_FALLBACK,)

# Why a module did not run. A module is NEVER silently absent — the report says
# which analyses it could not perform and why, so a thin deployment produces a
# short honest report rather than one that looks complete.
SKIP_REASON: Final[Tuple[str, ...]] = (
    "missing_capability",   # the deployment has no such data source
    "disabled",             # switched off by the operator
    "insufficient_history", # not enough days yet to have a baseline
    "audience_mismatch",    # not part of this audience's brief
    "timed_out",            # exceeded its budget this run
    "errored",              # raised; three in a row auto-disables it
    # ⚠️ ITS OWN VALUE SO THE RENDERER CAN GROUP WITHOUT PARSING ENGLISH.
    # Grouping these by matching on the sentence would be the cross-artefact
    # defect this file exists to prevent, one layer in.
    #
    # ⚠️ IT REPLACED `covered_but_silent` IN 2.755.0. That name described a
    # condition that no longer exists: there is no silence test, no grace
    # window and no installed-blueprint test. A check stands down for exactly
    # one reason now — supervision is off, so the villa's own automation is in
    # charge — and the value says that and nothing else.
    "superseded",           # supervision is off; the blueprint does this job
)

# ⚠️ THE PRIVACY BOUNDARY (Phase 6). The allow-list of field names that may
# leave the villa in an LLM narration payload. ALLOW-LIST BY CONSTRUCTION: the
# payload builder copies these keys and drops everything else, so a new field
# added to a Finding is excluded until someone deliberately adds it here, and
# the reviewer of that line is looking directly at a privacy decision.
#
# A deny-list would be the bug: it fails OPEN on every field nobody thought of.
#
# NEVER admissible, whatever a future module wants: photographs or any image,
# credentials, occupant location or presence history, raw event logs, entity
# IDs, and ledger free text beyond a summary count. Entity IDs are excluded
# because they routinely carry room and person names
# (`sensor.<firstname>_bedroom_window`) — the label is what the reader needs, and an
# opaque ref is what the model needs to talk about it.
PAYLOAD_ALLOWED_FIELDS: Final[Tuple[str, ...]] = (
    "ref",             # opaque per-report handle, e.g. "d3" — NOT an entity_id
    "kind",            # FINDING_KIND
    "severity",        # SEVERITY
    "label",           # human name of the equipment, as the operator wrote it
    "area",            # room/area name
    "metric",          # what was measured, e.g. "power"
    "unit",
    "observed",        # the number
    "baseline",        # what it is being compared against
    "delta",
    "window_days",
    "confidence",      # 0..1
    "completeness",    # 0..1 — how much of the window actually had data
    "horizon_days",    # FORECAST only
    # ⚠️ STRUCTURE, ADDED SO THE MODEL CAN COMPOSE RATHER THAN REPHRASE. Without
    # these it received a flat list and could not know what leads, what is new,
    # or whether a number is worse than usual — the three things a good opening
    # sentence turns on. All scalars, all non-identifying: a zone name, two
    # counts and a direction say nothing about which villa this is.
    "zone",            # needs_you | this_period | about_report
    "age_days",        # how long this has been open
    "occurrences",     # how many times it fired in the window
    "trend_direction", # up | down | flat, against the previous periods
    "trend_pct",       # by how much
)

#: ⚠️ VALIDATED OUTBOUND like `SEVERITY` and `FINDING_KIND`, for the same
#: reason: these cross to a third party, and "whatever a module put there" is
#: not a thing to hand over.
ZONE: Final[Tuple[str, ...]] = ("needs_you", "this_period", "about_report")
TREND_DIRECTION: Final[Tuple[str, ...]] = ("up", "down", "flat")

# Every value set above, by name, so the parity test can iterate rather than
# being edited whenever a set is added — a check that must be updated by hand
# to cover new cases is a check that silently stops covering them.
CONTRACT_SETS: Final[Dict[str, Tuple[str, ...]]] = {
    "SEVERITY": SEVERITY,
    "AUDIENCE": AUDIENCE,
    "FINDING_KIND": FINDING_KIND,
    "CADENCE": CADENCE,
    "DELIVERY_STATUS": DELIVERY_STATUS,
    "NARRATION_MODE": NARRATION_MODE,
    "NARRATION_RECORD": NARRATION_RECORD,
    "SKIP_REASON": SKIP_REASON,
    "PAYLOAD_ALLOWED_FIELDS": PAYLOAD_ALLOWED_FIELDS,
    # ⚠️ ADDED ONE RELEASE LATE, AND THE COMMENT ABOVE PREDICTED IT. `ZONE` and
    # `TREND_DIRECTION` shipped in v2.592.0 as validated outbound enums and were
    # not registered here, so nothing checked them against the SPA — the exact
    # "a check that must be updated by hand silently stops covering new cases"
    # this dict exists to avoid, missed two lines below the sentence saying so.
    # /dry-audit found it the same day.
    "ZONE": ZONE,
    "TREND_DIRECTION": TREND_DIRECTION,
}
