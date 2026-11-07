"""The VESTA Agent's engine. The skills live in VESTA_SKILLS_DIR, not here."""
import os
import re
import sys

# vesta_shared sits beside this package: the engine's own library, which the skills' scripts import too.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _version() -> str:
    """The app's version, which the release writes into vesta-agent.yaml beside this package (one version for the
    app and its engine). It names the UI's static path, so a new release never serves a cached script."""
    try:
        with open(os.path.join(_ROOT, "vesta-agent.yaml"), encoding="utf-8") as f:
            m = re.search(r'^version:\s*"?([^"\s]+)"?', f.read(), re.M)
        return m.group(1) if m else "0"
    except OSError:
        return "0"


__version__ = _version()
