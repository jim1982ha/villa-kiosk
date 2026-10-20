"""A P2 of the night check that clears is said on ITS message, rewritten — never a new message (owner, 2026-10-20).

The skill keeps each P2 message it sends (nightly.told_now with its store) and, when one of its findings clears, asks
the engine to rewrite it (told_cleared → result.edit); the engine keeps where each keyed message went and rewrites it in
the same layout (Outcome.rewrite → Poster.rewrite → Delivery.edit), or says nothing at all when it no longer can."""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

from helpers import settings
from vesta_agent.outcome import Outcome
from vesta_agent.policy import Policy
from vesta_agent.state import State

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "starter", "skills", "preventive-maintenance", "scripts"))
import nightly  # noqa: E402

WORDS = {"told_cleared": {"tell": True, "line": "✅ Back to normal at {time}", "all_title": "{title} All back to normal."}}
AT = datetime(2026, 10, 20, 4, 30, tzinfo=timezone.utc)          # 12:30 in the villa (Asia/Makassar, UTC+8)


class Cache:
    """The skill store's cache, as Store has it."""
    def __init__(self):
        self.d = {}

    def cache_get(self, k):
        return self.d.get(k)

    def cache_put(self, k, v):
        import json
        self.d[k] = json.loads(json.dumps(v))


# the villa's shape: two P2s of one night, a critical device offline and a battery at 10 %
NIGHT = {"villa": "Example", "as_of": "2026-10-19",
         "new_findings": [{"id": 41, "severity": "P2", "summary": "Pool relay offline for 1 h", "check": "Power it again."},
                          {"id": 42, "severity": "P2", "summary": "Gate lock battery at 10 %"},
                          {"id": 43, "severity": "P3", "summary": "Pump a little weaker"}],
         "again": []}


def test_a_p2_message_is_kept_and_a_clear_rewrites_it():
    store = Cache()
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    assert m["key"] and m["text"] == "New:\n- Pool relay offline for 1 h\nWhat to do: Power it again.\n- Gate lock battery at 10 %"
    (e,) = nightly.told_cleared(store, [41], AT, "Asia/Makassar", WORDS)
    assert e["key"] == m["key"] and e["title"] == m["title"]
    assert e["text"] == ("New:\n- Pool relay offline for 1 h ✅ Back to normal at 12:30\nWhat to do: Power it again.\n"
                         "- Gate lock battery at 10 %")
    (e2,) = nightly.told_cleared(store, [42], AT, "Asia/Makassar", WORDS)
    assert e2["title"] == "Example, night check on 19/10/2026. All back to normal." and e2["text"].count("✅") == 2
    assert nightly.told_cleared(store, [43, 99], AT, "Asia/Makassar", WORDS) == []          # never told, never kept


def test_the_switch_and_the_words_are_the_skills():
    store = Cache()
    nightly.told_now(NIGHT, store=store, at=AT)
    assert nightly.told_cleared(store, [41], AT, "Asia/Makassar", {"told_cleared": {**WORDS["told_cleared"], "tell": False}}) == []
    assert nightly.told_cleared(store, [41], AT, "Asia/Makassar", {"told_cleared": {"tell": True}}) == []    # no words: named
    assert "key" not in nightly.told_now(NIGHT)[0]                          # no store: nothing kept, as before


class Tele:
    def __init__(self, edits_ok=True):
        self.sent, self.edited, self.ok, self.n = [], [], edits_ok, 100

    async def send(self, chat, text, **k):
        self.n += 1
        self.sent.append((chat, text))
        return self.n

    async def edit(self, chat, mid, text, keyboard=None):
        self.edited.append((chat, mid, text))
        return self.ok


def _outcome(tmp_path, tele):
    s = settings(str(tmp_path))
    pol = Policy({"people": [{"telegram_id": -2, "name": "Managers", "role": "fm"}]})
    return Outcome(policy=lambda: pol, state=State(s.state_path), send=tele.send, edit=tele.edit, actions=None,
                   reader=None, tickets=None, buttons=None, thread=None)


def test_the_engine_rewrites_the_message_where_it_went_never_a_new_one(tmp_path):
    tele, store = Tele(), Cache()
    out = _outcome(tmp_path, tele)
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    (chat, sent), = tele.sent
    done = asyncio.run(out.carry_out({"edits": nightly.told_cleared(store, [41], AT, "Asia/Makassar", WORDS)},
                                     "preventive-maintenance"))
    assert len(tele.sent) == 1 and done["edited"] == 1                                       # no new message
    (c, mid, text), = tele.edited
    assert (c, mid) == (chat, 101)
    # the same layout: its title, its "To:", the item now marked
    assert text.splitlines()[:2] == sent.splitlines()[:2] and "Pool relay offline for 1 h ✅ Back to normal at 12:30" in text


def test_a_message_telegram_no_longer_takes_is_left_and_nothing_is_sent(tmp_path):
    tele, store = Tele(edits_ok=False), Cache()
    out = _outcome(tmp_path, tele)
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    done = asyncio.run(out.carry_out({"edits": nightly.told_cleared(store, [41, 42], AT, "Asia/Makassar", WORDS)},
                                     "preventive-maintenance"))
    assert done["edited"] == 0 and len(tele.sent) == 1 and len(tele.edited) == 1
    assert any(c["kind"] == "rewrite_skipped" for c in out.state.calls())


def test_the_night_and_the_day_rechecks_carry_the_rewrites():
    import inspect
    import recheck
    src = inspect.getsource(nightly.run) + inspect.getsource(nightly.main) + inspect.getsource(recheck.main)
    assert 'told_cleared(store, [o["id"] for o in closed], now_ref, zone, ctx.settings)' in src
    assert 'out["edits"] = res.get("edits") or []' in src
    assert src.count("N.told_cleared(ctx.store,") == 2
    assert "store=store, at=now)" in inspect.getsource(recheck.gone_offline)


def test_a_message_longer_than_one_page_or_no_way_to_edit_is_never_rewritten():
    from vesta_agent.posting import Poster
    tele = Tele()
    long = "\n".join(f"- item {i} " + "x" * 80 for i in range(80))                 # several Telegram pages
    p = Poster(send=tele.send, edit=tele.edit)
    assert asyncio.run(p.rewrite(-2, 101, "Title.", "Facility manager", long)) is False and tele.edited == []
    assert asyncio.run(Poster(send=tele.send).rewrite(-2, 101, "Title.", "Facility manager", "short")) is False
    assert asyncio.run(p.rewrite(-2, 101, "Title.", "Facility manager", "short")) is True
