#!/usr/bin/env python3
"""reports: the composer — the chat texts, and the weekly and monthly pages from their facts.

  compose.py fm-daily      --pack pack.json --store S [--as-of D]                 -> text (chat)
  compose.py owner-weekly  --pack pack.json --store S --energy week.json          -> 3 lines (chat)
  compose.py fm-weekly     --facts facts.json [--notes notes.json] --out page.html
  compose.py owner-monthly --facts facts.json [--notes notes.json] --out page.html

A page is built from facts.py's figures (every number) and the AI's notes.json (the sentences
reports.yaml asks for, saved with the save_file tool), laid out by templates/report.html and its
blocks/<section>.html, in reports.yaml's order.

⚠️ A SENTENCE MAY ONLY USE ITS SECTION'S FIGURES. Each note is checked: a number in it that is
not in the figures of the section it belongs to rejects the note (the page shows the plain
fallback instead), and the result says which and why. The model writes words, never numbers.

The page is sent as the HTML file itself, attached to the chat message: one self-contained file
(CSS and charts inline, nothing fetched) that the phone opens in its browser and can print or
save as PDF (owner, 2026-09-30: no PDF made here).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))
sys.path.insert(0, HERE)
import charts  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.messaging import fmt_money, split_message  # noqa: E402
from vesta_shared.store import Store  # noqa: E402

TPL = Environment(loader=FileSystemLoader(os.path.join(HERE, "..", "templates")), autoescape=True)
CSS = open(os.path.join(HERE, "..", "templates", "vesta.css"), encoding="utf-8").read()
NUM = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?")


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


# ---------------------------------------------------------------- the AI's sentences, checked
def _numbers(obj, out: set[float]) -> set[float]:
    """Every number a section's figures hold, dates' parts included (a day, a month, a year)."""
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        out.add(round(float(obj), 6))
    elif isinstance(obj, str):
        for m in NUM.findall(obj):
            out.add(round(float(m.replace(",", "")), 6))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers(v, out)
    return out


def note_ok(text: str, figures) -> tuple[bool, str]:
    """True when every number in the sentence is one of the figures (as written, rounded, or without its sign)."""
    allowed = _numbers(figures, set())
    for m in NUM.findall(text or ""):
        n = float(m.replace(",", ""))
        if not any(abs(n - f) < 1e-6 or abs(n - round(f)) < 1e-6 or abs(n - round(f, 1)) < 1e-6
                   or abs(n - abs(f)) < 1e-6 or abs(n - round(abs(f))) < 1e-6 or abs(n - round(abs(f), 1)) < 1e-6
                   for f in allowed):
            return False, f"{m} is not one of this section's figures"
    return True, ""


def checked_notes(facts: dict, notes: dict) -> tuple[dict, list[dict]]:
    asked = {w["id"]: w["figures"] for w in facts.get("to_write") or []}
    good, refused = {}, []
    for nid, text in (notes or {}).items():
        if nid not in asked:
            refused.append({"id": nid, "why": "reports.yaml does not ask for this sentence"})
            continue
        ok, why = note_ok(str(text), asked[nid])
        if ok:
            good[nid] = str(text).strip()
        else:
            refused.append({"id": nid, "why": why})
    return good, refused


# ---------------------------------------------------------------- the page
def page(facts: dict, notes: dict) -> str:
    def num(v, nd=1):
        if v is None:
            return "—"
        return f"{v:,.0f}" if nd == 0 or (isinstance(v, (int, float)) and float(v).is_integer()) else f"{v:,.{nd}f}"

    def pct(v):
        return "—" if v is None else f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.0f}%"

    def day(s):
        try:
            return date.fromisoformat(str(s)[:10]).strftime("%a %d %b")
        except ValueError:
            return s or ""

    sections = facts.get("sections") or {}
    header = sections.get("header") or {}
    return TPL.get_template("report.html").render(
        css=CSS, title=header.get("title") or facts.get("villa", ""), eyebrow=facts.get("eyebrow", ""),
        order=facts.get("order") or [], sections=sections, note=lambda k: notes.get(k, ""),
        num=num, pct=pct, day=day, money=lambda v, cur: fmt_money(v, cur) if v else "—",
        chart_line=lambda *a: Markup(charts.line(*a)), chart_bars=lambda b: Markup(charts.bars(b)),
        chart_pairs=lambda r: Markup(charts.pairs(r)))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-daily", "fm-weekly", "owner-weekly", "owner-monthly"])
    ap.add_argument("--pack"); ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--zone"); ap.add_argument("--energy"); ap.add_argument("--as-of")
    ap.add_argument("--facts"); ap.add_argument("--notes"); ap.add_argument("--out")
    a = ap.parse_args(argv)

    if a.cmd in ("fm-weekly", "owner-monthly"):
        if not a.facts:
            print(f"{a.cmd} needs --facts: first run facts.py {a.cmd} --energy <period>.json --out facts.json.", file=sys.stderr)
            return 1
        facts = json.load(open(a.facts, encoding="utf-8"))
        notes = json.load(open(a.notes, encoding="utf-8")) if a.notes else {}
        good, refused = checked_notes(facts, notes if isinstance(notes, dict) else {})
        html = page(facts, good)
        res = {"html_chars": len(html), "notes_used": sorted(good), "notes_refused": refused,
               "missing_notes": sorted(w["id"] for w in facts.get("to_write") or [] if w["id"] not in good),
               "problems": facts.get("problems") or []}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(html)
            res["html"] = a.out
        print(json.dumps(res, indent=1)); return 0

    if a.cmd == "owner-weekly" and not a.energy:
        print("owner-weekly needs --energy: first run roi-energy energy_period.py --period week --out <file>.json, "
              "then pass that file.", file=sys.stderr)
        return 1
    if not a.pack:
        print(f"{a.cmd} needs --pack.", file=sys.stderr); return 1
    pack = KnowledgePack.load(a.pack)
    store = Store(a.store)
    Z = ZoneInfo(a.zone or pack.time_zone)
    as_of = date.fromisoformat(a.as_of) if a.as_of else datetime.now(Z).date()
    if a.cmd == "fm-daily":
        print(json.dumps({"messages": split_message(fm_daily(pack, store, as_of))}, indent=1)); return 0
    print(json.dumps({"messages": [owner_weekly(pack, store, json.load(open(a.energy)))]}, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())
