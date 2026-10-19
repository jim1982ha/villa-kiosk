"""A fault the Kiosk refuses stops no other, and the Kiosk's own reason is kept (architecture review round 2, 2026-10-19).

The villa: one fault the proxy refused ended the repair for every fault after it, every 5 minutes, and all the log
and the chat said was "KioskError". Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio

from helpers import make_agent
from kiosk_fake import FakeKiosk
from vesta_agent.kiosk import KioskError
from vesta_shared.store import Store

FM = 222
SENTENCE = "a fault's entity must be one the villa knows"


def run(c):
    return asyncio.run(c)


def _villa(tmp_path, k):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    st = Store(v.s.store_path)
    st.raise_finding("PM-X", "sensor.example_a", "offline", "2026-10-09", "P3", "A offline", {})
    st.raise_finding("PM-X", "sensor.example_b", "offline", "2026-10-09", "P3", "B offline", {})
    return v, st


def test_a_refused_fault_does_not_stop_the_others_and_the_reason_is_logged(tmp_path, caplog):
    k = FakeKiosk()
    v, _ = _villa(tmp_path, k)
    k.refuses("t1", 403, SENTENCE)                                   # the first fault made (t1) is refused
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert k.tickets == [("B offline", "sensor.example_b")]           # the second was still made
    assert SENTENCE in caplog.text and "answered 403" in caplog.text and "KioskError" not in caplog.text


def test_a_refused_change_leaves_the_other_faults_brought_up_to_date(tmp_path, caplog):
    k = FakeKiosk()
    v, st = _villa(tmp_path, k)
    run(v.tickets.repair())
    assert k.titles == {"t1": "A offline", "t2": "B offline"}
    st.raise_finding("PM-X", "sensor.example_a", "offline", "2026-10-10", "P3", "A offline 2 days", {})
    st.raise_finding("PM-X", "sensor.example_b", "offline", "2026-10-10", "P3", "B offline 2 days", {})
    k.refuses("t1", 403, SENTENCE)
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert k.titles == {"t1": "A offline", "t2": "B offline 2 days"}
    assert "Kiosk ticket t1 could not be brought up to date: writing the Facility records answered 403: " + SENTENCE in caplog.text


def test_a_kiosk_that_cannot_be_reached_still_ends_the_round(tmp_path, caplog):
    # a refusal is one fault's; a connection refused or a timeout is every fault's — no point trying the next
    k = FakeKiosk()
    v, _ = _villa(tmp_path, k)
    orig, puts = k._req, []

    async def unreached(method, path, body=None):
        if method == "PUT":
            puts.append(path)
            raise KioskError(f"PUT {path}: ClientConnectorError")
        return await orig(method, path, body)
    k._req = unreached
    with caplog.at_level("WARNING", logger="vesta.outcome"):
        run(v.tickets.repair())
    assert k.tickets == [] and puts == ["/agent/v1/fm-data"]          # one try, then the next repair
    assert "ClientConnectorError" in caplog.text


def test_the_error_says_whether_the_kiosk_refused_or_was_not_reached():
    assert KioskError("writing answered 403: no", status=403, said="no").refused
    assert KioskError("the Facility records kept changing", status=409).refused
    assert not KioskError("PUT /agent/v1/fm-data: TimeoutError").refused


def test_the_refusals_words_reach_the_chat_answer(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]}, kiosk=k)
    k.refuses("t1", 403, SENTENCE)
    tools = {t.name: t for t in v.toolbox().tool_objects(None, None)}
    out = run(tools["create_ticket"].handler({"title": "Pump weak"}))
    assert out.get("is_error")
    assert out["content"][0]["text"] == f"The Kiosk did not record the ticket: writing the Facility records answered 403: {SENTENCE}."
