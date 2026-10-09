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


#: A script result's mark that the Kiosk's faults must be brought up to date (its findings opened, still open or
#: closed): the engine repairs them (app.run_code_job). ⚠️ ONE KEY, WRITTEN AND READ HERE (architecture review 13): the
#: engine looked for new_findings / still_open / closed, which the night check computed but never printed.
FAULTS_CHANGED = "faults_changed"

#: The night check's rule ids another skill reads (the reports' counter resets, roi-energy's "create the missing
#: setting" proposal). ⚠️ WRITTEN ONCE (architecture review 13): each reader spelled the id itself, so a renamed
#: rule would have emptied their lists without a sound.
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


def message(to: str, text: str, *, incident: int | None = None, buttons: bool = False,
            attachment: str | None = None) -> dict:
    """A message for `to` (here · owner · fm). `buttons`: the alert's Done / Not found / … for `incident`."""
    m = {"to": to, "text": text}
    if incident is not None:
        m["incident_id"] = int(incident)
    if buttons:
        if incident is None:
            raise ValueError("an alert's buttons need its incident")
        m["keyboard"] = True
    if attachment:
        m["attachment"] = attachment
    return m


def fault_note(check: str | None) -> str | None:
    """A Kiosk fault's note: what to check on site, labelled ("Check: …"), or None."""
    return f"Check: {check}" if check else None


def fault(summary: str, *, task_id: int | None = None, check: str | None = None, entity_id: str | None = None) -> dict:
    """A task as a fault in the VESTA Kiosk: its title says what is wrong, its note what to check."""
    return {"action": "ticket", "summary": summary, "task_id": task_id, "note": fault_note(check),
            "entity_id": entity_id if entity_id and "," not in entity_id else None}


def resolved(task_id: int, note: str | None = None) -> dict:
    """A task's fault resolved in the VESTA Kiosk."""
    return {"action": "ticket.resolve", "task_id": task_id, "note": note or None}


def snapshot(entity_id: str, incident: int) -> dict:
    """A camera's picture, sent with an alert."""
    return {"action": "snapshot.get", "entity_id": entity_id, "incident_id": int(incident)}


def settle(incident: int, note: str) -> dict:
    """Every message carrying the incident's buttons loses them and shows `note` ("{time}": the villa's time)."""
    return {"incident_id": int(incident), "note": note}


def ha_message(incident: int, text: str, context: str | None) -> dict:
    """Home Assistant's own messages of the automation run `context` (the event's context) become `incident`'s
    messages, rewritten as `text` — its number and the original alert, like every other message about it."""
    return {"incident_id": int(incident), "text": text, "context": context}


def siren(armed: bool, prompt: str | None, to: tuple[str, ...] = ("owner", "fm"), **detail) -> dict:
    """The siren's gate. Armed: the owner gets an Approve / Refuse request (the configured siren); with no siren
    configured, `prompt` goes to `to` as it is. Never fired by a script."""
    return {"armed": bool(armed), "prompt": prompt, "to": list(to), **detail}
