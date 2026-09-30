#!/usr/bin/env python3
"""reports: one composer for the FM daily digest, the FM weekly page, the
owner weekly three lines, the owner monthly proof (HTML and PDF).

  compose.py fm-daily      --pack pack.json --store S [--as-of D]                     -> text (chat)
  compose.py fm-weekly     --pack pack.json --store S --energy week.json [--out f.html] [--pdf]
  compose.py owner-weekly  --pack pack.json --store S --energy week.json              -> 3 lines
  compose.py owner-monthly --pack pack.json --store S --energy month.json [--optimiser o.json] [--proposals p.json] --out f.html --pdf

Inputs are the JSON files the other skills produced (roi-energy period,
optimiser, proposals) plus the store. No Home Assistant read here: the
composer assembles, it does not fetch. The model phrases the headline from
the `facts` block the composer prints; everything else is templated.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.messaging import split_message, fmt_money  # noqa: E402

TPL = Environment(loader=FileSystemLoader(os.path.join(HERE, "..", "templates")), autoescape=True)
CSS = open(os.path.join(HERE, "..", "templates", "vesta.css"), encoding="utf-8").read()


def _h(d: date) -> str:
    return d.strftime("%A %d %B %Y")


def open_task_rows(store: Store, since_day: str | None = None) -> list[dict]:
    rows = []
    for f in store.findings(status="open"):
        if f["severity"] not in ("P1", "P2", "P3"):
            continue
        detail = json.loads(f["detail"] or "{}")
        rows.append({"severity": f["severity"], "title": f["summary"], "why": f"Since {f['opened_day']}.",
                     "check": detail.get("check") or "", "opened_day": f["opened_day"]})
    for i in store.incidents(open_only=True):
        payload = json.loads(i["payload"] or "{}")
        rows.append({"severity": i["severity"], "title": payload.get("message") or i["rule_id"],
                     "why": f"Incident #{i['id']}, state {i['state']}, {i['count']} occurrence(s) since {i['opened_at'][:10]}.",
                     "check": "", "opened_day": i["opened_at"][:10]})
    order = {"P1": 0, "P2": 1, "P3": 2}
    rows.sort(key=lambda r: (order.get(r["severity"], 9), r["opened_day"]))
    return rows


def offline_now(pack: KnowledgePack, store: Store) -> tuple[list[str], int]:
    names, crit = [], 0
    for f in store.findings(status="open"):
        if f["rule_id"] == "PM-UNAVAILABLE":
            names.append(f["summary"].split(" has been offline")[0])
            crit += 1 if f["severity"] == "P2" else 0
    return names, crit


def fm_daily(pack: KnowledgePack, store: Store, as_of: date) -> str:
    """The 07:00 digest: what is new since yesterday, what is still open, nothing else."""
    yesterday = (as_of - timedelta(days=1)).isoformat()
    new = [f for f in store.findings(since_day=yesterday) if f["severity"] in ("P2", "P3")]
    digest_inc = [i for i in store.incidents(open_only=True) if i["state"] == "digest" and i["opened_at"][:10] >= yesterday]
    open_tasks = store.tasks("open")
    lines = [f"{pack.villa}, {as_of.strftime('%a %d %b')} morning."]
    if new:
        lines.append("New:")
        lines += [f"- {f['severity']} {f['summary']}" for f in new]
    if digest_inc:
        lines.append("Also noted (no action needed yet):")
        lines += [f"- {json.loads(i['payload'] or '{}').get('message') or i['rule_id']}" for i in digest_inc]
    if open_tasks:
        lines.append(f"Still open: {len(open_tasks)} task(s). Reply with the number and Done, Not found or Need help.")
        lines += [f"- #{t['id']} {t['summary'].split(' Check: ')[0][:160]}" for t in open_tasks[:8]]
    if len(lines) == 1:
        lines.append("Nothing new, nothing open.")
    return "\n".join(lines)


def owner_weekly(pack: KnowledgePack, store: Store, energy: dict) -> str:
    inc = [i for i in store.incidents(open_only=False) if i["opened_at"][:10] >= energy["start"]]
    p1 = sum(1 for i in inc if i["severity"] == "P1")
    open_tasks = len(store.tasks("open"))
    kwh = f"{energy['total_kwh']:.0f} kWh" if energy.get("total_kwh") is not None else "kWh n/a"
    vs = f" ({energy['total_vs_prev_pct']:+.0f}%)" if energy.get("total_vs_prev_pct") is not None else ""
    cost = f", {fmt_money(energy['total_cost'], energy['currency'])}" if energy.get("total_cost") else ""
    return (f"{pack.villa}, week to {energy['end']}: {kwh}{vs}{cost}.\n"
            f"{len(inc)} alert(s), {p1} critical; {open_tasks} FM task(s) open.\n"
            + ("All quiet." if not open_tasks and not p1 else "Details in the FM weekly page."))


def _name(pack, entity_id: str) -> str:
    for rows in pack.families.values():
        for r in rows:
            if r.get("entity_id") == entity_id and r.get("name"):
                return r["name"]
    return entity_id.split(".", 1)[-1].replace("_", " ").capitalize()


def render(template: str, ctx: dict, out: str | None, pdf: bool) -> dict:
    html = TPL.get_template(template).render(css=CSS, **ctx)
    res = {"html_chars": len(html)}
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        res["html"] = out
        if pdf:
            pdf_path = os.path.splitext(out)[0] + ".pdf"
            res["pdf"] = to_pdf(out, pdf_path)
    else:
        res["html_text"] = html
    return res


def to_pdf(html_path: str, pdf_path: str) -> str | None:
    """Print the page to PDF with the system Chromium (no Playwright: lighter on 4 GB shared with Home Assistant)."""
    import shutil
    import subprocess
    # The VESTA Agent host installs Debian's chromium-headless-shell (the headless build only,
    # ~200 MB lighter than the full browser); a full chromium works too.
    exe = (os.environ.get("VESTA_CHROMIUM") or shutil.which("chromium-headless-shell") or shutil.which("chromium")
           or shutil.which("chromium-browser") or shutil.which("google-chrome"))
    if not exe:
        return None
    # the headless shell IS headless and knows only the plain flag; the full browser needs the new mode named
    headless = "--headless" if "headless-shell" in os.path.basename(exe) else "--headless=new"
    cmd = [exe, headless, "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-pdf-header-footer",
           f"--print-to-pdf={pdf_path}", "file://" + os.path.abspath(html_path)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return None
    return pdf_path if os.path.exists(pdf_path) else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-daily", "fm-weekly", "owner-weekly", "owner-monthly"])
    ap.add_argument("--pack", required=True); ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--energy"); ap.add_argument("--optimiser"); ap.add_argument("--proposals")
    ap.add_argument("--as-of"); ap.add_argument("--out"); ap.add_argument("--pdf", action="store_true")
    a = ap.parse_args(argv)
    pack = KnowledgePack.load(a.pack)
    store = Store(a.store)
    Z = ZoneInfo(pack.time_zone)
    as_of = date.fromisoformat(a.as_of) if a.as_of else datetime.now(Z).date()
    generated_h = datetime.now(Z).strftime("%a %d %b %Y, %H:%M") + f" {pack.time_zone}"

    if a.cmd == "fm-daily":
        text = fm_daily(pack, store, as_of)
        print(json.dumps({"messages": split_message(text)}, indent=1)); return 0

    energy = json.load(open(a.energy)) if a.energy else {"loads": [], "pumps": [], "start": as_of.isoformat(), "end": as_of.isoformat()}
    if a.cmd == "owner-weekly":
        print(json.dumps({"messages": [owner_weekly(pack, store, energy)]}, indent=1)); return 0

    tasks = open_task_rows(store)
    offline, offline_crit = offline_now(pack, store)
    start, end = date.fromisoformat(energy["start"]), date.fromisoformat(energy["end"])
    inc = [i for i in store.incidents(open_only=False) if energy["start"] <= i["opened_at"][:10] <= energy["end"]]
    colour = "crit" if any(t["severity"] == "P1" for t in tasks) else ("warn" if tasks else "good")
    light_text = {"crit": "Red: something needs you now", "warn": f"Amber: {len(tasks)} thing(s) need you, no emergency", "good": "Green: nothing open"}[colour]
    facts = {"tasks": [t["title"] for t in tasks], "energy_headline": energy.get("headline"), "offline": offline}
    ctx = dict(villa=pack.villa, start_h=_h(start), end_h=_h(end), generated_h=generated_h, colour=colour, light_text=light_text,
               headline=energy.get("headline", ""), energy=energy, tasks_open=tasks,
               tasks_new=sum(1 for t in tasks if t["opened_day"] >= energy["start"]), incidents_week=len(inc),
               incidents_p1=sum(1 for i in inc if i["severity"] == "P1"), offline=offline, offline_critical=offline_crit,
               unknown_room=pack.unknown_area, muted=[_name(pack, m['entity_id']) for m in store.mutes()],
               pump_status={f["entity_id"].split(".")[1].rsplit("_power", 1)[0]: "watch" for f in store.findings(status="open") if f["family"] == "power"},
               notes=[f["summary"] for f in store.findings(status="open") if f["rule_id"] == "PM-PARAM-MISSING"])
    if a.cmd == "fm-weekly":
        ctx["week"] = start.isocalendar()[1]
        res = render("fm_weekly.html", ctx, a.out, a.pdf)
        res["facts"] = facts; print(json.dumps(res, indent=1)); return 0

    # owner monthly
    closed = [i for i in inc if i.get("closed_at")]
    durations = [(datetime.fromisoformat(i["closed_at"]) - datetime.fromisoformat(i["opened_at"])).total_seconds() / 3600 for i in closed]
    med_h = f"{statistics.median(durations):.1f} h" if durations else "n/a"
    findings = [f for f in store.findings() if energy["start"] <= f["opened_day"] <= energy["end"] and f["severity"] != "INFO"]
    for l in energy.get("loads", []):
        fs = l.get("first_seen")
        l["first_seen_recent"] = bool(fs and (datetime.now(timezone.utc) - datetime.fromisoformat(fs)).days < 30)
    optimiser = json.load(open(a.optimiser)) if a.optimiser else None
    proposals = json.load(open(a.proposals)) if a.proposals else store.proposals("open")
    fx = None
    cost_usd = None
    if energy.get("total_cost") and optimiser and optimiser.get("ok"):
        pass
    ctx.update(month_h=start.strftime("%B %Y"), cost_h=fmt_money(energy["total_cost"], energy["currency"]) if energy.get("total_cost") else "n/a",
               cost_usd=cost_usd, incidents_month=len(inc), incidents_closed=len(closed), median_close_h=med_h,
               findings=findings, optimiser=optimiser if optimiser and optimiser.get("ok") else None, proposals=proposals,
               coverage_text=(f"{len(pack.families.get('energy', []))} energy meters, {len(pack.families.get('power', []))} power meters, "
                              f"{len(pack.families.get('security', []))} security devices, {len(pack.families.get('battery', []))} batteries watched. "
                              f"Water: {'measured' if pack.families.get('water') else 'not measured'}. Solar: {'measured' if pack.families.get('generation') else 'none'}. "
                              f"Retention: raw history {pack.retention['raw_history_days']} days, statistics permanent, agent store {pack.retention['agent_feature_store_months']} months, photos {pack.retention['photos_days']} days."))
    res = render("owner_monthly.html", ctx, a.out, a.pdf)
    res["facts"] = facts; print(json.dumps(res, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())
