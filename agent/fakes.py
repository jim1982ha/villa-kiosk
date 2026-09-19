"""Fakes for the four ports.

⚠️ THEY MUST MATCH `ports.py` EXACTLY, INCLUDING `async`. The first cut
declared `Channel.send` and `Model.ask` as coroutines in the port and defined
them synchronously here — so the stub `__main__` injects into the live World
would have raised `TypeError` on the first `await`, not the loud
`NotImplementedError` it promises, and the tests froze the wrong shape by
calling them synchronously. Nothing type-checks the Python in CI, so the port
declaration is a promise this file has to keep by hand.

⚠️ SHIPPED, NOT TEST-ONLY, AND THAT IS DELIBERATE. They are the definition of
what each port promises — a later ticket's test writes against these rather than
inventing its own shape of villa, which is how "20 green tests, zero devices
matched" happened once already on this project: the fixture was invented to fit
the code instead of the property.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from agent.health import Health, Link, LinkState


class FakeHass:
    """A villa that answers from a dict and records what it was asked."""

    def __init__(self, entities: list[dict[str, Any]] | None = None,
                 health: Health | None = None) -> None:
        self._entities = entities or []
        self._health = health or Health(Link(LinkState.UP), Link(LinkState.UP))
        self.published: list[tuple[str, str, dict[str, Any]]] = []
        self.asked: list[str] = []
        self.addresses: list[tuple[str, str]] = []

    async def entities(self) -> list[dict[str, Any]]:
        self.asked.append("entities")
        return list(self._entities)

    async def publish(self, object_id: str, state: str,
                      attributes: dict[str, Any]) -> None:
        self.published.append((object_id, state, dict(attributes)))

    def reconfigure(self, url: str, secret: str) -> bool:
        self.addresses.append((url, secret))
        return bool(url)

    def health(self) -> Health:
        return self._health

    def set_health(self, health: Health) -> None:
        self._health = health


class FakeChannel:
    """A phone that records, or — when `wired=False` — one that refuses."""

    def __init__(self, wired: bool = True) -> None:
        self.wired = wired
        self.sent: list[tuple[str, str, str]] = []

    async def send(self, target: str, title: str, body: str) -> None:
        if not self.wired:
            raise NotImplementedError(
                "no channel is wired yet — ticket 15 builds one. Refusing rather "
                "than silently dropping the message.")
        self.sent.append((target, title, body))


class RefusingModel:
    """The Model port before ticket 19 wires one.

    ⚠️ IT RAISES, IT DOES NOT ANSWER EMPTILY. Three tools on the sibling branch
    answered as DATA about an empty villa for their entire life; because that is
    not a refusal, no log could ever show it and nothing failed. An unwired port
    must be loud.
    """

    async def ask(self, prompt: str, **kwargs: Any) -> Any:
        raise NotImplementedError(
            "no model is wired yet — ticket 19 puts one behind the permission "
            "gate. Nothing in this release may call a model.")


class FakeClock:
    """A clock a test drives by hand. `sleep` advances it instead of waiting."""

    def __init__(self, start: str = "2026-01-01T00:00:00+00:00") -> None:
        self._now = datetime.fromisoformat(start)
        self.slept: list[float] = []

    def now(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.advance(seconds)
