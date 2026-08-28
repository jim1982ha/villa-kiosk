"""A comment naming a screen label is a claim about the screen.

⚠️ THE SAME RENAME HAS NOW BEEN ROLLED OUT BY CALL SITE THREE TIMES. On
2026-08-28 the villa's three supervision modes were renamed at the owner's
instruction — Flag & Ask → **Ask first**, Investigate & Log Only → **Alert
only**, Investigate & Log +Escalation → **Alert & chase**. The stored ids
(`ask`/`observe`/`live`) did not move, which is correct and is exactly what
made the rename easy to under-apply:

  * the UI was renamed that day;
  * 2.830.0 corrected four OWNER-RULING records, which quote the old name
    deliberately and say so;
  * and six comments describing CURRENT behaviour kept the retired labels
    until /dry-audit found them — "it is FALSE in Flag & Ask", "raised under
    Investigate & Log Only". A reader hunting for those words on screen finds
    nothing, because nothing says them any more.

⚠️ SO THE RULE IS NOT "NEVER MENTION THE OLD NAME". Quoting it is how the
rulings stay verbatim and how a rename records itself. The rule is that a
mention must SAY it is history — and this pins that, rather than pinning an
absence which would forbid the records too.

⚠️ AND THE LIVE LABELS ARE DERIVED FROM THE CONTROL, never restated here. If a
fourth rename happens, the mode picker is the one place it lands and this file
follows it without being edited.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List, Set

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: Labels these modes used to carry. ⚠️ A CLOSED HISTORICAL SET, not something
#: to derive: it can only grow when a rename happens, and a rename is exactly
#: when a person should be adding to it.
RETIRED = ("Flag & Ask", "Investigate & Log Only", "Investigate & Log +Escalation")

#: Words that mark a mention as history rather than as a description of now.
HISTORY = ("renamed", "then called", "at the time", "when this was written",
           "used to", "formerly", "was called", "then \"")


def _sources() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for root, _dirs, files in os.walk(REPO):
        if any(p in root for p in (".git", "node_modules", "dist", "__pycache__")):
            continue
        for name in files:
            if name.endswith((".ts", ".tsx", ".py")):
                path = os.path.join(root, name)
                try:
                    with open(path, encoding="utf-8") as handle:
                        out[os.path.relpath(path, REPO)] = handle.read()
                except (OSError, UnicodeDecodeError):
                    continue
    return out


def test_the_LIVE_mode_labels_are_still_the_ones_the_control_offers() -> None:
    """⚠️ THE VACUOUS-PASS GUARD, AND IT IS THE IMPORTANT HALF. If the picker is
    rewritten and this cannot find it, every assertion below compares against an
    empty set and reports health forever."""
    panel = _sources()["src/vesta/supervise/components/AgentTuningPanel.tsx"]
    live = set(re.findall(r'\{ id: "(?:ask|observe|live)", text: "([^"]+)"', panel))
    assert len(live) == 3, (
        f"found {sorted(live)} — the mode picker moved, so this file can no "
        f"longer tell a live label from a retired one")
    for retired in RETIRED:
        assert retired not in live, (
            f"{retired!r} is on screen again; it is listed here as retired")


def test_a_RETIRED_label_only_appears_as_HISTORY() -> None:
    """⚠️ CHECKED ON THE LINE AND THE TWO ABOVE IT, because a ruling record puts
    its marker on the preceding line as often as on the same one. Anything
    further away is not a marker a reader would connect to the mention."""
    offenders: List[str] = []
    for path, code in _sources().items():
        if path.startswith("tests/"):
            continue          # this file names them all, by definition
        lines = code.splitlines()
        for n, line in enumerate(lines):
            if not any(r in line for r in RETIRED):
                continue
            window = " ".join(lines[max(0, n - 2):n + 1]).lower()
            if any(marker in window for marker in HISTORY):
                continue
            offenders.append(f"{path}:{n + 1}: {line.strip()[:72]}")
    assert not offenders, (
        "these name a retired mode label as though it were current — a reader "
        "looking for the words on screen will not find them:\n  "
        + "\n  ".join(offenders))
