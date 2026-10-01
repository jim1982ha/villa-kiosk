#!/usr/bin/env python3
"""reports: every figure a weekly or monthly report shows, computed, never written by the model.

  facts.py fm-weekly     --pack pack.json --store S --energy week.json  --out facts.json
  facts.py owner-monthly --pack pack.json --store S --energy month.json --out facts.json

The sections, their order, the thresholds and the sentences the AI may write are read from
reports.yaml (this skill), not from this file. The VESTA rules are the automations built on the
blueprints the alert-desk skill routes (its rules.yaml): one list, read where it is kept.

Sources:
  Home Assistant, through the read-only HA MCP client: long-term statistics (energy per day,
    pump power per hour), current states (batteries, devices offline), the logbook of the VESTA
    rules (what fired while the agent was not there; HA keeps it about 10 days)
  the agent's store: incidents, tasks, findings, proposals
  the agent's own records (VESTA_STATE): what the AI cost
  the period's energy JSON (roi-energy energy_period.py)

The output: {"sections": {id: figures}, "to_write": [{id, field?, item?, instruction, figures}]}.
compose.py renders it, with the sentences the AI saved in notes.json for each to_write entry.
A section that cannot be computed carries {"error": why}; the others still are.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import statistics
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "_shared"))
from vesta_shared.ha_client import client_from_args  # noqa: E402
from vesta_shared.knowledge_pack import KnowledgePack  # noqa: E402
from vesta_shared.store import Store  # noqa: E402

OFF = {"unavailable", "unknown"}


def load_cfg() -> dict:
    """reports.yaml, with the villa's own villa.reports.yaml on top: its playbook entries and cards are
    added, its thresholds and nothing_happened words replace the shipped ones key by key. The villa's file
    survives app updates (skills.VILLA_PREFIX), so the shipped file keeps updating."""
    with open(os.path.join(SKILL, "reports.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    villa = os.path.join(SKILL, "villa.reports.yaml")
    if os.path.exists(villa):
        with open(villa, encoding="utf-8") as f:
            own = yaml.safe_load(f) or {}
        for group, entries in (own.get("playbook") or {}).items():
            cfg.setdefault("playbook", {}).setdefault(group, [])
            cfg["playbook"][group] = list(cfg["playbook"][group] or []) + list(entries or [])
        cfg["cards"] = list(cfg.get("cards") or []) + list(own.get("cards") or [])
        for key in ("thresholds", "nothing_happened"):
            for k, v in (own.get(key) or {}).items():
                if isinstance(v, dict) and isinstance((cfg.get(key) or {}).get(k), dict):
                    cfg[key][k] = {**cfg[key][k], **v}
                else:
                    cfg.setdefault(key, {})[k] = v
    return cfg


def alert_blueprints() -> list[str]:
    """The VESTA rules' blueprints, as the alert-desk skill routes them (its rules.yaml)."""
    p = os.path.join(SKILL, "..", "alert-desk", "rules.yaml")
    try:
        with open(p, encoding="utf-8") as f:
            routes = (yaml.safe_load(f) or {}).get("routes") or []
    except OSError:
        return []
    return [r["blueprint"] for r in routes if r.get("blueprint")]


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _ms_day(ms: int, Z) -> date:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(Z).date()


class MissingParameter(Exception):
    pass


class Ctx:
    def __init__(self, kind, pack, store, cli, energy, cfg, zone, now, state_path):
        self.kind, self.pack, self.store, self.cli, self.energy, self.cfg = kind, pack, store, cli, energy, cfg
        self.Z = ZoneInfo(zone)
        self.now = now
        self.state_path = state_path
        self.th = cfg.get("thresholds") or {}
        self.start = date.fromisoformat(energy["start"])
        self.end = date.fromisoformat(energy["end"])
        self.s_dt = datetime.combine(self.start, time(0), self.Z)
        self.e_dt = datetime.combine(self.end + timedelta(days=1), time(0), self.Z)
        self.days = (self.end - self.start).days + 1
        self._rules = None
        self._clues = None
        self._states = None

    def need(self, *path):
        """A value of reports.yaml's thresholds. ⚠️ NO FALLBACK HERE (owner, 2026-10-01): a value the file
        lacks is named in the report ("parameter missing"), never replaced by a number in code."""
        v = self.th
        for k in path:
            if not isinstance(v, dict) or k not in v:
                raise MissingParameter("reports.yaml: parameter missing: thresholds." + ".".join(path))
            v = v[k]
        return v

    # ---- shared readings
    def states(self) -> dict:
        if self._states is None:
            ids = [r["entity_id"] for fam in self.cfg.get("offline_families") or [] for r in self.pack.families.get(fam, [])]
            ids += [r["entity_id"] for r in self.pack.families.get("battery", [])]
            self._states = self.cli.states(sorted(set(ids))) if ids else {}
        return self._states

    def name(self, entity_id: str) -> str:
        for rows in self.pack.families.values():
            for r in rows:
                if r.get("entity_id") == entity_id and r.get("name"):
                    return r["name"]
        return entity_id.split(".", 1)[-1].replace("_", " ").capitalize()

    def vesta_rules(self) -> dict[str, str]:
        """automation entity id -> its name, for the automations built on the alert-desk blueprints."""
        return {eid: r["alias"] for eid, r in self.vesta_rule_info().items()}

    def vesta_rule_info(self) -> dict[str, dict]:
        """automation entity id -> {alias, blueprint} for the VESTA rules."""
        if self._rules is not None:
            return self._rules
        key = f"vesta_rules2:{self.now.date().isoformat()}"
        cached = self.store.cache_get(key)
        if isinstance(cached, dict):
            self._rules = cached
            return cached
        rules: dict[str, dict] = {}
        bps = alert_blueprints()
        if bps and hasattr(self.cli, "all_entity_ids") and hasattr(self.cli, "tool"):
            for eid in [e for e in self.cli.all_entity_ids() if e.startswith("automation.")]:
                try:
                    body = self.cli.tool("ha_config_get_automation", {"identifier": eid}) or {}
                except Exception:  # noqa: BLE001 — an automation that cannot be read is not a VESTA rule here
                    continue
                conf = body.get("config", body) if isinstance(body, dict) else {}
                path = str(((conf or {}).get("use_blueprint") or {}).get("path") or "")
                hit = next((bp for bp in bps if bp in path), None)
                if hit:
                    rules[eid] = {"alias": str(conf.get("alias") or eid), "blueprint": hit}
            self.store.cache_put(key, rules)
        self._rules = rules
        return rules

    def incidents(self) -> list[dict]:
        s, e = self.s_dt.astimezone(timezone.utc).isoformat(), self.e_dt.astimezone(timezone.utc).isoformat()
        return [i for i in self.store.incidents(open_only=False) if s <= (i.get("opened_at") or "") < e]

    def ha_alerts(self) -> list[dict]:
        """VESTA rules that ran, from Home Assistant's logbook, not already an incident of the agent."""
        out = []
        known = [(i.get("rule_id"), datetime.fromisoformat(i["opened_at"])) for i in self.incidents() if i.get("opened_at")]
        for eid, rinfo in self.vesta_rule_info().items():
            alias = rinfo["alias"]
            try:
                rows = self.cli.logbook(self.s_dt, self.e_dt, entity_id=eid)
            except Exception:  # noqa: BLE001
                continue
            for r in rows:
                try:
                    t = datetime.fromisoformat(r["when"])
                except (KeyError, ValueError):
                    continue
                if any(rid == eid and abs((t - at).total_seconds()) < 900 for rid, at in known):
                    continue
                out.append({"when": t.isoformat(), "what": alias, "lasted": None, "severity": None, "blueprint": rinfo["blueprint"],
                            "outcome": "Fired in Home Assistant (the agent did not follow it up)", "source": "home_assistant"})
        return out

    def daily_kwh(self, entity_id: str, start: date, end: date) -> dict[date, float]:
        s = datetime.combine(start, time(0), self.Z)
        e = datetime.combine(end + timedelta(days=1), time(0), self.Z)
        rows = self.cli.statistics([entity_id], s, e, "day", ("change", "sum")).get(entity_id, [])
        out: dict[date, float] = {}
        for r in rows:
            v = _num(r.get("change"))
            if v is not None and v >= 0:                     # a counter stepping back is not consumption
                out[_ms_day(r["start"], self.Z)] = round(v, 2)
        return out

    def running_power(self, entity_id: str, days: int) -> list[tuple[str, float]]:
        """Mean power per day over the hours the device ran (hourly mean above run_min_w)."""
        thr = float(self.need("pump", "run_min_w"))
        s = datetime.combine(self.end - timedelta(days=days - 1), time(0), self.Z)
        rows = self.cli.statistics([entity_id], s, self.e_dt, "hour", ("mean",)).get(entity_id, [])
        per: dict[date, list[float]] = {}
        for r in rows:
            v = _num(r.get("mean"))
            if v is not None and v > thr:
                per.setdefault(_ms_day(r["start"], self.Z), []).append(v)
        return [(d.isoformat(), round(statistics.mean(v))) for d, v in sorted(per.items())]

    def ai_cost(self) -> float | None:
        if not self.state_path or not os.path.exists(self.state_path):
            return None
        s, e = self.s_dt.astimezone(timezone.utc).isoformat(), self.e_dt.astimezone(timezone.utc).isoformat()
        db = sqlite3.connect(f"file:{self.state_path}?mode=ro", uri=True)
        try:
            total = 0.0
            for (detail,) in db.execute("select detail from calls where kind='run' and at>=? and at<?", (s, e)):
                c = (json.loads(detail or "{}") or {}).get("cost_usd")
                if isinstance(c, (int, float)):
                    total += c
            return round(total, 2)
        finally:
            db.close()

    def light(self, tasks: list[dict]) -> dict:
        light = self.need("light")
        sev = {t["severity"] for t in tasks}
        if sev & set(light.get("red") or []):
            return {"colour": "crit", "text": "Red: something needs you now"}
        n = sum(1 for t in tasks if t["severity"] in set(light.get("amber") or []))
        if n:
            return {"colour": "warn", "text": f"Amber: {n} thing{'s' if n > 1 else ''} need{'' if n > 1 else 's'} you, no emergency"}
        return {"colour": "good", "text": "Green: nothing open"}

    def tasks(self) -> list[dict]:
        rows = []
        for f in self.store.findings(status="open"):
            if f["severity"] not in ("P1", "P2", "P3", "P4"):
                continue
            d = json.loads(f.get("detail") or "{}")
            figures = {k: v for k, v in d.items() if isinstance(v, (int, float, str)) and k != "check"}
            rows.append({"id": f"finding-{f['id']}", "severity": f["severity"], "title": _no_code(f["summary"]),
                         "since": f["opened_day"], "check": d.get("check") or "", "entity_id": f["entity_id"],
                         "figures": figures, "opened_day": f["opened_day"]})
        for i in self.store.incidents(open_only=True):
            p = json.loads(i.get("payload") or "{}")
            rows.append({"id": f"incident-{i['id']}", "severity": i["severity"], "title": _no_code(p.get("message") or i["rule_id"]),
                         "since": i["opened_at"][:10], "check": p.get("check") or "", "entity_id": i["entity_id"],
                         "figures": {"incident": i["id"], "occurrences": i["count"], "state": i["state"]},
                         "opened_day": i["opened_at"][:10]})
        order = {"P1": 0, "P2": 1, "P3": 2, "P4": 3}
        rows.sort(key=lambda r: (order.get(r["severity"], 9), r["opened_day"]))
        return rows

    def offline(self) -> list[dict]:
        crit = set(self.cfg.get("critical_families") or [])
        out, seen = [], set()
        for fam in self.cfg.get("offline_families") or []:
            for r in self.pack.families.get(fam, []):
                st = self.states().get(r["entity_id"]) or {}
                asset = r.get("asset") or r["entity_id"]
                if (st.get("state") or "") in OFF and asset not in seen:
                    seen.add(asset)
                    out.append({"name": r.get("name") or r["entity_id"], "since": (st.get("last_changed") or "")[:16],
                                "critical": fam in crit, "family": fam})
        return out


def _no_code(s: str) -> str:
    import re
    return re.sub(r"^\s*\[[^\]]{2,80}\]\s*", "", s or "").strip()


# ---------------------------------------------------------------- the clues (reports.yaml playbook)
def _fill(text, figures: dict) -> str:
    """A playbook text with the clue's figures in it; a date as a person writes it ("23 Sep")."""
    def show(v):
        if isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-":
            try:
                return date.fromisoformat(v).strftime("%d %b").lstrip("0")
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
    s = datetime.combine(c.end - timedelta(days=days - 1), time(0), c.Z)
    rows = c.cli.statistics([entity_id], s, c.e_dt, "hour", ("mean",)).get(entity_id, [])
    per: dict[date, list[float]] = {}
    for r in rows:
        v = _num(r.get("mean"))
        if v is not None:
            per.setdefault(_ms_day(r["start"], c.Z), []).append(v)
    out = []
    for d, vals in sorted(per.items()):
        run = [v for v in vals if v > thr]
        out.append((d, round(statistics.mean(run)) if run else 0.0, len(run)))
    return out


def _best_split(vals: list[float], min_days: int) -> tuple[int, float] | None:
    """Where the series steps the most: (index of the first day after, change in % of the before mean)."""
    best = None
    for k in range(min_days, len(vals) - min_days + 1):
        before, after = statistics.mean(vals[:k]), statistics.mean(vals[k:])
        if before:
            ch = (after - before) / before * 100
            if best is None or abs(ch) > abs(best[1]):
                best = (k, ch)
    return best


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
            out.append({"subject": a.get("name") or slug, "entity_id": pw, "step_date": rows[k][0].isoformat(),
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
            out.append({"subject": a.get("name") or slug, "entity_id": pw, "change_date": rows[k][0].isoformat(),
                        "hours_before": round(statistics.mean(r[2] for r in rows[:k]), 1),
                        "hours_after": round(statistics.mean(r[2] for r in rows[k:]), 1), "change_pct": round(best[1])})
    return out


def clue_battery_trend(c, when):
    repl = float(c.need("battery", "replace_below_pct"))
    days = int(when.get("days", 30))
    s = datetime.combine(c.end - timedelta(days=days - 1), time(0), c.Z)
    out = []
    for r in c.pack.families.get("battery", []):
        now_v = _num((c.states().get(r["entity_id"]) or {}).get("state"))
        if now_v is None or now_v >= float(when["below_pct"]):
            continue
        rows = c.cli.statistics([r["entity_id"]], s, c.e_dt, "day", ("mean",)).get(r["entity_id"], [])
        pts = [(i, _num(x.get("mean"))) for i, x in enumerate(rows) if _num(x.get("mean")) is not None]
        fall = None
        if len(pts) >= 5:
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            mx, my = statistics.mean(xs), statistics.mean(ys)
            den = sum((x - mx) ** 2 for x in xs)
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0
            fall = round(-slope * 7, 1)
        if not fall or fall <= 0 or now_v <= repl:
            continue                    # no trend to project, or already due: the batteries section shows it
        out.append({"subject": r.get("name") or r["entity_id"], "entity_id": r["entity_id"], "level_pct": round(now_v),
                    "fall_per_week": fall, "weeks_left": round((now_v - repl) / fall, 1), "replace_below_pct": repl})
    return out


def clue_offline(c, when):
    fams = set(when.get("families") or [])
    return [{"subject": o["name"], "since": o["since"], "family": o["family"]} for o in c.offline() if o["family"] in fams]


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
                            "figures": f, "horizon": e.get("horizon"),
                            "playbook": {k: _fill(e.get(k), f) for k in ("look_at", "means", "check", "ask", "cost_of_ignoring")
                                         if e.get(k)}})
    c._clues = (out, problems)
    return c._clues


# ---------------------------------------------------------------- the sections
def s_header(c: Ctx) -> dict:
    title = (f"{c.pack.villa}, week {c.start.isocalendar()[1]}" if c.kind == "fm-weekly"
             else f"{c.pack.villa}, {c.start.strftime('%B %Y')}")
    return {"villa": c.pack.villa, "title": title,
            "dates": f"{c.start.strftime('%A %d %B')} to {c.end.strftime('%A %d %B %Y')}",
            "generated": c.now.astimezone(c.Z).strftime("%a %d %b %Y, %H:%M") + f" {c.Z.key}"}


def s_headline(c: Ctx) -> dict:
    tasks = c.tasks()
    return {**c.light(tasks), "open_tasks": len(tasks), "alerts": len(c.incidents()) + len(c.ha_alerts()),
            "kwh": c.energy.get("total_kwh"), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "task_titles": [t["title"] for t in tasks[:5]]}


def s_hero(c: Ctx) -> dict:
    tasks = c.tasks()
    inc = c.incidents() + c.ha_alerts()
    return {**c.light(tasks), "cost": c.energy.get("total_cost"), "currency": c.energy.get("currency"),
            "kwh": c.energy.get("total_kwh"), "tariff": c.energy.get("tariff"), "incidents": len(inc),
            "handled": sum(1 for i in c.incidents() if i.get("closed_at")), "open_tasks": len(tasks),
            "task_titles": [t["title"] for t in tasks[:3]]}


def s_kpis(c: Ctx) -> dict:
    tasks = c.tasks()
    inc = c.incidents()
    off = c.offline()
    return {"open_tasks": len(tasks), "new": sum(1 for t in tasks if t["opened_day"] >= c.start.isoformat()),
            "carried": sum(1 for t in tasks if t["opened_day"] < c.start.isoformat()),
            "alerts": len(inc) + len(c.ha_alerts()), "alerts_closed": sum(1 for i in inc if i.get("closed_at")),
            "kwh": _r(c.energy.get("total_kwh")), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "offline": len(off), "offline_critical": sum(1 for o in off if o["critical"])}


def s_kpis_month(c: Ctx) -> dict:
    inc = c.incidents()
    done = [t for t in c.store.tasks(None) if t.get("done_at") and c.start.isoformat() <= t["done_at"][:10] <= c.end.isoformat()]
    made = [t for t in c.store.tasks(None) if c.start.isoformat() <= (t.get("created_at") or "")[:10] <= c.end.isoformat()]
    days = [(datetime.fromisoformat(t["done_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds() / 86400
            for t in done if t.get("created_at")]
    nm = c.cfg.get("not_measured_yet") or {}
    return {"kwh": _r(c.energy.get("total_kwh")), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "cost": c.energy.get("total_cost"), "currency": c.energy.get("currency"),
            "incidents": len(inc) + len(c.ha_alerts()), "incidents_closed": sum(1 for i in inc if i.get("closed_at")),
            "tasks_closed": len(done), "tasks_made": len(made),
            "median_days": round(statistics.median(days), 1) if days else None,
            "avoidable": None, "uptime": None, "not_measured": {"avoidable": nm.get("money"), "uptime": nm.get("uptime")}}


def s_tasks(c: Ctx) -> dict:
    return {"rows": c.tasks()}


def _alert_rows(c: Ctx) -> list[dict]:
    rows = []
    for i in c.incidents():
        p = json.loads(i.get("payload") or "{}")
        lasted = None
        if i.get("closed_at"):
            secs = (datetime.fromisoformat(i["closed_at"]) - datetime.fromisoformat(i["opened_at"])).total_seconds()
            lasted = f"{int(secs)} s" if secs < 120 else (f"{int(secs // 60)} min" if secs < 7200 else f"{secs / 3600:.1f} h")
        outcome = {"done": "Done", "resolved": "Cleared in Home Assistant", "not_found": "Not found",
                   "escalated": "Escalated to the owner", "abandoned": "Stopped being watched"}.get(i.get("state"), i.get("state") or "")
        if i.get("reply"):
            outcome += f" ({i['reply']})" if i["reply"].lower() not in outcome.lower() else ""
        rows.append({"when": i["opened_at"], "what": _no_code(p.get("message") or p.get("label") or i["rule_id"]).split("\n")[0],
                     "lasted": lasted or ("open" if not i.get("closed_at") else ""), "outcome": outcome,
                     "severity": i.get("severity"), "source": "agent"})
    rows += c.ha_alerts()
    for r in rows:
        r["when_h"] = datetime.fromisoformat(r["when"]).astimezone(c.Z).strftime("%a %d, %H:%M")
    return sorted(rows, key=lambda r: r["when"])


def s_alerts(c: Ctx) -> dict:
    rules = c.vesta_rules()
    return {"rows": _alert_rows(c), "rules_known": len(rules)}


def s_happened(c: Ctx) -> dict:
    return {"rows": _alert_rows(c)}


def _status_from(series: list[tuple[str, float]], drop_pct: float) -> str:
    vals = [v for _, v in series]
    if len(vals) < 6:
        return "OK"
    recent, before = statistics.mean(vals[-3:]), statistics.mean(vals[:-3])
    return "Watch" if before and (before - recent) / before * 100 >= drop_pct else "OK"


def s_equipment(c: Ctx) -> dict:
    days = int(c.need("card_days"))
    drop = float(c.need("pump", "watch_drop_pct"))
    open_ents = {f["entity_id"] for f in c.store.findings(status="open")}
    cards = []
    for slug, a in sorted(c.pack.assets.items()):
        pw = (a.get("entities") or {}).get("power")
        if a.get("kind") != "motor" or not pw:
            continue
        series = c.running_power(pw, days)
        if len(series) < 2:
            continue                                  # did not run in the period: no card to draw
        status = "Watch" if pw in open_ents else _status_from(series, drop)
        cards.append({"id": f"card-{slug}", "title": a.get("name") or slug, "subtitle": f"Running power per day, last {days} days",
                      "unit": "W", "series": series, "status": status,
                      "figures": {"first": series[0][1] if series else None, "last": series[-1][1] if series else None,
                                  "min": min((v for _, v in series), default=None), "max": max((v for _, v in series), default=None)}})
    for extra in c.cfg.get("cards") or []:
        cards.append(_extra_card(c, extra, days))
    return {"cards": cards}


def _extra_card(c: Ctx, spec: dict, days: int) -> dict:
    eid, kind = spec.get("entity"), spec.get("kind")
    start = c.end - timedelta(days=days - 1)
    series: list[tuple[str, float]] = []
    if kind == "energy_daily":
        series = [(d.isoformat(), v) for d, v in sorted(c.daily_kwh(eid, start, c.end).items())]
    elif kind in ("sensor_daily_max", "sensor_daily_mean"):
        stat = "max" if kind.endswith("max") else "mean"
        s = datetime.combine(start, time(0), c.Z)
        rows = c.cli.statistics([eid], s, c.e_dt, "day", (stat,)).get(eid, [])
        series = [(_ms_day(r["start"], c.Z).isoformat(), round(_num(r.get(stat)), 1)) for r in rows if _num(r.get(stat)) is not None]
    alert = spec.get("alert_at")
    status = "Watch" if alert is not None and any(v >= alert for _, v in series) else "OK"
    return {"id": f"card-{eid}", "title": spec.get("title") or c.name(eid), "subtitle": spec.get("subtitle") or "",
            "unit": spec.get("unit") or "", "series": series, "status": status, "alert_at": alert,
            "figures": {"last": series[-1][1] if series else None, "max": max((v for _, v in series), default=None),
                        "alert_at": alert}}


def s_batteries(c: Ctx) -> dict:
    repl, watch, show = c.need("battery", "replace_below_pct"), c.need("battery", "watch_below_pct"), c.need("battery", "show")
    rows = []
    for r in c.pack.families.get("battery", []):
        v = _num((c.states().get(r["entity_id"]) or {}).get("state"))
        if v is None:
            continue
        lvl = "replace" if v < repl else ("watch" if v < watch else "ok")
        rows.append({"name": r.get("name") or r["entity_id"], "pct": round(v), "level": lvl})
    rows.sort(key=lambda x: x["pct"])
    return {"count": len(rows), "rows": rows[: int(show)], "replace_below_pct": repl,
            "status": "Watch" if any(x["level"] != "ok" for x in rows) else "OK"}


def s_energy_days(c: Ctx) -> dict:
    meter = c.energy.get("main_meter")
    if not meter:
        return {"error": "No main electricity meter in the knowledge pack."}
    prev_start = c.start - timedelta(days=c.days)
    per = c.daily_kwh(meter, prev_start, c.end)
    rows = []
    for k in range(c.days):
        d = c.start + timedelta(days=k)
        rows.append({"day": d.strftime("%a"), "date": d.isoformat(), "kwh": per.get(d), "prev_kwh": per.get(d - timedelta(days=c.days))})
    return {"rows": rows}


def s_circuits(c: Ctx) -> dict:
    n = int(c.need("circuits_show"))
    rows = [{"name": l.get("name"), "kwh": _r(l.get("kwh")), "share_pct": _r(l.get("share_pct")),
             "vs_prev_pct": _r(l.get("vs_prev_pct")), "basis": "measured"} for l in (c.energy.get("loads") or [])[:n]]
    if c.energy.get("unmetered_kwh") is not None:
        rows.append({"name": "Everything else", "kwh": _r(c.energy.get("unmetered_kwh")),
                     "share_pct": _r(c.energy.get("unmetered_pct")), "vs_prev_pct": None, "basis": "not metered"})
    return {"rows": rows}


def s_monitoring(c: Ctx) -> dict:
    rows = [{"item": o["name"], "state": "Offline", "since": o["since"], "critical": o["critical"]} for o in c.offline()]
    resets = [f for f in c.store.findings(since_day=c.start.isoformat()) if f["rule_id"] == "PM-COUNTER-RESET"]
    rules = c.vesta_rules()
    st = c.cli.states(sorted(rules)) if rules else {}
    on = sum(1 for eid in rules if (st.get(eid) or {}).get("state") == "on") if rules else None
    return {"offline": rows, "counter_resets": [{"item": c.name(f["entity_id"]), "day": f["opened_day"]} for f in resets],
            "rules_on": on, "rules_total": len(rules), "muted": [c.name(m["entity_id"]) for m in c.store.mutes()],
            "ai_cost_usd": c.ai_cost()}


def s_money(c: Ctx) -> dict:
    return {"not_measured": (c.cfg.get("not_measured_yet") or {}).get("money")}


def s_fixed_suggest(c: Ctx) -> dict:
    fixed = [{"title": _no_code(f["summary"]), "day": f.get("closed_day")} for f in c.store.findings(status="closed")
             if f.get("closed_day") and c.start.isoformat() <= f["closed_day"] <= c.end.isoformat()]
    props = [{"id": p["id"], "title": p.get("title"), "detail": p.get("detail"), "benefit": p.get("benefit")}
             for p in c.store.proposals("open")]
    return {"fixed": fixed, "proposals": props}


def s_maintenance(c: Ctx) -> dict:
    rows = [{**t, "horizon": c.need("horizon", t["severity"])} for t in c.tasks()]
    order = {"Now": 0, "Soon": 1, "Plan": 2}
    return {"rows": sorted(rows, key=lambda r: order.get(r["horizon"], 9))}


def s_trends(c: Ctx) -> dict:
    charts = []
    meter = c.energy.get("main_meter")
    weeks = int(c.need("trend_weeks"))
    if meter:
        first = c.end - timedelta(days=7 * weeks - 1)
        per = c.daily_kwh(meter, first, c.end)
        bars = []
        for w in range(weeks):
            ws = first + timedelta(days=7 * w)
            vals = [per.get(ws + timedelta(days=k)) for k in range(7)]
            got = [v for v in vals if v is not None]
            bars.append({"label": ws.strftime("%d %b"), "value": round(sum(got)) if got else None})
        charts.append({"id": "trend-weeks", "kind": "bars", "title": f"Electricity per week, kWh (last {weeks} weeks)",
                       "bars": bars, "figures": {"weeks": [b["value"] for b in bars]}})
    for slug, a in sorted(c.pack.assets.items()):
        en = (a.get("entities") or {}).get("energy")
        if a.get("kind") != "motor" or not en:
            continue
        series = [(d.isoformat(), v) for d, v in sorted(c.daily_kwh(en, c.start, c.end).items())]
        if series and max(v for _, v in series) > 0:
            charts.append({"id": f"trend-{slug}", "kind": "line", "title": f"{a.get('name') or slug}, kWh per day",
                           "unit": "kWh", "series": series,
                           "figures": {"first": series[0][1], "last": series[-1][1], "min": min(v for _, v in series),
                                       "max": max(v for _, v in series)}})
    return {"charts": charts, "standby": (c.cfg.get("not_measured_yet") or {}).get("standby")}


def s_gaps(c: Ctx) -> dict:
    rows = []
    for g in c.cfg.get("gaps") or []:
        w = g.get("when") or {}
        hit = False
        if "unmetered_pct_above" in w:
            hit = (c.energy.get("unmetered_pct") or 0) > w["unmetered_pct_above"]
        if "family_missing" in w:
            hit = not c.pack.families.get(w["family_missing"])
        if hit:
            rows.append({"gap": g.get("gap"), "unlocks": g.get("unlocks")})
    return {"rows": rows}


def s_noticed(c: Ctx) -> dict:
    rows, problems = clues(c)
    return {"rows": rows, "problems": problems}


def s_quiet(c: Ctx) -> dict:
    """What did not happen: each VESTA blueprint that never fired in the period (the agent's incidents and
    Home Assistant's own record), in reports.yaml's words, and how many VESTA rules are on."""
    info = c.vesta_rule_info()
    fired = set()
    for i in c.incidents():
        fired.add(json.loads(i.get("payload") or "{}").get("blueprint"))
    for a in c.ha_alerts():
        fired.add(a.get("blueprint"))
    words = c.cfg.get("nothing_happened") or {}
    st = c.cli.states(sorted(info)) if info else {}
    return {"did_not_happen": [w for bp, w in words.items() if bp not in fired],
            "rules_on": sum(1 for eid in info if (st.get(eid) or {}).get("state") == "on") if info else None,
            "rules_total": len(info)}


def s_footer(c: Ctx) -> dict:
    return {"retention": c.pack.retention}


BUILD = {"header": s_header, "headline": s_headline, "hero": s_hero, "kpis": s_kpis, "kpis_month": s_kpis_month,
         "tasks": s_tasks, "alerts": s_alerts, "happened": s_happened, "equipment": s_equipment,
         "batteries": s_batteries, "energy_days": s_energy_days, "circuits": s_circuits, "monitoring": s_monitoring,
         "money": s_money, "fixed_suggest": s_fixed_suggest, "maintenance": s_maintenance, "trends": s_trends,
         "gaps": s_gaps, "footer": s_footer, "noticed": s_noticed, "quiet": s_quiet}


def _r(v, nd=1):
    return round(v, nd) if isinstance(v, (int, float)) else v


def facts(kind: str, c: Ctx) -> dict:
    rep = (c.cfg.get("reports") or {}).get(kind)
    if not rep:
        raise SystemExit(f"reports.yaml has no report {kind!r}")
    out = {"kind": kind, "eyebrow": rep.get("eyebrow", ""), "villa": c.pack.villa,
           "order": [], "sections": {}, "to_write": [], "problems": []}
    for sec in rep.get("sections") or []:
        sid = sec.get("id")
        fn = BUILD.get(sid)
        if fn is None:
            out["problems"].append(f"reports.yaml names a section {sid!r} this composer does not know")
            continue
        try:
            data = fn(c)
        except MissingParameter as e:
            data = {"error": str(e)}
            out["problems"].append(f"section {sid}: {e}")
            out["order"].append(sid)
            out["sections"][sid] = data
            continue
        except Exception as e:  # noqa: BLE001 — one section's failure never sinks the report
            data = {"error": f"{type(e).__name__}: {e}"[:300]}
            out["problems"].append(f"section {sid}: {data['error']}")
        out["order"].append(sid)
        out["sections"][sid] = data
        kind = "checked" if sec.get("checked") else "reading"
        if sec.get("write"):
            out["to_write"].append({"id": sid, "kind": kind, "instruction": sec["write"], "figures": data})
        for field, instruction in (sec.get("write_each") or {}).items():
            items = data.get("rows") or data.get("cards") or data.get("charts") or []
            for it in items:
                if it.get("id"):
                    out["to_write"].append({"id": f"{it['id']}.{field}", "kind": kind, "instruction": instruction,
                                            "figures": {k: v for k, v in it.items() if k != "id"}})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fm-weekly", "owner-monthly"])
    ap.add_argument("--pack", required=True)
    ap.add_argument("--store", default=os.environ.get("VESTA_STORE", "vesta_store.sqlite"))
    ap.add_argument("--zone")
    ap.add_argument("--energy")
    ap.add_argument("--fixture-dir")
    ap.add_argument("--now", help="ISO time, for tests")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if not a.energy:
        print(f"{a.cmd} needs --energy: first run roi-energy energy_period.py --period "
              f"{'month' if a.cmd == 'owner-monthly' else 'week'} --out <file>.json, then pass that file.", file=sys.stderr)
        return 1
    pack = KnowledgePack.load(a.pack)
    zone = a.zone or pack.time_zone
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(timezone.utc)
    c = Ctx(a.cmd, pack, Store(a.store), client_from_args(a), json.load(open(a.energy)), load_cfg(), zone, now,
            os.environ.get("VESTA_STATE"))
    res = facts(a.cmd, c)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, default=str)
    # what the model reads: what to write, not the whole figures file again
    # the playbook entries without a `when`: what the villa knows that no figure can show
    knowledge = [{"group": g, **{k: v for k, v in e.items() if k != "when"}}
                 for g, entries in (c.cfg.get("playbook") or {}).items() for e in entries or [] if not e.get("when")]
    print(json.dumps({"out": a.out, "sections": res["order"], "problems": res["problems"],
                      "clues": res["sections"].get("noticed", {}).get("rows", []), "knowledge": knowledge,
                      "to_write": res["to_write"]}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
