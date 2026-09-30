"""Small, dependency-free statistics used by the rules. Code computes, the
model writes: every number in a chat message comes from here."""

from __future__ import annotations

from statistics import median
from typing import Sequence


def med(xs: Sequence[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return median(xs) if xs else None


def mad(xs: Sequence[float]) -> float | None:
    m = med(xs)
    if m is None:
        return None
    return med([abs(x - m) for x in xs])


def pct_change(new: float, base: float) -> float | None:
    if base in (None, 0) or new is None:
        return None
    return (new - base) / base * 100.0


def slope_per_hour(points: list[tuple[float, float]]) -> float | None:
    """Least squares slope of value against hours. points = [(hours, value)]"""
    n = len(points)
    if n < 3:
        return None
    sx = sum(p[0] for p in points); sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points); sxy = sum(p[0] * p[1] for p in points)
    den = n * sxx - sx * sx
    if den == 0:
        return None
    return (n * sxy - sx * sy) / den


def step_index(series: Sequence[float], min_seg: int = 3) -> tuple[int | None, float | None]:
    """Single change point by least squares: returns (index, relative change).
    The index is the first element of the second segment."""
    n = len(series)
    if n < 2 * min_seg:
        return None, None
    best_i, best_cost = None, None
    total_mean = sum(series) / n
    base_cost = sum((x - total_mean) ** 2 for x in series)
    for i in range(min_seg, n - min_seg + 1):
        a, b = series[:i], series[i:]
        ma, mb = sum(a) / len(a), sum(b) / len(b)
        cost = sum((x - ma) ** 2 for x in a) + sum((x - mb) ** 2 for x in b)
        if best_cost is None or cost < best_cost:
            best_i, best_cost = i, cost
    if best_i is None or base_cost == 0:
        return None, None
    a, b = series[:best_i], series[best_i:]
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    gain = 1 - best_cost / base_cost  # fraction of variance explained by one step
    if gain < 0.5 or ma == 0:
        return None, None
    return best_i, (mb - ma) / ma * 100.0
