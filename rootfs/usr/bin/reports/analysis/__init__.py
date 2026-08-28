"""Analysis: turning a villa's own history into findings.

Layering, strictly downward:

    robust    <- pure statistics. Imports nothing.
    base      <- Finding, ModuleContext, the threshold order. Imports contracts.
    registry  <- gating and execution. Imports base.
    modules/  <- the questions themselves. Import base + robust.

Leaf utilities of the parent package (`log`, `text`) are exempt: they import
nothing from here, so reaching for one cannot make a cycle. Anything with a
DEPENDENCY on this package — `aggregate`, `pipeline`, `narrate` — is upward and
may not be imported from inside it. That is why `readable_label` lives in
`reports.text` rather than in `aggregate`, where it was written: `registry.gate`
names a blueprint in prose and needs it (2.568.0).

⚠️ THE REGISTRY REGISTERS THE MODULES (TASK-115, 2026-08-28 — it used to be
the other way: each module self-registered at import, which made the three
SHARED statistical modules import a BRIEF one, the single upward edge in the
layer lattice). Adding a module is one line in `registry._register_shipped`,
deliberately; a missing module is still visible as an absent skip line, not
as silence, because the registry stays keyed by name and sorted.
"""

from .base import AnalysisModule, Finding, ModuleContext, dedup_key
from .registry import describe_skips, gate, register, registered, run_all

__all__ = ["AnalysisModule", "Finding", "ModuleContext", "dedup_key",
           "describe_skips", "gate", "register", "registered", "run_all"]
