"""The Limits tab: every limit on what the agent reads, says and keeps, on one page, each saved where it lives.

⚠️ ONE PAGE, NO NEW HOME (owner, 2026-10-20: "a change in a setting in this new page shall also change the
corresponding existing value in the existing tabs" — and the tab may be temporary). A value is written where the
agent already reads it, through the page's one writer (changes.PageFiles: checked, recorded in Page changes, undoable):

    code     a limit written in the code (vesta_shared.limits.limit): limits.yaml, beside policy.yaml
    skill    a number of a skill's settings file: the villa's own villa.<file> (kept by updates) — or, inside a list,
             the skill's file itself (a villa file's list is added to the skill's, it cannot replace one entry)
    policy   a setting of policy.yaml: the Rules tab shows the same value

Nothing else on the page changes; removing this tab leaves every value where it was written.
"""
from __future__ import annotations

import io
import os
import re

import yaml
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from vesta_shared import limits
from vesta_shared.daily import VILLA_WIDE

from ..places import where
from ..policy import CONVERSATION_RESETS, DEFAULT_BEHAVIOUR, DEFAULTS, KEEP, PROFILES, WORDS, Policy
from .changes import Refused, _read
from .policy_doc import _yaml

PLACE = "Limits"
SKILL_GROUP, POLICY_GROUP = "skills", "rules"


#: What a villa-wide setting (vesta_shared.daily.VILLA_WIDE) is, on its one row
WIDE_WORDS = {"on_threshold_fraction": "Running, for the whole villa: the share of a device's typical peak above which "
                                       "it counts as running. One value for every skill that reads it, so a device runs "
                                       "or not the same way in every message and report."}

#: A setting's unit, read from its own name (owner, 2026-10-23: "always show the units in the value column"): ONE rule
#: for every skill's and every rule's number, so a new setting shows its unit without anyone listing it. The counts a
#: name cannot tell are named once below (the noun the setting counts).
COUNTS = {"min_signals": "signals", "starts_min": "starts", "cycle_min_runs": "runs", "cycle_min_periods": "periods",
          "ordinary_hide_over": "periods", "state_lane_max": "states", "integration_down_devices": "devices",
          "reconnect_events": "drops", "battery_trend_min_points": "readings", "show": "batteries",
          "circuits_show": "rows", "group_from": "items", "days_context_min": "days", "days_context": "days",
          "min_days_for_baseline": "days", "alert_fatigue_per_month": lambda: f"times in {limits.values().get('alerts.fatigue_window_days', 30)} days", "noise_per_hour": "changes an hour",
          "blocks_per_day": "blocks a day", "battery_trend_drop_per_day": "points a day", "timeout": "seconds", "web_searches_max": "searches"}
_UNITS = ((r"(?:^|_)usd$", "US$"), (r"(?:^|_)kwh$", "kWh"), (r"_w$", "W"), (r"(?:^|_)pct(?:_above)?$", "%"),
          (r"(?:^|_)points$", "points"), (r"(?:^|_)(?:s|seconds)$", "seconds"), (r"(?:^|_)(?:min|minutes)$", "minutes"),
          (r"(?:^|_)hours$", "hours"), (r"(?:^|_)days$", "days"), (r"(?:^|_)weeks$", "weeks"),
          (r"(?:^|_)months$", "months"), (r"(?:^|_)ratio$", "times"), (r"(?:^|_)(?:share|fraction|margin|spread)(?:_|$)", "share (0 to 1)"))


def unit_of(key: str) -> str:
    """The unit of a setting named `key` (its last part): "minutes" for reask_minutes or cooldown_min, "%" for
    drift_pct, "US$" for limit_usd; "" when its name says none."""
    if key in COUNTS:
        # a count over a window that is a setting itself says that window now (alerts.fatigue_window_days)
        return COUNTS[key]() if callable(COUNTS[key]) else COUNTS[key]
    return next((u for pat, u in _UNITS if re.search(pat, key)), "")
# "Agent rules", never "Rules" alone (owner, 2026-10-22): a "rule" read as one of the villa's automations; these are
# policy.yaml's values, the Rules tab's, and the group's (i) says so
GROUP_TITLES = {**limits.GROUPS, SKILL_GROUP: "Skill settings", POLICY_GROUP: "Agent rules"}
GROUP_INFO = {POLICY_GROUP: "The agent's own rules (policy.yaml), the same values the Rules tab shows: never one of the villa's automations."}
TOLD = {"person": "The person is told", "ai": "Only the AI is told", "": "Nobody is told"}


_NAMED = re.compile(r"`([A-Za-z][\w.\-]*)`")


def fill_named(text: str, names: dict[str, dict]) -> str:
    """A skill's guide as the AI reads it: each setting it names in a code span followed by its value now —
    "`unavailable_minutes` (10 minutes)", the value the page's chip shows (viewer.js `named`).

    ⚠️ A NAME, NEVER A NUMBER, AND THE AI STILL KNOWS THE NUMBER (owner, 2026-10-24: "every number a setting"): a guide
    writes no value, so a change on the Limits tab is the AI's too, at its next reading of the skill."""
    def one(m: re.Match) -> str:
        s = names.get(m.group(1))
        if not s:
            return m.group(0)
        value = ", ".join(map(str, s["value"])) if isinstance(s["value"], list) else str(s["value"])
        return f"{m.group(0)} ({value}{(' ' + s['unit']) if s.get('unit') else ''})"
    return _NAMED.sub(one, text)


def ref(rid: dict) -> str:
    """One row's address, as text: what a value shown elsewhere on the page links to (core.setting), and what this
    tab finds when it opens on it — "code:investigate.max_lines", "skill:alert-desk:rules.yaml:behaviour.reopen_hours",
    "policy:settings.keep.records_days".

    ⚠️ A VALUE A PERSON CAN CHANGE LINKS HERE (owner, 2026-10-23: "creating a link to the Limits dashboard focusing
    directly on the specific contextual limit value"): built from the row's id, the one thing a row and its save share,
    so a link can only name a row this tab draws."""
    src = (rid or {}).get("src")
    if src == "skill":
        return f"skill:{rid['skill']}:{rid['file']}:{'.'.join(map(str, rid['path']))}"
    if src == "policy":
        return "policy:" + ".".join(map(str, rid["path"]))
    return f"{src}:{rid.get('key')}"


# ------------------------------------------------------------------ YAML in place, comments kept
def _load(text: str):
    doc = _yaml().load(text) if text and text.strip() else None
    return doc if doc is not None else CommentedMap()


def set_in(text: str, path: list, value) -> str:
    """`text` with the value at `path` replaced (made when missing), every other line as it was."""
    doc = _load(text)
    node = doc
    for k in path[:-1]:
        if isinstance(node, list):
            node = node[k]
            continue
        if k not in node or not isinstance(node[k], (dict, list)):
            node[k] = CommentedMap()
        node = node[k]
    node[path[-1]] = CommentedSeq(value) if isinstance(value, list) else value
    out = io.StringIO()
    _yaml().dump(doc, out)
    return out.getvalue()


def _get(doc, path):
    for k in path:
        try:
            doc = doc[k]
        except (KeyError, IndexError, TypeError):
            return None
    return doc


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _words(v) -> bool:
    return isinstance(v, list) and bool(v) and all(isinstance(x, str) for x in v)


def _comment(lines: list[str], line: int) -> str:
    """What the file says of the setting on `line` (0-based): its own comment, else the comment lines just above it."""
    own = lines[line].split(" #", 1)[1].strip() if " #" in lines[line] else ""
    if own:
        return own
    above, i = [], line - 1
    while i >= 0 and lines[i].strip().startswith("#") and len(above) < 4:
        above.insert(0, lines[i].strip().lstrip("#").strip())
        i -= 1
    return " ".join(above)


def _leaves(node, path=()):
    """(path, value, line) of every number, word list ("…families") and brain of a settings document."""
    if isinstance(node, dict):
        for k, v in node.items():
            p = path + (k,)
            line = node.lc.key(k)[0] if hasattr(node, "lc") and node.lc.data and k in node.lc.data else None
            if _number(v) or (k == "brain" and isinstance(v, str)) or (_words(v) and "families" in str(k)):
                yield p, v, line
            elif isinstance(v, (dict, list)):
                yield from _leaves(v, p)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            line = node.lc.item(i)[0] if hasattr(node, "lc") and node.lc.data and i in node.lc.data else None
            if _number(v):
                yield path + (i,), v, line
            elif isinstance(v, (dict, list)):
                yield from _leaves(v, path + (i,))


class LimitsTab:
    def __init__(self, settings, files):
        self.s, self.files = settings, files

    # ------------------------------------------------------------------ where things are
    @property
    def path(self) -> str:
        return os.path.join(self.s.config_dir, limits.FILE)

    def roots(self) -> list[str]:
        app = self.s.shared_dir
        return [os.path.join(app, "vesta_shared"), os.path.join(app, "vesta_agent"), self.s.skills_dir]

    def skills(self) -> list[str]:
        try:
            names = sorted(os.listdir(self.s.skills_dir))
        except OSError:
            return []
        return [n for n in names if not n.startswith(".") and os.path.isdir(os.path.join(self.s.skills_dir, n))]

    def setting_files(self, skill: str) -> list[str]:
        folder = os.path.join(self.s.skills_dir, skill)
        return sorted(f for f in os.listdir(folder)
                      if f.endswith((".yaml", ".yml")) and not f.startswith(("villa.", ".")))

    # ------------------------------------------------------------------ the rows
    def rows(self) -> dict:
        out, problems = [], []
        declared, bad = limits.scan(self.roots())
        problems += bad
        file_values = self._file_values()
        for key in sorted(declared):
            d = declared[key]
            value = file_values.get(key, d.default)
            if limits.check(d, value):
                value = d.default
            out.append({"id": {"src": "code", "key": key}, "group": d.group if d.group in limits.GROUPS else "read",
                        "section": key.split(".")[0], "name": key, "label": d.says or key, "value": value,
                        "default": d.default,
                        "kind": "list" if isinstance(d.default, list) else "time" if limits.is_time(d.default) else "number",
                        "unit": d.unit, "lo": d.lo, "hi": d.hi, "reached": d.reached, "told": TOLD.get(d.told, d.told),
                        "also": "Only here: this limit is written in the agent's code, and set on this tab.",
                        "where": [s for s in d.sites]})
        for skill in self.skills():
            out += self._skill_rows(skill)
        out = self._villa_wide(out)
        out += self._policy_rows()
        out += self._measured_rows()
        for r in out:
            r["ref"] = ref(r["id"])
        return {"groups": GROUP_TITLES, "group_info": GROUP_INFO, "rows": out, "problems": problems, "file": self.path}

    # ------------------------------------------------------------------ a setup's limits (setup_copy)
    def fitting(self, values: dict) -> tuple[dict, list[str]]:
        """The values of `values` this agent can take — a limit its code declares, each value one the Limits tab would
        accept (limits.check) — and, for the rest, why not (a setup made by another version may name others)."""
        declared, _ = limits.scan(self.roots())
        ok, why = {}, []
        for key, value in (values or {}).items():
            d = declared.get(str(key))
            if d is None:
                why.append(f"{key}: no such limit in this agent's code, left out.")
            elif (bad := limits.check(d, value)) is not None:
                why.append(f"{bad} Left out.")
            else:
                ok[str(key)] = value
        return ok, why

    def changes(self, values: dict) -> dict:
        """{key: (this villa's value now, the new one)} for each of `values` that differs."""
        declared, _ = limits.scan(self.roots())
        now = self._file_values()
        return {k: (now.get(k, declared[k].default), v) for k, v in values.items() if now.get(k, declared[k].default) != v}

    def write(self, values: dict, origin: str, what: str) -> None:
        """Set `values` in limits.yaml in ONE change of the page's history, the way the tab's own Save writes one."""
        text = _read(self.path).decode("utf-8") or "# Limits set on the VESTA Agent page's Limits tab (vesta_shared.limits).\n"
        for k, v in values.items():
            text = set_in(text, [k], v)
        self.files.text_change(origin, what, {"kind": "limits"}, text)

    def _file_values(self) -> dict:
        try:
            data = yaml.safe_load(_read(self.path).decode("utf-8") or "") or {}
        except yaml.YAMLError:
            return {}
        return data if isinstance(data, dict) else {}

    def _skill_rows(self, skill: str) -> list[dict]:
        rows = []
        folder = os.path.join(self.s.skills_dir, skill)
        for fn in self.setting_files(skill):
            text = _read(os.path.join(folder, fn)).decode("utf-8", "replace")
            villa_fn = "villa." + fn
            villa = yaml.safe_load(_read(os.path.join(folder, villa_fn)).decode("utf-8", "replace") or "") or {}
            try:
                doc = _load(text)
            except Exception:  # noqa: BLE001 — a file the skill cannot read is the Skills tab's to show
                continue
            lines = text.splitlines()
            if fn == "skill.yaml":
                rows += self._schedule_rows(skill, doc)
            for path, shipped, line in _leaves(doc):
                if fn == "skill.yaml" and path[0] == "jobs_default":
                    # the AI jobs' starting brain and limit: what runs is Rules' settings.skill_ai (the rows below);
                    # this one only seeds "Add them" — listed, it changed nothing (architecture review, 2026-10-20)
                    continue
                in_list = any(isinstance(k, int) for k in path)
                own = fn == "skill.yaml" or in_list
                over = None if own else _get(villa, path)
                value = over if over is not None else shipped
                name = ".".join(str(k) for k in path)
                said = _comment(lines, line) if line is not None else ""
                also = f"Also in Skills › {skill} › Files › {villa_fn if over is not None else fn}."
                if over is not None:
                    also += f" Changed for this villa in {villa_fn} (the skill's own value: {shipped})."
                if own:
                    # ⚠️ SAID BEFORE IT IS DONE (architecture review, 2026-10-20): a save here writes the skill's own
                    # file — the skill becomes the villa's copy and its updates wait (skills.py: "edited")
                    also += (" Saving it here makes this skill your own copy: its updates then wait for you in "
                             f"Skills › {skill} › Compare.")
                if path[0] == "behaviour":
                    also += (f" If the villa's system has a helper input_number.vesta_{path[-1]}, that helper's value "
                             "wins over this one.")
                if name == "brain":
                    kind, choices = "choice", list(PROFILES)
                else:
                    kind, choices = ("list" if isinstance(shipped, list) else "number"), None
                rows.append({"id": {"src": "skill", "skill": skill, "file": fn, "path": list(path)},
                             "group": SKILL_GROUP, "section": skill, "name": f"{fn} › {name}",
                             "label": said or name.replace("_", " "), "value": value, "default": shipped,
                             "kind": kind, "choices": choices, "unit": unit_of(str(path[-1])) if kind == "number" else "",
                             "lo": 0 if _number(shipped) and shipped >= 0 else None,
                             "hi": None, "reached": "", "told": "", "also": also,
                             "where": [f"{skill}/{villa_fn if (over is not None or not own) else fn}"]})
        return rows

    def _villa_wide(self, rows: list[dict]) -> list[dict]:
        """`rows` with each villa-wide setting (vesta_shared.daily.VILLA_WIDE) of every skill made ONE row: its value
        the skills' own when they agree; its save writes every skill that has it (_save_shared)."""
        out, found = [], {}
        for r in rows:
            rid = r["id"]
            if rid["src"] == "skill" and list(rid["path"]) == ["behaviour", rid["path"][-1]] and rid["path"][-1] in VILLA_WIDE:
                found.setdefault(rid["path"][-1], []).append(r)
            else:
                out.append(r)
        for key, each in found.items():
            values = {r["section"]: r["value"] for r in each}
            first = each[0]
            differ = len(set(values.values())) > 1
            also = (f"Saved in every skill that reads it: {', '.join(sorted(values))} (each one's villa file, kept by "
                    "updates).")
            if differ:
                also += " Today they differ: " + ", ".join(f"{s} {v}" for s, v in sorted(values.items())) + \
                        ". Saving here sets them all."
            also += (f" If the villa's system has a helper input_number.vesta_{key}, that helper's value wins over "
                     "this one.")
            out.append({**first, "id": {"src": "shared", "key": key}, "section": "every skill", "name": f"behaviour › {key}",
                        "label": WIDE_WORDS.get(key, key.replace("_", " ")),
                        "value": max(values.values(), key=list(values.values()).count) if differ else first["value"],
                        "also": also, "where": sorted(w for r in each for w in r["where"])})
        return out

    def _schedule_rows(self, skill: str, doc) -> list[dict]:
        """When each scheduled job of the skill runs (skill.yaml `schedule`: "02:00", "Mon 08:00", "1 08:00").

        ⚠️ A TIME IS A SETTING TOO (owner, 2026-10-23: "nightly 02:00" among the values a person changes): the Kiosk's
        cadence and the skill's "When the skill runs" read it, so it is a row here, saved in skill.yaml like the job's
        timeout beside it."""
        rows = []
        jobs = doc.get("schedule") if isinstance(doc, dict) else None
        for i, job in enumerate(jobs if isinstance(jobs, list) else []):
            if not isinstance(job, dict) or not isinstance(job.get("when"), str):
                continue
            what = job.get("name") or str(job.get("run") or "").split(" ")[0] or f"job {i + 1}"
            rows.append({"alias": job.get("name"),
                         "id": {"src": "skill", "skill": skill, "file": "skill.yaml", "path": ["schedule", i, "when"]},
                         "group": SKILL_GROUP, "section": skill, "name": f"skill.yaml › schedule.{i}.when",
                         "label": f"When the {what} job runs, villa time: HH:MM every day, Mon HH:MM each week, "
                                  "D HH:MM each month.",
                         "value": job["when"], "default": job["when"], "kind": "time", "choices": None, "unit": "villa time",
                         "lo": None, "hi": None, "reached": "", "told": "",
                         "also": (f"Also in Skills › {skill} › Files › skill.yaml. Saving it here makes this skill your "
                                  f"own copy: its updates then wait for you in Skills › {skill} › Compare."),
                         "where": [f"{skill}/skill.yaml"]})
        return rows

    def names(self, skill: str) -> dict[str, dict]:
        """{a setting's name as a skill's SKILL.md writes it: {value, unit, ref}} — the skill's own settings by their
        path ("siren.window_min") and their last key ("reopen_hours"), the code's limits by key, the agent rules by
        path and last key. A name two rows answer to is left out: no link rather than one to the wrong row."""
        seen: dict[str, dict[str, dict]] = {}
        for r in self.rows()["rows"]:
            rid = r["id"]
            if r.get("alias"):
                # a job's time by the job's name ("fm-weekly"), whichever skill's guide names it (owner, 2026-10-24:
                # "Weekly (Monday)" in roi-energy's guide was the reports skill's job time, written out)
                keys = [r["alias"]]
            elif rid["src"] == "code":
                keys = [rid["key"]]
            elif rid["src"] == "shared":
                keys = [f"behaviour.{rid['key']}", rid["key"]]
            elif rid["src"] == "policy" or (rid["src"] == "skill" and rid["skill"] == skill):
                path = [str(k) for k in rid["path"]]
                keys = [] if any(k.isdigit() for k in path) else [".".join(path), path[-1]]
            else:
                continue
            for k in keys:
                seen.setdefault(k, {})[r["ref"]] = r
        return {k: {"value": r["value"], "unit": r["unit"], "ref": r["ref"]}
                for k, found in seen.items() if len(found) == 1 for r in found.values()}

    def policy_setting(self, path: list) -> dict:
        """{value, ref} of one agent rule (policy.yaml) as this tab shows it: what another tab's sentence quotes."""
        row = next(r for r in self._policy_rows() if r["id"]["path"] == list(path))
        return {"value": row["value"], "ref": ref(row["id"])}

    def _measured_rows(self) -> list[dict]:
        """What the villa's system keeps, as the agent measured it (vesta_shared.retention): shown, never set here —
        it is the villa's own setting."""
        from vesta_shared.knowledge_pack import KnowledgePack
        pack = KnowledgePack.read(self.s.pack_path)
        days = pack.detailed_days if pack else None
        value = f"{days:.1f} days" if days is not None else "not measured yet"
        return [{"id": {"src": "measured", "key": "detailed_history_days"}, "group": "keep", "section": "villa",
                 "name": "detailed history kept (measured)",
                 "label": "How long the villa's system keeps every change and its logbook, measured each night on the "
                          "villa (the oldest change it still holds). Older periods are read from its long-term "
                          "figures, said as such.",
                 "value": value, "default": value, "kind": "measured", "choices": None, "unit": "", "lo": None,
                 "hi": None, "reached": "Before it, only long-term figures of measured values remain (one an hour); "
                                        "doors, locks and switches have none.", "told": TOLD["person"],
                 "also": "Set in the villa's own configuration (recorder: purge_keep_days; 10 days when it says "
                         "nothing). The agent measures it and never changes it.",
                 "where": ["the villa's device list, refreshed each night and when the agent starts after an update"]}]

    def _skill_pairs(self, raw: dict) -> dict[str, tuple[dict | None, dict]]:
        """{skill with AI jobs: (the brain and limit per run its jobs run with — None when not set, its starter pair)}."""
        from ..skills import Skills, job_owners, job_starters
        every = Skills(self.s.skills_dir).all()
        owners, starters = job_owners(every), job_starters(every)
        pol = Policy(raw)
        # ⚠️ AI JOBS ONLY (owner, 2026-10-23): the alert cards' translation runs with the chat answers' pair (above)
        return {skill: (pol.skill_setting(skill, owners, starters), starters.get(skill) or {})
                for skill in sorted(set(owners.values()))}

    def _policy_rows(self) -> list[dict]:
        text = self.files.policy_now()[0] if self.files else _read(self.s.policy_path).decode("utf-8")
        try:
            raw = yaml.safe_load(text or "") or {}
        except yaml.YAMLError:
            raw = {}
        st = raw.get("settings") if isinstance(raw.get("settings"), dict) else {}
        ai = f"Also in {where('ai')}."
        rows = [
            (["settings", "profile"], st.get("profile", DEFAULT_BEHAVIOUR["profile"]), DEFAULT_BEHAVIOUR["profile"],
             "choice", list(PROFILES), None, None, ai,
             "How deeply the AI thinks for a chat answer (its brain), and when it puts an alert card's text in a "
             "chat's language."),
            (["settings", "reply_limit_usd"], st.get("reply_limit_usd", DEFAULT_BEHAVIOUR["reply_limit_usd"]),
             DEFAULT_BEHAVIOUR["reply_limit_usd"], "number", None, 0.05, None, ai,
             "The most one chat answer may cost (US$), and one translation of an alert card's text. Reached: the "
             "answer stops and offers Continue; the card stays in English."),
            (["settings", "conversation_reset"], st.get("conversation_reset", DEFAULT_BEHAVIOUR["conversation_reset"]),
             DEFAULT_BEHAVIOUR["conversation_reset"], "choice", list(CONVERSATION_RESETS), None, None, ai,
             "When a chat's earlier messages are forgotten by the AI."),
        ]
        # one brain and one limit per run for all the AI jobs of a skill (owner, 2026-10-20)
        for skill, (pair, start) in self._skill_pairs(raw).items():
            if pair:
                rows.append((["settings", "skill_ai", skill, "brain"], pair["brain"], start["brain"], "choice",
                             list(PROFILES), None, None, ai, f"The brain every AI job of the {skill} skill runs with."))
                rows.append((["settings", "skill_ai", skill, "limit_usd"], pair["limit_usd"], start["limit_usd"], "number",
                             None, 0.05, None, ai, f"The most one run of any AI job of the {skill} skill may cost (US$)."))
        keep = st.get("keep") if isinstance(st.get("keep"), dict) else {}
        for k, (default, lo, hi) in KEEP.items():
            rows.append((["settings", "keep", k], keep.get(k, default), default, "number", None, lo, hi,
                         "Also in Rules (file), under settings › keep.", f"How long the agent keeps: {k.replace('_', ' ')}."))
        rows.append((["approval_ttl_minutes"], raw.get("approval_ttl_minutes", DEFAULTS["approval_ttl_minutes"]),
                     DEFAULTS["approval_ttl_minutes"], "number", None, 1, 1440, f"Also in {where('actions')}.",
                     WORDS["approval_ttl_minutes"]))
        rows.append((["siren_auto_off_min"], raw.get("siren_auto_off_min", DEFAULTS["siren_auto_off_min"]),
                     DEFAULTS["siren_auto_off_min"], "number", None, 1, 60, f"Also in {where('protected')}.",
                     WORDS["siren_auto_off_min"]))
        return [{"id": {"src": "policy", "path": p}, "group": POLICY_GROUP, "section": "policy.yaml",
                 "name": ".".join(p), "label": label, "value": v, "default": d, "kind": kind, "choices": ch,
                 "unit": unit_of(p[-1]) if kind == "number" else "", "lo": lo, "hi": hi, "reached": "", "told": "",
                 "also": also, "where": ["policy.yaml"]}
                for p, v, d, kind, ch, lo, hi, also, label in rows]

    # ------------------------------------------------------------------ one change
    def save(self, rid: dict, value) -> dict:
        src = (rid or {}).get("src")
        if src == "code":
            return self._save_code(str(rid.get("key") or ""), value)
        if src == "skill":
            return self._save_skill(str(rid.get("skill") or ""), str(rid.get("file") or ""), list(rid.get("path") or []), value)
        if src == "policy":
            return self._save_policy(list(rid.get("path") or []), value)
        if src == "shared":
            return self._save_shared(str(rid.get("key") or ""), value)
        raise Refused(["Unknown limit."])

    def _save_shared(self, key: str, value) -> dict:
        """A villa-wide setting: written in every skill that has it, each through its own checked, recorded save."""
        if key not in VILLA_WIDE:
            raise Refused([f"No villa-wide setting {key}."])
        skills = [(s, fn) for s in self.skills() for fn in self.setting_files(s)
                  if _get(yaml.safe_load(_read(os.path.join(self.s.skills_dir, s, fn)).decode("utf-8") or "") or {},
                          ["behaviour", key]) is not None]
        if not skills:
            raise Refused([f"No skill has the setting {key}."])
        for s, fn in skills:
            self._save_skill(s, fn, ["behaviour", key], value)
        return {"ok": True}

    def _save_code(self, key: str, value) -> dict:
        declared, _ = limits.scan(self.roots())
        d = declared.get(key)
        if d is None:
            raise Refused([f"No limit {key} in the agent's code."])
        if why := limits.check(d, value):
            raise Refused([why])
        text = _read(self.path).decode("utf-8")
        before = self._file_values().get(key, d.default)
        new = set_in(text or "# Limits set on the VESTA Agent page's Limits tab (vesta_shared.limits).\n", [key], value)
        self.files.text_change(PLACE, f"{key}: {before} → {value}", {"kind": "limits"}, new)
        return {"ok": True}

    def _save_skill(self, skill: str, fn: str, path: list, value) -> dict:
        if skill not in self.skills() or fn not in self.setting_files(skill) or not path:
            raise Refused(["No such skill setting."])
        folder = os.path.join(self.s.skills_dir, skill)
        shipped = _get(yaml.safe_load(_read(os.path.join(folder, fn)).decode("utf-8") or "") or {}, path)
        if shipped is None:
            raise Refused([f"{skill} › {fn} has no setting {'.'.join(map(str, path))}."])
        if _number(shipped) and not (_number(value) and (shipped < 0 or value >= 0)):
            raise Refused([f"{'.'.join(map(str, path))} must be a number" + (" of at least 0." if shipped >= 0 else ".")])
        if isinstance(shipped, list) and not _words(value):
            raise Refused([f"{'.'.join(map(str, path))} is a list of words."])
        if path[-1] == "brain" and value not in PROFILES:
            raise Refused([f"The brain is one of: {', '.join(PROFILES)}."])
        if path[0] == "schedule" and path[-1] == "when":
            from ..skills import WHEN
            if not (isinstance(value, str) and WHEN.match(value.strip())):
                raise Refused(["A time is HH:MM (every day), Mon HH:MM (each week) or D HH:MM (each month)."])
            value = value.strip()
        elif isinstance(shipped, str) and path[-1] != "brain":
            raise Refused([f"{'.'.join(map(str, path))} is not set on this tab."])
        own = fn == "skill.yaml" or any(isinstance(k, int) for k in path)
        target = fn if own else "villa." + fn
        text = _read(os.path.join(folder, target)).decode("utf-8")
        new = set_in(text, path, value)
        self.files.text_change(PLACE, f"{skill} › {target} › {'.'.join(map(str, path))}: → {value}",
                               {"kind": "file", "skill": skill, "path": target}, new)
        return {"ok": True}

    def _save_policy(self, path: list, value) -> dict:
        text, r = self.files.policy_now()
        if len(path) == 4 and path[0] == "settings" and path[1] == "skill_ai":
            # a skill's pair is written whole: an older file's (or a pair not written yet) becomes the skill's entry,
            # never a half one the agent would refuse
            pair = dict(self._skill_pairs(yaml.safe_load(text or "") or {}).get(path[2], (None, {}))[0] or {})
            if not pair:
                raise Refused([f"The {path[2]} skill's AI jobs are not set: set them in {where('ai')} first."])
            path, value = [path[0], path[1], path[2]], {**pair, path[3]: value}
        new = self.files.form_policy(set_in(text, path, value))
        self.files.save_policy(new, r, PLACE, f"{'.'.join(path)}: → {value}")    # checked by the agent's own rules
        return {"ok": True}
