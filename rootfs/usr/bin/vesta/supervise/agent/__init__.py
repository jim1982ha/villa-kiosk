"""VESTA Agent — the reasoning layer (Tiers 2 and 3) and its boundary.

⚠️ THE VOCABULARY COMES FIRST, BEFORE ANYTHING IMPLEMENTS IT. This package
starts with `contracts.py` for the same reason `reports` did: every later module
either produces or consumes these records, and a shape invented twice is a shape
that disagrees with itself. `contracts` imports nothing.

Layering, strictly downward, and the direction is deliberate:

    contracts   <- imports NOTHING
    tools/base  <- contracts
    tools/*     <- tools.base, observe.*, reports.* (read-only)
    policy      <- contracts                     (the authorization boundary)
    llm/*       <- contracts                     (the provider seam)
    runtime     <- everything above

⚠️ `agent` MAY IMPORT `observe` AND `reports`. Neither may import `agent`, and
nothing here may import the proxy. `reports` is the pipeline being dismantled in
PH-5, so a dependency pointing back into it from here would have to be unpicked
at exactly the moment that package is least stable.

⚠️ THE TOOL PROTOCOL IS MCP-SHAPED FROM DAY ONE (ADR-006), and that is not
premature: it is the EXTRACTION SEAM. A bespoke protocol here would be a
self-inflicted migration the first time anything outside this process — a
relocated agent, a second villa's console, a desktop client — needs to reach
this villa's knowledge. Building it in the shape it will eventually be published
in costs nothing now.

⚠️ DEGRADE, NEVER FAIL — inherited from `reports` and `observe`. The kiosk is a
tablet on a wall. An agent that raises where the proxy can see it is a 3D
dashboard that stopped working because a model was unreachable.
"""

__all__ = ["contracts"]
