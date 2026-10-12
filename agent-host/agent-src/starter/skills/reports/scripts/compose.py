#!/usr/bin/env python3
"""reports: the composer — the chat texts, and the weekly and monthly pages from their facts.

  compose.py fm-daily      --pack pack.json --store S [--as-of D]                 -> text (chat)
  compose.py owner-weekly  --pack pack.json --store S --energy week.json [--page P] -> 3 lines (chat), page attached
  compose.py fm-weekly     --facts facts.json [--notes notes.json] --out page.html
  compose.py owner-monthly --facts facts.json [--notes notes.json] --out page.html
  compose.py investigation --notes investigation.json [--data timeline.json] [--around around.json] --out investigation.html
             (the investigate skill's account as a page: its notes, and the charts of investigate.py timeline --out)

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

⚠️ A REPORT EVEN WHEN THE AI CANNOT RUN (owner, 2026-10-07: Anthropic's credit ran out and the weekly never
came). A job's `without_ai` steps end with `--finish {to} --no-ai {why}`: the page (or the chat text) is built
from the figures alone — an old notes.json is never used — and both the page and its message say it was made
without the AI, and why.

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
sys.path.insert(0, HERE)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared import result as R  # noqa: E402  (what the engine is asked to do: its shape)
from vesta_shared import script  # noqa: E402  (pack, store, zone, day: one set-up)
from vesta_shared.params import MissingParameter  # noqa: E402
from vesta_shared.messaging import TELEGRAM_CAPTION, fmt_money, incident_tag  # noqa: E402
from vesta_shared.message_format import document, split_title  # noqa: E402  (the one shape: title, To:, sections)
from vesta_shared.axis import is_flat, label as axis_label, nice_axis  # noqa: E402  (the one axis rule)
from vesta_shared.store import Incident, Store  # noqa: E402
from vesta_shared.timeutil import day_label, day_time_label, villa_date  # noqa: E402  (the one day format)
from vesta_shared.problems import Problems  # noqa: E402  (what is still open: one owner)
from investigation_facts import KEY_MAX, facts as investigation_facts  # noqa: E402  (what the records establish)

TPL = Environment(loader=FileSystemLoader(os.path.join(HERE, "..", "templates")), autoescape=True)
NUM = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?")


def _grouped(items: list[dict], group_from: int, words: dict) -> list[str]:
    """Items ({kind, severity, subject, title}) -> chat lines, grouped the way the weekly page groups them
    (playbook.group_kinds: one grouping for both)."""
    from playbook import group_kinds
    out = []
    for group, its in group_kinds(items, group_from, words):
        if group is None:
            out.append(f"- {its[0]['severity']} {its[0]['title']}")
        else:
            out.append(f"- {group['severity']} {group['title']}: {group['shown']}.")
    return out


def send(to: str, doc: str, **k) -> dict:
    """The message that sends a report written in the shape: its title as data — the agent writes it and "To:" over the
    text, and cuts a long one into whole messages (vesta_agent/posting.py; review 28)."""
    t, body = split_title(doc)
    return R.message(to, body, title=t, **k)


def for_the_ai(doc: str) -> dict:
    """What the AI is handed to send: {title, text} — send_message(title=…, text=…) (SKILL.md)."""
    t, body = split_title(doc)
    return {"title": t, "text": body}


def title(villa: str, name: str, on: date) -> str:
    """A report message's title (owner, 2026-10-11): "Villa Example, daily report on 11/10/2026." """
    return f"{villa}, {name} report on {day_label(on, numeric=True)}."


def fm_daily(pack: KnowledgePack, store: Store, as_of: date) -> str:
    """The 07:00 digest: what is new since yesterday, what is still open, nothing else.

    ⚠️ EACH THING ONCE (villa, 2026-10-04): "Still open" re-listed the night's new findings right under
    "New", and 21 silent sensors were 21 lines. New ones are not repeated, and a kind with enough items
    is one line (reports.yaml todo.group_from / todo_groups — the weekly page's own grouping)."""
    from facts import load_cfg
    cfg = load_cfg()
    # ⚠️ NAMED, NEVER GUESSED (review 7): a missing value fell back to 3 here, where facts.py names it
    group_from = ((cfg.get("thresholds") or {}).get("todo") or {}).get("group_from")
    if group_from is None:
        raise MissingParameter("reports.yaml: parameter missing: thresholds.todo.group_from")
    group_from = int(group_from)
    words = {k: v for k, v in (cfg.get("todo_groups") or {}).items() if k != "same_time"}
    def name_of(entity_id, text):
        # the device's name from the knowledge pack; the summary's own words for an entity it does not know
        return pack.device_name(entity_id, None) or text.split("\n")[0][:60]

    # ⚠️ NEW AND STILL OPEN AS PROBLEMS ANSWER THEM (architecture review 13): this read its own "new" (findings
    # since yesterday, a closed one included) and listed a noted alert twice, under "Also noted" and "Still open"
    yesterday = (as_of - timedelta(days=1)).isoformat()
    view = Problems(store).since(yesterday)
    new = [p for p in view["new"] if not p["incident"]]
    noted = {p["incident"] for p in view["new"] if p["incident"]
             and (store.incident(p["incident"]) or {}).get("state") == Incident.DIGEST}
    open_now = [p for p in view["open"] if p not in new and p["incident"] not in noted]
    # ⚠️ THE ONE SHAPE (owner, 2026-10-11): a title, "To:" (the agent names who), then each section's label and its
    # items, each item its own quote on Telegram — vesta_shared.message_format; never a style written here
    sections = []
    if new:
        sections.append(("New since yesterday", _grouped([{"kind": p["rule_id"], "severity": p["severity"],
                                                           "subject": name_of(p["entity_id"], p["title"]),
                                                           "title": p["title"]} for p in new], group_from, words)))
    if noted:
        sections.append(("Also noted (no action needed yet)", [f"- {p['title']}" for p in view["new"] if p["incident"] in noted]))
    if open_now:
        # ⚠️ AN INCIDENT NUMBER ONLY WHERE "#N done" WORKS: an alert's incident number. It used to print task numbers,
        # which no reply could close; a maintenance finding is closed in the VESTA Kiosk instead. (Owner, 2026-10-11: the
        # line "Still open: 6. An alert: press Done … the rest: close it in the VESTA Kiosk" gave no useful indication.)
        alerts = [p for p in open_now if p["incident"]]
        sections.append(("Still open", [f"- {incident_tag(p['incident'])} · {p['title'][:160]}" for p in alerts]
                         + _grouped([{"kind": p["rule_id"], "severity": p["severity"],
                                      "subject": name_of(p["entity_id"], p["title"]), "title": p["title"][:160]}
                                     for p in open_now if not p["incident"]], group_from, words)[:8]))
    if not sections:
        sections.append((None, ["Nothing new, nothing open."]))
    return document(title(pack.villa, "daily", as_of), "", sections)


def owner_weekly(pack: KnowledgePack, store: Store, energy: dict, page: bool = False) -> str:
    """The owner's Monday lines. `page`: the facility manager's weekly page goes with them (owner, 2026-10-12: the
    lines said "Details in the FM weekly page", a page only the facility manager was sent)."""
    inc = [i for i in store.incident_occurrences()            # every run, a reopened alert's included
           if energy["start"] <= villa_date(i["opened_at"], pack.time_zone or "UTC").isoformat() <= energy["end"]]
    p1 = sum(1 for i in inc if i["severity"] == "P1")
    # the alerts and the maintenance problems still open, counted apart as the concierge counts them: every open
    # problem was called an "FM task", an alert included
    still = Problems(store).open_problems()
    alerts_open = sum(1 for p in still if p["incident"])
    open_tasks = len(still) - alerts_open
    kwh = f"{energy['total_kwh']:.0f} kWh" if energy.get("total_kwh") is not None else "kWh n/a"
    vs = f" ({energy['total_vs_prev_pct']:+.0f}%)" if energy.get("total_vs_prev_pct") is not None else ""
    cost = f", {fmt_money(energy['total_cost'], energy['currency'])}" if energy.get("total_cost") else ""
    return document(title(pack.villa, "weekly", date.fromisoformat(energy["end"])), "", [
        ("Energy this week", [f"- {kwh}{vs}{cost}."]),
        ("Alerts and problems", [f"- {len(inc)} alert(s), {p1} critical, {alerts_open} still open; {open_tasks} "
                                 f"maintenance problem(s) open.",
                                 "- All quiet." if not still and not p1 else "- Details in the attached page." if page
                                 else "- The facility manager has the details in their weekly page."])])


# ---------------------------------------------------------------- the charts
# Drawn as inline SVG: nothing fetched, nothing run in the reader's browser, and they print as they
# show. Colours are the page's custom properties (templates/report.html).
W, H, PAD_L, PAD_R, PAD_T, PAD_B = 400, 150, 34, 12, 14, 22


def _scale(lo: float, hi: float, top: float, bottom: float):
    span = (hi - lo) or 1.0
    return lambda v: bottom - (v - lo) / span * (bottom - top)


def _ticks(lo: float, hi: float, n: int = 4) -> tuple[float, float, list[float]]:
    """A readable Y axis (owner, 2026-10-01: "always the Y axis and grid lines"): vesta_shared.axis, the one
    axis rule the Costs page's chart uses too."""
    a = nice_axis(lo, hi, n)
    return a["first"], a["last"], a["ticks"]


def _axis(ticks: list[float], y, x0: float, x1: float) -> list[str]:
    """The grid lines and their values, left of the chart: the base line solid, the others dashed."""
    # each label with exactly the step's decimals (vesta_shared.axis.label): 0.25 is "0.25", not "0.2"
    step = ticks[1] - ticks[0] if len(ticks) > 1 else 1
    out = []
    for i, v in enumerate(ticks):
        dash = "" if i == 0 else ' stroke-dasharray="3 3"'
        out.append(f'<line x1="{x0}" x2="{x1}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="var(--grid)"{dash}/>'
                   f'<text x="{x0 - 4}" y="{y(v) + 3.5:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{axis_label(v, step)}</text>')
    return out


def _nice(v: float) -> str:
    return f"{v:,.0f}" if abs(v) >= 10 else f"{v:.2f}".rstrip("0").rstrip(".")


def _tip(x: float, y: float, x0: float, x1: float, top: float, bottom: float, label: str, w_: float = W) -> str:
    """A point's value on hover, or a tap on a phone (owner, 2026-10-07): a column of the chart answers with its day
    and value. CSS only (.chart .pt in templates/page_head.html): nothing runs in the reader's browser.

    ⚠️ PAGE TEXT, NOT CHART TEXT (owner, 2026-10-12: "the tooltip … consistent with the size of the font used in the
    report"): drawn inside the chart, a tip grew with the screen and the bars drawn after it covered it. It is a mark
    here, laid over the chart as the page's own text by _framed, at the report's size, above everything."""
    return "<!--pt " + json.dumps({"x": round(x, 1), "y": round(y, 1), "x0": round(x0, 1), "x1": round(max(x1, x0 + 1), 1),
                                   "top": round(top, 1), "bottom": round(bottom, 1), "label": str(label)}) + "-->"


_TIP = re.compile(r"<!--pt (\{.*?\})-->")
_TEXT = re.compile(r"<text ([^>]*)>(.*?)</text>", re.S)


def _framed(svg: str) -> str:
    """A chart with its tips: the svg, then each tip as a hover/tap area over its column (positions in % of the chart,
    so they follow it at any width), its text in the page's own font."""
    tips = [json.loads(m) for m in _TIP.findall(svg)]
    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    w_, h_ = (float(vb.group(1)), float(vb.group(2))) if vb else (W, H)
    # ⚠️ EVERY WORD OF A CHART IS PAGE TEXT (owner, 2026-10-12: "the X-axis and Y-axis and the graph legends … a font
    # size different from the text in the report"): drawn in the chart, axis values and lane names grew with it — laid
    # over it here, at the report's size (.chart .ax), where the chart put them
    words = []
    for attrs, said in _TEXT.findall(svg):
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', attrs))
        try:
            x, y = float(a.get("x", 0)), float(a.get("y", 0))
        except ValueError:
            continue
        shift = {"end": "-100%", "middle": "-50%"}.get(a.get("text-anchor"), "0")
        colour = a.get("fill") if a.get("fill", "").startswith("var(") else ""
        words.append(f'<span class="ax" style="left:{x / w_ * 100:.2f}%;top:{y / h_ * 100:.2f}%;'
                     f'transform:translate({shift},-80%){";color:" + colour if colour else ""}">{said}</span>')
    svg = _TEXT.sub("", svg)
    out = words
    for t in tips:
        side = " l" if t["x"] < w_ * .3 else " r" if t["x"] > w_ * .7 else ""
        cw, ch = t["x1"] - t["x0"], max(t["bottom"] - t["top"], 1)
        out.append(f'<span class="pt" tabindex="0" aria-label="{_esc(t["label"])}" style="left:{t["x0"] / w_ * 100:.2f}%;'
                   f'width:{cw / w_ * 100:.2f}%;top:{t["top"] / h_ * 100:.2f}%;height:{ch / h_ * 100:.2f}%">'
                   f'<i class="dot" style="left:{(t["x"] - t["x0"]) / cw * 100:.1f}%;'
                   f'top:{(t["y"] - t["top"]) / ch * 100:.1f}%"><span class="tip{side}">{_esc(t["label"])}</span></i></span>')
    return '<div class="chart">' + _TIP.sub("", svg) + "".join(out) + "</div>"


def _day(s: str) -> str:
    try:
        return day_label(date.fromisoformat(s))
    except ValueError:
        return s


def line(series: list, unit: str = "", ref: float | None = None, area: bool = False, colour: str = "var(--acc)") -> str:
    """A day-by-day line, its last value labelled; `ref` draws a dashed limit (an alert threshold)."""
    pts = [(d, float(v)) for d, v in series if v is not None]
    if len(pts) < 2:
        return '<p class="note">Not enough data to draw.</p>'
    vals = [v for _, v in pts] + ([ref] if ref is not None else [])
    lo, hi = min(vals), max(vals)
    if is_flat(lo, hi):
        hi = lo                                   # float noise is a flat line (vesta_shared.axis)
    pad = (hi - lo) * 0.15 or abs(hi) * 0.1 or 1
    # ⚠️ A PERCENTAGE STAYS WITHIN 0–100 WHILE ITS VALUES DO (owner, 2026-10-05: a battery at 100 % under a
    # 101 % axis) — never a cap: a "%" series above 100 (an energy change) keeps its own range.
    held = (unit or "").strip() == "%" and lo >= 0 and hi <= 100
    top = min(hi + pad, 100) if held else hi + pad
    lo, hi, ticks = _ticks(0 if lo >= 0 and lo - pad < 0 else lo - pad, top)
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
            f'<text x="{W - PAD_R}" y="{H - 6}" font-size="10" text-anchor="end" fill="var(--ink2)">{_esc(_day(pts[-1][0]))}</text>']
    u = f" {unit}" if unit else ""
    out += [_tip(x, yy, x - step / 2, x + step / 2, PAD_T, H - PAD_B, f"{_day(d)} · {_nice(v)}{u}")
            for (d, v), (x, yy) in zip(pts, xy)]
    out.append("</svg>")
    return _framed("".join(out))


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
        if b.get("value") is not None:
            out.append(_tip(x + w / 2, y(b["value"]), PAD_L + i * slot, PAD_L + (i + 1) * slot, PAD_T, H - PAD_B,
                            f"{b['label']} · {_nice(b['value'])}"))
    out.append("</svg>")
    return _framed("".join(out))


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
        now_, prev_ = r.get("kwh"), r.get("prev_kwh")
        if now_ is not None or prev_ is not None:
            words = " · ".join(t for t in ((f"{_nice(now_)} kWh" if now_ is not None else ""),
                                           (f"before {_nice(prev_)}" if prev_ is not None else "")) if t)
            top_v = max(v for v in (now_, prev_) if v is not None)
            out.append(_tip(x0 + w, y(top_v), PAD_L + i * slot, PAD_L + (i + 1) * slot, PAD_T, h - PAD_B,
                            f"{r['day']} · {words}", w_))
    out.append("</svg>")
    return _framed("".join(out))


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
#: A web address in a sentence the AI wrote (its web_search sources). Quotes and angle brackets end it, so it can
#: never leave the link; a full stop or a bracket that closes the sentence is not part of it.
_URL = re.compile(r"https?://[^\s<>\"']+")
_URL_TAIL = ".,;:!?)]"


def linked(text) -> Markup:
    """`text`, escaped, with every web address a link that opens in a new tab.

    ⚠️ CLICKABLE (owner, 2026-10-09: "I expect to see a clickable link instead of a raw text"): the readings and
    checks were escaped whole, so the sources the report cites were dead text on the phone."""
    text = str(text or "")
    out, at = [], 0
    for m in _URL.finditer(text):
        url = m.group(0).rstrip(_URL_TAIL)
        out.append(escape(text[at:m.start()]))
        out.append(Markup('<a class="src" href="{0}" target="_blank" rel="noopener noreferrer">{0}</a>').format(url))
        at = m.start() + len(url)
    out.append(escape(text[at:]))
    return Markup("").join(out)


def say(s, end: str = ".") -> Markup:
    """A sentence as the page shows it: a capital first, a full stop (or `end`) last, its web addresses links.

    ⚠️ THE ONE WAY A SENTENCE REACHES THE PAGE (architecture review 12, 2026-10-09). The links are made here, after
    the words: a check came in already linked, was turned back into text and escaped again, and the page showed the
    raw <a> tag (villa, 15:56). A sentence already made for the page (Markup: a reading, its mark and links) is
    kept as it is, so nothing can escape it twice."""
    if isinstance(s, Markup):
        return s
    s = str(s or "").strip()
    return linked("" if not s else s[:1].upper() + s[1:] + ("" if s[-1] in ".?!" else end))


def page(facts: dict, notes: dict, limit: str | None = None, without_ai: str | None = None) -> str:
    """`without_ai`: why the AI could not write (its job's without_ai steps): the page says so at the top."""
    kinds = {w["id"]: w.get("kind", "reading") for w in facts.get("to_write") or []}

    def reading(k):
        """A slot's sentence: marked when it is a reading; when the limit stopped the job, says so."""
        text = notes.get(k, "")
        if not text:
            return Markup(f'<span class="unwritten">Not written: this report reached its {escape(limit)} USD limit.</span>') \
                if limit and k in kinds else ""
        mark = Markup('<span class="mark">VESTA\'s reading</span> ') if kinds.get(k) == "reading" else ""
        return mark + linked(text)

    def num(v, nd=1):
        if v is None:
            return "—"
        return f"{v:,.0f}" if nd == 0 or (isinstance(v, (int, float)) and float(v).is_integer()) else f"{v:,.{nd}f}"

    def pct(v):
        return "—" if v is None else f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.0f}%"

    # ⚠️ THE ONE DAY FORMAT, IN THE VILLA'S TIME (architecture review, 2026-10-07): these wrote "Mon 05 Oct", and a
    # Home Assistant time (UTC, its zone cut off) was shown as if it were the villa's
    zone = ZoneInfo(facts.get("zone") or "UTC")

    def day(s):
        try:
            return day_label(date.fromisoformat(str(s)[:10]), weekday=True)
        except ValueError:
            return s or ""

    def when(s):
        # facts.py gives the villa's time already (facts._local); an aware time is converted
        try:
            t = datetime.fromisoformat(str(s))
        except ValueError:
            return s or ""
        return day_time_label(t.astimezone(zone) if t.tzinfo else t, weekday=True)

    sections = facts.get("sections") or {}
    header = sections.get("header") or {}
    return TPL.get_template("report.html").render(
        title=header.get("title") or facts.get("villa", ""), eyebrow=facts.get("eyebrow", ""),
        order=facts.get("order") or [], sections=sections, note=lambda k: notes.get(k, ""), reading=reading,
        num=num, pct=pct, day=day, sentence=say, when=when, money=lambda v, cur: fmt_money(v, cur) if v else "—",
        chart_line=lambda *a: Markup(line(*a)), chart_bars=lambda b: Markup(bars(b)),
        chart_pairs=lambda r: Markup(pairs(r)), without_ai=without_ai)


#: what an unusual period IS, by its kind (investigate.py's period kinds, any device): the band's word and colour. One
#: table — the bands, their labels and the legend under the chart all read it.
#: ⚠️ PLAIN WORDS, COLOURS APART (owner, 2026-10-12: "what is supply? what is stop-start? … too similar colours"):
#: each kind its own hue, none the readings' green or the usual line's blue.
BANDS = (("no power", "read 0: no power reached it", "var(--crit)"),
         ("offline", "stopped reporting", "var(--ink2)"), ("no value", "stopped reporting", "var(--ink2)"),
         ("stops and restarts", "kept stopping and restarting", "var(--c5)"),
         ("running", "ran longer or harder than usual", "var(--warn)"))
OTHER_BAND = ("unusual", "var(--crit)")
READINGS, USUAL = "var(--acc)", "var(--c3)"           # the device's own line, and its usual: never a band's colour


def band_of(kind: str) -> tuple[str, str]:
    return next(((word, colour) for k, word, colour in BANDS if str(kind).startswith(k)), OTHER_BAND)


def timechart(series: list, unit: str, zone: ZoneInfo, marks: list = (), normals: list = ()) -> str:
    """A device's readings over the period, by TIME (investigate.py timeline --out: [time, value], None = no number):
    the Y axis and its grid as every chart here, the unusual periods (`marks`: [start, end, kind]) shaded in their
    band's colour and named when there is room, the same hours of the days before (`normals`: series) faint behind, a
    value on hover or tap. A gap where the device gave no number."""
    pts = []
    for t, v in series:
        try:
            pts.append((datetime.fromisoformat(t), None if v is None else float(v)))
        except (TypeError, ValueError):
            continue
    vals = [v for _, v in pts if v is not None]
    if len(vals) < 2:
        return '<p class="note">Not enough readings to draw.</p>'
    behind = []
    for s in normals:
        line = []
        for t, v in s:
            try:
                line.append((datetime.fromisoformat(t), None if v is None else float(v)))
            except (TypeError, ValueError):
                continue
        behind.append(line)
    every_val = vals + [v for line in behind for _, v in line if v is not None]
    t0, t1 = pts[0][0], pts[-1][0]
    span = (t1 - t0).total_seconds() or 1.0
    lo, hi, ticks = _ticks(min(0.0, min(every_val)), max(every_val) * 1.1 or 1)
    y = _scale(lo, hi, PAD_T, H - PAD_B)
    x = lambda t: PAD_L + (t - t0).total_seconds() / span * (W - PAD_L - PAD_R)
    long = span > 86400
    lab = lambda t: day_time_label(t.astimezone(zone)) if long else f"{t.astimezone(zone):%H:%M}"
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{_esc(unit)} over the period">',
           *_axis(ticks, y, PAD_L, W - PAD_R)]
    for m in marks:
        a_, b_, kind = (list(m) + [""])[:3]
        try:
            ma, mb = max(datetime.fromisoformat(a_), t0), min(datetime.fromisoformat(b_), t1)
        except (TypeError, ValueError):
            continue
        if mb > ma:
            word, colour = band_of(kind)
            w_ = max(x(mb) - x(ma), 1)
            out.append(f'<rect x="{x(ma):.1f}" y="{PAD_T}" width="{w_:.1f}" height="{H - PAD_B - PAD_T}" '
                       f'fill="{colour}" opacity=".14"/>')
            if w_ >= 6.2 * len(word) + 6:                # named where the word fits; the legend names them all
                out.append(f'<text x="{x(ma) + w_ / 2:.1f}" y="{PAD_T + 10}" font-size="10" text-anchor="middle" '
                           f'fill="{colour}">{_esc(word)}</text>')

    def drawn(line: list) -> str:
        path, pen = [], False
        for t, v in line:
            if v is None:
                pen = False
                continue
            path.append(f"{'L' if pen else 'M'}{x(t):.1f},{y(v):.1f}")
            pen = True
        return " ".join(path)
    for line in behind:                                  # the days before, dashed: what "usual" looks like
        out.append(f'<path class="normal" d="{drawn(line)}" fill="none" stroke="{USUAL}" stroke-width="1" '
                   f'stroke-dasharray="3 2" opacity=".8"/>')
    out.append(f'<path d="{drawn(pts)}" fill="none" stroke="{READINGS}" stroke-width="1.8"/>')
    for k in range(5):                               # five times under the axis
        t = t0 + (t1 - t0) * k / 4
        anchor = "start" if k == 0 else "end" if k == 4 else "middle"
        out.append(f'<text x="{x(t):.1f}" y="{H - 6}" font-size="10" text-anchor="{anchor}" fill="var(--ink2)">{lab(t)}</text>')
    u = f" {unit}" if unit else ""
    every = max(1, len(pts) // 100)
    for i in range(0, len(pts) - 1, every):
        (t, v), (tn, _) = pts[i], pts[min(i + every, len(pts) - 1)]
        if v is not None:
            out.append(_tip(x(t), y(v), x(t), x(tn), PAD_T, H - PAD_B, f"{lab(t)} · {_nice(v)}{u}"))
    out.append("</svg>")
    return _framed("".join(out))


def hourchart(per_hour: dict, zone: ZoneInfo) -> str:
    """Minutes running in each hour (or day) of the period, as bars, its usual for the same hour as a tick on each
    (investigate.py running_per_hour) — a device that runs a few seconds now and then shows its trouble here at once."""
    bins = []
    for b in per_hour.get("bins") or []:
        try:
            bins.append((datetime.fromisoformat(b["at"]), float(b.get("minutes") or 0), b.get("usual")))
        except (KeyError, TypeError, ValueError):
            continue
    if not bins:
        return ""
    day = per_hour.get("unit") == "day"
    top = max([m for _, m, _ in bins] + [u for _, _, u in bins if isinstance(u, (int, float))] + [1.0])
    # an hour holds 60 minutes: the scale stops there (2026-10-12: it went to 80), a day at its own top
    lo, hi, ticks = (0.0, 60.0, [0.0, 15.0, 30.0, 45.0, 60.0]) if not day and top > 45 else _ticks(0.0, top * 1.1)
    y = _scale(lo, hi, PAD_T, H - PAD_B)
    slot = (W - PAD_L - PAD_R) / len(bins)
    lab = (lambda t: day_label(t.astimezone(zone))) if day else (lambda t: f"{t.astimezone(zone):%H:%M}")
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Minutes running per {"day" if day else "hour"}">',
           *_axis(ticks, y, PAD_L, W - PAD_R)]
    usual = []
    for i, (t, m, u) in enumerate(bins):
        x0 = PAD_L + i * slot
        if m > 0:
            out.append(f'<rect x="{x0 + slot * .15:.1f}" y="{y(m):.1f}" width="{slot * .7:.1f}" '
                       f'height="{max(y(0) - y(m), .5):.1f}" fill="{READINGS}"/>')
        if isinstance(u, (int, float)):
            usual.append((x0, x0 + slot, y(u)))
        said = f"{lab(t)} · ran {_nice(m)} min" + (f" (usually {_nice(float(u))} min)" if isinstance(u, (int, float))
                                                    else "")
        out.append(_tip(x0 + slot / 2, y(max(m, u or 0)), x0, x0 + slot, PAD_T, H - PAD_B, said))
    if usual:
        # ⚠️ ONE LINE, OVER THE BARS (2026-10-12): a dash per hour, most at 0, read as a broken axis under the bars
        path = " ".join(f"{'M' if i == 0 else 'L'}{a_:.1f},{yy:.1f} L{b_:.1f},{yy:.1f}" for i, (a_, b_, yy) in enumerate(usual))
        out.append(f'<path class="usual" d="{path}" fill="none" stroke="{USUAL}" stroke-width="2" '
                   'stroke-linejoin="round"/>')
    every = max(1, len(bins) // 6)
    for i in range(0, len(bins), every):
        out.append(f'<text x="{PAD_L + i * slot:.1f}" y="{H - 6}" font-size="10" fill="var(--ink2)">{lab(bins[i][0])}'
                   '</text>')
    out.append("</svg>")
    return _framed("".join(out))


LANE_H, LANE_LABEL = 22, 12
#: what each band or mark of the strip is: its legend word and colour — the strip and its legend read this one table
#: ("off" is the empty lane: nothing drawn)
LANE_STYLE = {"on": ("on or open", "var(--acc)", "band"), "other": ("in another state", "var(--c4)", "band"),
              "offline": ("not reporting", "var(--ink2)", "band"),
              "went": ("another device stopped reporting", "var(--crit)", "mark"),
              "can_act": ("an automation that can switch something ran", "var(--warn)", "mark"),
              "unproven": ("an automation we could not read ran", "var(--c5)", "mark")}


def strip_legend(lanes: list[dict]) -> list[dict]:
    """The strip's legend: only what it draws."""
    seen = [b.get("as") for lane in lanes for b in lane.get("bands") or [] if b.get("as") != "off"] + \
           [m.get("as") for lane in lanes for m in lane.get("marks") or []]
    return [{"word": LANE_STYLE[k][0], "colour": LANE_STYLE[k][1], "shape": LANE_STYLE[k][2]}
            for k in dict.fromkeys(seen) if k in LANE_STYLE]


def strip(lanes: list[dict], start: datetime, end: datetime, zone: ZoneInfo) -> str:
    """Other things on the SAME time axis as the charts (investigation_facts.lanes): one lane each — a device without
    numbers as bands of its states ("off" left empty), events as marks — every band and mark answering on tap."""
    if not lanes or end <= start:
        return ""
    span = (end - start).total_seconds()
    x = lambda t: PAD_L + (t - start).total_seconds() / span * (W - PAD_L - PAD_R)    # noqa: E731
    long = span > 86400
    lab = lambda t: day_time_label(t.astimezone(zone)) if long else f"{t.astimezone(zone):%H:%M}"     # noqa: E731
    h = len(lanes) * (LANE_H + LANE_LABEL) + 18
    out = [f'<svg viewBox="0 0 {W} {h}" role="img" aria-label="What else happened, on the same time axis">']
    for i, lane in enumerate(lanes):
        top = i * (LANE_H + LANE_LABEL) + LANE_LABEL
        out.append(f'<text x="{PAD_L}" y="{top - 3}" font-size="10" fill="var(--ink2)">{_esc(lane["name"])}</text>')
        out.append(f'<rect x="{PAD_L}" y="{top}" width="{W - PAD_L - PAD_R}" height="{LANE_H - 6}" fill="var(--ink2)" '
                   'opacity=".06"/>')
        for b in lane.get("bands") or []:
            a_, b_ = max(b["start"], start), min(b["end"], end)
            if b_ <= a_ or b.get("as") in ("off", "value"):        # off: the empty lane; a value: not a state
                continue
            out.append(f'<rect x="{x(a_):.1f}" y="{top}" width="{max(x(b_) - x(a_), 1.5):.1f}" height="{LANE_H - 6}" '
                       f'fill="{LANE_STYLE.get(b.get("as"), LANE_STYLE["other"])[1]}" opacity=".55"/>')
            out.append(_tip(x(a_), top + (LANE_H - 6) / 2, x(a_), max(x(b_), x(a_) + 3), top, top + LANE_H - 6,
                            f"{lab(a_)}–{lab(b_)} · {b['state']}"))
        for e in lane.get("marks") or []:
            if start <= e["at"] <= end:
                out.append(f'<rect x="{x(e["at"]) - 1:.1f}" y="{top}" width="3" height="{LANE_H - 6}" '
                           f'fill="{LANE_STYLE.get(e.get("as"), LANE_STYLE["went"])[1]}"/>')
                out.append(_tip(x(e["at"]), top + (LANE_H - 6) / 2, x(e["at"]) - 3, x(e["at"]) + 3, top,
                                top + LANE_H - 6, f"{lab(e['at'])} · {e['text']}"))
    for k in range(5):
        t = start + (end - start) * k / 4
        anchor = "start" if k == 0 else "end" if k == 4 else "middle"
        out.append(f'<text x="{x(t):.1f}" y="{h - 4}" font-size="10" text-anchor="{anchor}" fill="var(--ink2)">{lab(t)}</text>')
    out.append("</svg>")
    return _framed("".join(out))


def _lasting(seconds) -> str:
    s = int(round(float(seconds)))
    return f"{s} s" if s < 90 else f"{s // 60} min" if s < 5400 else f"{s // 3600} h {s % 3600 // 60} min"


def normal_words(ref: dict, unit: str) -> str:
    """investigate.py's normal of a device, in plain sentences (owner, 2026-10-12: "54.3 runs a day, usually 9 s …
    doesn't seem proper English"): how often it starts, how long a run lasts, what it reads running and at rest."""
    if not ref:
        return ""
    u = f" {unit}" if unit else ""
    days = ref.get("days")
    when = f"over the {days:g} days before" if isinstance(days, (int, float)) else "the days before"
    out = []
    per_day = ref.get("runs_per_day")
    if isinstance(per_day, (int, float)) and per_day > 0 and "run_median_s" in ref:
        out.append(f"Usually ({when}) it started about {per_day:.0f} time{'s' if round(per_day) != 1 else ''} a day; "
                   f"a run usually lasted {_lasting(ref['run_median_s'])}"
                   + (f" and never more than {_lasting(ref['run_longest_s'])}"
                      if _lasting(ref.get("run_longest_s", ref["run_median_s"])) != _lasting(ref["run_median_s"])
                      else "") + ".")
    level = [f"while running it read about {_nice(float(ref['level_median']))}{u}" if "level_median" in ref else "",
             f"at rest about {_nice(float(ref['rest_median']))}{u}" if "rest_median" in ref else ""]
    level = [x for x in level if x]
    if level:
        said = "; ".join(level)
        out.append(said[:1].upper() + said[1:] + ".")
    return " ".join(out)


INVESTIGATION_FIELDS = ("title", "summary", "timeline", "causes", "cannot_tell", "warned_earlier", "checked", "sources")
VERDICTS = ("consistent", "not supported", "cannot tell")
#: the chat message is the title and the summary, under the page's file: ONE bubble, so within a file's caption
#: (TELEGRAM_CAPTION) — title, "To: …" and summary together (owner, 2026-10-11: "all in 1 message … a bit more
#: detailed"). Derived, never typed (review 32): room kept for a "To:" naming several people.
DETAILS = " Details in the attached page."
TITLE_MAX, TO_ROOM = 90, 120
#: the message starts with the recorded facts (investigation_facts.key_line), then the AI's summary
SUMMARY_MAX = TELEGRAM_CAPTION - TITLE_MAX - TO_ROOM - KEY_MAX - len(DETAILS) - 6     # the line breaks between them


CITE = re.compile(r"\[(\d{1,2})\]")
#: every text of the account a reference may stand in (owner, 2026-10-12: "I am expecting to see the text section where
#: you used any of these web page content … with reference numbers")
CITING = ("summary", "causes", "cannot_tell", "warned_earlier")


def cited(notes: dict) -> set[int]:
    """The reference numbers [n] the account's texts carry."""
    texts = [str(notes.get("summary") or "")]
    for c in notes.get("causes") or []:
        if isinstance(c, dict):
            texts += [str(c.get(k) or "") for k in ("cause", "evidence", "confirm", "source")]
    texts += [str(x) for k in ("cannot_tell", "warned_earlier") for x in notes.get(k) or []]
    return {int(n) for t in texts for n in CITE.findall(t)}


def citing(count: int):
    """The page's filter: a text with its [n] as links to its numbered web page (only numbers that exist)."""
    def cite(text) -> Markup:
        return Markup(CITE.sub(lambda m: (f'<sup class="ref"><a href="#src-{m.group(1)}">[{m.group(1)}]</a></sup>'
                                          if 1 <= int(m.group(1)) <= count else m.group(0)), str(escape(text))))
    return cite


def naming(pages: list[dict]):
    """The page's filter for where a lead came from: each [n] said as its web page's title, then its number as a link
    (owner, 2026-10-12: "I expect to see a referenced number for each of these and an associated link")."""
    cite = citing(len(pages))

    def named(text) -> Markup:
        said = CITE.sub(lambda m: (f"{pages[int(m.group(1)) - 1].get('title') or 'web page'} [{m.group(1)}]"
                                   if 1 <= int(m.group(1)) <= len(pages) else m.group(0)), str(text))
        return cite(said)
    return named


#: a lead's source is a web page ([n]) or the records — never a name the page cannot link
RECORDS = re.compile(r"\b(records?|home assistant)\b", re.I)


def web_said(searches: list[str]) -> str:
    """What the page says of the web: how many searches the AI made (the agent counted them)."""
    n = len(searches)
    return f"{n} web search{'es' if n != 1 else ''} made, every lead tested against the records." if n else \
        "No web search was made."


def web_pages(notes: dict) -> list[dict]:
    """The account's sources that are web pages (http/https): the only ones the page links to."""
    return [x for x in notes.get("sources") or [] if isinstance(x, dict)
            and re.match(r"https?://", str(x.get("url") or ""))]


def web_searches() -> list[str]:
    """The web searches the AI made for this investigation before asking for the page (the agent's VESTA_WEB_SEARCHES)."""
    try:
        got = json.loads(os.environ.get("VESTA_WEB_SEARCHES") or "[]")
    except ValueError:
        return []
    return [str(q) for q in got if str(q).strip()] if isinstance(got, list) else []


def investigation(notes: dict, data: dict | None, around: dict | None = None, searches: list[str] | None = None) -> str:
    """The investigate skill's account as a page: first what the records establish and rule out (investigation_facts,
    from investigate.py timeline / around --out), a chart per device that gave numbers, its unusual periods shaded;
    then the AI's reading of them (its notes, INVESTIGATION_FIELDS)."""
    data = data or {}
    found = investigation_facts(data, around, notes)
    zone = ZoneInfo(data.get("zone") or "UTC")
    charts = []
    for e in data.get("entities") or []:
        if e.get("series"):
            marks = [(p["start"], p["end"], p.get("kind") or "") for p in e.get("periods") or [] if p.get("why")]
            normals = [n["series"] for n in e.get("normal_series") or [] if n.get("series")]
            unit = e.get("unit") or ""
            legend = [{"word": f"what it read{f' ({unit})' if unit else ''}", "colour": READINGS, "shape": "line"}]
            legend += [{"word": w, "colour": c, "shape": "band"}
                       for w, c in dict.fromkeys(band_of(k) for _, _, k in marks)]
            if normals:
                legend.append({"word": f"what it read at the same hours on each of the {len(normals)} "
                                       f"day{'s' if len(normals) > 1 else ''} before", "colour": USUAL, "shape": "dash"})
            hours = e.get("per_hour") or {}
            per = "day" if hours.get("unit") == "day" else "hour"
            charts.append({"name": e.get("name") or e.get("entity_id"),
                           "svg": Markup(timechart(e["series"], unit, zone, marks, normals)),
                           "normal": normal_words(e.get("normal") or {}, unit), "legend": legend,
                           "hours": Markup(hourchart(hours, zone)) if hours else "",
                           "hours_title": f"How many minutes it ran each {per}",
                           "hours_legend": [{"word": f"minutes it ran that {per}", "colour": READINGS, "shape": "band"}]
                           + ([{"word": f"its usual for that hour (the days before)", "colour": USUAL,
                                "shape": "line"}] if per == "hour" and any(b.get("usual") is not None
                                                                         for b in hours.get("bins") or []) else [])})
    lanes_svg = ""
    try:
        a_, b_ = datetime.fromisoformat(data["start"]), datetime.fromisoformat(data["end"])
        lanes_svg = strip(found.get("lanes") or [], a_, b_, zone)
    except (KeyError, TypeError, ValueError):
        pass
    period = ""
    try:
        a, b = (datetime.fromisoformat(data[k]).astimezone(zone) for k in ("start", "end"))
        period = f"{day_time_label(a)} to {day_time_label(b)}"
    except (KeyError, TypeError, ValueError):
        pass
    return TPL.get_template("investigation.html").render(
        title=notes.get("title") or "Investigation", n=notes, charts=charts, period=period, f=found,
        lanes=Markup(lanes_svg), lanes_legend=strip_legend(found.get("lanes") or []), web_pages=web_pages(notes),
        cite=citing(len(web_pages(notes))), named=naming(web_pages(notes)), web=web_said(searches or []),
        searches=searches or [], generated=day_time_label(datetime.now(zone)))


def without_ai_note(why: str) -> str:
    """What a message made without the AI says (the job's without_ai steps): why, and what is missing."""
    return (f"(Made without the AI: {why.strip()} Every figure is complete; VESTA's readings and "
            "translation are missing.)")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-daily", "fm-weekly", "owner-weekly", "owner-monthly", "investigation"])
    script.arguments(ap, pack=True)               # --pack --store --zone --fixture-dir --now
    ap.add_argument("--energy"); ap.add_argument("--as-of")
    ap.add_argument("--facts"); ap.add_argument("--notes"); ap.add_argument("--out"); ap.add_argument("--data")
    ap.add_argument("--around")
    ap.add_argument("--page", help="owner-weekly: the weekly page sent with the lines")
    ap.add_argument("--finish", choices=["here", "owner", "fm"], help="the job's on_limit step: send the page")
    ap.add_argument("--since"); ap.add_argument("--limit")
    ap.add_argument("--no-ai", metavar="WHY", help="the job's without_ai step: the AI could not run (WHY, in words)")
    a = ap.parse_args(argv)
    if a.cmd == "investigation":
        return _investigation(a)
    # ⚠️ THREE WAYS, NAMED ONCE (architecture review 5, 2026-10-07): for the AI (no --finish); the job's on_limit step
    # (--finish --since --limit: what is done, sent); its without_ai step (--finish --no-ai). They were told apart by
    # five repeated flag tests, and a combination nobody uses (--finish without --out) silently sent nothing.
    mode = "no_ai" if a.no_ai else "limit" if a.finish else "ai"
    if (a.no_ai or a.since or a.limit) and not a.finish:
        print("--no-ai, --since and --limit belong to a job's step: give --finish too.", file=sys.stderr); return 1
    pages = a.cmd in ("fm-weekly", "owner-monthly")
    if a.finish and pages and not a.out:
        print(f"{a.cmd} --finish needs --out: the page it sends.", file=sys.stderr); return 1
    if mode == "limit" and not (pages and a.limit):
        print("--finish without --no-ai is the on_limit step of a page: give --limit (and --since).", file=sys.stderr)
        return 1

    if pages:
        if not a.facts:
            print(f"{a.cmd} needs --facts: first run facts.py {a.cmd} --energy <period>.json --out facts.json.", file=sys.stderr)
            return 1
        name = "weekly" if a.cmd == "fm-weekly" else "monthly"

        def message(villa: str, *items: str) -> str:
            # the page's chat message, in the one shape: its title, "To:" (the agent names who), what it says
            today = datetime.now(ZoneInfo(villa_zone or "UTC")).date()
            return document(title(villa or "The villa", name, today), "", [(None, [i for i in items if i])])
        villa_zone = None
        if mode == "limit" and (not os.path.exists(a.facts) or (a.since and datetime.fromtimestamp(
                os.path.getmtime(a.facts)).astimezone() < datetime.fromisoformat(a.since))):
            print(json.dumps({"send": [send(a.finish, message("", (
                f"The {name} report stopped at its {a.limit} USD limit before its figures were ready, so there is "
                f"nothing to send. Its limit can be raised on the VESTA Agent page (Rules → AI jobs).")))]}))
            return 0
        facts = json.load(open(a.facts, encoding="utf-8"))
        villa_zone = facts.get("zone")
        notes = {}
        if a.notes and os.path.exists(a.notes) and mode != "no_ai":
            try:
                notes = json.load(open(a.notes, encoding="utf-8"))
            except ValueError:
                notes = {}
        good, refused = checked_notes(facts, notes if isinstance(notes, dict) else {})
        html = page(facts, good, a.limit if mode == "limit" else None, a.no_ai)
        res = {"html_chars": len(html), "notes_used": sorted(good), "notes_refused": refused,
               "missing_notes": sorted(w["id"] for w in facts.get("to_write") or [] if w["id"] not in good),
               "problems": facts.get("problems") or []}
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(html)
            res["html"] = a.out
        head = good.get("headline") or good.get("hero") or ""
        # the text to send with the page, in the one shape — the AI sends it as it is (SKILL.md, step 6)
        res["message"] = for_the_ai(message(facts.get("villa") or "", head))
        if mode == "no_ai":
            res = {"send": [send(a.finish, message(facts.get("villa") or "", without_ai_note(a.no_ai)),
                                 attachment=os.path.basename(a.out))]}
        elif mode == "limit":
            res = {"send": [send(a.finish, message(facts.get("villa") or "", head, f"(This report stopped at its "
                                                   f"{a.limit} USD limit: some readings are missing.)"),
                                 attachment=os.path.basename(a.out))]}
        print(json.dumps(res, indent=1)); return 0

    if a.cmd == "owner-weekly" and not a.energy:
        print("owner-weekly needs --energy: first run roi-energy energy_period.py --period week --out <file>.json, "
              "then pass that file.", file=sys.stderr)
        return 1
    if not a.pack:
        print(f"{a.cmd} needs --pack.", file=sys.stderr); return 1
    s = script.Context(a)
    pack, store = s.pack, s.store
    as_of = s.day(a.as_of)
    if a.cmd == "fm-daily":
        try:
            doc = fm_daily(pack, store, as_of)
        except MissingParameter as e:
            print(f"fm-daily: {e}", file=sys.stderr)
            return 1
    else:
        doc = owner_weekly(pack, store, json.load(open(a.energy)), page=bool(a.page))
    attached = {"attachment": os.path.basename(a.page)} if a.page else {}
    if mode == "no_ai":
        # a job's without_ai step: the message is sent as written, saying it was made without the AI; a long one is cut
        # into whole messages by the agent (posting.py), never here
        print(json.dumps({"send": [send(a.finish, doc + "\n\n" + without_ai_note(a.no_ai), **attached)]}, indent=1))
        return 0
    print(json.dumps({"message": for_the_ai(doc), **attached}, indent=1)); return 0


def _investigation(a) -> int:
    """compose.py investigation --notes N [--data D] --out page.html: the page, and the short message that carries it."""
    if not (a.notes and a.out):
        print("investigation needs --notes (the account, saved with save_file) and --out (the page).", file=sys.stderr)
        return 1
    try:
        notes = json.load(open(a.notes, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"investigation: {a.notes} could not be read ({type(e).__name__}).", file=sys.stderr); return 1
    if not isinstance(notes, dict) or not str(notes.get("title") or "").strip() or not str(notes.get("summary") or "").strip():
        print(f"investigation: the notes need at least a title and a summary (the fields: {', '.join(INVESTIGATION_FIELDS)}).",
              file=sys.stderr)
        return 1
    summary = " ".join(str(notes["summary"]).split())
    if len(" ".join(str(notes["title"]).split())) > TITLE_MAX:
        print(f"investigation: the title is longer than {TITLE_MAX} characters: say the device and the day, shorter.",
              file=sys.stderr)
        return 1
    if len(summary) > SUMMARY_MAX:
        print(f"investigation: the summary is {len(summary)} characters; it is the chat message, at most {SUMMARY_MAX}: "
              "4 to 6 sentences (what happened, the most likely cause and its evidence, what to check first). Shorten it in the "
              "notes and run this again; the details belong in the other fields.", file=sys.stderr)
        return 1
    # ⚠️ WEB RESEARCH SHOWS ITS SOURCES (owner, 2026-10-11: the page of a web-researched investigation named none). When
    # the person's words switched it on (the agent's VESTA_MODES), the page is refused until it lists them, and every
    # lead from the web carries its verdict against the records.
    # ANY web search the AI made for this investigation (the agent's VESTA_WEB_SEARCHES) needs its pages listed (owner,
    # 2026-10-11: "include the sources, when web_search tool is used")
    searches = web_searches()
    sources = web_pages(notes)
    if searches and not sources:
        print(f"investigation: you searched the web {len(searches)} time{'s' if len(searches) > 1 else ''} — list "
              'every web page you used in `sources`, each {"title": "…", "url": "https://…"}, and run this again.',
              file=sys.stderr)
        return 1
    # ⚠️ EACH WEB PAGE WHERE IT WAS USED (owner, 2026-10-12): every source cited as [n] in the text that used it, and
    # every [n] a source of the list
    refs, n_pages = cited(notes), len(sources)
    if refs - set(range(1, n_pages + 1)):
        print(f"investigation: the text cites {', '.join(f'[{n}]' for n in sorted(refs - set(range(1, n_pages + 1))))}"
              f" but `sources` has {n_pages}: number them in the order of `sources`, from [1].", file=sys.stderr)
        return 1
    unused = [f"[{i}] {sources[i - 1].get('title') or sources[i - 1].get('url')}" for i in range(1, n_pages + 1)
              if i not in refs]
    if unused:
        print("investigation: cite every web page in the text where you used it, as [n] (n = its place in `sources`); "
              f"never cited: {'; '.join(unused)}. Cite it, or take it out of `sources` if it was not used.",
              file=sys.stderr)
        return 1
    unlinked = [str(c.get("source")) for c in notes.get("causes") or [] if isinstance(c, dict) and c.get("source")
                and not CITE.search(str(c["source"])) and not RECORDS.search(str(c["source"]))]
    if unlinked:
        print("investigation: a cause's `source` is the web page it came from, as [n] (its place in `sources`), or "
              f"\"the records\" — not a name: {'; '.join(unlinked[:3])}", file=sys.stderr)
        return 1
    bad = [str(c.get("cause") or "?") for c in notes.get("causes") or []
           if isinstance(c, dict) and c.get("source") and c.get("verdict") not in VERDICTS]
    if bad:
        print(f"investigation: a lead from the web needs its verdict against the records ({', '.join(VERDICTS)}): "
              f"{'; '.join(bad[:3])}", file=sys.stderr)
        return 1
    data, around = _read_json(a.data), _read_json(a.around)        # unread: the page without them, said in its result
    found = investigation_facts(data, around, notes)
    html = investigation(notes, data, around, searches)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(html)
    # the chat message: the recorded facts, then the AI's essence — the page is the account (owner, 2026-10-11: "much
    # more synthetic and shorter")
    bubble = " ".join(re.sub(r"\s*\[\d{1,2}\]", "", summary).split())   # the chat message has no page for [n]
    doc = document(str(notes["title"]).strip(), "", [(None, [x for x in (found["key"], bubble + DETAILS) if x])])
    print(json.dumps({"html": a.out, "html_chars": len(html), "charts": html.count("<svg"),
                      # what the page states from the records: the AI reads it against its account before sending
                      "established": found["established"][:20], "ruled_out": found["ruled_out"][:20],
                      "unknown_fields": sorted(set(notes) - set(INVESTIGATION_FIELDS)),
                      **({"data": "could not be read: no chart and no recorded facts"} if a.data and data is None else {}),
                      **({"around": "could not be read: nothing ruled out from it"} if a.around and around is None else {}),
                      "message": for_the_ai(doc)}, indent=1))
    return 0


def _read_json(path: str | None) -> dict | None:
    if not path:
        return None
    try:
        got = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return got if isinstance(got, dict) else None


if __name__ == "__main__":
    sys.exit(main())
