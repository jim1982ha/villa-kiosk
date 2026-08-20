"""Does a change MATTER? Shared, because forgetting it produced two disasters.

⚠️ THIS EXISTS BECAUSE THE RULE WAS ROLLED OUT BY CALL SITE INSTEAD OF BY WHAT
IT APPLIES TO. `standby_creep` learned it the hard way — a true, confident 869%
that was worth eight watts — and the fix was made there and nowhere else. The
very next module then produced twelve findings on its first live run, topping
out at 715,700%, every one of them a ratio against a baseline of almost
nothing. Same defect, same property, one module later. This project has a
memory file about auditing the APPLICABLE SET rather than the existing callers,
and this is what ignoring it costs.

Two independent questions, and a module asking only the first is a module that
will cry wolf:

  IS IT BIG?      a ratio — scale-free, portable, and blind to whether it
                  matters at all
  IS IT REAL?     the absolute change against what this device actually does —
                  the part a ratio has thrown away

And one that only applies where a baseline is a claim about normality:

  IS THERE A NORMAL?  a device whose own history for this period varies
                      wildly has no baseline to depart from
"""

from __future__ import annotations

from typing import Optional, Sequence

from .robust import median, percentile, robust_sigma

#: The level a device reaches when it is actually doing its job.
ACTIVE_PERCENTILE = 0.80

#: ⚠️ DIMENSIONLESS. A change worth a person's attention is a material fraction
#: of what the equipment does when it works. Five percent of the working level.
DEFAULT_MIN_CHANGE_OF_ACTIVE = 0.05

#: ⚠️ HOW MUCH A DEVICE'S OWN HISTORY MAY WANDER BEFORE IT HAS NO "NORMAL".
#: A jacuzzi pump used on some Fridays and not others has a median Friday of
#: nearly zero and a spread as large as its median — every Friday it runs is
#: then thousands of percent above "normal", which is true and meaningless. If
#: a device's own same-period history varies by more than this relative to its
#: middle, there is nothing to be anomalous against.
DEFAULT_MAX_BASELINE_VARIATION = 0.60


def active_level(values: Sequence[float]) -> Optional[float]:
    """What this device does when it is working."""
    usable = [float(v) for v in values if v == v and v >= 0]
    return percentile(usable, ACTIVE_PERCENTILE) if usable else None


def is_material(change: float, values: Sequence[float],
                fraction: float = DEFAULT_MIN_CHANGE_OF_ACTIVE) -> bool:
    """Is `change` a meaningful amount for this device?

    Unknowable levels pass: a device we cannot characterise should not be
    silently suppressed, it should be judged on the other tests.
    """
    level = active_level(values)
    if level is None or level <= 0:
        return True
    return abs(change) >= fraction * level


def has_stable_baseline(
    samples: Sequence[float],
    limit: float = DEFAULT_MAX_BASELINE_VARIATION,
) -> bool:
    """Is there a "normal" here to depart from?

    ⚠️ THE GUARD THAT KILLS INTERMITTENT EQUIPMENT. A pump used on roughly one
    Friday in four has a Friday median near zero and a spread the size of its
    own range. Any Friday it runs is thousands of percent above that median —
    arithmetically correct, and not an anomaly at all: it is the device doing
    what it does. A baseline is a claim about normality, and equipment that
    behaves differently week to week has not made that claim.

    Zero spread passes: a perfectly consistent device has the most stable
    baseline there is, and rejecting it would invert the test.
    """
    centre = median(samples)
    spread = robust_sigma(samples)
    if centre is None or spread is None:
        return False
    if centre <= 0:
        # A median of zero means the device is usually OFF for this period.
        # There is no normal level to be above.
        return False
    return (spread / centre) <= limit
