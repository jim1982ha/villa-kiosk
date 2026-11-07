"""A visit's every photo on ask, its picture's count line last, the tablet's state the stage alone (owner, 2026-11-07),
through the real path: the visit's events as the engine receives them, the alert desk's desk.py, each chat's copy, a
press as Telegram fires it, the tablet's card. Synthetic villa: every id invented."""
from __future__ import annotations

import re

from test_visit_story import (ENTRANCE, FM, LOCK, OWNER, PARKING, WATERWALL, Visit, copy, lines, play, send, tick,
                              villa)
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_agent import button_data
from telegram_fake import BOT


def _press(v, chat, data, mid, cb="cb"):
    async def go(v):
        await v.on_ha_event("telegram_callback", {"id": cb, "data": data, "chat_id": chat, "user_id": chat,
                                                  "message": {"message_id": mid, "chat": {"id": chat}}, "bot": BOT})
    play(v, go)


def _photos_button(v, chat):
    rec = copy(v, chat)
    rows = (rec.get("kb") or {}).get("inline_keyboard") or []
    return [b for row in rows for b in row if b["callback_data"].startswith(button_data.PHOTOS + ":")], rows


def test_all_photos_sends_every_photo_of_the_visit_in_its_one_order_in_the_chat_pressed_only(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    assert _photos_button(v, OWNER)[0] == [], "one photo: its picture shows it whole already"
    vi.add("motion", ENTRANCE, "18:34:47", photo=True)
    vi.add("lock", LOCK, "18:35:40", how="lock", photo=True)       # the strongest, the sheet's first and largest
    for i in range(10):
        vi.add("motion", WATERWALL, f"18:4{i}:00", photo=True)
    play(v, send(vi.event()))
    (button,), rows = _photos_button(v, OWNER)
    assert button["text"] == "📷 All photos" and rows[-1] == [button], "on its own row, after the alert's buttons"
    assert all(b["kind"] != button_data.PHOTOS for b in kiosk.messages["incident:1"].get("buttons") or []), \
        "the tablet shows every photo: no such button there"
    mid = copy(v, OWNER)["mid"]
    _press(v, OWNER, button["callback_data"], mid)
    albums = v.tg.albums
    assert [(c, r) for c, _caps, r in albums] == [(OWNER, mid), (OWNER, mid)], "replies to the card, in that chat alone"
    caps = [cap for _c, cs, _r in albums for cap in cs]
    assert [len(cs) for _c, cs, _r in albums] == [10, 3], "albums of up to 10"
    # the visit's one order (visit_state.ordered): the strongest step's first, as the picture's largest tile, then
    # every other photo oldest first (architecture review of visits, 2026-11-07, card 3)
    assert caps[:3] == ["Outdoor entrance Lock · 18:35", "Parking · 18:20", "Entrance Left · 18:34"], caps
    assert caps[3:] == [f"Waterwall Buddha · 18:4{i}" for i in range(10)], "every other photo, oldest first"
    assert v.tg.toasts[-1][1] == "13 photos: sending.", v.tg.toasts
    # pressed again later: the visit's photos as they are then, sent again
    _press(v, OWNER, button["callback_data"], mid, cb="cb2")
    assert len(v.tg.albums) == 4 and not [a for a in v.tg.albums if a[0] == FM]


def test_the_more_photos_line_is_the_last_status_line_whatever_comes_after(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    for i in range(10):
        vi.add("motion", PARKING if i % 2 else ENTRANCE, f"18:2{i}:00", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("lock", LOCK, "18:40:00", how="lock")                     # a later step: its line comes after, by time
    play(v, send(vi.event()))
    shown = lines(copy(v, OWNER)["text"])
    assert shown[-2] == "- +1 more photos on the tablet", shown
    tablet = kiosk.messages["incident:1"]["status"]
    assert tablet[-2] == "- +1 more photos on the tablet", tablet


def test_the_tablets_state_is_the_stage_alone_its_words_a_status_line_above(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    play(v, lambda v: tick(v, 20))                                  # no answer: the reminder
    bottom = lines(copy(v, FM)["text"])[-1]
    assert "Reminder sent" in bottom and "No answer after" in bottom, ("Telegram keeps the whole line", bottom)
    tablet = kiosk.messages["incident:1"]["status"]
    assert re.fullmatch(r"\S+( \S+)? Reminder sent (\d\d/\d\d )?\d\d:\d\d", tablet[-1]), tablet
    words = bottom[bottom.index("No answer after"):]
    assert tablet[-2] == f"- {words}", (tablet, words)
