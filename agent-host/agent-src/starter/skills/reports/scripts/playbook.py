"""The reports skill's playbook: the clues reports.yaml asks for, and the one list of what needs doing.

⚠️ ITS OWN MODULE (architecture review 13, 2026-10-09): it sat inside facts.py, between the shared set-up it rebuilt
and nineteen section builders, and no clue had a test of its own. facts.Ctx is what it reads the villa through (its
`need`, `pack`, `cli`, `params()`, `states()`, `tasks()`, `hourly_means`); the sections ask it `clues` and `todo`.
"""
from __future__ import annotations

import statistics
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING

from vesta_shared.device_state import battery_charge  # the night check's own reading
from vesta_shared.stats import slope_per_hour, step_index  # the night check's step detector
from vesta_shared.timeutil import day_label, day_time_label  # the one day format

if TYPE_CHECKING:
    from facts import Ctx


class MissingParameter(Exception):
    """A threshold reports.yaml does not give (facts.Ctx.need): named, never guessed."""


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _when(row: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(row.get("when") or ""))
    except ValueError:
        return None


# ---------------------------------------------------------------- the clues (reports.yaml playbook)
def _fill(text, figures: dict) -> str:
    """A playbook text with the clue's figures in it; a date as a person writes it ("23 Sep")."""
    def show(v):
        if isinstance(v, str) and len(v) == 16 and v[10] == "T":
            try:
                return day_time_label(datetime.fromisoformat(v))
            except ValueError:
                return v
        if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
            try:
                return day_label(date.fromisoformat(v))
            except ValueError:
                return v
        return v
    try:
        return str(text or "").format(**{k: show(v) for k, v in figures.items() if not isinstance(v, (list, dict))})
    except (KeyError, IndexError, ValueError):
        return str(text or "")


def _days_power(c: "Ctx", entity_id: str, days: int) -> list[tuple[date, float, float]]:
    """Per day: (day, mean running power, hours running), from HA's hourly means."""
    thr = float(c.need("pump", "run_min_w"))
    out = []
    for d, vals in sorted(c.hourly_means(entity_id, days).items()):
        run = [v for v in vals if v > thr]
        out.append((d, round(statistics.mean(run)) if run else 0.0, len(run)))
    return out


def _best_split(vals: list[float], min_days: int) -> tuple[int, float] | None:
    """Where the series steps: (index of the first day after, change in % of the before mean); None without one step.

    ⚠️ ONE STEP DETECTOR (architecture review 13): this took the largest jump between any two halves, noise included,
    while the night check's power-change rule asks stats.step_index (one step explaining most of the variance) — the
    weekly page and the night check disagreed on whether a pump's power had stepped."""
    idx, pct = step_index(vals, min_seg=min_days)
    return (idx, pct) if idx is not None else None


def clue_power_step(c, when):
    out = []
    for slug, a in sorted(c.pack.assets.items()):
        pw = (a.get("entities") or {}).get("power")
        if a.get("kind") != "motor" or not pw:
            continue
        rows = [r for r in _days_power(c, pw, int(when.get("days", 30))) if r[2] > 0]
        best = _best_split([r[1] for r in rows], int(when.get("min_days", 3)))
        if best and -best[1] >= float(when["drop_pct"]):
            k = best[0]
            if min(statistics.mean(r[2] for r in rows[:k]), statistics.mean(r[2] for r in rows[k:])) < float(when.get("min_hours", 0)):
                continue                             # a few minutes a day: its hourly means are not its power
            out.append({"subject": c.pack.device_name(pw, slug), "entity_id": pw, "step_date": rows[k][0].isoformat(),
                        "before_w": round(statistics.mean(r[1] for r in rows[:k])),
                        "after_w": round(statistics.mean(r[1] for r in rows[k:])), "drop_pct": round(-best[1]),
                        "hours_before": round(statistics.mean(r[2] for r in rows[:k]), 1),
                        "hours_after": round(statistics.mean(r[2] for r in rows[k:]), 1)})
    return out


def clue_run_change(c, when):
    out = []
    for slug, a in sorted(c.pack.assets.items()):
        pw = (a.get("entities") or {}).get("power")
        if a.get("kind") != "motor" or not pw:
            continue
        rows = _days_power(c, pw, int(when.get("days", 30)))
        best = _best_split([float(r[2]) for r in rows], int(when.get("min_days", 3)))
        if best and abs(best[1]) >= float(when["change_pct"]):
            k = best[0]
            before = statistics.mean(r[2] for r in rows[:k])
            after = statistics.mean(r[2] for r in rows[k:])
            if max(before, after) < float(when.get("min_hours", 0)):
                continue                             # a few minutes a day either way: not a change to report
            out.append({"subject": c.pack.device_name(pw, slug), "entity_id": pw, "change_date": rows[k][0].isoformat(),
                        "hours_before": round(statistics.mean(r[2] for r in rows[:k]), 1),
                        "hours_after": round(statistics.mean(r[2] for r in rows[k:]), 1), "change_pct": round(best[1])})
    return out


def clue_battery_trend(c, when):
    repl = float(c.need("battery", "replace_below_pct"))
    days = int(when.get("days", 30))
    s = datetime.combine(c.end - timedelta(days=days - 1), time(0), c.Z)
    out = []
    for r in c.pack.families.get("battery", []):
        # ⚠️ ITS CHARGE, NOT ITS READING (architecture review 13): a 3.0 V cell was read as "3 %" here and made a
        # false "battery falling" clue, while the batteries section converted it — both ask battery_pct now
        now_v = battery_pct(c, r, _num((c.states().get(r["entity_id"]) or {}).get("state")))
        if now_v is None or now_v >= float(when["below_pct"]):
            continue
        rows = c.cli.statistics([r["entity_id"]], s, c.e_dt, "day", ("mean",)).get(r["entity_id"], [])
        pts = [(i, p) for i, x in enumerate(rows) if (p := battery_pct(c, r, _num(x.get("mean")))) is not None]
        fall = None
        if len(pts) >= 5:
            fall = round(-(slope_per_hour(pts) or 0) * 7, 1)      # the points are (day index, level): per day
        if not fall or fall <= 0 or now_v <= repl:
            continue                    # no trend to project, or already due: the batteries section shows it
        out.append({"subject": c.pack.device_name(r["entity_id"], r["entity_id"]), "entity_id": r["entity_id"], "level_pct": round(now_v),
                    "fall_per_week": fall, "weeks_left": round((now_v - repl) / fall, 1), "replace_below_pct": repl})
    return out


def clue_offline(c, when):
    fams = set(when.get("families") or [])
    return [{"subject": o["name"], "since": o["since"], "family": o["family"], "entity_id": o["entity_id"]}
            for o in c.offline() if o["family"] in fams]


def clue_use_while_empty(c, when):
    meter, ent = c.energy.get("main_meter"), when.get("mode_entity")
    if not meter or not ent:
        return []
    days = int(when.get("days", 10))
    start = max(c.start, c.end - timedelta(days=days - 1))
    s = datetime.combine(start, time(0), c.Z)
    hist = sorted(c.cli.history([ent], s, c.e_dt).get(ent, []), key=lambda h: h.get("last_changed", ""))
    if not hist:
        return []
    empty = {str(x).lower() for x in when.get("empty") or []}
    per = c.daily_kwh(meter, start, c.end)
    empty_days, other_days = [], []
    for k in range((c.end - start).days + 1):
        d = start + timedelta(days=k)
        noon = datetime.combine(d, time(12), c.Z)
        state = None
        for h in hist:
            if datetime.fromisoformat(h["last_changed"]) <= noon:
                state = str(h.get("state") or "").lower()
        if d in per and state is not None:
            (empty_days if state in empty else other_days).append(per[d])
    if not empty_days:
        return []
    return [{"subject": "the villa", "empty_days": len(empty_days),
             "kwh_per_empty_day": round(statistics.mean(empty_days), 1),
             "kwh_per_other_day": round(statistics.mean(other_days), 1) if other_days else "no occupied day"}]


CLUES = {"power_step": clue_power_step, "run_change": clue_run_change, "battery_trend": clue_battery_trend,
         "offline": clue_offline, "use_while_empty": clue_use_while_empty}


def clues(c: "Ctx") -> tuple[list[dict], list[str]]:
    """Every playbook entry whose `when` holds, as clues: the entry's guidance filled with the clue's figures."""
    if c._clues is not None:
        return c._clues
    out, problems = [], []
    for group, entries in (c.cfg.get("playbook") or {}).items():
        for e in entries or []:
            when = e.get("when") or {}
            if not when:
                continue                             # knowledge only: handed to the AI, never a clue
            fn = CLUES.get(when.get("kind"))
            if fn is None:
                problems.append(f"playbook {group}/{e.get('name')}: unknown when kind {when.get('kind')!r}")
                continue
            try:
                found = fn(c, when)
            except MissingParameter as ex:
                problems.append(f"playbook {group}/{e.get('name')}: {ex}")
                continue
            except (KeyError, TypeError, ValueError) as ex:
                problems.append(f"playbook {group}/{e.get('name')}: {type(ex).__name__}: {ex}")
                continue
            for f in found:
                out.append({"id": f"clue-{len(out) + 1}", "group": group, "entry": e.get("name"), "subject": f.get("subject"),
                            "figures": f, "horizon": e.get("horizon"), "severity": e.get("severity"),
                            "title": _fill(e.get("title") or "{subject}: " + str(e.get("name") or ""), f),
                            "group_title": e.get("group_title"),
                            "playbook": {k: _fill(e.get(k), f) for k in ("look_at", "means", "check", "ask", "cost_of_ignoring")
                                         if e.get(k)}})
    c._clues = (out, problems)
    return c._clues


# ---------------------------------------------------------------- the one list of what needs doing
def _device(c: "Ctx", entity_id: str | None, fallback: str) -> str:
    """What an item is about: the device of its entity (knowledge_pack.device_of, the one identity of every section),
    so that a clue and a task about the same device become one item."""
    return c.pack.device_of(entity_id)[0] if entity_id else fallback


def todo(c: "Ctx") -> list[dict]:
    """The report's one list for this period: Ctx reads its inputs, one_list builds it."""
    if c._todo is not None:
        return c._todo

    def device_of(entity_id, fallback):
        return _device(c, entity_id, fallback)

    def name_of(entity_id):
        # the device's name as the knowledge pack has it; an entity it does not know keeps its own sentence
        return c.pack.device_name(entity_id, None)

    c._todo = one_list(clues(c)[0], c.tasks(), device_of, name_of, c.need("horizon"),
                       int(c.need("todo", "group_from")), float(c.need("todo", "same_time_minutes")),
                       c.cfg.get("todo_groups") or {})
    return c._todo


SEVERITY_ORDER = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}


def group_kinds(items: list[dict], group_from: int, group_words: dict) -> list[tuple[dict | None, list[dict]]]:
    """Items of one KIND made one line: at least `group_from` of them, and a group line for the kind (the
    item's own `group_title`, else reports.yaml todo_groups). Each item has `kind`, `severity`, `subject`
    (its name) and may have `since` (members are listed oldest first). Returns, in first-seen order,
    (group, members) — group None for an item that stands alone — where group is {title, names, shown,
    severity (the worst member's)}.

    ⚠️ ONE GROUPING (architecture review, 0.12.27): the 07:00 digest grouped with its own copy, which
    guessed each name by cutting the summary at " has " / " dropped ", took the FIRST member's severity
    and formatted the line without {kind} — a group line naming {kind} raised KeyError there only."""
    kinds: dict[str, list[dict]] = {}
    for it in items:
        kinds.setdefault(it["kind"], []).append(it)
    out: list[tuple[dict | None, list[dict]]] = []
    for kind, its in kinds.items():
        title = its[0].get("group_title") or group_words.get(kind)
        if len(its) < group_from or not title:
            out += [(None, [it]) for it in its]
            continue
        its.sort(key=lambda x: x.get("since") or "")
        n = len(its)
        names = [x["subject"] for x in its]
        out.append(({"title": title.format(n=n, kind=kind.split("/")[-1]), "names": names,
                     "shown": ", ".join(names[:8]) + (f" and {n - 8} more" if n > 8 else ""),
                     "severity": min((x["severity"] for x in its), key=lambda s_: SEVERITY_ORDER.get(s_, 9))}, its))
    return out


def one_list(clue_rows: list[dict], problems: list[dict], device_of, name_of, horizon: dict,
             group_from: int, same_minutes: float, group_words: dict) -> list[dict]:
    """What needs doing, ONCE: the playbook's clues and the open problems (vesta_shared.problems), merged
    by device (a clue and a problem about one device are one item), then the items of one kind grouped
    when there are at least `group_from` and `group_words` (reports.yaml todo_groups) or the playbook
    entry gives that kind a group line. The PDF mock-ups' "Do this week": one list, no repeats.

    ⚠️ PLAIN INPUTS (architecture review, 2026-10-01): it reads nothing itself — `device_of(entity_id,
    fallback)` and `name_of(entity_id)` are the only questions it asks — so its rules are tested with
    lists, without a villa, a store or Home Assistant."""
    order = SEVERITY_ORDER
    items: dict[str, dict] = {}

    def add(it: dict):
        cur = items.get(it["device"])
        if cur is None:
            items[it["device"]] = it
            return
        keep, other = (cur, it) if cur["from"] == "clue" or order.get(cur["severity"], 9) <= order.get(it["severity"], 9) else (it, cur)
        keep["severity"] = min(keep["severity"], other["severity"], key=lambda s: order.get(s, 9))
        keep["task_ids"] = keep["task_ids"] + other["task_ids"]
        keep["also"] = keep["also"] + [other["title"]] + other["also"]
        items[it["device"]] = keep

    def severity_for(h):
        # a playbook entry's horizon as a severity: the LAST one reports.yaml maps to it (Now → P2, not
        # P1: a clue is never an emergency by itself)
        found = [sev for sev, hz in horizon.items() if hz == h]
        return found[-1] if found else "P4"

    for cl in clue_rows:
        f = cl["figures"]
        sev = cl.get("severity") or severity_for(cl.get("horizon"))
        add({"from": "clue", "kind": f"{cl['group']}/{cl['entry']}", "device": device_of(f.get("entity_id"), cl["subject"] or cl["id"]),
             "subject": cl["subject"], "title": cl["title"], "severity": sev, "horizon": cl.get("horizon") or horizon.get(sev),
             "why": cl["playbook"].get("means", ""), "check": cl["playbook"].get("check", ""), "ask": cl["playbook"].get("ask", ""),
             "cost": cl["playbook"].get("cost_of_ignoring", ""), "since": str(f.get("since") or f.get("step_date") or f.get("change_date") or ""),
             "figures": f, "task_ids": [], "also": [], "group_title": cl.get("group_title"), "look_at": cl["playbook"].get("look_at", "")})
    for pr in problems:
        title = pr["title"].split("\n")[0]
        add({"from": "task", "kind": pr["kind"], "device": device_of(pr.get("entity_id"), pr["id"]),
             "subject": name_of(pr.get("entity_id")) or title, "title": title, "severity": pr["severity"],
             "horizon": horizon.get(pr["severity"]), "why": "", "check": pr.get("check") or "", "ask": "", "cost": "",
             "since": pr["since"], "figures": pr["figures"], "task_ids": [pr["id"]], "also": [], "group_title": None})

    out = []
    for group, its in group_kinds(list(items.values()), group_from, group_words):
        if group is None:
            out += its                               # a kind with no group line: each is its own problem
            continue
        n = len(its)
        why = group["shown"] + "."
        times = [_when({"when": x["since"]}) for x in its]
        if all(t_ is not None and len(x["since"]) > 10 for t_, x in zip(times, its)):
            spread = (max(times) - min(times)).total_seconds() / 60
            if spread <= same_minutes and group_words.get("same_time"):
                why += " " + group_words["same_time"].format(n=n, since=day_time_label(min(times)))
        out.append({**its[0], "title": group["title"], "subject": f"{n} items", "why": why,
                    "ask": "", "severity": group["severity"],
                    "task_ids": [i for x in its for i in x["task_ids"]], "also": [], "members": group["names"],
                    "devices": [x["device"] for x in its]})
    out.sort(key=lambda x: (order.get(x["severity"], 9), x["since"]))
    for k, it in enumerate(out):
        it["id"] = f"todo-{k + 1}"
    return out


def battery_pct(c, r: dict, value) -> float | None:
    """A battery's charge in %, from its reading: % as it is, volts against the nominal the villa set for it
    (device_state.battery_charge); None when it cannot be told (volts with no nominal: never a guess)."""
    unit = (r.get("unit") or "%").strip()
    nominal = c.params().asset_optional_number(r.get("asset") or "", "battery_nominal_v") if unit == "V" else None
    return battery_charge(value, unit, nominal)
