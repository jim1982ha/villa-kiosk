"""Knowledge › Device links: each device with the helpers of the villa's system that belong to it (its schedule, its
normal power, its run hours: vesta_shared.asset_links.ROLES), each as the agent found it by its name or as the owner
chose it, saved through the page's one writer (changes.PageFiles), as Device kinds (ui/kinds.py).

⚠️ ONLY THE DEVICES A LINK SERVES: those the agent reads power or energy for (the night check's and the energy figures'
devices), and any other that has a link found or chosen, so it can be taken back.
"""
from __future__ import annotations

from vesta_shared import asset_links
from vesta_shared.choice_files import BY_KIND
from vesta_shared.knowledge_pack import KnowledgePack

from .changes import PageFiles, Refused, _read
from .kinds import _measured

PLACE = "Knowledge"


def _options(pack) -> dict[str, list[list[str]]]:
    """Per link, the villa's helpers of its type as [id, name], by name: what its drop-down offers."""
    rows = pack.families.get("system", []) if pack else []
    out = {}
    for role, (_f, _n, domain, _w) in asset_links.ROLES.items():
        seen = {r["entity_id"]: r.get("name") or r["entity_id"] for r in rows if r["entity_id"].startswith(domain + ".")}
        out[role] = sorted(([i, n] for i, n in seen.items()), key=lambda x: (x[1].lower(), x[0]))
    return out


def rows(settings) -> dict:
    """The card's answer: {rows, roles, options, built}. A row: slug, name, area, gone (choices for a device the villa
    no longer has), links: per role, {value (the helper used, None: none), name (its name), guess (what the name rule
    found), source ("chosen": set here, "guessed": the name rule's, "none": nothing linked)}."""
    pack = KnowledgePack.read(settings.pack_path, settings.config_dir)
    chosen = BY_KIND["links"].chosen(settings.config_dir)
    name_of = (lambda i: pack.name_of(i, i)) if pack else (lambda i: i)
    out = []
    for slug, a in (pack.assets if pack else {}).items():
        guessed = a.get("guessed") or {}
        if not _measured(a) and slug not in chosen and not any(guessed.values()):
            continue
        links = {}
        for role, (fld, *_rest) in asset_links.ROLES.items():
            value = a.get(fld)                                  # the pack's one answer (asset_link), never a copy
            links[role] = {"value": value, "name": name_of(value) if value else None, "guess": guessed.get(role),
                           "guess_name": name_of(guessed[role]) if guessed.get(role) else None,
                           "source": "chosen" if role in chosen.get(slug, {}) else "guessed" if value else "none"}
        out.append({"slug": slug, "name": a.get("name") or slug, "area": a.get("area") or "", "links": links,
                    "gone": False})
    for slug, mine in chosen.items():
        if not (pack and slug in pack.assets):
            out.append({"slug": slug, "name": slug, "area": "", "gone": True,
                        "links": {r: {"value": v or None, "name": name_of(v) if v else None, "guess": None,
                                      "guess_name": None, "source": "chosen"} for r, v in mine.items()}})
    out.sort(key=lambda r: (r["name"].lower(), r["slug"]))
    return {"rows": out, "roles": [[k, name, domain, words] for k, (_f, name, domain, words) in asset_links.ROLES.items()],
            "options": _options(pack), "built": pack.generated_at if pack else None}


def save(settings, files: PageFiles, slug: str, role: str, value: str | None) -> dict:
    """One device's link chosen (`value`: a helper's id, or "" for None), or back to the guess (None): written,
    recorded in Page changes, undoable."""
    if role not in asset_links.ROLES:
        raise Refused([f"{role!r} is not a link ({', '.join(asset_links.ROLES)})."])
    now = rows(settings)
    row = next((r for r in now["rows"] if r["slug"] == slug), None)
    if row is None:
        raise Refused([f"No device {slug} in the agent's list of the villa's devices."], 404)
    names = dict((i, n) for i, n in now["options"][role])
    if value and value not in names:
        raise Refused([f"No such {asset_links.ROLES[role][2]} helper among the villa's helpers."])
    links = asset_links.parse(_read(settings.choice_path("links")).decode("utf-8"))
    mine = links.setdefault(slug, {})
    if value is None:
        mine.pop(role, None)                    # back to the guess: a helper named by the rule later is followed
    else:
        mine[role] = value
    if not mine:
        links.pop(slug)
    link = asset_links.ROLES[role][1]
    guess = row["links"].get(role, {}).get("guess_name")
    if value is None:
        what = (f"{row['name']}: {link} back to its guess, {guess}" if guess
                else f"{row['name']}: {link} back to its guess, none found")
    elif value == "":
        what = f"{row['name']}: {link} set to None"
    else:
        what = f"{row['name']}: {link} set to {names[value]}" + (f" (guessed {guess})" if guess else "")
    files.text_change(PLACE, what, {"kind": "links"}, asset_links.text_of(links))
    return rows(settings)
