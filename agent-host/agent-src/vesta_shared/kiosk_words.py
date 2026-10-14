"""What the agent says of a person's act in the VESTA Kiosk — closing a fault, reopening it — the ONE wording, with who
and when the Kiosk recorded (architecture review 29: "Reopened in the Kiosk by Owner on <the tick's time>" for an alert,
"Reopened in the VESTA Kiosk by Owner on <the real time>: …" for a night fault, and "Closed in the Kiosk" without its
person when the device was still bad)."""
from __future__ import annotations

from datetime import datetime

from .timeutil import moment_label


# ⚠️ ONE NAME FOR THE PLACE (architecture review, 2026-10-15): one Status list read "Closed in the VESTA Kiosk by …" and
# "Ticket opened in the Cockpit by …" — the same place, two names. It is "the Cockpit", where the person did it.


def when(iso: str | None, zone: str) -> str:
    """The Kiosk's moment ("…Z") in the villa's time, as every notice writes one; "{time}" (now, filled when sent)
    when the Kiosk gave none."""
    try:
        return moment_label(datetime.fromisoformat(str(iso).replace("Z", "+00:00")), zone)
    except (TypeError, ValueError):
        return "{time}"


def closed(by: str, iso: str | None, zone: str) -> str:
    """"Closed in the VESTA Kiosk by Fabien on 11/10/2026 07:05" — no full stop: a sentence may go on after it."""
    return f"Closed in the Cockpit{f' by {by}' if by else ''} on {when(iso, zone)}"


def taken(by: str, iso: str | None, zone: str) -> str:
    """"Ticket opened in the Cockpit by Facility manager on 15/10/2026 00:40." — someone took an alert's fault on in the
    VESTA Kiosk ("Open Ticket"): its Telegram chase stops (owner, 2026-10-15)."""
    return f"Ticket opened in the Cockpit{f' by {by}' if by else ''} on {when(iso, zone)}."


def reopened(by: str, iso: str | None, zone: str, what: str | None = None) -> str:
    """"Reopened in the VESTA Kiosk by Owner on 11/10/2026 07:05: Pump weak. Please look again." — `what` when the
    message carries no alert of its own (a night check's fault)."""
    return f"Reopened in the Cockpit{f' by {by}' if by else ''} on {when(iso, zone)}" + \
        (f": {what}." if what else ".") + " Please look again."
