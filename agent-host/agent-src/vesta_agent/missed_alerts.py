"""The villa's alerts handed to the agent while it was not listening, taken in when it starts.

⚠️ A RESTART LOST AN ALERT (owner's end-to-end test, 2026-10-30): the test lock's alert was handed over at 00:43:24,
while the agent was restarting for an update (stopped 00:43:15, listening again 00:43:33). The villa's own message went
out (an alert never waits on the agent), but no incident was opened: no number, no buttons, no chase, an orphan line
on the tablet. Home Assistant keeps no events for a listener that was away; it keeps each automation run's trace. So
at start the agent reads the runs of every rule that hands alerts over (the rules whose config names the event),
since its last beat before it stopped, and takes in each handover found there as the socket would have delivered it.

⚠️ ONCE EACH: the last beat comes up to a minute before the stop, so a handover may have been taken in live already.
Every handover carries its incident id, its phase and its own moment (`timestamp`: a rule's repeat shares the first
two); app.on_critical remembers those it took in (State.alert_seen) and takes none twice.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from vesta_shared.limits import limit

from .ha_events import CONTEXT_KEY

EVENT = "vesta_critical_event"
#: How many recent runs of one rule are listed (the trace store keeps fewer: Home Assistant's stored_traces, 5 by default)
RUNS_LISTED = 20


def catch_up_hours() -> float:
    return limit("alerts.catch_up_hours", 6, unit="hours", group="read", lo=1, hi=48,
                 says="How far back the agent looks, when it starts, for the villa's alerts handed to it while it was not "
                      "listening (an update, a restart).",
                 reached="An alert handed over before that is not taken in; the villa's own message was sent anyway.",
                 told="")


def _when(text) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(text))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def window(last_beat: str | None, now: datetime) -> tuple[datetime, datetime] | None:
    """(since, until) to look in: from the last beat before the stop, never further back than catch_up_hours(); None at
    a first start (no beat: nothing was missed)."""
    since = _when(last_beat) if last_beat else None
    if since is None:
        return None
    return max(since, now - timedelta(hours=catch_up_hours())), now


def missed(reader, since: datetime, until: datetime) -> list[dict]:
    """Every handover an automation run fired in (since, until], oldest first, its run's context beside its data
    (CONTEXT_KEY, as ha_events copies it: the villa's message of that run is the incident's). Blocking: run in a thread."""
    found: list[tuple[datetime, dict]] = []
    for rule in reader.rules_mentioning([EVENT]):
        if rule.get("kind") != "automation":
            continue
        eid = rule["entity_id"]
        listed = reader.tool("ha_get_automation_traces", {"automation_id": eid, "limit": RUNS_LISTED})
        for run in (listed.get("traces") if isinstance(listed, dict) else None) or []:
            start = _when((run.get("timestamp") or {}).get("start"))
            if start is None or not since < start <= until or not run.get("run_id"):
                continue
            detail = reader.tool("ha_get_automation_traces",
                                 {"automation_id": eid, "run_id": run["run_id"], "sections": "actions"})
            context = None
            for step in (detail.get("action_trace") if isinstance(detail, dict) else None) or []:
                context = context or ((step.get("variables") or {}).get("context") or {}).get("id")
                result = step.get("result") or {}
                if result.get("event") == EVENT and isinstance(result.get("event_data"), dict):
                    found.append((start, {**result["event_data"], **({CONTEXT_KEY: context} if context else {})}))
    return [data for _, data in sorted(found, key=lambda x: x[0])]


__all__ = ["missed", "window", "catch_up_hours", "EVENT"]
