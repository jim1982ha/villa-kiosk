"""What a model call cost, counted rather than estimated.

⚠️ THE ONLY FIGURE ANYONE MAY QUOTE. This project has been wrong about its own
cost by ~115x — a $5.00/day number sat in a planning document and was read as
live against $0.043 actually measured, and the owner caught it, not us. The rule
that came out of that is short: a cost claim is a printed measurement or it is
not made. Every later ticket's cost statement must come from `Meter.line()`.

⚠️ AND AN UNKNOWN MODEL COSTS `None`, NOT `0`. A price table is dated the day it
is written. When a call names a model this table does not know, the honest
answer is "cannot price", exactly as ticket 26's measures answer "cannot
measure" rather than zero for an asset with no statistics. Silently costing an
unknown model at zero is how a bill arrives that nothing predicted, and it is
the same defect as a duty-cycled sensor reading 0 being reported as "stopped".
"""
from __future__ import annotations

from dataclasses import dataclass, field

from agent import log

#: Cache multipliers, relative to the model's own input rate: a cache WRITE
#: costs a quarter more than ordinary input, a cache READ a tenth of it.
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


@dataclass(frozen=True)
class Price:
    """USD per million tokens, as published for the first-party API."""
    input_usd_per_mtok: float
    output_usd_per_mtok: float


#: ⚠️ DATED, AND DELIBERATELY NOT EXHAUSTIVE. Published first-party rates as of
#: 2026-06-24. Partner platforms (Bedrock, Vertex) price separately and are not
#: modelled — the layer calls the first-party API. A model missing here is not a
#: bug to paper over with a default: `price_of` returns None and the meter says
#: UNPRICED, which is the signal that this table needs a maintainer's attention.
PRICES: dict[str, Price] = {
    "claude-opus-5": Price(5.00, 25.00),
    "claude-opus-4-8": Price(5.00, 25.00),
    "claude-opus-4-7": Price(5.00, 25.00),
    "claude-opus-4-6": Price(5.00, 25.00),
    "claude-sonnet-5": Price(2.00, 10.00),
    "claude-sonnet-4-6": Price(3.00, 15.00),
    "claude-haiku-4-5": Price(1.00, 5.00),
    "claude-fable-5-1": Price(10.00, 50.00),
    "claude-fable-5": Price(10.00, 50.00),
}


def price_of(model: str) -> Price | None:
    """The published rate for `model`, or None when this table does not know it."""
    return PRICES.get(model)


@dataclass(frozen=True)
class Usage:
    """What one model call consumed, in the API's own four buckets."""
    model: str
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class Reading:
    """One call's cost. `usd is None` means it could not be priced."""
    usage: Usage
    usd: float | None


def cost_of(usage: Usage) -> float | None:
    price = price_of(usage.model)
    if price is None:
        return None
    per_in = price.input_usd_per_mtok / 1_000_000
    per_out = price.output_usd_per_mtok / 1_000_000
    return (usage.input_tokens * per_in
            + usage.cache_read_tokens * per_in * CACHE_READ_MULTIPLIER
            + usage.cache_write_tokens * per_in * CACHE_WRITE_MULTIPLIER
            + usage.output_tokens * per_out)


@dataclass
class Meter:
    """Running totals for one day, plus the lifetime call count.

    `daily_usd_limit` of 0 means NO limit, matching every other clamp in this
    repository where 0 is the off switch. It does not mean "may never spend".
    """
    daily_usd_limit: float = 0.0
    today: str = ""
    calls: int = 0
    calls_all_time: int = 0
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    spent_usd: float = 0.0
    unpriced_calls: int = 0
    _readings: list[Reading] = field(default_factory=list, repr=False)

    def record(self, usage: Usage) -> Reading:
        usd = cost_of(usage)
        self.calls += 1
        self.calls_all_time += 1
        self.input_tokens += usage.input_tokens
        self.cache_read_tokens += usage.cache_read_tokens
        self.cache_write_tokens += usage.cache_write_tokens
        self.output_tokens += usage.output_tokens
        if usd is None:
            self.unpriced_calls += 1
        else:
            self.spent_usd += usd
        reading = Reading(usage=usage, usd=usd)
        self._readings.append(reading)
        # ⚠️ PER CALL, WHICH IS WHAT THE TICKET ASKS FOR. Running totals alone
        # cannot answer "what did THAT cost", and the one question this project
        # has historically got wrong by two orders of magnitude is exactly that
        # one. Nothing calls a model in this release, so this line never prints
        # here — which is the correct amount of output for zero calls.
        log.info(f"  model call: {usage.model} in={usage.input_tokens} "
                 f"cached={usage.cache_read_tokens} "
                 f"cache_write={usage.cache_write_tokens} "
                 f"out={usage.output_tokens} "
                 + (f"usd={usd:.4f}" if usd is not None else "usd=UNPRICED"))
        return reading

    @property
    def remaining_usd(self) -> float | None:
        """Budget left today, or None when no limit is set."""
        if self.daily_usd_limit <= 0:
            return None
        return max(0.0, self.daily_usd_limit - self.spent_usd)

    @property
    def exhausted(self) -> bool:
        """Whether today's budget is spent.

        ⚠️ AN UNPRICED CALL EXHAUSTS IT. If a spend could not be priced, the
        layer cannot honestly claim to know there is budget left — and the safe
        direction for an unknown is closed, not open.
        """
        if self.daily_usd_limit <= 0:
            return False
        if self.unpriced_calls:
            return True
        return self.spent_usd >= self.daily_usd_limit

    def roll_to(self, day: str) -> None:
        """Start a new day. Lifetime counters survive; today's do not."""
        if day == self.today:
            return
        self.today = day
        self.calls = 0
        self.input_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.output_tokens = 0
        self.spent_usd = 0.0
        self.unpriced_calls = 0
        self._readings.clear()

    def line(self) -> str:
        """The one line every cost claim in this project must come from."""
        parts = [
            f"calls={self.calls}",
            f"in={self.input_tokens}",
            f"cached={self.cache_read_tokens}",
            f"cache_write={self.cache_write_tokens}",
            f"out={self.output_tokens}",
            f"usd={self.spent_usd:.4f}",
        ]
        if self.daily_usd_limit > 0:
            parts.append(f"limit={self.daily_usd_limit:.2f}")
        if self.unpriced_calls:
            parts.append(f"UNPRICED={self.unpriced_calls}")
        return "meter: " + " ".join(parts)
