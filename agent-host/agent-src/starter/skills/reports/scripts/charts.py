"""The report's charts, drawn as inline SVG: nothing fetched, nothing run in the reader's browser,
and they print as they show. Colours are the stylesheet's (vesta.css) custom properties."""

from __future__ import annotations

from datetime import date
from html import escape

W, H, PAD_L, PAD_R, PAD_T, PAD_B = 400, 150, 34, 12, 14, 22


def _scale(lo: float, hi: float, top: float, bottom: float):
    span = (hi - lo) or 1.0
    return lambda v: bottom - (v - lo) / span * (bottom - top)


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
    lo, hi = (0 if lo >= 0 and lo - pad < 0 else lo - pad), hi + pad
    y = _scale(lo, hi, PAD_T, H - PAD_B)
    step = (W - PAD_L - PAD_R) / (len(pts) - 1)
    xy = [(PAD_L + i * step, y(v)) for i, (_, v) in enumerate(pts)]
    path = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{yy:.1f}" for i, (x, yy) in enumerate(xy))
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{escape(unit)} per day">',
           f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{y(hi):.1f}" y2="{y(hi):.1f}" stroke="var(--grid)"/>',
           f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{y(lo):.1f}" y2="{y(lo):.1f}" stroke="var(--grid)"/>',
           f'<text x="{PAD_L - 4}" y="{y(hi) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{_nice(hi)}</text>',
           f'<text x="{PAD_L - 4}" y="{y(lo) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{_nice(lo)}</text>']
    if ref is not None:
        out.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{y(ref):.1f}" y2="{y(ref):.1f}" stroke="var(--crit)" stroke-dasharray="4 4"/>')
    if area:
        out.append(f'<path d="{path} L{xy[-1][0]:.1f},{y(lo):.1f} L{xy[0][0]:.1f},{y(lo):.1f} Z" fill="{colour}" opacity=".12"/>')
    lx, ly = xy[-1]
    out += [f'<path d="{path}" fill="none" stroke="{colour}" stroke-width="2"/>',
            f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3.5" fill="{colour}"/>',
            f'<text x="{lx - 6:.1f}" y="{ly - 8:.1f}" font-size="11" font-weight="600" text-anchor="end" fill="var(--ink)">'
            f'{_nice(pts[-1][1])}{(" " + escape(unit)) if unit else ""}</text>',
            f'<text x="{PAD_L}" y="{H - 6}" font-size="10" fill="var(--ink2)">{escape(_day(pts[0][0]))}</text>',
            f'<text x="{W - PAD_R}" y="{H - 6}" font-size="10" text-anchor="end" fill="var(--ink2)">{escape(_day(pts[-1][0]))}</text>',
            "</svg>"]
    return "".join(out)


def bars(items: list, highlight_last: bool = True) -> str:
    """Bars with a label under each and the value of the last one on top (the weekly trend)."""
    got = [b for b in items if b.get("value") is not None]
    if not got:
        return '<p class="note">Not enough data to draw.</p>'
    hi = max(b["value"] for b in got) * 1.15 or 1
    y = _scale(0, hi, PAD_T, H - PAD_B)
    n = len(items)
    slot = (W - PAD_L - PAD_R) / n
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="bars">',
           f'<text x="{PAD_L - 4}" y="{y(hi) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{_nice(hi)}</text>',
           f'<text x="{PAD_L - 4}" y="{y(0) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">0</text>']
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
        out.append(f'<text x="{x + w / 2:.1f}" y="{H - 6}" font-size="9" text-anchor="middle" fill="var(--ink2)">{escape(str(b["label"]))}</text>')
    out.append("</svg>")
    return "".join(out)


def pairs(rows: list) -> str:
    """This period against the last one, day by day (kWh per day of the whole villa)."""
    vals = [v for r in rows for v in (r.get("kwh"), r.get("prev_kwh")) if v is not None]
    if not vals:
        return '<p class="note">Not enough data to draw.</p>'
    hi = max(vals) * 1.15
    w_, h = 2 * W, 220                       # a full-width chart: twice the cards' width, same text size
    y = _scale(0, hi, PAD_T, h - PAD_B)
    slot = (w_ - PAD_L - PAD_R) / len(rows)
    out = [f'<svg viewBox="0 0 {w_} {h}" role="img" aria-label="kWh per day, this period and the last">',
           f'<text x="{PAD_L - 4}" y="{y(hi) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">{_nice(hi)}</text>',
           f'<text x="{PAD_L - 4}" y="{y(0) + 4:.1f}" font-size="10" text-anchor="end" fill="var(--ink2)">0</text>']
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
        out.append(f'<text x="{x0 + w:.1f}" y="{h - 6}" font-size="10" text-anchor="middle" fill="var(--ink2)">{escape(r["day"])}</text>')
    out.append("</svg>")
    return "".join(out)
