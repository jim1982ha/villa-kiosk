"""What this property declares as its meters — read from Home Assistant.

⚠️ THE VILLA ALREADY SAID THIS, AND THE AGENT WAS NOT LISTENING. Asked "how much
is the house using right now", the agent answered "I don't have access to a
global sensor", then spent its whole turn budget searching entity by entity and
ran the search tool out of tokens. Reported from the villa 2026-09-18. The
property has had a whole-house meter throughout: it is the GRID SOURCE of Home
Assistant's own Energy dashboard, which the owner configured when they set the
dashboard up.

⚠️ SO THIS DERIVES, IT NEVER ASSUMES. Not one entity id, meter name, phase count
or circuit appears here or anywhere downstream — the shape is read from
`energy/get_prefs` at runtime, so a villa with one meter, three phases or none
at all is handled by the same code. That is the first hard rule, and it is also
the only way this can be true a year from now: the owner re-wires the dashboard
and the agent follows, with no release.

⚠️ AND IT IS HOME ASSISTANT'S OWN FEATURE, NOT A SECOND ONE. The Energy
dashboard is where a householder ALREADY states which statistic is the grid and
which circuits hang off it, including `included_in_stat` so the dashboard does
not double-count. Inventing a parallel "which sensor is the main meter?" setting
would be a second place for the same fact to be wrong.

⚠️ `energy/get_prefs` IS WEBSOCKET-ONLY. The prefs live in `.storage/energy` and
are not exposed over REST at all, which is why this takes a `HassClient` rather
than the `rest_get` every other reader here uses.
"""

from __future__ import annotations

from typing import Any, List, Mapping, Optional, Sequence, Tuple

from vesta.adapters.hass import HassClient


#: A device-consumption entry naming this key is a SUB-circuit: the statistic it
#: names already contains this one, so the dashboard subtracts it rather than
#: adding it. That makes the key the honest test for "is this a top-level meter"
#: — the entries WITHOUT it are what the property is metered by, and summing
#: those is the only sum that is not double counting.
_PARENT_KEY = "included_in_stat"

#: The instantaneous (power) statistic paired with a cumulative (energy) one.
#: Optional in HA's schema — an entry with energy only can be reported over a
#: window but has no "right now", and this module never invents one for it.
_RATE_KEY = "stat_rate"


class EnergyLayout:
    """One property's declared metering, entity ids only — no refs, no values.

    Deliberately dumb: minting handles is the tool's job (it owns the RefTable)
    and reading states is the source's, so this stays testable against a
    prefs payload alone.
    """

    def __init__(self) -> None:
        #: Cumulative grid statistics — the property's import meter(s).
        self.grid_energy: List[str] = []
        #: Top-level instantaneous statistics: the property's own meters.
        self.meters: List[str] = []
        #: (circuit, the meter it is already counted inside).
        self.circuits: List[Tuple[str, str]] = []

    @property
    def configured(self) -> bool:
        """⚠️ TRUE ONLY IF SOMETHING IS ACTUALLY DECLARED. A villa whose owner
        never set the Energy dashboard up has an empty prefs blob, and the
        caller must say "this property has not declared a meter" rather than
        "this property uses nothing" — the `log_reader` rule, again."""
        return bool(self.grid_energy or self.meters or self.circuits)


def parse(prefs: Optional[Mapping[str, Any]]) -> EnergyLayout:
    """Energy-dashboard preferences into a layout. Pure, so it is testable
    against a captured payload without a Home Assistant."""
    out = EnergyLayout()
    if not isinstance(prefs, Mapping):
        return out

    sources = prefs.get("energy_sources")
    for src in sources if isinstance(sources, Sequence) else []:
        if not isinstance(src, Mapping):
            continue
        # ⚠️ GRID ONLY. Solar and battery sources are real and are NOT what the
        # house is drawing — adding them would answer a different question with
        # a bigger number, which is the worst kind of wrong here.
        if str(src.get("type") or "") != "grid":
            continue
        stat = str(src.get("stat_energy_from") or "")
        if stat:
            out.grid_energy.append(stat)

    devices = prefs.get("device_consumption")
    for dev in devices if isinstance(devices, Sequence) else []:
        if not isinstance(dev, Mapping):
            continue
        rate = str(dev.get(_RATE_KEY) or "")
        if not rate:
            continue
        parent = str(dev.get(_PARENT_KEY) or "")
        if parent:
            out.circuits.append((rate, parent))
        else:
            out.meters.append(rate)
    return out


async def read(session: Any) -> EnergyLayout:
    """Fetch and parse this property's energy preferences."""
    async with HassClient(session) as hass:
        prefs = await hass.command("energy/get_prefs")
    return parse(prefs if isinstance(prefs, Mapping) else None)


def total_of(values: Sequence[Optional[float]]) -> Optional[float]:
    """The property's instantaneous draw, or None if it cannot be stated.

    ⚠️ ALL OR NOTHING, ON PURPOSE. A meter that is unavailable makes the SUM
    unavailable — a partial total is a smaller number that looks exactly like a
    real one, and the villa reporting "1.2 kW" while a third of its metering is
    offline is precisely the confident-wrong answer the evidence rule exists to
    stop. Returning None lets the caller say "one meter is not reporting".
    """
    if not values:
        return None
    if any(v is None for v in values):
        return None
    return float(sum(v for v in values if v is not None))
