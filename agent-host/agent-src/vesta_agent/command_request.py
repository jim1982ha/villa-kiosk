"""A command skill's request, from the "/investigate …" that starts it to its last turn (architecture review, 2026-10-13).

Every turn of one request — its first, the follow-up that makes its page (app._delivered), a Continue pressed later —
is the same request: one id (`inv`: its fault offer, its page), its skill's own brain and limit, and every web search
it made, which its page must list (the reports skill's compose.py refuses a page that searched without sources).

⚠️ KEPT ON DISK. The searches were held in the agent's memory only: an update between two turns (a Continue pressed
after it) forgot them, and the page then went out without its sources — the owner's complaint of 2026-10-11. They are
named records (state.keep_request_searches, KV_FAMILIES "request_searches:"), pruned with the other records.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from vesta_shared.limits import limit



def kept() -> int:
    """The searches a request keeps (a script is told the first ai.web_searches_kept: tools.run_skill_script)."""
    return limit("ai.request_searches_kept", 40, unit="searches", group="keep", lo=1, hi=500,
                 says="Web searches one investigation keeps across its turns (a Continue, its page).",
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
