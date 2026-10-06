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
from datetime import datetime, timezone


HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared.ha_client import client_from_args  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)
from vesta_shared.store import Store  # noqa: E402



# ------------------------------------------------------------------ status
def status(pack: KnowledgePack, states: dict, store: Store | None) -> dict:
    """The chat equivalent of the kiosk light: green / amber / red with reasons."""
    problems, watch = [], []
    for fam in ("security", "power", "energy", "runtime", "level", "battery"):
        for r in pack.entities(fam):
            st = states.get(r["entity_id"], {})
            s = st.get("state")
            asset = pack.assets.get(r["asset"], {})
            if s in ("unavailable", "unknown"):
                (problems if asset.get("critical") else watch).append(f"{r['name']} offline")
            elif fam == "security" and r["entity_id"].startswith("lock.") and s == "unlocked":
                problems.append(f"{r['name']} unlocked")
            elif fam == "security" and r.get("device_class") in ("moisture", "smoke") and s == "on":
                problems.append(f"{r['name']} ALARM")
            elif fam == "battery" and r.get("unit") == "%":
                try:
                    if float(s) <= 20:
                        watch.append(f"{r['name']} {float(s):.0f}%")
                except (TypeError, ValueError):
                    pass
    incidents = store.incidents() if store else []
    # the maintenance problems still open (the alerts are the incidents above), as every reader counts them
    tasks = [p for p in Problems(store).open_problems() if not p["incident"]] if store else []
    colour = "red" if problems else ("amber" if (watch or incidents) else "green")
    lines = [f"{pack.villa}: {colour.upper()}"]
    if problems:
        lines.append("Now: " + "; ".join(problems[:6]))
    if incidents:
        lines.append(f"Open incidents: {len(incidents)}")
    if tasks:
        lines.append(f"Other open problems: {len(tasks)}")
    if watch:
        lines.append("Watch: " + "; ".join(watch[:6]))
    if colour == "green":
        lines.append("Nothing open, all critical devices online.")
    return {"colour": colour, "problems": problems, "watch": watch, "open_incidents": len(incidents),
            "open_tasks": len(tasks), "text": "\n".join(lines)}


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
    ap.add_argument("--pack", required=True)
    ap.add_argument("--fixture-dir"); ap.add_argument("--zone")
    ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--what"); ap.add_argument("--where")
    ap.add_argument("--now")
    a = ap.parse_args(argv)
    pack = KnowledgePack.load(a.pack)
    store = Store(a.store)
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(timezone.utc)
    cli = client_from_args(a) if (a.fixture_dir or os.environ.get("VESTA_HA_MCP_URL")) else None
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
