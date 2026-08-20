"""VESTA Reports — the scheduled-analysis backend.

Lives beside `supervisor-proxy.py` in `/usr/bin` (Dockerfile: `COPY rootfs /`),
so the proxy imports it as a plain package with no packaging, no PYTHONPATH and
no install step. See `supervisor-proxy.py`'s own sys.path note for why the
location is stated explicitly there rather than inferred from how the process
was started.

Layering is strictly downward and that is the point — this subsystem roughly
doubles the backend's surface, so nothing here may reach back into the proxy:

    contracts  <- the shared vocabulary. Imports NOTHING.
    log        <- imports nothing
    store      <- contracts, log
    (Phase 1+) hass, stats, ledger, discovery, schedule, pipeline, narrate

The proxy imports FROM here; nothing here imports the proxy. A `from proxy
import ...` anywhere under this package is a circular import waiting to happen
and, worse, would let a reports bug take the kiosk's own auth path down.

⚠️ DEGRADE, NEVER FAIL. The kiosk is a wall-mounted tablet in a villa. A
reports subsystem that raises where the proxy can see it is a 3D dashboard that
stopped working because a weekly summary could not be generated. Every entry
point here either returns a degraded value or logs and swallows.
"""

__all__ = ["contracts", "log", "store"]
