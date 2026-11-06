"""One visit, one story, phase C (owner, 2026-11-06): what the villa's presence automation (CRITICAL Presence Guard,
Visit mode) sends that the Agent reads, through the real path — on_ha_event, the alert desk's desk.py as the engine
runs it, every chat's copy, the villa told through its script: a press on the villa's own buttons (its data the visit's
time only, Telegram's 64 bytes), handed over as a `step` with the answer and no step; the record's `owner: pending`
before VESTA said it holds the visit; the villa's own reminder; a room's sound (never opens a visit, adds its line); a
drill (never offers the siren); and the Limits tab showing and setting the villa's own reminder delay. Synthetic villa:
every id invented."""
from __future__ import annotations

import asyncio

from test_visit_story import (FM, NAMES, OWNER, PARKING, ENTRANCE, LOCK, Visit, Writer, at, copy, lines, play, send, tick,
                              told, villa)
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from helpers import make_agent
from vesta_shared.store import Store

NOISE = "binary_sensor.example_server_noise"
NAMES[NOISE] = "Server Room Noise"
EPOCH = Visit().id.rsplit("-", 1)[1]


def opened(v, media, **visit):
    vi = Visit(media=media, **visit)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    return vi


# ---------------------------------------------------------------------------------------------- the villa's buttons
def test_a_press_on_the_villas_own_button_is_left_to_the_villa_then_applied_from_its_step(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = opened(v, media)
    sent = len(v.tg.sent)
    # the villa's card, taken over (VESTA's own now), still showed the villa's buttons when Wayan pressed Done there:
    # the villa's automation answers it; VESTA says nothing over it (it said "Unknown button.")
    play(v, lambda v: v.on_ha_event("telegram_callback", {
        "id": "cb-villa", "data": f"/visit_done {EPOCH}", "chat_id": FM, "user_id": FM, "from_first": "Wayan",
        "message": {"message_id": 501, "chat": {"id": FM}}}))
    assert v.state.is_own_message(FM, 501), "the card is VESTA's: the press is left alone only for its data"
    assert v.tg.toasts == [], v.tg.toasts
    # the villa recorded it and hands it over: phase step, the answer, no step, the same seq, the record closed
    vi.answered = {"option": "done", "by": "Wayan", "at": at("18:25:00"), "where": "telegram"}
    ev = vi.event("step", timestamp=at("18:25:01"))
    ev["visit"].update(step=None, closed={"why": "answered", "at": at("18:25:00"), "who": "Wayan"})
    play(v, send(ev))
    assert Store(v.s.store_path).incident(1)["closed_at"], "Wayan's Done closed the alert"
    for chat in (OWNER, FM):
        assert "Done on " in copy(v, chat)["text"] and "(Wayan)" in copy(v, chat)["text"], copy(v, chat)["text"]
        assert "Watch" not in copy(v, chat)["text"]
    assert [t for _c, t, _k in v.tg.sent[sent:] if not t.startswith("Approval")] == [], "nothing sent anew"
    assert len([d for d in told(v) if d.get("answered")]) == 1


def test_a_villa_press_vesta_missed_at_start_is_never_answered_late_by_vesta(tmp_path, kiosk, media):
    from datetime import datetime, timedelta, timezone
    from vesta_agent import missed_at_start
    v = villa(tmp_path, kiosk)
    opened(v, media)
    q = {"id": "cb-late", "data": f"/visit_not_a_problem {EPOCH}", "chat_id": FM, "user_id": FM,
         "message": {"message_id": 501, "chat": {"id": FM}}}
    late = missed_at_start.Missed(datetime.now(timezone.utc) - timedelta(hours=1), "telegram_callback", q)
    n = len(v.tg.sent)
    play(v, lambda v: v._too_late(late))
    assert len(v.tg.sent) == n, "no 'VESTA was restarting when you pressed …' for the villa's own button"


# ---------------------------------------------------------------------------------------------- owner: pending
def test_a_stronger_step_before_vesta_said_it_holds_the_visit_rings_from_vesta(tmp_path, kiosk, media):
    # the villa opens its record "pending" (it sent the first message, VESTA has not told it yet) and leaves every later
    # step to VESTA until its own wait is over: a lock then must still ring, from VESTA
    v = villa(tmp_path, kiosk)
    vi = opened(v, media, owner="pending")
    n = len(v.tg.sent)
    vi.add("lock", LOCK, "18:35:40", how="lock")
    play(v, send(vi.event()))
    rang = [c for c, t, _k in v.tg.sent[n:] if "Outdoor entrance Lock opened while the villa is empty" in t]
    assert sorted(rang) == [OWNER, FM], v.tg.sent[n:]
    assert all("- Stronger signal sent " in copy(v, c)["text"] for c in (OWNER, FM))


# ---------------------------------------------------------------------------------------------- the villa's reminder
def test_the_villas_own_reminder_mid_visit_is_never_sent_again_by_vesta(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = opened(v, media)
    # VESTA went silent; the villa took the visit back and sent its one plain reminder; VESTA hears the next step
    vi.owner, vi.reminded_at = "villa", at("18:36:00")
    vi.add("motion", ENTRANCE, "18:37:00")
    play(v, send(vi.event()))
    play(v, lambda v: tick(v, 20))
    assert not [t for _c, t, _k in v.tg.sent if "Reminder sent" in t or "No answer after" in t]


# ---------------------------------------------------------------------------------------------- a room's sound
def test_a_sound_alone_opens_nothing_and_a_sound_in_an_open_visit_adds_its_own_line(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    alone = Visit(media=media)
    alone.add("noise", NOISE, "03:00:00", area="Server Room")
    alone.strongest = lambda: {k: alone.steps[0][k] for k in ("kind", "entity_id", "name", "at")}
    play(v, send(alone.event("opened")))
    assert Store(v.s.store_path).incidents(open_only=False) == [] and v.tg.sent == [], "a sound is no alert"
    w = villa(tmp_path / "open", kiosk)
    vi = opened(w, media)
    n = len(w.tg.sent)
    vi.add("noise", NOISE, "18:21:30", area="Server Room")
    play(w, send(vi.event()))
    st = lines(copy(w, OWNER)["text"])
    assert "- Sound heard in the Server Room at 18:21" in st, st
    assert not [ln for ln in st if "inside" in ln.lower()], st
    assert len(w.tg.sent) == n, "a sound is no stronger step: an edit, no sound on the phones"
    # one camera and one sound within the siren's window: one source only, the siren is never offered
    assert not w.state.approvals_in("pending")


# ---------------------------------------------------------------------------------------------- a drill
def test_a_drill_never_offers_the_siren(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16")
    ev = vi.event("opened")
    ev["visit"]["drill"] = True
    play(v, send(ev))
    vi.add("motion", ENTRANCE, "18:20:40")
    ev = vi.event()
    ev["visit"]["drill"] = True
    play(v, send(ev))
    assert not v.state.approvals_in("pending"), "two sources while empty, but a drill"
    vi.add("motion", PARKING, "18:21:00")
    play(v, send(vi.event()))                                # the same visit, no drill: the gate is the visit's
    assert v.state.approvals_in("pending")


# ---------------------------------------------------------------------------------------------- the Limits tab
def test_the_limits_tab_shows_and_sets_the_villas_own_reminder_delay(tmp_path):
    from aiohttp.test_utils import TestClient, TestServer
    from vesta_agent import requests_box
    from vesta_agent.ui.server import UI
    from vesta_shared.params import kept_params
    v = make_agent(tmp_path, {}, skills=["alert-desk"])
    Writer.calls = []
    v.actions.writer_factory = Writer
    eid = "input_number.vesta_reask_minutes"
    other = "input_number.vesta_example_light"          # a villa helper named like one, but no skill's behaviour
    Store(v.s.store_path).cache_put("villa_params", {"at": "2026-11-06T18:00:00+00:00",
                                                     "states": {eid: "20.0", other: "3"},
                                                     "helpers": [{"entity_id": eid, "helper_type": "input_number",
                                                                  "min": 1, "max": 240},
                                                                 {"entity_id": other, "helper_type": "input_number"}]})

    async def go():
        stop = asyncio.Event()
        agent = asyncio.create_task(requests_box.serve(v.s.data_dir, v.on_request, stop))
        try:
            async with TestClient(TestServer(UI(v.s, "standalone").app())) as c:
                rows = (await (await c.get("/api/limits")).json())["rows"]
                (row,) = [r for r in rows if r["name"] == "rules.yaml › behaviour.reask_minutes"]
                put = lambda rid, value: c.put("/api/limits", json={"id": rid, "value": value},   # noqa: E731
                                               headers={"X-Vesta-UI": "1"})
                bad = await put({**row["id"], "villa": other}, 5)
                over = await put(row["id"], 500)
                ok = await put(row["id"], 25)
                again = [r for r in (await (await c.get("/api/limits")).json())["rows"] if r["ref"] == row["ref"]]
                return row, bad.status, over.status, ok.status, again
        finally:
            stop.set()
            await agent
    row, bad, over, ok, again = asyncio.run(go())
    # one value: the villa's, which the alert desk and the villa's own automation both read
    assert row["value"] == 20 and row["id"]["villa"] == eid and (row["lo"], row["hi"]) == (1, 240), row
    assert eid in row["also"] and "15" in row["also"], row["also"]
    assert bad >= 400 and over >= 400, "only a behaviour's own helper, within its bounds"
    assert ok == 200 and Writer.calls == [("input_number", "set_value", {"entity_id": eid, "value": 25})], Writer.calls
    assert again[0]["value"] == 25 and kept_params(Store(v.s.store_path)).behaviour("reask_minutes") == 25
