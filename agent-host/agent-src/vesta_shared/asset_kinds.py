"""What each of the villa's devices is (motor, lighting, meter, appliance): guessed from its name, or chosen by the owner
on the VESTA Agent page (Knowledge › Device kinds), kept in asset_kinds.yaml beside policy.yaml.

⚠️ ONE PLACE TO CORRECT A GUESS (owner, 2026-10-28: "the picker replaces the text box"). A guess was corrected by typing
JSON into a helper of the villa's system (input_text.vesta_asset_kinds = {"slug": "motor"}): no list of what was
guessed, no check of what was typed, a typo silently ignored. The page now lists each device with its guess and a
drop-down; the choice is written here, through the page's one writer (ui.changes.PageFiles: checked, recorded in Page
changes, undoable), and read by knowledge_pack.asset_kind, the one answer every consumer reads (the night check, its
rules, the reports, the energy figures). KnowledgePack.load applies it, so a choice counts from the next run, not the
next rebuild of the device list.

The helper's value, where a villa had one, is moved here once at the agent's start (`migrate`), and never read again.
"""
from __future__ import annotations

import io
import os

import yaml

FILE = "asset_kinds.yaml"

#: The kinds, in the order the page offers them, each with its name and what it changes (the page's words, the one
#: table: the page keeps no copy)
KINDS: dict[str, tuple[str, str]] = {
    "motor": ("Motor", "A pump, a fan or a compressor: the night check watches how long and how often it runs, "
                         "and the reports chart its running power."),
    "appliance": ("Appliance", "Anything else that uses power: the night check reads its power, without the motor "
                                 "checks."),
    "lighting": ("Lighting", "A light circuit: counted in the energy figures only, never checked at night."),
    "meter": ("Meter", "A meter, one of its phases or a total: counted in the energy figures only, never checked at night."),
}

#: what the file says of itself, above the choices
HEADER = ("# What each device is, as chosen on the VESTA Agent page (Knowledge > Device kinds). A device not listed\n"
          "# keeps the kind the agent guesses from its name. Kinds: " + ", ".join(KINDS) + ".\n")


def path() -> str:
    """asset_kinds.yaml: beside policy.yaml (VESTA_POLICY, the scripts' environment), else in the agent's config folder
    (the engine's and the page's) — limits.yaml's own rule (vesta_shared.limits.path)."""
    if os.environ.get("VESTA_POLICY"):
        return os.path.join(os.path.dirname(os.environ["VESTA_POLICY"]), FILE)
    return os.path.join(os.environ.get("VESTA_AGENT_CONFIG_DIR") or "/config/agent", FILE)


def valid(mapping) -> dict[str, str]:
    """The entries of `mapping` that name a kind: {slug: kind}; anything else left out."""
    if not isinstance(mapping, dict):
        return {}
    return {str(k): str(v) for k, v in mapping.items() if isinstance(k, str) and k and str(v) in KINDS}


def parse(text: str | None) -> dict[str, str]:
    """The choices a text of the file holds ({} when none, or when it cannot be read)."""
    try:
        doc = yaml.safe_load(text or "") or {}
    except yaml.YAMLError:
        return {}
    return valid(doc.get("kinds") if isinstance(doc, dict) else None)


def problems(text: str) -> list[str]:
    """What is wrong with a text of the file, in words ([] when nothing): what the page's writer refuses."""
    try:
        doc = yaml.safe_load(text or "") or {}
    except yaml.YAMLError as e:
        return [f"{FILE} is not valid YAML: {e}"]
    kinds = doc.get("kinds") if isinstance(doc, dict) else None
    if kinds is None:
        return [] if isinstance(doc, dict) else [f"{FILE} holds no list of kinds."]
    if not isinstance(kinds, dict):
        return [f"{FILE}: kinds is not a list of devices and their kind."]
    return [f"{k}: {v!r} is not a kind ({', '.join(KINDS)})." for k, v in kinds.items() if str(v) not in KINDS]


def chosen(p: str | None = None) -> dict[str, str]:
    """The owner's choices: {asset slug: kind}; {} when the file is not there or cannot be read."""
    try:
        with open(p or path(), encoding="utf-8") as f:
            return parse(f.read())
    except OSError:
        return {}


def text_of(kinds: dict[str, str]) -> str:
    """The file's text for these choices (sorted, so a change is one line in Page changes' before and after)."""
    out = io.StringIO()
    yaml.safe_dump({"kinds": dict(sorted(valid(kinds).items()))}, out, sort_keys=False, allow_unicode=True)
    return HEADER + out.getvalue()


#: the helper of the villa's system that held the choices before the page did (read once, by `migrate`)
OLD_HELPER = "input_text.vesta_asset_kinds"


def from_helper(state) -> dict[str, str] | None:
    """The choices the old helper's state holds; None when it holds none (no helper, empty, unknown, not JSON)."""
    import json
    if not isinstance(state, str) or not state.strip() or state in ("unknown", "unavailable"):
        return None
    try:
        return valid(json.loads(state)) or None
    except ValueError:
        return None


def migrate(p: str, read_state) -> tuple[dict[str, str], str] | None:
    """Move the old helper's choices into the file, ONCE: only while the file does not exist yet.

    `read_state()` is the helper's state now (None when the villa's system has no such helper); it raises when the
    villa's system cannot be read — then nothing is written, and the next start tries again. Otherwise the file is
    written (empty when the helper held nothing), so the helper is never read again. Returns (the choices moved, the
    file's text) when it wrote the file, None when it did not (already there)."""
    if os.path.exists(p):
        return None
    kinds = from_helper(read_state()) or {}
    text = text_of(kinds)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, p)
    return kinds, text
