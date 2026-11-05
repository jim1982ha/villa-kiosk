"""A person's close of a night-check fault is kept as they made it (architecture review 23, cards 6 and 7): who, when the
Kiosk recorded it and where. "Fault still there after the close" said the time of the read that found it still bad and
no one ("Done in the Cockpit on <now>, but still there: Pump weak."), its wait counted from when the agent read the
close; and the night's message never said the close at all, then "Still-there alert sent …". Synthetic villa; names
invented."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from helpers import STARTER_SKILLS, make_agent
from kiosk_fake import FakeKiosk
from vesta_agent.roster import Roster
from vesta_shared import skill_settings
from vesta_shared.problems import Problems
from vesta_shared.store import Store
from vesta_shared.timeutil import moment_label

PM = os.path.join(STARTER_SKILLS, "preventive-maintenance")
sys.path.insert(0, os.path.join(PM, "scripts"))
import nightly  # noqa: E402
import recheck  # noqa: E402

FM = 222


def _a_fault_closed_in_the_cockpit(tmp_path, severity, close_at):
    from test_fault_steps import run
    k = FakeKiosk()
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]), kiosk=k)
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    now = datetime.now(timezone.utc)
    fid, _ = st.raise_finding("PM-X", "sensor.example_pump", "power", now.date().isoformat(), severity, "Pump weak", {})
    tid, _ = pb.open_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak")
    st.set_task_uid(tid, "t-pump")
    k.held("t-pump", title="Pump weak")
    told = None
    if severity == "P2":
        (told,) = nightly.told_now({"villa": "Example", "as_of": now.date().isoformat(), "again": [],
                                    "new_findings": [{"id": fid, "severity": "P2", "summary": "Pump weak"}]},
                                   store=st, at=close_at - timedelta(hours=1))
    k.person_closes("t-pump", by="JM", at=close_at.strftime("%Y-%m-%dT%H:%M:00.000Z"), cockpit=True)
    run(v.tickets.repair())
    return st, pb, fid, tid, told


def test_still_there_after_a_cockpit_close_names_the_person_and_their_time(tmp_path):
    now = datetime.now(timezone.utc)
    close_at = (now - timedelta(hours=3)).replace(second=0, microsecond=0)
    st, pb, fid, tid, _ = _a_fault_closed_in_the_cockpit(tmp_path, "P3", close_at)
    words = skill_settings.load(PM, "settings.yaml")
    # read still bad one minute after the agent read the close: the wait counts from the close, 3 hours ago
    pb.seen(fid, (now + timedelta(minutes=1)).isoformat(), nightly.still_there_minutes(words))
    assert st.task(tid)["status"] == "open"
    (sent,) = recheck.still_there_untold(st, "UTC", words, [])
    assert sent["text"] == (f"Done in the Cockpit on {moment_label(close_at, 'UTC')} (JM), but still there: Pump weak. "
                            "Please look again."), sent


def test_the_nights_message_says_a_persons_close_once(tmp_path):
    now = datetime.now(timezone.utc)
    close_at = (now - timedelta(minutes=10)).replace(second=0, microsecond=0)
    st, pb, fid, tid, told = _a_fault_closed_in_the_cockpit(tmp_path, "P2", close_at)
    words = skill_settings.load(PM, "settings.yaml")
    (edit,) = nightly.told_closes(st, "UTC", words)
    assert edit["key"] == told["key"]
    assert edit["text"].endswith(f"Status:\nDone in the Cockpit on {moment_label(close_at, 'UTC')} (JM)."), edit["text"]
    assert edit["text_in"]["fr"].endswith(f"Terminé dans le Cockpit le {moment_label(close_at, 'UTC')} (JM)."), edit
    assert nightly.told_closes(st, "UTC", words) == []                              # told once
    # then read still bad: its still-there follows the close it told
    pb.seen(fid, (now + timedelta(minutes=30)).isoformat(), nightly.still_there_minutes(words))
    edits = []
    recheck.still_there_untold(st, "UTC", words, edits)
    status = edits[-1]["text"].split("Status:\n")[1].split("\n")
    assert status[0].startswith("Done in the Cockpit on ") and "Still-there alert sent" in status[1], status


def test_the_five_minute_recheck_says_it(tmp_path):
    # the caller: recheck.py as the engine runs it every 5 minutes rewrites the message
    from test_back_online import _run
    from vesta_shared import kiosk_words
    now = datetime.now(timezone.utc)
    close_at = (now - timedelta(minutes=10)).replace(second=0, microsecond=0)
    st = Store(str(tmp_path / "s.sqlite"))
    fid, _ = st.raise_finding("PM-X", "sensor.example_pump", "power", now.date().isoformat(), "P2", "Pump weak", {})
    tid, _ = Problems(st).open_task("finding", fid, "PM-X", "sensor.example_pump", "Pump weak")
    nightly.told_now({"villa": "Example", "as_of": now.date().isoformat(), "again": [],
                      "new_findings": [{"id": fid, "severity": "P2", "summary": "Pump weak"}]},
                     store=st, at=close_at - timedelta(hours=1))
    at = close_at.isoformat()
    Problems(st).closed_in_kiosk(tid, kiosk_words.closed("JM", at, "UTC"), at=at, who="JM")
    (edit,) = _run(tmp_path, {}, now)["edits"]
    assert edit["text"].endswith(f"Done in the Cockpit on {moment_label(close_at, 'UTC')} (JM)."), edit["text"]
