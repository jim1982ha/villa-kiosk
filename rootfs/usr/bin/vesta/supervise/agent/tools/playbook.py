"""`read_playbook` — TOOL-006. The content layer, fetched rather than carried.

⚠️ THIS TOOL IS WHY THE PLAYBOOK SET CAN BE LARGE AT ALL. Twenty-five bodies is
~30,000 tokens; at a fifteen-minute triage cadence that is the difference
between a plan that costs ~$14 a month and one that costs several hundred. The
descriptions sit in context (`playbooks.catalogue`), the bodies do not, and the
model spends a turn to open one only when it judges it relevant.

⚠️ THE NAME IS NOT A PATH, AND THE REFUSAL IS `playbooks.body`'s. This reads a
file chosen by a MODEL — the one tool argument in the system that selects a
filesystem object — so traversal is refused at the loader rather than here, and
this tool cannot be the place somebody forgets. `/data/reports-secrets.json` is
two directories from the learned tree.

⚠️ AN UNKNOWN NAME IS `not_found`, NEVER SILENCE. A model that asked for a
procedure and got an empty string will reason as though the procedure said
nothing — which is worse than knowing it is absent, because it looks like
expertise that declined to help.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.supervise.agent import playbooks as playbooks_mod
from vesta.supervise.agent.tools.base import BaseTool
from vesta.supervise.agent.tools.base import fail
from vesta.supervise.agent.tools.base import text


class ReadPlaybook(BaseTool):
    """One procedure's prose, by name."""

    name = "read_playbook"
    description = (
        "Read one of the procedures listed in your context, by name. Use it "
        "when you are investigating something that procedure covers — it "
        "tells you what to check and in what order, and what you may NOT "
        "conclude. It describes a class of equipment, never this villa: the "
        "facts about this property come from the read tools.")
    inputSchema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "name": {"type": "string",
                     "description": "A playbook name from your context."},
        },
        "required": ["name"],
    }
    #: ⚠️ REASON ONLY, AND TRIAGE GETS THE DESCRIPTIONS INSTEAD. Triage decides
    #: WHETHER to look closer, which the one-line descriptions already tell it;
    #: opening a body there would put ~1,200 tokens into the tier that runs ~96
    #: times a day to save nothing. The binding gate is `triage.TRIAGE_TOOLS`,
    #: which narrows by NAME — this line states the same intent where a reader
    #: of the tool will look for it.
    tiers: Sequence[str] = ("reason",)
    mode = "READ"

    def __init__(self, *, roots: Optional[Sequence[str]] = None,
                 reads_path: Optional[str] = None) -> None:
        self._roots = roots
        self._reads_path = reads_path

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        name = str(args.get("name") or "").strip()
        if not name:
            return [fail("invalid_args", "name a playbook from your context")]

        prose = playbooks_mod.body(name, roots=self._roots)
        # ⚠️ NOTED ON THE WAY OUT, AND ONLY WHEN A BODY WAS ACTUALLY SERVED
        # (2026-08-30). This is what lets a concern say which DOMAIN it is
        # about — water, electrical, security — without inventing seven agents
        # to carry the label. A refused name must not stamp a domain.
        if prose:
            playbooks_mod.note_for_run(name)
        if not prose:
            # ⚠️ THE AVAILABLE NAMES COME BACK WITH THE REFUSAL. A model that
            # mistyped can correct itself in the same turn instead of guessing
            # again, and a model that invented a name learns the set is closed.
            # ⚠️ EVERY ROOT, NOT THE SHIPPED ONE. A villa-specific procedure is
            # exactly as callable as a shipped one, and a refusal that listed
            # only the shipped set would teach the model that its own learned
            # playbooks do not exist.
            roots = self._roots or (playbooks_mod.LEARNED_ROOT,
                                    playbooks_mod.SHIPPED_ROOT)
            known = sorted({r["name"] for root in roots
                            for r in playbooks_mod.descriptions(root)})
            return [fail("not_found",
                         f"no playbook named {name!r}. Available: "
                         f"{', '.join(known) if known else 'none installed'}")]

        playbooks_mod.note_read(name, path=self._reads_path)
        return [text(prose)]


PLAYBOOK_TOOLS = (ReadPlaybook,)
