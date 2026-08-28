"""The agent's own loops, started with one call. TASK-115 step 5, REQ-063.

⚠️ THIS IS THE EXPORT'S ENTRYPOINT SEAM. The add-on's proxy used to create the
agent's background tasks inline among its own — which was fine for the add-on
and made "run the agent elsewhere" mean re-deriving which of five
`create_task` calls belong to it. Now the split is a fact of the code:

    supervise/service.start(...)   the agent: observation cycle, triage clock,
                                   chase clock, and the chat/button event
                                   consumer's loop (the collector)
    the host's own tasks           the briefing pipeline — NOT here, because
                                   an exported agent ships without `brief`

An external deployment's whole main() is: configure the adapters
(`vesta.adapters.hass.configure`, `vesta.adapters.store.configure`), build a
ClientSession, call `start`, mount `api.routes()` (step 6), run forever.

⚠️ THE COLLECTOR IS THE AGENT'S, NOT THE BRIEFING'S, AND THAT WAS DECIDED BY
WHAT IT LISTENS TO. Since TASK-074 its subscription is the chat types only —
a typed message and a button press, both consumed by the agent. The briefing
reads the collector's STORE (coverage, online_since) but does not need the
socket held open; the agent goes deaf without it.

⚠️ TASKS ARE RETURNED, NEVER ORPHANED. The caller owns cancellation — the
proxy's on_cleanup names every task it must cancel, and a dict return is what
lets it keep doing that without this module knowing about aiohttp shutdown
semantics.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Dict, Mapping, Optional

from vesta.supervise.agent import scheduler as agent_scheduler
from vesta.supervise.observe import cycle as observe_cycle
from vesta.adapters import collect as collect_mod


def start(session: Any,
          config_source: Callable[[], Mapping[str, Any]],
          on_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
          ) -> Dict[str, "asyncio.Task[Any]"]:
    """Start every loop the agent needs. Returns them, named, for cancellation.

    `config_source` is called per pass/tick, never captured — the same rule the
    proxy has always followed so a settings change lands on the next cycle
    without a restart. `on_event` is the chat/button consumer; the HOST supplies
    it because building it needs the provider key and the stored config, which
    are the host's to hold (in the add-on it is `_chat_dispatch`).

    ⚠️ FOUR TASKS, AND EACH COMMENT BELOW TRAVELLED FROM THE PROXY WITH ITS
    TASK — they record defects paid for, not intentions.
    """
    tasks: Dict[str, "asyncio.Task[Any]"] = {}

    # The event socket. Chat types only since TASK-074; the agent's inbound
    # half (a typed message, a button press) rides it, so the agent goes deaf
    # without it — which is why it starts here and not with the briefing.
    tasks["collector"] = asyncio.create_task(
        collect_mod.run_forever(session, on_event=on_event))

    # The observation floor (Tier 1). Polls on a cadence read from config, so
    # it cannot starve the loop the way a tight subscription could.
    tasks["observe_cycle"] = asyncio.create_task(
        observe_cycle.run_forever(session))

    # ⚠️ THE TRIAGE CLOCK, AND WITHOUT IT THE CONCERN STORE NEVER FILLS.
    # Triage existed and nothing called it, so the store stayed empty and the
    # emptiness looked like a quiet villa — the failure this subsystem keeps
    # rediscovering. Every guard it needs — the kill switches, the budget, the
    # provider — is asked per pass rather than at start-up, so an operator's
    # change takes effect on the next cycle.
    tasks["triage"] = asyncio.create_task(
        agent_scheduler.run_forever(session, config_source))

    # ⚠️ A SECOND CLOCK, AND IT IS NOT THE SAME CLOCK. The triage loop sleeps
    # out the villa's cadence — 360 minutes on the reference villa — and the
    # escalation ladder's bands are 15/45/90 MINUTES. Sharing the loop is what
    # made a timed promise on a concern card up to six hours late. This one
    # asks no model and spends nothing.
    tasks["chase"] = asyncio.create_task(
        agent_scheduler.chase_forever(session, config_source))

    return tasks
