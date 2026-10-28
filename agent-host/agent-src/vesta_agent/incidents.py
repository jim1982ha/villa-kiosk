"""The alert desk's incidents as the engine reads them — whether one waits for an answer, is closed, how often it came,
its priority — and the one thing the engine writes on one: nobody asked to answer received it.

⚠️ ONE READER (architecture review scan 1, 2026-10-19): the alert buttons opened the skill store themselves, app.py
held three helpers that each opened it again and were handed to the notices as lambdas, and Outcome reached into the
Kiosk tickets' private store to mark an alert unreached. The incident itself lives in the skills' store (the alert
desk's, vesta_shared.store); what each chat shows of it is incident_thread.py's — this is the seam between the two.
"""
from __future__ import annotations

from vesta_shared.problems import Problems, alert_name, incident_runs, priority_of
from datetime import datetime

from vesta_shared import alert_watch
from vesta_shared.store import Incident, Notes, Store, notes_of


class Incidents:
    def __init__(self, store_path: str):
        self.store_path = store_path

    def _store(self) -> Store:
        return Store(self.store_path)

    def _get(self, iid) -> dict | None:
        return self._store().incident(int(iid)) if str(iid).isdigit() else None

    def awaiting_answer(self, iid: int | str) -> bool:
        """Is incident `iid` still waiting for an answer — not closed, and not taken on in the VESTA Kiosk (someone has
        it: owner, 2026-10-15)? Its messages then carry the buttons."""
        inc = self._get(iid)
        return bool(inc) and not inc.get("closed_at") and inc.get("state") != Incident.TAKEN

    def closed(self, iid: int) -> bool:
        """Is the incident closed (the notices' heading: "Closed")?"""
        return bool((self._get(iid) or {}).get("closed_at"))

    def watching(self, iid: int, now: datetime | None = None) -> bool:
        """Is closed incident `iid` still watched (its copies titled "(watch)", owner 2026-10-25)? The one answer
        (vesta_shared.alert_watch.watching), the one the desk's last word and the Cockpit's confirmsBy read.
        ⚠️ A DAY TYPED HERE (architecture review, 2026-10-26): a watch nobody ended was "(watch)" for one day written
        here, while the desk left it after its own setting (alerts.late_close_days)."""
        inc = self._get(iid)
        return bool(inc) and alert_watch.watching(inc, now)

    def runs(self, iid: int) -> int | None:
        """How many times it alerted in the last days (a "Back at …" step says it); None for no such incident."""
        store = self._store()
        inc = store.incident(int(iid))
        return incident_runs(dict(inc), store) if inc else None

    def name(self, iid: int | str) -> str:
        """How the alert is named everywhere ("#9-P2": problems.alert_name)."""
        return alert_name(self._store(), iid)

    def severity(self, iid: int) -> str | None:
        """Its priority (P1…P4): the notices' heading says it."""
        return priority_of(self._get(iid))

    def reaches(self, iid: int) -> list[str] | None:
        """Whom its priority reaches, as the alert desk carried it (store.Notes.TO): roles ("owner", "fm"), or what the
        priority does instead ("digest", "log") when it reaches nobody — the heading's "To:" (owner, 2026-10-17: it
        follows the priority, never the chat). None for an incident the desk did not say (an older desk, no incident)."""
        to = notes_of(self._get(iid)).get(Notes.TO)
        return [str(x) for x in to] if isinstance(to, list) else None

    def entities(self, iid: int) -> list[str]:
        """The entities its alert is about, as its event named them (its notes' `entities`, else its key's entity ids):
        the names its text says of them are values, never words to translate (translation.py)."""
        inc = self._get(iid)
        if not inc:
            return []
        ents = notes_of(inc).get("entities")
        ents = [ents] if isinstance(ents, str) else ents
        if not isinstance(ents, list):
            ents = str(inc.get("entity_id") or "").split(",")
        return [str(e).strip() for e in ents if isinstance(e, str) and "." in e]

    def unreached(self, iid: int) -> None:
        """Telegram refused every chat of the people asked to answer it: the alert desk hands it on at its next tick."""
        Problems(self._store()).unreached(iid)
