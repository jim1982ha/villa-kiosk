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


#: The critical rules' "When this rule runs" choice (owner, 2026-10-20): the blueprints' input, the stand-alone
#: rules' variable; "always" when a rule does not say.
RUN_WHEN_INPUT, RUN_WHEN_VARIABLE, RUN_WHEN = "run_when", "vg_run_when", ("always", "empty", "occupied")


def run_when(config: dict) -> str:
    """When a rule runs, as its configuration says: "always", "empty" (only while the villa is empty) or "occupied"
    (only while someone is in) — its blueprint input, else its own variable; anything else is "always"."""
    c = config or {}
    v = ((c.get("use_blueprint") or {}).get("input") or {}).get(RUN_WHEN_INPUT)
    if v is None:
        v = (c.get("variables") or {}).get(RUN_WHEN_VARIABLE)
    return v if v in RUN_WHEN else "always"


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
