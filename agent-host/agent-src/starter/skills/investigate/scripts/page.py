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
from zoneinfo import ZoneInfo

from markupsafe import Markup, escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vesta_shared import periods  # noqa: E402  (the period kinds and their words: investigate.py's)
from vesta_shared.message_format import TO_LONGEST, document, for_the_ai  # noqa: E402  (the one shape: title, To:, sections)
from vesta_shared.messaging import CITE, TELEGRAM_CAPTION, no_platform_name_in, uncited  # noqa: E402
from vesta_shared import page as charts  # noqa: E402  (the charts every page draws: timechart, hourchart, strip)
from vesta_shared.page import number, templates  # noqa: E402  (the one number rule)
from vesta_shared.timeutil import day_time_label, lasting  # noqa: E402  (the one day format, duration)
from investigation_facts import KEY_MAX, facts as investigation_facts  # noqa: E402  (what the records establish)
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the VESTA Agent page's Limits tab)

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


def lane_colour(as_: str | None, shape: str) -> str:
    """A strip band's or mark's colour (LANE_STYLE); one it does not name: "in another state" / "stopped reporting"."""
    return LANE_STYLE.get(as_ or "", LANE_STYLE["other" if shape == "band" else "went"])[1]


# The investigation's charts: the shared ones (vesta_shared.page), in this page's colours and words.
def timechart(series: list, unit: str, zone: ZoneInfo, marks: list = (), normals: list = ()) -> str:
    return charts.timechart(series, unit, zone, marks, normals, band=chart_band, readings=READINGS, usual=USUAL)


def chart_band(kind: str) -> tuple[str, str]:
    """A chart band's word and colour: the figures' part, or a period's (band_of)."""
    return FIGURES_BAND if kind == FIGURES else band_of(kind)


#: the part of a chart drawn from the villa's long-term figures, its detail no longer kept (vesta_shared.retention)
FIGURES = "figures"
FIGURES_BAND = ("from the hourly figures: every change is no longer kept", "var(--c5)")


def hourchart(per_hour: dict, zone: ZoneInfo) -> str:
    return charts.hourchart(per_hour, zone, bar=READINGS, usual=USUAL)


def strip(lanes: list[dict], start: datetime, end: datetime, zone: ZoneInfo) -> str:
    return charts.strip(lanes, start, end, zone, lane_colour)


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
    level = [f"while running it read about {number(float(ref['level_median']))}{u}" if "level_median" in ref else "",
             f"at rest about {number(float(ref['rest_median']))}{u}" if "rest_median" in ref else ""]
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
TITLE_MAX = limit("investigate.title_chars", 90, unit="characters", group="text", lo=30, hi=200,
                  says="Length of an investigation's title (the summary gets what the message has left).",
                  reached="The AI is asked to shorten it.", told="ai")
TO_ROOM = len(TO_LONGEST)
#: the message starts with the recorded facts (investigation_facts.key_line), then the AI's summary
SUMMARY_MAX = TELEGRAM_CAPTION - TITLE_MAX - TO_ROOM - KEY_MAX - len(DETAILS) - 6     # the line breaks between them
#: what the summary is, as investigate's SKILL.md asks for it (a test holds the two to the same words: architecture review
#: 4, 2026-10-13 — the instructions said 3 to 5 sentences, the refusal 4 to 6)
SUMMARY_SENTENCES = "3 to 5 sentences"
FACTS_LISTED = limit("investigate.facts_listed", 20, unit="facts", group="ai", lo=1, hi=500,
                     says="Facts established and ruled out by the records, handed to the AI to check its account.",
                     reached="The further facts are not handed to the AI (the page shows them all).", told="")
WRONG_NAMED = limit("investigate.wrong_named", 3, unit="items", group="text", lo=1, hi=50,
                    says="Faulty sources or verdicts quoted back to the AI when it writes an investigation's page.",
                    reached="The further faulty ones are not quoted.", told="")


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
            if e.get("figures_until") and e["series"]:
                marks.append((e["series"][0][0], e["figures_until"], FIGURES))
            legend = [{"word": f"what it read{f' ({unit})' if unit else ''}", "colour": READINGS, "shape": "line"}]
            legend += [{"word": w, "colour": c, "shape": "band"}
                       for w, c in dict.fromkeys(chart_band(k) for _, _, k in marks)]
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
                           + ([{"word": "its usual for that hour (the days before)", "colour": USUAL,
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
    # the AI's account never names the platform, on the page or in its message (messaging.no_platform_name); a web
    # page's own title is quoted as it is
    notes = no_platform_name_in(notes, keep=("sources",))
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
              f"\"the records\" — not a name: {'; '.join(unlinked[:WRONG_NAMED])}", file=sys.stderr)
        return 1
    bad = [str(c.get("cause") or "?") for c in notes.get("causes") or []
           if isinstance(c, dict) and c.get("source") and c.get("verdict") not in VERDICTS]
    if bad:
        print(f"investigation: a lead from the web needs its verdict against the records ({', '.join(VERDICTS)}): "
              f"{'; '.join(bad[:WRONG_NAMED])}", file=sys.stderr)
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
                      "established": found["established"][:FACTS_LISTED], "ruled_out": found["ruled_out"][:FACTS_LISTED],
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
