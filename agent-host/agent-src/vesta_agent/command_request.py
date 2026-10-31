"""A command skill's request, from the "/investigate …" that starts it to its last turn (architecture review, 2026-10-13).

Every turn of one request — its first, the follow-up that makes its page (Request.carried), a Continue pressed later —
is the same request: one id (`inv`: its fault offer, its page), its skill's own brain and limit, and every web search
it made, which its page must list (the reports skill's compose.py refuses a page that searched without sources).

⚠️ KEPT ON DISK. The searches were held in the agent's memory only: an update between two turns (a Continue pressed
after it) forgot them, and the page then went out without its sources — the owner's complaint of 2026-10-11. They are
named records (state.keep_request_searches, KV_FAMILIES "request_searches:"), pruned with the other records.
"""
from __future__ import annotations

import dataclasses
import logging
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from vesta_shared.limits import limit

log = logging.getLogger("vesta.request")


def kept() -> int:
    """The searches a request keeps (a script is told the first ai.web_searches_kept: tools.run_skill_script)."""
    return limit("ai.request_searches_kept", 40, unit="searches", group="keep", lo=1, hi=500,
                 says="How many web searches one investigation keeps from one step to the next (after Continue, and "
                      "for its page).",
                 reached="Older searches of that investigation are forgotten.", told="")


class Searches(list):
    """A request's web searches, in the order made; each one written down as it is added (runner.make_guard)."""

    def __init__(self, state, inv: str, items=()):
        super().__init__(items)
        self._state, self._inv = state, inv

    def append(self, query) -> None:
        super().append(query)
        self._state.keep_request_searches(self._inv, list(self)[-kept():])


@dataclass
class Request:
    skill: object                 # skills.Skill: the command skill the person called
    inv: str                      # the request's id: when it began (fault_offers keys its offer by it)
    searched: Searches

    @property
    def name(self) -> str:
        return self.skill.name

    @property
    def brain(self) -> str | None:
        return self.skill.brain

    @property
    def limit_usd(self) -> float | None:
        return self.skill.limit_usd

    async def carried(self, res, again: Callable[[str], Awaitable], offer: Callable[[str, str], None]):
        """⚠️ WHAT A COMMAND SKILL'S ANSWER CARRIES, CHECKED — NEVER LEFT TO THE AI (owner, 2026-10-11: "make sure this
        always trigger the full use of the skill — HTML report in the response and buttons to create and cancel a
        ticket creation"). skill.yaml `deliver`: the page the answer must have sent (missing: the AI is sent back to it
        once, `again(words)` its follow-up turn, then the person is told), and a fault always offered — one per request
        (`offer(inv, account)`: fault_offers). The answer `res` (turn.TurnResult) as it goes out.

        ⚠️ THE REQUEST'S OWN JOB (architecture review 2026-10-30, round 2): it was app._delivered, reading the request's
        skill and id from outside, testable only through a whole agent."""
        sk = self.skill
        page, account = sk.deliver.get("page"), sk.deliver.get("fault_offer")
        if page and page not in res.attached:
            log.info("/%s answered without %s: the AI is sent back to make it", sk.command, page)
            follow = await again(f"Your answer has not sent {page}: every /{sk.command} answer carries it. Make it now and "
                                 f"send it with send_message (attachment {page}), as the {sk.name} skill says. Write "
                                 "nothing else.")
            # ⚠️ THE FOLLOW-UP'S OWN OUTCOME GOES ON (review 32): its stop at the limit (Continue) and its problem (no
            # credit is not "the page could not be made") — every field by its rule (TurnResult.then)
            res = res.then(follow)
            if page not in res.attached and not (res.problem or res.error or res.stopped_at_limit):
                log.warning("/%s still without %s", sk.command, page)
                res = dataclasses.replace(res, text=((res.text or res.earlier or "").strip() + "\n\n" +
                                                     "The report page could not be made this time.").strip())
        if account and self.inv:
            offer(self.inv, account)
            res = dataclasses.replace(res, offered=max(res.offered, 1))
        return res


class Requests:
    def __init__(self, state, skills):
        self.state, self.skills = state, skills

    def begin(self, invoked: str | None) -> Request | None:
        """A new request of the skill `invoked` names; None when there is none (an ordinary message)."""
        sk = self.skills.get(invoked) if invoked else None
        if sk is None:
            return None
        inv = f"{time.time():.3f}"
        return Request(sk, inv, Searches(self.state, inv))

    def resume(self, invoked: str | None, inv: str | None) -> Request | None:
        """The request a Continue continues (state.new_continuation keeps its skill and id), with the searches it made
        so far — whatever the agent did in between. None when its skill is gone or it carries none."""
        sk = self.skills.get(invoked) if invoked else None
        if sk is None or not inv:
            return None
        return Request(sk, inv, Searches(self.state, inv, self.state.request_searches(inv)))
