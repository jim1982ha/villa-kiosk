"""An AI job's code steps — `on_limit` and `without_ai` in skill.yaml — run one way.

⚠️ ONE MEANING OF A STEP (architecture review 5, 2026-10-07). on_limit ran through the hooks' path and carried out
whatever its script printed; without_ai had its own loop that stopped at a failure and counted what was sent. A
step now always: runs this skill's script or another skill's, its {placeholders} filled; stops the steps when it
fails (a later step reads an earlier one's file: a stale file never stands in for a failed step); has what it decided
to send carried out, on behalf of the job's chat.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from . import script_run


@dataclass
class Done:
    sent: int                      # messages that reached a chat
    failed: str | None             # the script that stopped the steps, or why it could not run


async def run(settings, state, skills, outcome, skill, steps: list[dict], values: dict, origin=None) -> Done:
    sent = 0
    for st in steps:
        if origin and st.get("on_schedule_only"):
            continue
        sk = skills.all().get(st["skill"]) if st.get("skill") else skill
        script = st["run"].split()[0]
        if sk is None:
            return Done(sent, f"{script} ({st['skill']}: not installed)")
        ans = await asyncio.to_thread(script_run.run_command, settings, state, sk, st["run"], values, timeout=900)
        if not ans.ok:
            return Done(sent, script)
        res = ans.result()
        if res.get("send"):
            sent += (await outcome.carry_out(res, sk.name, origin))["sent"]
    return Done(sent, None)
