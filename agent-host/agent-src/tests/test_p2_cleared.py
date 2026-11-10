"""A P2 of the night check that clears is said on ITS message, rewritten — never a new message (owner, 2026-10-20).

The skill keeps each P2 message it sends (nightly.told_now with its store) and, when one of its findings clears, asks
the engine to rewrite it (told_cleared → result.edit); the engine keeps where each keyed message went and rewrites it in
the same layout (Outcome.rewrite → Poster.rewrite → Delivery.edit), or says nothing at all when it no longer can."""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from helpers import settings
from vesta_agent.outcome import Outcome
from vesta_agent.state import State
from vesta_shared.message_format import telegram_entities, titled

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "starter", "skills", "preventive-maintenance", "scripts"))
import nightly  # noqa: E402
from vesta_agent.roster import Roster
from vesta_agent.policy import Policy

PM = os.path.join(HERE, "..", "starter", "skills", "preventive-maintenance")


WORDS = {"told_cleared": {"tell": True, "all_title": "{title} All back to normal."}}
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
    assert e["text"] == ("New:\n- Pool relay offline for 1 h\nWhat to do: Power it again.\n- Gate lock battery at 10 %\n"
                         "Status:\nPool relay offline for 1 h · Cleared on 20/10/2026 12:30: watched until 02:00.")
    (e2,) = nightly.told_cleared(store, [42], AT, "Asia/Makassar", WORDS)
    assert e2["title"] == "Example, night check on 19/10/2026. All back to normal." and e2["text"].count("Cleared on") == 2
    assert nightly.told_cleared(store, [43, 99], AT, "Asia/Makassar", WORDS) == []          # never told, never kept


def test_the_switch_and_the_words_are_the_skills():
    store = Cache()
    nightly.told_now(NIGHT, store=store, at=AT)
    assert nightly.told_cleared(store, [41], AT, "Asia/Makassar", {"told_cleared": {**WORDS["told_cleared"], "tell": False}}) == []
    # the words are the alert card's (status_words), never the skill's own: in every language the chat may read
    (e,) = nightly.told_cleared(store, [41], AT, "Asia/Makassar", {"told_cleared": {"tell": True}})
    assert e["text"].endswith("Cleared on 20/10/2026 12:30: watched until 02:00.")
    assert e["text_in"]["fr"].endswith("Statut:\nPool relay offline for 1 h · Résolu le 20/10/2026 12:30: surveillé jusqu’à 02:00.")
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
    pol = Policy({}, Roster.of(fm=[(-2, "Managers")]))
    return Outcome(policy=lambda: pol, state=State(s.state_path), send=tele.send, edit=tele.edit, actions=None,
                   tickets=None, buttons=None, thread=None)


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
    assert text.splitlines()[:2] == sent.splitlines()[:2] and "Pool relay offline for 1 h · Cleared on 20/10/2026 12:30" in text


def test_a_message_telegram_no_longer_takes_is_left_and_nothing_is_sent(tmp_path):
    tele, store = Tele(edits_ok=False), Cache()
    out = _outcome(tmp_path, tele)
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    done = asyncio.run(out.carry_out({"edits": nightly.told_cleared(store, [41, 42], AT, "Asia/Makassar", WORDS)},
                                     "preventive-maintenance"))
    assert done["edited"] == 0 and len(tele.sent) == 1 and len(tele.edited) == 1
    assert any(c["kind"] == "rewrite_skipped" for c in out.state.calls())


def test_a_message_longer_than_one_page_or_no_way_to_edit_is_never_rewritten():
    from vesta_agent.posting import Poster
    tele = Tele()
    long = "\n".join(f"- item {i} " + "x" * 80 for i in range(80))                 # several Telegram pages
    p = Poster(send=tele.send, edit=tele.edit)
    assert asyncio.run(p.rewrite(-2, 101, "Title.", "Facility manager", long)) is False and tele.edited == []
    assert asyncio.run(Poster(send=tele.send).rewrite(-2, 101, "Title.", "Facility manager", "short")) is False
    assert asyncio.run(p.rewrite(-2, 101, "Title.", "Facility manager", "short")) is True


# ── the backup (owner, 2026-10-20: "isn't it a risk of never receiving the information?") ────────────────────────
BACKUP = {"told_cleared": {**WORDS["told_cleared"], "fallback": "✅ Back to normal at {time}: {what}"}}


class ReplyTele(Tele):
    """Telegram refusing every edit; refusing a reply too when `reply_ok` is False."""
    def __init__(self, reply_ok=True, edits_ok=False):
        super().__init__(edits_ok=edits_ok)
        self.reply_ok, self.replies = reply_ok, []

    async def send(self, chat, text, reply_to=None, **k):
        if reply_to is not None:
            self.replies.append(reply_to)
            if not self.reply_ok:
                return None
        return await super().send(chat, text, **k)


def _told_then_cleared(tmp_path, tele, ids=(41,)):
    store, out = Cache(), _outcome(tmp_path, tele)
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    edits = nightly.told_cleared(store, list(ids), AT, "Asia/Makassar", BACKUP)
    done = asyncio.run(out.carry_out({"edits": edits}, "preventive-maintenance"))
    return out, edits, done


def test_an_edit_refused_sends_one_reply_naming_what_cleared(tmp_path):
    tele = ReplyTele()
    out, _, done = _told_then_cleared(tmp_path, tele)
    assert tele.replies == [101] and len(tele.sent) == 2 and done["edited"] == 1          # one reply, to the P2 message
    backup = tele.sent[-1][1]
    assert "✅ Back to normal at 20/10/2026 12:30: Pool relay offline for 1 h" in backup and "Gate lock" not in backup
    assert any(c["kind"] == "rewrite_fallback" for c in out.state.calls())


def test_a_reply_refused_is_sent_once_without_the_reply(tmp_path):
    tele = ReplyTele(reply_ok=False)
    _told_then_cleared(tmp_path, tele)
    assert tele.replies == [101] and len(tele.sent) == 2                                    # the plain one arrived


def test_an_edit_that_lands_or_says_it_already_shows_sends_nothing(tmp_path):
    tele = ReplyTele(edits_ok=True)                    # Telegram's "message is not modified" is answered as a success
    _, _, done = _told_then_cleared(tmp_path, tele)
    assert tele.replies == [] and len(tele.sent) == 1 and done["edited"] == 1


def test_not_modified_is_a_success_for_telegram_itself():
    from vesta_agent.telegram import Telegram, TelegramError

    class T(Telegram):
        async def api(self, method, **data):
            raise TelegramError(f"{method}: 400 Bad Request: message is not modified")
    assert asyncio.run(T("t0k3n").edit(-2, 101, "same")) is True


def test_the_backup_is_never_sent_twice(tmp_path):
    tele = ReplyTele()
    out, edits, _ = _told_then_cleared(tmp_path, tele)
    asyncio.run(out.carry_out({"edits": edits}, "preventive-maintenance"))                  # the same result again
    assert len(tele.sent) == 2 and tele.replies == [101]


def test_a_message_of_two_pages_gets_the_reply(tmp_path):
    from vesta_agent import posting
    tele = ReplyTele(edits_ok=True)
    out = _outcome(tmp_path, tele)
    store = Cache()
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    edits = nightly.told_cleared(store, [41], AT, "Asia/Makassar", BACKUP)
    real = posting.pages
    # the rewrite is two pages (it carries "What to do"); the backup stays one
    posting.pages = lambda title, to, text, limit: ["page 1", "page 2"] if "What to do" in text else real(title, to, text, limit)
    try:
        asyncio.run(out.carry_out({"edits": edits}, "preventive-maintenance"))
    finally:
        posting.pages = real
    assert tele.edited == [] and tele.replies == [101] and len(tele.sent) == 2


def test_no_copy_kept_anywhere_the_backup_goes_to_its_role(tmp_path):
    tele = ReplyTele()
    store, out = Cache(), _outcome(tmp_path, tele)
    nightly.told_now(NIGHT, store=store, at=AT)                                               # never arrived: nothing kept
    edits = nightly.told_cleared(store, [41], AT, "Asia/Makassar", BACKUP)
    asyncio.run(out.carry_out({"edits": edits}, "preventive-maintenance"))
    (chat, text), = tele.sent
    assert chat == -2 and "Pool relay offline for 1 h" in text and tele.replies == []


def test_the_reply_reaches_telegram_as_a_reply(tmp_path):
    from vesta_agent.delivery import Delivery

    class Tg:
        def __init__(self):
            self.calls = []

        async def send(self, chat, text, **k):
            self.calls.append(k)
            return [7]
    tg = Tg()
    d = Delivery(tg, State(settings(str(tmp_path)).state_path), policy=lambda: Policy({}, Roster()))
    assert asyncio.run(d.send(-2, "backup", reply_to=101)) == 7 and tg.calls[-1].get("reply_to") == 101
    asyncio.run(d.send(-2, "plain"))
    assert "reply_to" not in tg.calls[-1]


# ── one story per item, as an alert's card tells it (architecture review N, 2026-10-27) ─────────────────────────────

def _real(tmp_path):
    """A real store with the night's P2s told, and the skill's own words (settings.yaml)."""
    from vesta_shared import skill_settings
    from vesta_shared.store import Store
    store = Store(str(tmp_path / "s.sqlite"))
    ids = [store.raise_finding("PM-UNAVAILABLE", f"switch.example_{k}", "power", "2026-10-19", "P2", f"Relay {k} offline",
                               {})[0] for k in ("a", "b")]
    night = {"villa": "Example", "as_of": "2026-10-19", "again": [],
             "new_findings": [{"id": i, "severity": "P2", "summary": f"Relay {k} offline"} for i, k in zip(ids, "ab")]}
    (m,) = nightly.told_now(night, store=store, at=AT)
    return store, ids, m, skill_settings.load(os.path.join(HERE, "..", "starter", "skills", "preventive-maintenance"),
                                              "settings.yaml")


def test_the_night_ends_each_watch_closed_or_back_on_the_same_message(tmp_path):
    store, (a, b), m, words = _real(tmp_path)
    for fid in (a, b):
        store.close_finding("PM-UNAVAILABLE", store.finding(fid)["entity_id"], "2026-10-20")
    nightly.told_cleared(store, [a, b], AT, "Asia/Makassar", words)
    store.reopen_finding(b, "P2", "Relay b offline", {}, "2026-10-21", ["2026-10-19", "2026-10-21"])   # the night found it again
    night = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)                       # 02:00 in the villa
    (e,) = nightly.told_watch_over(store, night, "Asia/Makassar", words)
    assert e["text"] == ("New:\n- Relay a offline\n- Relay b offline\nStatus:\n"
                         "Relay a offline · Cleared on 20/10/2026 12:30: watched until 02:00.\n"
                         "Relay b offline · Cleared on 20/10/2026 12:30: watched until 02:00.\n"
                         "Relay a offline · Closed on 21/10/2026 02:00: it did not come back.\n"
                         "Relay b offline · Back at 21/10/2026 02:00 (to: FM)") and e["title"] == m["title"]
    # the story: each item's earlier line struck, where it stands now plain (message_format.status_superseded)
    assert _struck(titled(m["title"], "FM", e["text"])) == ["Relay a offline · Cleared on 20/10/2026 12:30: watched until 02:00.",
                                                            "Relay b offline · Cleared on 20/10/2026 12:30: watched until 02:00."]
    assert "fallback" not in e                                   # nothing new to act on: no reply
    assert nightly.told_watch_over(store, night, "Asia/Makassar", words) == []         # each watch ends once


def test_a_problem_told_again_ends_its_watch_on_the_first_message_and_each_message_says_each_thing_once(tmp_path):
    # architecture review, 2026-11-10: a problem back again is told in a second message. The first one stayed on
    # "Cleared …: watched until 02:00." with "All back to normal." for ever; the second one gained a line every night:
    # "Back at …" while the problem was simply still there, then "Closed on …: it did not come back." again and again
    from vesta_shared import skill_settings
    from vesta_shared.store import Store
    store, words = Store(str(tmp_path / "s.sqlite")), skill_settings.load(PM, "settings.yaml")
    zone, night = "Asia/Makassar", lambda day: datetime(2026, 10, day, 18, 0, tzinfo=timezone.utc)   # 02:00 the day after
    (a,) = [store.raise_finding("PM-UNAVAILABLE", "switch.example_pool", "power", "2026-10-19", "P2", "Pool relay offline", {})[0]]
    told = lambda label, at: nightly.told_now({"villa": "Example", "as_of": "2026-10-19", "new_findings": [], "again": [],
                                               label: [{"id": a, "severity": "P2", "summary": "Pool relay offline"}]},
                                              store=store, at=at)[0]
    first = told("new_findings", AT)
    store.close_finding("PM-UNAVAILABLE", "switch.example_pool", "2026-10-20")
    nightly.told_cleared(store, [a], AT, zone, words)                                      # cleared at 12:30, watched
    # the night finds it again and tells it in a new message, then ends the watches (nightly.run's order)
    store.reopen_finding(a, "P2", "Pool relay offline", {}, "2026-10-21", ["2026-10-19", "2026-10-21"])
    second = told("again", night(20))
    (e,) = nightly.told_watch_over(store, night(20), zone, words)
    assert e["key"] == first["key"] and e["title"] == first["title"]                       # no longer all back to normal
    assert e["text"] == ("New:\n- Pool relay offline\nStatus:\nCleared on 20/10/2026 12:30: watched until 02:00.\n"
                         "Back at 21/10/2026 02:00 (to: FM)")
    assert _struck(titled(first["title"], "FM", e["text"])) == ["Cleared on 20/10/2026 12:30: watched until 02:00."]
    # still there the two nights after: nothing more to say, on either message
    assert nightly.told_watch_over(store, night(21), zone, words) == []
    assert nightly.told_watch_over(store, night(22), zone, words) == []
    # it clears on the 23rd: said on the second message, closed there the night after, once
    store.close_finding("PM-UNAVAILABLE", "switch.example_pool", "2026-10-23")
    (c,) = nightly.told_cleared(store, [a], datetime(2026, 10, 23, 4, 30, tzinfo=timezone.utc), zone, words)
    assert c["key"] == second["key"] and c["text"].endswith("Status:\nCleared on 23/10/2026 12:30: watched until 02:00.")
    (e,) = nightly.told_watch_over(store, night(23), zone, words)
    assert e["key"] == second["key"] and e["text"].endswith(
        "Status:\nCleared on 23/10/2026 12:30: watched until 02:00.\nClosed on 24/10/2026 02:00: it did not come back.")
    assert nightly.told_watch_over(store, night(24), zone, words) == []
    assert nightly.told_watch_over(store, night(25), zone, words) == []


def test_a_first_message_left_watching_by_an_earlier_version_says_back_at_the_second_ones_moment(tmp_path):
    # format changes need migrations: before 0.12.497 the first message of a problem told again stayed listed as
    # watching. Any later run (the 5-minute check: told_back_again) ends that watch at the moment the problem was told again
    store, (a, b), m, words = _real(tmp_path)
    store.close_finding("PM-UNAVAILABLE", store.finding(a)["entity_id"], "2026-10-20")
    nightly.told_cleared(store, [a], AT, "Asia/Makassar", words)
    store.reopen_finding(a, "P2", "Relay a offline", {}, "2026-10-21", ["2026-10-19", "2026-10-21"])
    nightly.told_now({"villa": "Example", "as_of": "2026-10-21", "new_findings": [],
                      "again": [{"id": a, "severity": "P2", "summary": "Relay a offline"}]},
                     store=store, at=datetime(2026, 10, 21, 7, 12, tzinfo=timezone.utc))
    (e,) = nightly.told_back_again(store, "Asia/Makassar", words)
    assert e["key"] == m["key"] and e["text"].endswith("Relay a offline · Back at 21/10/2026 15:12 (to: FM)")
    assert nightly.told_back_again(store, "Asia/Makassar", words) == []                 # said once
    assert nightly.told_watch_over(store, datetime(2026, 10, 21, 18, 0, tzinfo=timezone.utc), "Asia/Makassar", words) == []


def test_a_message_kept_before_the_watch_is_read_as_watched_and_closed_at_night(tmp_path):
    # format changes need migrations: a message kept by 0.12.361 holds only {cleared: {id: time}}
    store, (a, b), m, words = _real(tmp_path)
    rec = store.cache_get(m["key"])
    store.cache_put(m["key"], {k: v for k, v in rec.items() if k != "story"} | {"cleared": {str(a): "12:30", str(b): "12:31"}})
    for fid in (a, b):
        store.close_finding("PM-UNAVAILABLE", store.finding(fid)["entity_id"], "2026-10-20")
    nightly._told_rec(store, m["key"])                            # read once (any rewrite reads it)
    (e,) = nightly.told_watch_over(store, datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc), "Asia/Makassar", words)
    assert e["text"].count("Closed on 21/10/2026 02:00") == 2 and e["title"] == f"{m['title']} All back to normal."


def _struck(text: str) -> list[str]:
    """The lines Telegram draws struck (its offsets count UTF-16 units)."""
    u = text.encode("utf-16-le")
    return [u[2 * x["offset"]:2 * (x["offset"] + x["length"])].decode("utf-16-le")
            for x in telegram_entities(text) if x["type"] == "strikethrough"]


def test_a_message_kept_by_0_12_362_is_read_as_a_story_of_one_step_each(tmp_path):
    # format changes need migrations: 0.12.362 kept {state: {id: its last step}}
    store, (a, b), m, words = _real(tmp_path)
    rec = store.cache_get(m["key"])
    store.cache_put(m["key"], {k: v for k, v in rec.items() if k != "story"}
                    | {"state": {str(a): {"kind": "watch", "time": "12:30", "until": "02:00"}}})
    store.close_finding("PM-UNAVAILABLE", store.finding(a)["entity_id"], "2026-10-20")
    nightly._told_rec(store, m["key"])                            # read once (any rewrite reads it)
    (e,) = nightly.told_watch_over(store, datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc), "Asia/Makassar", words)
    assert e["text"].endswith("Status:\nRelay a offline · Cleared on 12:30: watched until 02:00.\n"
                              "Relay a offline · Closed on 21/10/2026 02:00: it did not come back.")


def test_a_message_of_one_item_says_its_story_bare_each_line_but_the_last_struck(tmp_path):
    store = Cache()
    night = {**NIGHT, "new_findings": NIGHT["new_findings"][1:2]}
    (m,) = nightly.told_now(night, store=store, at=AT)
    words = {"told_cleared": {"tell": True}}
    nightly.told_cleared(store, [42], AT, "Asia/Makassar", words)
    (e,), _ = nightly.told_again(store, [{"id": 7, "source": "finding:42", "done_at": "2026-10-20T05:00:00+00:00"}], "still",
                                 "Asia/Makassar", words)
    assert e["text"] == "New:\n- Gate lock battery at 10 %\nStatus:\nCleared on 20/10/2026 12:30: watched until 02:00.\nStill-there alert sent 20/10/2026 13:00 (to: FM)"
    assert _struck(titled(m["title"], "FM", e["text"])) == ["Cleared on 20/10/2026 12:30: watched until 02:00."]


def test_still_there_and_reopened_are_marked_on_the_message_that_told_them(tmp_path):
    store, (a, b), m, words = _real(tmp_path)
    nightly.told_cleared(store, [a], AT, "Asia/Makassar", words)
    tasks = [{"source": f"finding:{a}", "reopened_at": "2026-10-20T05:00:00+00:00"},
             {"source": f"finding:{b}", "reopened_at": "2026-10-20T05:10:00+00:00", "reopened_by": "Owner"}]
    tasks = [{**t, "id": 100 + k} for k, t in enumerate(tasks)]
    (s,), said = nightly.told_again(store, tasks[:1], "still", "Asia/Makassar", words)
    assert said == {100} and s["text"] == ("New:\n- Relay a offline\n- Relay b offline\nStatus:\n"
                                          "Relay a offline · Cleared on 20/10/2026 12:30: watched until 02:00.\n"
                                          "Relay a offline · Still-there alert sent 20/10/2026 13:00 (to: FM)")
    (r,), said = nightly.told_again(store, tasks[1:], "reopened", "Asia/Makassar", words)
    assert said == {101} and r["text"].endswith("Relay b offline · Reopened in the Cockpit on 20/10/2026 13:10 (Owner)")
    assert nightly.told_again(store, [{"source": "incident:7", "id": 9}], "still", "Asia/Makassar", words) == ([], set())   # an alert's: the desk's
    assert nightly.told_again(store, tasks, "unknown", "Asia/Makassar", {}) == ([], set())                   # no such step


def test_an_item_an_alert_took_over_says_so_and_two_rewrites_of_one_run_are_one(tmp_path):
    store, (a, b), m, words = _real(tmp_path)
    e1 = nightly.told_cleared(store, [a], AT, "Asia/Makassar", words)
    e2 = nightly.told_cleared(store, [], AT, "Asia/Makassar", words, handed={b: "Followed by alert #9, which says when it is back."})
    (e,) = nightly.one_edit_per_message(e1 + e2)
    assert e["text"].endswith("Relay b offline · Followed by alert #9, which says when it is back.")
    assert "Cleared on 20/10/2026 12:30: watched until 02:00." in e["text"] and e["title"].endswith("All back to normal.")
    assert e["fallback"].count("\n") == 1                        # both replies kept, for a message it cannot rewrite


def test_each_chat_reads_the_night_checks_story_in_its_own_language_as_the_alert_card_says_it(tmp_path):
    # architecture review round 11, card 1: "⚠️ Reopened in the Cockpit at 07:05 by Owner" stayed English in a French
    # chat, beside the alert card's translated "Reopened in the Cockpit on 11/10/2026 07:05 (Owner)". Through the real
    # rewrite path: the skill's every language (result.edit text_in), each chat's own (Notices.lang from the People list)
    from vesta_agent.notice import Notices
    tele, store = Tele(), Cache()
    s = settings(str(tmp_path))
    pol = Policy({}, Roster.of(fm=[(-2, "Managers"), (-3, "Desk")], languages={-2: "fr"}))
    state = State(s.state_path)
    from vesta_agent.posting import Poster
    notices, tablet = Notices(state, lambda: pol, "Asia/Makassar"), []
    out = Outcome(policy=lambda: pol, state=state, send=tele.send, edit=tele.edit, actions=None,
                  tickets=None, buttons=None, thread=None, notices=notices,
                  poster=Poster(send=tele.send, notices=notices, timezone_name="Asia/Makassar", edit=tele.edit,
                                mirror=tablet.append))
    (m,) = nightly.told_now(NIGHT, store=store, at=AT)
    asyncio.run(out.carry_out({"send": [m]}, "preventive-maintenance"))
    edits, _ = nightly.told_again(store, [{"id": 7, "source": "finding:41", "reopened_at": "2026-10-20T05:00:00+00:00",
                                           "reopened_by": "Owner"}], "reopened", "Asia/Makassar", WORDS)
    asyncio.run(out.carry_out({"edits": edits}, "preventive-maintenance"))
    by_chat = {c: text for c, _mid, text in tele.edited}
    assert "Reopened in the Cockpit on 20/10/2026 13:00 (Owner)" in by_chat[-3]
    assert "Statut:" in by_chat[-2] and "Rouvert dans le Cockpit le 20/10/2026 13:00 (Owner)" in by_chat[-2]
    # the tablet's copy as written, whichever chat was rewritten last
    assert "Reopened in the Cockpit on 20/10/2026 13:00 (Owner)" in str(tablet[-1])
    assert not any("Rouvert" in str(r) for r in tablet), tablet


def test_the_night_check_is_handed_its_time_by_the_engine_never_reads_it_again(tmp_path, monkeypatch):
    # architecture review round 14, card 4: the time Telegram's "watched until" says is the one the Cockpit's "VESTA
    # confirms by" counts from — the engine's reading of the skill's job (skills.kiosk_jobs), handed to the script
    from vesta_agent import skills
    sk = skills.parse_skill("preventive-maintenance", PM)
    env = skills.script_env(settings(tmp_path), sk)
    assert json.loads(env[skills.KIOSK_JOBS_ENV]) == {"nightly_check": "02:00"}
    monkeypatch.setenv(skills.KIOSK_JOBS_ENV, json.dumps({"nightly_check": "03:15"}))
    assert nightly.night_clock() == "03:15"                      # what it was handed, never the file read again
    monkeypatch.delenv(skills.KIOSK_JOBS_ENV)
    assert nightly.night_clock() is None                         # not handed: said as "the night check", never guessed
    # the caller: a script the engine runs gets it (run_script)
    seen = {}

    def fake_run(cmd, **k):
        seen.update(k["env"])

        class P:
            returncode, stdout, stderr = 0, "", ""
        return P()
    monkeypatch.setattr(skills.subprocess, "run", fake_run)
    skills.run_script(settings(tmp_path), sk, "nightly.py", [])
    assert json.loads(seen[skills.KIOSK_JOBS_ENV]) == {"nightly_check": "02:00"}
