"""Knowledge › Devices, its kind: each device the agent reads power or energy for, with the kind it guessed, and the kind the
owner chose instead (vesta_shared.asset_kinds), saved through the page's one writer (changes.PageFiles).

⚠️ ONLY WHERE A KIND CHANGES SOMETHING: the kind decides what the night check, the reports and the energy figures do
with a device's power and energy (knowledge_pack.asset_kind's consumers), so a device without either (a door contact,
a thermometer) is not listed — unless a kind was chosen for it, which stays shown so it can be taken back.
"""
from __future__ import annotations

from vesta_shared import asset_kinds, asset_links
from vesta_shared.choice_files import BY_KIND
from vesta_shared.knowledge_pack import KnowledgePack, asset_kind, kind_and_why

from .changes import PageFiles, Refused, _read

PLACE = "Knowledge"


def _measured(a: dict) -> bool:
    """The asset has a power or an energy reading (its roles: "power", "energy", "power_2", …)."""
    return any(str(role).startswith(("power", "energy")) for role in (a.get("entities") or {}))


#: A part as the page names it (its entity's domain)
PART_WORDS = {"light": "light", "fan": "fan", "climate": "climate unit"}


def parts_words(a: dict) -> str:
    """What the villa's system says the device is made of, as the page says it: "light + fan" (knowledge_pack.parts_of)."""
    ids = [e for kind in ("light", "motor") for e in ((a.get("parts") or {}).get(kind) or [])]
    words = list(dict.fromkeys(PART_WORDS.get(e.split(".", 1)[0], e.split(".", 1)[0]) for e in ids))
    return " + ".join(words)


def _link_of(a: dict) -> str | None:
    """The name of the first link (asset_links.ROLES, in the page's order) the asset has: one that made it a motor."""
    return next((name for fld, name, _d, _w in asset_links.ROLES.values() if a.get(fld)), None)


def row_of(card: dict, slug: str) -> dict:
    """The row of device `slug` on a choice card (this one, or the links'): refused when the card does not list it."""
    row = next((r for r in card["rows"] if r["slug"] == slug), None)
    if row is None:
        raise Refused([f"No device {slug} in the agent's list of the villa's devices."], 404)
    return row


def saved(settings, files: PageFiles, kind: str, what: str, text: str, rows) -> dict:
    """A choice card's change (`kind`: its choice file) written through the page's one writer and recorded as `what`;
    the card's answer again (`rows`), with `what`. ⚠️ THE PAGE TOASTS THE SENTENCE RECORDED (architecture review 20,
    card 6): it toasted a copy of its own ("Removed: X" where Page changes said another thing)."""
    files.text_change(PLACE, what, {"kind": kind}, text)
    return {**rows(settings), "what": what}


def rows(settings) -> dict:
    """The card's answer: {rows, kinds, built}. A row: slug, name, area, guess, kind, chosen (set by the owner), gone (a
    choice for a device the villa no longer has), parts (what the villa's system says it is made of: "light + fan"),
    source (where the guess came from, knowledge_pack.kind_and_why: "system": those parts; "link": a helper linked on
    Knowledge › Devices, named by `link`; "name": its name)."""
    pack = KnowledgePack.read(settings.pack_path, settings.config_dir)
    chosen = BY_KIND["kinds"].chosen(settings.config_dir)
    out = []
    for slug, a in (pack.assets if pack else {}).items():
        if not _measured(a) and slug not in chosen:
            continue
        guess, why = kind_and_why(a)
        out.append({"slug": slug, "name": a.get("name") or slug, "area": a.get("area") or "", "guess": guess,
                    # the engine's one answer (asset_kind: the owner's choice when it is a kind, else the guess), never a copy
                    "kind": asset_kind(a, chosen), "chosen": slug in chosen, "gone": False, "parts": parts_words(a),
                    "source": why, "link": _link_of(a) if why == "link" else None})
    known = {r["slug"] for r in out}
    for slug, kind in chosen.items():
        if slug not in known and not (pack and slug in pack.assets):
            out.append({"slug": slug, "name": slug, "area": "", "guess": None, "kind": kind, "chosen": True, "gone": True})
    out.sort(key=lambda r: (r["name"].lower(), r["slug"]))
    return {"rows": out, "kinds": [[k, name, words] for k, (name, words) in asset_kinds.KINDS.items()],
            "built": pack.generated_at if pack else None}


def save(settings, files: PageFiles, slug: str, kind: str | None) -> dict:
    """One device's kind set (`kind`), or back to the guess (None): written, recorded in Page changes, undoable. The
    card's answer (rows), with `what`: the sentence recorded."""
    if kind is not None and kind not in asset_kinds.KINDS:
        raise Refused([f"{kind!r} is not a kind ({', '.join(asset_kinds.KINDS)})."])
    row = row_of(rows(settings), slug)
    text = _read(settings.choice_path("kinds")).decode("utf-8")
    kinds = asset_kinds.parse(text)
    if kind is None:
        kinds.pop(slug, None)                   # back to the guess: a better guess later is followed
    else:
        kinds[slug] = kind
    name = asset_kinds.KINDS
    if slug in kinds:
        what = f"{row['name']} set to {name[kind][0]}" + (f" (guessed {name[row['guess']][0]})" if row["guess"] else "")
    else:
        what = (f"{row['name']} back to the one found, {name[row['guess']][0]}" if row["guess"]
                else f"{row['name']}: its kind removed (no longer among the villa's devices)")
    return saved(settings, files, "kinds", what, asset_kinds.text_of(kinds), rows)
