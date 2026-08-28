"""The tool registry's members. See `base.py` for the protocol they follow.

⚠️ EVERY TOOL IS DECLARED IN ITS MODULE'S OWN EXPORT TUPLE AND COLLECTED HERE.
A tool that exists but is registered nowhere is a tool the model never learns
about — which fails silently and looks exactly like a model choosing not to use
it, so the failure is invisible in a capture. `test_agent_contracts` asserts
that every BaseTool subclass under this package reaches `ALL_TOOLS`.
"""

from vesta.supervise.agent.tools.analysis import ANALYSIS_TOOLS
from vesta.supervise.agent.tools.ha import HA_TOOLS
from vesta.supervise.agent.tools.ledger import LEDGER_TOOLS
from vesta.supervise.agent.tools.logs import LOG_TOOLS
from vesta.supervise.agent.tools.playbook import PLAYBOOK_TOOLS
from vesta.supervise.agent.tools.read import READ_TOOLS

ALL_TOOLS = (READ_TOOLS + HA_TOOLS + LOG_TOOLS + LEDGER_TOOLS + PLAYBOOK_TOOLS
             + ANALYSIS_TOOLS)

__all__ = ["ALL_TOOLS", "READ_TOOLS", "HA_TOOLS", "LOG_TOOLS", "LEDGER_TOOLS",
           "PLAYBOOK_TOOLS", "ANALYSIS_TOOLS"]
