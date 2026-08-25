"""Shadow mode: run everything, deliver nothing. ARCH-016, TASK-049/050.

⚠️ THE CLAIM THAT THE AGENT OUTPERFORMS THE RULES IS A PREDICTION UNTIL IT IS
MEASURED, and this is the measurement. Tiers 1–3 run for a full period beside
the existing blueprints, producing concerns that are RECORDED AND NOT
DELIVERED. Then the diff: what did the rules catch that the agent missed, and
what did the agent catch that no rule could express?

⚠️ NO UNSOLICITED DELIVERY. Not a push, not a brief line, not a kiosk badge —
nothing the villa decides by itself to say.

⚠️ AND THAT IS NARROWER THAN "NOTHING", WHICH IS WHAT THIS SAID UNTIL
/dry-audit CHECKED IT. The claim was that `suppressed()` is "the one predicate
every delivery path asks", and ZERO delivery paths asked it — `chat.py` sends an
answer and a decline, `reply.py` calls `deliver`, and none of the three consults
this module. The code is right and the sentence was wrong: an answer to a
question a human just typed is not the villa deciding to speak, and suppressing
it would make chat look broken while an operator waited for a shadow period to
end.

So the rule is: **a reply to a direct question is delivered; anything the agent
originates is not.** The unsolicited paths — routing a concern to a phone,
composing a brief — arrive in Phase 4, and `test_shadow.py` pins that each one
asks `suppressed()` as it is added, because the reminder cannot be a comment
nobody reads at the moment they are written.

⚠️ THE EXISTING PIPELINE IS UNTOUCHED AND MUST STAY SO. The blueprints keep
firing, the collector keeps recording, the briefs keep going out exactly as
they did — the whole value of a shadow period is that it costs the owner
nothing if the agent is wrong. A change to `reports/` in service of this file
would forfeit that.

⚠️ AND SHADOW IS THE SHIPPED DEFAULT. Every other switch here defaults off so
that nothing happens; this defaults ON so that when the agent IS switched on,
its first period is observed rather than delivered. Turning it off is the
cutover, and it should be a decision somebody makes after reading a diff.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agent import config as agent_config
from reports.log import log, swallow

#: Where shadow-mode concerns are kept, separate from live ones.
#: ⚠️ A SEPARATE FILE, NOT A FLAG ON THE ROW. A shadow concern that shared the
#: store would be one predicate away from being rendered on the Cockpit, and
#: "nothing may be delivered" would depend on every reader remembering to
#: filter. Two files cannot be confused by forgetting.
from agent.concerns import Concern  # noqa: E402


def suppressed(config: Optional[Mapping[str, Any]] = None) -> bool:
    """Must this deployment deliver NOTHING right now?

    ⚠️ ASKED AT EVERY DELIVERY POINT, NEVER CACHED. Shadow mode is what an
    operator reaches for when something is going wrong, and a switch that needs
    a restart is a switch that does not help then.
    """
    # ⚠️ ONE KEY SINCE 2.756.0. This read `shadow`, a boolean beside
    # `investigate_mode`'s enum — two stored values for one three-position
    # choice the UI had already merged. `config.view` migrates an older file, so
    # a villa that never rewrites its config keeps meaning what it meant.
    return str(agent_config.view(config).get("mode")) == "observe"


# ⚠️ THE DIFF WAS DELETED IN 2.756.0 AND ITS QUESTION IS RECORDED HERE, because
# the answer is the only part still worth anything. `DiffRow`, `Diff`,
# `_subjects`, `diff()` and `report()` compared what the agent concluded during
# a shadow period against what the blueprint layer concluded over the same one,
# so an owner could decide whether retiring the automations was safe.
#
# That decision is TAKEN. The automations are retired, so one side of the
# comparison is permanently silent and the diff can never produce a comparison
# again — it could only ever print "N things your automations caught and the
# villa did not" about a period in which nothing was listening on that side.
# An instrument whose question has closed does not stay neutral: it keeps
# printing a number somebody eventually reads as meaning something.
#
# What it concluded, kept so nobody re-derives it: the comparison was never able
# to show a match, because a concern raised about free text is keyed on
# `sha256("topic:"+text)` while the rules side always hashes an entity id. That
# defect is fixed (`triage.Escalation.entity_id`, `runtime._seeded`) and the fix
# stands on its own — it is what makes a concern nameable, not just diffable.
#
# SHADOW MODE ITSELF STAYS. `suppressed()` below is the run mode "observe only"
# — run everything, deliver nothing — which is a live feature and the first
# position of the one mode switch. Deleting the diff does not touch it.

def recorded() -> List[Dict[str, Any]]:
    """Every concern this shadow period stored, as dicts. Never raises.

    ⚠️ THE SAME REDIRECT `record()` USES, AND FOR THE SAME REASON. The shadow
    store is a different FILE, and the module that owns concerns is the only
    thing that should know their document's shape — the proxy's first version
    of the diff route read the file itself and did `stored.get("concerns")`,
    which `test_store_envelope` flagged as an envelope unwrap. It was not one
    (the store's document genuinely has that key, and the wire envelope happens
    to share the word) but the test cannot tell those apart BY NAME, and neither
    can a reader. Asking `concerns.read()` removes the question: one parser, and
    a second consumer of the shadow store cannot drift from the first.

    ⚠️ AND IT DOES NOT CHECK `suppressed()`. `record` refuses outside a shadow
    period because writing then would confuse two paths; READING is how a
    finished period is judged, which by definition happens after shadow mode
    has been turned off.
    """
    from agent import concerns as concerns_mod

    original = concerns_mod.CONCERNS_FILE
    try:
        concerns_mod.CONCERNS_FILE = shadow_path(original)
        return list(concerns_mod.read())
    except Exception as err:  # noqa: BLE001 - degrade, never fail
        swallow("could not read the shadow concern store", err)
        return []
    finally:
        concerns_mod.CONCERNS_FILE = original


def shadow_path(live: str) -> str:
    """The shadow twin of a store path.

    ⚠️ COMPUTED FROM THE EXTENSION, NOT BY REPLACING A KNOWN FILENAME. The
    first version did `live.replace("concerns.json", "concerns-shadow.json")`,
    which SILENTLY DID NOTHING whenever the base name differed — a test
    fixture, a renamed store — and the shadow concern landed in the LIVE store
    with no error. A string replace that finds nothing is not a failure; it is
    a no-op that looks like success, which is the worst kind of path handling
    in a function whose whole job is to keep two things apart.
    """
    root, _, ext = str(live).rpartition(".")
    return f"{root}-shadow.{ext}" if root else f"{live}-shadow"


def record(concern: Concern, *, config: Optional[Mapping[str, Any]] = None
           ) -> Tuple[bool, str]:
    """Store a concern WITHOUT delivering it. Returns `(recorded, reason)`.

    ⚠️ IT REFUSES WHEN SHADOW IS OFF, rather than falling through to the live
    store. A caller reaching for this outside a shadow period has confused the
    two paths, and quietly doing the right thing instead would hide that.
    """
    if not suppressed(config):
        return False, "not in shadow mode; use the live concern store"
    from agent import concerns as concerns_mod

    original = concerns_mod.CONCERNS_FILE
    try:
        concerns_mod.CONCERNS_FILE = shadow_path(original)
        stored, reason = concerns_mod.raise_concern(concern)
    finally:
        concerns_mod.CONCERNS_FILE = original
    if stored:
        log(f"shadow: recorded {stored.id}, delivered nothing")
    return bool(stored), reason
