"""What a skill script asks the engine to do, built one way: the shape is here, every word stays in the skill.

⚠️ FIELDS, NOT WORDING (architecture review 7, 2026-10-07). Each script wrote the dicts by hand (the alert desk in
fifteen places), and two links went through the text: an alert reminder carried its buttons without its incident,
and the engine found it by reading "#N" out of the sentence — a skill rewording its reminder would silently lose
the buttons; the siren's prompt was put among the messages and the engine took it out again by comparing texts.
A Kiosk fault's note was "what to check" in one script and "Check: …" in another.

The engine's reader is vesta_agent/outcome.py (carry_out); its keys:
    send        [message(...)]            settle   [settle(...)]
    actions     [fault(...), resolved(...), snapshot(...)]
    siren_gate  siren(...)
    ha_messages [ha_message(...)]
"""
from __future__ import annotations

from .message_format import PRESSED_STAGE, STEPS

#: A script result's mark that the Kiosk's faults must be brought up to date (its findings opened, still open or
#: closed): the engine repairs them (app.run_code_job). ⚠️ ONE KEY, WRITTEN AND READ HERE (architecture review 13): the
#: engine looked for new_findings / still_open / closed, which the night check computed but never printed.
FAULTS_CHANGED = "faults_changed"

#: The night check's rule ids another skill reads (the reports' counter resets, roi-energy's "create the missing
#: setting" proposal). ⚠️ WRITTEN ONCE (architecture review 13): each reader spelled the id itself, so a renamed
#: rule would have emptied their lists without a sound.
#: The priorities a problem can carry, most urgent first: the alert's heading (app), the desk's routes, the open list's
#: and the reports' order. ⚠️ WRITTEN ONCE (architecture review 5, 2026-10-13): four copies, one per reader.
PRIORITIES = ("P1", "P2", "P3", "P4")
PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}

PARAM_MISSING = "PM-PARAM-MISSING"
COUNTER_RESET = "PM-COUNTER-RESET"


def finding_detail(finding: dict) -> dict:
    """A stored finding's detail (its JSON), {} when it has none or cannot be read."""
    import json
    d = finding.get("detail")
    if isinstance(d, dict):
        return d
    try:
        return json.loads(d or "{}") or {}
    except (TypeError, ValueError):
        return {}


def finding_name(finding: dict) -> str | None:
    """The name the night check gave a finding's device (its detail's "name"), None without one."""
    return finding_detail(finding).get("name")


#: What a notice about an incident is (its history line, vesta_agent/notice.py): every step of an alert
#: (message_format.STEPS, one line each), and "pressed" — the answer to a button press in its own chat.
STAGES = (*STEPS, PRESSED_STAGE)


#: What a bottom line says beyond its stage (vesta_agent/layout.py draws it): a person asked for help; a closure VESTA
#: could not check (the device does not answer, or its rule names no bad state). Owner, 2026-10-11.
MARKS = ("help", "unchecked")


def _mark(m: dict, mark: str | None) -> dict:
    if mark is not None:
        if mark not in MARKS:
            raise ValueError(f"mark must be one of {', '.join(MARKS)}")
        m["mark"] = mark
    return m


def message(to: str, text: str, *, status: str | None = None, incident: int | None = None, buttons: bool = False,
            attachment: str | None = None, stage: str | None = None, mark: str | None = None,
            title: str | None = None, first_in_line: bool = False) -> dict:
    """A message for `to` (here · owner · fm). `buttons`: the alert's Done / Need help for `incident`; `stage`: what
    this notice about it is (STAGES) — the engine writes its heading and its history line. "{time}" in `text` is the
    villa's time when it is sent (10/10/2026 15:04), as in a settle note. `status`: where it stands, shown under a line
    at the bottom (vesta_agent/layout.py) — given apart, never written into `text`. `first_in_line`: the people asked
    to answer it (the alert desk's chase) — when Telegram refused every chat it went to, the engine says so
    (Problems.unreached) and the desk hands the incident on."""
    m = {"to": to, "text": text}
    if status:
        m["status"] = status
    if stage is not None:
        if stage not in STAGES:
            raise ValueError(f"stage must be one of {', '.join(STAGES)}")
        m["stage"] = stage
    if incident is not None:
        m["incident_id"] = int(incident)
    if buttons:
        if incident is None:
            raise ValueError("an alert's buttons need its incident")
        m["keyboard"] = True
    if first_in_line:
        if not buttons:
            raise ValueError("the people asked to answer get the buttons to answer with")
        m["first_in_line"] = True
    if attachment:
        m["attachment"] = attachment
    if title:
        m["title"] = title          # a report's title: the agent writes it, and "To:" under it (message_format.titled)
    return _mark(m, mark)


def fault_note(check: str | None) -> str | None:
    """A Kiosk fault's note: what to do on site, labelled as the alert says it on Telegram ("What to do: …"), or None
    (review 29: "Check: Check the device named…" — the label repeated the check's own first word)."""
    return f"What to do: {check}" if check else None


def fault(summary: str, *, task_id: int | None = None, check: str | None = None, entity_id: str | None = None) -> dict:
    """A task as a fault in the VESTA Kiosk: its title says what is wrong, its note what to check."""
    return {"action": "ticket", "summary": summary, "task_id": task_id, "note": fault_note(check),
            "entity_id": entity_id if entity_id and "," not in entity_id else None}


def reopened(task_id: int, title: str, note: str = "") -> dict:
    """Task `task_id`'s Kiosk fault open again under `title`: its problem came back (vesta_shared.problems)."""
    return {"action": "ticket.reopen", "task_id": int(task_id), "title": title[:200], "note": note[:500]}


def resolved(task_id: int, note: str | None = None, who: str | None = None) -> dict:
    """A task's fault resolved in the VESTA Kiosk — by `who` when a person did it (their name on the card)."""
    return {"action": "ticket.resolve", "task_id": task_id, "note": note or None, **({"who": who} if who else {})}


def snapshot(entity_id: str, incident: int) -> dict:
    """A camera's picture, sent with an alert."""
    return {"action": "snapshot.get", "entity_id": entity_id, "incident_id": int(incident)}


def settle(incident: int, note: str, mark: str | None = None) -> dict:
    """Every message carrying the incident's buttons loses them and shows `note` ("{time}": the villa's time); `mark`:
    MARKS."""
    return _mark({"incident_id": int(incident), "note": note}, mark)


def ha_message(incident: int, text: str, context: str | None, stage: str | None = None, status: str | None = None) -> dict:
    """Home Assistant's own messages of the automation run `context` (the event's context) become `incident`'s
    messages, rewritten as `text` under the incident's heading, like every other notice about it (`stage`: STAGES)."""
    m = {"incident_id": int(incident), "text": text, "context": context, **({"status": status} if status else {})}
    if stage is not None:
        if stage not in STAGES:
            raise ValueError(f"stage must be one of {', '.join(STAGES)}")
        m["stage"] = stage
    return m


def siren(armed: bool, prompt: str | None, to: tuple[str, ...] = ("owner", "fm"), **detail) -> dict:
    """The siren's gate. Armed: the owner gets an Approve / Refuse request (the configured siren); with no siren
    configured, `prompt` goes to `to` as it is. Never fired by a script."""
    return {"armed": bool(armed), "prompt": prompt, "to": list(to), **detail}
