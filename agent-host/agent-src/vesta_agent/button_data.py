"""The agent's buttons on Telegram: each kind's prefix, how its data is written and read. One table.

⚠️ WRITTEN AND READ HERE (architecture review 6, 2026-10-07). Four kinds were each written in their own module
(actions.py "a:", app.py "c:", alert_buttons.py "i:", ai_down.py "w:") and taken apart again by string slicing in
app.handle_callback; "not registered" was checked three times, with two wordings. A kind is added here once.
Telegram allows 64 bytes of data: every part is a short id or word.
"""
from __future__ import annotations

APPROVAL = "a"      # Approve / Refuse an action:      a:<approval id>:<y|n>
CONTINUE = "c"      # Continue an answer at its limit:  c:<continuation id>
ALERT = "i"         # Done / Need help on an alert: i:<incident id>:<option>
REPORT = "w"        # a report without the AI:          w:<problem>:<job>

PARTS = {APPROVAL: 2, CONTINUE: 1, ALERT: 2, REPORT: 2}
# who may press is the handler's to judge; these need a person policy.yaml knows before anything else is read
# (an approval checks it itself, with the press recorded for the owner to see)
FOR_PEOPLE_ONLY = {CONTINUE, ALERT, REPORT}


def make(kind: str, *parts) -> str:
    assert kind in PARTS and len(parts) == PARTS[kind], (kind, parts)
    return ":".join([kind, *(str(p) for p in parts)])


def read(data: str) -> tuple[str | None, list[str]]:
    """(kind, its parts); (None, []) for data the agent did not write."""
    kind, _, rest = (data or "").partition(":")
    if kind not in PARTS:
        return None, []
    parts = rest.split(":", PARTS[kind] - 1) if rest else []
    return (kind, parts) if len(parts) == PARTS[kind] and all(parts) else (None, [])
