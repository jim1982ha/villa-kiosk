"""The approval queue must be emptiable, because it cannot empty itself.

⚠️ FOUND ON THE REFERENCE VILLA WITH TWENTY-FOUR ITEMS IN IT. An
`awaiting-approval` row is written in exactly one place — `reason.follow_up`'s
`not auto(config)` arm — which is reachable only in "Flag & Ask" mode (stored `ask`). And an
item leaves `audit.pending_escalations` only when a row carrying its OWN run id
is settled. So the moment a villa moves to Observe or Live, the queue freezes:
nothing new can enter it and nothing can drain it, for the life of the audit.

The owner's queue held four "Main Power Phase B", four "Onsen Pump" and five
"Facility record" rows — the same subjects re-escalated on successive passes,
each queuing a fresh row, none of which the current mode can ever revisit.

⚠️ DISMISS ONLY, AND THAT IS THE PROPERTY WORTH PINNING. One investigation is a
frontier-model run; at the reference villa's own figure a twenty-four item
"investigate all" is roughly a full day's ceiling in one press, with no undo.
Dismissing spends nothing.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# ⚠️ MOVED IN 2.780.0. `AgentQueue` was deleted when the flags were merged into
# the checks that raised them; the bulk action came across to `RecentChecks`
# with it, because the reason for it is unchanged — a villa left in Flag & Ask
# still accumulates one waiting flag per check.
QUEUE = os.path.join(ROOT, "src", "components", "agent", "RecentChecks.tsx")
REASON = os.path.join(ROOT, "rootfs", "usr", "bin", "vesta", "supervise", "agent", "reason.py")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _code(src: str) -> str:
    """Comments stripped as blocks then as lines — prose is not code."""
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return "\n".join(l for l in src.splitlines()
                     if not l.strip().startswith("//"))


def test_the_queue_can_be_emptied_in_one_action() -> None:
    code = _code(_read(QUEUE))
    assert "cancelAll" in code, (
        "there is no whole-list action, so a queue that cannot drain itself "
        "needs one press per item — twenty-four on the reference villa")


def test_the_bulk_action_never_STARTS_investigations() -> None:
    """⚠️ THE ONE-WAY DOOR. A bulk approve is a day's budget in a single press
    with nothing to undo it; a bulk dismiss spends nothing and anything still
    true is flagged again by the next check."""
    code = _code(_read(QUEUE))
    body = code[code.index("const cancelAll"):]
    body = body[:body.index("}, [flags, pending, load]);")]
    assert '"dismiss"' in body and '"approve"' not in body, (
        "the whole-list action can start investigations — one press would "
        "spend a frontier run per queued item")


def test_it_reuses_the_single_item_path_rather_than_a_batch_route() -> None:
    """⚠️ ONE AUTHORITY OVER ONE DECISION. A batch endpoint would be a second
    place that decides who may settle an escalation, and the one nobody tests."""
    # ⚠️ SCOPED TO THE BULK FUNCTION, NOT THE FILE. This asserted `Promise.all`
    # appeared nowhere in the source, which was true while the file did one
    # thing and became wrong the moment the component also LOADED two lists —
    # where running two independent reads in parallel is correct. A whole-file
    # ban on a construct is a rule about the wrong unit: what must be sequential
    # is the WRITES, because each appends to a read-modify-write JSON store.
    code = _code(_read(QUEUE))
    body = code[code.index("const cancelAll"):]
    body = body[:body.index("}, [flags, pending, load]);")]
    assert "decideEscalation(ids[i]" in body, (
        "the bulk path does not go through `decideEscalation`, so it is a "
        "second route past the server's per-item authorisation and audit")
    assert "Promise.all" not in body, (
        "the dismissals run concurrently; each writes an audit row through a "
        "read-modify-write JSON store, which loses rows under concurrency")


def test_only_ask_mode_can_ever_fill_this_queue() -> None:
    """⚠️ THE FACT THAT MAKES THE QUEUE A DEAD END, pinned so the diagnosis is
    not re-derived. If a second writer of AWAITING ever appears, the reasoning
    above stops holding and this test says so."""
    reason = _read(REASON)
    assert reason.count("verdict=audit_mod.AWAITING") == 1, (
        "AWAITING is written somewhere new; the queue's 'only Flag & Ask "
        "fills this' diagnosis no longer holds")
    assert 'return str(agent_config.view(config).get("mode")) in ("live", "observe")' \
        in reason, ("`auto` no longer names the two modes that investigate, so "
                    "which mode fills the queue has changed")
