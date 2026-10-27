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
    rules (the alerts of the rules that alert on every run, also while the agent was not there;
    HA keeps it about 10 days)
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
import statistics
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
from vesta_shared import script  # noqa: E402  (client, pack, store, zone, now: one set-up)
from vesta_shared.messaging import no_code as _no_code  # noqa: E402
from vesta_shared.timeutil import lasting  # noqa: E402  (how long something lasted, the Kiosk's words)
from vesta_shared import daily  # noqa: E402  (a device's day: the one "running")
from vesta_shared.daily import energy_daily_features  # noqa: E402  (a meter's day: one reading for every skill)
from vesta_shared.energy_setup import used as energy_used  # noqa: E402  (the villa's total: the Kiosk's rule)
from vesta_shared import result  # noqa: E402  (the night check's rule ids, written once)
from vesta_shared import battery  # noqa: E402  (the night check's battery findings: their ids, one owner)
from vesta_shared.limits import limit  # noqa: E402  (every limit, set on the Limits tab)

HEADLINE_TITLES = limit("reports.headline_titles", 5, unit="titles", group="text", lo=1, hi=50,
                        says="Things to do named in a report's headline (their total is always given).",
                        reached="The others are counted, not named.", told="person")
HERO_TITLES = limit("reports.hero_titles", 3, unit="titles", group="text", lo=1, hi=50,
                    says="Open tasks named at the top of a report (their total is always given).",
                    reached="The others are counted, not named.", told="person")
ERROR_CHARS = limit("reports.error_chars", 300, unit="characters", group="text", lo=80, hi=5000,
                    says="Longest error text kept when one section of a report fails.", reached="The rest is cut.", told="")
from vesta_shared.skill_settings import retired  # noqa: E402  (a villa setting the skill no longer reads: said)
from vesta_shared.timeutil import day_label, day_time_label, local_day, month_label, villa_date, villa_time  # noqa: E402  (the one day format)
from vesta_shared import agent_records  # noqa: E402  (the agent's records: one reader)
from vesta_shared.problems import Problems, problem_name  # noqa: E402  (what is still open, and its one name: one owner)

from vesta_shared.offline import devices_offline, watched_kinds  # noqa: E402  (the one reading of "offline now")
from vesta_shared.asleep import last_value, read_states, unheard  # noqa: E402  (a sleeping device reads its last real state)
from vesta_shared.retention import days_words  # noqa: E402  (how long the villa's system keeps detail, in words)
from vesta_shared.past import automation_run, unread  # noqa: E402  (one reading of "a rule ran"; the one "could not be read whole")
from vesta_shared.critical import run_when  # noqa: E402  (a rule's "When this rule runs": one reading)
from vesta_shared.store import Notes, notes_of  # noqa: E402  (an alert's notes: one reader)
from playbook import (  # noqa: E402  (the clues and the one list of what needs doing)
    MissingParameter, _num, battery_pct, clues, todo)


def load_cfg() -> dict:
    """reports.yaml, with the villa's own villa.reports.yaml on top (vesta_shared.skill_settings: the one reader for
    every skill): its playbook entries and cards are added, its thresholds and nothing_happened words replace the
    shipped ones key by key. The villa's file survives app updates, so the shipped file keeps updating."""
    from vesta_shared.skill_settings import load
    return load(SKILL, "reports.yaml")


def alert_blueprints() -> list[str]:
    """The VESTA rules' blueprints: the ones this skill has words for (reports.yaml `alert_words`).

    ⚠️ ITS OWN LIST (architecture review 7, 2026-10-07): it read the alert-desk skill's rules.yaml — no skill reads
    another skill's folder. tests/test_reports.py holds the two lists equal."""
    return list((load_cfg().get("alert_words") or {}).keys())


def followed_by_agent(rule_eid: str, when: datetime, known: list[tuple[str, datetime]], window_s: float) -> bool:
    """Whether an alert Home Assistant's logbook shows is one the agent already recorded as an incident
    (the same rule, within the window): then it is shown once, as the agent's."""
    return any(rid == rule_eid and abs((when - at).total_seconds()) < window_s for rid, at in known)


class Ctx:
    def __init__(self, kind, pack, store, cli, energy, cfg, zone, now, state_path, params=None):
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
        self._todo = None
        self.problems: list[str] = []     # what a section could not say, for facts.json's problems
        self._states = None
        self._params = None
        self._params_of = params          # script.Context's: the one way a script reads the villa's settings
        # ⚠️ ONE READING PER RUN (architecture review 5, 2026-10-07): the weekly page read the VESTA rules' logbooks
        # 4 times, the rules' states twice and a pump's hourly power up to 3 times — each section asked again
        self._incidents = None
        self._ha_alerts = None
        self._rule_states = None
        self._hourly: dict[str, tuple[int, dict]] = {}

    def need(self, *path):
        """A value of reports.yaml's thresholds. ⚠️ NO FALLBACK HERE (owner, 2026-10-01): a value the file
        lacks is named in the report ("parameter missing"), never replaced by a number in code."""
        v = self.th
        for k in path:
            if not isinstance(v, dict) or k not in v:
                raise MissingParameter(".".join(path), said="reports.yaml: parameter missing: thresholds." + ".".join(path))
            v = v[k]
        return v

    # ---- shared readings
    def params(self):
        """The villa's parameters, as every script reads them (vesta_shared.script.Context.params: live_params,
        kept ten minutes in the store).

        ⚠️ ONE WAY IN (architecture review 13, 2026-10-09): this built its own and turned any error into "no
        parameters" — a volt battery's nominal that could not be read made it leave the batteries table, unsaid."""
        if self._params is None:
            from vesta_shared.params import VillaParams, live_params
            if self._params_of is not None:
                self._params = self._params_of()
            else:                                 # a Ctx built by hand (a test): the same reading, without a Context
                self._params = live_params(self.cli, self.store) if self.store is not None else VillaParams()
        return self._params

    def states(self) -> dict:
        if self._states is None:
            ids = [r["entity_id"] for fam in watched_kinds() for r in self.pack.families.get(fam, [])]
            ids += [r["entity_id"] for r in self.pack.families.get("battery", [])]
            # a device asleep between its reports reads its last real state (vesta_shared.asleep): its battery has a line
            self._states = read_states(self.cli, self.pack, self.now, sorted(set(ids))) if ids else {}
        return self._states

    def name(self, entity_id: str) -> str:
        return self.pack.name_of(entity_id) or entity_id.split(".", 1)[-1].replace("_", " ").capitalize()

    def vesta_rules(self) -> dict[str, str]:
        """automation entity id -> its name, for the automations built on the alert-desk blueprints."""
        return {eid: r["alias"] for eid, r in self.vesta_rule_info().items()}

    def vesta_rule_info(self) -> dict[str, dict]:
        """automation entity id -> {alias, blueprint, run_when} for the VESTA rules (run_when: its "When this rule runs"
        choice, vesta_shared.critical.run_when)."""
        if self._rules is not None:
            return self._rules
        key = f"vesta_rules3:{self.now.date().isoformat()}"        # 3: with run_when
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
                    rules[eid] = {"alias": str(conf.get("alias") or eid), "blueprint": hit, "run_when": run_when(conf)}
            self.store.cache_put(key, rules)
        self._rules = rules
        return rules

    def incidents(self) -> list[dict]:
        if self._incidents is None:
            s, e = self.s_dt.astimezone(timezone.utc).isoformat(), self.e_dt.astimezone(timezone.utc).isoformat()
            # every run of an alert, a reopened one's included (store.incident_occurrences, architecture review 24)
            self._incidents = [i for i in self.store.incident_occurrences() if s <= (i.get("opened_at") or "") < e]
        return list(self._incidents)

    def rule_states(self) -> dict:
        """The VESTA rules' automations as Home Assistant has them now (on or off)."""
        if self._rule_states is None:
            info = self.vesta_rule_info()
            self._rule_states = self.cli.states(sorted(info)) if info else {}
        return self._rule_states

    def hour_rows(self, entity_id: str, days: int) -> list[dict]:
        """An entity's hourly statistics (mean, min, max) over the last `days` days of the period, read once per run
        (a longer window asked later reads again, once)."""
        have = self._hourly.get(entity_id)
        if have is None or have[0] < days:
            s = datetime.combine(self.end - timedelta(days=days - 1), time(0), self.Z)
            rows = self.cli.statistics([entity_id], s, self.e_dt, "hour", ("mean", "min", "max")).get(entity_id, [])
            have = self._hourly[entity_id] = (days, rows)
        first = self.end - timedelta(days=days - 1)
        return [r for r in have[1] if local_day(r["start"], self.Z) >= first]

    def running_days(self, entity_id: str, asset: dict | None, days: int) -> list[tuple[date, float | None, float]]:
        """(day, power while running — None on a day it did not run —, run hours) for each day with data, by the one "running"
        (vesta_shared.daily: the night check's and the energy figures' rule).

        ⚠️ ONE "RUNNING" (owner, 2026-10-19): this page counted an hour whose MEAN passed 15 W as an hour run — the
        house pressure pump, a few minutes of bursts in most hours, read 18 h on a day it ran about 1 h."""
        _, feats = daily.power_days(asset, self.hour_rows(entity_id, days), self.pack.time_zone, self.params())
        return daily.running_series(feats)

    def ha_alerts(self) -> list[dict]:
        if self._ha_alerts is None:
            self._ha_alerts = self._read_ha_alerts()
        return list(self._ha_alerts)

    def _read_ha_alerts(self) -> list[dict]:
        """The alerts of the VESTA rules from Home Assistant's own logbook, for the times the agent was not
        listening (the agent records every alert it hears as an incident): a run counts only for the
        blueprints reports.yaml lists in `alert_on_every_run`.

        ⚠️ A RULE RUNNING IS NOT AN ALERT (villa, 2026-10-01). A schedule rule runs at the start of every
        expected run window and sends only when the pump does not run; a presence rule mostly stops at its
        conditions. Counted as alerts, 71 runs made 71 "critical alerts" in a week that had a handful. A
        condition rule only runs once its condition has held: each of its runs IS an alert — except a run the villa's
        system starts itself (reports.yaml not_an_alert_when_started_by: reloading its rules re-checks every one; 400
        such runs were week 42's "403 critical alerts"). Matching the
        notify entities' messages instead was tried and failed: the wall tablet gets every automation's
        messages, and nothing in the record says which rule sent one."""
        every_run = {str(b).removesuffix(".yaml") for b in self.cfg.get("alert_on_every_run") or []}
        rechecks = [str(e) for e in self.cfg.get("not_an_alert_when_started_by") or [] if e]
        window = float(self.need("alert_follow_window_min")) * 60
        out = []
        known = [(i.get("rule_id"), datetime.fromisoformat(i["opened_at"])) for i in self.incidents() if i.get("opened_at")]
        for eid, rinfo in self.vesta_rule_info().items():
            if str(rinfo["blueprint"]).removesuffix(".yaml") not in every_run:
                continue
            try:
                book = self.cli.logbook_read(self.s_dt, self.e_dt, entity_id=eid, now=self.now)
            except Exception:  # noqa: BLE001
                continue
            if book.older_than_kept is not None:
                # ⚠️ A MONTH OLDER THAN THE LOGBOOK KEPT (owner, 2026-10-20): counted from where it begins, and said
                self.problems.append(f"{self.alert_words(rinfo)}: counted from "
                                     f"{day_time_label(book.older_than_kept.astimezone(self.Z), weekday=True)}, the "
                                     f"villa's system keeps its logbook {days_words(self.cli.detailed_days)} only.")
            if not book.whole:
                # ⚠️ A COUNT FROM A READ STOPPED SHORT IS A FLOOR (round 2, 2026-10-16): said, never given as the week's
                self.problems.append(f"{self.alert_words(rinfo)}: "
                                     + unread("its runs", day_time_label(book.reach.astimezone(self.Z), weekday=True))
                                     + ", its alerts after that are not counted.")
            for r in book.rows:
                run = automation_run(r)              # one reading of "a rule ran" (vesta_shared.past): switched on or
                if run is None:                      # off is not a run
                    continue
                if run.started_by in rechecks:
                    continue                         # the villa's system re-checking its rules: not an alert
                t = run.at
                if followed_by_agent(eid, t, known, window):
                    continue                         # the agent followed it: shown once, as the agent's
                out.append({"when": t.isoformat(), "what": self.alert_words(rinfo), "lasted": None, "severity": None,
                            "blueprint": rinfo["blueprint"], "outcome": "Alerted by the villa's system", "source": "home_assistant"})
        return out

    def alert_words(self, rinfo: dict) -> str:
        """A VESTA rule in words: its alias without the blueprint's prefix, in reports.yaml's alert_words."""
        alias, bp = rinfo.get("alias") or "", str(rinfo.get("blueprint") or "").removesuffix(".yaml")
        subject = alias.split("---", 1)[1] if "---" in alias else alias
        subject = subject.replace("_", " ").replace("-", " ").strip().capitalize()
        words = (self.cfg.get("alert_words") or {}).get(bp) or "{subject}"
        return words.format(subject=subject)

    def daily_kwh(self, entity_id: str, start: date, end: date) -> dict[date, float]:
        s = datetime.combine(start, time(0), self.Z)
        e = datetime.combine(end + timedelta(days=1), time(0), self.Z)
        rows = self.cli.statistics([entity_id], s, e, "day", ("change", "sum")).get(entity_id, [])
        # one reading of a meter's day (vesta_shared.daily, as roi-energy reads it): a counter stepping back is a
        # reset, not consumption
        return {d: round(f["kwh"], 2) for d, f in energy_daily_features(rows, self.pack.time_zone).items()
                if f["kwh"] is not None and not f["counter_reset"]}

    def total_from(self) -> dict | None:
        """The statistics the villa's total is made of, as roi-energy found them (its `total_from`: the Energy
        settings' grid and solar, or the main meter it fell back on); a period from before carries only main_meter."""
        t = self.energy.get("total_from")
        if t:
            return t
        m = self.energy.get("main_meter")
        return {"grid_in": [m], "grid_out": [], "solar": []} if m else None

    def daily_total(self, start: date, end: date) -> dict[date, float]:
        """The villa's electricity per day, by the same rule as the period's total (grid in + solar − grid out):
        ⚠️ the weekly page's days and trend read ONE meter by name while roi-energy's total followed the Energy
        settings (round 2, 2026-10-16) — the days would not have added up to the week. A day no source read is absent."""
        t = self.total_from()
        if not t:
            return {}
        per = {i: self.daily_kwh(i, start, end) for i in dict.fromkeys(t["grid_in"] + t["grid_out"] + t["solar"])}
        days = {d for i in t["grid_in"] + t["solar"] for d in per[i]}
        add = lambda ids, d: sum(per[i].get(d, 0.0) for i in ids)  # noqa: E731
        return {d: round(energy_used(add(t["grid_in"], d), add(t["grid_out"], d), add(t["solar"], d)), 2) for d in days}

    def ai_cost(self) -> float | None:
        s, e = self.s_dt.astimezone(timezone.utc).isoformat(), self.e_dt.astimezone(timezone.utc).isoformat()
        return agent_records.cost_between(self.state_path, s, e)

    def listening_since(self) -> datetime | None:
        """When the agent's own record starts (its first run or event); None without one."""
        return agent_records.listening_since(self.state_path)

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
        """What is still open, as vesta_shared.problems answers it for every reader (the daily digest,
        the owner's lines and the concierge ask the same module)."""
        return [{**p, "kind": p["rule_id"] if p["source"].startswith("finding") else p["id"], "opened_day": p["since"]}
                for p in Problems(self.store).open_problems()]

    def offline(self) -> list[dict]:
        """The DEVICES offline: one row per Home Assistant device, by its name, since its first sensor went — the one
        reading of it (vesta_shared.offline.devices_offline: the night check's and the concierge's), over this skill's
        kinds watched for it (vesta_shared.offline.watched_kinds, the night check's and the chat's too), with no minimum
        (the page lists every one).

        ⚠️ DEVICES, NOT THEIR SENSORS (owner, 2026-10-09: "make sure this table only reports devices, and not entities
        related to a device"). It listed sensors: a phone's Wi-Fi traffic as two rows "RX" and "TX", one pump plug as
        "Jacuzzi Pump Power" beside its relay. A sensor with no device keeps its own row; a device Home Assistant
        knows nothing about (no name, maker or model: a phone seen on the Wi-Fi) is not one of the villa's."""
        if "offline_families" in self.cfg:
            # ⚠️ ONE LIST NOW (architecture review P, 2026-10-27): a villa's own reports.yaml that still names its
            # families is said, never read in silence: the Limits tab holds the one list
            self.problems.append("villa.reports.yaml: offline_families is no longer read; the kinds of device watched "
                                 "for going offline are one setting, offline.watched_kinds, on the Limits tab")
        return [{"name": g.name, "since": _local(g.since.isoformat(), self.Z) if g.since else "", "critical": g.critical,
                 "family": g.family, "entity_id": g.entity_id}
                for g in devices_offline(self.pack, self.states(), self.now, watched_kinds(),
                                         history=getattr(getattr(self, "cli", None), "history", None))]


def _local(iso, zone) -> str:
    """A Home Assistant time as the villa's, minute precision ("2026-10-06T16:15"): what _fill and compose show."""
    t = villa_time(iso, zone) if iso else None
    return t.replace(tzinfo=None).isoformat(timespec="minutes") if t else ""


# ---------------------------------------------------------------- the sections
def s_header(c: Ctx) -> dict:
    title = (f"{c.pack.villa}, week {c.start.isocalendar()[1]}" if c.kind == "fm-weekly"
             else f"{c.pack.villa}, {month_label(c.start)}")
    return {"villa": c.pack.villa, "title": title,
            "dates": f"{day_label(c.start, long=True)} to {day_label(c.end, long=True, year=True)}",
            "generated": day_time_label(c.now.astimezone(c.Z), weekday=True, year=True) + f" {c.Z.key}"}


def s_headline(c: Ctx) -> dict:
    items = todo(c)
    return {**c.light(items), "to_do": len(items), "alerts": len(c.incidents()) + len(c.ha_alerts()),
            "kwh": c.energy.get("total_kwh"), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "to_do_titles": [t["title"] for t in items[:HEADLINE_TITLES]]}


def s_hero(c: Ctx) -> dict:
    tasks = todo(c)
    inc = c.incidents() + c.ha_alerts()
    return {**c.light(tasks), "cost": c.energy.get("total_cost"), "currency": c.energy.get("currency"),
            "kwh": c.energy.get("total_kwh"), "tariff": c.energy.get("tariff"), "incidents": len(inc),
            "handled": sum(1 for i in c.incidents() if i.get("closed_at")), "open_tasks": len(tasks),
            "task_titles": [t["title"] for t in tasks[:HERO_TITLES]]}


def s_kpis(c: Ctx) -> dict:
    items = todo(c)
    inc = c.incidents()
    off = c.offline()
    return {"open_tasks": len(items), "new": sum(1 for t in items if (villa_date(t["since"], c.Z) or c.start) >= c.start),
            "carried": sum(1 for t in items if (villa_date(t["since"], c.Z) or c.start) < c.start),
            "alerts": len(inc) + len(c.ha_alerts()), "alerts_open": sum(1 for i in inc if not i.get("closed_at")),
            # the owner's Monday lines read these four (compose.owner_weekly), never a count of their own
            "p1": sum(1 for i in inc if i.get("severity") == "P1"),
            "kwh": _r(c.energy.get("total_kwh")), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "offline": len(off), "offline_critical": sum(1 for o in off if o["critical"])}


def s_kpis_month(c: Ctx) -> dict:
    inc = c.incidents()
    done = [t for t in c.store.tasks(None) if t.get("done_at") and c.start <= villa_date(t["done_at"], c.Z) <= c.end]
    made = [t for t in c.store.tasks(None) if t.get("created_at") and c.start <= villa_date(t["created_at"], c.Z) <= c.end]
    days = [(datetime.fromisoformat(t["done_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds() / 86400
            for t in done if t.get("created_at")]
    nm = c.cfg.get("not_measured_yet") or {}
    return {"kwh": _r(c.energy.get("total_kwh")), "vs_prev_pct": _r(c.energy.get("total_vs_prev_pct")),
            "cost": c.energy.get("total_cost"), "currency": c.energy.get("currency"),
            "incidents": len(inc) + len(c.ha_alerts()), "incidents_closed": sum(1 for i in inc if i.get("closed_at")),
            "tasks_closed": len(done), "tasks_made": len(made),
            "median_days": round(statistics.median(days), 1) if days else None,
            "avoidable": None, "uptime": None, "not_measured": {"avoidable": nm.get("money"), "uptime": nm.get("uptime")}}


def s_todo(c: Ctx) -> dict:
    return {"rows": todo(c), "problems": clues(c)[1]}


def _alert_rows(c: Ctx) -> list[dict]:
    words = c.cfg.get("incident_words") or {}
    rows = []
    for i in c.incidents():
        p = notes_of(i)
        lasted = None
        if i.get("closed_at"):
            secs = (datetime.fromisoformat(i["closed_at"]) - datetime.fromisoformat(i["opened_at"])).total_seconds()
            lasted = lasting(secs)   # the one duration wording on both apps (was "119 s", "119 min", "2.3 h")
        state = i.get("state") or ""
        if state not in words:
            # a state with no words is named, not shown raw to the reader
            c.problems.append(f"reports.yaml: incident_words has no words for the state {state!r}")
        outcome = words.get(state, state)
        if i.get("reply"):
            outcome += f" ({i['reply']})" if i["reply"].lower() not in outcome.lower() else ""
        rows.append({"when": i["opened_at"], "what": problem_name(p.get("message") or p.get("label") or i["rule_id"])["headline"],
                     "lasted": lasted or ("open" if not i.get("closed_at") else ""), "outcome": outcome,
                     "severity": i.get("severity"), "source": "agent"})
    rows += c.ha_alerts()
    for r in rows:
        r["when_h"] = day_time_label(datetime.fromisoformat(r["when"]).astimezone(c.Z), weekday=True)
    return sorted(rows, key=lambda r: r["when"])


def _grouped(rows: list[dict]) -> list[dict]:
    """One row per alert: the same alert repeated in the period is one row with its count."""
    by: dict[str, dict] = {}
    for r in rows:
        g = by.get(r["what"])
        if g is None:
            by[r["what"]] = {**r, "times": 1, "first_h": r["when_h"]}
        else:
            g.update({"times": g["times"] + 1, "when": r["when"], "when_h": r["when_h"], "lasted": r["lasted"],
                      "outcome": r["outcome"]})
    return sorted(by.values(), key=lambda r: r["when"])


def s_alerts(c: Ctx) -> dict:
    return {"rows": _grouped(_alert_rows(c))}


def s_happened(c: Ctx) -> dict:
    return {"rows": _grouped(_alert_rows(c))}


def s_equipment(c: Ctx) -> dict:
    days = int(c.need("card_days"))
    # ⚠️ "WATCH" HAS ONE OWNER (owner, 2026-10-19: "the night check owns each number asked twice"): a card is "Watch"
    # exactly when the one list names its device — its clues and the night's open findings (a pump's running power
    # that dropped is the night's PM-POWER-CHANGE). The card's own "last 3 days 10 % under the days before" is gone.
    # ⚠️ BY WHAT THE ITEM MEASURES, NOT ITS RELAY (villa, 2026-10-19): two pumps on one relay are one device; the house
    # pump's finding set the pool pump's card to "Watch" too (knowledge_pack.reading_key)
    watched = {c.pack.reading_key(e) for it in todo(c) for e in it.get("entity_ids") or []}
    cards = []
    for slug, a in sorted(c.pack.assets.items()):
        pw = (a.get("entities") or {}).get("power")
        if a.get("kind") != "motor" or not pw:
            continue
        run = c.running_days(pw, a, days)
        series = [(d.isoformat(), round(w)) for d, w, _ in run if w is not None]
        subtitle, unit = f"Running power per day, last {days} days", "W"
        if not series:
            # no steady hour (a pump in short bursts): its power is not known, its running time is (daily.running_series)
            series = [(d.isoformat(), round(h, 1)) for d, _, h in run if h > 0]
            subtitle, unit = f"Hours running per day, last {days} days", "h"
        if len(series) < 2:
            continue                                  # did not run in the period: no card to draw
        # ⚠️ BY THE ONE DEVICE IDENTITY (architecture review 13): the to-do list names devices by device_of, and this
        # compared them with the asset slug — no card was ever set to "Watch" by it (a regression of 0.12.115)
        status = "Watch" if c.pack.reading_key(pw) in watched else "OK"
        cards.append({"id": f"card-{slug}", "title": c.pack.reading_name(pw, slug), "subtitle": subtitle,
                      "unit": unit, "series": series, "status": status,
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
        series = [(local_day(r["start"], c.Z).isoformat(), round(_num(r.get(stat)), 1)) for r in rows if _num(r.get(stat)) is not None]
    alert = spec.get("alert_at")
    status = "Watch" if alert is not None and any(v >= alert for _, v in series) else "OK"
    return {"id": f"card-{eid}", "title": spec.get("title") or c.name(eid), "subtitle": spec.get("subtitle") or "",
            "unit": spec.get("unit") or "", "series": series, "status": status, "alert_at": alert,
            "figures": {"last": series[-1][1] if series else None, "max": max((v for _, v in series), default=None),
                        "alert_at": alert}}


def night_battery_says(c: Ctx) -> dict[str, tuple[str, str]]:
    """What the night check says of each battery, by its reading (knowledge_pack.reading_key): (level, its sentence) —
    "replace" for an open PM-BATTERY-CRIT / LOW problem (the one list's input, Problems.open_problems: a fault a
    person closed is not shown), "watch" for an open PM-BATTERY-TREND finding (a report-only finding: never a task, so
    read from the night's own record)."""
    says: dict[str, tuple[str, str]] = {}
    if c.store is None:
        return says                       # no record of the night: nothing said, every battery shows its charge only
    for f in c.store.findings(status="open"):
        if f["rule_id"] == battery.TREND:
            says[c.pack.reading_key(f["entity_id"])] = ("watch", _no_code(f["summary"]))
    for t in c.tasks():
        if t["rule_id"] in battery.REPLACE and t.get("entity_id"):
            says[c.pack.reading_key(t["entity_id"])] = ("replace", t["title"])
    return says


def s_batteries(c: Ctx) -> dict:
    """Every battery's charge, lowest first; its level is the NIGHT CHECK's (night_battery_says), never this page's.

    ⚠️ ONE JUDGE (owner, 2026-10-19: "the night check owns each number asked twice"): the page drew red under its own
    20 % and amber under 35 %, and its playbook projected "weeks left" to that 20 %, while the night check said
    "replace now" under 10 %, "within the week" under 20 % and "days left" to 10 % — two "replace" lines and two
    projections for one cell."""
    show = c.need("battery", "show")
    says = night_battery_says(c)
    rows = []
    for r in c.pack.families.get("battery", []):
        st = c.states().get(r["entity_id"]) or {}
        # a device asleep with no report in days (vesta_shared.asleep): said, with its last known charge if one was read
        quiet = unheard(st, c.now)
        # its rested level, as the night check judged it (battery.rested), never a dip of the moment
        v = battery.rested(c.store, r["entity_id"], _num(last_value(st)), c.now)
        unit = (r.get("unit") or "%").strip()
        pct = battery_pct(c, r, v)
        if pct is None and not quiet:
            continue                      # volts with no nominal: the night check asks for it, never a guess
        lvl, said = says.get(c.pack.reading_key(r["entity_id"]), ("ok", None))
        # named as the device it powers (knowledge_pack.reading_name: its own device, never its radio bridge)
        rows.append({"name": c.pack.reading_name(r["entity_id"], r.get("name") or r["entity_id"]),
                     "pct": round(pct) if pct is not None else None, "level": "watch" if quiet and lvl == "ok" else lvl,
                     "volts": round(v, 2) if unit == "V" and v is not None else None,
                     **({"night": said} if said else {}), **({"unheard": quiet} if quiet else {})})
    # one with no reading first (it is said why), then the lowest
    rows.sort(key=lambda x: (x["pct"] is not None, x["pct"] or 0))
    return {"count": len(rows), "rows": rows[: int(show)],
            "status": "Watch" if any(x["level"] != "ok" for x in rows) else "OK"}


def s_energy_days(c: Ctx) -> dict:
    if not c.total_from():
        return {"error": "No electricity total: the villa's Energy settings name no grid meter."}
    prev_start = c.start - timedelta(days=c.days)
    per = c.daily_total(prev_start, c.end)
    rows = []
    for k in range(c.days):
        d = c.start + timedelta(days=k)
        rows.append({"day": day_label(d, short=True), "date": d.isoformat(), "kwh": per.get(d), "prev_kwh": per.get(d - timedelta(days=c.days))})
    return {"rows": rows}


def s_circuits(c: Ctx) -> dict:
    n = int(c.need("circuits_show"))
    cap = float(c.need("circuit_change_max_pct"))
    rows = [{"name": l.get("name"), "kwh": _r(l.get("kwh")), "share_pct": _r(l.get("share_pct")),
             "vs_prev_pct": _r(l.get("vs_prev_pct")),
             # a device the Energy settings put inside another is already in that one's kWh: the table says so
             "basis": f"measured, inside {l['inside']}" if l.get("inside") else "measured"}
            for l in (c.energy.get("loads") or [])[:n]]
    if c.energy.get("unmetered_kwh") is not None:
        rows.append({"name": "Everything else", "kwh": _r(c.energy.get("unmetered_kwh")),
                     "share_pct": _r(c.energy.get("unmetered_pct")), "vs_prev_pct": None, "basis": "not metered"})
    return {"rows": rows, "change_max_pct": cap}


def s_monitoring(c: Ctx) -> dict:
    """Did the monitoring itself work this period: the agent listening, the safety rules on, the meters' counters, what
    the AI cost. ⚠️ NEVER THE VILLA'S DEVICES (owner, 2026-10-19: "it should only list the monitoring related points"):
    an offline sensor was listed here as well as in "Do this week" and the "devices offline" figure."""
    since = c.listening_since()
    resets = [f for f in c.store.findings(since_day=c.start.isoformat()) if f["rule_id"] == result.COUNTER_RESET]
    rules = c.vesta_rules()
    st = c.rule_states()
    on = sum(1 for eid in rules if (st.get(eid) or {}).get("state") == "on") if rules else None
    # named as the device, once each (knowledge_pack.device_of)
    return {"listening_since": since.isoformat() if since is not None and since > c.s_dt else None, "counter_resets": [{"item": c.pack.device_name(f["entity_id"], c.name(f["entity_id"])), "day": f["opened_day"]}
                                                for f in resets],
            "rules_on": on, "rules_total": len(rules),
            "ai_cost_usd": c.ai_cost()}


def s_money(c: Ctx) -> dict:
    return {"not_measured": (c.cfg.get("not_measured_yet") or {}).get("money")}


def s_fixed_suggest(c: Ctx) -> dict:
    # ⚠️ "FIXED" IS WHAT ENDED, NOT WHAT HAPPENED ONCE (architecture review 30): a pump that ran short one night, or a
    # battery-trend event, opened and closed the same day — listed "Fixed" though nobody repaired anything
    fixed = [{"title": problem_name(f["summary"])["headline"], "day": f.get("closed_day")} for f in c.store.findings(status="closed")
             if f.get("closed_day") and c.start.isoformat() <= f["closed_day"] <= c.end.isoformat()
             and f["closed_day"] != (f.get("reopened_day") or f.get("opened_day"))]
    props = [{"id": p["id"], "title": p.get("title"), "detail": p.get("detail"), "benefit": p.get("benefit")}
             for p in c.store.proposals("open")]
    return {"fixed": fixed, "proposals": props}


def s_trends(c: Ctx) -> dict:
    charts = []
    weeks = int(c.need("trend_weeks"))
    if c.total_from():
        first = c.end - timedelta(days=7 * weeks - 1)
        per = c.daily_total(first, c.end)
        bars = []
        for w in range(weeks):
            ws = first + timedelta(days=7 * w)
            vals = [per.get(ws + timedelta(days=k)) for k in range(7)]
            got = [v for v in vals if v is not None]
            bars.append({"label": day_label(ws), "value": round(sum(got)) if got else None})
        charts.append({"id": "trend-weeks", "kind": "bars", "title": f"Electricity per week, kWh (last {weeks} weeks)",
                       "bars": bars, "figures": {"weeks": [b["value"] for b in bars]}})
    for slug, a in sorted(c.pack.assets.items()):
        en = (a.get("entities") or {}).get("energy")
        if a.get("kind") != "motor" or not en:
            continue
        series = [(d.isoformat(), v) for d, v in sorted(c.daily_kwh(en, c.start, c.end).items())]
        if series and max(v for _, v in series) > 0:
            charts.append({"id": f"trend-{slug}", "kind": "line", "title": f"{c.pack.reading_name(en, slug)}, kWh per day",
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


def s_quiet(c: Ctx) -> dict:
    """What did not happen: each VESTA blueprint that never fired in the period (the agent's incidents and
    Home Assistant's own record), in reports.yaml's words, and how many VESTA rules are on."""
    info = c.vesta_rule_info()
    fired = set()
    for i in c.incidents():
        fired.add(notes_of(i).get(Notes.BLUEPRINT))
    for a in c.ha_alerts():
        fired.add(a.get("blueprint"))
    words = c.cfg.get("nothing_happened") or {}
    # ⚠️ ONLY WHAT IS KNOWN (villa, 2026-10-01): a rule that does not alert on every run is seen only by
    # the agent; for a period the agent did not listen to from its start, "no equipment missed its
    # schedule" would be a guess — such a rule is left out of the sentence.
    every_run = {str(b).removesuffix(".yaml") for b in c.cfg.get("alert_on_every_run") or []}
    since = c.listening_since()
    knows = (lambda bp: True) if since is not None and since <= c.s_dt else (lambda bp: bp in every_run)
    st = c.rule_states()
    scope_words = c.cfg.get("nothing_happened_scope") or {}

    def scoped(bp: str, w: str) -> str:
        # its rules' "When this rule runs": all "always" → as written; else the line says when they watch
        whens = {r.get("run_when", "always") for r in info.values() if str(r.get("blueprint", "")).removesuffix(".yaml") == bp}
        if whens <= {"always"}:
            return w
        key = next(iter(whens)) if len(whens) == 1 else "mixed"
        return f"{w} {scope_words[key]}" if scope_words.get(key) else w
    return {"did_not_happen": [scoped(bp, w) for bp, w in words.items() if bp not in fired and knows(bp)],
            "rules_on": sum(1 for eid in info if (st.get(eid) or {}).get("state") == "on") if info else None,
            "rules_total": len(info)}


def s_footer(c: Ctx) -> dict:
    return {"retention": c.pack.retention}


BUILD = {"header": s_header, "headline": s_headline, "hero": s_hero, "kpis": s_kpis, "kpis_month": s_kpis_month,
         "todo": s_todo, "alerts": s_alerts, "happened": s_happened, "equipment": s_equipment,
         "batteries": s_batteries, "energy_days": s_energy_days, "circuits": s_circuits, "monitoring": s_monitoring,
         "money": s_money, "fixed_suggest": s_fixed_suggest, "trends": s_trends,
         "gaps": s_gaps, "footer": s_footer, "quiet": s_quiet}


def _r(v, nd=1):
    return round(v, nd) if isinstance(v, (int, float)) else v


def facts(kind: str, c: Ctx) -> dict:
    rep = (c.cfg.get("reports") or {}).get(kind)
    if not rep:
        raise SystemExit(f"reports.yaml has no report {kind!r}")
    out = {"kind": kind, "eyebrow": rep.get("eyebrow", ""), "villa": c.pack.villa, "zone": c.Z.key,
           "order": [], "sections": {}, "to_write": [], "problems": []}
    c.problems = out["problems"]       # a section that cannot say something names it here
    # a threshold the villa's villa.reports.yaml still sets although the skill retired it (reports.yaml `retired`)
    out["problems"] += retired(SKILL, "reports.yaml")
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
            data = {"error": f"{type(e).__name__}: {e}"[:ERROR_CHARS]}
            out["problems"].append(f"section {sid}: {data['error']}")
        out["order"].append(sid)
        if sec.get("style") and isinstance(data, dict):
            data["style"] = sec["style"]
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
    script.arguments(ap, pack=True, pack_required=True)     # --pack --store --zone --fixture-dir --now
    ap.add_argument("--energy")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if not a.energy:
        print(f"{a.cmd} needs --energy: first run roi-energy energy_period.py --period "
              f"{'month' if a.cmd == 'owner-monthly' else 'week'} --out <file>.json, then pass that file.", file=sys.stderr)
        return 1
    s = script.Context(a, skill=SKILL, settings_file="reports.yaml")    # its `behaviour:` (the one "running")
    c = Ctx(a.cmd, s.pack, s.store, s.client, json.load(open(a.energy)), load_cfg(), s.zone, s.now,
            os.environ.get("VESTA_STATE"), params=lambda: s.params)
    res = facts(a.cmd, c)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, default=str)
    # what the model reads: what to write, not the whole figures file again
    # the playbook entries without a `when`: what the villa knows that no figure can show
    knowledge = [{"group": g, **{k: v for k, v in e.items() if k != "when"}}
                 for g, entries in (c.cfg.get("playbook") or {}).items() for e in entries or [] if not e.get("when")]
    print(json.dumps({"out": a.out, "sections": res["order"], "problems": res["problems"],
                      "to_do": res["sections"].get("todo", {}).get("rows", []), "knowledge": knowledge,
                      "to_write": res["to_write"]}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
