"""read_ledger — TOOL-004. Counts and statuses. No free text, ever.

⚠️ A GUEST CAN WRITE INTO THIS STORE. The existing fault-report flow lets a
guest file up to three reports (`_fm_write_guard`), and those bodies land in the
same document this tool reads. Free text from that path reaching the model is an
injection vector into a reasoning run that can propose actions — so the DATA IS
NOT THERE rather than the filter being careful, which is this subsystem's
established rule and the reason `Item.subject` is dropped where rows are built
rather than filtered later.

⚠️ THE COST IS REAL AND ACCEPTED. The agent loses "what did the guest actually
say", which is sometimes the most informative sentence available. It is accepted
because the FM ticket is still visible in the UI to the person who can act on it,
and because the alternative is a text channel from an unauthenticated writer
straight into the layer that gates actuation.

⚠️ READ-ONLY, AND `ledger.py` MUST STAY THAT WAY. Writing from here would bypass
the per-store asyncio.Lock the proxy holds, and two writers to one JSON document
without that lock is a lost update nobody notices until a ticket disappears.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping

from agent.tools.base import BaseTool, data, fail
from reports import ledger as ledger_mod

#: ⚠️ AN ALLOW-LIST OF SHAPES, NOT A DENY-LIST OF KEYS. A deny-list has to be
#: updated every time the FM module gains a field, and the update that is
#: forgotten is the one that leaks. Everything here is a count or an enum.
COUNTED_STATUSES = ("open", "resolved")

#: Every key this tool may emit. The schema test reads THIS, so a
#: field added to the emitter without a decision here fails the build.
EMITTED_KEYS = ("present", "tickets_open", "tickets_resolved",
                "tickets_resolved_with_entity", "evidence_photos",
                "counts")


class ReadLedger(BaseTool):
    name = "read_ledger"
    description = (
        "The facility record as COUNTS and STATUSES: how many tickets are open "
        "and resolved, what the maintenance schedules say, how many tasks were "
        "completed. Deliberately carries no free text — ticket bodies can be "
        "written by guests, so they are not shown to you at all. If you need to "
        "know what a specific ticket says, tell the reader to open it.")
    inputSchema = {"type": "object", "properties": {}}
    mode = "READ"

    def __init__(self, source: Any = None) -> None:
        self._source = source

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        try:
            raw = self._source() if callable(self._source) else ledger_mod.read()
        except Exception as err:  # noqa: BLE001
            return [fail("unavailable", f"the facility record is unreadable: {err}")]
        if not isinstance(raw, Mapping):
            return [fail("unavailable", "the facility record is not a document")]
        summary = ledger_mod.summarise(dict(raw))
        # ⚠️ FIELDS NAMED ONE BY ONE. `dict(summary)` would forward whatever the
        # FM module adds next, which is how an allow-list becomes a deny-list
        # without anybody deciding to change it.
        counts = summary.get("counts")
        counts = counts if isinstance(counts, Mapping) else {}
        out: Dict[str, Any] = {
            "present": bool(summary.get("present")),
            "tickets_open": int(summary.get("tickets_open") or 0),
            "tickets_resolved": int(summary.get("tickets_resolved") or 0),
            "tickets_resolved_with_entity":
                int(summary.get("tickets_resolved_with_entity") or 0),
            "evidence_photos": int(summary.get("evidence_photos") or 0),
            # ⚠️ COERCED TO INT ONE BY ONE rather than forwarded. `counts` is
            # built by len() today, but forwarding the mapping wholesale is what
            # would carry a string through the day somebody adds one.
            "counts": {str(k): int(v) for k, v in sorted(counts.items())
                       if isinstance(v, int)},
        }
        return [data(out)]


LEDGER_TOOLS = (ReadLedger,)
