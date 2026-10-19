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

import yaml
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from vesta_shared import limits

from ..places import where
from ..policy import DEFAULT_BEHAVIOUR, DEFAULTS, KEEP, PROFILES, RESET_WORDS, WORDS, Policy
from .changes import Refused, _read
from .policy_doc import _yaml

PLACE = "Limits"
SKILL_GROUP, POLICY_GROUP = "skills", "rules"
GROUP_TITLES = {**limits.GROUPS, SKILL_GROUP: "Skill settings", POLICY_GROUP: "Rules"}
TOLD = {"person": "The person is told", "ai": "Only the AI is told", "": "Nobody is told"}


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
                        "default": d.default, "kind": "list" if isinstance(d.default, list) else "number",
                        "unit": d.unit, "lo": d.lo, "hi": d.hi, "reached": d.reached, "told": TOLD.get(d.told, d.told),
                        "also": "Only here: this limit is written in the agent's code, and set on this tab.",
                        "where": [s for s in d.sites]})
        for skill in self.skills():
            out += self._skill_rows(skill)
        out += self._policy_rows()
        out += self._measured_rows()
        return {"groups": GROUP_TITLES, "rows": out, "problems": problems, "file": self.path}

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
            for path, shipped, line in _leaves(doc):
                in_list = any(isinstance(k, int) for k in path)
                own = fn == "skill.yaml" or in_list
                over = None if own else _get(villa, path)
                value = over if over is not None else shipped
                name = ".".join(str(k) for k in path)
                said = _comment(lines, line) if line is not None else ""
                also = f"Also in Skills › {skill} › Files › {villa_fn if over is not None else fn}."
                if over is not None:
                    also += f" Changed for this villa in {villa_fn} (the skill's own value: {shipped})."
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
                             "kind": kind, "choices": choices, "unit": "", "lo": 0 if _number(shipped) and shipped >= 0 else None,
                             "hi": None, "reached": "", "told": "", "also": also,
                             "where": [f"{skill}/{villa_fn if (over is not None or not own) else fn}"]})
        return rows

    def _measured_rows(self) -> list[dict]:
        """What the villa's system keeps, as the agent measured it (vesta_shared.retention): shown, never set here —
        it is the villa's own setting."""
        from vesta_shared.knowledge_pack import KnowledgePack
        pack = KnowledgePack.read(self.s.pack_path)
        days = (pack.retention or {}).get("raw_history_days") if pack else None
        value = f"{days:.1f} days" if isinstance(days, (int, float)) and not isinstance(days, bool) else "not measured yet"
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
                 "where": ["the knowledge pack, rebuilt each night and when the agent starts after an update"]}]

    def _skill_pairs(self, raw: dict) -> dict[str, tuple[dict | None, dict]]:
        """{skill with AI jobs: (the brain and limit per run its jobs run with — None when not set, its starter pair)}."""
        from ..skills import Skills, job_owners, job_starters
        every = Skills(self.s.skills_dir).all()
        owners, starters = job_owners(every), job_starters(every)
        pol = Policy(raw)
        return {skill: (pol.skill_setting(skill, owners, starters), starters.get(skill) or {})
                for skill in sorted(set(owners.values()))}

    def _policy_rows(self) -> list[dict]:
        text, _ = self.files.policy_now()
        try:
            raw = yaml.safe_load(text or "") or {}
        except yaml.YAMLError:
            raw = {}
        st = raw.get("settings") if isinstance(raw.get("settings"), dict) else {}
        ai = f"Also in {where('ai')}."
        rows = [
            (["settings", "profile"], st.get("profile", DEFAULT_BEHAVIOUR["profile"]), DEFAULT_BEHAVIOUR["profile"],
             "choice", list(PROFILES), None, None, ai, "How deeply the AI thinks for a chat answer (its brain)."),
            (["settings", "reply_limit_usd"], st.get("reply_limit_usd", DEFAULT_BEHAVIOUR["reply_limit_usd"]),
             DEFAULT_BEHAVIOUR["reply_limit_usd"], "number", None, 0.05, None, ai,
             "The most one chat answer may cost (US$). Reached: the answer stops and offers Continue."),
            (["settings", "conversation_reset"], st.get("conversation_reset", DEFAULT_BEHAVIOUR["conversation_reset"]),
             DEFAULT_BEHAVIOUR["conversation_reset"], "choice", list(RESET_WORDS), None, None, ai,
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
                 "unit": "", "lo": lo, "hi": hi, "reached": "", "told": "", "also": also, "where": ["policy.yaml"]}
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
        raise Refused(["Unknown limit."])

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
