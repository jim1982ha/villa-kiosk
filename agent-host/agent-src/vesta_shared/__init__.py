"""Shared code for the five VESTA skills.

Nothing in this package knows a villa. Every villa specific value comes from
Home Assistant (helpers, registry, statistics) through the client, or from the
knowledge pack generated from that registry. A skill that needs a number it
cannot find raises MissingParameter and says so, it never falls back to a
baked-in default for a physical quantity.
"""

from .params import MissingParameter, VillaParams  # noqa: F401
from .ha_client import McpClient, FixtureClient  # noqa: F401
from .store import Store  # noqa: F401
from .knowledge_pack import KnowledgePack, build_pack  # noqa: F401
