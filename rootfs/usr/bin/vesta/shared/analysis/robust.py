"""Statistics that survive the data a villa actually produces.

⚠️ THE MEAN AND THE STANDARD DEVIATION ARE THE WRONG TOOLS HERE, and using
them is the single easiest way to make this subsystem untrustworthy. A month of
a pool pump's hourly consumption contains the pump running, the pump idle, a
day the power was out, an hour the meter reported a spike because the recorder
restarted, and a week the villa was empty. One 40x outlier moves a mean past
any threshold you would have chosen; the median does not notice it.

So: median for the centre, MAD for the spread. MAD is the median of absolute
deviations from the median — the same idea applied twice — and it tolerates up
to half the sample being nonsense before it misleads.

Everything here is pure, takes plain floats, and imports nothing. That is
deliberate: these functions decide whether the villa's owner is told their
freezer is failing, and they should be testable without a villa, a recorder or
a network.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

#: Converts MAD to a standard-deviation-equivalent for normally distributed
#: data. Not magic: 1/Φ⁻¹(0.75). Quoted so a reader can check it rather than
#: trust it, and used only so thresholds can be expressed in familiar "sigma"
#: terms without inheriting the standard deviation's fragility.
MAD_TO_SIGMA = 1.4826


def median(values: Sequence[float]) -> Optional[float]:
    """The middle value, or None for an empty sample.

    None rather than 0.0, throughout this module: "no data" and "measured
    zero" are different findings, and a report that states 0 for a meter that
    said nothing is stating a measurement nobody took.
    """
    ordered = sorted(v for v in values if v == v)  # v == v drops NaN
    count = len(ordered)
    if count == 0:
        return None
    middle = count // 2
    if count % 2:
        return float(ordered[middle])
    return (float(ordered[middle - 1]) + float(ordered[middle])) / 2.0


def mad(values: Sequence[float]) -> Optional[float]:
    """Median absolute deviation.

    ⚠️ RETURNS 0.0 LEGITIMATELY, and every caller must handle it. A device
    that draws exactly the same amount every hour — which a well-behaved
    always-on appliance genuinely does — has a MAD of zero, and any threshold
    of the form `median + k * MAD` then flags the very first value that differs
    at all. That is not sensitivity, it is a divide-by-almost-zero dressed up
    as statistics, and it is how an anomaly detector comes to cry wolf on the
    quietest equipment in the house.
    """
    centre = median(values)
    if centre is None:
        return None
    return median([abs(float(v) - centre) for v in values if v == v])


def robust_sigma(values: Sequence[float]) -> Optional[float]:
    """MAD rescaled so a threshold can be written in sigma."""
    spread = mad(values)
    if spread is None:
        return None
    return spread * MAD_TO_SIGMA


def percentile(values: Sequence[float], fraction: float) -> Optional[float]:
    """Linear-interpolated percentile. `fraction` is 0..1.

    Used to find an IDLE FLOOR: the level a device sits at when it is not
    doing anything. A low percentile answers that far better than a minimum,
    which picks up the single hour the meter reported nothing at all.
    """
    ordered = sorted(float(v) for v in values if v == v)
    if not ordered:
        return None
    if len(ordered) == 1:
        return ordered[0]
    fraction = min(1.0, max(0.0, fraction))
    position = fraction * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return ordered[low] * (1.0 - weight) + ordered[high] * weight


def relative_change(baseline: float, observed: float) -> Optional[float]:
    """`observed` as a fraction above `baseline`. None when meaningless.

    ⚠️ A ZERO BASELINE HAS NO RELATIVE CHANGE, and returning `inf` — or worse,
    a large finite number — would make every device that used to draw nothing
    the loudest finding in the report. A device that genuinely went from 0 to
    something is a real observation, but it is an ABSOLUTE one and belongs to a
    different question than "this crept up by 40%".
    """
    if baseline <= 0.0:
        return None
    return (observed - baseline) / baseline


def trimmed(values: Sequence[float], fraction: float = 0.05) -> List[float]:
    """Drop the most extreme `fraction` from each end.

    For the cases where a median is not what is wanted but a mean over raw
    values would be indefensible — chiefly summing a window that may contain a
    recorder restart's spike.
    """
    ordered = sorted(float(v) for v in values if v == v)
    if len(ordered) < 3 or fraction <= 0:
        return ordered
    cut = int(len(ordered) * fraction)
    return ordered[cut:len(ordered) - cut] or ordered
