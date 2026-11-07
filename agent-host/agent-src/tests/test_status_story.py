"""An alert's Status written once (vesta_agent/status_story.py; architecture review of visits, 2026-11-07, card 2): one
history read three ways — a Telegram copy's Status, the tablet's message and the Kiosk fault's short story — gives the
same lines, in the same order, differing only in how each writes a line's moment (Telegram and the tablet "22:52", the
fault none: the Kiosk writes the line's own time beside it). Synthetic villa: every id invented."""
from __future__ import annotations

import re

from test_visit_story import (GARDEN_DOOR, LOCK, OWNER, FM, PARKING, Visit, copy, lines, play, send, villa)
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_agent import status_story
from vesta_agent.kiosk import noted

#: a line's moment as Telegram writes it, and the word before it
_MOMENT = re.compile(r"(?: at| on)? (?:\d\d/\d\d )?\d\d:\d\d(?:–\d\d:\d\d)?(?=[ ,):.]|$)")


def _bare(line: str) -> str:
    return _MOMENT.sub("", line.removeprefix("- "))


def test_one_history_is_the_same_lines_on_telegram_the_tablet_and_the_fault(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    vi.add("motion", PARKING, "22:48:03", photo=True)
    play(v, send(vi.event("opened")))
    vi.add("door", GARDEN_DOOR, "22:52:20", photo=True)
    play(v, send(vi.event()))
    vi.add("lock", LOCK, "22:53:10", how="app:", photo=True)
    play(v, send(vi.event()))
    play(v, lambda v: v.tickets.repair())
    tg = lines(copy(v, OWNER)["text"])[:-1]                       # its Status, its bottom line left out
    assert tg == lines(copy(v, FM)["text"])[:-1], "every chat the same lines"
    tablet = kiosk.messages["incident:1"]["status"][:-1]
    assert tablet == tg, (tablet, tg)
    (fault,) = [t for t in kiosk._all() if t.get("status") == "open"]
    notes = [u["note"] for u in sorted((u for u in fault["updates"] if u.get("kind") == "noted"),
                                       key=lambda u: u["at"])]
    assert [_bare(n) for n in notes] == [_bare(x) for x in tg], (notes, tg)
    # every line kept by its id: the same lines again change nothing on the fault
    again = noted(v.notices.story(1))(fault)
    assert again is None, again


def test_a_line_is_drawn_from_its_moment_never_read_back_from_its_text():
    from datetime import date, datetime, timezone
    x = status_story.Line("reminder@x", datetime(2026, 11, 8, 9, 20, tzinfo=timezone.utc), f"Reminder sent {status_story.SLOT} (to: FM)")
    assert status_story.shown(x, date(2026, 11, 7), "UTC") == "Reminder sent 08/11 09:20 (to: FM)"
    assert status_story.shown(x, date(2026, 11, 8), "UTC") == "Reminder sent 09:20 (to: FM)"
    pressed = status_story.Line("p", x.at, f"🆘 Need help on Telegram on {status_story.SLOT} (Luc)")
    assert status_story.shown(pressed, date(2026, 11, 8), "UTC") == "🆘 Need help on Telegram at 09:20 (Luc)"
    assert status_story.bare(pressed.words) == "🆘 Need help on Telegram (Luc)"
    assert status_story.bare(f"Back at {status_story.SLOT}, 2nd time in 7 days (to: FM)") == "Back, 2nd time in 7 days (to: FM)"


def test_a_fault_kept_by_moment_is_taken_over_by_its_lines_ids():
    # a fault written before 0.12.481: one line per moment, the visit's first line a microsecond after "Alert sent"
    t = {"status": "open", "updates": [
        {"at": "2026-11-07T22:48:03+00:00", "kind": "noted", "note": "Alert sent (to: Owner & FM)", "status": "open"},
        {"at": "2026-11-07T22:48:03.000001+00:00", "kind": "noted", "note": "Seen at Parking", "status": "open"},
        {"at": "2026-11-07T22:50:00+00:00", "kind": "noted", "note": "Reminder sent (to: FM)", "status": "open"},
        {"at": "2026-11-07T22:55:00+00:00", "kind": "noted", "note": "Reminder sent (to: FM)", "status": "open"}]}
    story = [{"id": "new@a", "at": "2026-11-07T22:48:03+00:00", "note": "Alert sent (to: Owner & FM)"},
             {"id": "seen:motion", "at": "2026-11-07T22:48:03+00:00", "note": "Seen at Parking, 22:48"},
             {"id": "reminder@b", "at": "2026-11-07T22:55:00+00:00", "note": "Reminder sent, 2 times (to: FM)",
              "ats": ["2026-11-07T22:50:00+00:00", "2026-11-07T22:55:00+00:00"]}]
    got = noted(story)(t)
    ups = [u for u in got["updates"] if u.get("kind") == "noted"]
    assert [(u["line"], u["note"]) for u in ups] == [("new@a", "Alert sent (to: Owner & FM)"),
                                                    ("seen:motion", "Seen at Parking, 22:48"),
                                                    ("reminder@b", "Reminder sent, 2 times (to: FM)")], ups
    assert noted(story)(got) is None, "taken over once"
