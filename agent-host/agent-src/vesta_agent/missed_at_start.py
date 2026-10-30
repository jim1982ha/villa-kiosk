"""What the villa handed to the agent while it was not listening, taken in when it starts: its alerts, and what people
sent on Telegram (a message, a command, a file, a button pressed).

⚠️ A RESTART LOST AN ALERT (owner's end-to-end test, 2026-10-30): the test lock's alert was handed over at 00:43:24,
while the agent was restarting for an update (stopped 00:43:15, listening again 00:43:33). The villa's own message went
out (an alert never waits on the agent), but no incident was opened: no number, no buttons, no chase, an orphan line
on the tablet. Home Assistant keeps no events for a listener that was away; it keeps each automation run's trace. So
at start the agent reads the runs of every rule that hands alerts over (the rules whose config names the event),
since its last beat before it stopped, and takes in each handover found there as the socket would have delivered it.

⚠️ A PRESS OR A QUESTION DURING A RESTART WAS LOST TOO (architecture review, round 9): a Done pressed on an alert during
an update's 20 seconds kept the card's buttons and its reminders, and a question typed then got no answer and no word.
The bot's own event entity (the telegram_bot integration's "Update event", found by what it says it carries, never by
its name) keeps every update in the villa's history, with the very data the socket would have delivered. Read from the
same moment, they are handed to the same handler (app.Vesta.on_ha_event), in time order with the alerts.

⚠️ ONCE EACH: the last beat comes up to a minute before the stop, so an item may have been taken in live already. A
handover carries its incident id, its phase and its own moment (State.alert_seen); a Telegram update its own id
(`key`: a press's callback id, a message's chat and message id; State.update_seen). Whichever way an item comes first,
the other way finds it taken.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from vesta_shared.limits import limit

from .ha_events import CONTEXT_KEY

EVENT = "vesta_critical_event"
#: How many recent runs of one rule are listed (the trace store keeps fewer: Home Assistant's stored_traces, 5 by default)
RUNS_LISTED = 20
#: The people's updates the bot's event entity records, as the socket names them (ha_events.EVENT_TYPES): the bot's own
#: sent messages are not people's, and their run's context is not in the history
PEOPLE = ("telegram_text", "telegram_command", "telegram_callback", "telegram_attachment")
#: The entity's own attributes, beside the update's data
_OWN = ("event_type", "event_types", "friendly_name", "icon", "device_class")
#: How many rows one read of the bot's history brings (paged further when it says more)
PAGE = 200


def catch_up_hours() -> float:
    return limit("alerts.catch_up_hours", 6, unit="hours", group="read", lo=1, hi=48,
                 says="How far back the agent looks, when it starts, for the villa's alerts handed to it while it was not "
                      "listening (an update, a restart), and for what people sent it on Telegram meanwhile.",
                 reached="An alert handed over before that is not taken in; the villa's own message was sent anyway.",
                 told="")


def catch_up_minutes() -> int:
    """How old a press or a question sent during a stop may be and still be acted on at start."""
    return limit("telegram.catch_up_minutes", 15, unit="minutes", group="read", lo=1, hi=360,
                 says="How old a button press or a question sent while the agent was restarting may be and still be "
                      "acted on when it is back.",
                 reached="Older, it is not acted on: the person is told to press the button again or to send the "
                         "question again.", told="person")


@dataclass
class Missed:
    at: datetime
    event_type: str
    data: dict = field(default_factory=dict)


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


def key(event_type: str, data: dict) -> str | None:
    """A Telegram update's own id, whichever way it came (the socket's data or the history's): a press by its callback
    id, a message by its chat and message id. None when it carries neither (it is then taken in live only)."""
    if event_type == "telegram_callback":
        return f"cb:{data['id']}" if data.get("id") else None
    if event_type in PEOPLE and data.get("chat_id") is not None and data.get("id") is not None:
        return f"msg:{data['chat_id']}:{data['id']}"
    return None


def missed(reader, since: datetime, until: datetime, telegram: bool = True) -> list[Missed]:
    """Everything handed over in (since, until], oldest first: the alerts, then (`telegram`) people's updates. Blocking:
    run in a thread."""
    found = alerts(reader, since, until) + (updates(reader, since, until) if telegram else [])
    return sorted(found, key=lambda m: m.at)


def alerts(reader, since: datetime, until: datetime) -> list[Missed]:
    """Every handover an automation run fired in (since, until], its run's context beside its data (CONTEXT_KEY, as
    ha_events copies it: the villa's message of that run is the incident's)."""
    found: list[Missed] = []
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
                    found.append(Missed(start, EVENT, {**result["event_data"], **({CONTEXT_KEY: context} if context else {})}))
    return found


def bot_entities(reader) -> list[str]:
    """The villa bots' event entities: those that say they carry Telegram's button presses."""
    ids = [e for e in reader.all_entity_ids(fresh=True) if e.startswith("event.")]
    return sorted(e for e, s in reader.states(ids).items()
                  if "telegram_callback" in (((s or {}).get("attributes") or {}).get("event_types") or ()))


def updates(reader, since: datetime, until: datetime) -> list[Missed]:
    """People's Telegram updates in (since, until], from the bots' event entities' history: each row's attributes are the
    update's data, its state the moment it came."""
    from vesta_shared.ha_client import paged
    found: list[Missed] = []
    for eid in bot_entities(reader):
        def fetch(offset, eid=eid):
            body = reader.tool("ha_get_history", {
                "entity_ids": eid, "source": "history", "order": "asc", "minimal_response": False,
                "significant_changes_only": False, "limit": PAGE, "offset": offset,
                "start_time": since.astimezone(timezone.utc).isoformat(),
                "end_time": until.astimezone(timezone.utc).isoformat()})
            ent = next(iter((body or {}).get("entities") or []), {})
            return ent.get("states") or [], ent.get("has_more"), ent.get("next_offset")
        rows, _ = paged(fetch, PAGE, max_pages=20)
        for row in rows:
            attrs = row.get("attributes") or {}
            at = _when(row.get("state")) or _when(row.get("last_changed"))
            et = attrs.get("event_type")
            if et in PEOPLE and at is not None and since < at <= until:
                found.append(Missed(at, et, {k: v for k, v in attrs.items() if k not in _OWN}))
    return found


__all__ = ["missed", "window", "key", "catch_up_hours", "catch_up_minutes", "EVENT", "PEOPLE", "Missed"]
