"""One visit, one story: what the owner's first drills on the villa showed (2026-11-06, #127 VESTA on, #128 a break-in,
#129 VESTA stopped then back), replayed through the real path — the events as the engine receives them (on_ha_event),
the alert desk's desk.py as the engine runs it, every chat's copy, the villa's script, the tablet's card and fault —
and the villa's record fed what VESTA told it (test_visit_record renders the tracked package):

- every step VESTA takes is told to the villa as taken — an edit (the relock), a ring, a step of a visit already closed
  — and the record never goes back to an earlier one when two tells cross;
- VESTA back mid-visit takes the villa's card over IN PLACE (the record as the villa holds it now, not as the late
  events said it) and removes the villa's replies; a card deleted in its chat is sent again, never pointed at;
- the close edits the one card, its sheet kept;
- the Status in time order, "Alert sent" when the villa sent it;
- a lock opened from the app by no one known: "from the app", never "(?)";
- the tablet: every step's run taken (the visit's key never crowded out), the fault about the strongest step's device,
  the closed visit under Closed at once (notWatched).
Synthetic villa: every id invented."""
from __future__ import annotations

import asyncio
import re

import test_visit_record as record
from test_visit_story import (FM, GARDEN_DOOR, LOCK, OWNER, PARKING, RECORD, ENTRANCE, Visit, at, copy, lines, play,
                              send, told, villa)
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_agent.ha_events import CONTEXT_KEY
from vesta_shared.store import Store


def _record_of(vi: Visit) -> record.Rec:
    """The villa's record as its opening wrote it (the cards each chat shows: the visit's)."""
    rec = record.Rec()
    record.fire(rec, {"record": record.RECORD, "visit": vi.id, "token": "o", "set": {
        "state": "open", "id": vi.id, "automation": "automation.example", "seq": 1, "owner": "pending", "ack_seq": 0,
        "messages": [{**m, "media": "photo"} for m in vi.messages], "candidate": None}})
    return rec


def _replay(rec: record.Rec, tells: list[dict]) -> None:
    """What VESTA told, run on the villa's script in the order it arrived."""
    for d in tells:
        record.tell(rec, **{**d, "record": record.RECORD})


# ---------------------------------------------------------------------------------------------- every step told
def test_every_step_vesta_takes_is_told_and_the_record_never_goes_back(tmp_path, kiosk, media):
    # drill #127: the door, the lock and its relock within 17s, their results carried out together
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:41:04", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "22:41:38", photo=True)
    e2 = vi.event()
    vi.add("lock", LOCK, "22:41:46", how="app:", photo=True)
    e3 = vi.event()
    vi.add("relock", LOCK, "22:41:55")
    e4 = vi.event()

    async def together(v):
        await asyncio.gather(*(v.on_ha_event("vesta_critical_event", e) for e in (e2, e3, e4)))
    play(v, together)
    assert {d["ack_seq"] for d in told(v)} >= {1, 2, 3, 4}, [d["ack_seq"] for d in told(v)]
    rec = _record_of(vi)
    for seq in (2, 3, 4):
        record.fire(rec, {"record": record.RECORD, "visit": vi.id, "token": f"s{seq}", "set": {"seq": seq}})
    _replay(rec, told(v))
    assert rec.attributes["ack_seq"] == 4, "the relock told: the villa never takes the visit back"
    assert sorted((m["chat_id"], m["message_id"]) for m in rec.attributes["messages"] if m["role"] == "card") == \
        sorted((c, copy(v, c)["mid"]) for c in (OWNER, FM)), "the cards each chat shows now"
    # a step of the visit after a person closed it: still told as taken
    sk = v.skills.get("alert-desk")
    play(v, lambda v: v.run_code_job(sk, "desk.py reply --incident 1 --option done --from fm --name Wayan --place telegram", 60))
    n = len(told(v))
    vi.add("motion", ENTRANCE, "22:43:00")
    play(v, send(vi.event()))
    assert told(v)[n:] and told(v)[-1]["ack_seq"] == 5, told(v)[n:]


# ---------------------------------------------------------------------------------------------- VESTA back mid-visit
def test_vesta_back_mid_visit_takes_the_villas_card_over_in_place_and_removes_its_replies(tmp_path, kiosk, media):
    # drill #129: VESTA stopped, the villa opened the visit and held it (its reply photo, its ringing line), VESTA starts
    # and takes in the events it missed, each saying the visit as it was ("pending": nobody held it yet)
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "22:55:00", photo=True)
    first = vi.event("opened")
    vi.add("door", GARDEN_DOOR, "22:55:21", photo=True)
    second = vi.event()
    replies = [{"entity_id": f"notify.example_{c}", "chat_id": c, "message_id": m, "role": "reply"}
               for c, m in ((OWNER, 600), (FM, 601))]
    v.reader._states[RECORD] = {"entity_id": RECORD, "state": "open", "attributes": {
        "id": vi.id, "owner": "villa", "messages": vi.messages + replies, "answered": None, "reminded_at": None,
        "ack_seq": 0, "closed": None}}
    play(v, send(first), send(second))
    rang = [(c, t) for c, t, _k in v.tg.sent if not t.startswith("Approval")]
    assert rang == [], "the villa rang the door itself: VESTA sends nothing new"
    for chat, card in ((OWNER, 500), (FM, 501)):
        assert copy(v, chat)["mid"] == card, "the villa's card, taken over in place"
    assert {(c, m) for c, m, *_ in v.tg.media_edits} == {(OWNER, 500), (FM, 501)}, "the sheet on the villa's own card"
    assert (OWNER, 600) in v.tg.deleted and (FM, 601) in v.tg.deleted, "the villa's replies removed"
    last = told(v)[-1]
    assert last["owner"] == "vesta" and sorted(last["dropped"]) == [600, 601], last


def _held_by_the_villa(v, vi: Visit) -> record.Rec:
    """Drill #132: VESTA stopped, the villa opened the visit, then rang its door step itself (a reply photo) while it
    held it — the record as the villa's system holds it when VESTA starts again, read by the engine."""
    rec = _record_of(vi)
    replies = [{"entity_id": f"notify.example_{c}", "chat_id": c, "message_id": m, "role": "reply", "media": "photo"}
               for c, m in ((OWNER, 600), (FM, 601))]
    record.fire(rec, {"record": record.RECORD, "visit": vi.id, "token": "d", "set": {
        "seq": 2, "owner": "villa", "messages": rec.attributes["messages"] + replies}})
    assert rec.attributes["owner"] == "villa" and int(rec.attributes["seq"]) == 2, rec.attributes
    _read_now(v, rec)
    return rec


def _read_now(v, rec: record.Rec) -> None:
    v.reader._states[RECORD] = {"entity_id": RECORD, "state": rec.state, "attributes": dict(rec.attributes)}


def test_vesta_back_while_the_villa_held_the_visit_never_rings_a_step_the_villa_told(tmp_path, kiosk, media):
    # drill #132: the catch-up took in the missed opening (VESTA took the villa's card over and told the villa), then
    # the missed door step with the record saying VESTA held it: VESTA rang the door again in both chats
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "03:29:42", photo=True)
    first = vi.event("opened")
    vi.add("door", GARDEN_DOOR, "03:30:20", photo=True)
    second = vi.event()
    rec = _held_by_the_villa(v, vi)
    play(v, send(first))
    _replay(rec, told(v))
    assert rec.attributes["owner"] == "vesta", "the opening taken over: the record says VESTA holds it"
    _read_now(v, rec)
    edits = len(v.tg.edits)
    play(v, send(second))
    assert [(c, t[:30]) for c, t, _k in v.tg.sent if not t.startswith("Approval")] == [], "the villa rang the door"
    for chat, card in ((OWNER, 500), (FM, 501)):
        assert copy(v, chat)["mid"] == card, "the villa's card kept, never deleted for a new one"
        assert (chat, card) not in v.tg.deleted
    assert {(c, m) for c, m, _t in v.tg.edits[edits:]} >= {(OWNER, 500), (FM, 501)}, "the door folded in by an edit"
    assert "- Garden Door opened, 03:30" in lines(copy(v, OWNER)["text"])
    assert not [ln for ln in lines(copy(v, OWNER)["text"]) if "Stronger signal sent" in ln]


def test_a_step_after_vesta_holds_the_visit_the_villa_never_told_still_rings(tmp_path, kiosk, media):
    # the control: taken over from the villa at its door step, a lock opened after it is VESTA's to ring
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "03:29:42", photo=True)
    first = vi.event("opened")
    vi.add("door", GARDEN_DOOR, "03:30:20", photo=True)
    rec = _held_by_the_villa(v, vi)
    play(v, send(first))
    _replay(rec, told(v))
    _read_now(v, rec)
    vi.owner = "vesta"
    vi.add("lock", LOCK, "03:33:10", how="lock")
    record.fire(rec, {"record": record.RECORD, "visit": vi.id, "token": "l", "set": {"seq": 3}})
    _read_now(v, rec)
    play(v, send(vi.event()))
    rang = [c for c, t, _k in v.tg.sent if not t.startswith("Approval")]
    assert sorted(rang) == [OWNER, FM], "the lock, stronger and the villa's never: sent again, it rings"
    assert "- Stronger signal sent " in copy(v, OWNER)["text"]


def test_a_card_deleted_in_its_chat_is_sent_again_never_kept_as_a_pointer(tmp_path, kiosk, media):
    # the group's card 1479 was gone when VESTA took it over: edited, "kept, now a pointer", then posted anew at the close
    v = villa(tmp_path, kiosk)
    v.tg.gone.add((OWNER, 500))
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:55:00", photo=True)
    play(v, send(vi.event("opened")))
    assert copy(v, OWNER)["mid"] != 500 and copy(v, FM)["mid"] == 501
    assert len([c for c, t, _k in v.tg.sent if c == OWNER and not t.startswith("Approval")]) == 1, "one card in its place"
    vi.add("motion", ENTRANCE, "22:56:00")
    play(v, send(vi.event()))
    assert not [t for _c, _m, t in v.tg.edits if "see the newer message" in t]
    assert copy(v, OWNER)["mid"] != 500


# ---------------------------------------------------------------------------------------------- the close
def test_the_close_edits_the_one_card_in_place_keeping_its_sheet(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "22:48:20", photo=True)
    play(v, send(vi.event()))
    cards = {c: copy(v, c)["mid"] for c in (OWNER, FM)}
    assert all(copy(v, c).get("sheet") for c in (OWNER, FM))
    sent = len(v.tg.sent)
    play(v, send(vi.event("resolved")))
    assert [(c, t[:40]) for c, t, _k in v.tg.sent[sent:]] == [], "no new message at the close"
    for chat in (OWNER, FM):
        assert copy(v, chat)["mid"] == cards[chat] and copy(v, chat).get("sheet"), "the same card, its sheet kept"
        assert re.search(r"Cleared on .*no further signal for 30min", lines(copy(v, chat)["text"])[-1])
    # on the tablet: the fault closed watching nothing after it — under Closed at once
    (fault,) = [t for t in kiosk._all() if t.get("status") == "resolved"]
    assert fault.get("notWatched") is True and "confirmsBy" not in fault, fault


# ---------------------------------------------------------------------------------------------- the Status
def test_the_status_is_in_time_order_and_the_alert_sent_when_the_villa_sent_it(tmp_path, kiosk, media):
    # drill #129: "Seen at Test motion, 22:55–22:58 / Alert sent 22:57 / Test door opened, 22:55"
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="villa")
    vi.add("motion", PARKING, "22:55:00", photo=True)
    vi.add("door", GARDEN_DOOR, "22:55:21", photo=True)
    ev = vi.event("opened")
    ev["visit"]["opened_at"] = at("22:55:12")
    play(v, send(ev))
    vi.owner = "vesta"
    vi.add("lock", LOCK, "22:58:07", how="lock")             # stronger: sent again, the alert's line now in the Status
    play(v, send(vi.event()))
    st = lines(copy(v, OWNER)["text"])
    seen = next(i for i, ln in enumerate(st) if ln.startswith("- Seen at Parking"))
    sent = next(i for i, ln in enumerate(st) if ln.startswith("- Alert sent"))
    door = next(i for i, ln in enumerate(st) if ln.startswith("- Garden Door opened"))
    assert seen < sent < door, st
    assert re.fullmatch(r"- Alert sent \d\d/\d\d/\d{4} 22:55 \(to: Owner & FM\)", st[sent]), st[sent]


def test_a_lock_opened_from_the_app_by_no_one_known_says_from_the_app(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:41:04")
    play(v, send(vi.event("opened")))
    vi.add("lock", LOCK, "22:41:46", how="app:")
    play(v, send(vi.event()))
    st = lines(copy(v, OWNER)["text"])
    assert "- Outdoor entrance Lock opened from the app, 22:41" in st and not [ln for ln in st if "(?)" in ln], st
    w = villa(tmp_path / "jim", kiosk)
    wi = Visit(media=media)
    wi.add("lock", LOCK, "22:41:46", how="app:Jim")
    play(w, send(wi.event("opened")))
    assert "- Outdoor entrance Lock opened from the app (Jim), 22:41" in lines(copy(w, OWNER)["text"])


# ---------------------------------------------------------------------------------------------- the tablet
def test_the_tablets_card_takes_every_steps_run_and_its_fault_follows_the_strongest_step(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:00:00")
    play(v, send({**vi.event("opened"), CONTEXT_KEY: "RUN-1"}))
    for i in range(2, 26):
        vi.add("motion", ENTRANCE if i % 2 else PARKING, f"22:{i:02d}:00")
        play(v, send({**vi.event(), CONTEXT_KEY: f"RUN-{i}"}))
    vi.add("lock", LOCK, "22:30:00", how="lock")
    play(v, send({**vi.event(), CONTEXT_KEY: "RUN-26"}))
    takes = kiosk.messages["incident:1"]["takes"]
    assert f"visit:{vi.id}" in takes and "RUN-26" in takes and "RUN-25" in takes, takes
    (fault,) = [t for t in kiosk._all() if t.get("alertNumber") == 1]
    assert fault["entityId"] == LOCK, "the card named as Telegram's title: the lock"


# ---------------------------------------------------------------------------------------------- the photo sheet
#: Six cameras' photos, each one colour (4:3, not the tiles' 16:9: each must still fill its tile)
COLOURS = [(200, 40, 40), (40, 160, 40), (40, 40, 200), (200, 160, 40), (160, 40, 200), (40, 160, 160)]


def _near(px, colour, tol=45):
    return all(abs(a - b) <= tol for a, b in zip(px, colour))


def test_the_photo_sheet_is_never_taller_than_wide_each_label_on_its_own_photo(tmp_path, media):
    # owner's cards #131 (960x1440) and #133 (960x1080): Telegram on Android cropped the tall sheet in the chat bubble,
    # the last row's labels ("Test person 03:22") gone
    import io as _io

    from PIL import Image
    from vesta_agent import sheet
    paths = []
    for i, c in enumerate(COLOURS):
        p = media / f"cam{i}.jpg"
        Image.new("RGB", (640, 480), c).save(p, "JPEG")
        paths.append(p)
    w = sheet.tile_px()
    h = w * 9 // 16
    want = {1: (2 * w, 2 * h), 2: (3 * w, 2 * h), 3: (3 * w, 2 * h), 4: (3 * w, 3 * h), 5: (3 * w, 3 * h), 6: (3 * w, 3 * h)}
    for n in range(1, 7):
        photos = [{"path": str(paths[i]), "label": f"Camera {i}", "at": at(f"03:2{i}:00")} for i in range(n)]
        im = Image.open(_io.BytesIO(sheet.build(photos, 6, "UTC"))).convert("RGB")
        assert im.size == want[n] and im.width >= im.height, (n, im.size)
        _, places = sheet.cells(n)
        assert places[0] == (0, 0, 2), "the strongest spans 2x2 at the top left"
        for i, (c, r, span) in enumerate(places):
            x, y, tw, th = c * w, r * h, span * w, span * h
            colour = COLOURS[i]
            # the photo fills its tile: its colour at the top corners and the middle (no black margin)
            for px in ((x + 3, y + 3), (x + tw - 4, y + 3), (x + tw // 2, y + th // 2)):
                assert _near(im.getpixel(px), colour), (n, i, px, im.getpixel(px))
            if span == 2:
                assert _near(im.getpixel((x + 3 * w // 2, y + 3 * h // 2)), colour), "the strongest fills 2x2"
            # its label written on it, in the tile's bottom band, inset from the edges (the photo still shows round it)
            band = [im.getpixel((xx, yy)) for xx in range(x, x + tw // 2) for yy in range(y + th * 3 // 4, y + th)]
            assert sum(1 for p in band if min(p) > 200) > 20, (n, i, "no label text on the photo")
            assert _near(im.getpixel((x + 1, y + th - 2)), colour) and _near(im.getpixel((x + 1, y + th - 30)), colour), \
                (n, i, "the label's box starts at the tile's edge")
            assert _near(im.getpixel((x + 20, y + th - 3)), colour), (n, i, "the label's box sits on the tile's bottom edge")


def test_the_most_photos_the_setting_allows_still_make_a_wide_sheet():
    # the Limits page offers visit.sheet_tiles up to its `hi`: every value it accepts lays out landscape
    import os as _os

    from vesta_agent import sheet
    from vesta_shared import limits
    src = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    found, _ = limits.scan([_os.path.join(src, "starter")])
    d = found["visit.sheet_tiles"]
    for n in range(d.lo, d.hi + 1):
        (cols, rows), places = sheet.cells(n)
        assert len(places) == n and cols * 16 >= rows * 9, (n, cols, rows)
