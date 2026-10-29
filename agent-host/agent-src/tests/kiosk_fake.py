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
#: The step kinds this Kiosk shows, the fault fields and check words it reads (/agent/v1/info `step_kinds`,
#: `ticket_fields`, `ticket_checks`), from
#: the agreement the host carries — as the Kiosk's proxy answers them.
_AGREEMENT = json.loads((Path(__file__).resolve().parents[2] / "rootfs/opt/vesta/host/agent-contract.json").read_text())
STEP_KINDS = _AGREEMENT["ticketUpdate"]["kinds"]
TICKET_FIELDS = sorted(_AGREEMENT["ticket"]["fields"])
TICKET_CHECKS = list(_AGREEMENT["ticket"]["checks"])
#: What a message's rewrite keeps of the record it replaces, as the add-on keeps it (vestaMessage.keptOnRewrite)
KEPT_ON_REWRITE = tuple(_AGREEMENT["vestaMessage"]["keptOnRewrite"])


class FakeKiosk(Kiosk):
    def __init__(self, *tickets: dict):
        super().__init__("http://kiosk.invalid", "token")
        self.doc = {"data": {"tickets": [copy.deepcopy(t) for t in tickets]}, "rev": 1}
        self.info = {"contract": 1, "step_kinds": list(STEP_KINDS), "ticket_fields": list(TICKET_FIELDS),
                     "ticket_checks": list(TICKET_CHECKS)}
        self.documents: list | None = []
        self._made: list[str] = []
        self._refused: dict[str, tuple[int, str]] = {}   # refuses(): {ticket id: (status, the proxy's sentence)}
        self.pushed: list[dict] = []           # every message pushed for the tablet, in order (/agent/v1/vesta-message)
        self.messages: dict[str, dict] = {}    # …and what the tablet holds: the last of each key (the add-on replaces by key)
        self.keeps_messages = True             # False plays an older Kiosk (404): it keeps none
        self.message_refusals = 0              # how many pushes it answers 500 first (a Kiosk restarting)
        self.asks: list[dict] = []             # the tablets' questions it keeps (person_asks), numbered as the add-on does
        self.turns: dict[str, dict] = {}       # each conversation turn the agent wrote, by key (a rewrite replaces it)
        self.turns_pushed: list[dict] = []     # ...and every write, in order
        self.keeps_turns = True                # False plays an older Kiosk (404): no inbox, no conversation
        self.voices: dict[str, bytes] = {}     # each spoken question's WAV still kept (person_speaks), read once
        self.heard: dict[str, str] = {}        # the words the agent heard, by the person's line (ask:<seq>)

    # ------------------------------------------------------------------ the one thing replaced: the transport
    async def _req(self, method, path, body=None, **_):
        if path.startswith("/agent/v1/voice/"):
            # the add-on's rule (_take_voice): the sound read ONCE, then gone
            data = self.voices.pop(path.rsplit("/", 1)[1], None) if self.keeps_turns else None
            return (200, data) if data is not None else (404, {"error": "not found"})
        if path == "/agent/v1/conversation-turn" and "heard" in (body or {}):
            # the add-on's rule (_heard_line): onto a spoken question of that profile, once
            ask = next((a for a in self.asks if f"ask:{a['seq']}" == body.get("key")), None)
            if (ask is None or "voice" not in ask or ask["profile"] != body.get("profile") or body["key"] in self.heard
                    or set(body) != {"key", "profile", "heard"}):
                return 400, {"error": "not a spoken question"}
            self.heard[body["key"]] = body["heard"].strip()
            return 200, {"ok": True}
        if path.startswith("/agent/v1/inbox"):
            if not self.keeps_turns:
                return 404, {"error": "not found"}
            after = int(path.split("after=")[1]) if "after=" in path else None
            items = [a for a in self.asks if after is None or a["seq"] > after]
            return 200, {"asks": copy.deepcopy(items), "last": self.asks[-1]["seq"] if self.asks else 0,
                         "first": self.asks[0]["seq"] if self.asks else 1}
        if path == "/agent/v1/conversation-turn":
            if not self.keeps_turns:
                return 404, {"error": "not found"}
            # the add-on's rule (_turn_record): never a person's line, a profile it names, something said or withdrawn
            if (str(body.get("key", "")).startswith("ask:") or body.get("profile") not in _AGREEMENT["conversation"]["profiles"]
                    or not (body.get("text") or body.get("photos") or body.get("page") or body.get("gone")
                            or body.get("typing"))):
                return 400, {"error": "not a turn"}
            self.turns_pushed.append(copy.deepcopy(body))
            self.turns[body["key"]] = copy.deepcopy(body)
            return 200, {"ok": True, "seq": len(self.turns_pushed)}
        if path == "/agent/v1/fm-data":
            if method == "GET":
                return 200, copy.deepcopy(self.doc)
            if body.get("rev") != self.doc["rev"]:
                return 409, {"error": "changed since read"}
            for tid, (status, sentence) in self._refused.items():
                was = next((t for t in self._all() if t.get("id") == tid), None)
                now = next((t for t in body["data"].get("tickets") or [] if t.get("id") == tid), None)
                if was != now:                                # a write that touches a refused fault: the proxy's no
                    return status, {"error": sentence}
            self.doc["data"], self.doc["rev"] = copy.deepcopy(body["data"]), self.doc["rev"] + 1   # in place: a test
                                                                                                # may hold self.doc
            return 200, {}
        if path == "/agent/v1/info":
            return 200, dict(self.info)
        if path == "/agent/v1/vesta-message":
            if not self.keeps_messages:
                return 404, {"error": "not found"}
            if self.message_refusals:
                self.message_refusals -= 1
                return 500, {"error": "restarting"}
            self.pushed.append(copy.deepcopy(body))
            # the agreement's rule, as the add-on keeps it (_announcements_with): what a rewrite naming none keeps
            was = self.messages.get(body["key"]) or {}
            self.messages[body["key"]] = {**{f: was[f] for f in KEPT_ON_REWRITE if f in was and f not in body},
                                          **copy.deepcopy(body)}
            return 200, {"ok": True, "seq": len(self.pushed)}
        return 200, {}

    def _ticket_id(self) -> str:
        tid = f"t{len(self._made) + 1}"
        self._made.append(tid)
        return tid

    async def add_document(self, html: bytes, did: str | None = None):
        """A Kiosk that holds documents (2.496.326+); `self.documents = None` plays an older one (no document kept)."""
        if self.documents is None:
            return None
        self.documents.append(html)
        return did or f"d{len(self.documents)}"

    def refuses(self, tid: str, status: int = 403, sentence: str = "this write is not allowed") -> None:
        """The Kiosk's proxy refuses every write that changes fault `tid` (a new one included: its id is the next the
        agent makes, t1, t2 …), answering `status` and its own `sentence` — as it refuses a removal or an unknown field."""
        self._refused[tid] = (status, sentence)

    def person_asks(self, profile: str, text: str) -> dict:
        """A question typed on a tablet signed in as `profile`, kept in the inbox as the add-on keeps it (stamped)."""
        ask = {"seq": (self.asks[-1]["seq"] if self.asks else 0) + 1, "at": PERSON_AT, "profile": profile, "text": text}
        self.asks.append(ask)
        return ask

    def person_speaks(self, profile: str, wav: bytes) -> dict:
        """A question spoken on a tablet signed in as `profile` (hold to talk): its WAV kept apart, the ask naming it."""
        name = f"{len(self.voices) + len(self.asks) + 1:032x}"
        self.voices[name] = wav
        ask = {"seq": (self.asks[-1]["seq"] if self.asks else 0) + 1, "at": PERSON_AT, "profile": profile, "voice": name}
        self.asks.append(ask)
        return ask

    def person_presses(self, profile: str, key: str, kind: str, bid: str) -> dict:
        """One of VESTA's buttons pressed on a tablet signed in as `profile`, kept as the add-on keeps it (stamped)."""
        ask = {"seq": (self.asks[-1]["seq"] if self.asks else 0) + 1, "at": PERSON_AT, "profile": profile,
               "press": {"key": key, "kind": kind, "id": bid}}
        self.asks.append(ask)
        return ask

    def conversation(self, profile: str) -> list[dict]:
        """What the tablet of `profile` shows of VESTA's answers, in order: each turn as it stands, none withdrawn."""
        return [t for t in self.turns.values() if t.get("profile") == profile and not t.get("gone") and "answers" not in t
                and not t.get("typing")]

    def answer(self, profile: str, press: int) -> str | None:
        """What the tablet shows under the button of press `press`: VESTA's short answer."""
        return next((t["text"] for t in self.turns.values() if t.get("profile") == profile and t.get("answers") == press),
                    None)

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

    def person_closes(self, tid: str, by: str = "Facility manager", at: str = PERSON_AT, cockpit: bool = False) -> None:
        """A person's close. `cockpit`: as the Cockpit's Close writes it (fmEngine.withTicketClosed: kind "cleared",
        "Closed without action", by the profile) — else a close with no kind (a ticket's "Mark resolved")."""
        step = {"at": at, "status": "resolved", "by": by}
        if cockpit:
            step.update(kind=CLEARED, note="Closed without action", photoIds=[])
        self._step(tid, step, status="resolved", resolvedAt=at)

    def person_reopens(self, tid: str, by: str = "Owner", at: str = "2099-01-01T00:00:00.000Z") -> None:
        self.ticket(tid).pop("resolvedAt", None)
        self._step(tid, {"at": at, "status": "open", "by": by, "kind": REOPENED}, status="open")

    def person_moves(self, tid: str, by: str = "Facility manager", at: str = PERSON_AT) -> None:
        """Picked up ("Open ticket" in the Cockpit): in progress, the person's step last."""
        self._step(tid, {"at": at, "status": "in_progress", "by": by}, status="in_progress")

    def person_renames(self, tid: str, title: str, by: str = "Owner", at: str = PERSON_AT) -> None:
        was = self.ticket(tid).get("title")
        self._step(tid, {"at": at, "status": self.ticket(tid)["status"], "by": by, "kind": RETITLED,
                         "title": title, "was": was}, title=title)

    # ------------------------------------------------------------------ views, read from the document
    def _kept(self) -> list[str]:
        """The ids the agent made that the document holds (one the proxy refused was never written)."""
        return [t for t in self._made if any(x.get("id") == t for x in self._all())]

    @property
    def tickets(self) -> list[tuple]:
        return [((self.ticket(t).get("updates") or [{}])[0].get("title") or self.ticket(t)["title"],
                 self.ticket(t).get("entityId")) for t in self._kept()]

    @property
    def notes(self) -> list:
        return [self.ticket(t).get("note") for t in self._kept()]

    @property
    def ticket_documents(self) -> list[list[str]]:
        return [list(self.ticket(t).get("documentIds") or []) for t in self._kept()]

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

