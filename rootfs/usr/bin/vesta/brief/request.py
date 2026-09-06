"""What a briefing is composed FROM, resolved once.

⚠️ FIVE COERCIONS, WRITTEN CHARACTER-IDENTICALLY AT BOTH CALL SITES, and a
fourteen-parameter function to receive them. To call `run_report` a caller had
to know that `settings` is the config's `modules` SLICE and not the config;
that `min_history_days` and `supervision_enabled` must therefore be threaded
separately; that `entry_id` must be the scheduler's idempotency key or history
rows stop being distinguishable; and that `actor` defaults to `"schedule"` and
has to be overridden by hand.

⚠️ THE COST IS ALREADY RECORDED IN THE TREE. `supervision_enabled` was omitted
at the proxy site for releases, so preview and manual sends ran a DIFFERENT
pipeline from the scheduler — every check declaring a `superseded_by` stood
down on one path and ran on the other. The fix was not a deepening: it was
`test_supervision_reaches_the_gate.py`, 143 lines that walk every `.py` under
`rootfs/usr/bin`, extract the argument text of every `run_report(` call and grep
it for the flag. That file's own docstring names the mechanism — "the third one
is written by somebody who copies the second, and copying is how this defect
was made".

⚠️ A CONSTRUCTOR IS THE ANSWER TO A COPIED CALL. There is one place to read the
config's shape, so a third caller cannot copy a fourth field wrongly: it does
not get the chance to.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


def _slice(value: Any) -> Mapping[str, Any]:
    """A config sub-document, or an empty one. ⚠️ NEVER `None`: every consumer
    treats a missing slice as "nothing configured", and a `None` reaching them
    is an AttributeError inside a background sweep."""
    return value if isinstance(value, dict) else {}


@dataclass(frozen=True)
class BriefRequest:
    """Everything `run_report` needs from the villa's stored configuration.

    ⚠️ NOT THE SCHEDULE AND NOT THE AUDIENCE. Those differ per brief and stay
    arguments; this is the part both callers were resolving identically.
    """

    settings: Mapping[str, Any]
    min_history_days: int
    supervision_enabled: bool
    module_failures: Mapping[str, Any]
    narration: Mapping[str, Any]

    @classmethod
    def from_config(cls, config: Mapping[str, Any],
                    agent_cfg: Mapping[str, Any],
                    state: Mapping[str, Any]) -> "BriefRequest":
        """Resolve one from the three documents every caller already holds.

        ⚠️ `supervision_enabled` IS THE MASTER SWITCH AND NOTHING ELSE. It used
        to read `agent_owns_analysis`, a second flag that existed only to
        override a stand-down that no longer exists.
        """
        return cls(
            settings=_slice(config.get("modules")),
            min_history_days=int(config.get("min_history_days") or 14),
            supervision_enabled=bool(agent_cfg.get("enabled")),
            module_failures=_slice(state.get("moduleFailures")),
            narration=_slice(config.get("narration")),
        )
