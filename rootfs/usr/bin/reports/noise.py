"""Which rules fire and are never acknowledged — the catalog's honesty check.

The workbook (`Severity & Routing`, "The rule that keeps the whole thing
honest") states it in one sentence: *an alert that is never followed by a clear
event is a rule with a bug, not a villa with a permanent problem*, and any rule
firing more than `noise_threshold_fires` times a month with no acknowledgement
is noise that must be retuned or retired. Alert fatigue is the single failure
mode that kills systems like this.

⚠️ THE ACKNOWLEDGEMENT SIGNAL IS A COMPLETED TODO ITEM, BY THE OWNER'S CHOICE
(2026-08-22), and that decision is what makes this buildable at all. The
alternative — action buttons on the push itself — needs a `data` block in
`deliver.py`, which that module's header forbids in terms: the moment it sends
one it has a Telegram branch, and platform branches are how a report that reads
well everywhere becomes one that reads well on one platform. A completed todo
item is platform-neutral, survives an offline villa, and `ledger.todo_tasks(...,
status="completed")` was ALREADY being read every run for `verify`. So this
module adds no I/O whatsoever; it counts two lists that were both already in
memory.

⚠️ ESCALATION IS NOT HERE AND MUST NOT BE. The 15-minute resend and 45-minute
owner escalation belong to the `critical_*` blueprints, where `Params` r71/r72
already route them and where the occupancy context lives. This module records
and reports; it never notifies. Putting the timer here would move urgency out of
the detection layer, which is the same mistake as computing grouping in the
renderer.

⚠️ MEDIAN TIME TO CLEAR IS NOT COMPUTABLE AND IS DELIBERATELY ABSENT. The
workbook asks for four figures per rule: fires, acknowledgements, median time to
clear, and fires with no clear. Home Assistant's `todo/item/list` returns
`status` but no completion TIMESTAMP, so "when was it acked" is not a fact this
system can obtain — and `todo_tasks` correctly does not invent one. Three of the
four ship; the fourth is stated as unavailable rather than estimated from the
report's own send time, which would measure the schedule rather than the
caretaker. See `feedback_instruments-never-skip`: a figure nobody can source is
worse than a figure nobody has.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

#: What a rule must exceed, and over how long, before it is called noisy.
#: ⚠️ CONFIG, NOT CONSTANTS. `CONFIG_DEFAULTS` carries both because a threshold
#: tuned for one property is exactly the per-site value CLAUDE.md's first hard
#: rule forbids shipping. These are the workbook's numbers as DEFAULTS.
DEFAULT_THRESHOLD = 20
DEFAULT_WINDOW_DAYS = 30


def fires_by_rule(items: Sequence[Any]) -> Dict[str, Tuple[int, str]]:
    """How many times each rule fired, and what to call it.

    ⚠️ KEYED ON `rule_id`, LABELLED BY `label`. `rule_id` is the bracketed tag
    (`PM-04`) that every blueprint writes identically and is the ONLY reliable
    join to the todo list — `ledger.reconcile`'s header explains why a text
    match works for some blueprints and not others. But `PM-04` means nothing to
    a reader, so the human label rides along and the brief prints that.

    ⚠️ A BLANK `rule_id` IS SKIPPED, not bucketed under "". It defaults to empty
    in every blueprint, so counting blanks together would fuse every untagged
    rule into one imaginary very-noisy rule — the same trap `reconcile` names.
    """
    out: Dict[str, Tuple[int, str]] = {}
    for item in items:
        rule = str(getattr(item, "rule_id", "") or "").strip()
        if not rule:
            continue
        count, label = out.get(rule, (0, ""))
        # Keep the first non-empty label: a blueprint edited mid-window can
        # change its own text, and the earlier one is what the reader saw.
        out[rule] = (count + 1, label or str(getattr(item, "label", "") or ""))
    return out


def acknowledged(done: Sequence[Dict[str, str]]) -> set[str]:
    """Rules with at least one completed caretaker task.

    ⚠️ "AT LEAST ONE", NOT A COUNT MATCHED AGAINST FIRES. A caretaker who fixes
    the cause once for a rule that fired forty times has acknowledged it; the
    catalog's target is a rule nobody has EVER responded to. Requiring parity
    would flag every rule whose fix outlasts one firing, which is most of them.
    """
    return {str(row.get("rule_id") or "").strip()
            for row in done if str(row.get("rule_id") or "").strip()}


def noisy(fires: Dict[str, Tuple[int, str]], acked: set[str],
          threshold: int = DEFAULT_THRESHOLD) -> List[Dict[str, Any]]:
    """Rules over the threshold that nobody has ever acknowledged, worst first."""
    rows: List[Tuple[int, str, str]] = [
        (count, rule, label) for rule, (count, label) in fires.items()
        if count >= threshold and rule not in acked]
    rows.sort(key=lambda r: (-r[0], r[1]))
    return [{"rule_id": rule, "label": label, "fires": count}
            for count, rule, label in rows]


def summarise(items: Sequence[Any], done: Sequence[Dict[str, str]],
              threshold: int = DEFAULT_THRESHOLD,
              window_days: int = DEFAULT_WINDOW_DAYS,
              covered: bool = True) -> Dict[str, Any]:
    """The whole finding, or an honest statement that it cannot be made.

    ⚠️ `covered` IS NOT DECORATION. The collector's buffer is a bounded ring
    (`collect.MAX_EVENTS`), so on a busy property the window this counts over
    may be SHORTER than the window it claims. A fire count that is really a
    floor must not be compared against a threshold and reported as fact — that
    is a counter reading low for the exact case it exists to measure, which
    this project has shipped four times. When the buffer does not reach back far
    enough the answer is "cannot say", and the brief says so.
    """
    fires = fires_by_rule(items)
    if not covered:
        return {"rules": [], "threshold": threshold, "window_days": window_days,
                "known": False, "counted": len(fires)}
    return {"rules": noisy(fires, acknowledged(done), threshold),
            "threshold": threshold, "window_days": window_days,
            "known": True, "counted": len(fires)}
