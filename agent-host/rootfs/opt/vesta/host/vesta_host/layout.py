"""Creates the persistent folders on first start (SPEC 9).

⚠️ NEVER OVERWRITES. /config/skills and /config/agent are edited by people from
Home Assistant; a README "refreshed" on every start would silently undo their
edit, so an existing file is always left exactly as it is.
"""
from __future__ import annotations

import shutil

from . import paths


def ensure() -> list[str]:
    """Returns what it created, for the log."""
    created: list[str] = []
    for d in (paths.DATA_AGENT, paths.DATA_HOST, paths.CONFIG_SKILLS, paths.CONFIG_AGENT):
        if not d.exists():
            d.mkdir(parents=True)
            created.append(str(d))
    for folder, template in ((paths.CONFIG_SKILLS, "skills-README.md"),
                             (paths.CONFIG_AGENT, "agent-README.md")):
        target = folder / "README.md"
        src = paths.TEMPLATES / template
        if target.exists() or not src.exists():
            continue
        try:
            with open(target, "x") as out, open(src) as inp:   # "x": fail if present
                shutil.copyfileobj(inp, out)
            created.append(str(target))
        except FileExistsError:
            pass
    return created
