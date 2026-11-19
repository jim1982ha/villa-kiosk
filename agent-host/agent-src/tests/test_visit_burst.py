"""A step's burst of photos, one kept (owner, 2026-11-15: two real visits showed an empty scene, the photo taken the
instant the motion began): the Presence Guard's "Burst, best picked" sends up to 3 frames of one step, VESTA keeps
one — the model the villa set, else the frame most different from the first — deletes the others and tells the villa,
and the step has that one photo on Telegram ("All photos"), on the tablet's card and in the villa's record. Through
the real path: the visit's events as the engine receives them, the alert desk, each chat's copy, a press as Telegram
fires it. Synthetic villa: every id invented."""
from __future__ import annotations

import asyncio
import os

from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from test_visit_story import OWNER, PARKING, Visit, at, copy, play, send, told, villa
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_agent import button_data, runner, status
from vesta_agent.state import State
from telegram_fake import BOT

#: each frame's shade: the third the most different from the first, the second only a little
SHADES = {1: (20, 20, 20), 2: (60, 60, 60), 3: (230, 230, 230)}


def frame(path, shade):
    from PIL import Image
    Image.new("RGB", (64, 48), shade).save(path, "JPEG")


def burst(vi, media, hms, pick, frames=(1, 2, 3)):
    """A step of the visit with a burst of photos, as the villa records it (one dict per frame, a shared key)."""
    s = vi.add("motion", PARKING, hms)
    key = f"vesta_alert_example_{hms.replace(':', '')}_{s['seq']}"
    for n in frames:
        path = media / f"{key}_f{n}.jpg"
        frame(path, SHADES[n])
        vi.photos.append({"path": str(path), "camera": "camera.example_parking", "camera_name": "Parking",
                          "entity_id": PARKING, "kind": "motion", "at": at(hms), "burst": key, "frame": n, "pick": pick})
    return [str(media / f"{key}_f{n}.jpg") for n in frames]


def every_photo_sent(v, chat=OWNER):
    """What "All photos" sends in `chat`: each photo's caption."""
    mid = copy(v, chat)["mid"]
    rows = (copy(v, chat).get("kb") or {}).get("inline_keyboard") or []
    (b,) = [b for row in rows for b in row if b["callback_data"].startswith(button_data.PHOTOS + ":")]

    async def go(v):
        await v.on_ha_event("telegram_callback", {"id": "cb", "data": b["callback_data"], "chat_id": chat,
                                                  "user_id": chat, "message": {"message_id": mid, "chat": {"id": chat}},
                                                  "bot": BOT})
    play(v, go)
    return [cap for _c, caps, _r in v.tg.albums for cap in caps]


def sdk(monkeypatch, answer=None, fail=False):
    """The model's side of one run: its answer, or a failure."""
    seen = []
    thinking = sdk.thinking = []

    class Fake:
        def __init__(self, options):
            seen.append(options.model)
            thinking.append(options.thinking)

        async def __aenter__(self):
            if fail:
                raise RuntimeError("the AI is unreachable")
            return self

        async def __aexit__(self, *a):
            return False

        async def query(self, prompt):
            pass

        async def receive_response(self):
            yield AssistantMessage(content=[TextBlock(text=answer)], model="m")
            yield ResultMessage(subtype="success", duration_ms=10, duration_api_ms=5, is_error=False, num_turns=1,
                                session_id="s", total_cost_usd=0.002, result=answer,
                                usage={"input_tokens": 3000, "output_tokens": 2})
    monkeypatch.setattr(runner, "ClaudeSDKClient", Fake)
    return seen


def test_change_detection_keeps_the_frame_most_different_from_the_first_and_deletes_the_others(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    f1, f2, f3 = burst(vi, media, "18:34:10", "diff")
    play(v, send(vi.event()))
    assert os.path.exists(f3) and not os.path.exists(f1) and not os.path.exists(f2), "the others deleted at once"
    paths = [p["path"] for p in v.visits.every_photo(1)]
    assert f3 in paths and f1 not in paths and f2 not in paths and len(paths) == 2, "one photo per step"
    tablet = [p.get("path") for p in kiosk.messages["incident:1"]["photos"]]
    assert sorted(tablet) == sorted(paths), "the tablet's card shows the same one photo of the step"
    assert every_photo_sent(v) == ["Parking · 18:20", "Parking · 18:34"], "Telegram's \"All photos\": one per step"
    dropped = [d["dropped_photos"] for d in told(v) if "dropped_photos" in d]
    assert dropped == [[f1, f2]], ("the villa told, so its record drops them", told(v))


def test_the_model_the_villa_set_chooses_the_frame_and_its_cost_is_counted(tmp_path, kiosk, media, monkeypatch):
    models = sdk(monkeypatch, answer="2")
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "haiku")
    play(v, send(vi.event("opened")))
    assert models == ["haiku"], "one call, to the model the villa set"
    assert [p["path"] for p in v.visits.every_photo(1)] == [f2], "the frame the model named, not the most different"
    assert os.path.exists(f2) and not os.path.exists(f1) and not os.path.exists(f3)
    rows = [r for r in status.costs(State(v.s.state_path))["runs"] if r["kind"] == "photo_pick"]
    assert len(rows) == 1 and rows[0]["cost"] == 0.002, "with the AI costs, on a row of its own"


def test_where_the_model_saw_someone_is_framed_in_green_on_the_photo_kept(tmp_path, kiosk, media, monkeypatch):
    # owner, 2026-11-16: a green rectangle around the person the model found, on the saved photo, Telegram and tablet
    from PIL import Image
    sdk(monkeypatch, answer="2 0.25 0.25 0.75 0.75")
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "haiku")
    play(v, send(vi.event("opened")))
    assert [p["path"] for p in v.visits.every_photo(1)] == [f2]
    with Image.open(f2) as im:
        edge, inside = im.convert("RGB").getpixel((16, 24)), im.convert("RGB").getpixel((32, 24))
    assert edge[1] > 150 and edge[0] < 150 and edge[2] < 150, ("the rectangle's edge is green", edge)
    assert max(abs(c - 60) for c in inside) < 25, ("inside it, the photo as taken", inside)


def test_a_wordy_answer_is_read_only_where_it_answers_as_asked_and_the_model_does_not_think(tmp_path, kiosk, media,
                                                                                            monkeypatch):
    # owner, 2026-11-16: half the choices cut at the limit, ~1,000 tokens written for one line of numbers
    from PIL import Image
    sdk(monkeypatch, answer="Photo 1 shows the yard at 15:07:24 and photo 3 is blurred. 2 0.25 0.25 0.75 0.75")
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "haiku")
    play(v, send(vi.event("opened")))
    assert [p["path"] for p in v.visits.every_photo(1)] == [f2], "the frame of the answer as asked, not \"photo 1\""
    with Image.open(f2) as im:
        edge = im.convert("RGB").getpixel((16, 24))
    assert edge[1] > 150 and edge[0] < 150, ("framed where it answered", edge)
    assert sdk.thinking == [{"type": "disabled"}], "the photo choice runs without thinking"


def test_an_answer_with_no_place_keeps_the_photo_as_taken(tmp_path, kiosk, media, monkeypatch):
    from PIL import Image
    sdk(monkeypatch, answer="2")
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "haiku")
    play(v, send(vi.event("opened")))
    with Image.open(f2) as im:
        px = im.convert("RGB").getpixel((16, 24))
    assert max(abs(c - 60) for c in px) < 25, ("no rectangle", px)


def test_a_model_that_fails_falls_back_to_change_detection(tmp_path, kiosk, media, monkeypatch):
    sdk(monkeypatch, fail=True)
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "sonnet")
    play(v, send(vi.event("opened")))
    assert [p["path"] for p in v.visits.every_photo(1)] == [f3], "the frame most different from the first"
    assert not os.path.exists(f1) and not os.path.exists(f2)
    assert kiosk.messages["incident:1"]["photos"][0]["path"] == f3


def test_a_later_step_naming_the_deleted_frames_again_keeps_the_one_photo(tmp_path, kiosk, media):
    # the villa's record still names every frame until its tell script drops them: a file already gone is no error
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "diff")
    play(v, send(vi.event("opened")))
    vi.add("motion", PARKING, "18:25:00", photo=True)
    play(v, send(vi.event()))
    paths = [p["path"] for p in v.visits.every_photo(1)]
    assert f3 in paths and len(paths) == 2, paths
    assert len([d for d in told(v) if "dropped_photos" in d]) == 1, "told once"


def test_a_slow_model_lets_the_message_go_with_the_last_frame_then_puts_the_chosen_one_in_place(tmp_path, kiosk, media,
                                                                                                  monkeypatch):
    from vesta_agent import visit
    monkeypatch.setattr(visit, "pick_wait_s", lambda: 0)
    gate = asyncio.Event()
    v = villa(tmp_path, kiosk)

    async def slow(paths, how):
        await gate.wait()
        return 0
    v.visits._pick = slow
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "opus")

    async def opened(v):
        await v.on_ha_event("vesta_critical_event", vi.event("opened"))
        assert [p["path"] for p in v.visits.every_photo(1)] == [f3], "sent at once, with the last frame"
        sheet_before = copy(v, OWNER).get("sheet")
        gate.set()
        await v.visits.idle()
        assert [p["path"] for p in v.visits.every_photo(1)] == [f1], "the chosen frame in its place"
        assert copy(v, OWNER).get("sheet") != sheet_before, "every copy's picture replaced"
    play(v, opened)
    assert kiosk.messages["incident:1"]["photos"][0]["path"] == f1, "and the tablet's card"
    assert os.path.exists(f1) and not os.path.exists(f3)


def test_a_burst_where_nothing_moved_keeps_no_photo_and_asks_no_ai(tmp_path, kiosk, media, monkeypatch):
    # owner, 2026-11-19 (#199): a room's noise rule, set off by people elsewhere, sent six photos of an empty room
    models = sdk(monkeypatch, answer="2")
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "18:20:16", photo=True)
    play(v, send(vi.event("opened")))
    s = vi.add("motion", PARKING, "18:34:10")
    key = f"vesta_alert_example_183410_{s['seq']}"
    still = []
    for n in (1, 2, 3):
        path = media / f"{key}_f{n}.jpg"
        frame(path, (90 + n, 90, 90))           # the same empty scene, a level of noise apart
        still.append(str(path))
        vi.photos.append({"path": str(path), "camera": "camera.example_parking", "camera_name": "Parking",
                          "entity_id": PARKING, "kind": "motion", "at": at("18:34:10"), "burst": key, "frame": n,
                          "pick": "haiku"})
    play(v, send(vi.event()))
    assert models == [], "no AI asked to choose among photos of nothing"
    assert not any(os.path.exists(p) for p in still), "every frame deleted"
    paths = [p["path"] for p in v.visits.every_photo(1)]
    assert len(paths) == 1 and not set(paths) & set(still), ("the step stays, without a photo", paths)
    assert len(kiosk.messages["incident:1"]["photos"]) == 1, "the tablet's card shows no photo of it either"
    dropped = [d["dropped_photos"] for d in told(v) if "dropped_photos" in d]
    assert dropped == [still], ("the villa told to drop every frame", told(v))


def test_someone_coming_into_a_small_part_of_the_view_still_keeps_a_photo(tmp_path, kiosk, media):
    from PIL import Image, ImageDraw
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    f1, f2, f3 = burst(vi, media, "18:20:16", "diff")
    for n, p in enumerate((f1, f2, f3)):
        im = Image.new("RGB", (640, 360), (90, 90, 90))
        if n:                                    # a figure 1/40 of the width, 1/9 of the height, far off
            ImageDraw.Draw(im).rectangle((300, 150, 300 + 16, 150 + 40), fill=(200, 180, 160))
        im.save(p, "JPEG")
    play(v, send(vi.event("opened")))
    assert len(v.visits.every_photo(1)) == 1, "a photo kept"
