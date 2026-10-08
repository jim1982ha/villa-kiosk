"""Copy this villa's agent setup to another villa: one file out, a preview in, nothing written before Apply (0.6.42).

⚠️ WHAT NEVER LEAVES THE VILLA: people and their Telegram ids, the chat ids, the devices (protected, excluded,
the allowed lists, the siren, the system actions, notify recipients), keys and tokens, and the records. They are
this villa's — an entity id from one villa means nothing, or something else, on another. The file carries the
skills (their villa.* files only if asked) and the shareable part of the rules:

  ai        settings: brain, limit per reply, web search, new conversation, the AI jobs
  actions   allowed_services: each service and who decides
  tools     what the AI can use: ha_read_tools, agent_tools, tool_access, and the skills switched off
  keep      settings.keep: how long records are kept
  instructions   instructions.md (off unless ticked: the standing rules are often the villa's own)

An import shows every change (added, replaced, changed, same) and what does not fit this villa, then writes only
on Apply — skills through the same checks as a save (a replaced skill moved to skills/.trash, this villa's own
villa.* files kept), the rules through policy.problems(). Every change is one row of the page's history.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone

import yaml

from .. import __version__, tool_access
from ..history import policy_change
from ..places import title
from ..policy import WORDS, Policy, problems as policy_problems, setup_fields
from ..skills import FILE_NAME, SKILL_NAME, VILLA_PREFIX, SkillError, skill_files, parse_skill, ai_jobs

PARTS = ("skills", "villa_files", "ai", "actions", "tools", "keep", "instructions")
# what each part carries: policy.FIELDS, the one table of the file's settings
AI_SETTINGS = tuple(k.split(".", 1)[1] for k in setup_fields("ai"))
TOOL_SECTIONS = tuple(setup_fields("tools"))
ACTION_SECTIONS = tuple(setup_fields("actions"))
MAX_FILES = 400
MAX_UNPACKED = 20 * 1024 * 1024


class NotASetup(ValueError):
    pass


# ---------------------------------------------------------------------- out
def export(settings, skills, parts: set[str]) -> bytes:
    raw = _policy_raw(settings.policy_path)
    rules: dict = {}
    s = raw.get("settings") if isinstance(raw.get("settings"), dict) else {}
    if "ai" in parts:
        rules["settings"] = {k: s[k] for k in AI_SETTINGS if k in s}
    if "keep" in parts and "keep" in s:
        rules.setdefault("settings", {})["keep"] = s["keep"]
    if "actions" in parts:
        rules.update({k: raw[k] for k in ACTION_SECTIONS if k in raw})
    if "tools" in parts:
        rules.update({k: raw[k] for k in TOOL_SECTIONS if k in raw})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        names = []
        if "skills" in parts:
            for name, sk in sorted(skills.all(include_off=True).items()):
                names.append(name)
                for rel in sorted(skill_files(sk.path)):
                    if os.path.basename(rel).startswith(VILLA_PREFIX) and "villa_files" not in parts:
                        continue
                    z.write(os.path.join(sk.path, rel), f"skills/{name}/{rel}")
        if rules:
            z.writestr("rules.yaml", yaml.safe_dump(rules, sort_keys=False, allow_unicode=True))
        if "instructions" in parts and os.path.exists(settings.instructions_path):
            z.write(settings.instructions_path, "instructions.md")
        z.writestr("setup.json", json.dumps({"made_with": __version__, "at": datetime.now(timezone.utc).isoformat(),
                                             "parts": sorted(parts), "skills": names}, indent=1))
    return buf.getvalue()


def _policy_raw(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return raw if isinstance(raw, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


# ---------------------------------------------------------------------- in
def read(data: bytes) -> dict:
    """The setup file, checked: only skill folders, rules.yaml, instructions.md and setup.json; each path a plain
    name (no folder outside, no hidden file); sizes bounded. Raises NotASetup."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise NotASetup("Not a setup file (a .zip made by \"Download the setup\").") from None
    infos = [i for i in z.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_UNPACKED:
        raise NotASetup("This setup is too large.")
    out = {"meta": None, "rules": None, "instructions": None, "skills": {}}
    for i in infos:
        parts = i.filename.split("/")
        if i.filename == "setup.json":
            out["meta"] = json.loads(z.read(i).decode("utf-8"))
        elif i.filename == "rules.yaml":
            rules = yaml.safe_load(z.read(i).decode("utf-8")) or {}
            if not isinstance(rules, dict):
                raise NotASetup("rules.yaml is not a set of sections.")
            out["rules"] = rules
        elif i.filename == "instructions.md":
            out["instructions"] = z.read(i).decode("utf-8")
        elif len(parts) >= 3 and parts[0] == "skills" and SKILL_NAME.match(parts[1]) and len(parts) <= 6 \
                and all(FILE_NAME.match(x) for x in parts[2:]):
            out["skills"].setdefault(parts[1], {})["/".join(parts[2:])] = z.read(i)
        else:
            raise NotASetup(f"Unexpected file in the setup: {i.filename}")
    if not isinstance(out["meta"], dict):
        raise NotASetup("Not a setup file: setup.json is missing.")
    return out


def _merged_rules(current: dict, imported: dict | None) -> dict:
    """This villa's rules with the imported sections in place (settings merged key by key)."""
    out = json.loads(json.dumps(current, default=str))
    for k, v in (imported or {}).items():
        if k == "settings" and isinstance(v, dict):
            s = dict(out.get("settings") or {})
            s.update(v)
            out["settings"] = s
        elif k in (*ACTION_SECTIONS, *TOOL_SECTIONS):
            out[k] = v
    return out


def preview(settings, skills, setup: dict, server_tools: list[dict] | None) -> dict:
    """Every change the import would make, and what does not fit this villa. Writes nothing."""
    rows, misfits = [], []
    have = skills.all(include_off=True)
    with tempfile.TemporaryDirectory() as tmp:
        parsed = {}
        for name, files in sorted(setup["skills"].items()):
            folder = os.path.join(tmp, name)
            for rel, data in files.items():
                os.makedirs(os.path.dirname(os.path.join(folder, rel)), exist_ok=True)
                with open(os.path.join(folder, rel), "wb") as f:
                    f.write(data)
            mine = {k: v for k, v in (skill_files(have[name].path) if name in have else {}).items()
                    if not os.path.basename(k).startswith(VILLA_PREFIX)}
            theirs = {k: hashlib.sha256(v).hexdigest() for k, v in files.items() if not os.path.basename(k).startswith(VILLA_PREFIX)}
            differ = sorted(k for k in set(mine) | set(theirs) if mine.get(k) != theirs.get(k))
            if name not in have and not os.path.isdir(os.path.join(settings.skills_dir, name)):
                change, detail = "added", "a skill this villa does not have"
            elif not differ:
                change, detail = "same", "identical"
            else:
                change, detail = "replaced", f"{len(differ)} file{'s' if len(differ) > 1 else ''} differ" + (
                    "; this villa's own villa.* files are kept" if name in have and any(
                        os.path.basename(k).startswith(VILLA_PREFIX) for k in skill_files(have[name].path)) else "")
            rows.append({"what": name, "kind": "skill", "change": change, "detail": detail})
            try:
                parsed[name] = parse_skill(name, folder)
            except (SkillError, yaml.YAMLError, OSError) as e:
                misfits.append(f"{name}: the agent would switch this skill off here ({e}).")
    current = _policy_raw(settings.policy_path)
    merged = _merged_rules(current, setup["rules"])
    if setup["rules"]:
        for label, keys in ((WORDS["settings"], [("settings", k) for k in AI_SETTINGS]),
                            (WORDS["settings.keep"], [("settings", "keep")]),
                            (WORDS["allowed_services"], [(k, None) for k in ACTION_SECTIONS]),
                            (title("tools"), [(k, None) for k in TOOL_SECTIONS])):
            def pick(d, keys=keys):
                return {f"{a}.{b}" if b else a: ((d.get(a) or {}).get(b) if b else d.get(a)) for a, b in keys}
            if not any((a in setup["rules"] and (b is None or b in (setup["rules"].get(a) or {}))) for a, b in keys):
                continue
            before, after = yaml.safe_dump(pick(current)), yaml.safe_dump(pick(merged))
            rows.append({"what": label, "kind": "rules", "change": "same" if before == after else "changed",
                         "detail": "identical" if before == after else policy_change(before, after)})
        misfits += [f"The rules: {p}" for p in policy_problems(merged)]
        pol = Policy(merged)
        for svc, rule in (merged.get("allowed_services") or {}).items():
            dom = svc.split(".")[0]
            if rule == "listed" and not pol.lists.get(dom):
                misfits.append(f"{title('actions')} names {svc} with \"only the devices in the lists\": this villa's "
                               f"{dom} list is empty, so the agent will refuse it until devices are added.")
    if setup["instructions"] is not None:
        try:
            with open(settings.instructions_path, encoding="utf-8") as f:
                mine = f.read()
        except OSError:
            mine = ""
        rows.append({"what": "instructions.md", "kind": "instructions", "change": "same" if mine == setup["instructions"] else "changed",
                     "detail": "your standing rules for the agent"})
    pol = Policy(merged)
    by = {t["name"] for t in server_tools or []}
    jobs = pol.jobs
    for name, sk in parsed.items():
        for t in sk.tools or []:
            if server_tools is not None and t.startswith("ha_") and t != "ha_call_service" and t not in by:
                misfits.append(f"{name} needs {t}, which this Home Assistant's MCP server does not have: the AI goes without it.")
        for b in tool_access.blockers(pol, server_tools, sk):
            misfits.append(f"{name} will not work until a tool is switched on: {b['why']}")
        for _, job in ai_jobs({name: sk}):
            if job["name"] not in jobs:
                misfits.append(f"{name}'s AI job {job['name']} is not set in The AI: it will not run until it is (Add them).")
    try:
        with open(settings.policy_path, "rb") as f:
            policy_now = f.read()
    except OSError:
        policy_now = b""
    # the preview's identity: Apply refuses when the rules or the skills changed since it was shown
    fingerprint = hashlib.sha256(json.dumps([rows, merged, sorted(setup["skills"])], sort_keys=True, default=str).encode()
                                 + policy_now).hexdigest()
    return {"made_with": (setup["meta"] or {}).get("made_with"), "made_at": (setup["meta"] or {}).get("at"),
            "rows": rows, "misfits": misfits, "fingerprint": fingerprint,
            "changes": sum(1 for r in rows if r["change"] != "same")}


def apply(ui, setup: dict, prev: dict) -> None:
    """Write what the preview showed: skills first (each checked as a save would), then the rules, then instructions."""
    from ..skills import TRASH, carry_villa_files, to_trash
    from .server import Refused
    s = ui.s
    changed = {r["what"] for r in prev["rows"] if r["change"] != "same"}
    for name, files in sorted(setup["skills"].items()):
        if name not in changed:
            continue
        path = os.path.join(s.skills_dir, name)
        new = path + ".import"
        shutil.rmtree(new, ignore_errors=True)
        for rel, data in files.items():
            os.makedirs(os.path.dirname(os.path.join(new, rel)), exist_ok=True)
            with open(os.path.join(new, rel), "wb") as f:
                f.write(data)
        old = None
        if os.path.isdir(path):
            carry_villa_files(path, new)                       # this villa's own files go with it
        try:
            ui.check_skill(name, new)
        except Refused:
            shutil.rmtree(new, ignore_errors=True)
            raise
        if os.path.isdir(path):
            old = to_trash(s.skills_dir, path, name)
        os.rename(new, path)
        ui.folder_change("Import", f"{name} {'replaced' if old else 'added'} from a setup"
                                    + (f" (the previous one kept in skills/{TRASH})" if old else ""), name, old, "present")
    if setup["rules"] and any(r["kind"] == "rules" and r["change"] != "same" for r in prev["rows"]):
        from .policy_doc import apply_form, to_form
        text, r = ui.policy_now()
        merged = _merged_rules(_policy_raw(s.policy_path), setup["rules"])
        form = {k: merged[k] for k in ("settings", *ACTION_SECTIONS, *TOOL_SECTIONS) if k in merged}
        if "settings" in form:
            form["settings"] = {**to_form(text)["settings"], **form["settings"]}
        ui.save_policy(apply_form(text, form), r, "Import", "Rules from a setup: " + policy_change(text, apply_form(text, form)))
    if setup["instructions"] is not None and "instructions.md" in changed:
        # undoable like any text (Overview › Page changes): it was recorded as a kind Undo did not know
        ui.text_change("Import", "instructions.md from a setup", {"kind": "instructions"}, setup["instructions"])
