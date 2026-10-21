"""The VESTA Kiosk agent interface v1: the heartbeat and the Facility tickets.

Only two jobs, one mechanism each:
  presence   POST /agent/v1/heartbeat: the Kiosk shows the agent online / offline, by a window
             it hands out in its answer (offline_after_minutes); the agent beats three
             times within it (beat_every)
  FM tasks   a ticket in the Facility records (GET, then PUT /agent/v1/fm-data with
             the revision read): the facility manager's work lives in one place,
             and the Kiosk stamps every record the agent writes "By VESTA Agent"

The Kiosk's messages and choices (/agent/v1/messages, /choices) were never used —
people talk to the agent on Telegram (decision D4, 2026-09-30) — and the Kiosk
removed them in 2.496.445.

⚠️ THE AGENT NEVER REMOVES A RECORD. The Kiosk refuses it anyway (403); every
write here starts from the document just read and only adds or updates.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Callable

import aiohttp

from vesta_shared import agreement
from vesta_shared.ha_client import error_short_chars
from vesta_shared.limits import limit

log = logging.getLogger("vesta.kiosk")

CONTRACT = 1

#: The heartbeat's interval before the Kiosk has answered one (seconds); then a third of the window it hands out
#: (`offline_after_minutes`), never under BEAT_FLOOR_S. ⚠️ THE KIOSK'S WINDOW, READ (architecture review, 2026-10-19):
#: 120 s was typed here and the answer thrown away — a Kiosk set to "offline after 1 minute" showed the agent offline
#: and online by turns, every cycle.
BEAT_BEFORE_ANSWER_S = 120
BEAT_FLOOR_S = 30
BEATS_PER_WINDOW = 3


def beat_every(answer: dict, current: float) -> float:
    """The heartbeat's interval after the Kiosk's `answer`: a third of its `offline_after_minutes`, never under
    BEAT_FLOOR_S; `current` when the answer names no window."""
    minutes = (answer or {}).get("offline_after_minutes")
    if isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or minutes <= 0:
        return current
    return max(float(BEAT_FLOOR_S), minutes * 60 / BEATS_PER_WINDOW)



#: The start of every fault id the agent writes ("va-…"): a fault the agent made, whoever holds it now.
MINE = "va-"


def fault_title_chars() -> int:
    return limit("kiosk.fault_title_chars", 200, unit="characters", group="text", lo=60, hi=2000,
                 says="The longest title of a fault sent to the VESTA Kiosk.",
                 reached="The rest of the title is cut, with no mark.", told="")


def fault_note_chars() -> int:
    return limit("kiosk.fault_note_chars", 2000, unit="characters", group="text", lo=200, hi=20000,
                 says="The longest note a fault keeps in the VESTA Kiosk (what the facility manager reads).",
                 reached="The rest of the note is cut, with no mark.", told="")


def update_note_chars() -> int:
    return limit("kiosk.update_note_chars", 500, unit="characters", group="text", lo=100, hi=5000,
                 says="The longest note added to a fault's update in the VESTA Kiosk.",
                 reached="The rest of the note is cut, with no mark.", told="")


def who_chars() -> int:
    return limit("kiosk.who_chars", 80, unit="characters", group="text", lo=20, hi=500,
                 says="The longest name of who acted, shown on a fault's update.",
                 reached="The rest of the name is cut.", told="")


def kiosk_timeout_s() -> float:
    return limit("kiosk.timeout_s", 30, unit="seconds", group="run", lo=5, hi=600,
                 says="How long the agent waits for the VESTA Kiosk to answer.",
                 reached="That exchange fails: a fault not recorded is said so; the next try comes later.",
                 told="person")

class KioskError(RuntimeError):
    """What the Kiosk answered, or that it could not be reached. `status`: the answer of a refusal (403: a write its
    proxy forbids, 409: a record that kept changing, 5xx…) — None when the Kiosk could not be reached at all (connection
    refused, a timeout: every fault after it would fail the same way); `said`: the proxy's own sentence, kept whole.
    ⚠️ THE SENTENCE TRAVELS (architecture review round 2, 2026-10-19): only "KioskError" reached the log and the chat
    ("The Kiosk did not record the ticket (KioskError).") while the proxy had said why."""

    def __init__(self, message: str, status: int | None = None, said: str = ""):
        super().__init__(message)
        self.status, self.said = status, said

    @property
    def refused(self) -> bool:
        """The Kiosk answered and said no — the next fault may still go through; unreached (None), it will not."""
        return self.status is not None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# What a step in a fault's history is — the agreement's `ticketUpdate.kinds` (agent-contract.json), READ FROM THE FILE
# (architecture review round 3, 2026-10-19: they were typed here and pinned to the file after the fact), never a note's
# first words (architecture review 26: the Kiosk took "Now: …" for a status step and showed it under the title it
# repeated). A step without a kind changes the status.
KINDS: tuple[str, ...] = tuple(str(k) for k in agreement.section("ticketUpdate").get("kinds") or ())


def _kind(name: str) -> str:
    """The agreement's step kind this engine writes under `name`; one the agreement does not declare is said once in
    the log (the Kiosk's proxy refuses a step of a kind it does not know — a copy of the file too old for this engine)."""
    if name not in KINDS:
        log.warning("The agreement with the Kiosk declares no step kind %r (ticketUpdate.kinds: %s)", name, list(KINDS))
    return name


REOPENED, RETITLED, READING, NOTED, CLEARED = (_kind(k) for k in ("reopened", "retitled", "reading", "noted", "cleared"))
#: This agent's title step before the kinds (0.12.150 and earlier), still read. ⚠️ NOT IN THE AGREEMENT: the Kiosk reads
#: the same words in its src/fm/faultNotes.ts (its twin of this line); the agreement names no key for it, and that file
#: is the Kiosk's to change (a Kiosk release) — so this literal stays, beside its twin's name.
OLD_TITLE_NOTE = "Now: "


#: Who the Kiosk names on a step the agent wrote (its proxy stamps it): the agreement's `ticket.agentStamp`, read from
#: the file. A step written here, not yet through the proxy, has none.
AGENT_BY: str = str(agreement.section("ticket").get("agentStamp") or "")
if not AGENT_BY:
    log.warning("The agreement with the Kiosk names no ticket.agentStamp: every stamped step reads as a person's")


def _mine(u: dict) -> bool:
    return (u.get("by") or AGENT_BY) == AGENT_BY


def taken_step(u: dict) -> bool:
    """The step a PERSON took the fault on with ("Open Ticket": in progress) — the agreement's `ticket.takenStep`, read
    from the file: its `status`, its `kind` (none), and `by` not the stamp `byNot` names (the agent's own steps,
    stamped by the proxy or not yet, are never a take-on)."""
    rule = agreement.section("ticket").get("takenStep") or {}
    if not rule:
        return False
    not_by = agreement.section("ticket").get(str(rule.get("byNot") or "")) or AGENT_BY
    return (u.get("status") == rule.get("status") and (u.get("kind") or None) == rule.get("kind")
            and (u.get("by") or AGENT_BY) != not_by)


def agent_title(t: dict) -> str | None:
    """The title the agent last gave ticket `t` — from its own steps (each says the title it gave), or an old "Now: …"
    note; None when its steps never said (a ticket written before 0.12.151)."""
    for u in reversed([u for u in t.get("updates") or [] if isinstance(u, dict)]):
        if isinstance(u.get("title"), str) and u["title"] and _mine(u):
            return u["title"]
        if not u.get("kind") and str(u.get("note") or "").startswith(OLD_TITLE_NOTE):
            return str(u["note"])[len(OLD_TITLE_NOTE):][:fault_title_chars()]
    return None


def person_titled(t: dict) -> bool:
    """A person gave the ticket its title: the Kiosk's rename step says so (2.496.324), else it is no longer the one the
    agent last gave it; a ticket on which the agent never said its title is presumed the person's.
    ⚠️ THEIRS STAYS (architecture review 26): every night the agent wrote its own back over "Front door — part ordered".
    ⚠️ READ, NOT GUESSED (review 29): a person's rename left no step — an old ticket's title was overwritten once."""
    for u in reversed([u for u in t.get("updates") or [] if isinstance(u, dict)]):
        if u.get("kind") == RETITLED and not _mine(u):
            return True                                            # the last rename was a person's
        if isinstance(u.get("title"), str) and u["title"] and _mine(u):
            break                                                  # the agent titled it after any person did
    mine = agent_title(t)
    return mine is None or str(t.get("title") or "") != mine


def _epoch(iso) -> float | None:
    """A step's moment as a number; None when it cannot be read."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def status_changes(ups: list[dict]) -> list[dict]:
    """The steps that CHANGED the fault's status, in time order — the agreement's `ticketUpdate.histories` rule, as the
    Kiosk's own two readers follow it (fmEngine.statusChanges, the proxy's _fm_last_resolution): a step without a kind
    changes the status, so do reopened and cleared; a kind in the agreement's `notStatusChanges` (a title step, a line
    from Telegram) carries the status the fault had and changes nothing. Stable: steps at one moment keep their order;
    a step whose time cannot be read sorts FIRST (it never outranks a dated close)."""
    skip = set(agreement.section("ticketUpdate").get("notStatusChanges") or ())
    steps = [(i, u) for i, u in enumerate(ups) if u.get("status") and u.get("kind") not in skip]
    steps.sort(key=lambda p: (_epoch(p[1].get("at")) or 0.0, p[0]))
    return [u for _, u in steps]


def last_close(ups: list[dict]) -> dict | None:
    """The step that last resolved the fault — of its status changes, never a title or a Telegram line written after
    it (those carry "resolved" too). None when no step closed it (how it was closed cannot be told)."""
    done = [u for u in status_changes(ups) if u.get("status") == "resolved"]
    return done[-1] if done else None


def cleared_step(step: dict) -> bool:
    """A close with no work done: kind "cleared", or — written before steps carried a kind — a note the agreement names
    (`clearedNotes`, `clearedNotePrefixes`). Only a close is read by its note (the agreement's histories)."""
    if step.get("kind"):
        return step.get("kind") == CLEARED
    table = agreement.section("ticketUpdate")
    note = str(step.get("note") or "")
    return note in (table.get("clearedNotes") or ()) or note.startswith(tuple(table.get("clearedNotePrefixes") or ()))


def fault_of(t: dict) -> dict:
    """One Facility fault as the agent reads it: {status, title, agent_title, resolved_at, by, cleared, reopened_at,
    reopened_by, taken_at, taken_by, noted, note, …} — `by` who closed it, on a closed fault ("Facility manager"; its last
    close's step), on an open one who last moved it (its last step), `agent_title` the title the agent last gave it (None: never said),
    `cleared` whether its last close was one with no work done — the agent's own clearing — (None: no step closed it),
    `reopened_*` / `taken_*` a PERSON's last reopening / "Open Ticket", from its steps. Pure: what a person did is
    read from the Kiosk's steps here and nowhere else (architecture review scan 2, 2026-10-19: the reading sat in
    closures inside the network call — testable only through a fake Kiosk).

    ⚠️ HOW IT WAS CLOSED IS THE AGREEMENT'S RULE (architecture review round 2, 2026-10-19): this took the last step in
    LIST order saying "resolved" — a rename or a Telegram line noted after the agent's own clearing carries "resolved"
    too — and knew only the kind, so a blip the agent cleared and a person renamed was written into its alert's
    history as "Closed in the Cockpit on … (Facility manager)". Now `last_close` / `cleared_step` read the agreement's
    `ticketUpdate` (notStatusChanges, clearedNotes, clearedNotePrefixes) exactly as the Kiosk's own readers do;
    tests/test_contract_ticket.py replays every history the agreement lists."""
    ups = [u for u in t.get("updates") or [] if isinstance(u, dict)]

    def last(key: str) -> str:
        return str(ups[-1].get(key) or "") if ups else ""

    # the step a PERSON took it on with ("Open Ticket": in progress), its who and when — never an agent's step
    took = [u for u in ups if taken_step(u)]
    close = last_close(ups)
    reopens = [u for u in ups if u.get("kind") == REOPENED]
    return {"status": str(t.get("status") or ""), "title": str(t.get("title") or ""),
            "agent_title": agent_title(t), "resolved_at": str(t.get("resolvedAt") or ""),
            # who: on a closed fault, the person of its last close; on an open one, of its last step (taken on, moved)
            "by": (str(close.get("who") or close.get("by") or "") if close and t.get("status") == "resolved"
                   else last("who") or last("by")),
            "alert_number": t.get("alertNumber"), "origin": t.get("origin"),
            "check": t.get("check"), "title_pattern": t.get("titlePattern"), "since": t.get("since"),
            "closes_at": t.get("closesAt"),
            "note": str(t.get("note") or ""),                     # what to do on site (the agreement's ticket.fields)
            "person_titled": person_titled(t), "cleared": cleared_step(close) if close else None,
            "noted": [(str(u.get("at") or ""), str(u.get("note") or "")) for u in ups if u.get("kind") == NOTED],
            **({"reopened_at": str(reopens[-1].get("at") or ""),
                "reopened_by": str(reopens[-1].get("who") or reopens[-1].get("by") or "")} if reopens else {}),
            **({"taken_at": str(took[-1].get("at") or ""),
                "taken_by": str(took[-1].get("who") or took[-1].get("by") or "")} if took else {})}


#: One change the agent makes to an open fault: the ticket as it stands → the ticket changed, None when it has nothing
#: to change (Kiosk.amend applies several in one write).
Amend = Callable[[dict], "dict | None"]


def retitled(title: str) -> Amend:
    """An open ticket says what is wrong NOW (owner, 2026-10-07: "battery at 5 %" stayed while it read 0 %): its title
    follows, its history keeping the one before (a "retitled" step); under a title a person wrote, the title stays
    theirs and the reading is a "reading" step. Nothing when it is closed or already says it."""
    title = title[:fault_title_chars()]

    def amend(t: dict) -> dict | None:
        if t.get("status") == "resolved" or (agent_title(t) or t.get("title")) == title:
            return None
        step = {"at": _now(), "status": t.get("status") or "open", "photoIds": [], "title": title}
        if person_titled(t):
            return dict(t, updates=list(t.get("updates") or []) + [{**step, "kind": READING}])
        return dict(t, title=title, updates=list(t.get("updates") or [])
                    + [{**step, "kind": RETITLED, "was": str(t.get("title") or "")}])
    return amend


def noted(lines: list[dict]) -> Amend:
    """Lines of what happened about an open fault on Telegram ([{at, note}], notice.Notices.story), each a "noted" step
    at its own time; a line the fault already has is not written again."""
    def amend(t: dict) -> dict | None:
        if t.get("status") == "resolved":
            return None
        # ⚠️ BY ITS MOMENT, NEVER ITS WORDS (architecture review, 2026-10-15): a reworded stage ("Reminder sent")
        # or a People change re-wrote every past line, and each was added again under the new words
        have = {u.get("at") for u in t.get("updates") or [] if isinstance(u, dict) and u.get("kind") == NOTED}
        new = [{"at": x["at"], "status": t.get("status") or "open", "photoIds": [], "kind": NOTED,
                "note": str(x["note"])[:update_note_chars()]} for x in lines if x["at"] not in have]
        return dict(t, updates=list(t.get("updates") or []) + new) if new else None
    return amend


#: How this agent labels a fault's note ("What to do: …"; "Check: …" until review 29): a note so labelled is the agent's
#: to bring up to date; any other note on a fault is a person's and stays theirs, as a person's title does.
TODO_LABELS = ("What to do: ", "Check: ")


def todo(note: str) -> Amend:
    """An open fault's note says what to do on site NOW — its problem's words as they stand (Problems.card `todo`,
    result.fault_note): the route's check edited in the alert desk's rules.yaml, a finding's check the night rewrote.
    Only a note this agent wrote (TODO_LABELS), or none; nothing when it is closed, says it, or a person wrote it."""
    def amend(t: dict) -> dict | None:
        cur = str(t.get("note") or "")
        if t.get("status") == "resolved" or cur == note or (cur and not cur.startswith(TODO_LABELS)):
            return None
        return dict(t, note=note[:fault_note_chars()])
    return amend


def tagged(number: int | None = None, origin: str | None = None, check: str | None = None,
           pattern: dict | None = None) -> Amend:
    """A fault made before it carried them gets its alert's number ("#5"), where it came from and how it is read again
    (add_ticket). `pattern`: {"titlePattern", "since"} — both None takes them away (a person retitled it)."""
    tags = {**({"alertNumber": int(number)} if number else {}), **({"origin": origin} if origin else {}),
            **({"check": check} if check else {}), **(pattern or {})}

    def amend(t: dict) -> dict | None:
        if all(t.get(k) == v for k, v in tags.items()):
            return None
        return {k: v for k, v in dict(t, **tags).items() if not (k in tags and v is None)}
    return amend


def closing(at: str | None) -> Amend:
    """An open fault says when the VESTA Agent closes it if what it reported stays over (`closesAt`, owner 2026-10-21:
    "Locked since 14:38 · closes at about 14:49 if it stays locked"), or no longer says it (`at` None: it holds again)."""
    def amend(t: dict) -> dict | None:
        if t.get("status") == "resolved" or t.get("closesAt") == at:
            return None
        return {k: v for k, v in dict(t, closesAt=at).items() if not (k == "closesAt" and v is None)}
    return amend


class Kiosk:
    def __init__(self, url: str, token: str, headers: dict | None = None):
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", **(headers or {})}
        self.enabled = bool(url and token)
        self.info: dict | None = None
        self.every: float = BEAT_BEFORE_ANSWER_S        # the heartbeat's interval: beat_every, from the Kiosk's answer
        self._cadence_refused: str | None = None        # the Kiosk's last "refused: …" of our cadence, said once
        self._lock = asyncio.Lock()

    async def _req(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        timeout = aiohttp.ClientTimeout(total=kiosk_timeout_s())
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=self.headers) as http:
                async with http.request(method, f"{self.url}{path}", json=body) as r:
                    try:
                        data = await r.json(content_type=None)
                    except ValueError:
                        data = {}
                    return r.status, data if isinstance(data, dict) else {}
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            # never the token: only what kind of failure it was
            raise KioskError(f"{method} {path}: {type(e).__name__}") from None

    async def check(self) -> bool:
        """The agreement version. A Kiosk that speaks another one is not written to."""
        if not self.enabled:
            return False
        status, data = await self._req("GET", "/agent/v1/info")
        if status != 200:
            raise KioskError(f"/agent/v1/info answered {status}", status=status)
        if data.get("contract") != CONTRACT:
            raise KioskError(f"the Kiosk speaks agreement {data.get('contract')}, this agent {CONTRACT}")
        self.info = data
        return True

    async def heartbeat(self, status: str | None = None, cadence: dict | None = None) -> dict:
        """`cadence`: this agent's own timing (agent-contract.json `heartbeat`: checkMinutes, nightlyAt) — the Kiosk's
        Overview (i) says it instead of a copy of the defaults (architecture review, 2026-10-15). Returns the Kiosk's
        answer; its window (`offline_after_minutes`) sets the next interval (`every`, beat_every). A cadence the Kiosk
        did not take ("cadence": "refused: …", with a 200) is said once in the log — the beat itself counted."""
        body = {k: v for k, v in (("status", status), ("cadence", cadence)) if v}
        code, answer = await self._req("POST", "/agent/v1/heartbeat", body or None)
        if code != 200:
            raise KioskError(f"heartbeat answered {code}", status=code)
        self.every = beat_every(answer, self.every)
        said = answer.get("cadence")
        if isinstance(said, str) and said.startswith("refused"):
            if said != self._cadence_refused:
                log.warning("The Kiosk did not take this agent's timing: %s", said[:error_short_chars()])
            self._cadence_refused = said
        else:
            self._cadence_refused = None
        return answer

    async def heartbeats(self, stop: asyncio.Event, status=lambda: None, cadence=lambda: None,
                         answered=lambda answer: None) -> None:
        """`answered(answer)`: what the Kiosk said back to each beat (its list of devices unavailable by design)."""
        reported = None
        while not stop.is_set():
            try:
                answered(await self.heartbeat(status(), cadence()))
                if reported:
                    log.info("Kiosk heartbeat: back")
                reported = None
            except KioskError as e:
                if str(e) != reported:
                    log.warning("Kiosk heartbeat failed: %s", e)
                reported = str(e)
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.every)
            except asyncio.TimeoutError:
                pass

    # ------------------------------------------------------------------ Facility tickets
    async def _edit(self, change) -> object:
        """Read the Facility records, apply `change(data)`, write them back with the revision read.

        A 409 means a person saved in between: read again and apply the same change
        once more — their edit stays, ours lands on top of it."""
        async with self._lock:
            for attempt in (1, 2):
                status, got = await self._req("GET", "/agent/v1/fm-data")
                if status != 200:
                    raise KioskError(f"reading the Facility records answered {status}", status=status)
                data = got.get("data") if isinstance(got.get("data"), dict) else {}
                data = dict(data)
                before = json.dumps(data, sort_keys=True, default=str)
                result = change(data)
                if json.dumps(data, sort_keys=True, default=str) == before:
                    return result                    # nothing changed: no write (a write bumps the revision and
                                                     # can turn a person's save into "changed since you opened it")
                status, res = await self._req("PUT", "/agent/v1/fm-data", {"data": data, "rev": got.get("rev")})
                if status == 200:
                    return result
                if status == 409 and attempt == 1:
                    continue
                said = str(res.get("error", ""))[:error_short_chars()]
                raise KioskError(f"writing the Facility records answered {status}: {said}", status=status, said=said)
        raise KioskError("the Facility records kept changing", status=409)

    async def add_document(self, html: bytes) -> str | None:
        """Store one HTML page for a fault (the VESTA Kiosk 2.496.326 and later: /agent/v1/fm-document) — its id, or None
        when this Kiosk cannot hold documents (an older one answers 404) or refused it. Kept with the fault, deleted with it."""
        did = secrets.token_hex(16)
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=limit(
                    "kiosk.document_timeout_s", 60, unit="seconds", group="run", lo=10, hi=600,
                    says="How long the agent waits for the VESTA Kiosk to store a fault's page.",
                    reached="The page is not kept with the fault; the fault itself is.", told="")), headers=self.headers) as http:
                async with http.post(f"{self.url}/agent/v1/fm-document?id={did}", data=html,
                                     headers={"Content-Type": "text/html; charset=utf-8"}) as r:
                    if r.status == 200:
                        return did
                    log.warning("The Kiosk did not keep the document: it answered %s%s", r.status,
                                " (a Kiosk older than 2.496.326 holds no documents)" if r.status == 404 else "")
                    return None
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            raise KioskError(f"POST /agent/v1/fm-document: {type(e).__name__}") from None

    def _ticket_id(self) -> str:
        """A new fault's id ("va-…": written by the VESTA Agent)."""
        return MINE + secrets.token_hex(8)

    async def add_ticket(self, title: str, entity_id: str | None = None, note: str | None = None,
                         document_ids: list[str] | None = None, number: int | None = None,
                         origin: str | None = None, check: str | None = None, pattern: dict | None = None) -> str:
        """`number`: the alert's number, as every chat names it ("#5"), when the fault comes from one — the Kiosk's card
        shows it beside the title (owner, 2026-10-14), so the Telegram message and the card are seen to be one problem.
        `origin`: where the agent made it from — "alert", "night" (its nightly check) or "chat" — the card's source icon.
        `check`: how the agent reads it again to close it — "minutes" or "nightly" (agent-contract `ticket.checks`, both
        read by every Kiosk: `checksBeforeList`) — the card's "Next check". `pattern`: {"titlePattern", "since"}, the duration the card words when shown."""
        tid = self._ticket_id()

        def change(data: dict) -> str:
            tickets = list(data.get("tickets") or [])
            t = {"id": tid, "title": title[:fault_title_chars()], "status": "open", "openedAt": _now(), "photoIds": [],
                 "updates": [{"at": _now(), "status": "open", "photoIds": [], "title": title[:fault_title_chars()]}]}
            if document_ids:
                t["documentIds"] = list(document_ids)
            if entity_id:
                t["entityId"] = entity_id
            if note:
                t["note"] = note[:fault_note_chars()]
            if number:
                t["alertNumber"] = int(number)
            if origin:
                t["origin"] = origin
            if check:
                t["check"] = check
            t.update({k: v for k, v in (pattern or {}).items() if v})     # titlePattern, since
            tickets.append(self._gated(None, t))
            data["tickets"] = tickets
            return tid
        return await self._edit(change)

    async def held_tickets(self) -> dict[str, dict]:
        """{ticket id: fault_of(the record)} of the Facility records, as the Kiosk holds them now."""
        status, got = await self._req("GET", "/agent/v1/fm-data")
        if status != 200:
            raise KioskError(f"reading the Facility records answered {status}", status=status)
        data = got.get("data") if isinstance(got.get("data"), dict) else {}
        return {t["id"]: fault_of(t) for t in data.get("tickets") or [] if isinstance(t, dict) and isinstance(t.get("id"), str)}

    async def amend(self, tid: str, *amends: "Amend") -> int:
        """Ticket `tid` changed by each of `amends` in turn (retitled, tagged, noted, todo: what the agent puts right on
        an open fault), in ONE write. How many changed it; 0 when it is gone or none did.

        ⚠️ ONE WRITE PER FAULT (architecture review scan 2, 2026-10-19): bringing a fault up to date wrote the whole
        Facility record once per field — title, tags, Telegram lines: three reads, three writes, three new revisions,
        each one more chance to turn a person's save into "changed since you opened it"."""
        def change(data: dict) -> int:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    n, was = 0, t
                    for a in amends:
                        nt = a(t)
                        if nt is not None:
                            t, n = nt, n + 1
                    t = self._gated(was, t)
                    n = 0 if t == was else n                  # all it changed is what this Kiosk cannot read
                    if n:
                        tickets[i] = t
                        data["tickets"] = tickets
                    return n
            return 0
        return await self._edit(change) if amends else 0

    # ⚠️ THE KIOSK-VERSION GATE IS THE ONLY DOOR (architecture review, 2026-10-19): takes(field) / says(kind) existed,
    # and callers remembered to ask for ONE kind ("noted") and ONE field ("titlePattern"); every other kind and field was
    # written whatever the Kiosk — an older one shows a kind it does not know as a change of status. Now every ticket
    # this class writes passes _gated, and nothing outside it asks.
    def _kinds(self) -> frozenset[str]:
        """The step kinds this Kiosk shows: its /agent/v1/info `step_kinds` (2.496.356+), else the agreement's
        `ticketUpdate.kindsBeforeList` — what a Kiosk took before it listed them."""
        listed = (self.info or {}).get("step_kinds")
        return frozenset(listed if isinstance(listed, list) else
                         agreement.section("ticketUpdate").get("kindsBeforeList") or ())

    def _fields(self) -> frozenset[str]:
        """The fault fields this Kiosk reads: its /agent/v1/info `ticket_fields` (2.496.382+), else the agreement's
        `ticket.fieldsBeforeList`."""
        listed = (self.info or {}).get("ticket_fields")
        return frozenset(listed if isinstance(listed, list) else agreement.section("ticket").get("fieldsBeforeList") or ())

    def _shown(self, u: dict) -> dict | None:
        """A step this agent adds, as this Kiosk can read it: a kind it does not list is written without (the shape
        before kinds — a close by its note, the agreement's clearedNotePrefixes); a kind that changes no status
        (`notStatusChanges`: a Telegram line, a title) is not written at all — without its kind it would read as a
        change of status."""
        kind = u.get("kind")
        if not kind or kind in self._kinds():
            return u
        if kind in (agreement.section("ticketUpdate").get("notStatusChanges") or ()):
            return None
        return {k: v for k, v in u.items() if k != "kind"}

    def _gated(self, before: dict | None, after: dict) -> dict:
        """Ticket `after` (`before`: as it was read, None for a new one) as this Kiosk can read it: a field the
        agreement declares (`ticket.fields`) that it does not read keeps what it had (absent on a new one); each step
        added passes _shown. What a person wrote before stays as it was."""
        declared, takes = set(agreement.section("ticket").get("fields") or {}), self._fields()
        out = {k: v for k, v in after.items() if k not in declared or k in takes}
        out.update({k: before[k] for k in declared - takes if before and k in before and k in after})
        old = len((before or {}).get("updates") or [])
        ups = list(after.get("updates") or [])
        out["updates"] = ups[:old] + [s for s in (self._shown(u) if isinstance(u, dict) else u for u in ups[old:])
                                      if s is not None]
        return out

    async def refresh(self) -> None:
        """/agent/v1/info read again when the one held lists no step kinds: a Kiosk updated since the agent started says
        what it now shows (the repair asks at each round). Its failure is the next round's to retry."""
        if isinstance((self.info or {}).get("step_kinds"), list):
            return
        try:
            await self.check()
        except Exception as e:  # noqa: BLE001 — the gate keeps the agreement's base sets meanwhile
            log.debug("The Kiosk's info could not be read (%s)", type(e).__name__)

    async def reopen_ticket(self, tid: str, title: str, note: str | None = None) -> bool:
        """One of the agent's resolved tickets open again — its problem came back (architecture review 24: each return
        made a new fault, 24 a day for one access point, nothing saying they were the same). False when it is gone."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    upd = {"at": _now(), "status": "open", "photoIds": [], "kind": REOPENED, "title": title[:fault_title_chars()],
                           "note": (note or f"Back again: {title}")[:update_note_chars()]}
                    mine = not person_titled(t)                 # a title a person wrote stays theirs (review 26)
                    if mine and str(t.get("title") or "") != title[:fault_title_chars()]:
                        upd["was"] = str(t.get("title") or "")  # the title it replaces: the card's "Was:" (review 31)
                    was, t = t, {k: v for k, v in t.items() if k != "resolvedAt"}
                    tickets[i] = self._gated(was, dict(t, status="open", title=title[:fault_title_chars()] if mine else t.get("title"),
                                                       updates=list(t.get("updates") or []) + [upd]))
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)

    async def resolve_ticket(self, tid: str, note: str | None = None, who: str | None = None) -> bool:
        """Mark one of the agent's tickets resolved. By `who` — a person's Done: their name on the card, and the work
        recorded as the Kiosk's own "Mark resolved" records it (a completion, in Recent work; review 31: a Done on
        Telegram never appeared there). Without — the agent's own clearing of a problem gone: kind "cleared", never a
        repair in any figure. False when it is gone or closed."""
        def change(data: dict) -> bool:
            tickets = list(data.get("tickets") or [])
            for i, t in enumerate(tickets):
                if isinstance(t, dict) and t.get("id") == tid:
                    if t.get("status") == "resolved":
                        return False
                    now = _now()
                    upd = {"at": now, "status": "resolved", "photoIds": []}
                    if note:
                        upd["note"] = note[:update_note_chars()]
                    if who:
                        upd["who"] = who[:who_chars()]       # the person, on the card (faultWhen: who, else by)
                        # its `by` is the Kiosk's to stamp ("VESTA Agent"); the person is `who` (fmEngine.workedBy)
                        data["completions"] = list(data.get("completions") or []) + [{
                            "id": "va-cp-" + secrets.token_hex(6), "scheduleId": "", "ticketId": tid, "at": now,
                            "by": "", "who": who[:who_chars()], "photoIds": [], **({"note": note[:update_note_chars()]} if note else {})}]
                    else:
                        upd["kind"] = CLEARED
                    tickets[i] = self._gated(t, dict(t, status="resolved", resolvedAt=now,
                                                     updates=list(t.get("updates") or []) + [upd]))
                    data["tickets"] = tickets
                    return True
            return False
        return await self._edit(change)
