"""The villa's critical devices: ONE list, the one its "critical devices offline" rule watches.

⚠️ OWNER, 2026-10-18 (architecture review, offline devices #2): four parts each had their own idea of "critical" — the
rule's list, the knowledge pack (locks, motors, scheduled assets), the reports (the security family) and the Kiosk
(none: every offline device red). Now every automation built from the blueprint below names them in its input; the
Kiosk reads the same rule (the agreement's `criticalDevices`, agent-contract.json — test_critical_devices pins them
equal). A villa without such a rule has no critical device: nothing is guessed.
"""
from __future__ import annotations

import os

#: The agreement's criticalDevices (agent-contract.json): the blueprint's file name without ".yaml", and its input.
BLUEPRINT = "critical_watchdog"
INPUT = "critical_entities"


def built_from(config: dict, blueprint: str = BLUEPRINT) -> bool:
    """An automation's config made from `blueprint` (its path's file name, in any folder)."""
    path = str(((config or {}).get("use_blueprint") or {}).get("path") or "")
    name = os.path.basename(path)
    return (name[:-5] if name.endswith(".yaml") else name) == blueprint


def critical_entities(configs) -> set[str]:
    """The entity ids every automation in `configs` built from the blueprint watches (a string or a list)."""
    out: set[str] = set()
    for c in configs or ():
        if not built_from(c):
            continue
        val = ((c.get("use_blueprint") or {}).get("input") or {}).get(INPUT)
        for e in ([val] if isinstance(val, str) else (val or [])):
            if isinstance(e, str) and "." in e:
                out.add(e)
    return out
