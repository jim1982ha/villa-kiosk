"""Every analysis module, imported so that it registers.

⚠️ ADDING A FILE HERE IS NOT ENOUGH — it must be imported below. A module that
is written but never imported never runs, and produces no skip line either,
because the registry has never heard of it. That is the one way a module can be
silently absent, which is what the whole gating design exists to prevent.
"""

from . import level_anomaly  # noqa: F401
from . import sensor_health  # noqa: F401
from . import standby_creep  # noqa: F401

__all__ = ["level_anomaly", "sensor_health", "standby_creep"]
