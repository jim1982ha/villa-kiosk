"""The three statistical checks. Pure: they compute Findings and register
nothing — the brief-side registry imports THEM (see `_register_shipped`)."""

from . import level_anomaly  # noqa: F401
from . import sensor_health  # noqa: F401
from . import standby_creep  # noqa: F401
