"""A chart's Y axis — its round ticks and their labels — for every chart the VESTA Agent draws: the
reports' line and bar charts (reports compose.py) and the Costs page's daily cost chart (status.costs serves it,
app.js only draws it).

⚠️ ONE AXIS (architecture review, 0.12.36). The reports and the Costs page each worked the axis out their own
way, and both mislabelled a step of 2.5 or 0.25 ("0.2" and "0.8" for 0.25 and 0.75; "$3" and "$8" for 2.5 and
7.5): the decimals were chosen from the size of the step, not from the step itself. The VESTA Kiosk fixed the
same defect in its own chart code (fmtAxis, 2.496.144); this follows its rule.
"""
from __future__ import annotations

import math

MAX_TICKS = 100          # a guard, never a layout choice


def is_flat(lo: float, hi: float) -> bool:
    """A span of floating-point noise around the value (21.4 against 21.400000000000002), or none: flat."""
    return not hi - lo > max(abs(lo), abs(hi), 1.0) * 1e-9


def decimals(step: float) -> int:
    """As many decimals as the step needs, exactly: 0.25 → 2, 2.5 → 1, 5 → 0."""
    d = 0
    while d < 6 and abs(step * 10 ** d - round(step * 10 ** d)) > 1e-9:
        d += 1
    return d


def label(v: float, step: float) -> str:
    """A tick's text, with the step's decimals and thousands separators (2,500)."""
    return f"{v:,.{decimals(step)}f}"


def nice_axis(lo: float, hi: float, n: int = 4) -> dict:
    """Round ticks over [lo, hi]: a 1-2-2.5-5 step × 10ⁿ giving about `n` intervals, from a round value at or under
    `lo` to one at or over `hi`. Returns {first, last, step, ticks, labels}. Each tick comes from its index (an
    accumulating `v += step` never moved for float-noise readings, 2026-10-05), at most MAX_TICKS."""
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return {"first": 0.0, "last": 1.0, "step": 1.0, "ticks": [], "labels": []}
    span = hi - lo
    if is_flat(lo, hi):
        span = abs(hi) or 1.0
    raw = span / max(1, n)
    mag = 10 ** math.floor(math.log10(raw))
    step = next((k * mag for k in (1, 2, 2.5, 5, 10) if k * mag >= raw * 0.999), 10 * mag)
    first = math.floor(lo / step + 1e-9) * step
    last = math.ceil(hi / step - 1e-9) * step
    if last <= first:
        last = first + step
    count = min(round((last - first) / step), MAX_TICKS)
    ticks = [round(first + i * step, 10) for i in range(count + 1)]
    return {"first": first, "last": last, "step": step, "ticks": ticks, "labels": [label(t, step) for t in ticks]}
