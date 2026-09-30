"""The VESTA Agent's engine (0.3). The skills live in VESTA_SKILLS_DIR, not here."""
import os
import sys

# vesta_shared sits beside this package: the engine's own library, which the skills' scripts import too.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

__version__ = "0.3.2"
