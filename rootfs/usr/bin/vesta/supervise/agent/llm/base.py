"""What a provider must be. CTR-017 downstream. Imports nothing third-party.

⚠️ THE PROTOCOL IS SMALL ON PURPOSE. Every method here is one an adapter can
honestly implement over any chat-completions API; anything provider-specific —
effort dials, thinking blocks, cache breakpoints — is passed through as opaque
options rather than promoted into the interface. A protocol that names one
provider's features is that provider's client with extra steps.

⚠️ AND IT CARRIES NO AUTHORITY. A provider returns text and tool-call requests.
It does not execute a tool, does not decide whether one is permitted, and never
sees `policy.py`. That separation is what makes "a weaker model is a quality
regression, never an authority one" true rather than intended.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence


@dataclass(frozen=True)
class ToolCall:
    """A provider asking for a tool to be run. It has NOT been run."""

    id: str
    name: str
    args: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Turn:
    """One exchange. `text` may be empty when the model only asked for tools.

    ⚠️ `usage` IS REPORTED, NOT TRUSTED FOR BILLING. `budget.py` counts REQUESTS
    for the reason `providers.py` records — token accounting differs per provider
    and silently stops being accurate. These numbers are for a human reading a
    capture, and for noticing that a cached prefix stopped being cached.
    """

    text: str = ""
    tool_calls: Sequence[ToolCall] = ()
    stop_reason: str = ""
    usage: Mapping[str, int] = field(default_factory=dict)
    #: Set when the provider declined rather than failed — a spent budget, an
    #: open breaker, a refusal. ⚠️ Distinct from an exception, because declining
    #: is a correct outcome and failing is not.
    declined: str = ""

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


class Provider(Protocol):
    """The whole seam."""

    name: str

    def configured(self) -> bool:
        """Can this provider actually be called?

        ⚠️ PART OF THE SEAM, NOT A CONVENTION, AND IT WAS THE SECOND FOR A
        WHILE. `anthropic_sdk` had it and this protocol did not, so a caller had
        to reach for it with `getattr(provider, "configured", lambda: False)` —
        which treats a SECOND adapter that simply never implemented it as
        permanently unconfigured. Adding a provider is meant to be a table
        entry (ADR-013); a table entry that silently never runs is worse than
        one that fails.

        ⚠️ SEPARATE FROM HOLDING THE CREDENTIAL, so a diagnostic can ask whether
        a provider is usable without putting the key on the caller's stack —
        the same split `reports/secrets.py` makes.
        """
        ...

    async def run(self, *, system: Sequence[Mapping[str, Any]],
                  messages: Sequence[Mapping[str, Any]],
                  tools: Sequence[Mapping[str, Any]],
                  model: str,
                  max_tokens: int = 2048,
                  options: Optional[Mapping[str, Any]] = None) -> Turn:
        ...


def system_blocks(prefix: str, fresh: str = "") -> List[Dict[str, Any]]:
    """System content with a cache breakpoint at the end of the STABLE half.

    ⚠️ THE BREAKPOINT GOES ON THE LAST STABLE BLOCK, AND NOTHING TIME-VARYING
    MAY PRECEDE IT. Caching matches an exact prefix, so one interpolated
    timestamp above this line means the cache never hits — and the failure is
    silent: the bill goes up and the output looks perfect. `snapshot.profile`
    exists to produce this half and reads no clock for exactly this reason.

    ⚠️ THE FRESH HALF IS A SEPARATE BLOCK AFTER IT, never appended to the
    prefix. Appending would move the breakpoint's content on every call, which
    is the same failure wearing a different hat.
    """
    blocks: List[Dict[str, Any]] = [{
        "type": "text",
        "text": prefix,
        "cache_control": {"type": "ephemeral"},
    }]
    if fresh:
        blocks.append({"type": "text", "text": fresh})
    return blocks
