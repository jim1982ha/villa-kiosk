"""A slow-moving fact about this villa, re-read on a clock.

⚠️ THIS SKELETON WAS WRITTEN FOUR TIMES, AND THE PROSE HAD GIVEN UP SAYING SO.
`sources.refresh_layout`, `sources.refresh_capabilities`,
`sources.refresh_measures` and `upstream.refresh` each answered the same
question — "re-read a slow-moving villa fact if the stored answer is stale, and
never let a failure erase what we knew" — and each stated it from scratch. Their
own comments read "the same sentence `refresh_layout` records", "the same rule
as `refresh_layout` and `refresh_capabilities`", "exactly as
`refresh_capabilities` and `refresh_layout` do"; the call site in `scheduler`
carried three more blocks saying some version of "THE SAME PLACE, THE SAME
CADENCE, AND THE SAME REASON IT IS HERE".

Two costs the transcription had already produced:

  • Three of the four read `CAPABILITY_MAX_AGE_H`, so the constant governing the
    room list and the measurement classes is named after capabilities, while
    `upstream` declared its own identical `CATALOGUE_MAX_AGE_H = 24`. Four
    surveys, two constants, one number.
  • Coverage tracked the duplication rather than the risk. `refresh_capabilities`
    and `refresh_layout` had their stale-check and empty-refusal pinned;
    `refresh_measures` had NEITHER, and it is the one whose failure re-tunes an
    owner's Ratings by making every kind unclassifiable.

⚠️ THERE IS NO `stored()` READER HERE, AND THAT IS DELIBERATE. I wrote one and
`test_reachability` refused it: nothing called it, because each survey's reader
already knows the shape of its own answer and the `None`-vs-`{}` distinction it
cares about (`absent_capability_sentences` is meticulous about exactly that).
A shared reader would have had to grow a flag per caller to be useful.

⚠️ WHAT IS *NOT* HERE IS THE POINT. Each survey keeps its own fetch, its own
shaping, and its own "is this answer real" predicate — because those are the
parts that genuinely differ, and folding them in is how a shared helper starts
growing flags. This owns the CLOCK and the STORE, nothing else.
"""

from __future__ import annotations

import time
from typing import Any, Final, Mapping, Optional

from vesta.adapters import store
from vesta.adapters.log import swallow

#: How long any surveyed fact stays fresh. ⚠️ ONE NUMBER FOR ALL FOUR SURVEYS.
#: It was `CAPABILITY_MAX_AGE_H` in three of them — a constant named after one
#: survey governing three — and an identical `CATALOGUE_MAX_AGE_H` in the
#: fourth. They were always the same 24; now they are the same constant.
MAX_AGE_H: Final[int] = 24

#: The key every survey stores its timestamp under.
AT_KEY: Final[str] = "at"


def is_fresh(path: str, *, now: Optional[float] = None,
             max_age_h: Optional[int] = None) -> bool:
    """Is the stored answer young enough to keep?

    ⚠️ A MISSING OR UNREADABLE FILE IS NOT FRESH, so a villa that has never been
    surveyed surveys on the next pass rather than never.
    """
    stamp = time.time() if now is None else float(now)
    hours = MAX_AGE_H if max_age_h is None else max_age_h
    raw = store.read_json(path, {})
    at = float(raw.get(AT_KEY) or 0) if isinstance(raw, Mapping) else 0.0
    return stamp - at < max(1, hours) * 3600.0


def save(path: str, payload: Mapping[str, Any], *,
         now: Optional[float] = None) -> bool:
    """Record a survey, stamped. Never raises; a failed write is not a failed
    pass."""
    stamp = time.time() if now is None else float(now)
    try:
        store.write_json(path, {AT_KEY: stamp, **dict(payload)})
        return True
    except Exception as err:  # noqa: BLE001 - a survey is not worth a failed pass
        swallow("could not record a survey of the villa", err)
        return False
