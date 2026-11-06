"""The villa's visit record (homeassistant/packages/vesta_visit.yaml), its templates rendered as the villa's system
renders them — the record's trigger-based sensor fed the blueprint's writes and the script VESTA runs, in order — after
the owner's first drills (2026-11-06, #127-#129):

- a record never written (its id none) kept the villa's first write (a candidate, visit '') away: every visit was lost
  until a reset;
- two of VESTA's tells read the record at the same moment (the lock's and the relock's results, both carried out at
  22:42:02): the later one wrote back the step before, the relock was never told, and the villa took the visit back;
- VESTA, holding the visit, removes the villa's replies: the record forgets them, its cards kept.

Rendered with Jinja (the villa's own engine) on the tracked file itself: a change there is what these read."""
from __future__ import annotations

import ast
import os

import jinja2
import yaml

AGENT_SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PACKAGE = os.path.join(AGENT_SRC, "homeassistant", "packages", "vesta_visit.yaml")
RECORD = "sensor.vesta_visit"
VISIT = "critical_presence_guard_example-1793000000"


class Rec:
    """The record as the villa holds it: `this` to its own templates, `state_attr` to every other."""

    def __init__(self):
        self.state, self.attributes = "unknown", {}


def _native(text: str):
    """A template's result as the villa's system reads it back: a value it can parse, else the text."""
    try:
        return ast.literal_eval(text.strip())
    except (ValueError, SyntaxError):
        return text.strip()


def _env() -> jinja2.Environment:
    env = jinja2.Environment(extensions=["jinja2.ext.loopcontrols"])
    env.tests["list"] = lambda v: isinstance(v, list)          # the villa's own test (Home Assistant's templates)
    return env


def _render(env, src, **ctx):
    return _native(env.from_string(str(src)).render(**ctx))


def package() -> dict:
    with open(PACKAGE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def fire(rec: Rec, data: dict) -> None:
    """One vesta_visit_record event, as the record's sensor folds it in."""
    pkg = package()
    block = next(b for b in pkg["template"] if "triggers" in b)
    env = _env()
    trigger = {"event": {"data": data}}
    vars_ = {}
    for name, src in block["variables"].items():
        vars_[name] = _render(env, src, trigger=trigger, **vars_)
    sensor = block["sensor"][0]
    this = {"state": rec.state, "attributes": dict(rec.attributes)}

    class This:
        state = this["state"]
        attributes = this["attributes"]
    ctx = {"trigger": trigger, "this": This, **vars_}
    state = _render(env, sensor["state"], **ctx)
    attrs = {k: _render(env, v, **ctx) for k, v in sensor["attributes"].items()}
    rec.state, rec.attributes = str(state), attrs


def tell(rec: Rec, **fields) -> None:
    """script.vesta_visit_tell run with `fields`, as VESTA calls it: its condition, its variables, its event."""
    pkg = package()
    script = pkg["script"]["vesta_visit_tell"]
    env = _env()
    env.globals["state_attr"] = lambda e, a: rec.attributes.get(a) if e == RECORD else None
    ctx = {**fields, "context": {"id": "ctx"}}
    seq = script["sequence"]
    if not _render(env, seq[0]["value_template"], **ctx):
        return
    for name, src in seq[1]["variables"].items():
        ctx[name] = _render(env, src, **ctx)
    ev = seq[2]["event_data"]
    fire(rec, {"record": _render(env, ev["record"], **ctx), "visit": _render(env, ev["visit"], **ctx),
               "token": "t", "set": _render(env, ev["set"], **ctx)})


def opened(rec: Rec) -> None:
    """The blueprint's opening write: a new id and every field of the visit."""
    fire(rec, {"record": RECORD, "visit": VISIT, "token": "o", "set": {
        "state": "open", "id": VISIT, "automation": "automation.example", "seq": 1, "owner": "pending", "ack_seq": 0,
        "messages": [{"entity_id": "notify.example_owner", "chat_id": 111, "message_id": 500, "role": "card",
                      "media": "photo"}], "candidate": None}})


def test_a_record_never_written_keeps_the_villas_first_write():
    rec = Rec()
    # the villa's first detection: a candidate, written with no visit yet (visit '')
    fire(rec, {"record": RECORD, "visit": "", "token": "c", "set": {"candidate": {"automation": "automation.example",
                                                                                  "at": "2026-11-06T14:41:04+00:00"}}})
    assert rec.attributes["candidate"] == {"automation": "automation.example", "at": "2026-11-06T14:41:04+00:00"}, \
        rec.attributes
    assert rec.state == "closed"
    opened(rec)
    assert rec.state == "open" and rec.attributes["id"] == VISIT and rec.attributes["candidate"] is None


def test_a_tell_of_an_earlier_step_after_a_later_one_never_takes_the_record_back():
    rec = Rec()
    opened(rec)
    # the lock's and the relock's results were told within the same second, the relock's first
    tell(rec, record=RECORD, visit=VISIT, owner="vesta", number=127, ack_seq=4,
         messages=[{"chat_id": 111, "message_id": 1474, "role": "card"}])
    tell(rec, record=RECORD, visit=VISIT, owner="vesta", number=127, ack_seq=3,
         messages=[{"chat_id": 111, "message_id": 1475, "role": "card"}])
    assert rec.attributes["ack_seq"] == 4, rec.attributes
    assert [m["message_id"] for m in rec.attributes["messages"]] == [1475], "each chat's card as the latest tell says"
    # a new visit starts again from its own opening
    fire(rec, {"record": RECORD, "visit": "", "token": "x", "set": {"state": "closed"}})
    opened(rec)
    assert rec.attributes["ack_seq"] == 0


def test_the_villas_replies_vesta_removed_are_forgotten_its_cards_kept():
    rec = Rec()
    opened(rec)
    msgs = rec.attributes["messages"] + [{"entity_id": "notify.example_owner", "chat_id": 111, "message_id": 501,
                                          "role": "reply"}]
    fire(rec, {"record": RECORD, "visit": VISIT, "token": "r", "set": {"owner": "villa", "messages": msgs}})
    tell(rec, record=RECORD, visit=VISIT, owner="vesta", ack_seq=2, dropped=[501],
         messages=[{"chat_id": 111, "message_id": 500, "role": "card"}])
    assert [(m["message_id"], m["role"]) for m in rec.attributes["messages"]] == [(500, "card")], rec.attributes
    assert rec.attributes["messages"][0]["media"] == "photo", "the villa's own words for its card are kept"
    # a tell of another visit than the one recorded changes nothing
    tell(rec, record=RECORD, visit="another-1", owner="vesta", ack_seq=9)
    assert rec.attributes["ack_seq"] == 2
