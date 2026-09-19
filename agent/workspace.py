"""The owner's own folder, and the README that explains it.

⚠️ A FOLDER THAT APPEARS ON THE DAY THE FEATURE LANDS IS A FOLDER NOBODY FINDS.
Ticket 27 puts Skills in "the add-on's own config folder, which appears in the
file editor the owner already has" — and the first manifest mapped no folder at
all, so that sentence described somewhere that did not exist. The mapping and
this README ship now, ahead of the feature, so the place is discoverable before
there is anything to put in it.

⚠️ THIS IS NOT `/data`. `/data` is the layer's private state — its journal, its
baselines — and the owner never opens it. `/addon_configs/<slug>/` is the
OWNER'S, and the layer only ever reads from it.
"""
from __future__ import annotations

from pathlib import Path

from agent import log

#: Where Supervisor mounts this add-on's own config folder (`addon_config:rw`).
WORKSPACE = Path("/addon_configs")

README = """# VESTA AI Layer — your folder

This folder is yours. The add-on reads from it and never overwrites what you
put here. It shows up in the **File editor** and **Studio Code Server** add-ons
under `addon_configs/`.

## What goes here

**Skills** — one Markdown file each, describing something worth watching and
what to say about it. They are not built yet: they arrive in a later release,
and this file is here so you know where they will go.

When they do:

* a skill is one Markdown file in a department folder (`electrical/`,
  `equipment/`, `water/`, `climate/`, `security/`, `network/`, `upkeep/`);
* saving a file takes effect without restarting the add-on;
* a file here **replaces** one of the same name that ships inside the add-on, so
  you can adapt anything without forking it and an update will not wipe your
  edit;
* a skill that does not parse is **refused and you are told** — which file,
  which line, what is wrong. It is never half-loaded and never silent;
* `enabled: false` in a file switches it off without deleting it.

## What does NOT go here

Your API key, notify targets, spend limit and the ha-mcp address are **add-on
options**, not files. Set them on this add-on's **Configuration** tab in Home
Assistant.

The layer's own state — what it has seen, what it has learnt — lives in its
private storage, not here. You do not need to back this folder up separately:
Home Assistant includes it in the add-on's backup.
"""


def prepare(root: Path = WORKSPACE) -> Path | None:
    """Make sure the owner's folder exists and explains itself.

    Returns the folder, or None when the add-on has no `addon_config` mapping —
    which is a manifest fault worth naming rather than a reason to fail.
    """
    if not root.exists():
        log.warning(f"  no owner config folder at {root} — this add-on's manifest "
                    f"is missing its `addon_config` mapping, so there is nowhere "
                    f"for you to put Skills")
        return None
    readme = root / "README.md"
    try:
        # ⚠️ REWRITTEN EVERY START, AND ONLY THIS FILE. It is the add-on's own
        # documentation and must track the release; everything else in here is
        # the owner's and is never touched. Rewritten only when it differs, so a
        # folder being watched does not see a change on every restart.
        current = readme.read_text() if readme.exists() else None
        if current != README:
            readme.write_text(README)
    except OSError as exc:
        log.warning(f"  could not write {readme}: {exc}")
        return root
    log.info(f"  your folder is {root} — it appears as `addon_configs/` in the "
             f"File editor and Studio Code Server")
    return root
