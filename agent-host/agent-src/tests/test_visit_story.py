"""One visit, one story (owner, 2026-11-06, #125-P1 and #126-P1): the evening of 06/11 18:19–18:53 replayed as the villa's
visit automation will send it — its first step "opened", every later one "step", with its `visit` record — through
the real path: the events as the engine receives them (on_ha_event), the alert desk's `desk.py` as the engine runs it,
every chat's copy, the photo sheet, the villa told through its script, the siren's request, the tablet's card. Then a
break-in, VESTA restarted mid-visit, VESTA back after the villa held the visit, and the two generic fixes (a card
already replaced never taken over again; a reopened alert's count). Synthetic villa: every id invented."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from ha_fake import FakeHA, tool
from helpers import make_agent, restarted, siren_question
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
DAY = "2026-11-06"     # the evening replayed; a test the clock judges dates its visit by just_past (never expires)
TICKET_RE = r"(?:\d\d/\d\d(?:/\d{4})? )?\d\d:\d\d"


def at(hms: str) -> str:
    return f"{DAY}T{hms}+00:00"


def just_past(hms: str, now: datetime | None = None) -> str:
    """The latest day ("YYYY-MM-DD", UTC) whose `hms` is already past: a visit dated so (DAY) that ends at `hms` ended
    less than a day ago, whatever day the test runs — a fixed date compared with the real clock expires (a test of
    06/11 failed from 07/11 on)."""
    now = now or datetime.now(timezone.utc)
    h, m, s = (int(x) for x in hms.split(":"))
    return (now - timedelta(hours=h, minutes=m, seconds=s)).date().isoformat()


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


def villa(tmp_path, kiosk, empty="on", owners=((OWNER, "Owner"),)):
    import base64
    buf = io.BytesIO()
    from PIL import Image
    Image.new("RGB", (64, 48), (10, 10, 10)).save(buf, "JPEG")
    v = make_agent(tmp_path, {"act_enabled": True, "siren_entity": SIREN, "allowed_services": {"switch.turn_on": "owner"}},
                   roster=Roster.of(owner=list(owners), fm=[(FM, "Wayan")]), skills=["alert-desk"],
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
    day = datetime.fromisoformat(DAY)
    for back, hm in ((3, "18:33"), (2, "18:31"), (1, "18:18")):
        when = f"{(day - timedelta(days=back)).date().isoformat()}T{hm}:00+00:00"
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
        # its stronger step rang: said on its own line, never a line of its own (owner, 2026-11-07, drill #135)
        assert "- Outdoor entrance Lock opened at the lock, 18:35, locked again 18:36: alert sent again " \
               "(to: Owner & FM)" in st, st
        assert "- Someone is inside (Living Room) at 18:36" in st, st
        assert not [ln for ln in st if "Still-there" in ln or "Cleared" in ln], st
        assert sum(ln.startswith("- Seen at") for ln in st) == 2, st
        assert text.startswith("#4-P1 (new)\n") and "Outdoor entrance Lock opened while the villa is empty" in text
        # the card sent again with the sheet as its picture, the villa's card gone; the card's state the short one
        assert not [ln for ln in st if "Stronger signal sent" in ln], st
        assert re.fullmatch(r"⚠️ New alert, monitoring until \d\d:\d\d", st[-1]), st     # owner, 2026-11-07
    assert (OWNER, 500) in v.tg.deleted and (FM, 501) in v.tg.deleted
    # one message per chat: every copy VESTA posted but the card is gone
    for chat in (OWNER, FM):
        posted = [i for i, (c, _t, _k) in enumerate(v.tg.sent, start=1001) if c == chat]
        alive = [m for m in posted if (chat, m) not in v.tg.deleted]
        card = copy(v, chat, 4)["mid"]
        assert card in alive
        others = [m for m in alive if m != card]
        # the siren's question is on the card itself (owner, 2026-11-08, #154): no other live message in any chat
        assert others == [], (chat, others)
    # quiet steps were edits (the sheet and the story), never a new message: VESTA sent per chat the card again once
    # (the lock) and, in the owner's, once more for the siren's question — each of them rings
    assert len([s for s in v.tg.sent if s[0] == FM]) == 1
    assert len([s for s in v.tg.sent if s[0] == OWNER]) == 2 and not v.tg.silent
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


def siren_row(kb):
    """The siren's buttons on a copy's keyboard: [(label, callback data)]."""
    return [(b["text"], b["callback_data"]) for r in (kb or {}).get("inline_keyboard") or [] for b in r
            if str(b.get("callback_data") or "").startswith("a:")]


def press_siren(v, chat, user, aid, yn="y"):
    async def go(v):
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": f"a:{aid}:{yn}", "chat_id": chat, "user_id": user,
                                                  "message": {"message_id": copy(v, chat)["mid"], "chat": {"id": chat}},
                                                  "bot": {"id": 8000, "username": "Villa_Test_bot"}})
    return go


def test_the_siren_question_is_on_the_owners_card_never_a_message_of_its_own(tmp_path, kiosk, media):
    # owner, 2026-11-08, visit #154: the card rang, then a separate "Approval request … Turn on Siren Alarm switch?"
    # replying to it rang. Now two buttons on the owner's copy of the card, the question a line of its Status
    v = villa(tmp_path, kiosk)
    evening(v, media)
    (ap,) = v.state.approvals_in("pending")
    assert not [t for _c, t, _k in v.tg.sent if t.startswith("Approval")], "no message of its own"
    owner_kb, fm_kb = (v.state.incident_message(1, c).get("kb") for c in (OWNER, FM))
    assert siren_row(owner_kb) == [("🚨 Sound siren", f"a:{ap['id']}:y"), ("No siren", f"a:{ap['id']}:n")], owner_kb
    assert [len(r) for r in owner_kb["inline_keyboard"] if siren_row({"inline_keyboard": [r]})] == [2], "a row of its own"
    assert siren_row(fm_kb) == [], "the facility manager's copy never carries it"
    assert not [b for b in kiosk.messages["incident:1"].get("buttons") or [] if b["kind"] == "a"], "nor the tablet's"
    # it rang: the owner's card was sent again with it (the lock rang again later), never silently
    assert any(siren_row(k) for c, _t, k in v.tg.sent if c == OWNER) and not v.tg.silent
    # the parking camera showed nothing within the siren's window: snapped into the sheet, never a message of its own
    assert any(n == "ha_get_camera_image" for n, _a in v.reader.calls)
    assert v.state.visit_snaps(1) and not [t for _c, t, _k in v.tg.sent if "Camera snapshot" in t]
    # Telegram and the tablet show the same photos (#154, 2026-11-08): the snapshot on the tablet's card too (the picture
    # itself: the Kiosk reads no file of the Agent's folder), in the one list Telegram's "All photos" sends
    shown = kiosk.messages["incident:1"]["photos"]
    want = v.visits.every_photo(1)
    assert [(p["label"], p["at"]) for p in shown] == [(p["label"], p["at"]) for p in want] and len(shown) > 1, shown
    (snap,) = [p for p in shown if "photo" in p]
    assert snap["label"] == v.state.visit_snaps(1)[0]["label"] and base64.b64decode(snap["photo"])[:2] == b"\xff\xd8"
    for chat in (OWNER, FM):
        (line,) = [ln for ln in lines(copy(v, chat, 1)["text"]) if "Siren offered" in ln]
        assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d: waiting for your answer", line), line
    # asked once per visit, whatever came after (four more steps, two sources each time)
    assert len(v.state.approvals_in("pending")) == 1


def test_the_siren_on_the_card_needs_the_owners_own_press(tmp_path, kiosk, media):
    # rules: The siren needs a human, always. Pressed from the facility manager's chat, or by the facility manager in
    # the owner's: nothing sounds, it still waits. Unanswered: it expires, its buttons go, nothing sounds
    v = villa(tmp_path, kiosk)
    evening(v, media)
    (ap,) = v.state.approvals_in("pending")
    play(v, press_siren(v, FM, FM, ap["id"]))
    assert ("cb", "This button belongs to another chat.") in v.tg.toasts
    play(v, press_siren(v, OWNER, FM, ap["id"]))
    assert v.state.approval(ap["id"])["status"] == "pending" and not [c for c in Writer.calls if c[0] == "switch"]
    asyncio.run(v.approvals.expire(datetime.now(timezone.utc) + timedelta(hours=2)))
    assert v.state.approval(ap["id"])["status"] == "expired"
    assert siren_row(v.state.incident_message(1, OWNER).get("kb")) == [], "its buttons gone"
    # ...on Telegram too: the owner's card's last edit carries no siren button
    last = max(i for i, (c, m, _t) in enumerate(v.tg.edits) if (c, m) == (OWNER, copy(v, OWNER, 1)["mid"]))
    assert siren_row(v.tg.edit_keyboards[last]) == [] and v.tg.edit_keyboards[last], v.tg.edit_keyboards[last]
    (line,) = [ln for ln in lines(copy(v, OWNER, 1)["text"]) if "Siren offered" in ln]
    assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d, expired at \d\d:\d\d: nothing was done", line), line
    assert v.state.siren_stop() is None and not [c for c in Writer.calls if c[0] == "switch"]
    # a press after that sounds nothing either
    play(v, press_siren(v, OWNER, OWNER, ap["id"]))
    assert not [c for c in Writer.calls if c[0] == "switch"]


def test_the_owners_press_on_the_card_sounds_it_and_its_buttons_go(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    evening(v, media)
    (ap,) = v.state.approvals_in("pending")
    play(v, press_siren(v, OWNER, OWNER, ap["id"]))
    assert [c[:2] for c in Writer.calls if c[0] == "switch"] == [("switch", "turn_on")]
    assert siren_row(v.state.incident_message(1, OWNER).get("kb")) == []
    assert "Siren offered to the Owner" in copy(v, OWNER, 1)["text"] and "waiting for your answer" not in copy(v, OWNER, 1)["text"]
    assert copy(v, OWNER, 1)["mid"] in [m for c, m in [(c, i) for i, (c, _t, _k) in enumerate(v.tg.sent, start=1001)]
                                         if c == OWNER], "the card stays: no message of the request to settle"


OWNER2 = 333


def test_an_owner_chat_without_the_card_gets_the_card_with_the_question_never_a_message_of_its_own(tmp_path, kiosk,
                                                                                                   media):
    # architecture review of 2026-11-09, card 2: the question is on the card only. An owner chat Telegram refused the
    # step's card gets the card first, the question on it; the facility manager's copy and the tablet never carry it
    from vesta_agent.telegram import TelegramError
    v = villa(tmp_path, kiosk, owners=((OWNER, "Owner"), (OWNER2, "Second")))
    real = v.tg.send

    async def refusing(chat_id, text, keyboard=None, **kw):
        if chat_id == OWNER2 and not siren_row(keyboard):
            raise TelegramError("sendMessage: 400 refused by the test")
        return await real(chat_id, text, keyboard=keyboard, **kw)
    v.tg.send = refusing
    vi = Visit(media=media)
    vi.add("motion", PARKING, "02:10:01")
    vi.add("motion", PARKING, "02:10:09", photo=True)
    play(v, send(vi.event("opened")))
    assert copy(v, OWNER2) is None, "Telegram refused the second owner's card"
    vi.add("door", GARDEN_DOOR, "02:10:40")
    play(v, send(vi.event()))
    (ap,) = v.state.approvals_in("pending")
    assert not [t for _c, t, _k in v.tg.sent if t.startswith("Approval")], "no message of its own"
    mine = copy(v, OWNER2)
    assert mine and siren_row(mine.get("kb")) == [("🚨 Sound siren", f"a:{ap['id']}:y"), ("No siren", f"a:{ap['id']}:n")]
    assert mine["text"].startswith("#1-P1 (new)\n") and "Garden Door opened while the villa is empty" in mine["text"]
    assert any(siren_row(k) for c, _t, k in v.tg.sent if c == OWNER2) and (OWNER2, mine["mid"]) not in v.tg.silent
    assert siren_row(copy(v, FM).get("kb")) == [] and siren_row(copy(v, OWNER).get("kb"))
    assert not [b for b in kiosk.messages["incident:1"].get("buttons") or [] if b["kind"] == "a"]
    # the owner's own press there sounds it (from the facility manager's chat it never does: the tests above)
    play(v, press_siren(v, OWNER2, OWNER2, ap["id"]))
    assert [c[:2] for c in Writer.calls if c[0] == "switch"] == [("switch", "turn_on")]


def test_a_drill_never_offers_the_siren(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "02:10:01")
    play(v, send({**vi.event("opened")}))
    vi.add("door", GARDEN_DOOR, "02:10:40")
    ev = vi.event()
    ev["visit"]["drill"] = True
    play(v, send(ev))
    assert not v.state.approvals_in("pending") and not [k for _c, _t, k in v.tg.sent if siren_row(k)]


def test_a_reminder_says_what_changed_and_the_villa_is_told_it_was_sent(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    evening(v, media)
    play(v, lambda v: tick(v, 20))
    bottom = lines(copy(v, FM, 1)["text"])[-1]
    assert "No answer after 15min. Someone went inside at 18:36. Was this visit expected?" in bottom, bottom
    assert told(v)[-1].get("reminded_at")


def test_one_reminder_only_once_the_visit_is_quiet_and_it_rings_while_quiet_steps_do_not(tmp_path, kiosk, media):
    # owner, 2026-11-08, visit #154: the reminder rang at 15 minutes while the visit kept growing step by step
    v = villa(tmp_path, kiosk)
    vi = evening(v, media)
    later = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    vi.steps.append({"seq": len(vi.steps) + 1, "kind": "motion", "entity_id": ENTRANCE, "name": NAMES[ENTRANCE], "at": later})
    n = len(v.tg.sent)
    play(v, send(vi.event()))
    assert len(v.tg.sent) == n, "a step no stronger: an edit, no sound"

    def reminders():
        return [(c, m) for m, (c, t, _k) in enumerate(v.tg.sent, start=1001) if "Reminder sent" in t]
    play(v, lambda v: tick(v, 20))                  # 10 minutes after the latest step: not yet
    assert reminders() == []
    play(v, lambda v: tick(v, 26))                  # 16 minutes without a step: the one reminder, and it rings
    sent = reminders()
    assert sorted(c for c, _m in sent) == [OWNER, FM] and not [x for x in sent if x in v.tg.silent], sent
    # asked again later (reopened in the Cockpit, say): never a second reminder for the same alert
    Store(v.s.store_path).update_incident(1, state="asked", asked_at=datetime.now(timezone.utc).isoformat())
    play(v, lambda v: tick(v, 60))
    assert reminders() == sent


def test_steps_that_change_nothing_seen_never_ring(tmp_path, kiosk, media):
    # a visit's escalation (no answer after 45min) to the owner, who has its card from the start (owner's screenshot,
    # 2026-11-08, live #154 at 09:35: the card sent again as text, its picture lost): an edit in place, no sound, its
    # picture kept, its pop-up quiet on the tablet
    v = villa(tmp_path, kiosk)
    evening(v, media)
    play(v, lambda v: tick(v, 20))
    reminders = [(c, m) for m, (c, t, _k) in enumerate(v.tg.sent, start=1001) if "Reminder sent" in t]
    assert reminders and all(x in v.tg.with_photo for x in reminders), "the reminder sent again with the visit's picture"
    n = len(v.tg.sent)
    assert not kiosk.messages["incident:1"].get("quiet"), "the reminder rings on the tablet too"
    play(v, lambda v: tick(v, 70))
    assert len(v.tg.sent) == n, "nothing sent again"
    assert "Escalation sent" in copy(v, OWNER, 1)["text"] and (OWNER, copy(v, OWNER, 1)["mid"]) in v.tg.with_photo
    assert kiosk.messages["incident:1"].get("quiet") is True
    # and the siren's question never a card of its own on the tablet
    assert list(kiosk.messages) == ["incident:1"], list(kiosk.messages)


def test_a_visits_step_is_acknowledged_to_the_villa_before_any_telegram_work(tmp_path, kiosk, media):
    # owner, 2026-11-08, live #154 at 09:14: the step told to the villa 77s late, after the sheet and every chat's
    # edit — past its 60s wait: the villa took the visit back and posted its own ringing reply
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:19:58", photo=True)
    play(v, send(vi.event("opened")))
    seen = []
    tell = v.visits._tell

    async def spy(script, data):
        seen.append((data.get("ack_seq"), "messages" in data,
                     len(v.tg.sent) + len(v.tg.edits) + len(v.tg.media_edits) + len(v.tg.deleted)))
        return await tell(script, data)
    v.visits._tell = spy
    before = len(v.tg.sent) + len(v.tg.edits) + len(v.tg.media_edits) + len(v.tg.deleted)
    vi.add("door", GARDEN_DOOR, "18:20:40", photo=True)        # stronger: the card sent again, its sheet, every edit
    play(v, send(vi.event()))
    after = len(v.tg.sent) + len(v.tg.edits) + len(v.tg.media_edits) + len(v.tg.deleted)
    assert after > before
    first, *rest = seen
    assert first == (2, False, before), seen
    assert rest and rest[-1][:2] == (2, True), "the cards told after, once drawn"


def test_the_visit_ends_once_with_no_watch_and_a_done_ends_it_on_the_villa(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = evening(v, media)
    vi_end = vi.event("resolved")
    play(v, send(vi_end))
    for chat in (OWNER, FM):
        bottom = lines(copy(v, chat, 1)["text"])[-1]
        assert re.fullmatch(rf"✅ Cleared (?:on|at) {TICKET_RE}: no further signal for 30min\.", bottom), bottom
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
    assert "Cleared at" in copy(v, GROUP)["text"]


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
    rang = [(c, t) for c, t, k in v.tg.sent[sent_before:] if not siren_question(t, k)]
    assert sorted(c for c, _t in rang) == [OWNER, FM], "the door is stronger than motion: sent again, it rings"
    assert all(t.startswith("#1-P1 (new)\n") and "Garden Door opened while the villa is empty" in t for _c, t in rang)
    assert all("- Garden Door opened, 02:10: alert sent again (to: Owner & FM)" in lines(copy(v, c, 1)["text"]) for c in (OWNER, FM))
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
    assert [t for _c, t, k in v.tg.sent[sent:] if not siren_question(t, k)] == []
    # the owner's card sent again only for the siren's question (it rings: owner, 2026-11-08), never for the step
    assert copy(v, OWNER, 1)["mid"] == 500 or siren_question("", copy(v, OWNER, 1).get("kb"))
    assert copy(v, FM, 1)["mid"] == 501
    assert "- Outdoor entrance Lock opened at the lock, 18:35" in lines(copy(v, OWNER, 1)["text"])
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
    assert [t for _c, t, k in v.tg.sent if not siren_question(t, k)] == []
    assert {(c, m) for c, m, _t in v.tg.edits} >= {(OWNER, 500), (FM, 501)}
    assert v.tg.media_edits and {(c, m) for c, m, *_ in v.tg.media_edits} == {(OWNER, 500), (FM, 501)}
    st = lines(copy(v, OWNER, 1)["text"])
    assert "- Outdoor entrance Lock opened at the lock, 18:35" in st, st
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
    asked = [h for h in w.state.incident_history(1) if h.get("stage") == "escalated"]
    assert len(asked) == 1 and "is asked to act" in copy(w, OWNER, 1)["text"], asked


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
    assert "- Person seen in the Server Room at 18:40: alert sent again (to: Owner & FM)" in lines(copy(v, OWNER, 1)["text"])
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
    assert re.fullmatch(r"- Siren offered to the Owner \d\d:\d\d, withdrawn at \d\d:\d\d: someone came home\. "
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


# ---------------------------------------------------------------------------------------------- real visit #148
def _visit_148(v, media, upto=None):
    """07/11 11:24–11:37 (real visit #148): the living room inside first — the waiting signal — then the door's camera
    opens the visit at 11:24:40, the living room again at 11:28, a room's sound, another camera."""
    vi = Visit(media=media)
    vi.add("inside", LIVING, "11:24:26", area="Living Room")
    vi.add("motion", DOOR_MOTION, "11:24:36", photo=True)
    ev = vi.event("opened")
    ev["visit"]["opened_at"] = at("11:24:40")
    play(v, send(ev))
    for kind, eid, hms, area in (("motion", DOOR_MOTION, "11:28:03", None), ("inside", LIVING, "11:28:12", "Living Room"),
                                 ("noise", ROOM_PERSON, "11:32:58", "Storage Room"),
                                 ("motion", WATERWALL, "11:37:29", None))[:upto]:
        vi.add(kind, eid, hms, photo=kind != "noise", area=area)
        ev = vi.event()
        ev["visit"]["opened_at"] = at("11:24:40")
        play(v, send(ev))
    return vi


def test_a_visit_whose_first_step_was_its_strongest_says_its_alert_sent_from_its_first_card(tmp_path, kiosk, media):
    # real visit #148 (owner, 2026-11-07): nothing stronger than the first step ever came, so no card was sent again and
    # the Status never said "Alert sent" — on Telegram or the tablet — while every drill's did
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("inside", LIVING, "11:24:26", area="Living Room")      # one source: no siren's question redraws the cards
    ev = vi.event("opened")
    ev["visit"]["opened_at"] = at("11:24:40")
    play(v, send(ev))
    for chat in (OWNER, FM):
        st = lines(copy(v, chat)["text"])
        assert "- Alert sent 11:24 (to: Owner & FM)" in st, st
        assert st.index("- Someone is inside (Living Room) at 11:24") < st.index("- Alert sent 11:24 (to: Owner & FM)"), st
    assert "- Alert sent 11:24 (to: Owner & FM)" in kiosk.messages["incident:1"]["status"], kiosk.messages["incident:1"]


def test_the_same_room_again_widens_its_line_like_the_cameras(tmp_path, kiosk, media):
    # real visit #148: the living room at 11:24 and again at 11:28 read "Someone is inside (Living Room) at 11:24"
    v = villa(tmp_path, kiosk)
    _visit_148(v, media)
    st = lines(copy(v, OWNER)["text"])
    assert st[:3] == ["- Someone is inside (Living Room) at 11:24–11:28", "- Seen at Main House Door, 11:24–11:28",
                      "- Alert sent 11:24 (to: Owner & FM)"], st
    assert "- Sound heard in the Storage Room at 11:32" in st and "- Seen at Waterwall Buddha, 11:37" in st, st
    assert sum("Someone is inside" in ln for ln in st) == 1, st
    assert sum(ln.startswith("- Alert sent") for ln in st) == 1, st
