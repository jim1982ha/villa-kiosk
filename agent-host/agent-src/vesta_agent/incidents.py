"""The alert desk's incidents as the engine reads them — whether one waits for an answer, is closed, how often it came,
its priority — and the one thing the engine writes on one: nobody asked to answer received it.

⚠️ ONE READER (architecture review scan 1, 2026-10-19): the alert buttons opened the skill store themselves, app.py
held three helpers that each opened it again and were handed to the notices as lambdas, and Outcome reached into the
Kiosk tickets' private store to mark an alert unreached. The incident itself lives in the skills' store (the alert
desk's, vesta_shared.store); what each chat shows of it is incident_thread.py's — this is the seam between the two.
"""
from __future__ import annotations

from vesta_shared.problems import Problems, incident_runs
from vesta_shared.result import PRIORITIES
from vesta_shared.store import Incident, Store


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

    def runs(self, iid: int) -> int | None:
        """How many times it alerted in the last days (a "Back at …" step says it); None for no such incident."""
        store = self._store()
        inc = store.incident(int(iid))
        return incident_runs(dict(inc), store) if inc else None

    def severity(self, iid: int) -> str | None:
        """Its priority (P1…P4): the notices' heading says it."""
        sev = str((self._get(iid) or {}).get("severity") or "")
        return sev if sev in PRIORITIES else None

    def unreached(self, iid: int) -> None:
        """Telegram refused every chat of the people asked to answer it: the alert desk hands it on at its next tick."""
        Problems(self._store()).unreached(iid)
