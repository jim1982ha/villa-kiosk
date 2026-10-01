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

from ..policy import DEFAULT_BEHAVIOUR, DEFAULTS

#: What the forms edit. Everything else (ha_read_tools, system_actions,
#: notify_recipients...) is edited in the file itself and never touched here.
FORM_KEYS = ("settings", "act_enabled", "approval_ttl_minutes", "people", "chats", "allowed_services",
             "owner_only_entities", "excluded_entities", "siren_entity", "siren_auto_off_min",
             "switch_entities", "scene_allowlist", "script_allowlist", "button_allowlist")
LISTS = ("owner_only_entities", "excluded_entities", "switch_entities", "scene_allowlist",
         "script_allowlist", "button_allowlist")


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
    settings["jobs"] = {}
    if isinstance(raw.get("settings"), dict):
        settings.update({k: v for k, v in raw["settings"].items() if k in DEFAULT_BEHAVIOUR})
        if isinstance(raw["settings"].get("jobs"), dict):
            settings["jobs"] = raw["settings"]["jobs"]
    chats = raw.get("chats") if isinstance(raw.get("chats"), dict) else {}
    return {
        "settings": settings,
        "act_enabled": raw.get("act_enabled", DEFAULTS["act_enabled"]),
        "approval_ttl_minutes": raw.get("approval_ttl_minutes", DEFAULTS["approval_ttl_minutes"]),
        "people": [p for p in (raw.get("people") or []) if isinstance(p, dict)],
        "chats": {"owner": chats.get("owner"), "fm": chats.get("fm")},
        "allowed_services": dict(raw.get("allowed_services") or {}),
        "siren_entity": raw.get("siren_entity"),
        "siren_auto_off_min": raw.get("siren_auto_off_min", DEFAULTS["siren_auto_off_min"]),
        **{k: list(raw.get(k) or []) for k in LISTS},
    }


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


def apply_form(text: str, form: dict) -> str:
    """The file with the form's sections written in; comments and other sections kept."""
    y = _yaml()
    doc = y.load(text) if (text or "").strip() else None
    if not isinstance(doc, CommentedMap):
        doc = CommentedMap()
    defaults = to_form("")
    for key in FORM_KEYS:
        if key not in form:
            continue
        if key not in doc and form[key] == defaults[key]:
            continue                               # absent and still the default: the file stays as it was
        _set(doc, key, form[key])
    buf = io.StringIO()
    y.dump(doc, buf)
    return buf.getvalue()
