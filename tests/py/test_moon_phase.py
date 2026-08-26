"""The drawn moon must show the fraction that is actually lit.

⚠️ IT SHOWED ITS OWN COMPLEMENT FOR THE WHOLE OF ITS EXISTENCE. The owner
reported a black disc on a night that was almost full moon. The astronomy was
never wrong — `getMoonIllumination` returns 0.973 waxing for that moment and
Home Assistant's own `sensor.moon_phase` said `waxing_gibbous` — so a 97.3%
moon was being drawn as a 2.7% sliver.

⚠️ ONE BOOLEAN. Canvas measures angles from +x with y DOWN, and
`anticlockwise: true` means DECREASING angle — so a sweep from π/2 to -π/2
anticlockwise passes through 0, the RIGHT side, not through π. The code's own
comment described the geometry correctly and then passed the flag that does the
opposite, which is why reading it never caught it.

⚠️ THIS TEST DOES ARITHMETIC, NOT RENDERING. There is no canvas here, and a
pin that re-implemented the drawing would only agree with itself. What it checks
is the CLOSED FORM of the area the path encloses, which is independent of any
drawing code: the path is a right semicircle plus an ellipse half-sweep of
half-width b = R·|1 − 2·lit|, so sweeping through the left ADDS πbR/2 and
through the right SUBTRACTS it. Only one of those yields `lit`.
"""

from __future__ import annotations

import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKY = os.path.join(ROOT, "src", "babylon", "NightSky.ts")

#: Every phase a villa actually sees, including the two degenerate ends.
FRACTIONS = (0.0, 0.05, 0.25, 0.5, 0.75, 0.973, 1.0)


def _winding_expression() -> str:
    """The `anticlockwise` argument the shipped `ctx.ellipse` call passes."""
    with open(SKY, encoding="utf-8") as handle:
        src = handle.read()
    code = "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("//"))
    found = re.search(r"ctx\.ellipse\([^;]*?,\s*(lit\s*[<>]=?\s*0\.5)\s*\)", code)
    assert found, ("the moon's terminator is no longer drawn by a single "
                   "ctx.ellipse whose winding is decided by `lit` against 0.5 "
                   "— this test can no longer see the decision it pins")
    return found.group(1).replace(" ", "")


def _drawn_fraction(lit: float, anticlockwise: bool) -> float:
    """What fraction of the disc the path encloses. R cancels, so take R = 1."""
    b = abs(1.0 - 2.0 * lit)
    half_disc = math.pi / 2.0
    half_ellipse = math.pi * b / 2.0
    area = half_disc - half_ellipse if anticlockwise else half_disc + half_ellipse
    return area / math.pi


def test_the_drawn_moon_shows_the_fraction_that_is_LIT() -> None:
    expr = _winding_expression()
    for lit in FRACTIONS:
        anticlockwise = lit < 0.5 if expr == "lit<0.5" else (
            lit > 0.5 if expr == "lit>0.5" else eval(  # noqa: S307
                expr, {"lit": lit}))
        drawn = _drawn_fraction(lit, bool(anticlockwise))
        assert abs(drawn - lit) < 1e-9, (
            f"a moon {lit:.3f} lit is drawn {drawn:.3f} lit — the winding flag "
            f"({expr}) is inverted, so every phase renders as its own "
            "complement and a full moon comes out black")


def test_the_INVERTED_flag_is_what_a_black_full_moon_looks_like() -> None:
    """⚠️ THE PIN PROVES ITSELF BY FAILING THE OLD CODE. Without this, a future
    reader cannot tell whether the assertion above is checking anything — and
    the whole reason the bug survived is that the arithmetic was never done."""
    assert abs(_drawn_fraction(0.973, True) - 0.027) < 1e-9, (
        "the closed form no longer reproduces the reported symptom, so it is "
        "not measuring what shipped")
    assert abs(_drawn_fraction(0.973, False) - 0.973) < 1e-9
