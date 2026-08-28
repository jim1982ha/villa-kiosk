"""A Provider driven by a scripted list of turns. Layer 4 of the strategy.

⚠️ THE WHOLE AGENT LOOP MUST BE TESTABLE WITH ZERO NETWORK AND NO API KEY. A
loop whose tests need a live provider is a loop nobody runs the tests for — and
the failure modes that matter (budget exhaustion, an open breaker, a raising
tool, a refused act, a repeat loop) are all reachable from a canned script and
none of them are reachable reliably from a real model.

⚠️ IT RECORDS WHAT IT WAS ASKED, so a test can assert the loop sent the tool
list, kept the cached prefix stable, and re-sent the conversation — none of
which is visible from the result alone.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

from vesta.supervise.agent.llm.base import ToolCall
from vesta.supervise.agent.llm.base import Turn


class FakeProvider:
    """Returns `script[i]` on the i-th call, then declines."""

    def configured(self) -> bool:
        """⚠️ PART OF THE PROTOCOL, so the fake stands in for a real adapter
        rather than for a convenient subset of one. A fake missing a method the
        caller uses tests the caller's fallback, not the caller."""
        return True

    name = "fake"

    def __init__(self, script: Sequence[Turn]) -> None:
        self._script = list(script)
        self.calls: List[Dict[str, Any]] = []

    async def run(self, *, system: Sequence[Mapping[str, Any]],
                  messages: Sequence[Mapping[str, Any]],
                  tools: Sequence[Mapping[str, Any]],
                  model: str,
                  max_tokens: int = 2048,
                  options: Optional[Mapping[str, Any]] = None) -> Turn:
        self.calls.append({"system": list(system), "messages": list(messages),
                           "tools": list(tools), "model": model})
        if not self._script:
            # ⚠️ DECLINES RATHER THAN LOOPING FOREVER. A script that runs out is
            # a test that expected fewer turns than the loop took, and a
            # decline says so at the assertion instead of hanging the suite.
            return Turn(declined="the fake provider's script is exhausted")
        return self._script.pop(0)


def says(text: str) -> Turn:
    return Turn(text=text, stop_reason="end_turn")


def asks(name: str, args: Optional[Dict[str, Any]] = None,
         call_id: str = "tu_1") -> Turn:
    return Turn(tool_calls=(ToolCall(id=call_id, name=name, args=args or {}),),
                stop_reason="tool_use")


def declines(reason: str) -> Turn:
    return Turn(declined=reason)
