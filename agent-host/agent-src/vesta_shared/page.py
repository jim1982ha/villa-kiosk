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
from datetime import date, datetime
from html import escape as _esc

from jinja2 import ChoiceLoader, Environment, FileSystemLoader
from markupsafe import Markup, escape

from vesta_shared.axis import is_flat, label as axis_label, nice_axis
from vesta_shared.timeutil import clock, day_label, lasting

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


def number(v, unit: str | None = None, *, whole: bool = False) -> str:
    """A figure as every page and headline writes it — ONE rule (architecture review round 3, 2026-10-19: the
    reports' composer wrote 12.34 as "12.3" and 0.15 as "0.2", the charts "12" and "0.15", the energy headline "12"):
    nothing is "—"; a whole number, or any from 100 on, with its thousands ("1,234"); from 10 on one decimal
    ("12.3"); under 10 up to two ("0.15", "1.5"); `whole` rounds to the unit (a KPI tile: "999"). A `unit` follows
    with a space, "%" without ("35%")."""
    if v is None:
        return "—"
    v = float(v)
    if whole or v.is_integer() or abs(v) >= 100:
        s = f"{v:,.0f}"
    elif abs(v) >= 10:
        s = f"{v:,.1f}".rstrip("0").rstrip(".")
    else:
        s = f"{v:.2f}".rstrip("0").rstrip(".")
    if s == "-0":
        s = "0"
    return s if not unit else (s + unit if unit == "%" else f"{s} {unit}")


_nice = number  # the charts' own name for it, kept for their lines (number is the one rule)


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


# ---------------------------------------------------------------- charts by time (the investigation's)
# ⚠️ ONE CHART MODULE (owner, 2026-10-19): these three were the investigate skill's page.py, built on six private
# names of this module (_axis, _framed, _scale, _ticks, _tip, _nice). Their colours and words are the caller's
# (parameters): a chart knows how to draw, the investigation what its bands and lanes mean (vesta_shared.periods).
READINGS, USUAL = "var(--acc)", "var(--c3)"           # a device's own line, and its usual: the defaults


def _unusual(kind: str) -> tuple[str, str]:
    return "unusual", "var(--crit)"


def timechart(series: list, unit: str, zone, marks: list = (), normals: list = (), *, band=_unusual,
              readings: str = READINGS, usual: str = USUAL) -> str:
    """A device's readings over a period, by TIME ([time, value], None = no number): the Y axis and its grid as every
    chart here, the `marks` ([start, end, kind]) shaded in `band(kind)`'s (word, colour) and named when there is room,
    the same hours of the days before (`normals`: series) dashed behind, a value on hover or tap. A gap where the
    device gave no number."""
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
        line_ = []
        for t, v in s:
            try:
                line_.append((datetime.fromisoformat(t), None if v is None else float(v)))
            except (TypeError, ValueError):
                continue
        behind.append(line_)
    every_val = vals + [v for line_ in behind for _, v in line_ if v is not None]
    t0, t1 = pts[0][0], pts[-1][0]
    span = (t1 - t0).total_seconds() or 1.0
    lo, hi, ticks = _ticks(min(0.0, min(every_val)), max(every_val) * 1.1 or 1)
    y = _scale(lo, hi, PAD_T, H - PAD_B)
    x = lambda t: PAD_L + (t - t0).total_seconds() / span * (W - PAD_L - PAD_R)                   # noqa: E731
    long = span > 86400
    lab = lambda t: clock(t, zone, days=long)                                                    # noqa: E731
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{_esc(unit)} over the period">',
           *_axis(ticks, y, PAD_L, W - PAD_R)]
    for m in marks:
        a_, b_, kind = (list(m) + [""])[:3]
        try:
            ma, mb = max(datetime.fromisoformat(a_), t0), min(datetime.fromisoformat(b_), t1)
        except (TypeError, ValueError):
            continue
        if mb > ma:
            word, colour = band(kind)
            w_ = max(x(mb) - x(ma), 1)
            out.append(f'<rect x="{x(ma):.1f}" y="{PAD_T}" width="{w_:.1f}" height="{H - PAD_B - PAD_T}" '
                       f'fill="{colour}" opacity=".14"/>')
            if w_ >= 6.2 * len(word) + 6:                # named where the word fits; the legend names them all
                out.append(f'<text x="{x(ma) + w_ / 2:.1f}" y="{PAD_T + 10}" font-size="10" text-anchor="middle" '
                           f'fill="{colour}">{_esc(word)}</text>')

    def drawn(line_: list) -> str:
        path, pen = [], False
        for t, v in line_:
            if v is None:
                pen = False
                continue
            path.append(f"{'L' if pen else 'M'}{x(t):.1f},{y(v):.1f}")
            pen = True
        return " ".join(path)
    for line_ in behind:                                 # the days before, dashed: what "usual" looks like
        out.append(f'<path class="normal" d="{drawn(line_)}" fill="none" stroke="{usual}" stroke-width="1" '
                   f'stroke-dasharray="3 2" opacity=".8"/>')
    out.append(f'<path d="{drawn(pts)}" fill="none" stroke="{readings}" stroke-width="1.8"/>')
    for k in range(5):                               # five times under the axis
        t = t0 + (t1 - t0) * k / 4
        anchor = "start" if k == 0 else "end" if k == 4 else "middle"
        out.append(f'<text x="{x(t):.1f}" y="{H - 6}" font-size="10" text-anchor="{anchor}" fill="var(--ink2)">{lab(t)}</text>')
    u = f" {unit}" if unit else ""
    every = max(1, len(pts) // 100)
    for i in range(0, len(pts) - 1, every):
        (t, v), (tn, _) = pts[i], pts[min(i + every, len(pts) - 1)]
        if v is not None:
            out.append(_tip(x(t), y(v), x(t), x(tn), PAD_T, H - PAD_B, f"{lab(t)} · {number(v)}{u}"))
    out.append("</svg>")
    return _framed("".join(out))


def hourchart(per_hour: dict, zone, *, bar: str = READINGS, usual: str = USUAL) -> str:
    """Minutes running in each hour (or day) of a period, as bars, its usual for the same hour as one line over them
    ({"bins": [{"at", "minutes", "usual"}], "unit": "hour" | "day"}) — a device that runs a few seconds now and then
    shows its trouble here at once."""
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
    lab = (lambda t: day_label(t.astimezone(zone))) if day else (lambda t: clock(t, zone, days=False))   # noqa: E731
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Minutes running per {"day" if day else "hour"}">',
           *_axis(ticks, y, PAD_L, W - PAD_R)]
    usual_at = []
    for i, (t, m, u) in enumerate(bins):
        x0 = PAD_L + i * slot
        if m > 0:
            out.append(f'<rect x="{x0 + slot * .15:.1f}" y="{y(m):.1f}" width="{slot * .7:.1f}" '
                       f'height="{max(y(0) - y(m), .5):.1f}" fill="{bar}"/>')
        if isinstance(u, (int, float)):
            usual_at.append((x0, x0 + slot, y(u)))
        # ⚠️ THE SHARED DURATION WORDS (architecture review round 8: "ran 90min" where everything else says "1h 30min")
        said = f"{lab(t)} · ran {_ran(m)}" + (f" (usually {_ran(float(u))})" if isinstance(u, (int, float)) else "")
        out.append(_tip(x0 + slot / 2, y(max(m, u or 0)), x0, x0 + slot, PAD_T, H - PAD_B, said))
    if usual_at:
        # ⚠️ ONE LINE, OVER THE BARS (2026-10-12): a dash per hour, most at 0, read as a broken axis under the bars
        path = " ".join(f"{'M' if i == 0 else 'L'}{a_:.1f},{yy:.1f} L{b_:.1f},{yy:.1f}" for i, (a_, b_, yy) in enumerate(usual_at))
        out.append(f'<path class="usual" d="{path}" fill="none" stroke="{usual}" stroke-width="2" '
                   'stroke-linejoin="round"/>')
    every = max(1, len(bins) // 6)
    for i in range(0, len(bins), every):
        out.append(f'<text x="{PAD_L + i * slot:.1f}" y="{H - 6}" font-size="10" fill="var(--ink2)">{lab(bins[i][0])}'
                   '</text>')
    out.append("</svg>")
    return _framed("".join(out))


LANE_H, LANE_LABEL = 22, 12


def strip(lanes: list[dict], start: datetime, end: datetime, zone, colour_of) -> str:
    """Other things on the SAME time axis as the charts: one lane each — bands of its states ({start, end, state, as};
    "off" left empty, "value" not a state), events as marks ({at, text, as}) — every band and mark answering on tap.
    `colour_of(as_, shape)` ("band" | "mark") is the caller's: what each band or mark means is its own table."""
    if not lanes or end <= start:
        return ""
    span = (end - start).total_seconds()
    x = lambda t: PAD_L + (t - start).total_seconds() / span * (W - PAD_L - PAD_R)    # noqa: E731
    long = span > 86400
    lab = lambda t: clock(t, zone, days=long)     # noqa: E731
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
                       f'fill="{colour_of(b.get("as"), "band")}" opacity=".55"/>')
            out.append(_tip(x(a_), top + (LANE_H - 6) / 2, x(a_), max(x(b_), x(a_) + 3), top, top + LANE_H - 6,
                            f"{lab(a_)}–{lab(b_)} · {b['state']}"))
        for e in lane.get("marks") or []:
            if start <= e["at"] <= end:
                out.append(f'<rect x="{x(e["at"]) - 1:.1f}" y="{top}" width="3" height="{LANE_H - 6}" '
                           f'fill="{colour_of(e.get("as"), "mark")}"/>')
                out.append(_tip(x(e["at"]), top + (LANE_H - 6) / 2, x(e["at"]) - 3, x(e["at"]) + 3, top,
                                top + LANE_H - 6, f"{lab(e['at'])} · {e['text']}"))
    for k in range(5):
        t = start + (end - start) * k / 4
        anchor = "start" if k == 0 else "end" if k == 4 else "middle"
        out.append(f'<text x="{x(t):.1f}" y="{h - 4}" font-size="10" text-anchor="{anchor}" fill="var(--ink2)">{lab(t)}</text>')
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


def _ran(minutes: float) -> str:
    """Minutes of running as every duration is said (timeutil.lasting: "1h 30min"); none at all, "0min"."""
    return lasting(minutes * 60) if minutes > 0 else "0min"
