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
TICKET = "t"        # a fault the AI offered:           t:<offer id>:<y|n>
COMMAND = "o"       # a command skill a reply offered:  o:<offer id> (its skill and question kept: command_offers.py)
DECLINE = "d"       # …and declined, its second button: d:<offer id> (owner, 2026-10-20: "a button to reject it")
PHOTOS = "p"        # a visit's every photo, sent in the chat pressed: p:<incident id> (owner, 2026-11-07)

PARTS = {APPROVAL: 2, CONTINUE: 1, ALERT: 2, REPORT: 2, TICKET: 2, COMMAND: 1, DECLINE: 1, PHOTOS: 1}
# who may press is the handler's to judge; these need a person policy.yaml knows before anything else is read
# (an approval checks it itself, with the press recorded for the owner to see)
FOR_PEOPLE_ONLY = {CONTINUE, ALERT, REPORT, TICKET, COMMAND, DECLINE, PHOTOS}
#: Buttons Telegram alone shows: the tablet's card already shows every photo of a visit (owner, 2026-11-07)
TELEGRAM_ONLY = {PHOTOS}


#: ⚠️ THE VILLA'S OWN BUTTONS ARE THE VILLA'S (one visit, one story, 2026-11-06): a visit's first message carries the
#: villa's buttons ("/visit_done <its time>", a command the villa's automation answers and records), and VESTA takes
#: that message over. A press on it before VESTA's buttons replace them is the villa's to answer — answered here too,
#: the person read "Unknown button." over the villa's own answer. Its answer reaches VESTA with the villa's next event.
VILLA_COMMAND = "/"


def villas(data: str) -> bool:
    """Is `data` a button of the villa's own (a command its automation answers), never one the agent wrote?"""
    return str(data or "").startswith(VILLA_COMMAND)


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
