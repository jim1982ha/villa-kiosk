#!/usr/bin/env python3
"""villa-concierge: the villa status and the closed action catalogue.

  concierge.py status   --pack pack.json [--fixture-dir DIR] [--store S]      "is everything OK"
  concierge.py find     --pack pack.json --what "lights" --where "kitchen"   resolve a target
  concierge.py propose  --pack pack.json --action light.off --where kitchen --role tenant [--store S]
  concierge.py execute  --pack pack.json --proposal-id 3 --role tenant --confirmed [--store S] [--fixture-dir DIR]
  concierge.py readback --pack pack.json --proposal-id 3 [--fixture-dir DIR]

Every command prints JSON. The agent (the model) does the language part:
it turns "éteins la cuisine" into action=light.off, where=kitchen, then
follows propose -> (confirm) -> execute -> readback. The scripts refuse
anything outside catalogue.yaml.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from datetime import datetime, timedelta, timezone

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))
from vesta_shared.ha_client import client_from_args  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.params import VillaParams  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)
from vesta_shared.store import Store  # noqa: E402

CAT = yaml.safe_load(open(os.path.join(HERE, "..", "catalogue.yaml"), encoding="utf-8"))


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


# ------------------------------------------------------------------ propose
def propose(pack: KnowledgePack, store: Store, action: str, role: str, where: str | None, what: str | None,
            value: str | None, now: datetime) -> dict:
    spec = CAT["actions"].get(action)
    if not spec:
        return {"ok": False, "refused": f"'{action}' is not in the catalogue."}
    if role not in spec["roles"]:
        return {"ok": False, "refused": f"Role {role} may not do {action}."}
    if spec.get("via") and spec["via"] != role and role != "agent":
        return {"ok": False, "refused": f"{action} is only reachable through {spec['via']}."}
    targets = []
    if spec.get("domains") and not action.startswith(("todo", "helper", "registry", "maintenance")):
        targets = find(pack, what, where, spec.get("domains"))
        targets = [t for t in targets if t["family"] in spec.get("families", [t["family"]])]
        for pat in spec.get("forbid_assets_matching", []):
            targets = [t for t in targets if pat not in t["asset"]]
        if not targets:
            return {"ok": False, "refused": f"No {', '.join(spec['domains'])} matching '{what or ''}' in '{where or 'the villa'}' in the knowledge pack."}
    elif action.startswith("helper") and what:
        allowed = spec.get("allow_matching", [])
        if not any(p in what for p in allowed):
            return {"ok": False, "refused": f"Helper {what} is not in the allowed list for {action}."}
        targets = [{"entity_id": what, "name": what, "area": None, "family": "system", "asset": what}]
    elif action == "registry.set_area" and what:
        targets = [{"entity_id": what, "name": what, "area": value, "family": "registry", "asset": what}]
    elif action.startswith("todo"):
        targets = [{"entity_id": "todo", "name": value or "", "area": None, "family": "system", "asset": "todo"}]
    prop = {"action": action, "role": role, "targets": targets, "value": value,
            "needs_confirmation": bool(spec.get("confirm")), "created_at": now.isoformat(),
            "expires_at": (now + timedelta(minutes=CAT["confirmation_ttl_min"])).isoformat(),
            "expect_state": spec.get("expect_state")}
    pid = store.add_proposal("action", f"{action} {where or ''} {what or ''} {now.isoformat()}", json.dumps(prop), "")
    prop["proposal_id"] = pid
    names = ", ".join(f"{t['name']} ({t['area']})" if t.get("area") else t["name"] for t in targets)
    if spec.get("confirm"):
        prop["confirmation_text"] = f"I will {action.replace('.', ' ')} on: {names}. Reply YES within {CAT['confirmation_ttl_min']} min to confirm."
    else:
        prop["confirmation_text"] = None
    prop["ok"] = True
    return prop


# ------------------------------------------------------------------ execute
def execute(pack: KnowledgePack, store: Store, cli, pid: int, role: str, confirmed: bool, now: datetime) -> dict:
    row = next((p for p in store.proposals(status="open") if p["id"] == pid), None)
    if not row:
        return {"ok": False, "refused": f"Proposal {pid} not found or already used."}
    prop = json.loads(row["detail"])
    spec = CAT["actions"][prop["action"]]
    if datetime.fromisoformat(prop["expires_at"]) < now:
        store.decide_proposal(pid, "expired")
        return {"ok": False, "refused": "The proposal expired, ask again."}
    if spec.get("confirm") and not confirmed:
        return {"ok": False, "refused": "Confirmation required (reply YES)."}
    if role != prop["role"] and role != "agent":
        return {"ok": False, "refused": "The confirmation must come from the person who asked."}
    calls = []
    for t in prop["targets"]:
        svc = spec.get("service")
        if not svc:
            calls.append({"tool": spec.get("tool"), "entity_id": t["entity_id"], "value": prop.get("value")}); continue
        data = {"entity_id": t["entity_id"]}
        dom = t["entity_id"].split(".")[0]
        service = dict(svc)
        if prop["action"].startswith("light") and dom == "switch":
            service["domain"] = "switch"
        if prop["action"].startswith("helper.set"):
            key = "option" if prop["action"] == "helper.set_select" else ("datetime" if prop["action"] == "helper.set_datetime" else "value")
            data[key] = prop.get("value")
        res = cli.call_service(service["domain"], service["service"], data)
        calls.append({"service": f"{service['domain']}.{service['service']}", "data": data, "result": res})
    store.decide_proposal(pid, "executed")
    store.audit("villa-concierge", prop["action"], {"by": role, "targets": [t["entity_id"] for t in prop["targets"]], "value": prop.get("value")})
    return {"ok": True, "proposal_id": pid, "calls": calls, "expect_state": prop.get("expect_state"),
            "readback_entities": [t["entity_id"] for t in prop["targets"] if "." in t["entity_id"]]}


def readback(cli, entities: list[str], expect: str | None) -> dict:
    states = cli.states(entities)
    rows = [{"entity_id": e, "state": states.get(e, {}).get("state"), "ok": (expect is None or states.get(e, {}).get("state") == expect)} for e in entities]
    ok = all(r["ok"] for r in rows)
    text = ("Done: " + ", ".join(f"{r['entity_id'].split('.')[1]} is {r['state']}" for r in rows)) if ok else \
           ("Not confirmed: " + ", ".join(f"{r['entity_id']} reads {r['state']}" for r in rows if not r["ok"]) + ". I will not retry by myself.")
    return {"ok": ok, "rows": rows, "text": text}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "find", "propose", "execute", "readback"])
    ap.add_argument("--pack", required=True)
    ap.add_argument("--fixture-dir"); ap.add_argument("--zone")
    ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--action"); ap.add_argument("--what"); ap.add_argument("--where"); ap.add_argument("--value")
    ap.add_argument("--role", default="owner"); ap.add_argument("--proposal-id", type=int); ap.add_argument("--confirmed", action="store_true")
    ap.add_argument("--entities", nargs="*"); ap.add_argument("--expect")
    ap.add_argument("--now")
    a = ap.parse_args(argv)
    pack = KnowledgePack.load(a.pack)
    store = Store(a.store)
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(timezone.utc)
    cli = client_from_args(a) if (a.fixture_dir or os.environ.get("VESTA_HA_MCP_URL")) else None
    if a.cmd == "status":
        res = status(pack, cli.states() if cli else {}, store)
    elif a.cmd == "find":
        areas = place(pack, a.where)
        res = {"targets": find(pack, a.what, a.where),
               "place": {"areas": areas} if areas else {"by_name": bool(a.where)}}
    elif a.cmd == "propose":
        res = propose(pack, store, a.action, a.role, a.where, a.what, a.value, now)
    elif a.cmd == "execute":
        res = execute(pack, store, cli, a.proposal_id, a.role, a.confirmed, now)
    else:
        res = readback(cli, a.entities or [], a.expect)
    print(json.dumps(res, indent=1, default=str))
    return 0 if res.get("ok", True) else 2


if __name__ == "__main__":
    sys.exit(main())
