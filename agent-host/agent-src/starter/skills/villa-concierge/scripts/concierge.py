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
from vesta_shared import script  # noqa: E402  (pack, store, client: one set-up)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.messaging import incident_tag  # noqa: E402  ("Incident #N", the same everywhere)
from vesta_shared.offline import devices_offline  # noqa: E402  (the one reading of "offline now")
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the Limits tab)



# ------------------------------------------------------------------ status
SHOW = limit("chat.names_per_line", 12, unit="names", group="ai", lo=1, hi=500,
             says="Names listed on each line of the villa status the AI reads before answering in a chat.",
             reached="The others are counted: 'and N more'.", told="ai")
ALERT_TITLE_CHARS = limit("chat.alert_title_chars", 120, unit="characters", group="text", lo=40, hi=1000,
                          says="Longest open-alert title in the villa status the AI reads.", reached="A longer one is cut.",
                          told="")
PROBLEM_TITLE_CHARS = limit("chat.problem_title_chars", 160, unit="characters", group="text", lo=40, hi=1000,
                            says="Longest open-problem title in the villa status the AI reads.",
                            reached="A longer one is cut.", told="")
#: The families the status reads (offline, a lock open, an alarm on). Its own list, beside the reports' and the night
#: check's (test_offline holds the three side by side).
FAMILIES = ("security", "power", "energy", "runtime", "level", "battery")


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
    # ⚠️ ONE "OFFLINE" (architecture review 30, then round 3 of 2026-10-19): the one reading of the night check and the
    # reports — "unknown" is not offline, a device per row, the villa's critical list (pack.is_critical), a device the
    # villa's system knows nothing about left out — with no minimum: the chat says every one
    for g in devices_offline(pack, states, datetime.now(timezone.utc), FAMILIES):
        if g.critical:
            problems.append(f"{g.name} offline")
        else:
            offline[g.key] = g.name
    for fam in FAMILIES:
        for r in pack.entities(fam):
            s = states.get(r["entity_id"], {}).get("state")
            if fam == "security" and r["entity_id"].startswith("lock.") and s == "unlocked":
                problems.append(f"{r['name']} unlocked")
            elif fam == "security" and r.get("device_class") in ("moisture", "smoke") and s == "on":
                problems.append(f"{r['name']} ALARM")
            # ⚠️ A LOW BATTERY IS THE NIGHT CHECK'S (architecture review 30): a "<= 20" here was a second threshold beside
            # its battery_warn_pct; its battery finding is an open problem, listed below
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
        lines.append(f"Open alerts ({len(alerts)}): " + _names([f"{incident_tag(p['incident'])} · {p['title'][:ALERT_TITLE_CHARS]}" for p in alerts]))
    if tasks:
        lines.append(f"Open problems ({len(tasks)}): " + _names([p["title"][:PROBLEM_TITLE_CHARS] for p in tasks]))
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
