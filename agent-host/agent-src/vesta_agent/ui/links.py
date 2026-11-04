"""Knowledge › Device links: each device with the helpers of the villa's system that belong to it (its schedule, its
normal power, its run hours: vesta_shared.asset_links.ROLES), each as the agent found it by its name or as the owner
chose it, saved through the page's one writer (changes.PageFiles), as Device kinds (ui/kinds.py).

⚠️ ONLY THE DEVICES A LINK SERVES: those the agent reads power or energy for (the night check's and the energy figures'
devices), and any other that has a link found or chosen, so it can be taken back.
"""
from __future__ import annotations

import os

from vesta_shared import asset_links, run_hours
from vesta_shared.choice_files import BY_KIND
from vesta_shared.knowledge_pack import KnowledgePack

from .changes import PageFiles, Refused, _read
from .kinds import _measured, row_of, saved

PLACE = "Knowledge"


def _options(pack) -> dict[str, list[list[str]]]:
    """Per link, the villa's helpers of its type as [id, name], by name: what its drop-down offers."""
    rows = pack.families.get("system", []) if pack else []
    out = {}
    for role, (_f, _n, domain, _w) in asset_links.ROLES.items():
        seen = {r["entity_id"]: r.get("name") or r["entity_id"] for r in rows if r["entity_id"].startswith(domain + ".")}
        out[role] = sorted(([i, n] for i, n in seen.items()), key=lambda x: (x[1].lower(), x[0]))
    return out


def _nights(settings) -> dict:
    """The last night check's run-hours verdicts (vesta_shared.run_hours.recorded), read from the agent's store; none
    before the first night, or when the store cannot be read."""
    if not os.path.exists(settings.store_path):
        return run_hours.recorded(None)
    try:
        from vesta_shared.store import Store
        return run_hours.recorded(Store(settings.store_path))
    except Exception:  # noqa: BLE001 — the page shows what can be judged without the night
        return run_hours.recorded(None)


def _run_hours(a: dict, schedules: dict[str, str] | None, night: dict) -> dict:
    """{on, why, at}: the device's run-hours check as the last night judged it, when it judged the schedule and the kind
    the device has now (a link or a kind chosen since makes it out of date), else what can be judged without the villa:
    no reading, a kind never judged, no schedule linked, a schedule no longer among the villa's helpers (`schedules`:
    {id: name}; None: not known)."""
    seen = (night["devices"] or {}).get(a.get("slug"))
    if isinstance(seen, dict) and seen.get("schedule") == a.get("schedule") and \
            seen.get("kind") == a.get("kind", "appliance"):
        return {"on": bool(seen.get("on")), "why": seen.get("why") or "", "at": night.get("at")}
    sch = a.get("schedule")
    v = run_hours.verdict(a, None if schedules is None or not sch else sch in schedules,
                          name=(schedules or {}).get(sch) if sch else None)
    return {"on": v.on, "why": v.why, "at": None}


def rows(settings) -> dict:
    """The card's answer: {rows, roles, options, built}. A row: slug, name, area, gone (choices for a device the villa
    no longer has), run_hours ({on, why, at}: its run-hours check, vesta_shared.run_hours), links: per role, {value (the
    helper used, None: none), name (its name), guess (what the name rule found), source ("chosen": set here, "guessed":
    the name rule's, "none": nothing linked), gone (that helper is no longer among the villa's)}."""
    pack = KnowledgePack.read(settings.pack_path, settings.config_dir)
    chosen = BY_KIND["links"].chosen(settings.config_dir)
    name_of = (lambda i: pack.name_of(i, i)) if pack else (lambda i: i)
    options = _options(pack)
    # ⚠️ A HELPER GONE FROM THE VILLA IS SAID (architecture review 20, card 3): a schedule deleted or renamed there showed
    # as its raw id, "Set by you", under Schedule linked; it is marked gone, against the villa's helpers the pack read
    known = ({role: dict((i, n) for i, n in got) for role, got in options.items()}
             if pack and pack.families.get("system") else None)
    night = _nights(settings)

    def link(role, value, guess, source):
        return {"value": value, "name": name_of(value) if value else None, "guess": guess,
                "guess_name": name_of(guess) if guess else None, "source": source,
                "gone": bool(value and known is not None and value not in known[role])}
    out = []
    for slug, a in (pack.assets if pack else {}).items():
        guessed = a.get("guessed") or {}
        if not _measured(a) and slug not in chosen and not any(guessed.values()):
            continue
        links = {}
        for role, (fld, *_rest) in asset_links.ROLES.items():
            value = a.get(fld)                                  # the pack's one answer (asset_link), never a copy
            links[role] = link(role, value, guessed.get(role),
                               "chosen" if role in chosen.get(slug, {}) else "guessed" if value else "none")
        out.append({"slug": slug, "name": a.get("name") or slug, "area": a.get("area") or "", "links": links,
                    "gone": False, "run_hours": _run_hours(a, known and known["schedule"], night)})
    for slug, mine in chosen.items():
        if not (pack and slug in pack.assets):
            out.append({"slug": slug, "name": slug, "area": "", "gone": True,
                        "run_hours": {"on": False, "why": "No longer among the villa's devices.", "at": None},
                        "links": {r: link(r, v or None, None, "chosen") for r, v in mine.items()}})
    out.sort(key=lambda r: (r["name"].lower(), r["slug"]))
    return {"rows": out, "roles": [[k, name, domain, words] for k, (_f, name, domain, words) in asset_links.ROLES.items()],
            "options": options, "built": pack.generated_at if pack else None}


def save(settings, files: PageFiles, slug: str, role: str, value: str | None) -> dict:
    """One device's link chosen (`value`: a helper's id, or "" for None), or back to the one found by name (None): written,
    recorded in Page changes, undoable. The card's answer (rows), with `what`: the sentence recorded."""
    if role not in asset_links.ROLES:
        raise Refused([f"{role!r} is not a link ({', '.join(asset_links.ROLES)})."])
    now = rows(settings)
    row = row_of(now, slug)
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
    # ⚠️ ONE SENTENCE, THE ONE RECORDED (architecture review 20, card 6): a gone device's Remove was recorded "back to the
    # one found, none found" while the page toasted words of its own; the page now toasts this one (kinds.saved)
    if value is None and row["gone"]:
        what = f"{row['name']}: {link} removed"
    elif value is None:
        what = (f"{row['name']}: {link} back to the one found, {guess}" if guess
                else f"{row['name']}: {link} back to the one found, none found")
    elif value == "":
        what = f"{row['name']}: {link} set to None"
    else:
        what = f"{row['name']}: {link} set to {names[value]}" + (f" (found by name: {guess})" if guess else "")
    return saved(settings, files, "links", what, asset_links.text_of(links), rows)
