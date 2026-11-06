"""One visit, one story (owner, 2026-11-06, #125-P1 and #126-P1): the evening of 06/11 18:19–18:53 replayed as the villa's
visit automation will send it — its first step "opened", every later one "step", with its `visit` record — through
the real path: the events as the engine receives them (on_ha_event), the alert desk's `desk.py` as the engine runs it,
every chat's copy, the photo sheet, the villa told through its script, the siren's request, the tablet's card. Then a
break-in, VESTA restarted mid-visit, VESTA back after the villa held the visit, and the two generic fixes (a card
already replaced never taken over again; a reopened alert's count). Synthetic villa: every id invented."""
from __future__ import annotations

import asyncio
import io
import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from ha_fake import FakeHA, tool
from helpers import make_agent, restarted
from kiosk_fake import FakeKiosk
from vesta_agent import sheet
from vesta_agent.roster import Roster
from vesta_shared import kiosk_told
from vesta_shared.knowledge_pack import build_pack
from vesta_shared.store import Store

OWNER, FM = 111, 222
RULE, UID = "automation.critical_presence_guard_example", "9900"
RECORD, SCRIPT = "sensor.example_visit", "script.example_visit_tell"
EMPTY_SENSOR, SIREN = "binary_sensor.example_villa_empty", "switch.example_siren"
PARKING, ENTRANCE, WATERWALL = "binary_sensor.example_parking_motion", "binary_sensor.example_entrance_motion", \
    "binary_sensor.example_waterwall_motion"
DOOR_MOTION, LIVING, LOCK = "binary_sensor.example_door_motion", "binary_sensor.example_living_motion", "lock.example_entrance"
GARDEN_DOOR = "binary_sensor.example_garden_door"
ROOM_PERSON = "binary_sensor.example_server_person"
PARKING_CAM = "camera.example_parking"
NAMES = {PARKING: "Parking", ENTRANCE: "Entrance Left", WATERWALL: "Waterwall Buddha", DOOR_MOTION: "Main House Door",
         LIVING: "Living Room Motion", LOCK: "Outdoor entrance Lock", GARDEN_DOOR: "Garden Door",
         ROOM_PERSON: "Server Room Person"}
REGISTRY = {"areas": [{"area_id": "parking", "name": "Parking"}, {"area_id": "living", "name": "Living Room"}],
            "entities": [{"entity_id": PARKING, "name": "Parking", "area_id": "parking", "device_class": "motion"},
                         {"entity_id": PARKING_CAM, "name": "Parking Camera", "area_id": "parking"}]}
STRENGTH = ("lock", "door", "person", "inside", "motion")
DAY = "2026-11-06"
TICKET_RE = r"\d\d/\d\d/\d{4} \d\d:\d\d"


def at(hms: str) -> str:
    return f"{DAY}T{hms}+00:00"


class Visit:
    """The villa's visit record, as its automation fires it at each step (the agreed `visit` object)."""

    def __init__(self, cards=((OWNER, 500), (FM, 501)), owner="vesta", media=None):
        self.steps, self.photos, self.owner, self.media = [], [], owner, media
        self.messages = [{"entity_id": f"notify.example_{c}", "chat_id": c, "message_id": m, "role": "card"} for c, m in cards]
        self.id = f"critical_presence_guard_example-{1793000000}"
        self.answered = self.reminded_at = None

    def add(self, kind, eid, hms, how=None, photo=False, area=None):
        s = {"seq": len(self.steps) + 1, "kind": kind, "entity_id": eid, "name": NAMES[eid], "at": at(hms),
             **({"area": area} if area else {}), **({"how": how} if how else {})}
        self.steps.append(s)
        if photo and self.media is not None:
            path = self.media / f"vesta_alert_{eid.split('.')[1]}_{hms.replace(':', '')}.jpg"
            jpeg(path)
            self.photos.append({"path": str(path), "camera": f"camera.example_{eid.split('.')[1]}", "camera_name": NAMES[eid],
                                "entity_id": eid, "kind": kind, "at": at(hms)})
        return s

    def strongest(self):
        kinds = [k for k in STRENGTH if any(s["kind"] == k for s in self.steps)]
        first = next(s for s in self.steps if s["kind"] == kinds[0])
        return {k: first[k] for k in ("kind", "entity_id", "name", "at")}

    def event(self, phase="step", **more):
        top = self.strongest()
        label = "Activity while the villa is empty" if top["kind"] == "motion" else f"{top['name']} opened while the villa is empty"
        last = self.steps[-1]
        visit = {"record": RECORD, "tell_script": SCRIPT, "seq": last["seq"], "opened_at": self.steps[0]["at"],
                 "last_at": last["at"], "closes_at": (datetime.fromisoformat(last["at"]) + timedelta(minutes=30)).isoformat(),
                 "step": last, "strongest": top, "steps": list(self.steps), "photos": list(self.photos),
                 "messages": list(self.messages), "owner": self.owner, "answered": self.answered,
                 "reminded_at": self.reminded_at}
        return {"blueprint": "critical_presence_guard", "rule_id": RULE, "rule_uid": UID, "incident_id": self.id,
                "phase": phase, "priority": "P1", "label": label, "entities": sorted({s["entity_id"] for s in self.steps}),
                "summary": label, "timestamp": more.pop("timestamp", last["at"]), "occupancy": "empty", "visit": visit, **more}


def jpeg(path):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 120, 160)).save(buf, "JPEG")
    path.write_bytes(buf.getvalue())


class Writer:
    """The villa's write side: every script VESTA runs, recorded."""
    calls: list = []

    def __init__(self):
        pass

    def call_service(self, domain, service, data):
        Writer.calls.append((domain, service, data))


@pytest.fixture
def media(tmp_path, monkeypatch):
    d = tmp_path / "media" / "vesta"
    d.mkdir(parents=True)
    monkeypatch.setattr(sheet, "MEDIA", str(tmp_path / "media"))
    return d


@pytest.fixture
def kiosk():
    return FakeKiosk()


def villa(tmp_path, kiosk, empty="on"):
    import base64
    buf = io.BytesIO()
    from PIL import Image
    Image.new("RGB", (64, 48), (10, 10, 10)).save(buf, "JPEG")
    v = make_agent(tmp_path, {"act_enabled": True, "siren_entity": SIREN, "allowed_services": {"switch.turn_on": "owner"}},
                   roster=Roster.of(owner=[(OWNER, "Owner")], fm=[(FM, "Wayan")]), skills=["alert-desk"],
                   reader=FakeHA(tools=[tool("ha_get_state")], states={EMPTY_SENSOR: {"entity_id": EMPTY_SENSOR, "state": empty}},
                                 images={PARKING_CAM: base64.b64encode(buf.getvalue()).decode()}), kiosk=kiosk)
    with open(v.s.pack_path, "w", encoding="utf-8") as f:
        f.write(build_pack(REGISTRY, []).to_json())
    kiosk_told.save(v.s.pack_path, "villaEmptySensor", EMPTY_SENSOR)
    Writer.calls = []
    v.actions.writer_factory = Writer
    for c, m in ((OWNER, 500), (FM, 501)):
        v.tg.with_photo.add((c, m))                 # the villa's cards: its photo messages
    return v


def past_evenings(v):
    """The same automation's alert on the three evenings before (3, 4 and 5 November), as the old way filed them."""
    store = Store(v.s.store_path)
    for when in ("2026-11-03T18:33:00+00:00", "2026-11-04T18:31:00+00:00", "2026-11-05T18:18:00+00:00"):
        iid = store.new_incident(f"rule:{UID}|{PARKING}", RULE, PARKING, "P1", {"message": "Activity"}, when)
        store.update_incident(iid, closed_at=when, state="resolved")


def play(v, *steps):
    async def go():
        for s in steps:
            await s(v)
        await v.messages.settle()
    asyncio.run(go())


def send(ev):
    async def step(v):
        await v.on_ha_event("vesta_critical_event", ev)
    return step


async def tick(v, minutes):
    sk = v.skills.get("alert-desk")
    when = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    await v.run_code_job(sk, f"desk.py tick --now {when}", 60)


def copy(v, chat, iid=1):
    return v.state.incident_message(iid, chat)


def lines(text):
    return [ln for ln in text.split("\nStatus:\n", 1)[1].split("\n") if ln.strip()]


def told(v):
    """What the villa's script was told, in order."""
    return [d for dom, svc, d in Writer.calls if dom == "script" and svc == SCRIPT.split(".")[1]]


def evening(v, media):
    """06/11 18:19–18:37, step by step; returns the visit."""
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:19:58")
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    for kind, eid, hms, extra in (("motion", PARKING, "18:34:10", {}), ("motion", ENTRANCE, "18:34:47", {"photo": True}),
                                  ("motion", WATERWALL, "18:34:55", {"photo": True}),
                                  ("lock", LOCK, "18:35:40", {"how": "lock"}),
                                  ("motion", DOOR_MOTION, "18:35:41", {"photo": True}), ("relock", LOCK, "18:36:32", {}),
                                  ("inside", LIVING, "18:36:50", {"photo": True, "area": "Living Room"})):
        vi.add(kind, eid, hms, **extra)
        play(v, send(vi.event()))
    return vi


# ---------------------------------------------------------------------------------------------- the evening of 06/11
def test_the_evening_of_06_11_is_one_alert_one_message_per_chat_one_story(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    past_evenings(v)
    evening(v, media)
    store = Store(v.s.store_path)
    visits = [i for i in store.incidents(open_only=False) if i["key"] == f"rule:{UID}|visit"]
    assert [i["id"] for i in visits] == [4], "one visit, one number"
    for chat in (OWNER, FM):
        text = copy(v, chat, 4)["text"]
        st = lines(text)
        assert st[0] == "- Seen at Parking, 18:19–18:20", st
        assert "- Same time as the last 4 evenings (18:18–18:33)" in st, st
        assert "- Seen at Parking → Entrance Left → Waterwall Buddha → Main House Door, 18:34–18:35" in st, st
        assert "- Outdoor entrance Lock opened at the lock (not from the app), 18:35, locked again 18:36" in st, st
        assert "- Someone is inside (Living Room) at 18:36" in st, st
        assert not [ln for ln in st if "Still-there" in ln or "Cleared" in ln], st
        assert sum(ln.startswith("- Seen at") for ln in st) == 2, st
        assert text.startswith("#4-P1 (existing)\n") and "Outdoor entrance Lock opened while the villa is empty" in text
        # its stronger step rang: the card sent again with the sheet as its picture, the villa's card gone
        assert re.fullmatch(rf"⚠️ ⚙️ Stronger signal sent {TICKET_RE}, Outdoor entrance Lock opened while the villa is empty "
                            r"\(to: Owner & FM\)", st[-1]), st
    assert (OWNER, 500) in v.tg.deleted and (FM, 501) in v.tg.deleted
    # one message per chat: every copy VESTA posted but the card is gone
    for chat in (OWNER, FM):
        posted = [i for i, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == chat]
        alive = [m for m in posted if (chat, m) not in v.tg.deleted]
        card = copy(v, chat, 4)["mid"]
        assert card in alive
        others = [m for m in alive if m != card]
        # the one other live message is the siren's question, a reply to the card, in the owner's chat only
        assert len(others) == (1 if chat == OWNER else 0), (chat, others)
    # quiet steps were edits (the sheet and the story), never a new message: VESTA sent per chat the card again once
    # (the lock) and, in the owner's, the siren's question
    assert len([s for s in v.tg.sent if s[0] == FM]) == 1
    assert not [t for _c, t, _k in v.tg.sent if t.startswith("Camera snapshot")], "no separate snapshot message"
    assert v.tg.media_edits, "the sheet replaced the villa's card's picture in place"
    # the villa told the cards each chat shows, that VESTA holds the visit, each step acknowledged
    last = told(v)[-1]
    assert last["owner"] == "vesta" and last["record"] == RECORD and last["ack_seq"] == 9 and last["name"] == "#4-P1"
    assert sorted((m["chat_id"], m["message_id"]) for m in last["messages"]) == \
        sorted((c, copy(v, c, 4)["mid"]) for c in (OWNER, FM))
    # the tablet: VESTA's card takes the visit's announcement by its key
    card = kiosk.messages["incident:4"]
    assert f"visit:{Visit().id}" in card["takes"], card
    assert any("Someone is inside (Living Room) at 18:36" in ln for ln in card["status"])


def test_the_siren_is_one_line_of_the_visit_a_reply_to_its_card_and_no_snapshot_message(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    evening(v, media)
    (ap,) = v.state.approvals_in("pending")
    asks = [(c, t) for c, t, _k in v.tg.sent if t.startswith("Approval request")]
    assert [c for c, _t in asks] == [OWNER], "the owner alone is asked"
    ask_mid = 1000 + 1 + [i for i, (c, t, _k) in enumerate(v.tg.sent) if t.startswith("Approval request")][0]
    (reply,) = [r for r in v.tg.replies if r[1] == ask_mid]
    assert reply[2] == 500, "the question answers the visit's card in the owner's chat"
    assert "Turn on" in asks[0][1] or "Siren" in asks[0][1]
    # the parking camera showed nothing within the siren's window: snapped into the sheet, never a message of its own
    assert any(n == "ha_get_camera_image" for n, _a in v.reader.calls)
    assert v.state.visit_snaps(1) and not [t for _c, t, _k in v.tg.sent if "Camera snapshot" in t]
    st = lines(copy(v, OWNER, 1)["text"])
    (line,) = [ln for ln in st if "Siren offered" in ln]
    assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d", line), line
    # nobody approves: it expires, and the story says so — the siren never sounds
    asyncio.run(v.approvals.expire(datetime.now(timezone.utc) + timedelta(hours=2)))
    st = lines(copy(v, OWNER, 1)["text"])
    (line,) = [ln for ln in st if "Siren offered" in ln]
    assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d, expired on \d\d:\d\d: nothing was done", line), line
    assert v.state.siren_stop() is None and not [c for c in Writer.calls if c[0] == "switch"]
    # asked once per visit, whatever came after (four more steps, two sources each time)
    assert len([1 for _c, t, _k in v.tg.sent if t.startswith("Approval")]) == 1


def test_a_reminder_says_what_changed_and_the_villa_is_told_it_was_sent(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    evening(v, media)
    play(v, lambda v: tick(v, 20))
    bottom = lines(copy(v, FM, 1)["text"])[-1]
    assert "No answer after 15min. Someone went inside at 18:36. Was this visit expected?" in bottom, bottom
    assert told(v)[-1].get("reminded_at")


def test_the_visit_ends_once_with_no_watch_and_a_done_ends_it_on_the_villa(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = evening(v, media)
    vi_end = vi.event("resolved")
    play(v, send(vi_end))
    for chat in (OWNER, FM):
        bottom = lines(copy(v, chat, 1)["text"])[-1]
        assert re.fullmatch(rf"✅ Cleared on {TICKET_RE}: no further signal for 30min\.", bottom), bottom
        assert "Watch" not in copy(v, chat, 1)["text"]


def test_a_done_ends_the_visit_on_the_villa_at_once_with_no_watch(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    evening(v, media)

    async def done(v):
        sk = v.skills.get("alert-desk")
        await v.run_code_job(sk, "desk.py reply --incident 1 --option done --from fm --name Wayan --place telegram", 60)
    play(v, done)
    (ans,) = [d["answered"] for d in told(v) if d.get("answered")]
    assert ans["option"] == "done" and ans["by"] == "Wayan"
    assert "Watch" not in copy(v, OWNER, 1)["text"]


def test_a_card_the_reminder_replaced_is_never_taken_over_again(tmp_path, kiosk):
    # #125-P1 at 18:53: the all-clear of the run named the villa's first card, which the reminder had replaced
    from test_kiosk_messages import GROUP, alert
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(GROUP, "Villa group")], fm=[(FM, "Wayan"), (GROUP, "Villa group")]),
                   skills=["alert-desk"], reader=FakeHA(tools=[tool("ha_get_state")]), kiosk=kiosk)
    play(v, alert, lambda v: tick(v, 20))
    live = copy(v, GROUP)["mid"]
    assert live != 500 and (GROUP, 500) in v.tg.deleted
    edits_before = len(v.tg.edits)

    async def all_clear(v):
        from vesta_agent.ha_events import CONTEXT_KEY
        await v.on_ha_event("vesta_critical_event", {
            "blueprint": "critical_condition", "rule_id": "automation.critical_condition_laundry",
            "incident_id": "automation.critical_condition_laundry-1", "phase": "resolved", "severity": "critical",
            "label": "Laundry door unlocked", "entities": ["lock.laundry"], "summary": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(), CONTEXT_KEY: "RUN-1"})
    play(v, all_clear)
    now = copy(v, GROUP)["mid"]
    assert now != 500 and (GROUP, now) not in v.tg.deleted, "the chat's copy is a live message, never the card gone"
    assert not [e for e in v.tg.edits[edits_before:] if e[1] == 500], "the card gone is never edited"
    assert "Cleared on" in copy(v, GROUP)["text"]


# ---------------------------------------------------------------------------------------------- a break-in
def test_a_door_forced_after_motion_rings_and_arms_the_siren_never_folded_quietly(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "02:10:01")
    vi.add("motion", PARKING, "02:10:09", photo=True)
    play(v, send(vi.event("opened")))
    sent_before = len(v.tg.sent)
    vi.add("door", GARDEN_DOOR, "02:10:40")
    play(v, send(vi.event()))
    rang = [(c, t) for c, t, _k in v.tg.sent[sent_before:] if not t.startswith("Approval")]
    assert sorted(c for c, _t in rang) == [OWNER, FM], "the door is stronger than motion: sent again, it rings"
    assert all("Stronger signal sent " in t and "Garden Door opened while the villa is empty (to: Owner & FM)" in t
               for _c, t in rang)
    assert "- Garden Door opened, 02:10" in lines(copy(v, OWNER, 1)["text"])
    assert v.state.approvals_in("pending"), "two sources in the siren's window, the villa empty: the owner is asked"
    # another motion after it is no stronger: an edit, no sound
    n = len(v.tg.sent)
    vi.add("motion", ENTRANCE, "02:11:02")
    play(v, send(vi.event()))
    assert len(v.tg.sent) == n and "Parking → Entrance Left" in copy(v, OWNER, 1)["text"]


def test_one_source_repeated_or_someone_home_never_asks_the_siren(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    for hms in ("03:00:01", "03:00:20", "03:01:05"):
        vi.add("motion", PARKING, hms)
        play(v, send(vi.event("opened" if hms == "03:00:01" else "step")))
    assert not v.state.approvals_in("pending")
    w = villa(tmp_path / "home", FakeKiosk())
    wi = Visit(media=media)
    wi.add("motion", PARKING, "03:00:01")
    play(w, send({**wi.event("opened"), "occupancy": "occupied"}))
    wi.add("motion", ENTRANCE, "03:00:30")
    play(w, send({**wi.event(), "occupancy": "occupied"}))
    assert not w.state.approvals_in("pending")


# ---------------------------------------------------------------------------------------------- VESTA away and back
def test_vesta_restarted_mid_visit_carries_on_the_same_card(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    v = restarted(v)
    v.actions.writer_factory = Writer
    sent = len(v.tg.sent)
    vi.add("motion", ENTRANCE, "18:34:47", photo=True)
    play(v, send(vi.event()))
    assert len(v.tg.sent) == sent, "nothing new sent"
    assert copy(v, OWNER, 1)["mid"] == 500, "the same card"
    assert "- Seen at Entrance Left, 18:34" in lines(copy(v, OWNER, 1)["text"])
    assert told(v)[-1]["ack_seq"] == 2
    # the villa held the visit for its next step (VESTA's answer late): it rang it itself, VESTA only edits
    vi.owner = "villa"
    vi.add("lock", LOCK, "18:35:40", how="lock")
    play(v, send(vi.event()))
    assert [t for _c, t, _k in v.tg.sent[sent:] if not t.startswith("Approval request")] == []
    assert copy(v, OWNER, 1)["mid"] == 500
    assert "- Outdoor entrance Lock opened at the lock (not from the app), 18:35" in lines(copy(v, OWNER, 1)["text"])
    # the card is taken over once: a step is an edit, never a notice of its own ("Update sent")
    assert not [ln for ln in lines(copy(v, OWNER, 1)["text"]) if "Update sent" in ln]
    assert [h["stage"] for h in v.state.incident_history(1) if not h.get("fold")] == ["new"]


def test_vesta_back_after_the_villa_held_the_visit_takes_over_the_same_card_sending_nothing(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="villa")
    vi.add("motion", PARKING, "18:20:16", photo=True)
    vi.add("motion", ENTRANCE, "18:34:47", photo=True)
    vi.add("lock", LOCK, "18:35:40", how="lock")           # stronger, but the villa rang it itself (a reply photo)
    vi.reminded_at = at("18:35:16")                         # and sent its plain reminder
    vi.add("motion", DOOR_MOTION, "18:35:41", photo=True)
    play(v, send(vi.event()))
    # no card sent: the villa's cards taken over in place (the siren's question is VESTA's alone: the villa never asks)
    assert [t for _c, t, _k in v.tg.sent if not t.startswith("Approval request")] == []
    assert {(c, m) for c, m, _t in v.tg.edits} >= {(OWNER, 500), (FM, 501)}
    assert v.tg.media_edits and {(c, m) for c, m, *_ in v.tg.media_edits} == {(OWNER, 500), (FM, 501)}
    st = lines(copy(v, OWNER, 1)["text"])
    assert "- Outdoor entrance Lock opened at the lock (not from the app), 18:35" in st, st
    assert copy(v, OWNER, 1)["text"].startswith("#1-P1"), "numbered now"
    assert told(v)[-1]["owner"] == "vesta"
    # its reminder was sent by the villa: VESTA's chase does not send it again
    play(v, lambda v: tick(v, 20))
    assert not [t for _c, t, _k in v.tg.sent if "Reminder sent" in t]


def test_a_press_the_villa_recorded_while_vesta_was_away_is_applied_once(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="villa")
    vi.add("motion", PARKING, "18:20:16")
    vi.answered = {"option": "not_a_problem", "by": "Wayan", "at": at("18:25:00"), "where": "telegram"}
    vi.add("motion", ENTRANCE, "18:26:00")
    play(v, send(vi.event()))
    inc = Store(v.s.store_path).incident(1)
    assert inc["closed_at"] and "Not a problem" in copy(v, OWNER, 1)["text"]
    assert len([d for d in told(v) if d.get("answered")]) == 1
    # Need help recorded by the villa: the owner is asked to act once, however many steps carry the press
    w = villa(tmp_path / "help", FakeKiosk())
    wi = Visit(media=media, owner="villa")
    wi.add("motion", PARKING, "18:20:16")
    wi.answered = {"option": "need_help", "by": "Wayan", "at": at("18:25:00"), "where": "telegram"}
    wi.add("motion", ENTRANCE, "18:26:00")
    play(w, send(wi.event()))
    wi.add("motion", WATERWALL, "18:27:00")
    play(w, send(wi.event()))
    asked = [t for _c, t, _k in w.tg.sent if "is asked to act" in t]
    assert len(asked) == 1, asked


# ---------------------------------------------------------------------------------------------- the reopened count
def test_a_reopened_alert_counts_its_own_alerts_from_its_return(tmp_path):
    import importlib.util
    import os
    from helpers import STARTER_SKILLS
    spec = importlib.util.spec_from_file_location("desk", os.path.join(STARTER_SKILLS, "alert-desk", "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    store = Store(str(tmp_path / "s.sqlite"))
    t0 = datetime(2026, 11, 6, 18, 20, tzinfo=timezone.utc)
    ev = {"blueprint": "critical_binary_trip", "rule_id": "automation.example_trip", "incident_id": "t-1",
          "phase": "opened", "label": "Leak", "entities": ["binary_sensor.example_leak"], "summary": "Leak"}
    desk.intake(store, ev, t0)
    desk.intake(store, {**ev, "incident_id": "t-1b"}, t0 + timedelta(minutes=1))          # its first run: 2 alerts
    desk.intake(store, {**ev, "phase": "resolved"}, t0 + timedelta(minutes=10))
    desk.intake(store, {**ev, "incident_id": "t-2"}, t0 + timedelta(minutes=14))          # back: the same number
    out = desk.intake(store, {**ev, "incident_id": "t-2"}, t0 + timedelta(minutes=15))
    (said,) = {m["status"] for m in out["ha_messages"]}
    assert said.startswith("Still there: 2 times since ") and said.endswith("18:34"), said
    assert json.loads(store.incident(1)["occurrences"])[0]["count"] == 2


# ---------------------------------------------------------------------------------------------- the owner's decisions
def test_a_person_a_rooms_camera_sees_joins_the_open_visit_as_one_line(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16")
    play(v, send(vi.event("opened")))
    vi.add("person", ROOM_PERSON, "18:40:05", photo=True, area="Server Room")
    play(v, send(vi.event()))
    assert "- Person seen in the Server Room at 18:40" in lines(copy(v, OWNER, 1)["text"])
    assert len(Store(v.s.store_path).incidents()) == 1, "no notice, no second alert"


def test_a_resident_home_ends_the_visit_withdraws_the_siren_and_stops_the_chase(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = evening(v, media)
    (ap,) = v.state.approvals_in("pending")
    end = vi.event("resolved", timestamp=at("18:40:00"))
    end["visit"]["closed"] = {"why": "home", "who": "Jim", "at": at("18:40:00")}
    play(v, send(end))
    for chat in (OWNER, FM):
        st = lines(copy(v, chat, 1)["text"])
        assert st[-1] == "✅ Expected: Jim came home at 18:40.", st
    assert v.state.approval(ap["id"])["status"] == "withdrawn"
    (line,) = [ln for ln in lines(copy(v, OWNER, 1)["text"]) if "Siren offered" in ln]
    assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d, withdrawn on \d\d:\d\d: someone came home\. "
                        r"Nothing was done", line), line
    assert Store(v.s.store_path).incident(1)["closed_at"]
    sent = len(v.tg.sent)
    play(v, lambda v: tick(v, 20), lambda v: tick(v, 50))
    assert len(v.tg.sent) == sent, "no reminder, no escalation"


def test_the_tablets_card_stands_for_the_visits_announcement_from_its_first_step(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    assert f"visit:{vi.id}" in kiosk.messages["incident:1"]["takes"]


def test_the_sheet_reads_only_the_media_folder_and_the_villa_is_told_only_through_a_script(tmp_path, media):
    inside = media / "a.jpg"
    jpeg(inside)
    outside = tmp_path / "secret.jpg"
    jpeg(outside)
    assert sheet.build([{"path": str(outside), "label": "x", "at": at("18:00:00")}], 6, "UTC") is None
    assert sheet.build([{"path": str(media / ".." / ".." / "secret.jpg"), "label": "x", "at": at("18:00:00")}], 6, "UTC") is None
    assert sheet.build([{"path": str(inside), "label": "Parking", "at": at("18:00:00")}], 6, "UTC")[:2] == b"\xff\xd8"
    v = make_agent(tmp_path / "a", {})
    Writer.calls = []
    v.actions.writer_factory = Writer
    assert asyncio.run(v.actions.tell_villa("switch.example_siren", {"x": 1})) is False and Writer.calls == []
    assert asyncio.run(v.actions.tell_villa(SCRIPT, {"x": 1})) is True and Writer.calls == [("script", SCRIPT.split(".")[1], {"x": 1})]
