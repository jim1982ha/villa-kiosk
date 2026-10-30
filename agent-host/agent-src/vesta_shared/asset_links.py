"""Which helpers of the villa's system belong to each device (its schedule, its normal power, its run hours): guessed
from the helpers' names, or chosen by the owner on the VESTA Agent page (Knowledge › Device links), kept in
asset_links.yaml beside policy.yaml.

⚠️ A NAME WAS THE ONLY LINK (owner, 2026-10-30): a pump's schedule counted only when it was called
schedule.<device>_expected_runtime, so a schedule named any other way was never read, and the night check's run-hours
check stayed off with nothing on the page saying why. The page now lists each device with the helper its name rule
found and a drop-down of the villa's helpers of the right type; the choice is written here, through the page's one
writer (ui.changes.PageFiles: checked, recorded in Page changes, undoable), and applied by KnowledgePack.load
(links_are), so every reader of the pack (the night check, the energy figures, the kind guess) gets the same link,
from the next run. A choice of "" is "None": that link switched off, whatever the name rule finds.
"""
from __future__ import annotations

import io

import yaml

FILE = "asset_links.yaml"

#: The links, in the order the page shows them: key → (the pack's field for it, its name, the domain of the helpers
#: it takes, what it is used for). The page's words, the one table: the page keeps no copy.
ROLES: dict[str, tuple[str, str, str, str]] = {
    "schedule": ("schedule", "Schedule", "schedule",
                 "The hours it should run each day: the night check compares them with the hours it ran (the run-hours "
                 "check), and a device with one counts as a motor."),
    "baseline": ("baseline_helper", "Normal power", "input_number",
                 "Its normal running power: above a share of it the device counts as running, for the night check and "
                 "the energy figures, and a device with one counts as a motor."),
    "counter": ("counter", "Run hours", "counter",
                "A count of its hours of running: a device with one counts as a motor."),
}

#: what the file says of itself, above the choices
HEADER = ("# Which helpers belong to each device, as chosen on the VESTA Agent page (Knowledge > Device links).\n"
          "# A link not listed keeps the helper the agent finds by its name; \"\" is None: that link off.\n"
          "# Links: " + ", ".join(ROLES) + ".\n")


def fits(role: str, value) -> bool:
    """Whether `value` can be the `role` link: "" (None), or an id of a helper of the role's type."""
    return role in ROLES and isinstance(value, str) and (value == "" or value.startswith(ROLES[role][2] + ".")
                                                         and len(value) > len(ROLES[role][2]) + 1)


def valid(mapping) -> dict[str, dict[str, str]]:
    """The entries of `mapping` that are links: {slug: {role: helper id or ""}}; anything else left out."""
    if not isinstance(mapping, dict):
        return {}
    out = {}
    for slug, links in mapping.items():
        if isinstance(slug, str) and slug and isinstance(links, dict):
            ok = {str(r): v for r, v in links.items() if fits(str(r), v)}
            if ok:
                out[slug] = ok
    return out


def parse(text: str | None) -> dict[str, dict[str, str]]:
    """The choices a text of the file holds ({} when none, or when it cannot be read)."""
    try:
        doc = yaml.safe_load(text or "") or {}
    except yaml.YAMLError:
        return {}
    return valid(doc.get("links") if isinstance(doc, dict) else None)


def problems(text: str) -> list[str]:
    """What is wrong with a text of the file, in words ([] when nothing): what the page's writer refuses."""
    try:
        doc = yaml.safe_load(text or "") or {}
    except yaml.YAMLError as e:
        return [f"{FILE} is not valid YAML: {e}"]
    links = doc.get("links") if isinstance(doc, dict) else None
    if links is None:
        return [] if isinstance(doc, dict) else [f"{FILE} holds no list of links."]
    if not isinstance(links, dict):
        return [f"{FILE}: links is not a list of devices and their helpers."]
    out = []
    for slug, roles in links.items():
        if not isinstance(roles, dict):
            out.append(f"{slug}: not a list of links ({', '.join(ROLES)}).")
            continue
        for r, v in roles.items():
            if r not in ROLES:
                out.append(f"{slug}: {r!r} is not a link ({', '.join(ROLES)}).")
            elif not fits(r, v):
                out.append(f"{slug}: {v!r} is not a {ROLES[r][2]} helper, nor \"\" (None).")
    return out


def text_of(links: dict[str, dict[str, str]]) -> str:
    """The file's text for these choices (sorted, so a change is one line in Page changes' before and after)."""
    out = io.StringIO()
    yaml.safe_dump({"links": {s: dict(sorted(r.items())) for s, r in sorted(valid(links).items())}}, out,
                   sort_keys=False, allow_unicode=True)
    return HEADER + out.getvalue()
