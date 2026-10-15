"""The pieces every VESTA page shares: its head and style (templates/page_head.html), its charts drawn as inline SVG,
and how a sentence reaches it (linked, say) — for the reports skill's pages and the investigate skill's.

⚠️ SHARED HERE, NOT BORROWED FROM ANOTHER SKILL (architecture review, 2026-10-15): the investigation's page lived in
the reports skill and used its composer, so every change to an investigation edited two skills and switching Reports
off would have left /investigate without its page. Each skill now owns its page; what they share is this.

A skill's own templates/ come first (`templates`): a skill may lay out its page its own way, and the shared head is
found here when it does not have one."""
from __future__ import annotations

import json
import os
import re
from datetime import date
from html import escape as _esc

from jinja2 import ChoiceLoader, Environment, FileSystemLoader
from markupsafe import Markup, escape

from vesta_shared.axis import is_flat, label as axis_label, nice_axis
from vesta_shared.timeutil import day_label

SHARED_TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def templates(skill_dir: str) -> Environment:
    """The page templates of the skill at `skill_dir`: its own templates/ first, then the shared ones (page_head.html)."""
    return Environment(loader=ChoiceLoader([FileSystemLoader(os.path.join(skill_dir, "templates")),
                                            FileSystemLoader(SHARED_TEMPLATES)]), autoescape=True)


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


