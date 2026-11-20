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
from datetime import datetime, timezone


HERE = os.path.dirname(os.path.abspath(__file__))
from vesta_shared import script  # noqa: E402  (pack, store, client: one set-up)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.problems import Problems, alert_line  # noqa: E402  (what is still open: one owner; an alert's line)
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.offline import devices_offline, watched_kinds  # noqa: E402  (the one reading of "offline now")
from vesta_shared.asleep import read_states  # noqa: E402  (a sleeping device reads its last real state)
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the Limits tab)
from vesta_shared import occupancy  # noqa: E402  (the villa's "empty" sensor: the Kiosk's pick)



# ------------------------------------------------------------------ status
SHOW = limit("chat.names_per_line", 12, unit="names", group="ai", lo=1, hi=500,
             says="Names listed on each line of the villa status the AI reads before answering in a chat.",
             reached="The others are counted: 'and N more'.", told="ai")
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
    # ⚠️ NO HISTORY READ (owner, 2026-10-30: a spoken "turn on the gym light" waited 41.5 s on this check): since when
    # each device is offline was read back device by device, about 200 reads of the villa's system, for lines that
    # name the devices and never say how long
    for g in devices_offline(pack, states, datetime.now(timezone.utc), watched_kinds()):
        if g.critical:
            problems.append(f"{g.name} offline")
        else:
            offline[g.key] = g.name
    # a lock open, an alarm on: the security devices' own states
    for r in pack.entities("security"):
        s = states.get(r["entity_id"], {}).get("state")
        if r["entity_id"].startswith("lock.") and s == "unlocked":
            problems.append(f"{r['name']} unlocked")
        elif r.get("device_class") in ("moisture", "smoke") and s == "on":
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
        lines.append(f"Open alerts ({len(alerts)}): " + _names([alert_line(p) for p in alerts]))
    if tasks:
        lines.append(f"Open problems ({len(tasks)}): " + _names([p["title"] for p in tasks]))
    if watch:
        lines.append("Watch: " + _names(watch))
    if colour == "green":
        lines.append("Nothing open, every device online.")
    # whether the villa is empty, from the one sensor (the Kiosk's pick): the siren and the reports read the same
    empty_sensor = occupancy.sensor()
    empty = occupancy.state_of((states.get(empty_sensor) or {}).get("state")) if empty_sensor else occupancy.UNKNOWN
    lines.append("Villa empty: " + ({occupancy.EMPTY: "yes", occupancy.OCCUPIED: "no"}.get(empty, "cannot tell")
                                    + (f" ({empty_sensor})" if empty_sensor
                                       else " (no sensor picked in the VESTA Kiosk's Settings › Villa)")))
    return {"colour": colour, "villa_empty": empty, "problems": problems, "offline": offline_names, "watch": watch,
            "open_alerts": [p["title"] for p in alerts], "open_problems": [p["title"] for p in tasks],
            "open_incidents": len(alerts), "open_tasks": len(tasks), "text": "\n".join(lines)}


# ------------------------------------------------------------------ resolve
#: what a person never asks the concierge to act on: the villa's system itself, its network, its auxiliary meters
NOT_ASKED_FOR = ("system", "network", "electrical_aux")


def find(pack: KnowledgePack, what: str | None, where: str | None, domains: list[str] | None = None) -> list[dict]:
    """The devices a person means (KnowledgePack.meant: the area decides, owner 2026-10-05; the investigation reads
    the same), without the families a person never asks the concierge for (NOT_ASKED_FOR)."""
    return pack.meant(what, where, domains, leave_out=NOT_ASKED_FOR)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "find"])
    script.arguments(ap, pack=True, pack_required=True)     # --pack --store --zone --fixture-dir --now
    ap.add_argument("--what"); ap.add_argument("--where")
    a = ap.parse_args(argv)
    s = script.Context(a)
    pack, store, cli = s.pack, s.store, s.live_client
    if a.cmd == "status":
        # a device asleep between its reports reads its last real state (vesta_shared.asleep), never "unavailable"
        res = status(pack, read_states(cli, pack, datetime.now(timezone.utc)) if cli else {}, store)
    else:
        areas = pack.places(a.where)
        res = {"targets": find(pack, a.what, a.where),
               "place": {"areas": areas} if areas else {"by_name": bool(a.where)}}
    print(json.dumps(res, indent=1, default=str))
    return 0 if res.get("ok", True) else 2


if __name__ == "__main__":
    sys.exit(main())
