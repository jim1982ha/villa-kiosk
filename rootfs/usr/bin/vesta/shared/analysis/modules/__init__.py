"""The shipped checks. Pure: they compute Findings and register nothing — the
brief-side registry imports THEM (see `_register_shipped`). ⚠️ This said "the
four statistical checks" until `rule_calibration` arrived, which is not
statistical at all; count them, do not quote this line."""

from . import level_anomaly  # noqa: F401
from . import level_shortfall  # noqa: F401
from . import rule_calibration  # noqa: F401
from . import sensor_health  # noqa: F401
from . import standby_creep  # noqa: F401
