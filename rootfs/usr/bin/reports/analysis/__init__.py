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

⚠️ IMPORTING A MODULE REGISTERS IT. `modules/__init__.py` imports each one, so
adding a file there is all it takes to make a module run — and forgetting to
import it is how a module comes to exist and never execute. That is the reason
the registry is keyed by name and sorted: a missing module is visible as an
absent skip line, not as silence.
"""

from .base import AnalysisModule, Finding, ModuleContext, dedup_key
from .registry import describe_skips, gate, register, registered, run_all

__all__ = ["AnalysisModule", "Finding", "ModuleContext", "dedup_key",
           "describe_skips", "gate", "register", "registered", "run_all"]
