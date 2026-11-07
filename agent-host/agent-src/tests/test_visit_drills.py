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

import pytest

import test_visit_record as record
import test_visit_story
from test_visit_story import (FM, GARDEN_DOOR, LOCK, OWNER, PARKING, RECORD, ENTRANCE, Visit, at, copy, just_past, lines,
                              play, send, told, villa)
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
    assert not [ln for ln in lines(copy(v, OWNER)["text"]) if "Stronger signal sent" in ln or "alert sent again" in ln]


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
    assert "- Outdoor entrance Lock opened at the lock, 03:33: alert sent again (to: Owner & FM)" in \
        lines(copy(v, OWNER)["text"])


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
        assert re.search(r"Cleared (at|on) .*no further signal for 30min", lines(copy(v, chat)["text"])[-1])
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
    assert re.fullmatch(r"- Alert sent 22:55 \(to: Owner & FM\)", st[sent]), st[sent]


def test_a_lock_opened_from_the_app_by_no_one_known_says_from_the_app(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:41:04")
    play(v, send(vi.event("opened")))
    vi.add("lock", LOCK, "22:41:46", how="app:")
    play(v, send(vi.event()))
    st = lines(copy(v, OWNER)["text"])
    assert "- Outdoor entrance Lock opened from the app, 22:41: alert sent again (to: Owner & FM)" in st and not [ln for ln in st if "(?)" in ln], st
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
#: Nine cameras' photos, each one colour (4:3, not the tiles' 16:9: each is shown whole, dark bands at its sides), a
#: white mark in the top left corner where a camera writes its own date and name
COLOURS = [(200, 40, 40), (40, 160, 40), (40, 40, 200), (200, 160, 40), (160, 40, 200), (40, 160, 160),
           (120, 80, 40), (40, 100, 120), (150, 150, 60)]


def _near(px, colour, tol=45):
    return all(abs(a - b) <= tol for a, b in zip(px, colour))


def test_the_photo_sheet_is_never_taller_than_wide_each_photo_whole_its_label_on_it(tmp_path, media):
    # owner's cards #131 (960x1440) and #133 (960x1080): Telegram on Android cropped the tall sheet in the chat bubble,
    # the last row's labels ("Test person 03:22") gone; owner, 2026-11-07: up to 9 photos, each whole (a photo cut to
    # fill its tile lost the camera's own date, time and name)
    import io as _io

    from PIL import Image, ImageDraw
    from vesta_agent import sheet
    paths = []
    for i, c in enumerate(COLOURS):
        p = media / f"cam{i}.jpg"
        im = Image.new("RGB", (640, 480), c)
        ImageDraw.Draw(im).rectangle((0, 0, 40, 30), fill="white")          # the camera's own date and name
        im.save(p, "JPEG")
        paths.append(p)
    w = sheet.tile_px()
    h = w * 9 // 16
    want = {1: (2, 2), 2: (3, 2), 3: (3, 2), 4: (3, 3), 5: (3, 3), 6: (3, 3), 7: (4, 3), 8: (4, 3), 9: (4, 3)}
    for n in range(1, 10):
        photos = [{"path": str(paths[i]), "label": f"Camera {i}", "at": at(f"03:2{i}:00")} for i in range(n)]
        im = Image.open(_io.BytesIO(sheet.build(photos, 9, "UTC"))).convert("RGB")
        assert im.size == (want[n][0] * w, want[n][1] * h) and im.width >= im.height, (n, im.size)
        _, places = sheet.cells(n)
        assert places[0] == (0, 0, 2), "the strongest spans 2x2 at the top left"
        assert len({(c, r) for c, r, _s in places}) == n, "no two tiles on one cell"
        for i, (c, r, span) in enumerate(places):
            x, y, tw, th = c * w, r * h, span * w, span * h
            pw = th * 4 // 3                                                  # the 4:3 photo, as tall as its tile
            px0 = x + (tw - pw) // 2
            colour = COLOURS[i]
            assert _near(im.getpixel((x + tw // 2, y + th // 2)), colour), (n, i, "the photo in its tile")
            assert _near(im.getpixel((x + 2, y + th // 2)), (0, 0, 0)) and _near(im.getpixel((x + tw - 3, y + th // 2)), (0, 0, 0)), \
                (n, i, "dark bands at its sides: the photo is never cut to fill the tile")
            mark = [im.getpixel((xx, yy)) for xx in range(px0 + 1, px0 + 6) for yy in range(y + 1, y + 6)]
            assert all(min(p) > 200 for p in mark), (n, i, "the camera's own corner shows")
            # its label written on the photo, bottom left, inset from the photo's edges
            band = [im.getpixel((xx, yy)) for xx in range(px0, px0 + pw // 2) for yy in range(y + th * 3 // 4, y + th)]
            assert sum(1 for p in band if min(p) > 200) > 20, (n, i, "no label text on the photo")
            assert _near(im.getpixel((px0 + 1, y + th - 2)), colour), (n, i, "the label's box inset from the photo's edge")


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


def test_a_visit_a_person_closes_in_the_cockpit_is_closed_on_the_tablet_never_about_to_be_watched(tmp_path, kiosk, media):
    # drill #136-P1 (owner, 2026-11-07): Not a problem, Reopen, then closed again in the Cockpit — the tablet put it on
    # Watch with no state line, "about to be watched", since only VESTA's own closes said nothing watches it
    from datetime import datetime, timedelta, timezone
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    play(v, send(vi.event("opened")))
    (tid,) = [t["id"] for t in kiosk._all() if t.get("status") == "open"]
    stamp = lambda s: (datetime.now(timezone.utc) + timedelta(seconds=s)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    kiosk.person_closes(tid, by="Owner", at=stamp(1), lasting=True)
    play(v, lambda v: v.tickets.repair())
    kiosk.person_reopens(tid, by="Owner", at=stamp(2))
    play(v, lambda v: v.tickets.repair())
    kiosk.person_closes(tid, by="Owner", at=stamp(3), cockpit=True)
    play(v, lambda v: v.tickets.repair())
    fault = kiosk.ticket(tid)
    assert fault["status"] == "resolved" and fault.get("notWatched") is True and "confirmsBy" not in fault, fault


def test_an_open_visit_says_until_when_it_is_monitored_on_every_copy_and_its_fault(tmp_path, kiosk, media):
    # owner, 2026-11-07: "⚠️ New alert, monitoring until HH:MM" on Telegram, "monitoring until HH:MM" on the tablet's
    # pill, the villa's record's closes_at, moved later at each step
    from datetime import datetime
    from vesta_shared import status_words
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    first = vi.event("opened")
    play(v, send(first))
    vi.add("door", GARDEN_DOOR, "22:52:20", photo=True)
    second = vi.event()
    play(v, send(second))
    closes = datetime.fromisoformat(second["visit"]["closes_at"])
    assert closes > datetime.fromisoformat(first["visit"]["closes_at"]), "the record's moment moved later"
    hhmm = closes.astimezone(v.notices.tz and __import__("zoneinfo").ZoneInfo(v.notices.tz)).strftime("%H:%M")
    for chat in (OWNER, FM):
        assert lines(copy(v, chat)["text"])[-1] == f"⚠️ New alert, monitoring until {hhmm}", lines(copy(v, chat)["text"])
    (fault,) = [t for t in kiosk._all() if t.get("status") == "open"]
    assert datetime.fromisoformat(fault["monitoredUntil"]) == closes, fault
    # every language the Agent's words have
    for lang in status_words.LANGS:
        said = status_words.monitoring("new", "07/11/2026 06:40", lang)
        assert said.startswith(status_words.stage_words("new", lang=lang)) and "06:40" in said and len(said) > len(
            status_words.stage_words("new", lang=lang)) + 6, (lang, said)
    # closed: no longer monitored, on the copies and the fault
    play(v, send(vi.event("resolved")))
    assert "monitoring" not in lines(copy(v, OWNER)["text"])[-1]
    assert "monitoredUntil" not in kiosk.ticket(fault["id"]) or kiosk.ticket(fault["id"])["status"] == "resolved"


# ---------------------------------------------------------------------------------------------- ended while VESTA was away
def test_the_faults_short_story_says_every_line_telegram_says(tmp_path, kiosk, media):
    # owner, 2026-11-07: the tablet's card showing the fault's own story (VESTA's message absent) lacked "Alert sent" (its
    # moment the visit's first line's: the fault keeps one line per moment) and the door's ": alert sent again (to: …)"
    # (said on a line the fault already had at that moment, never written again)
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "22:52:20", photo=True)
    play(v, send(vi.event()))
    play(v, lambda v: v.tickets.repair())
    (fault,) = [t for t in kiosk._all() if t.get("status") == "open"]
    notes = [u["note"] for u in fault.get("updates") or [] if u.get("kind") == "noted"]
    tg = [ln[2:] for ln in lines(copy(v, OWNER)["text"]) if ln.startswith("- ")]
    assert "Garden Door opened, 22:52: alert sent again (to: Owner & FM)" in tg, tg
    assert any(n.startswith("Alert sent") for n in notes), notes
    assert any(n.startswith("Garden Door opened, 22:52: alert sent again (to: ") for n in notes), (notes, tg)
    assert [n for n in notes if n.startswith("Seen at Parking")] == ["Seen at Parking, 22:48"], notes


def _watched(kiosk) -> tuple[list[dict], list[dict]]:
    """Every fault the Kiosk was written, write by write, and every tablet message pushed: what it ever showed."""
    faults: list[dict] = []
    real = kiosk._req

    async def req(method, path, body=None, content=None, **kw):
        got = await real(method, path, body, content, **kw)
        if path == "/agent/v1/fm-data" and method != "GET" and got[0] == 200:
            faults.extend(copy_of(t) for t in body["data"].get("tickets") or [])
        return got
    kiosk._req = req
    return faults, kiosk.pushed


def copy_of(t: dict) -> dict:
    return {k: t.get(k) for k in ("id", "status", "alertNumber")}


# ------------------------------------------------------------------- a visit's state: record x events x VESTA
# The owner's drills of 2026-11-07, one table (visit_state: the one decision of where a visit stands):
# #138 VESTA stopped; the villa opened the visit, rang its door, reminded and closed it after its quiet; VESTA back
#      replayed opened, step, resolved — #138 opened again, the villa told twice, "Cleared at 07:17" for 07:16.
# #140 Done pressed on the villa's card while VESTA was away: the press's last event a "step" carrying the close, no
#      "resolved" — #140 stayed open, "monitoring until 08:54", its fault open, the tablet showing a new alert.
# #141 the same press in the Cockpit was closed as "Done at 09:43 (Owner)": where it was pressed, like every press.
# #143 replayed ~18s apart, the first event made an OPEN fault and a "#n-P1 (new)" pop-up: shown open ~19s.
# Whatever the record and the order, VESTA down: one closed incident and fault, closed at the villa's moment, the
# tablet's one card closed and standing for the villa's announcement; nothing sent, edited or deleted; never told.
def _closed_on_the_villa(vi: Visit, closed: dict, answered: dict | None, replies: bool) -> record.Rec:
    """The villa's record of visit `vi` as the villa left it: closed (`closed`), a press it applied (`answered`), its
    replies under the cards while it held the visit (`replies`)."""
    rec = _record_of(vi)
    more = [{"entity_id": f"notify.example_{c}", "chat_id": c, "message_id": m, "role": "reply", "media": "photo"}
            for c, m in ((OWNER, 600), (FM, 601), (OWNER, 602), (FM, 603))] if replies else []
    record.fire(rec, {"record": record.RECORD, "visit": vi.id, "token": "c", "set": {
        "state": "closed", "seq": len(vi.steps), "owner": "villa", "opened_at": vi.steps[0]["at"],
        "last_at": vi.steps[-1]["at"], "steps": list(vi.steps), "photos": list(vi.photos), "strongest": vi.strongest(),
        "step": vi.steps[-1], "reminded_at": vi.reminded_at, "closed": closed,
        **({"answered": answered} if answered else {}), "messages": rec.attributes["messages"] + more}})
    return rec


def _press() -> dict:
    """The owner's Done on the villa's card, at the visit's close (dated as the visit is: DAY when it is made)."""
    return {"option": "done", "by": "Jm", "at": at("10:04:00")}


AWAY_TABLE = [
    # name, why it closed, where a press was made, the events replayed (the last carrying the close), its last line
    ("#138 quiet, opened+step+resolved", "quiet", None, ("opened", "step", "resolved"), "✅ Cleared at "),
    ("#143 quiet, opened+resolved", "quiet", None, ("opened", "resolved"), "✅ Cleared at "),
    ("#140 Done on Telegram, no resolved", "answered", "telegram", ("opened", "step", "step"), "✅ Done on Telegram "),
    ("#141 Done in the Cockpit", "answered", "cockpit", ("opened", "step"), "✅ Done in the Cockpit "),
]


@pytest.mark.parametrize("why,where,phases,last", [r[1:] for r in AWAY_TABLE], ids=[r[0] for r in AWAY_TABLE])
def test_a_visit_the_villa_closed_while_vesta_was_away_is_one_closed_card_never_shown_open_never_told(
        tmp_path, kiosk, media, why, where, phases, last, monkeypatch):
    from datetime import datetime
    # ⚠️ REPLAYED AT THE REAL TIME, SO DATED BY IT: a visit of a fixed day failed from the next day on (the late close is
    # matched within alerts.late_close_days of now); it closed less than a day ago, whatever day this runs
    monkeypatch.setattr(test_visit_story, "DAY", just_past("10:04:00"))
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "10:03:27", photo=True)
    events = [vi.event("opened")]
    vi.add("door", GARDEN_DOOR, "10:03:50", photo=True)
    events += [vi.event(ph) for ph in phases[1:]]
    vi.reminded_at = at("10:03:55")
    closed = {"why": why, "at": at("10:04:00"), **({"who": "Jm"} if where else {})}
    rec = _closed_on_the_villa(vi, closed, {**_press(), "where": where} if where else None, replies=why == "quiet")
    _read_now(v, rec)
    events[-1] = {**events[-1], "timestamp": at("10:04:00")}
    events[-1]["visit"]["closed"] = closed
    before = dict(rec.attributes)
    faults, pushed = _watched(kiosk)
    play(v, send(events[0]))
    (inc,) = Store(v.s.store_path).incidents(open_only=False)
    assert inc["closed_at"], "closed at its first event: the record said so"
    play(v, *[send(e) for e in events[1:]])
    mine = [f for f in faults if f["alertNumber"] == inc["id"]]
    assert mine and all(f["status"] == "resolved" for f in mine) and len({f["id"] for f in mine}) == 1, \
        ("one fault, never open", mine)
    stages = [m.get("stage") for m in pushed if m.get("key") == f"incident:{inc['id']}"]
    assert stages and "new" not in stages, ("never a new alert on the tablet", stages)
    assert v.tg.sent == [] and v.tg.edits == [] and v.tg.media_edits == [] and v.tg.deleted == [], \
        "nothing sent, edited or deleted: the villa's cards are final"
    assert told(v) == [], "the villa is never told of a visit it closed"
    _replay(rec, told(v))
    assert rec.attributes == before, "its record as the villa left it"
    (inc,) = Store(v.s.store_path).incidents(open_only=False)
    assert datetime.fromisoformat(inc["closed_at"]) == datetime.fromisoformat(at("10:04:00")), inc
    (fault,) = [t for t in kiosk._all() if t.get("alertNumber") == inc["id"]]
    assert any(u.get("kind") == "noted" for u in fault["updates"]), ("its short story with it", fault["updates"])
    card = kiosk.messages[f"incident:{inc['id']}"]
    assert f"visit:{vi.id}" in card["takes"] and card.get("stage") == "closed", card
    hhmm = datetime.fromisoformat(at("10:04:00")).astimezone(__import__("zoneinfo").ZoneInfo(v.notices.tz)).strftime("%H:%M")
    assert card["status"][-1].startswith(last) and hhmm in card["status"][-1], card["status"]
    assert where is None or "(Jm)" in card["status"][-1], card["status"]
    assert any(ln.startswith("- Garden Door opened") for ln in card["status"]), ("its story as the record holds it",
                                                                                  card["status"])
    assert not any("monitoring" in ln for ln in card["status"]), card["status"]


# VESTA up: an open visit whose record says it ended (a press on the villa's card with no event, or a later visit
# holding the record) is closed at the next tick, as the villa closed it, nothing sent or told
UP_TABLE = [("Done on the villa's card", "answered"), ("a later visit holds the record", "later")]


@pytest.mark.parametrize("how", [r[1] for r in UP_TABLE], ids=[r[0] for r in UP_TABLE])
def test_an_open_visit_whose_villa_record_says_it_ended_is_closed_at_the_next_tick(tmp_path, kiosk, media, how):
    from datetime import datetime, timedelta, timezone
    from test_alert_desk import desk
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media, owner="pending")
    vi.add("motion", PARKING, "10:03:27", photo=True)
    play(v, send(vi.event("opened")))
    store = Store(v.s.store_path)
    (inc,) = store.incidents(open_only=True)
    press = _press()
    rec = _closed_on_the_villa(vi, {"why": "answered", "at": press["at"], "who": "Jm"}, {**press, "where": "telegram"},
                               replies=False)
    if how == "later":
        rec.attributes, rec.state = {**rec.attributes, "id": "automation.example-other"}, "open"

    class Villa:
        def states(self, ids=None):
            return {RECORD: {"entity_id": RECORD, "state": rec.state, "attributes": dict(rec.attributes)}}
    res = desk.tick(store, datetime.now(timezone.utc) + timedelta(minutes=5), client=Villa(), zone=v.notices.tz)
    assert res["visits_over"] == [inc["id"]] and res["send"] == [], res
    assert not [a for a in res["actions"] if a.get("action") == "tell_villa"], res["actions"]
    got = store.incident(inc["id"])
    assert got["closed_at"], got
    if how == "answered":
        assert datetime.fromisoformat(got["closed_at"]) == datetime.fromisoformat(press["at"]), got
        (settle,) = res["settle"]
        assert "Done" in str(settle) and "(Jm)" in str(settle), settle


def test_a_visits_step_reaches_the_tablets_fault_before_telegrams_last_edit(tmp_path, kiosk, media):
    # owner's screenshots, 2026-11-07 (#142): at each step the tablet's card (its name, pill and lines) came 10s to 12s
    # after Telegram's: the fault was brought up to date only after every edit, the sheet and the villa told
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "22:52:20", photo=True)
    seen: list[tuple] = []
    real = kiosk._req

    async def req(method, path, body=None, content=None, **kw):
        got = await real(method, path, body, content, **kw)
        if path == "/agent/v1/fm-data" and method != "GET":
            notes = [u.get("note") or "" for t in body["data"].get("tickets") or [] for u in t.get("updates") or []]
            seen.append((any(": alert sent again" in n for n in notes),
                         len(v.tg.sent) + len(v.tg.edits) + len(v.tg.media_edits), len(told(v))))
        return got
    kiosk._req = req
    play(v, send(vi.event()))
    first = next(s for s in seen if s[0])
    assert first[1] < len(v.tg.sent) + len(v.tg.edits) + len(v.tg.media_edits) or first[2] < len(told(v)), (first, seen)


def test_a_visits_step_writes_its_fault_with_its_tablet_message(tmp_path, kiosk, media):
    # owner's drill, 2026-11-07, 10:56: Telegram's copies of the door's step at 10:57:11 and 10:57:13, the tablet's pop-up
    # within a second, the card's name and "monitoring until" at 10:57:28 — the fault came only with the repair after
    # every copy, the sheet and the villa told. Now each push of the alert's record brings its fault first
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "10:56:13", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "10:56:34", photo=True)
    step = vi.event()
    until = step["visit"]["closes_at"]
    writes: list[tuple] = []
    real = kiosk._req

    async def req(method, path, body=None, content=None, **kw):
        if path == "/agent/v1/vesta-message" and str((body or {}).get("key")) == "incident:1":
            (fault,) = [t for t in kiosk._all() if t.get("alertNumber") == 1]
            writes.append((fault.get("entityId"), fault.get("monitoredUntil")))
        return await real(method, path, body, content, **kw)
    kiosk._req = req
    play(v, send(step))
    # the first record of the step the tablet keeps: its fault already names the door and says until when it is watched
    assert writes and writes[0] == (GARDEN_DOOR, until), writes
