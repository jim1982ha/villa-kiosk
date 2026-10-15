"""The tests' VESTA Kiosk: the REAL vesta_agent.kiosk.Kiosk over an in-memory Facility records document.

⚠️ NO RULE OF ITS OWN (architecture review, 2026-10-14). The stand-in used to re-implement the Kiosk's ticket rules and
drifted from them in five places — a resolve recorded no person and no completion, a fault a person closed could still
be retitled, a reopen of an unknown fault "succeeded" — so a Done lost in a Kiosk outage and recorded as "cleared by
the agent" passed every test. Now only the transport is replaced (`_req`: GET/PUT /agent/v1/fm-data, info, heartbeat);
every rule runs as in production. What a PERSON does in the Cockpit is written to the document as the Kiosk app writes
it (held, person_closes, person_reopens, person_moves, person_renames).

Views, read from the document (for assertions):
    tickets   [(title it was created with, entity_id)] the agent created, ids t1, t2 …   notes, ticket_documents: same order
    resolved  [ticket id] the agent resolved            reopened  [(ticket id, title)] the agent reopened
    readings  [(ticket id, title)] under a person's title    titles  {ticket id: title now}    numbers  {ticket id: #N}
    ticket(tid)  the record itself        documents  [html] kept (None: a Kiosk older than 2.496.326, keeps none)
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from vesta_agent.kiosk import CLEARED, READING, REOPENED, RETITLED, Kiosk, _mine

PERSON_AT = "2026-10-01T08:00:00.000Z"
#: The step kinds this Kiosk shows and the fault fields it reads (/agent/v1/info `step_kinds`, `ticket_fields`), from
#: the agreement the host carries — as the Kiosk's proxy answers them.
_AGREEMENT = json.loads((Path(__file__).resolve().parents[2] / "rootfs/opt/vesta/host/agent-contract.json").read_text())
STEP_KINDS = _AGREEMENT["ticketUpdate"]["kinds"]
TICKET_FIELDS = sorted(_AGREEMENT["ticket"]["fields"])


class FakeKiosk(Kiosk):
    def __init__(self, *tickets: dict):
        super().__init__("http://kiosk.invalid", "token")
        self.doc = {"data": {"tickets": [copy.deepcopy(t) for t in tickets]}, "rev": 1}
        self.info = {"contract": 1, "step_kinds": list(STEP_KINDS), "ticket_fields": list(TICKET_FIELDS)}
        self.documents: list | None = []
        self._made: list[str] = []

    # ------------------------------------------------------------------ the one thing replaced: the transport
    async def _req(self, method, path, body=None):
        if path == "/agent/v1/fm-data":
            if method == "GET":
                return 200, copy.deepcopy(self.doc)
            if body.get("rev") != self.doc["rev"]:
                return 409, {"error": "changed since read"}
            self.doc["data"], self.doc["rev"] = copy.deepcopy(body["data"]), self.doc["rev"] + 1   # in place: a test
                                                                                                # may hold self.doc
            return 200, {}
        if path == "/agent/v1/info":
            return 200, dict(self.info)
        return 200, {}

    def _ticket_id(self) -> str:
        tid = f"t{len(self._made) + 1}"
        self._made.append(tid)
        return tid

    async def add_document(self, html: bytes):
        """A Kiosk that holds documents (2.496.326+); `self.documents = None` plays an older one (no document kept)."""
        if self.documents is None:
            return None
        self.documents.append(html)
        return f"d{len(self.documents)}"

    # ------------------------------------------------------------------ what a person does in the Cockpit
    def _all(self) -> list[dict]:
        return self.doc["data"].setdefault("tickets", [])

    def ticket(self, tid: str) -> dict:
        return next(t for t in self._all() if t.get("id") == tid)

    def _step(self, tid: str, step: dict, **fields) -> None:
        t = self.ticket(tid)
        t.update(fields)
        t["updates"] = list(t.get("updates") or []) + [{"photoIds": [], **step}]
        self.doc["rev"] += 1

    def held(self, *ids: str, title: str = "", status: str = "open") -> None:
        """Faults the Kiosk has from before (no step of the agent's: the agent never said their title)."""
        for tid in ids:
            self._all().append({"id": tid, "title": title or tid, "status": status, "openedAt": PERSON_AT,
                                "photoIds": [], "updates": []})

    def person_closes(self, tid: str, by: str = "Facility manager", at: str = PERSON_AT) -> None:
        self._step(tid, {"at": at, "status": "resolved", "by": by}, status="resolved", resolvedAt=at)

    def person_reopens(self, tid: str, by: str = "Owner", at: str = "2099-01-01T00:00:00.000Z") -> None:
        self.ticket(tid).pop("resolvedAt", None)
        self._step(tid, {"at": at, "status": "open", "by": by, "kind": REOPENED}, status="open")

    def person_moves(self, tid: str, by: str = "Facility manager", at: str = PERSON_AT) -> None:
        """Picked up ("Open ticket" in the Cockpit): in progress, the person's step last."""
        self._step(tid, {"at": at, "status": "in_progress", "by": by}, status="in_progress")

    def person_renames(self, tid: str, title: str, by: str = "Owner") -> None:
        was = self.ticket(tid).get("title")
        self._step(tid, {"at": PERSON_AT, "status": self.ticket(tid)["status"], "by": by, "kind": RETITLED,
                         "title": title, "was": was}, title=title)

    # ------------------------------------------------------------------ views, read from the document
    @property
    def tickets(self) -> list[tuple]:
        return [((self.ticket(t).get("updates") or [{}])[0].get("title") or self.ticket(t)["title"],
                 self.ticket(t).get("entityId")) for t in self._made]

    @property
    def notes(self) -> list:
        return [self.ticket(t).get("note") for t in self._made]

    @property
    def ticket_documents(self) -> list[list[str]]:
        return [list(self.ticket(t).get("documentIds") or []) for t in self._made]

    @property
    def titles(self) -> dict[str, str]:
        return {t["id"]: t.get("title") for t in self._all()}

    @property
    def origins(self) -> dict[str, str]:
        return {t["id"]: t["origin"] for t in self._all() if "origin" in t}

    @property
    def numbers(self) -> dict[str, int]:
        return {t["id"]: t["alertNumber"] for t in self._all() if "alertNumber" in t}

    def _steps(self, kind=None):
        for t in self._all():
            for u in t.get("updates") or []:
                if _mine(u) and (kind is None or u.get("kind") == kind):
                    yield t, u

    @property
    def resolved(self) -> list[str]:
        """Faults the agent resolved and that are still resolved, in the order it resolved them."""
        done = [(u["at"], i, t["id"]) for i, (t, u) in enumerate(self._steps())
                if u.get("status") == "resolved" and t.get("status") == "resolved"]
        return [tid for _, _, tid in sorted(done)]

    @property
    def reopened(self) -> list[tuple[str, str]]:
        return [(t["id"], u.get("title")) for t, u in self._steps(REOPENED)]

    @property
    def readings(self) -> list[tuple[str, str]]:
        return [(t["id"], u.get("title")) for t, u in self._steps(READING)]

    @property
    def cleared(self) -> list[str]:
        """Faults the agent closed as its own clearing (no work done), not a person's Done."""
        return [t["id"] for t, u in self._steps(CLEARED)]

