"""Turning a report's facts into prose.

`deterministic.py` is the product and is always available. Phase 6 adds
provider-backed narrators beside it, each of which must degrade to this one on
any failure — see `base.py`.
"""

from .base import Narrator, ReportContext
from .deterministic import DeterministicNarrator

__all__ = ["Narrator", "ReportContext", "DeterministicNarrator"]
