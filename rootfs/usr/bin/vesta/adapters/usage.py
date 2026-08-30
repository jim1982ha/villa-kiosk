"""What has been spent, per request, and who caused it.

⚠️ THIS IS AN ACCOUNT, NOT A CEILING, AND CONFUSING THE TWO WOULD UNDO A
DELIBERATE DECISION. `budget.py` counts REQUESTS because a ceiling has to be
enforceable from facts the villa controls — a token count comes from the
provider's own reply, and a limit you cannot verify is not a limit. This module
answers a different question: *where did the money go*. It is allowed to be an
ESTIMATE because nobody is gated on it, and it says so everywhere it reports.

⚠️ THE PROVIDER'S BILL IS THE AUTHORITY AND THIS WILL NOT MATCH IT EXACTLY.
Prices change, promotional rates lapse, a request that fails after the tokens
were read may still be billed, and this records nothing about calls made by
anything other than this add-on. `estimated: true` rides every total for that
reason — a figure presented as a bill that is a few cents out is worse than one
presented as an estimate that is a few cents out.

⚠️ PER-ACTOR ATTRIBUTION IS THE POINT, AND IT IS THE ONE THING THE PROVIDER'S
OWN CONSOLE CANNOT GIVE. One API key serves triage, reasoning, briefs and every
person who messages the villa; the console sees one key. "Which of my users
spent this" is only answerable here, at the call site, where the actor is known.

⚠️ IT LIVES IN `reports/` AND NOT IN `agent/` BECAUSE OF THE LAYERING RULE.
Both provider call sites need it — the agent loop and the brief narrator — and
`reports/__init__.py` says layering is strictly downward, so the narrator may
not import upward into `agent`. This imports `store` and `log` and nothing else,
which puts it exactly where a fact both layers need belongs.

⚠️ AND IT RECORDS WHETHER OR NOT NARRATION IS SWITCHED ON. The owner's question
is about the KEY, not about a feature: an agent run costs money with the brief
narrator switched off, and a ledger that only counted narrated briefs would show
zero on a bill that was climbing. Every provider call site records here — there
are two, and `test_agent_usage` walks for a third.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.adapters import log as log_mod
from vesta.adapters import store as store_mod
from vesta.adapters.log import swallow


def _add_usd(cost: float) -> None:
    """Accumulate this pass's spend. ⚠️ A FLOAT SUM, NOT A `tally`, which is
    integer — rounding each call to whole dollars would report every pass on
    this villa as costing nothing."""
    try:
        book = log_mod.census()
        log_mod.note("usd", round(float(book.get("usd", 0.0)) + float(cost), 6))
    except Exception:  # noqa: BLE001 - accounting must not fail the work
        pass

USAGE_PATH: str = "/data/vesta/usage.json"

#: ⚠️ BOUNDED, LIKE EVERY OTHER RING UNDER /data. At a fifteen-minute cadence
#: this is roughly two months of triage, which comfortably covers "since I
#: topped up my account" — the question this exists to answer.
#:
#: ⚠️ `record` REWRITES THE WHOLE RING, so the cost is linear in this number:
#: measured at ~12 ms per call with the ring full. That is accepted rather than
#: optimised — it happens once per provider request, immediately after a network
#: call that took seconds, and an append-only format would trade that for a
#: second file layout and a compaction path. Do not raise this by an order of
#: magnitude without re-measuring.
MAX_ROWS: int = 8_000

#: Published list prices, USD per MILLION tokens, as `(input, output)`.
#: ⚠️ A PRICE LIST IS NOT A VILLA CONSTANT. CLAUDE.md forbids per-site tuning
#: values; these are the provider's public rates, identical for every install,
#: and the alternative — asking each owner to type them in — would produce
#: worse numbers everywhere.
#:
#: ⚠️ IT WILL GO STALE, AND THE FAILURE IS QUIET. An unknown model falls back to
#: `UNKNOWN_MODEL` rather than to zero: a model this table has not heard of
#: costing nothing would make the ledger UNDER-report exactly when a new and
#: probably more expensive model was adopted, and the whole point is that the
#: number is not a surprise.
PRICES: Dict[str, Sequence[float]] = {
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-opus-4-7": (5.00, 25.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-fable-5": (10.00, 50.00),
}

#: What an unrecognised model is charged at. ⚠️ THE MOST EXPENSIVE ROW, not an
#: average — see the note above. An over-estimate prompts a look; an
#: under-estimate is discovered on the bill.
UNKNOWN_MODEL: Sequence[float] = (10.00, 50.00)

#: Cache multipliers against the INPUT price. ⚠️ DERIVED RATHER THAN TABLED,
#: because they are ratios the provider applies uniformly — tabling four numbers
#: per model would be four chances for one row to disagree with the others, for
#: no information gained.
CACHE_READ_FACTOR: float = 0.1
CACHE_WRITE_FACTOR: float = 1.25

MILLION: float = 1_000_000.0


def price_of(model: str) -> Sequence[float]:
    """`(input, output)` USD per million tokens for a model id."""
    name = str(model or "").strip()
    if name in PRICES:
        return PRICES[name]
    # ⚠️ PREFIX MATCH SO A DATED SNAPSHOT IS NOT AN UNKNOWN MODEL.
    # `claude-opus-5-20260401` is the same price as `claude-opus-5`, and
    # charging it at the unknown rate would make a correctly-configured villa
    # look like it had adopted something exotic.
    for known, row in PRICES.items():
        if name.startswith(known):
            return row
    return UNKNOWN_MODEL


def cost_of(model: str, counts: Mapping[str, Any]) -> float:
    """USD for one request, from its four token counters.

    ⚠️ CACHE READS ARE COUNTED SEPARATELY FROM INPUT AND ARE NOT A SUBSET OF
    IT. The provider reports `input_tokens` as the tokens it actually charged at
    the input rate, with cached ones broken out — adding them together would
    charge the cached prefix twice, at ten times its real price, on the very
    design decision (a stable cached prefix) that makes the cadence affordable.
    """
    inp, out = price_of(model)

    def n(name: str) -> float:
        try:
            return max(0.0, float(counts.get(name) or 0))
        except (TypeError, ValueError):
            return 0.0

    return (
        n("input_tokens") * inp
        + n("output_tokens") * out
        + n("cache_read_input_tokens") * inp * CACHE_READ_FACTOR
        + n("cache_creation_input_tokens") * inp * CACHE_WRITE_FACTOR
    ) / MILLION


def record(*, source: str, model: str, counts: Mapping[str, Any],
           actor: str = "system", run_id: str = "",
           path: Optional[str] = None, now: Optional[float] = None) -> None:
    """Append one request. ⚠️ NEVER RAISES — see the module docstring: an
    accounting failure must not be able to fail the work being accounted for."""
    try:
        at = float(now if now is not None else time.time())
        row = {
            "at": at,
            "source": str(source or "unknown"),
            "model": str(model or ""),
            "actor": str(actor or "system"),
            "run_id": str(run_id or ""),
            "input": int(float(counts.get("input_tokens") or 0)),
            "output": int(float(counts.get("output_tokens") or 0)),
            "cache_read": int(float(counts.get("cache_read_input_tokens") or 0)),
            "cache_write": int(float(
                counts.get("cache_creation_input_tokens") or 0)),
            "cost": round(cost_of(model, counts), 6),
        }
        # ⚠️ THE PASS CENSUS IS FED FROM HERE BECAUSE EVERY MODEL CALL COMES
        # THROUGH HERE (2026-08-30), whatever tier made it — so "what did this
        # run cost" needs no plumbing and cannot miss a caller. Outside a pass
        # the contextvar is empty and these are silent.
        # ⚠️ RE-READ FROM `counts`, NOT FROM `row`. `row` is `Dict[str, Any]`
        # because it also holds strings, so arithmetic on its members is untyped
        # to mypy — and silencing that with a cast would be hiding the one thing
        # strict mode is for on a line that does sums.
        log_mod.tally("tokens_in", int(float(counts.get("input_tokens") or 0))
                      + int(float(counts.get("cache_read_input_tokens") or 0))
                      + int(float(counts.get("cache_creation_input_tokens") or 0)))
        log_mod.tally("tokens_out", int(float(counts.get("output_tokens") or 0)))
        _add_usd(cost_of(model, counts))
        target = path or USAGE_PATH
        rows = store_mod.read_json(target, {})
        entries = rows.get("rows") if isinstance(rows, Mapping) else None
        entries = list(entries) if isinstance(entries, list) else []
        entries.append(row)
        store_mod.write_json(target, {"rows": entries[-MAX_ROWS:]})
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not record provider usage", err)


def rows(*, since: float = 0.0, path: Optional[str] = None
         ) -> List[Dict[str, Any]]:
    """Every recorded request at or after `since`, oldest first."""
    try:
        raw = store_mod.read_json(path or USAGE_PATH, {})
        entries = raw.get("rows") if isinstance(raw, Mapping) else None
        entries = entries if isinstance(entries, list) else []
    except Exception as err:  # noqa: BLE001
        swallow("could not read provider usage", err)
        return []
    out = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        try:
            at = float(entry.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if at >= float(since):
            out.append(dict(entry))
    return out


def summary(*, since: float = 0.0, path: Optional[str] = None
            ) -> Dict[str, Any]:
    """Totals, and the same totals split three ways.

    ⚠️ BY ACTOR, BY SOURCE AND BY MODEL — because "why did it cost that" has
    three different answers and the owner does not know in advance which one
    they need. A single total answers none of them.
    """
    found = rows(since=since, path=path)
    total = {"requests": 0, "input": 0, "output": 0, "cache_read": 0,
             "cache_write": 0, "cost": 0.0}
    by_actor: Dict[str, Dict[str, Any]] = {}
    by_source: Dict[str, Dict[str, Any]] = {}
    by_model: Dict[str, Dict[str, Any]] = {}

    def add(bucket: Dict[str, Dict[str, Any]], key: str,
            entry: Mapping[str, Any]) -> None:
        slot = bucket.setdefault(key, {"requests": 0, "input": 0, "output": 0,
                                       "cache_read": 0, "cache_write": 0,
                                       "cost": 0.0})
        slot["requests"] += 1
        for name in ("input", "output", "cache_read", "cache_write"):
            slot[name] += int(entry.get(name) or 0)
        slot["cost"] += float(entry.get("cost") or 0.0)

    for entry in found:
        total["requests"] += 1
        for name in ("input", "output", "cache_read", "cache_write"):
            total[name] += int(entry.get(name) or 0)
        total["cost"] += float(entry.get("cost") or 0.0)
        add(by_actor, str(entry.get("actor") or "system"), entry)
        add(by_source, str(entry.get("source") or "unknown"), entry)
        add(by_model, str(entry.get("model") or "unknown"), entry)

    total["cost"] = round(float(total["cost"]), 4)
    for bucket in (by_actor, by_source, by_model):
        for slot in bucket.values():
            slot["cost"] = round(float(slot["cost"]), 4)

    return {
        "since": float(since),
        "total": total,
        "by_actor": by_actor,
        "by_source": by_source,
        "by_model": by_model,
        # ⚠️ THE HONESTY FLAG, CARRIED IN THE DATA RATHER THAN WRITTEN INTO ONE
        # UI STRING. Any second reader of this endpoint inherits it.
        "estimated": True,
        # ⚠️ THE EARLIEST ROW ON RECORD, so a reader can tell "nothing was spent
        # in that window" from "this ledger did not exist yet". Those look
        # identical in a total and mean opposite things — and on the release
        # that adds this, every earlier request is in the second category.
        "recording_since": min((float(r.get("at") or 0) for r in
                                rows(path=path)), default=0.0),
    }
