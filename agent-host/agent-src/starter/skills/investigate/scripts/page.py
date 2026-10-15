#!/usr/bin/env python3
"""investigate: the investigation's page — what the records establish, the charts, and the AI's account — and the
short message that carries it.

  page.py --notes investigation.json [--data timeline.json] [--around around.json] --out investigation.html
          (the account the AI saved, and the readings of investigate.py timeline / around --out)

⚠️ THIS SKILL'S OWN PAGE (architecture review, 2026-10-15): it was the reports skill's `compose.py investigation`, so
the account's rules (its fields, its lengths, its sources) lived in another skill — SKILL.md here said "3 to 5
sentences" while that script refused anything but "4 to 6", and the investigation stalled. Its rules, its facts
(investigation_facts.py) and its template (templates/investigation.html) are this skill's now; the charts' drawing and
the page's head are shared with the reports (vesta_shared.page).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from html import escape as _esc
from zoneinfo import ZoneInfo

from markupsafe import Markup, escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vesta_shared import periods  # noqa: E402  (the period kinds and their words: investigate.py's)
from vesta_shared.message_format import TO_LONGEST, document, for_the_ai  # noqa: E402  (the one shape: title, To:, sections)
from vesta_shared.messaging import CITE, TELEGRAM_CAPTION, uncited  # noqa: E402
from vesta_shared.page import (H, PAD_B, PAD_L, PAD_R, PAD_T, W, _axis, _framed, _nice, _scale, _ticks,  # noqa: E402
                               _tip, templates)
from vesta_shared.timeutil import day_label, day_time_label, lasting  # noqa: E402  (the one day format, duration)
from investigation_facts import KEY_MAX, facts as investigation_facts  # noqa: E402  (what the records establish)

TPL = templates(os.path.join(HERE, ".."))


#: the colour of an unusual period's band, by its kind (its word: vesta_shared.periods, the one table of the kinds and
#: their words) — the bands, their labels and the legend under the chart all read band_of.
#: ⚠️ PLAIN WORDS, COLOURS APART (owner, 2026-10-12: "what is supply? what is stop-start? … too similar colours"):
#: each kind its own hue, none the readings' green or the usual line's blue.
BAND_COLOURS = {periods.NO_POWER: "var(--crit)", periods.OFFLINE: "var(--ink2)", periods.NO_VALUE: "var(--ink2)",
                periods.RESTARTS: "var(--c5)", periods.RUNNING: "var(--warn)"}
OTHER_BAND = ("unusual", "var(--crit)")
READINGS, USUAL = "var(--acc)", "var(--c3)"           # the device's own line, and its usual: never a band's colour


def band_of(kind: str) -> tuple[str, str]:
    word = periods.band(kind)
    return (word, BAND_COLOURS[periods.base(kind)]) if word else OTHER_BAND


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
              "offline": (periods.band(periods.OFFLINE), "var(--ink2)", "band"),
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
                   f"a run usually lasted {lasting(ref['run_median_s'])}"
                   + (f" and never more than {lasting(ref['run_longest_s'])}"
                      if lasting(ref.get("run_longest_s", ref["run_median_s"])) != lasting(ref["run_median_s"])
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
#: detailed"). Derived, never typed (review 32): room kept for the longest "To:" the agent writes (roles only since
#: 0.12.181 — 120 kept for a "To:" naming several people cut the summary ~90 characters short; review 3, 2026-10-13).
DETAILS = " Details in the attached page."
TITLE_MAX, TO_ROOM = 90, len(TO_LONGEST)
#: the message starts with the recorded facts (investigation_facts.key_line), then the AI's summary
SUMMARY_MAX = TELEGRAM_CAPTION - TITLE_MAX - TO_ROOM - KEY_MAX - len(DETAILS) - 6     # the line breaks between them
#: what the summary is, as investigate's SKILL.md asks for it (a test holds the two to the same words: architecture review
#: 4, 2026-10-13 — the instructions said 3 to 5 sentences, the refusal 4 to 6)
SUMMARY_SENTENCES = "3 to 5 sentences"


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
        "Web search is switched off: no web search was made."


def web_pages(notes: dict) -> list[dict]:
    """The account's sources that are web pages (http/https): the only ones the page links to."""
    return [x for x in notes.get("sources") or [] if isinstance(x, dict)
            and re.match(r"https?://", str(x.get("url") or ""))]


def web_search_on() -> bool:
    """May the AI search the web in this run (the agent's VESTA_WEB_SEARCH_ON: the villa's switch and the asker's role)."""
    return os.environ.get("VESTA_WEB_SEARCH_ON") == "1"


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


def make(a) -> int:
    """page.py --notes N [--data D] [--around A] --out page.html: the page, and the short message that carries it."""
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
              f"{SUMMARY_SENTENCES} (the most likely cause and what points to it, what to check on site first). Shorten it in the "
              "notes and run this again; the details belong in the other fields.", file=sys.stderr)
        return 1
    # ⚠️ WEB RESEARCH SHOWS ITS SOURCES (owner, 2026-10-11: the page of a web-researched investigation named none): the
    # page is refused until it lists them, and every lead from the web carries its verdict against the records.
    # ANY web search the AI made for this investigation, in any of its turns (the agent's VESTA_WEB_SEARCHES, kept on disk:
    # vesta_agent/command_request.py) needs its pages listed (owner,
    # 2026-10-11: "include the sources, when web_search tool is used")
    searches = web_searches()
    sources = web_pages(notes)
    # ⚠️ A SEARCH WHEREVER THE WEB IS ON (owner, 2026-10-12: "always use web_search by default"; architecture review 4,
    # 2026-10-13: skill.yaml said a page could not be made without one, and a page said "No web search was made."): the
    # agent tells the script whether this run may search the web (VESTA_WEB_SEARCH_ON)
    if web_search_on() and not searches:
        print("investigation: web search is on for this investigation and none was made — search the web for this "
              "device and what it did (SKILL.md step 6), list the pages you used in `sources`, and run this again.",
              file=sys.stderr)
        return 1
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
    bubble = uncited(summary)                                       # the chat message has no page for [n]
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



def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes"); ap.add_argument("--data"); ap.add_argument("--around"); ap.add_argument("--out")
    return make(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
