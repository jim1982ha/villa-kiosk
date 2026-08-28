"""VESTA Observe — the deterministic observation floor (Tier 1).

Lives beside `reports/` in `/usr/bin` (Dockerfile: `COPY rootfs /`), imported as
a plain package with no packaging and no install step, exactly as `reports` is.

⚠️ THIS TIER CONTAINS NO MODEL, NO NETWORK CALL OF ITS OWN, AND NO VILLA-SPECIFIC
CONSTANT. It records what happened and ranks what is unusual; it never decides
what MATTERS. That decision belongs to Tier 2/3, and keeping the boundary sharp
is what makes the whole redesign degrade honestly: when the interpretive tiers
are unreachable, everything here still runs and the villa still has a history.

Layering is strictly downward, same rule as `reports/__init__.py`:

    journal   <- reports.store, reports.log        (append material changes)
    salience  <- journal, reports.analysis.robust  (rank by novelty)
    snapshot  <- journal, salience                 (assemble the Villa Document)

⚠️ It may import FROM `reports`, never the other way, and never the proxy. The
direction matters: `reports` is the OLD pipeline and is being dismantled in PH-5,
so a dependency pointing back into it from here would have to be unpicked at
exactly the moment that package is least stable.

⚠️ DEGRADE, NEVER FAIL — inherited from `reports` and for the same reason. The
kiosk is a wall-mounted tablet in a villa. An observation floor that raises where
the proxy can see it is a 3D dashboard that stopped working because a journal
write failed.
"""

__all__ = ["journal"]
