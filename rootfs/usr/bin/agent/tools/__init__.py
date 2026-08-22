"""The tool registry's members. See `base.py` for the protocol they follow.

⚠️ EVERY TOOL IS DECLARED IN ITS MODULE'S OWN EXPORT TUPLE AND COLLECTED HERE.
A tool that exists but is registered nowhere is a tool the model never learns
about — which fails silently and looks exactly like a model choosing not to use
it, so the failure is invisible in a capture.
"""

from agent.tools.read import READ_TOOLS

ALL_TOOLS = READ_TOOLS

__all__ = ["ALL_TOOLS", "READ_TOOLS"]
