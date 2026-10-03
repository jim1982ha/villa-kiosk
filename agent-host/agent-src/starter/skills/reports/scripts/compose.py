#!/usr/bin/env python3
"""reports: the composer — the chat texts, and the weekly and monthly pages from their facts.

  compose.py fm-daily      --pack pack.json --store S [--as-of D]                 -> text (chat)
  compose.py owner-weekly  --pack pack.json --store S --energy week.json          -> 3 lines (chat)
  compose.py fm-weekly     --facts facts.json [--notes notes.json] --out page.html
  compose.py owner-monthly --facts facts.json [--notes notes.json] --out page.html

A page is built from facts.py's FIGURES and the AI's notes.json (the sentences reports.yaml asks
for, saved with the save_file tool), laid out by templates/report.html (one part per section, in
reports.yaml's order; its style and the charts below are inline).

⚠️ TWO KINDS OF SENTENCE (owner, 2026-10-01; agent-host/docs/adr/0001). A READING is the AI's own
conclusion: it may carry numbers the AI found in Home Assistant, it is not checked, and the page marks
it "VESTA's reading". A slot reports.yaml marks `checked: true` is a summary of the figures: a number
in it that is not one of its section's figures refuses it.

When the AI job's spending limit stops it, the job's on_limit step runs
  compose.py fm-weekly --facts facts.json --notes notes.json --out page.html --finish fm --since <start> --limit 2
which still builds the page with what is done ("not written: this report reached its limit" in the
empty slots) and prints the message that sends it — unless facts.json is older than the job (the limit
came before the figures): then it says so instead of sending last period's page.

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
from html import escape as _esc
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup, escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))
sys.path.insert(0, HERE)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.messaging import fmt_money, split_message  # noqa: E402
from vesta_shared.store import Store  # noqa: E402
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)

TPL = Environment(loader=FileSystemLoader(os.path.join(HERE, "..", "templates")), autoescape=True)
NUM = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?")


def _grouped(lines: list[tuple[str, str, str]], group_from: int, words: dict) -> list[str]:
    """(kind, severity, text) -> chat lines: a kind with at least `group_from` items and a group line in
    reports.yaml (todo_groups) is ONE line naming its members, the way the weekly page groups them."""
    kinds: dict[str, list[tuple[str, str]]] = {}
    for kind, sev, text in lines:
        kinds.setdefault(kind, []).append((sev, text))
    out = []
    for kind, items in kinds.items():
        title = words.get(kind)
        if len(items) >= group_from and title:
            names = [t.split(" has ")[0].split(" dropped ")[0] for _, t in items]
            shown = ", ".join(names[:8]) + (f" and {len(names) - 8} more" if len(names) > 8 else "")
            out.append(f"- {items[0][0]} {title.format(n=len(items))}: {shown}.")
        else:
            out += [f"- {sev} {text}" for sev, text in items]
    return out


def fm_daily(pack: KnowledgePack, store: Store, as_of: date) -> str:
    """The 07:00 digest: what is new since yesterday, what is still open, nothing else.

    ⚠️ EACH THING ONCE (villa, 2026-10-04): "Still open" re-listed the night's new findings right under
    "New", and 21 silent sensors were 21 lines. New ones are not repeated, and a kind with enough items
    is one line (reports.yaml todo.group_from / todo_groups — the weekly page's own grouping)."""
    from facts import load_cfg
    cfg = load_cfg()
    group_from = int(((cfg.get("thresholds") or {}).get("todo") or {}).get("group_from") or 3)
    words = {k: v for k, v in (cfg.get("todo_groups") or {}).items() if k != "same_time"}
    yesterday = (as_of - timedelta(days=1)).isoformat()
    new = [f for f in store.findings(since_day=yesterday) if f["severity"] in ("P2", "P3")]
    digest_inc = [i for i in store.incidents(open_only=True) if i["state"] == "digest" and i["opened_at"][:10] >= yesterday]
    shown_new = {f"finding:{f['id']}" for f in new}
    open_now = [p for p in Problems(store).open_problems() if p["source"] not in shown_new]
    lines = [f"{pack.villa}, {as_of.strftime('%a %d %b')} morning."]
    if new:
        lines.append("New:")
        lines += _grouped([(f["rule_id"], f["severity"], f["summary"]) for f in new], group_from, words)
    if digest_inc:
        lines.append("Also noted (no action needed yet):")
        lines += [f"- {json.loads(i['payload'] or '{}').get('message') or i['rule_id']}" for i in digest_inc]
    if open_now:
        # ⚠️ "#N" ONLY WHERE "#N done" WORKS: an alert's incident number. It used to print task numbers,
        # which no reply could close; a maintenance finding is closed in the VESTA Kiosk instead.
        lines.append(f"Still open: {len(open_now)}. An alert: reply with its number and Done, Not found or Need help; "
                     "the rest: close it in the VESTA Kiosk (Facility → Faults) when it is done.")
        alerts = [p for p in open_now if p["incident"]]
        lines += [f"- #{p['incident']} {p['title'][:160]}" for p in alerts]
        lines += _grouped([(p["rule_id"], p["severity"], p["title"][:160]) for p in open_now if not p["incident"]],
                          group_from, words)[:8]
    if len(lines) == 1:
        lines.append("Nothing new, nothing open.")
    return "\n".join(lines)


def owner_weekly(pack: KnowledgePack, store: Store, energy: dict) -> str:
    inc = [i for i in store.incidents(open_only=False) if i["opened_at"][:10] >= energy["start"]]
    p1 = sum(1 for i in inc if i["severity"] == "P1")
    open_tasks = len(Problems(store).open_problems())
    kwh = f"{energy['total_kwh']:.0f} kWh" if energy.get("total_kwh") is not None else "kWh n/a"
    vs = f" ({energy['total_vs_prev_pct']:+.0f}%)" if energy.get("total_vs_prev_pct") is not None else ""
    cost = f", {fmt_money(energy['total_cost'], energy['currency'])}" if energy.get("total_cost") else ""
    return (f"{pack.villa}, week to {energy['end']}: {kwh}{vs}{cost}.\n"
            f"{len(inc)} alert(s), {p1} critical; {open_tasks} FM task(s) open.\n"
            + ("All quiet." if not open_tasks and not p1 else "Details in the FM weekly page."))


# ---------------------------------------------------------------- the charts
# Drawn as inline SVG: nothing fetched, nothing run in the reader's browser, and they print as they
# show. Colours are the page's custom properties (templates/report.html).
W, H, PAD_L, PAD_R, PAD_T, PAD_B = 400, 150, 34, 12, 14, 22


def _scale(lo: float, hi: float, top: float, bottom: float):
    span = (hi - lo) or 1.0
    return lambda v: bottom - (v - lo) / span * (bottom - top)


def _ticks(lo: float, hi: float, n: int = 4) -> tuple[float, float, list[float]]:
    """A readable Y axis (owner, 2026-10-01: "always the Y axis and grid lines"): about `n` steps of 1, 2,
    2.5 or 5 times a power of ten, from a round value at or under `lo` to one at or over `hi`."""
    import math
    span = (hi - lo) or abs(hi) or 1.0
    raw = span / n
    mag = 10 ** math.floor(math.log10(raw))
    step = next(k * mag for k in (1, 2, 2.5, 5, 10) if k * mag >= raw)
    first, last = math.floor(lo / step) * step, math.ceil(hi / step) * step
    ticks, v = [], first
    while v <= last + step / 2:
        ticks.append(round(v, 10))
        v += step
    return first, last, ticks


def _axis(ticks: list[float], y, x0: float, x1: float) -> list[str]:
    """The grid lines and their values, left of the chart: the base line solid, the others dashed."""
    import math
    step = ticks[1] - ticks[0] if len(ticks) > 1 else 1
    digits = max(0, -math.floor(math.log10(step) + 1e-9)) if step < 1 else (1 if step % 1 else 0)   # 0.5 → 1, 2.5 → 1
    out = []
    for i, v in enumerate(ticks):
        dash = "" if i == 0 else ' stroke-dasharray="3 3"'
        out.append(f'<line x1="{x0}" x2="{x1}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="var(--grid)"{dash}/>'
                   f'<text x="{x0 - 4}" y="{y(v) + 3.5:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{v:,.{digits}f}</text>')
    return out


def _nice(v: float) -> str:
    return f"{v:,.0f}" if abs(v) >= 10 else f"{v:.2f}".rstrip("0").rstrip(".")


def _day(s: str) -> str:
    try:
        return date.fromisoformat(s).strftime("%d %b").lstrip("0")
    except ValueError:
        return s


def line(series: list, unit: str = "", ref: float | None = None, area: bool = False, colour: str = "var(--acc)") -> str:
    """A day-by-day line, its last value labelled; `ref` draws a dashed limit (an alert threshold)."""
    pts = [(d, float(v)) for d, v in series if v is not None]
    if len(pts) < 2:
        return '<p class="note">Not enough data to draw.</p>'
    vals = [v for _, v in pts] + ([ref] if ref is not None else [])
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.15 or abs(hi) * 0.1 or 1
    lo, hi, ticks = _ticks(0 if lo >= 0 and lo - pad < 0 else lo - pad, hi + pad)
    y = _scale(lo, hi, PAD_T, H - PAD_B)
    step = (W - PAD_L - PAD_R) / (len(pts) - 1)
    xy = [(PAD_L + i * step, y(v)) for i, (_, v) in enumerate(pts)]
    path = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{yy:.1f}" for i, (x, yy) in enumerate(xy))
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{_esc(unit)} per day">', *_axis(ticks, y, PAD_L, W - PAD_R)]
    if ref is not None:
        out.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{y(ref):.1f}" y2="{y(ref):.1f}" stroke="var(--crit)" stroke-dasharray="4 4"/>')
    if area:
        out.append(f'<path d="{path} L{xy[-1][0]:.1f},{y(lo):.1f} L{xy[0][0]:.1f},{y(lo):.1f} Z" fill="{colour}" opacity=".12"/>')
    lx, ly = xy[-1]
    out += [f'<path d="{path}" fill="none" stroke="{colour}" stroke-width="2"/>',
            f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3.5" fill="{colour}"/>',
            f'<text x="{lx - 6:.1f}" y="{ly - 8:.1f}" font-size="11" font-weight="600" text-anchor="end" fill="var(--ink)">'
            f'{_nice(pts[-1][1])}{(" " + _esc(unit)) if unit else ""}</text>',
            f'<text x="{PAD_L}" y="{H - 6}" font-size="10" fill="var(--ink2)">{_esc(_day(pts[0][0]))}</text>',
            f'<text x="{W - PAD_R}" y="{H - 6}" font-size="10" text-anchor="end" fill="var(--ink2)">{_esc(_day(pts[-1][0]))}</text>',
            "</svg>"]
    return "".join(out)


def bars(items: list, highlight_last: bool = True) -> str:
    """Bars with a label under each and the value of the last one on top (the weekly trend)."""
    got = [b for b in items if b.get("value") is not None]
    if not got:
        return '<p class="note">Not enough data to draw.</p>'
    _, hi, ticks = _ticks(0, max(b["value"] for b in got) or 1)
    y = _scale(0, hi, PAD_T, H - PAD_B)
    n = len(items)
    slot = (W - PAD_L - PAD_R) / n
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="bars">', *_axis(ticks, y, PAD_L, W - PAD_R)]
    for i, b in enumerate(items):
        x = PAD_L + i * slot + slot * 0.18
        w = slot * 0.64
        last = highlight_last and i == n - 1
        if b.get("value") is not None:
            out.append(f'<rect x="{x:.1f}" y="{y(b["value"]):.1f}" width="{w:.1f}" height="{y(0) - y(b["value"]):.1f}" rx="2" '
                       f'fill="{"var(--acc)" if last else "var(--c3)"}"/>')
            if last:
                out.append(f'<text x="{x + w / 2:.1f}" y="{y(b["value"]) - 4:.1f}" font-size="10" text-anchor="middle" '
                           f'fill="var(--ink)">{_nice(b["value"])}</text>')
        out.append(f'<text x="{x + w / 2:.1f}" y="{H - 6}" font-size="9" text-anchor="middle" fill="var(--ink2)">{_esc(str(b["label"]))}</text>')
    out.append("</svg>")
    return "".join(out)


def pairs(rows: list) -> str:
    """This period against the last one, day by day (kWh per day of the whole villa)."""
    vals = [v for r in rows for v in (r.get("kwh"), r.get("prev_kwh")) if v is not None]
    if not vals:
        return '<p class="note">Not enough data to draw.</p>'
    _, hi, ticks = _ticks(0, max(vals))
    w_, h = 2 * W, 220                       # a full-width chart: twice the cards' width, same text size
    y = _scale(0, hi, PAD_T, h - PAD_B)
    slot = (w_ - PAD_L - PAD_R) / len(rows)
    out = [f'<svg viewBox="0 0 {w_} {h}" role="img" aria-label="kWh per day, this period and the last">', *_axis(ticks, y, PAD_L, w_ - PAD_R)]
    for i, r in enumerate(rows):
        x0 = PAD_L + i * slot + slot * 0.12
        w = slot * 0.36
        for k, (v, fill) in enumerate(((r.get("prev_kwh"), "var(--grid)"), (r.get("kwh"), "var(--acc)"))):
            if v is None:
                continue
            x = x0 + k * w
            out.append(f'<rect x="{x:.1f}" y="{y(v):.1f}" width="{w - 1:.1f}" height="{y(0) - y(v):.1f}" rx="2" fill="{fill}"/>')
            if k == 1:
                out.append(f'<text x="{x + w / 2:.1f}" y="{y(v) - 4:.1f}" font-size="10" text-anchor="middle" fill="var(--ink)">{_nice(v)}</text>')
        out.append(f'<text x="{x0 + w:.1f}" y="{h - 6}" font-size="10" text-anchor="middle" fill="var(--ink2)">{_esc(r["day"])}</text>')
    out.append("</svg>")
    return "".join(out)


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
    asked = {w["id"]: w for w in facts.get("to_write") or []}
    good, refused = {}, []
    for nid, text in (notes or {}).items():
        if nid not in asked:
            refused.append({"id": nid, "why": "reports.yaml does not ask for this sentence"})
            continue
        if not str(text).strip():
            continue
        if asked[nid].get("kind", "reading") == "reading":
            good[nid] = str(text).strip()             # the AI's own reading: marked, not checked
            continue
        ok, why = note_ok(str(text), asked[nid]["figures"])
        if ok:
            good[nid] = str(text).strip()
        else:
            refused.append({"id": nid, "why": why})
    return good, refused


# ---------------------------------------------------------------- the page
def page(facts: dict, notes: dict, limit: str | None = None) -> str:
    kinds = {w["id"]: w.get("kind", "reading") for w in facts.get("to_write") or []}

    def reading(k):
        """A slot's sentence: marked when it is a reading; when the limit stopped the job, says so."""
        text = notes.get(k, "")
        if not text:
            return Markup(f'<span class="unwritten">Not written: this report reached its {escape(limit)} USD limit.</span>') \
                if limit and k in kinds else ""
        mark = Markup('<span class="mark">VESTA\'s reading</span> ') if kinds.get(k) == "reading" else ""
        return mark + escape(text)

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

    def sentence(s, end="."):
        """A playbook phrase as a sentence: a capital first, a full stop (or `end`) last."""
        s = str(s or "").strip()
        return "" if not s else s[:1].upper() + s[1:] + ("" if s[-1] in ".?!" else end)

    def when(s):
        try:
            return datetime.fromisoformat(str(s)).strftime("%a %d %b, %H:%M")
        except ValueError:
            return s or ""

    sections = facts.get("sections") or {}
    header = sections.get("header") or {}
    return TPL.get_template("report.html").render(
        title=header.get("title") or facts.get("villa", ""), eyebrow=facts.get("eyebrow", ""),
        order=facts.get("order") or [], sections=sections, note=lambda k: notes.get(k, ""), reading=reading,
        num=num, pct=pct, day=day, sentence=sentence, when=when, money=lambda v, cur: fmt_money(v, cur) if v else "—",
        chart_line=lambda *a: Markup(line(*a)), chart_bars=lambda b: Markup(bars(b)),
        chart_pairs=lambda r: Markup(pairs(r)))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-daily", "fm-weekly", "owner-weekly", "owner-monthly"])
    ap.add_argument("--pack"); ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--zone"); ap.add_argument("--energy"); ap.add_argument("--as-of")
    ap.add_argument("--facts"); ap.add_argument("--notes"); ap.add_argument("--out")
    ap.add_argument("--finish", choices=["here", "owner", "fm"], help="the job's on_limit step: send the page")
    ap.add_argument("--since"); ap.add_argument("--limit")
    a = ap.parse_args(argv)

    if a.cmd in ("fm-weekly", "owner-monthly"):
        if not a.facts:
            print(f"{a.cmd} needs --facts: first run facts.py {a.cmd} --energy <period>.json --out facts.json.", file=sys.stderr)
            return 1
        name = "weekly" if a.cmd == "fm-weekly" else "monthly"
        if a.finish and (not os.path.exists(a.facts) or (a.since and datetime.fromtimestamp(
                os.path.getmtime(a.facts)).astimezone() < datetime.fromisoformat(a.since))):
            print(json.dumps({"send": [{"to": a.finish, "text": (
                f"The {name} report stopped at its {a.limit} USD limit before its figures were ready, so there is "
                f"nothing to send. Its limit can be raised on the VESTA Agent page (Rules → AI jobs).")}]}))
            return 0
        facts = json.load(open(a.facts, encoding="utf-8"))
        notes = {}
        if a.notes and os.path.exists(a.notes):
            try:
                notes = json.load(open(a.notes, encoding="utf-8"))
            except ValueError:
                notes = {}
        good, refused = checked_notes(facts, notes if isinstance(notes, dict) else {})
        html = page(facts, good, a.limit if a.finish else None)
        res = {"html_chars": len(html), "notes_used": sorted(good), "notes_refused": refused,
               "missing_notes": sorted(w["id"] for w in facts.get("to_write") or [] if w["id"] not in good),
               "problems": facts.get("problems") or []}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(html)
            res["html"] = a.out
        if a.finish and a.out:
            head = good.get("headline") or good.get("hero") or f"The {name} report."
            res = {"send": [{"to": a.finish, "attachment": os.path.basename(a.out),
                             "text": f"{head}\n\n(This report stopped at its {a.limit} USD limit: some readings are missing.)"}]}
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
