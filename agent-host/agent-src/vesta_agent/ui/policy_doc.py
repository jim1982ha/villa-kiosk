"""policy.yaml for the UI: read it as forms, write the forms back, keep the file's comments.

⚠️ THE FILE IS THE OWNER'S, COMMENTS INCLUDED. A plain YAML dump would rewrite it
without a single comment, and the comments are its documentation. ruamel.yaml
edits the loaded document in place: a section the form does not change keeps
its text byte for byte, a changed one keeps the comments around it.
"""
from __future__ import annotations

import io
from typing import Any

import yaml
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from ..policy import DEFAULT_BEHAVIOUR, DEFAULTS, ENTITY_LISTS, form_sections, legacy_rows
from ..tool_access import CHOOSE, OWN, ROLE_GROUPS

#: What the forms edit. Everything else (system_actions, notify_recipients...) is edited in the file itself and
#: never touched here. "AI tools" (0.6.42): ha_read_tools, agent_tools, tool_access, and the skills'
#: on/off switch (skills_off).
FORM_KEYS = form_sections()     # policy.FIELDS: the one table of the file's settings
LISTS = tuple(ENTITY_LISTS)     # policy.py's own table, not a copy


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)      # the starter file's own layout: "people:\n  - telegram_id: ..."
    # "siren_entity: null" stays written as null (ruamel's default writes nothing after the colon)
    y.representer.add_representer(type(None), lambda r, _: r.represent_scalar("tag:yaml.org,2002:null", "null"))
    return y


def to_form(text: str) -> dict:
    """The form's values: what the file says, the agent's defaults where it says nothing."""
    raw = yaml.safe_load(text or "") or {}
    if not isinstance(raw, dict):
        raw = {}
    settings = dict(DEFAULT_BEHAVIOUR)
    settings["skill_ai"] = {}
    if isinstance(raw.get("settings"), dict):
        settings.update({k: v for k, v in raw["settings"].items() if k in DEFAULT_BEHAVIOUR})
        # one brain and one limit per skill's AI jobs (owner, 2026-10-20)
        if isinstance(raw["settings"].get("skill_ai"), dict):
            settings["skill_ai"] = raw["settings"]["skill_ai"]
        # an older file's AI jobs: carried through as written, or a save would drop them before ai_moved moves them
        for old in ("jobs", "skill_brains"):
            if isinstance(raw["settings"].get(old), dict):
                settings[old] = raw["settings"][old]
        # settings.keep has no form fields (Rules (file) edits it): carried through as written, or a
        # save of the Rules form would drop the villa's limits (0.6.41)
        if isinstance(raw["settings"].get("keep"), dict):
            settings["keep"] = raw["settings"]["keep"]
    people = [p for p in (raw.get("people") or []) if isinstance(p, dict)] if isinstance(raw.get("people"), list) else []
    # ⚠️ AN OLDER FILE'S CHATS BECOME ROWS OF PEOPLE (0.12.128: People is the one list of where messages go): shown
    # here, and written there by the next save — never a private chat of someone People does not list, which a row
    # would register (policy.legacy_rows; apply_form leaves it in `chats:`)
    people += legacy_rows(raw)[0]
    return {
        "settings": settings,
        "act_enabled": raw.get("act_enabled", DEFAULTS["act_enabled"]),
        "approval_ttl_minutes": raw.get("approval_ttl_minutes", DEFAULTS["approval_ttl_minutes"]),
        "people": people,
        "allowed_services": dict(raw.get("allowed_services") or {}),
        "siren_entity": raw.get("siren_entity"),
        "siren_auto_off_min": raw.get("siren_auto_off_min", DEFAULTS["siren_auto_off_min"]),
        **{k: list(raw.get(k) or []) for k in LISTS},
        "ha_read_tools": [x for x in raw.get("ha_read_tools") or [] if isinstance(x, str)]
        if isinstance(raw.get("ha_read_tools"), list) else [],
        # ⚠️ EVERY SWITCH AS ON/OFF (architecture review 8): the file leaves a tool that is on out ("absent means on")
        # and keeps web search in settings.web_search; the page read and wrote that rule itself, twice. The form says
        # true or false for each switch, and apply_form writes the file's own shape back (_switches_out).
        "agent_tools": _own_switches(raw, settings),
        "tool_access": _role_switches(raw),
        "skills_off": list(raw.get("skills_off") or []) if isinstance(raw.get("skills_off"), list) else [],
    }


def ai_moved(text: str, owners: dict[str, str], starters: dict[str, dict]) -> str:
    """The file with an older shape's AI jobs moved to their skill's one brain and one limit per run, settings.skill_ai
    (owner, 2026-10-20). Both older shapes: `jobs` {job: {profile, limit_usd}} (before 0.12.277), and `skill_brains`
    {skill: brain} beside `jobs` {job: {limit_usd}} (0.12.277). A skill that one of them sets, and that skill_ai does
    not, gets what its jobs run with now (Policy.skill_setting: their brain, the skill's own starter limit); its jobs'
    and its brain's old entries go, and an emptied `jobs` or `skill_brains` with them. A job no skill declares stays as
    written. Every save the page's forms make goes through it (changes.PageFiles.form_policy: the Rules forms, "Add
    them", the Limits tab); the file edited as text is written as typed. A file in the new shape comes back unchanged,
    byte for byte."""
    from ..policy import Policy
    y = _yaml()
    doc = y.load(text) if (text or "").strip() else None
    settings = doc.get("settings") if isinstance(doc, CommentedMap) else None
    if not isinstance(settings, CommentedMap):
        return text
    jobs, brains = settings.get("jobs"), settings.get("skill_brains")
    jobs = jobs if isinstance(jobs, CommentedMap) else CommentedMap()
    brains = brains if isinstance(brains, CommentedMap) else CommentedMap()
    skills = set(owners.values())
    old = sorted({owners[n] for n in jobs if n in owners} | {s for s in brains if s in skills})
    if not old:
        return text
    pol = Policy(yaml.safe_load(text) or {})
    ai = settings.get("skill_ai")
    if not isinstance(ai, CommentedMap):
        at = min((list(settings).index(k) for k in ("skill_brains", "jobs") if k in settings), default=len(settings))
        settings.insert(at, "skill_ai", CommentedMap())
        ai = settings["skill_ai"]
    for skill in old:
        if skill not in ai:
            got = pol.skill_setting(skill, owners, starters)
            if not got:
                continue                               # nothing to run with: left as written, still not set
            lim = got["limit_usd"]
            ai[skill] = CommentedMap([("brain", got["brain"]), ("limit_usd", int(lim) if float(lim).is_integer() else lim)])
        for n in [n for n in jobs if owners.get(n) == skill]:
            del jobs[n]
        if skill in brains:
            del brains[skill]
    for key, left in (("jobs", jobs), ("skill_brains", brains)):
        if key in settings and not left:
            del settings[key]
    buf = io.StringIO()
    y.dump(doc, buf)
    return buf.getvalue()


def existing_off(names, have) -> list:
    """THE rule for `skills_off` (owner, 2026-10-20: "thfdsdsjfsf", a skill long deleted, stayed switched off): only
    names of skills the villa has. Used by every save of the page (known_off), the setup export and its import."""
    return [n for n in (names or []) if n in have]


def known_off(text: str, have: set[str]) -> str:
    """The file with `skills_off` holding only the skills the villa has (existing_off). A file with nothing to drop
    comes back unchanged, byte for byte."""
    y = _yaml()
    doc = y.load(text) if (text or "").strip() else None
    off = doc.get("skills_off") if isinstance(doc, CommentedMap) else None
    if not isinstance(off, list):
        return text
    keep = existing_off(off, have)
    if len(keep) == len(off):
        return text
    doc["skills_off"] = _node(keep)
    buf = io.StringIO()
    y.dump(doc, buf)
    return buf.getvalue()


def _node(value: Any) -> Any:
    """A plain value as a ruamel node, in block style ("key: value" on lines), [] / {} when empty."""
    if isinstance(value, dict):
        m = CommentedMap((k, _node(v)) for k, v in value.items())
        (m.fa.set_block_style if value else m.fa.set_flow_style)()
        return m
    if isinstance(value, list):
        s = CommentedSeq(_node(v) for v in value)
        (s.fa.set_block_style if value else s.fa.set_flow_style)()
        return s
    return value


def _set(parent: CommentedMap, key: str, value: Any) -> None:
    cur = parent.get(key)
    if cur == value:
        return                                     # unchanged: its text stays exactly as written
    if isinstance(value, dict) and isinstance(cur, CommentedMap) and value:
        for k in [k for k in cur if k not in value]:
            del cur[k]
        for k, v in value.items():
            _set(cur, k, v)
        cur.fa.set_block_style()
        return
    parent[key] = _node(value)


def _own_switches(raw: dict, settings: dict) -> dict:
    """The agent tools a villa chooses: key → on."""
    file = raw.get("agent_tools") if isinstance(raw.get("agent_tools"), dict) else {}
    return {k: bool(settings.get("web_search")) if k == "web_search" else file.get(k, True) is not False
            for k, v in OWN.items() if v[2] == CHOOSE}


def _role_switches(raw: dict) -> dict:
    """What the facility manager may make the AI use: group → allowed (other keys kept as written)."""
    ta = dict(raw["tool_access"]) if isinstance(raw.get("tool_access"), dict) else {}
    fm = ta.get("fm") if isinstance(ta.get("fm"), dict) else {}
    return {**ta, "fm": {k: fm.get(k, True) is not False for k, _ in ROLE_GROUPS}}


def _switches_out(form: dict) -> dict:
    """The form's switches in the file's shape: only what is off is written (web search: settings.web_search)."""
    out = dict(form)
    if isinstance(form.get("agent_tools"), dict):
        out["agent_tools"] = {k: False for k, v in form["agent_tools"].items() if k != "web_search" and v is False}
    if isinstance(form.get("tool_access"), dict):
        fm = {k: False for k, v in (form["tool_access"].get("fm") or {}).items() if v is False}
        out["tool_access"] = {**{k: v for k, v in form["tool_access"].items() if k != "fm"}, **({"fm": fm} if fm else {})}
    return out


def apply_form(text: str, form: dict) -> str:
    """The file with the form's sections written in; comments and other sections kept."""
    y = _yaml()
    doc = y.load(text) if (text or "").strip() else None
    if not isinstance(doc, CommentedMap):
        doc = CommentedMap()
    web = form["agent_tools"].get("web_search") if isinstance(form.get("agent_tools"), dict) else None
    form, defaults = _switches_out(form), _switches_out(to_form(""))
    for key in FORM_KEYS:
        if key not in form:
            continue
        if key not in doc and form[key] == defaults[key]:
            continue                               # absent and still the default: the file stays as it was
        _set(doc, key, form[key])
    if "asleep_entities" in doc:
        # 0.12.308's own list, retired by 0.12.310: "unavailable by design" is the VESTA Kiosk's list (owner,
        # 2026-10-21: one list, where the Kiosk keeps it; the agent reads it, vesta_shared.asleep)
        del doc["asleep_entities"]
    if "people" in form and "chats" in doc:
        kept = legacy_rows(yaml.safe_load(text) if (text or "").strip() else {})[1]
        if kept:
            _set(doc, "chats", kept)               # private chats of nobody listed: still posted to, never a person
        else:
            del doc["chats"]                       # its chats are rows of People now (to_form)
    if web is not None:                            # web search's switch: written in settings, where the agent reads it
        settings = doc.get("settings")
        if (settings or {}).get("web_search", DEFAULT_BEHAVIOUR.get("web_search", False)) != web:
            if not isinstance(settings, CommentedMap):
                doc["settings"] = settings = CommentedMap()
            _set(settings, "web_search", web)
    buf = io.StringIO()
    y.dump(doc, buf)
    return buf.getvalue()
