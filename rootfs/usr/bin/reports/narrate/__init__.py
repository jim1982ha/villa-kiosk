"""Turning a report's facts into prose.

⚠️ `deterministic.py` IS GONE (TASK-073, 2026-08-27). Its 2,058 lines formatted
the blueprint-event taxonomy — zones, money columns, sparklines — and every
producer of those events was retired at the cutover. The brief's author is now
`agent/fallback.brief`, registered into the pipeline by the proxy at boot
(reports/ may not import agent/ — ARCH-003); a provider still narrates at most
ONE lead sentence per brief, and `style.inert` still makes the whole delivered
message markup-inert at the single point every path converges on.
"""

from .base import Narrator, ReportContext

__all__ = ["Narrator", "ReportContext"]
