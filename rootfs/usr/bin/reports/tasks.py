"""Acknowledging a facility manager task from the kiosk.

⚠️ THE WHOLE FEATURE EXISTS BECAUSE THE ONLY ACK CHANNEL WAS HOME ASSISTANT.
The brief tells the Facility Manager what to do; the only way to say it was done
was to open HA's To-do panel and tick the item. On a wall-mounted tablet showing
VESTA that is a context switch to another application, so in practice tasks were
acknowledged late or not at all — and the noise counter, the "Followed up"
section and the blueprint's own re-arm all key on that tick.

⚠️ ONLY ITEMS THIS SYSTEM WROTE MAY BE COMPLETED, AND THAT IS THE SECURITY RULE
HERE RATHER THAN A TIDINESS ONE. The facility manager list is whatever `todo` entity the
operator pointed their blueprints at, and on the reference deployment that is
`todo.shopping_list` — the household's actual shopping list. Without the filter,
any authorized kiosk session could tick off somebody's groceries through an
endpoint whose stated purpose is maintenance. `ledger.TASK_PREFIX` is the
separator, and completion re-reads the list through the SAME parser that listed
it rather than trusting a uid the browser sent back: a client may name any uid it
likes, so the server must re-establish that the uid is one of ours.

⚠️ IT WRITES THROUGH A SERVICE CALL, NOT THROUGH THE BROWSER'S SERVICE GATE.
`_service_call_allowed` in the proxy governs what a BROWSER FRAME may reach and
`todo` is deliberately not in it — widening that list would hand every open tab
the ability to edit any todo list on the property. This runs server-side, on the
add-on's own token, against one entity and one uid it has just verified.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .hass import HassClient, HassUnavailable
from .ledger import todo_lists, todo_tasks
from .log import warn


async def open_tasks(hass: HassClient) -> List[Dict[str, str]]:
    """Every outstanding facility manager task, with what it takes to complete one."""
    lists = await todo_lists(hass)
    return await todo_tasks(hass, lists, status="needs_action")


async def complete(hass: HassClient, entity_id: str, uid: str) -> Dict[str, Any]:
    """Mark one facility manager task done. Refuses anything this system did not write.

    ⚠️ THE UID IS RE-VERIFIED, NEVER TRUSTED. It arrives from a browser, so the
    only thing it proves is that somebody typed it. Completion re-lists the
    entity through `todo_tasks` — the same parser, the same `TASK_PREFIX` filter
    — and proceeds only if the uid is in the result. A client naming a grocery
    item's uid gets a refusal, not a ticked box.
    """
    if not entity_id or not uid:
        return {"ok": False, "error": "entity_id and uid are required"}
    try:
        ours = await todo_tasks(hass, [entity_id], status="needs_action")
    except HassUnavailable as err:
        return {"ok": False, "error": f"could not read the task list ({err})"}

    match = next((t for t in ours if t.get("uid") == uid), None)
    if match is None:
        # ⚠️ THE SAME ANSWER FOR "NOT OURS" AND "NOT THERE". Distinguishing them
        # would confirm to a caller that some uid they guessed exists on the
        # list, which is exactly the probe this refusal is defending against.
        return {"ok": False, "error": "no such maintenance task on that list"}

    try:
        await hass.command(
            "call_service", domain="todo", service="update_item",
            target={"entity_id": entity_id},
            service_data={"item": uid, "status": "completed"})
    except HassUnavailable as err:
        warn(f"could not complete {uid} on {entity_id} ({err})")
        return {"ok": False, "error": f"Home Assistant refused the update ({err})"}
    return {"ok": True, "rule_id": match.get("rule_id", ""),
            "text": match.get("text", "")}
