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

import shutil
from pathlib import Path

from agent import log

#: Where Supervisor mounts this add-on's own config folder (`addon_config:rw`).
#:
#: ⚠️ TWO NAMES FOR ONE FOLDER, AND THE CONTAINER'S IS NOT THE ONE A PERSON
#: SEES. Supervisor mounts an add-on's own `addon_config` at /config INSIDE the
#: container, while the File editor shows it as /addon_configs/<slug>/.
#: Hardcoding the one a person sees would read correctly in every document and
#: find nothing at runtime.
WORKSPACE_CANDIDATES = (Path("/config"), Path("/addon_configs"))
WORKSPACE = WORKSPACE_CANDIDATES[0]

#: The starter Skills that ship inside the image.
SHIPPED_SKILLS = Path(__file__).resolve().parent / "skills"

README = """# VESTA AI Layer — your folder

This folder is yours. The add-on reads from it and never overwrites what you
put here. It shows up in the **File editor** and **Studio Code Server** add-ons
under `addon_configs/`.

## What goes here

**Skills** — one Markdown file each, describing something worth watching and
what to say about it. A starter set has been copied in for you; edit them,
delete the ones that do not apply, and add your own.

⚠️ The layer does not READ them yet — that arrives in a later release. What is
here is kept, and anything you delete stays deleted.

When it does read them:

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


def find_workspace() -> Path | None:
    """Whichever of the two mount points actually exists."""
    for candidate in WORKSPACE_CANDIDATES:
        if candidate.is_dir():
            return candidate
    return None


def seed_skills(root: Path, shipped: Path = SHIPPED_SKILLS) -> int:
    """Copy the starter Skills in, ONCE, and never over an owner's file.

    ⚠️ ONLY WHAT IS ABSENT, AND NEVER AN OVERWRITE. An add-on that restores its
    own idea of a Skill on every restart is an add-on that eats an owner's
    edits — and "I deleted that and it came back" is the exact complaint the
    hard rule's "prefer an empty default" note exists to prevent. A starter
    Skill the owner deletes stays deleted, because the marker below records that
    seeding already happened.
    """
    marker = root / ".starter-skills-installed"
    if marker.exists() or not shipped.is_dir():
        return 0
    copied = 0
    for source in sorted(shipped.glob("*/*.md")):
        dest = root / source.parent.name / source.name
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
        copied += 1
    try:
        marker.write_text(
            "The starter Skills were copied into this folder once. Delete this "
            "file to have them copied again on the next restart; leave it and "
            "anything you remove here stays removed.\n")
    except OSError:
        pass
    if copied:
        log.info(f"  {copied} starter Skills copied into {root}")
    return copied


def prepare(root: Path | None = None) -> Path | None:
    """Make sure the owner's folder exists, explains itself, and has a start.

    Returns the folder, or None when the add-on has no `addon_config` mapping —
    which is a manifest fault worth naming rather than a reason to fail.
    """
    root = root if root is not None else (find_workspace() or WORKSPACE)
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
    seed_skills(root)
    log.info(f"  your folder is {root} — it appears as `addon_configs/` in the "
             f"File editor and Studio Code Server")
    return root
