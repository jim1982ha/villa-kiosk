"""One message a day listing the work nobody has ticked off.

⚠️ IT EXISTS BECAUSE JOB NOTIFICATIONS WERE REMOVED, AND IT IS THE ONE THING
THAT REPLACES THEM (2026-08-28, owner's ruling). Until then every to-do item
announced itself: `task.raise_for` fired an event, `vesta_task_actions.yaml`
messaged the facility manager, re-asked at fifteen minutes and escalated to the
owner at forty-five. So one finding produced two notifications on two
independent ladders, and acknowledging one did not stop the other.

The ruling settled it: **the Concern is the alert; the to-do item is the
record.** A record does not announce itself. But "appears on a list somebody
may not be watching" is how work goes unnoticed, so the announcement returns
once a day, in aggregate, to the people whose work it is.

⚠️ AGGREGATE IS THE WHOLE POINT, NOT A COMPROMISE. Per-item messages are what
was just removed; a digest of five items is ONE interruption where the old
design produced five, plus five re-asks, plus five escalations. It is also the
shape that survives a bad week — a villa with forty open items sends one
message, not forty.

⚠️ SILENT WHEN THERE IS NOTHING OUTSTANDING, and that is deliberate rather than
an oversight. A daily "you have no jobs" is pure noise on a property that is
usually fine, and this is a message to a PERSON rather than an instrument whose
silence could be misread as a fault — the distinction `observe/heartbeat.py`
records. The list under Act & Tell is always there and always says the truth.

⚠️ IT DOES NOT REACH FOR THE CONCERN STORE. An item's whole content — the
bracketed reference, the title — is already on the to-do list, which is the one
place the tablet, Home Assistant's own panel and this all read. Joining back to
the concern would be a second source for a fact the list already carries, and
the first time they disagreed the digest would describe work that is not there.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional

from agent import budget as budget_mod
from agent import config as agent_config
from reports import people as people_mod
from agent import task as task_mod
from reports import store
from reports.log import stage, swallow

#: Where the last send is recorded. ⚠️ ON DISK, because the alternative is an
#: in-process flag that a restart clears — and this add-on restarted eleven
#: times in one afternoon during a release day, which would have sent eleven
#: digests. The same reason `observe/cycle.py` keeps its baseline on disk.
STATE_FILE: str = f"{store.DATA_DIR}/vesta/digest.json"

#: Which role's work this is. ⚠️ `ops` — the FACILITY MANAGER — and not the
#: owner, because the whole point is reaching whoever does the work rather than
#: whoever is told about the finding. On a villa with nobody in that role,
#: `targets_for_role` returns nothing and the digest is skipped: correct, and
#: not an error, because there is no one to ask.
ROLE: str = "ops"

#: How many items a single message names. ⚠️ A CAP, WITH THE REMAINDER COUNTED.
#: A notify platform truncates a long body silently, which would drop the tail
#: of somebody's work with no indication — the "truncation is always explicit"
#: rule this project applies to tool results, applied to prose.
MAX_LISTED: int = 12


def _last_sent(state: Mapping[str, Any]) -> float:
    try:
        return float(state.get("at") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def due(now: Optional[float] = None,
        state: Optional[Mapping[str, Any]] = None) -> bool:
    """Has a local day passed since the last digest?

    ⚠️ `budget._day_start` IS THE OWNER OF "local midnight here" and this asks
    it rather than computing a second one. That function already carries the
    reasoning — `time.localtime` reads the container's TZ, which the add-on
    sets from Home Assistant's — and two implementations of a day boundary is
    how a villa on UTC+8 gets two different answers to "today".
    """
    raw = store.read_json(STATE_FILE, {}) if state is None else state
    stamp = time.time() if now is None else now
    return _last_sent(raw if isinstance(raw, Mapping) else {}) < \
        budget_mod._day_start(stamp)


def _line(item: Mapping[str, Any]) -> str:
    """One item, in the words a person would use for it.

    ⚠️ THE REFERENCE IS DROPPED, AND THE ARGUMENT FOR KEEPING IT WAS WRONG
    (2026-08-28). This used to append `[c7]` on the reasoning that it "ties a
    line to the alert behind it and to the row the tablet ticks" — true of the
    SOFTWARE and worth nothing to the reader, who cannot type `c7` anywhere and
    has no screen that asks for it. The tying is done by `ledger.TASK_PREFIX`
    against the stored summary, which is where it belongs; printing it into a
    message is the internal vocabulary leaking onto somebody's phone.
    See `feedback_speak-in-ui-terms` — the owner has now reported this twice,
    once about my prose and once about a screen.
    """
    return "- " + " ".join(str(item.get("text") or "").split())


def compose(items: List[Mapping[str, Any]]) -> str:
    """The body. Separated from sending so it can be read without a villa."""
    shown = items[:MAX_LISTED]
    lines = [_line(i) for i in shown]
    more = len(items) - len(shown)
    if more > 0:
        lines.append(f"- and {more} more, under Act & Tell in VESTA")
    lines.append("")
    lines.append("Tick one off under Act & Tell in VESTA, or on the "
                 "to-do list itself.")
    return "\n".join(lines)


async def send_daily(session: Any, *,
                     config: Optional[Mapping[str, Any]] = None,
                     now: Optional[float] = None) -> str:
    """One digest, at most once a local day. Returns why it stopped. NEVER RAISES.

    ⚠️ IT RETURNS A REASON RATHER THAN A BOOLEAN, for the same cause
    `scheduler.run_once` does: "nothing happened" has five causes here — not
    due, no list, no recipient, nothing outstanding, could not read — and four
    of them are fine. A caller that could not tell them apart would report a
    healthy villa and a broken one identically.
    """
    if session is None:
        return "no session"
    cfg = agent_config.view(config)
    if not cfg.get("enabled"):
        return "agent disabled"
    if not task_mod.list_for(config):
        return "no to-do list named"
    if not due(now):
        return "not due"

    targets = people_mod.targets_for_role(config, ROLE)
    if not targets:
        return "nobody holds the facility manager role"

    try:
        from reports import ledger as ledger_mod
        from reports.hass import HassClient
        async with HassClient(session) as hass:
            items = await ledger_mod.todo_tasks(
                hass, [task_mod.list_for(config)], status="needs_action")
    except Exception as err:  # noqa: BLE001
        swallow("could not read the open to-do items for the daily digest", err)
        return "could not read the list"

    if not items:
        # ⚠️ THE CLOCK IS STILL STAMPED. Without this, a villa with no
        # outstanding work re-reads the list on every chase tick for the whole
        # day — cheap, but it also means the first item raised at 23:55 would
        # be announced immediately rather than in the next day's digest, which
        # is a per-item notification wearing a digest's name.
        _stamp(now)
        return "nothing outstanding"

    try:
        from reports import deliver as deliver_mod
        results = await deliver_mod.deliver(
            session, list(targets),
            f"VESTA — {len(items)} job(s) still open", compose(items))
    except Exception as err:  # noqa: BLE001
        swallow("could not deliver the daily to-do digest", err)
        return "delivery failed"

    sent = sum(1 for r in results
               if isinstance(r, Mapping) and str(r.get("status")) == "sent")
    if not sent:
        # ⚠️ NOT STAMPED ON A FAILED SEND, so the next tick tries again rather
        # than swallowing a day's work because one delivery was unreachable.
        return "nobody could be reached"
    _stamp(now)
    stage("digest", f"{len(items)} open job(s) to {sent} target(s)")
    return f"sent {len(items)} to {sent}"


def _stamp(now: Optional[float] = None) -> None:
    try:
        store.write_json(STATE_FILE,
                         {"at": time.time() if now is None else now})
    except Exception as err:  # noqa: BLE001
        swallow("could not record the digest send", err)
