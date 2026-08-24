"""What the cached prefix is actually made of. THE instrument, not a guess.

⚠️ THIS EXISTS BECAUSE THE PREFIX IS THE COST MODEL AND NOBODY COULD NAME ITS
PARTS. Cost here is `prefix x turns` and nothing else comes close: one question
at 8 turns read 545,016 cached tokens. The measured chat prefix was 50,481
tokens in one conversation and 68,127 in another **ninety seconds later**, with
`read_only_mode` unchanged upstream — a 35% jump nobody could explain, in the
one number that multiplies. `feedback_measure-before-optimising` says what to do
with an unexplained number and it is not to reason about it.

⚠️ CHARACTERS ARE THE GROUND TRUTH, TOKENS ARE THE ATTRIBUTION, AND THE
DIFFERENCE IS THE WHOLE DESIGN. We control the bytes on the wire exactly; we do
not own a tokeniser and will not ship one (a vocabulary file is a dependency
that goes stale silently, and asking the provider to count is a network round
trip per component per request). So every part is measured in CHARACTERS, and
the run's REAL total input token count — the provider's own number, from
`usage` — is split across the parts by their character share.

That split assumes one chars-per-token ratio across prose and JSON schemas,
which is approximately but not exactly true (dense JSON tokenises a little
worse than English). The line prints `chars/tok` so the assumption is visible
rather than hidden, and the SHARES are what the decisions are made on.

⚠️ AND IT IS WHAT SEPARATES "THE CONTENT GREW" FROM "THE TOKENISER CHANGED".
Characters are model-independent. Two requests whose character counts are equal
and whose token counts differ did not change content — they changed model. A
line carrying only tokens cannot tell those apart, which is exactly the question
the 50k -> 68k jump poses.

⚠️ ONE LINE PER RUN, NOT PER TURN. The prefix is identical on every turn of a
run by construction (that is what makes it cacheable at all), so logging it per
turn would be eight identical lines and would bury the one that changed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

#: The system blocks `playbooks.system_blocks` emits, IN ORDER.
#:
#: ⚠️ THE ORDER IS ALREADY A CONTRACT AND THIS NAMES IT RATHER THAN GUESSING AT
#: IT. `system_blocks` is the single builder for all three tiers and its own
#: docstring fixes the sequence — stable first, volatile last — because the
#: cache breakpoint's correctness depends on it. Reading the blocks positionally
#: here would be `feedback_guessed-field-shapes`; instead `test_prefix.py` pins
#: that the builder emits these names in this order, so the day somebody inserts
#: a block the pin fails rather than the label silently sliding by one.
#:
#: ⚠️ THE LAST ONE IS OPTIONAL. `system_blocks` omits the document when it is
#: empty (triage on a villa with no profile), so the zip is over whatever
#: arrived, never padded.
SYSTEM_BLOCK_NAMES: Tuple[str, ...] = ("playbook", "instructions", "document")

#: A part smaller than this is folded into `other` on the tool line. Purely
#: presentational: the totals always cover everything.
TOOL_DETAIL_TOP: int = 6


def _json_chars(value: Any) -> int:
    """Characters of the compact JSON this object becomes on the wire.

    ⚠️ COMPACT, because that is what an HTTP client sends. Measuring an indented
    dump would inflate every schema by its own nesting depth and would make the
    tool share — the term under investigation — the most wrong number on the
    line.
    """
    try:
        return len(json.dumps(value, separators=(",", ":"), default=str))
    except Exception:  # noqa: BLE001 - an unmeasurable part is not a failed run
        return len(str(value))


@dataclass(frozen=True)
class Part:
    """One named slice of the request, in characters."""

    name: str
    chars: int
    #: How many items the slice holds — tools, blocks, messages. 1 for a block.
    items: int = 1
    #: Does this block carry a cache breakpoint OF ITS OWN? ⚠️ Reported because
    #: the breakpoint's PLACEMENT was the 2.714.0 bug — the stable half and the
    #: volatile half shared one, so the villa document re-wrote every tool
    #: schema on every journal row — and a placement nobody can read is one that
    #: regresses in silence.
    #:
    #: ⚠️ CALLER-PLACED ONLY, AND THAT IS THE EXACT CLAIM. The Anthropic adapter
    #: additionally marks the LAST system block unconditionally (`_cached`), so
    #: a request ships one more breakpoint than this field counts. Mirroring
    #: that rule here would be a second copy of it — the thing this repository
    #: pays for repeatedly — and it would report a constant, whereas the
    #: boundary that can actually regress is the one the caller placed.
    cached: bool = False


@dataclass(frozen=True)
class Breakdown:
    """The whole request, by part. Everything here is exact."""

    parts: Tuple[Part, ...] = ()
    #: Per-tool sizes, largest first. A separate list because the tools are ONE
    #: part of the request and the interesting question is which of them is big.
    tools: Tuple[Part, ...] = ()

    @property
    def chars(self) -> int:
        return sum(p.chars for p in self.parts)

    def share(self, part: Part) -> float:
        total = self.chars
        return (part.chars / total) if total else 0.0


def measure(*, system: Sequence[Mapping[str, Any]],
            tools: Sequence[Mapping[str, Any]],
            messages: Sequence[Mapping[str, Any]] = ()) -> Breakdown:
    """Every part of one request, in characters.

    ⚠️ `messages` IS MEASURED TOO, AND IT IS NOT OPTIONAL TO THE ARITHMETIC.
    The provider's reported input token count covers the WHOLE request, so
    attributing it across the system blocks alone would hand the conversation's
    tokens to the villa document and overstate exactly the part this
    instrument exists to size.
    """
    parts: List[Part] = []

    for name, block in zip(SYSTEM_BLOCK_NAMES, list(system)):
        parts.append(Part(name=name, chars=_json_chars(block),
                          cached="cache_control" in dict(block)))
    # ⚠️ A BLOCK BEYOND THE NAMED ONES IS REPORTED, NOT DROPPED. If a fourth
    # system block is ever added, an instrument that silently ignored it would
    # under-report the prefix — which is `feedback_instruments-never-skip`, the
    # failure this whole file is a response to.
    for index, block in enumerate(list(system)[len(SYSTEM_BLOCK_NAMES):]):
        parts.append(Part(name=f"system[{index + len(SYSTEM_BLOCK_NAMES)}]",
                          chars=_json_chars(block),
                          cached="cache_control" in dict(block)))

    described = [dict(t) for t in tools]
    parts.append(Part(name="tools",
                      chars=sum(_json_chars(t) for t in described),
                      items=len(described)))

    convo = [dict(m) for m in messages]
    parts.append(Part(name="messages",
                      chars=sum(_json_chars(m) for m in convo),
                      items=len(convo)))

    per_tool = sorted(
        (Part(name=str(t.get("name") or "?"), chars=_json_chars(t))
         for t in described),
        key=lambda p: p.chars, reverse=True)
    return Breakdown(parts=tuple(parts), tools=tuple(per_tool))


def _input_tokens(usage: Optional[Mapping[str, int]]) -> int:
    """The request's REAL input token count, from the provider's own report.

    ⚠️ ALL THREE COUNTERS SUM, AND USING ONLY `input_tokens` WOULD REPORT A
    FULLY CACHED 68,000-TOKEN PREFIX AS ~100. That is the shape of instrument
    that reads healthy for the exact case it exists to measure: the better the
    cache works, the smaller the lie looks.
    """
    if not usage:
        return 0
    total = 0
    for name in ("input_tokens", "cache_read_input_tokens",
                 "cache_creation_input_tokens"):
        try:
            total += int(usage.get(name) or 0)
        except (TypeError, ValueError):
            continue
    return total


def _thousands(value: float) -> str:
    return f"{value / 1000:.1f}k" if value >= 1000 else f"{value:.0f}"


def snapshot(breakdown: Breakdown,
             usage: Optional[Mapping[str, int]] = None) -> Dict[str, Any]:
    """THE arithmetic: every part, in characters, share and attributed tokens.

    ⚠️ ONE COMPUTATION, TWO CONSUMERS. `report` FORMATS this rather than
    recomputing it, so the log line and any panel reading these numbers cannot
    drift into disagreeing about the same request — the defect this repository
    has produced thirteen times, most recently as a store envelope key written
    once in Python and once in TypeScript.

    ⚠️ TOKENS ARE ATTRIBUTED FROM THE PROVIDER'S TOTAL, NEVER ESTIMATED FROM A
    DIVISOR. A hardcoded chars-per-token would be a constant nobody could audit
    that drifts with every model; the provider tells us the true total on every
    reply and the character shares are exact, so the split is a measurement with
    one stated assumption instead of two guesses.
    """
    total_tok = _input_tokens(usage)
    total_chars = breakdown.chars
    return {
        "chars": total_chars,
        "tokens": total_tok,
        "parts": [
            {"name": p.name, "chars": p.chars, "items": p.items,
             "cached": p.cached,
             "share": breakdown.share(p),
             "tokens": int(round(breakdown.share(p) * total_tok))}
            for p in breakdown.parts
        ],
        "tools": [{"name": p.name, "chars": p.chars}
                  for p in breakdown.tools],
    }


def report(breakdown: Breakdown, *, model: str = "", kind: str = "",
           usage: Optional[Mapping[str, int]] = None) -> List[str]:
    """The log lines. Two of them: the split, then the largest tools.

    Pure formatting over `snapshot` — see there for the arithmetic.
    """
    snap = snapshot(breakdown, usage)
    total_chars, total_tok = snap["chars"], snap["tokens"]
    head = f"prefix {kind or 'run'}"
    if model:
        head += f"/{model}"

    bits: List[str] = []
    for part in snap["parts"]:
        piece = f"{part['name']} {part['chars']:,}c"
        if total_tok:
            piece += f"/{_thousands(part['tokens'])}t"
        piece += f" {part['share'] * 100:.0f}%"
        if part["name"] in ("tools", "messages"):
            piece += f" n={part['items']}"
        if part["cached"]:
            # ⚠️ NAMED, NOT COUNTED. "2 breakpoints" is true of both the
            # correct arrangement and the one that cost $0.78 in a morning;
            # WHICH block carries it is the fact that separates the two. This
            # marks the CALLER's boundary — see `Part.cached` for why the
            # adapter's unconditional final one is deliberately not shown.
            piece += " [cache]"
        bits.append(piece)

    line = f"{head}: {total_chars:,} chars"
    if total_tok:
        line += (f" = {total_tok:,} tok in "
                 f"({total_chars / total_tok:.2f} chars/tok)")
    else:
        # ⚠️ SAID OUT LOUD. A missing token count means the turn was declined
        # before the provider answered; printing the character line alone with
        # no note would read as "the prefix is free".
        line += " (no token count — the provider did not answer)"
    lines = [f"{line} | " + " ".join(bits)]

    if snap["tools"]:
        top = snap["tools"][:TOOL_DETAIL_TOP]
        rest = snap["tools"][TOOL_DETAIL_TOP:]
        detail = " ".join(f"{t['name']} {t['chars']:,}c" for t in top)
        if rest:
            detail += f" +{len(rest)} more {sum(t['chars'] for t in rest):,}c"
        lines.append(f"{head} tools: {detail}")
    return lines


@dataclass
class Once:
    """Has this run already logged its prefix?

    ⚠️ A TINY OBJECT RATHER THAN A MODULE FLAG. A module-level `logged` set
    would be process-wide state shared by triage, chat and reasoning runs
    executing concurrently, and the first one to log would silence the others —
    an instrument that goes quiet under load, which is when it is wanted.
    """

    done: bool = False

    def take(self) -> bool:
        if self.done:
            return False
        self.done = True
        return True
