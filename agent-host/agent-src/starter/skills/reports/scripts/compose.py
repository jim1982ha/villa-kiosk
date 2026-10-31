#!/usr/bin/env python3
"""reports: the composer — the chat texts, and the weekly and monthly pages from their facts.

  compose.py fm-daily      --pack pack.json --store S [--as-of D]                 -> text (chat)
  compose.py owner-weekly  --pack pack.json --store S --energy week.json --facts F [--page P] -> 3 lines (chat),
                           page attached; every number the lines say is the page's (facts.json's kpis)
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
from zoneinfo import ZoneInfo

from markupsafe import Markup, escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared import result as R  # noqa: E402  (what the engine is asked to do: its shape)
from vesta_shared import script  # noqa: E402  (pack, store, zone, day: one set-up)
from vesta_shared.params import MissingParameter  # noqa: E402
from vesta_shared.messaging import fmt_money, no_platform_name_in  # noqa: E402
from vesta_shared.result import WHOLE_DEVICE  # noqa: E402  (what a whole device's faults are)
from vesta_shared.message_format import document, for_the_ai, split_title  # noqa: E402  (the one shape: title, To:, sections)
from vesta_shared.store import Incident, Store  # noqa: E402
from vesta_shared.timeutil import day_label, said  # noqa: E402  (the one day format; a stored time in words)
from vesta_shared.problems import Problems, alert_line  # noqa: E402  (what is still open: one owner; an alert's line)
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the Limits tab)

DIGEST_OPEN_LINES = limit("reports.digest_open_lines", 8, unit="lines", group="text", lo=1, hi=200,
                          says="How many open problems the Facility Manager's morning message lists (open alerts are "
                               "always all listed).",
                          reached="Further open problems are not listed and no 'and N more' is said.", told="")
SUBJECT_CHARS = limit("reports.subject_chars", 60, unit="characters", group="text", lo=20, hi=400,
                      says="The longest name of what a problem is about, when the villa's device list does not name "
                           "it.",
                      reached="A longer name is cut.", told="")
from vesta_shared.page import bars, line, linked, number, pairs, say, templates  # noqa: E402  (the charts, the numbers, the sentences: shared)

TPL = templates(os.path.join(HERE, ".."))       # this skill's templates/, then the shared head (vesta_shared.page)
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
        raise MissingParameter("todo.group_from", said="reports.yaml: parameter missing: thresholds.todo.group_from")
    group_from = int(group_from)
    words = {k: v for k, v in (cfg.get("todo_groups") or {}).items() if k != "same_time"}
    def name_of(p):
        # what the problem is about, named as every list names it (knowledge_pack.subject: a whole device's fault by
        # its device, any other by its reading); the summary's own words for an entity the pack does not know
        return (pack.subject(p["entity_id"], p["rule_id"] in WHOLE_DEVICE)[1] if p.get("entity_id") else None) \
            or p["title"][:SUBJECT_CHARS]

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
                                                           "subject": name_of(p),
                                                           "title": p["title"]} for p in new], group_from, words)))
    if noted:
        sections.append(("Also noted (no action needed yet)", [f"- {p['title']}" for p in view["new"] if p["incident"] in noted]))
    if open_now:
        # ⚠️ AN ALERT'S NUMBER, TO FIND ITS MESSAGE: it is closed with Done under that message — a typed "#9 done" closes
        # nothing (no reply ever did). It used to print task numbers; a maintenance finding is closed in the VESTA Kiosk. (Owner, 2026-10-11: the
        # line "Still open: 6. An alert: press Done … the rest: close it in the VESTA Kiosk" gave no useful indication.)
        alerts = [p for p in open_now if p["incident"]]
        # each problem by its one name (Problems.open_problems: problems.problem_name), already as long as it may be
        sections.append(("Still open", [f"- {alert_line(p)}" for p in alerts]
                         + _grouped([{"kind": p["rule_id"], "severity": p["severity"],
                                      "subject": name_of(p), "title": p["title"]}
                                     for p in open_now if not p["incident"]], group_from, words)[:DIGEST_OPEN_LINES]))
    if not sections:
        sections.append((None, ["Nothing new, nothing open."]))
    return document(title(pack.villa, "daily", as_of), "", sections)


#: The owner's Monday figures, each the weekly page's own (facts.py s_kpis): alerts, critical ones, alerts still open,
#: maintenance problems open.
OWNER_FIGURES = ("alerts", "p1", "alerts_open", "open_tasks")
#: What a line says for a figure the page does not give (a facts.json written by an older facts.py): named, not guessed.
NOT_GIVEN = "n/a"


def owner_weekly(pack: KnowledgePack, store: Store, energy: dict, page: bool = False, kpis: dict | None = None) -> str:
    """The owner's Monday lines. `page`: the facility manager's weekly page goes with them (owner, 2026-10-12: the
    lines said "Details in the FM weekly page", a page only the facility manager was sent). `kpis`: that page's own
    figures (facts.json's kpis section): every number said is one of them (OWNER_FIGURES); one it lacks reads NOT_GIVEN.

    ⚠️ EVERY NUMBER IS THE PAGE'S (owner, 2026-10-19: "maintain consistency in calculations"; architecture review the
    same evening): the count of alerts was unified that morning, but the critical ones, the alerts still open and the
    problems open were still counted here, by other rules than the page's (every open problem, against the page's
    problems opened in the week and its to-do list grouped by device) — the Monday message and its attached page
    disagreed. Nothing is computed here any more; `store` stays for the callers' signature."""
    del store
    n = {k: (kpis or {}).get(k, NOT_GIVEN) for k in OWNER_FIGURES}
    quiet = all(n[k] == 0 for k in OWNER_FIGURES if k != "alerts")
    kwh = f"{energy['total_kwh']:.0f} kWh" if energy.get("total_kwh") is not None else "kWh n/a"
    vs = f" ({energy['total_vs_prev_pct']:+.0f}%)" if energy.get("total_vs_prev_pct") is not None else ""
    cost = f", {fmt_money(energy['total_cost'], energy['currency'])}" if energy.get("total_cost") else ""
    return document(title(pack.villa, "weekly", date.fromisoformat(energy["end"])), "", [
        ("Energy this week", [f"- {kwh}{vs}{cost}."]),
        ("Alerts and problems", [f"- {n['alerts']} alert(s), {n['p1']} critical, {n['alerts_open']} still open; "
                                 f"{n['open_tasks']} maintenance problem(s) open.",
                                 "- All quiet." if quiet else "- Details in the attached page." if page
                                 else "- The facility manager has the details in their weekly page."])])



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


def page(facts: dict, notes: dict, limit: str | None = None, without_ai: str | None = None) -> str:
    """`without_ai`: why the AI could not write (its job's without_ai steps): the page says so at the top."""
    notes = no_platform_name_in(notes)       # the AI's sentences never name the platform (messaging.no_platform_name)
    kinds = {w["id"]: w.get("kind", "reading") for w in facts.get("to_write") or []}

    def reading(k):
        """A slot's sentence: marked when it is a reading; when the limit stopped the job, says so."""
        text = notes.get(k, "")
        if not text:
            return Markup(f'<span class="unwritten">Not written: this report reached its {escape(limit)} USD limit.</span>') \
                if limit and k in kinds else ""
        mark = Markup('<span class="mark">VESTA\'s reading</span> ') if kinds.get(k) == "reading" else ""
        return mark + linked(text)

    def num(v, nd=None):
        # the one number rule of every page (vesta_shared.page.number); nd=0 is the template's "to the unit"
        return number(v, whole=nd == 0)

    def pct(v):
        return "—" if v is None else f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.0f}%"

    # ⚠️ THE ONE DAY FORMAT, IN THE VILLA'S TIME (architecture review, 2026-10-07): these wrote "Mon 05 Oct", and a
    # Home Assistant time (UTC, its zone cut off) was shown as if it were the villa's
    zone = ZoneInfo(facts.get("zone") or "UTC")

    # a stored day or moment in words (timeutil.said, the one reader): facts.py gives the villa's time already
    # (facts._local); an aware time is converted
    def day(s):
        return said(s, zone, weekday=True, day=True) or ""

    def when(s):
        return said(s, zone, weekday=True) or ""

    sections = facts.get("sections") or {}
    header = sections.get("header") or {}
    return TPL.get_template("report.html").render(
        title=header.get("title") or facts.get("villa", ""), eyebrow=facts.get("eyebrow", ""),
        order=facts.get("order") or [], sections=sections, note=lambda k: notes.get(k, ""), reading=reading,
        num=num, pct=pct, day=day, sentence=say, when=when, money=lambda v, cur: fmt_money(v, cur) if v else "—",
        chart_line=lambda *a: Markup(line(*a)), chart_bars=lambda b: Markup(bars(b)),
        chart_pairs=lambda r: Markup(pairs(r)), without_ai=without_ai)



def without_ai_note(why: str) -> str:
    """What a message made without the AI says (the job's without_ai steps): why, and what is missing."""
    return (f"(Made without the AI: {why.strip()} Every figure is complete; VESTA's readings and "
            "translation are missing.)")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-daily", "fm-weekly", "owner-weekly", "owner-monthly"])
    script.arguments(ap, pack=True)               # --pack --store --zone --fixture-dir --now
    ap.add_argument("--energy"); ap.add_argument("--as-of")
    ap.add_argument("--facts"); ap.add_argument("--notes"); ap.add_argument("--out")
    ap.add_argument("--page", help="owner-weekly: the weekly page sent with the lines")
    ap.add_argument("--finish", choices=["here", "owner", "fm"], help="the job's on_limit step: send the page")
    ap.add_argument("--since"); ap.add_argument("--limit")
    ap.add_argument("--no-ai", metavar="WHY", help="the job's without_ai step: the AI could not run (WHY, in words)")
    a = ap.parse_args(argv)
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
    if a.cmd == "owner-weekly" and not a.facts:
        # every number the lines say is the weekly page's (owner_weekly): without its facts there are none to say
        print("owner-weekly needs --facts: first run facts.py fm-weekly --energy <week>.json --out facts.json, "
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
        kpis = (json.load(open(a.facts, encoding="utf-8")).get("sections") or {}).get("kpis")
        doc = owner_weekly(pack, store, json.load(open(a.energy)), page=bool(a.page), kpis=kpis)
    attached = {"attachment": os.path.basename(a.page)} if a.page else {}
    if mode == "no_ai":
        # a job's without_ai step: the message is sent as written, saying it was made without the AI; a long one is cut
        # into whole messages by the agent (posting.py), never here
        print(json.dumps({"send": [send(a.finish, doc + "\n\n" + without_ai_note(a.no_ai), **attached)]}, indent=1))
        return 0
    print(json.dumps({"message": for_the_ai(doc), **attached}, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())
