"""Analysis: turning a villa's own history into findings.

Layering, strictly downward:

    robust    <- pure statistics. Imports nothing.
    base      <- Finding, ModuleContext, the threshold order. Imports contracts.
    registry  <- gating and execution. Imports base.
    modules/  <- the questions themselves. Import base + robust.

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
