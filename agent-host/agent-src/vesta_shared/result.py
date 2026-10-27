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

from .limits import limit
from .message_format import PRESSED_STAGE, STEPS
from .messaging import problem_title_chars

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

#: The night check's findings about a WHOLE device (offline, silent, keeps dropping: grouped per physical device by the
#: night, knowledge_pack.device_key); every other finding is about one reading (a pump's power, a battery, a level).
#: What a report names a problem by follows it (knowledge_pack.subject).
WHOLE_DEVICE = frozenset({"PM-UNAVAILABLE", "PM-SILENT", "PM-RECONNECT-LOOP"})

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
            title: str | None = None, first_in_line: bool = False, key: str | None = None,
            status_in: dict | None = None) -> dict:
    """A message for `to` (here · owner · fm). `buttons`: the alert's Done / Need help for `incident`; `stage`: what
    this notice about it is (STAGES) — the engine writes its heading and its history line. "{time}" in `text` is the
    villa's time when it is sent (10/10/2026 15:04), as in a settle note. `status`: where it stands, shown under a line
    at the bottom (vesta_agent/layout.py) — given apart, never written into `text`. `first_in_line`: the people asked
    to answer it (the alert desk's chase) — when Telegram refused every chat it went to, the engine says so
    (Problems.unreached) and the desk hands the incident on. `status_in`: the status in other languages ({code: text},
    the skill's own words): each chat's copy of an alert says the one it reads (vesta_shared.status_words.pick)."""
    m = {"to": to, "text": text}
    if status:
        m["status"] = status
        m.update(_in("status_in", status_in))
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
    if key is not None:
        m["key"] = _key(key)        # a later result may rewrite it in place (edit), never a new message
    return _mark(m, mark)


def _key(key: str) -> str:
    key = str(key)
    if not key or len(key) > 120 or "\n" in key:
        raise ValueError("a message key is one line of at most 120 characters")
    return key


def edit(key: str, text: str, title: str | None = None, *, fallback: str | None = None, to: str | None = None,
         fallback_title: str | None = None) -> dict:
    """Rewrite the message sent earlier with `key` (message(key=…)), in every chat it went to, in its layout: its new
    `text` and, when given, its new `title`. Carried under a result's "edits".

    ⚠️ AND A BACKUP WHEN IT CANNOT BE (owner, 2026-10-20: "isn't it a risk of never receiving the information?"): with
    `fallback`, a chat whose copy cannot be rewritten (Telegram refuses, it was deleted, it was two pages) gets ONE new
    message saying `fallback`, as a reply to the copy it could not rewrite; when no copy was kept at all, it goes to
    `to` (a role) under `fallback_title`. Without `fallback`, it is left as it is — the engine logs it."""
    e = {"key": _key(key), "text": text}
    if title:
        e["title"] = title
    if fallback:
        e["fallback"] = str(fallback)
        if to:
            e["to"] = str(to)
        if fallback_title:
            e["fallback_title"] = str(fallback_title)
    return e


def fault_note(check: str | None) -> str | None:
    """A Kiosk fault's note: what to do on site, labelled as the alert says it on Telegram ("What to do: …"), or None
    (review 29: "Check: Check the device named…" — the label repeated the check's own first word)."""
    return f"What to do: {check}" if check else None


def fault(summary: str, *, check: str | None = None, entity_id: str | None = None, task_id: int | None = None) -> dict:
    """A fault in the VESTA Kiosk about NO task (a chat's): its title says what is wrong, its note what to check.
    (`task_id`: only a skill edited on a villa before 0.6.258 passes it — the engine reads that as faults_changed.)"""
    return {"action": "ticket", "summary": summary, "note": fault_note(check),
            "entity_id": entity_id if entity_id and "," not in entity_id else None,
            **({"task_id": task_id} if task_id else {})}


# ⚠️ A FAULT ACTION CARRIES ONLY WHAT IS READ (architecture review, 2026-10-19): a task's fault opened, reopened or
# resolved was three actions full of words — a title, a note, who — that the engine collapsed into "a fault moved" and
# never read: tickets.repair makes every fault what Problems.card says. A task's change is now this one action. The
# engine still reads the older three (an edited starter skill on a villa keeps sending them) as the same.
def faults_changed() -> dict:
    """The Kiosk's faults about tasks must be brought up to date (a task opened, reopened or closed): the engine runs
    its repair, which works out what each fault says. The same as a result's top-level FAULTS_CHANGED."""
    return {"action": FAULTS_CHANGED}


#: The older shapes of a task's fault change, kept for a skill edited on a villa (updates keep it) that still builds
#: them: the engine reads each as faults_changed(), its words unread. The starter skills no longer call them
#: (tests/test_outcome.py holds it).
def reopened(task_id: int, title: str, note: str = "") -> dict:
    title_max = problem_title_chars()
    note_max = limit("kiosk.update_note_chars", 500, unit="characters", group="text", lo=100, hi=5000,
                     says="The longest note added to a fault's update in the VESTA Kiosk.",
                     reached="The rest of the note is cut, with no mark.", told="")
    return {"action": "ticket.reopen", "task_id": int(task_id), "title": title[:title_max], "note": note[:note_max]}


def resolved(task_id: int, note: str | None = None, who: str | None = None) -> dict:
    return {"action": "ticket.resolve", "task_id": task_id, "note": note or None, **({"who": who} if who else {})}


def moved(task_ids) -> list[dict]:
    """[faults_changed()] when any task's fault moved, else []: what Problems.close_* hand a script's `actions`."""
    return [faults_changed()] if list(task_ids) else []


def snapshot(entity_id: str, incident: int) -> dict:
    """A camera's picture, sent with an alert."""
    return {"action": "snapshot.get", "entity_id": entity_id, "incident_id": int(incident)}


def _in(key: str, texts: dict | None) -> dict:
    """{key: the words in other languages} — only real words, English left out (it is the plain field); {} for none."""
    got = {k: v for k, v in (texts or {}).items() if isinstance(k, str) and k != "en" and isinstance(v, str) and v}
    return {key: got} if got else {}


def settle(incident: int, note: str, mark: str | None = None, note_in: dict | None = None, final: bool = False) -> dict:
    """Every message carrying the incident's buttons loses them and shows `note` ("{time}": the villa's time); `mark`:
    MARKS; `note_in`: the note in other languages ({code: text}), each chat showing the one it reads. `final`: the
    incident's last word, its watch over — every copy, settled or not, keeps where it stood as a line of its Status and
    shows `note` under it (IncidentThread.close)."""
    return _mark({"incident_id": int(incident), "note": note, **_in("note_in", note_in),
                  **({"final": True} if final else {})}, mark)


def ha_message(incident: int, text: str, context: str | None, stage: str | None = None, status: str | None = None,
               status_in: dict | None = None) -> dict:
    """Home Assistant's own messages of the automation run `context` (the event's context) become `incident`'s
    messages, rewritten as `text` under the incident's heading, like every other notice about it (`stage`: STAGES;
    `status_in`: as `message`'s)."""
    m = {"incident_id": int(incident), "text": text, "context": context,
         **({"status": status, **_in("status_in", status_in)} if status else {})}
    if stage is not None:
        if stage not in STAGES:
            raise ValueError(f"stage must be one of {', '.join(STAGES)}")
        m["stage"] = stage
    return m


def siren(armed: bool, prompt: str | None, to: tuple[str, ...] = ("owner", "fm"), **detail) -> dict:
    """The siren's gate. Armed: the owner gets an Approve / Refuse request (the configured siren); with no siren
    configured, `prompt` goes to `to` as it is. Never fired by a script."""
    return {"armed": bool(armed), "prompt": prompt, "to": list(to), **detail}
