"""`reply(text)` — answer the conversation you are already in. TOOL-010.

⚠️ REPLY IS NOT NOTIFY, AND THE DIFFERENCE IS THE WHOLE DESIGN. Replying into a
conversation a human just opened is bound to the chat that opened it. Deciding
whom to alert, and when, stays deterministic in `route.py` — because a model
choosing whether to wake somebody at 3am is the most consequential unforced
error available in this system.

⚠️ THE RECIPIENT IS NOT A PARAMETER, AND THAT IS THE ENFORCEMENT. There is no
`to`, no `chat_id`, no `target` in `inputSchema`, so the model has no vocabulary
for asking. A tool that took a recipient and validated it would be one
validation bug away from an agent that can message anybody it can name; a tool
that cannot express one is not. The target is bound by the RUNTIME, at
construction, from the inbound message.

⚠️ SO THE AGENT CANNOT START A CONVERSATION. It can only answer one that
already exists — no tool instance is built unless a message arrived, and each
instance can reach exactly the chat that sent it.

⚠️ AND IT IS `mode = "WRITE"`, NOT `"ACT"`. It touches nothing in the villa; it
puts text on a phone belonging to somebody who just texted the villa. That is
why it may appear on the MCP surface's named-write list one day and
`act_service` may not — but it does NOT appear there today, because an MCP
caller has no inbound message to be bound to and would therefore need to name a
recipient, which is the thing this file exists to make unsayable.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence, Tuple

from agent import chat
from agent.tools.base import BaseTool, fail, text
from vesta.adapters.log import swallow


class ReplyTool(BaseTool):
    """One instance per inbound message, bound to that message's chat."""

    name = "reply"
    description = ("Send a reply into the conversation that just messaged you. "
                   "You cannot choose the recipient — it is the person who "
                   "wrote to you. Use this once, at the end, with your answer.")
    inputSchema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "text": {"type": "string",
                     "description": "The reply, in prose. No markup."},
        },
        "required": ["text"],
    }
    tiers: Sequence[str] = ("reason",)
    mode = "WRITE"

    def __init__(self, *, targets: Sequence[str] = (),
                 session: Any = None,
                 thread_key: str = "") -> None:
        # ⚠️ PRIVATE, AND SET AT CONSTRUCTION. Not a class attribute, or two
        # concurrent conversations would share one recipient and the second
        # message would be answered into the first person's chat.
        self._targets = tuple(str(t) for t in targets if str(t).strip())
        self._session = session
        self._thread_key = str(thread_key)
        self.sent: List[str] = []

    async def run(self, args: Mapping[str, Any]) -> List[Dict[str, Any]]:
        body = chat.clean_reply(args.get("text", ""))
        if not body:
            # ⚠️ JUDGED ON THE FLATTENED TEXT. Pure markup flattens to nothing
            # and `"  \n "` is truthy; reporting a successful send of an empty
            # string is a correct-looking log for a message nobody received.
            return [fail("invalid_args", "the reply is empty after cleaning")]
        if not self._targets:
            return [fail("unavailable",
                         "this run is not bound to a conversation")]

        delivered = await self._send(body)
        if not delivered:
            return [fail("unavailable", "the reply could not be delivered")]

        # ⚠️ RECORDED AS AN ASSISTANT TURN SO THE NEXT MESSAGE HAS IT. Without
        # this the thread holds only the human's half and a follow-up reads as
        # though the villa never answered.
        if self._thread_key:
            chat.record_turn(self._thread_key, "assistant", body)
        self.sent.append(body)
        return [text("Sent.")]

    async def _send(self, body: str) -> bool:
        if self._session is None:
            # No transport wired: useful in tests and in a dry run. ⚠️ IT DOES
            # NOT RECORD — `run` is the single writer of `sent`, and appending
            # here too double-counted every reply on the untransported path,
            # which is the path every test uses.
            return True
        try:
            from vesta.adapters import deliver
            await deliver.deliver(self._session, self._targets,
                                  title="", message=body)
            return True
        except Exception as err:  # noqa: BLE001 - degrade, never fail
            swallow("chat reply delivery failed", err)
            return False


def build(*, targets: Sequence[str] = (), session: Any = None,
          thread_key: str = "") -> ReplyTool:
    """A reply tool bound to one conversation. The ONLY way to make one.

    ⚠️ THERE IS NO ZERO-ARGUMENT CONSTRUCTION PATH INTO THE SHARED REGISTRY.
    `agent/tools/__init__.py` collects `ALL_TOOLS` and instantiates each class
    with no arguments; a reply tool built that way would have no targets and
    could reach nobody — but it would also be OFFERED to every scheduled run,
    teaching the model a verb it cannot use. It is deliberately absent from
    that tuple and added per-run by the chat path instead.
    """
    return ReplyTool(targets=targets, session=session, thread_key=thread_key)


#: ⚠️ DELIBERATELY EMPTY, AND `test_agent_contracts` KNOWS. Every other tool
#: module exports its classes so `ALL_TOOLS` collects them; this one must not be
#: collected, because an unbound reply tool is a verb the model cannot use.
REPLY_TOOLS: Tuple[type, ...] = ()
