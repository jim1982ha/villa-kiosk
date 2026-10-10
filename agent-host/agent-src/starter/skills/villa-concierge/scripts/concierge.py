#!/usr/bin/env python3
"""villa-concierge: the villa's status, and which devices a place or a name means.

  concierge.py status   --pack pack.json [--fixture-dir DIR] [--store S]      "is everything OK"
  concierge.py find     --pack pack.json --what "lights" --where "kitchen"   resolve a target

Every command prints JSON. Acting on the villa is not here: the AI asks with ha_call_service, a person approves
with a button, the engine carries it out and reads it back (vesta_agent/actions.py). ⚠️ propose / execute /
readback and catalogue.yaml were a second action path that could not run — not offered to the AI, and a skill's
script reads Home Assistant read-only — while SKILL.md told the AI to use them (architecture review, 2026-10-07).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata


HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared import script  # noqa: E402  (pack, store, client: one set-up)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.messaging import incident_tag  # noqa: E402  ("Incident #N", the same everywhere)



# ------------------------------------------------------------------ status
SHOW = 12        # names listed per line; the rest counted ("and 3 more")


def _names(items: list[str]) -> str:
    return "; ".join(items[:SHOW]) + (f"; and {len(items) - SHOW} more" if len(items) > SHOW else "")


def status(pack: KnowledgePack, states: dict, store: Store | None) -> dict:
    """The chat equivalent of the kiosk light: green / amber / red, and EVERY reason by name.

    ⚠️ NAMED, NOT COUNTED (owner, 2026-10-10: asked "what's the status of the villa now?" the agent said everything
    was fine while three Shelly pump devices were offline). An offline pump was a "Watch" line per sensor (cut at 6,
    one plug's sensors filled it), the night check's problems were only a count ("Other open problems: 7"), and an
    open problem alone left the villa green. Now: each offline DEVICE once, by its name (knowledge_pack.device_of);
    red when one the villa marks critical is offline, a lock open or an alarm on; amber when anything else is
    offline, on watch, or a problem or an alert is open; green only when nothing is."""
    problems, offline, watch = [], {}, []
    for fam in ("security", "power", "energy", "runtime", "level", "battery"):
        for r in pack.entities(fam):
            st = states.get(r["entity_id"], {})
            s = st.get("state")
            asset = pack.assets.get(r["asset"], {})
            if s in ("unavailable", "unknown"):
                key, name = pack.device_of(r["entity_id"])
                if name is None:
                    continue                               # a device Home Assistant knows nothing about
                if asset.get("critical"):
                    if f"{name} offline" not in problems:
                        problems.append(f"{name} offline")
                else:
                    offline.setdefault(key, name)
            elif fam == "security" and r["entity_id"].startswith("lock.") and s == "unlocked":
                problems.append(f"{r['name']} unlocked")
            elif fam == "security" and r.get("device_class") in ("moisture", "smoke") and s == "on":
                problems.append(f"{r['name']} ALARM")
            elif fam == "battery" and r.get("unit") == "%":
                try:
                    if float(s) <= 20:
                        watch.append(f"{pack.device_name(r['entity_id'], r['name'])} battery {float(s):.0f}%")
                except (TypeError, ValueError):
                    pass
    open_now = Problems(store).open_problems() if store else []
    alerts = [p for p in open_now if p["incident"]]
    tasks = [p for p in open_now if not p["incident"]]
    offline_names = sorted(set(offline.values()))
    colour = "red" if problems else ("amber" if (offline_names or watch or open_now) else "green")
    lines = [f"{pack.villa}: {colour.upper()}"]
    if problems:
        lines.append("Now: " + _names(problems))
    if offline_names:
        lines.append(f"Offline ({len(offline_names)}): " + _names(offline_names))
    if alerts:
        lines.append(f"Open alerts ({len(alerts)}): " + _names([f"{incident_tag(p['incident'])} · {p['title'][:120]}" for p in alerts]))
    if tasks:
        lines.append(f"Open problems ({len(tasks)}): " + _names([p["title"][:160] for p in tasks]))
    if watch:
        lines.append("Watch: " + _names(watch))
    if colour == "green":
        lines.append("Nothing open, every device online.")
    return {"colour": colour, "problems": problems, "offline": offline_names, "watch": watch,
            "open_alerts": [p["title"] for p in alerts], "open_problems": [p["title"] for p in tasks],
            "open_incidents": len(alerts), "open_tasks": len(tasks), "text": "\n".join(lines)}


# ------------------------------------------------------------------ resolve
def fold(text: str | None) -> str:
    """A name as a person types it: no case, no accents, `_` as a space ("Cuisine_é" == "cuisine e")."""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).casefold().replace("_", " ")
    return " ".join(t.split())


def place(pack: KnowledgePack, where: str | None) -> list[str]:
    """The Home Assistant areas a place names: by name or alias, exact first, then any area containing it
    ("bedroom" -> every bedroom). Empty when no area answers to it."""
    w = fold(where)
    if not w:
        return []
    names = {a: [a] + list(getattr(pack, "area_aliases", {}).get(a, []) or []) for a in pack.areas}
    exact = [a for a, ns in names.items() if any(fold(n) == w for n in ns)]
    return exact or [a for a, ns in names.items() if any(w in fold(n) for n in ns)]


def find(pack: KnowledgePack, what: str | None, where: str | None, domains: list[str] | None = None) -> list[dict]:
    """The devices a person means.

    ⚠️ THE AREA DECIDES (owner, 2026-10-05). When the place is a Home Assistant area, only that area's
    devices count — plus a device with NO area whose name says the place. A name or an entity id that
    merely contains the room's word is not in it: "kitchen lights" once switched on a living-room light
    whose id read "kitchen_and_dining". Only when no area answers to the place is it looked for in the
    names. An entity id is never matched: it is not what a person sees."""
    what_l = fold(what)
    where_l = fold(where)
    areas = set(place(pack, where))
    # the words that name the place: what was said, and every name of the areas it resolved to
    words = {where_l} | {fold(n) for a in areas for n in [a, *(getattr(pack, "area_aliases", {}).get(a) or [])]}
    out = []
    for fam, rows in pack.families.items():
        if fam in ("system", "network", "electrical_aux"):
            continue
        for r in rows:
            dom = r["entity_id"].split(".")[0]
            if domains and dom not in domains:
                continue
            name = fold(r["name"])
            if not where_l:
                ok_where = True
            elif areas:
                ok_where = r["area"] in areas or (not r["area"] and any(w in name for w in words))
            else:
                ok_where = where_l in name
            ok_what = (not what_l) or what_l in name or what_l == fam or what_l == dom \
                or (what_l in ("light", "lights") and dom in ("light",)) \
                or (what_l in ("lock", "locks", "doors") and dom == "lock")
            if ok_where and ok_what:
                out.append({"entity_id": r["entity_id"], "name": r["name"], "area": r["area"], "family": fam, "asset": r["asset"]})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "find"])
    script.arguments(ap, pack=True, pack_required=True)     # --pack --store --zone --fixture-dir --now
    ap.add_argument("--what"); ap.add_argument("--where")
    a = ap.parse_args(argv)
    s = script.Context(a)
    pack, store, cli = s.pack, s.store, s.live_client
    if a.cmd == "status":
        res = status(pack, cli.states() if cli else {}, store)
    else:
        areas = place(pack, a.where)
        res = {"targets": find(pack, a.what, a.where),
               "place": {"areas": areas} if areas else {"by_name": bool(a.where)}}
    print(json.dumps(res, indent=1, default=str))
    return 0 if res.get("ok", True) else 2


if __name__ == "__main__":
    sys.exit(main())
