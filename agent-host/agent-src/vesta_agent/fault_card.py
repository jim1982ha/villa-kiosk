"""A Cockpit fault card's fields, in one table: what the agent wants each to say (Problems.card's name for it), what the
Kiosk calls it (the agreement's `ticket.fields`, agent-contract.json: the Kiosk's file), the state of the fault it is
written on, and what a missing value does (keeps the fault's own, or takes it away).

The table answers one question for the repair (tickets.Tickets._converge): given what is wanted and what the Kiosk
holds, what is the single write — `changes(want, held)`, then `write(changes)`. It also reads the fields off a ticket
(`held`, for kiosk.fault_of). What it does not hold: the title and the Telegram lines (kiosk.retitled, kiosk.noted),
which are steps in the fault's history, not fields; the order of the repair (tickets); the Kiosk's HTTP (kiosk).

⚠️ ONE TABLE (architecture review part three, 2026-11-20): each field was named three times — Problems.card's key,
fault_of's camelCase copy, one Amend builder each (tagged, closing, holding, monitoring, confirming, unwatched,
placed, todo) — and the repair compared each one by hand, so a new field meant four edits in three files.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from vesta_shared import result
from vesta_shared.limits import limit
from vesta_shared.messaging import headline, problem_title_chars

#: One change the agent makes to a fault: the ticket as it stands → the ticket changed, None when it has nothing to
#: change (Kiosk.amend applies several in one write).
Amend = Callable[[dict], "dict | None"]

#: The fault states a field is written on.
OPEN, CLOSED, ANY = "open", "closed", "any"
#: What a missing wanted value does: the fault keeps its own (KEPT), or the field is taken away (REMOVED).
KEPT, REMOVED = "kept", "removed"


class _Keep:
    def __repr__(self) -> str:
        return "KEEP"


#: A field's wanted value when the fault keeps what it has.
KEEP = _Keep()

#: How this agent labels a fault's note ("What to do: …"; "Check: …" until review 29): a note so labelled is the agent's
#: to bring up to date; any other note on a fault is a person's and stays theirs, as a person's title does.
TODO_LABELS = ("What to do: ", "Check: ")


def fault_note_chars() -> int:
    return limit("kiosk.fault_note_chars", 2000, unit="characters", group="text", lo=200, hi=20000,
                 says="The longest note a fault keeps in the VESTA UI (what the Facility Manager reads).",
                 reached="The rest of the note is cut, with no mark.", told="")


def pattern(want: dict, held: dict | None = None) -> dict | None:
    """{"titlePattern", "since"} for a fault the agent titles (its title with "{since}" where a duration goes, worded by
    the Kiosk when shown); None for a title a person wrote, or nothing to word."""
    if not want.get("pattern") or (held or {}).get("person_titled"):
        return None
    return {"titlePattern": headline(want["pattern"])[:problem_title_chars()], "since": want.get("since")}


def _pattern_part(key: str):
    """A field of the title's pattern: the pattern's, removed with it when the agent no longer words the title (a
    person retitled it) — and left alone on a fault that never had one."""
    def value(want: dict, held: dict):
        p = pattern(want, held)
        if p is not None:
            return p[key]
        return None if held.get("pattern") else KEEP
    return value


def _note(want: dict, _held: dict):
    said = result.fault_note(want.get("todo"))
    return said[:fault_note_chars()] if said else None


@dataclass(frozen=True)
class Field:
    #: Problems.card's key for what is wanted, and the key fault_of reads the held value under
    agent: str
    #: the agreement's name (ticket.fields)
    contract: str
    #: the fault's state it is written on (OPEN, CLOSED, ANY)
    on: str
    #: what a missing wanted value does (KEPT, REMOVED)
    missing: str
    #: what is wanted, as the Kiosk holds it, from Problems.card and the held fault (default: Problems.card's value);
    #: KEEP: the fault keeps what it has
    value: Callable[[dict, dict], object] | None = None
    #: how the held value is read off the ticket (default: as it is)
    read: Callable[[object], object] | None = None
    #: a held value a person wrote: it stays theirs
    theirs: Callable[[object], bool] | None = None

    def wanted(self, want: dict, held: dict):
        v = self.value(want, held) if self.value else want.get(self.agent)
        if v is KEEP:
            return KEEP
        if not v:
            return KEEP if self.missing == KEPT else None
        return v

    def held(self, t: dict):
        v = t.get(self.contract)
        return self.read(v) if self.read else v

    def written_on(self, status: str) -> bool:
        closed = status == "resolved"
        return self.on == ANY or (self.on == CLOSED) == closed


#: Every field of a fault's card the agent keeps current. Their order is the order they are written in one write.
FIELDS: tuple[Field, ...] = (
    # the device it is about now: its card's name (a visit's strongest step)
    Field("entity_id", "entityId", OPEN, KEPT, read=lambda v: str(v or "")),
    # the alert's number and priority, as every chat writes them ("#5-P2"); its priority only with its number
    Field("number", "alertNumber", OPEN, KEPT, value=lambda w, _h: int(w["number"]) if w.get("number") else None),
    Field("priority", "alertPriority", OPEN, KEPT, value=lambda w, _h: w.get("priority") if w.get("number") else None),
    # where it came from (the card's source icon), how it is read again (its "Next check")
    Field("origin", "origin", OPEN, KEPT),
    Field("check", "check", OPEN, KEPT),
    # its duration worded when shown — never on a title a person wrote: theirs, as it is
    Field("pattern", "titlePattern", OPEN, REMOVED, value=_pattern_part("titlePattern")),
    Field("since", "since", OPEN, REMOVED, value=_pattern_part("since")),
    # when the agent closes it if it stays over (owner, 2026-10-21), gone when it holds again
    Field("closes_at", "closesAt", OPEN, REMOVED),
    # an open visit: until when it is monitored, moved later at each step (owner, 2026-11-07)
    Field("monitored_until", "monitoredUntil", OPEN, REMOVED),
    # a held alert: why it is expected, on the tablet's Watch until it is no longer (owner, 2026-11-12)
    Field("expected", "expected", OPEN, REMOVED),
    # until when a closed fault is watched (owner, 2026-10-23); an open fault is never being confirmed
    Field("confirms_by", "confirmsBy", ANY, REMOVED, value=lambda w, _h: None if w.get("open") else w.get("confirms_by")),
    # a closed fault nothing watches says so: Closed on the tablet at once (drill #136-P1); a reopening takes it away
    Field("not_watched", "notWatched", CLOSED, KEPT, read=lambda v: v is True),
    # what made it (its card's (?) pill, owner 2026-11-21): the villa automation of its alert, the skill's check of a
    # finding; on a closed fault too (the Watch and Closed cards say it)
    Field("raised_by", "raisedBy", ANY, KEPT),
    # what to do on site, as its problem says it NOW (Problems.card todo) — only a note this agent wrote, or none
    Field("todo", "note", OPEN, KEPT, value=_note, read=lambda v: str(v or ""),
          theirs=lambda v: bool(v) and not str(v).startswith(TODO_LABELS)),
)
_BY_CONTRACT = {f.contract: f for f in FIELDS}


def held(t: dict) -> dict:
    """The table's fields of ticket `t` as the Kiosk holds them, under Problems.card's names (kiosk.fault_of)."""
    return {f.agent: f.held(t) for f in FIELDS}


def changes(want: dict, held: dict) -> dict:
    """{contract name: value (None: taken away)} — the fields of the fault `held` (kiosk.fault_of) that do not say what
    `want` (Problems.card) says, of those written on its state; a person's value stays. Empty: nothing to write."""
    out = {}
    status = str(held.get("status") or "")
    for f in FIELDS:
        if not f.written_on(status):
            continue
        v = f.wanted(want, held)
        mine = held.get(f.agent)
        if v is KEEP or (f.theirs and f.theirs(mine)) or mine == v:
            continue
        out[f.contract] = v
    return out


def write(changed: dict) -> Amend:
    """The single write of `changed` (changes): each field set, or taken away when None — read again on the ticket as
    it stands when written: a field of a state it is no longer in, or a value a person wrote meanwhile, is left."""
    def amend(t: dict) -> dict | None:
        out, moved = dict(t), False
        status = str(t.get("status") or "")
        for contract, v in changed.items():
            f = _BY_CONTRACT[contract]
            if not f.written_on(status) or (f.theirs and f.theirs(f.held(t))):
                continue
            if v is None:
                if contract in out:
                    del out[contract]
                    moved = True
            elif out.get(contract) != v:
                out[contract] = v
                moved = True
        return out if moved else None
    return amend
