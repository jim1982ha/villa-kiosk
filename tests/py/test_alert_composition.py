"""One alert, composed once, delivered to everybody it is addressed to.

⚠️ THE DEFECT THIS PAYS FOR (2026-09-06). The first send and the escalation each
composed their own alert: rating line in both dialects, escape the already-inert
body, append our markup, try the buttons, send whatever declined as plain text.
The same six steps, written twice — and they disagreed about the one that
matters.

`_send_with_buttons` returns an EMPTY LIST when it cannot serve the buttons at
all: a Telegram that refused a keyboard, a registry that could not be read. Its
own docstring is explicit that every such case "must all end with the owner
still being told". The first send computed its fallback from `plan.targets`, so
an empty result meant "nobody got it, send to everybody" — correct. The
escalation computed its fallback from `results`, so an empty result meant an
empty fallback: nothing sent, and the function reported failure.

⚠️ SO THE LADDER'S OWN RUNG WAS THE SILENT ONE. Escalation exists BECAUSE
nobody answered the first message; it is the path that must not fail quietly,
and it was the one that did — only when the chat platform faltered, which is
exactly when it is needed.

⚠️ THESE ASSERT BEHAVIOUR, NOT SOURCE ORDER. The properties here used to be
pinned by slicing `_deliver_one`'s source text and comparing string offsets,
because there was no seam at which the order could be observed. `_send_alert`
is that seam, so the question "who actually got sent to" is now askable.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from vesta.adapters import deliver as deliver_mod  # noqa: E402
from vesta.supervise.agent import outbox  # noqa: E402
from vesta.supervise.agent.route import Delivery  # noqa: E402


def _run(buttons_result: List[Dict[str, Any]]):
    """Compose one alert to two targets, with the buttons path returning
    `buttons_result`. Returns the targets the PLAIN path was asked to serve."""
    sent_plainly: List[List[str]] = []
    bodies: List[str] = []

    async def _fake_rating(_session):
        return ("plain-link", "<a href='x'>html-link</a>")

    async def _fake_buttons(_session, _concern, _plan, *, config=None):
        return list(buttons_result)

    async def _fake_deliver(_session, targets, title, body):
        sent_plainly.append(list(targets))
        bodies.append(f"{title}\n{body}")
        return [{"target": t, "status": "sent"} for t in targets]

    saved = (outbox._rating_link, outbox._send_with_buttons, deliver_mod.deliver)
    outbox._rating_link = _fake_rating
    outbox._send_with_buttons = _fake_buttons
    deliver_mod.deliver = _fake_deliver
    try:
        plan = Delivery(concern_id="c1", severity="warning",
                        targets=["notify.a", "notify.b"],
                        title="TITLE", body="BODY & more")
        results = asyncio.run(outbox._send_alert(
            {}, {"id": "c1"}, plan, title="TITLE", config=None))
    finally:
        (outbox._rating_link, outbox._send_with_buttons,
         deliver_mod.deliver) = saved
    return sent_plainly, bodies, results


def test_a_buttons_send_that_returns_NOTHING_still_reaches_everybody() -> None:
    """⚠️ THE ESCALATION BUG, AS A TEST. An empty result is the documented way
    `_send_with_buttons` says "I could not do this" — it must widen the plain
    send to every target, never narrow it to none."""
    sent_plainly, _bodies, _results = _run([])
    assert sent_plainly == [["notify.a", "notify.b"]], (
        "a buttons send that returned nothing did not fall back to every "
        "target — this is the path an escalation takes when Telegram fails")


def test_only_the_targets_the_buttons_missed_are_sent_plainly() -> None:
    """Nobody is told twice."""
    sent_plainly, _bodies, _results = _run(
        [{"target": "notify.a", "status": "sent"}])
    assert sent_plainly == [["notify.b"]], (
        "the plain fallback re-sent to a target that already received the "
        "alert with its buttons")


def test_everybody_served_by_the_buttons_means_no_plain_send() -> None:
    sent_plainly, _bodies, _results = _run(
        [{"target": "notify.a", "status": "sent"},
         {"target": "notify.b", "status": "sent"}])
    assert sent_plainly == [], "a plain send went out that nobody needed"


def test_the_plain_body_carries_the_plain_rating_line() -> None:
    """⚠️ THE TWO DIALECTS ARE NOT INTERCHANGEABLE. `notify.send_message`
    publishes no `parse_mode`, so the plain path must carry the address rather
    than an anchor."""
    _sent, bodies, _results = _run([])
    assert "plain-link" in bodies[0], "the plain fallback lost the rating line"
    assert "html-link" not in bodies[0], (
        "the plain fallback carries HTML markup, which shows as source text")
