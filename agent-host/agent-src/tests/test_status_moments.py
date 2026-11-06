"""Every alert's Status as the owner drew it on 2026-11-07 (drill #135), Telegram and the tablet alike:

- each moment its time alone on the alert's own day (the day its card's strip shows), "08/11 09:20" on another — the
  step lines, "Alert sent", "Cleared at …", a person's act: one formatter (timeutil.status_moment), at read;
- a visit's card sent again is said on the line of the step that made it ring, "…: alert sent again (to: …)", never a
  "Stronger signal sent" line of its own;
- the motion line's span ends at the detection that opened the visit (the villa keeps one step per device in a row).
Synthetic villa: every id invented."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from test_visit_story import (GARDEN_DOOR, LOCK, OWNER, PARKING, ROOM_PERSON, Visit, at, copy, lines, play, send, villa)
from test_visit_story import kiosk, media  # noqa: F401 — its fixtures
from vesta_agent import layout
from vesta_agent.notice import Notices


def _drill(vi: Visit, phase="step", opened_at=None):
    e = vi.event(phase)
    e["visit"]["drill"] = True                     # the villa's Drill input: the siren never asked, as on 07/11
    if opened_at:
        e["visit"]["opened_at"] = opened_at
    return e


def test_drill_135_reads_one_line_per_step_each_at_its_time(tmp_path, kiosk, media):
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    opened = at("05:14:01")                        # the second detection opened it: the villa kept the first as its step
    vi.add("motion", PARKING, "05:13:26", photo=True)
    play(v, send(_drill(vi, "opened", opened)))
    for kind, eid, hms, how in (("door", GARDEN_DOOR, "05:14:40", None), ("lock", LOCK, "05:15:37", "app:"),
                                ("relock", LOCK, "05:16:24", None), ("person", ROOM_PERSON, "05:17:08", None)):
        vi.add(kind, eid, hms, how=how, photo=kind != "relock")
        play(v, send(_drill(vi, opened_at=opened)))
    wanted = ["- Seen at Parking, 05:13–05:14",
              "- Alert sent 05:14 (to: Owner & FM)",
              "- Garden Door opened, 05:14: alert sent again (to: Owner & FM)",
              "- Outdoor entrance Lock opened from the app, 05:15, locked again 05:16: alert sent again (to: Owner & FM)",
              "- Person seen in the Server Room Person at 05:17"]
    st = lines(copy(v, OWNER)["text"])
    assert st[:-1] == wanted and re.fullmatch(r"⚠️ New alert, monitoring until \d\d:\d\d", st[-1]), st
    tablet = kiosk.messages["incident:1"]["status"]
    assert tablet == st, (tablet, st)               # the tablet's card: the same lines


class _Kept:
    def __init__(self):
        self.h = {}

    def incident_history(self, i):
        return list(self.h.get(i, []))

    def set_incident_history(self, i, h):
        self.h[i] = h

    def incident_chats(self, _i):
        return []


def test_every_alerts_status_says_its_moments_by_the_alerts_day():
    # an alert of 07/11 reminded the next morning and closed then: its own day's moments are times, the next day's
    # "08/11 09:20"; a close's note, written whole, reads "at" a time — every language alike
    kept = _Kept()
    n = Notices(kept, lambda: None, "UTC", began=lambda _i: "2026-11-07T05:14:00+00:00")
    n.record(7, "new", [(1, "fm")], datetime(2026, 11, 7, 5, 14, tzinfo=timezone.utc))
    n.record(7, "reminder", [(1, "fm")], datetime(2026, 11, 8, 9, 20, tzinfo=timezone.utc))
    p = layout.parts("x", "✅ Cleared on 07/11/2026 23:10: back to normal.", n.heading(1, 7, to="fm"))
    shown = layout.render(p).split("Status:\n", 1)[1].split("\n")
    assert shown[:2] == ["- Alert sent 05:14 (to: FM)", "- Reminder sent 08/11 09:20 (to: FM)"], shown
    assert shown[-1].endswith("Cleared at 23:10: back to normal."), shown
    fr = layout.status_shown({**n.heading(1, 7, to="fm"), "lang": "fr"}, ["Résolu le 07/11/2026 23:10.", "Rappel envoyé le 08/11/2026 09:20"])
    assert fr == ["Résolu à 23:10.", "Rappel envoyé le 08/11 09:20"], fr


def test_the_tablets_card_names_the_strongest_step_when_its_words_say_it(tmp_path, kiosk, media):
    # drill #135, 05:15: the card's words said "Test lock opened…" while its name stayed "Test door" — the fault followed
    # the strongest step only after every Telegram copy was sent; it is placed before the tablet is told the new words
    v = villa(tmp_path, kiosk)
    vi = Visit(media=media)
    seen: list = []
    req = kiosk._req

    async def spy(method, path, body=None, content=None, **kw):
        if path == "/agent/v1/vesta-message" and "Lock opened" in str((body or {}).get("body") or ""):
            seen.append([t.get("entityId") for t in kiosk._all() if t.get("alertNumber") == 1])
        return await req(method, path, body, content, **kw)
    kiosk._req = spy
    vi.add("motion", PARKING, "05:13:26", photo=True)
    play(v, send(_drill(vi, "opened")))
    vi.add("door", GARDEN_DOOR, "05:14:40", photo=True)
    play(v, send(_drill(vi)))
    vi.add("lock", LOCK, "05:15:37", how="app:", photo=True)
    play(v, send(_drill(vi)))
    assert seen and seen[0] == [LOCK], seen
