"""AI tools: the one answer, for a chat, a report and the VESTA Agent page (0.6.42).

Three switches decide it, all in policy.yaml, all edited on the page (Rules › AI tools):

  ha_read_tools   the Home Assistant tools the AI may read with, name by name. Only a tool Home Assistant's
                  MCP server marks read-only can be on: anything that writes, restarts, installs or deletes
                  is "never available", whatever the file says. A tool a later HA MCP version adds is off
                  until someone switches it on.
  agent_tools     the agent's own tools a villa may switch off: web search (settings.web_search, kept where
                  it always was), facility tickets, starting a report from a chat, reading its own activity.
                  The others are always on (the agent cannot work without them) or are decided elsewhere
                  (an action on the villa: "Allowed actions").
  tool_access     what the facility manager may make the AI use, by group (the owner: everything switched on).

A report gets only the tools its skill lists (skill.yaml `tools:`), among those switched on; a skill that
lists none gets everything switched on. A skill that needs a tool switched off is NOT WORKING: the AI is told
plainly which setting stops it, and its AI jobs do not run (blockers()).

⚠️ ONE OWNER FOR "MAY THE AI USE THIS": tools.Toolbox builds only what allowed_for_*() returns, and the page
draws its switches from catalog() — the page keeps no copy of these tables.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone

from .places import title, where
from .policy import Policy

#: The groups the page shows Home Assistant's tools in, and the facility manager's switches use. A tool not
#: named here (a later HA MCP version's) is "other". Keys are policy.yaml's (tool_access.fm.<group>).
HA_GROUPS: dict[str, tuple[str, tuple[str, ...]]] = {
    "states": ("States and history", ("ha_get_state", "ha_get_history", "ha_search", "ha_eval_template",
                                      "ha_get_overview", "ha_get_operation_status")),
    "devices": ("Devices and areas", ("ha_get_entity", "ha_get_device", "ha_list_floors_areas", "ha_config_get_label",
                                      "ha_config_get_category", "ha_get_zone", "ha_config_list_groups",
                                      "ha_config_list_helpers", "ha_get_entity_exposure", "ha_get_integration")),
    "automations": ("Automations and scripts", ("ha_config_get_automation", "ha_get_automation_traces",
                                                "ha_config_get_script", "ha_config_get_scene", "ha_list_services")),
    "cameras": ("Cameras", ("ha_get_camera_image",)),
    "logs": ("Logs and health", ("ha_get_logs", "ha_get_system_health")),
    "lists": ("Lists and calendars", ("ha_get_todo", "ha_config_get_calendar_events")),
    "other": ("Other", ()),
}
#: What a person should know before switching a tool on (decision D5: the VESTA Agent user is an administrator).
NOTES = {
    "ha_eval_template": "needs an administrator account",
    "ha_get_logs": "needs an administrator account · the logbook and Home Assistant's own log, never an app's",
    "ha_get_automation_traces": "needs an administrator account",
    "ha_config_get_automation": "needs an administrator account",
    "ha_config_get_script": "needs an administrator account",
    "ha_get_camera_image": "shows images of the villa",
}

CHOOSE, ELSEWHERE, ALWAYS = "choose", "elsewhere", "always"
#: Agent tools (the agent's own): key → (label, what it does, kind). `web_search` is Claude's WebSearch.
OWN: dict[str, tuple[str, str, str]] = {
    "web_search": ("Web search", "Claude's own search: weather warnings, manuals. Never used to decide an action.", CHOOSE),
    "create_ticket": ("Create a facility ticket", "Records a fault for the facility manager in the VESTA Kiosk. "
                                                  "Acts on nothing.", CHOOSE),
    "start_job": ("Start a report when asked in a chat", "\"Send me the weekly report\": runs the report with its own "
                                                         "brain and limit.", CHOOSE),
    "agent_status": ("Read what the agent itself did", "For \"what did you do last night?\": jobs run, alerts followed, "
                                                       "actions, cost.", CHOOSE),
    "ha_call_service": ("Ask for an action on the villa", f"Decided by \"{title('acting')}\" and \"{title('actions')}\": "
                                                          "every action goes through those rules.", ELSEWHERE),
    "read_skill": ("Read a skill's instructions", "", ALWAYS),
    "run_skill_script": ("Run a skill's script", "Only the commands the skill lets the AI run.", ALWAYS),
    "save_file": ("Save a file for a skill's script", "A report's sentences, handed to its script.", ALWAYS),
    "send_message": ("Send a message or a report page", "In a chat it answers only that chat; a report reaches its "
                                                        "chat with it.", ALWAYS),
}
#: What the facility manager's switches cover: the Home Assistant groups, then the own tools they may lose.
ROLE_GROUPS = [(k, v[0]) for k, v in HA_GROUPS.items()] + [(k, OWN[k][0]) for k, v in OWN.items() if v[2] == CHOOSE]
TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{1,60}$")
NEW_FOR_DAYS = 30
TOOLS_FILE = "ha_tools.json"


# ---------------------------------------------------------------------- Home Assistant's list
def group_of(name: str) -> str:
    return next((k for k, (_, names) in HA_GROUPS.items() if name in names), "other")


def readable(tool: dict) -> bool:
    """Only a tool the server marks read-only, and not destructive, can ever be switched on."""
    a = tool.get("annotations") or {}
    return a.get("readOnlyHint") is True and not a.get("destructiveHint")


def save_list(data_dir: str, server_tools: list[dict], server: str = "", now: datetime | None = None) -> None:
    """The server's tool list, for the page (which holds no Home Assistant token): written by the agent each
    time it reads the list (start, 01:30, "Read the list again"). Each tool keeps the day it was first seen."""
    now = now or datetime.now(timezone.utc)
    path = os.path.join(data_dir, TOOLS_FILE)
    old = read_list(data_dir) or {}
    seen = dict(old.get("first_seen") or {})
    first = old.get("first_list_at") or now.isoformat()
    for t in server_tools:
        seen.setdefault(t["name"], now.isoformat() if old else first)
    data = {"read_at": now.isoformat(), "server": server, "first_list_at": first, "first_seen": seen,
            "tools": [{"name": t["name"], "title": (t.get("annotations") or {}).get("title") or "",
                       "description": (t.get("description") or "").strip().split("\n")[0][:240],
                       "readable": readable(t)} for t in server_tools]}
    tmp = path + ".new"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def read_list(data_dir: str) -> dict | None:
    try:
        with open(os.path.join(data_dir, TOOLS_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def saved_server_tools(data_dir: str) -> list[dict] | None:
    """The saved list back in the server's own shape, for blockers()/readable() on the page; None before the
    agent first read it. The one place that knows both shapes (save_list writes the other)."""
    listed = read_list(data_dir)
    if not listed:
        return None
    return [{"name": t["name"], "annotations": {"readOnlyHint": bool(t.get("readable")), "title": t.get("title")}}
            for t in listed.get("tools") or []]


# ---------------------------------------------------------------------- what is on
def ha_on(policy: Policy, server_tools: list[dict]) -> set[str]:
    """The Home Assistant tools the AI may read with: named in policy.yaml, on the server, read-only."""
    by = {t["name"]: t for t in server_tools}
    return {n for n in policy.ha_read_tools if n in by and readable(by[n])}


def own_on(policy: Policy) -> set[str]:
    out = {k for k, v in OWN.items() if v[2] != CHOOSE}
    out |= {k for k, v in OWN.items() if v[2] == CHOOSE and k != "web_search" and policy.agent_tools.get(k, True)}
    if policy.behaviour.get("web_search"):
        out.add("web_search")
    return out


def switched_on(policy: Policy, server_tools: list[dict]) -> set[str]:
    return ha_on(policy, server_tools) | own_on(policy)


def fm_denied(policy: Policy) -> set[str]:
    """The groups (and own tools) the facility manager may not make the AI use."""
    return {k for k, v in (policy.tool_access.get("fm") or {}).items() if v is False}


def _without_groups(tools: set[str], denied: set[str]) -> set[str]:
    return {t for t in tools if t not in denied and not (t.startswith("ha_") and t != "ha_call_service"
                                                         and group_of(t) in denied)}


def allowed_for_person(policy: Policy, server_tools: list[dict], role: str | None, chat_id: int | None) -> set[str]:
    """A chat: everything switched on for the owner; the facility manager loses what tool_access.fm refuses —
    and so does anyone in the facility manager's chat (never more there than the facility manager may use)."""
    tools = switched_on(policy, server_tools)
    fm_chat = chat_id is not None and policy.chats.get("fm") == chat_id
    if role != "owner" or fm_chat:
        tools = _without_groups(tools, fm_denied(policy))
    return tools


def may_start_job(policy: Policy, server_tools: list[dict], person, chat_id: int | None) -> bool:
    """May this person start a job from this chat (the start_job tool, switched on for them here)? One answer for the
    AI's tool, the report buttons offered when the AI is unavailable, and a press on one (architecture review 5:
    the press asked only "registered?", so in a group anyone could press another's report button)."""
    return person is not None and "start_job" in allowed_for_person(policy, server_tools, person.role, chat_id)


def allowed_for_job(policy: Policy, server_tools: list[dict], skill) -> set[str]:
    """A report (a skill's AI job): its skill's `tools`, among those switched on, plus the ones always on.
    A skill that lists none gets everything switched on but web search (a scheduled job never had it)."""
    on = switched_on(policy, server_tools)
    if getattr(skill, "tools", None) is None:
        return on - {"web_search"}
    return (set(skill.tools) & on) | {k for k, v in OWN.items() if v[2] == ALWAYS}


def health(policy: Policy, server_tools: list[dict] | None, skill, load_problem: str | None = None) -> dict:
    """Is this skill working, and if not why, in words: {"ok", "problem", "blocked"}. `skill` None: it did not load
    (`load_problem` says why; without one it was switched off). One answer for the page's list and a skill's page
    (architecture review 6: each wrote its own)."""
    if skill is None:
        return {"ok": False, "problem": load_problem or "switched off", "blocked": []}
    blocked = blockers(policy, server_tools, skill)
    return {"ok": not blocked, "problem": " ".join(b["why"] for b in blocked) or None, "blocked": blocked}


def blockers(policy: Policy, server_tools: list[dict] | None, skill) -> list[dict]:
    """Why the AI cannot use this skill now: each tool it needs that THE VILLA switched off, in plain words, with
    what turns it back on. [] when nothing stops it. A tool this Home Assistant does not have, or that changes it,
    stops nothing: the AI goes without it (needs() shows it on the page)."""
    out = []
    by = {t["name"]: t for t in server_tools} if server_tools else None
    for t in getattr(skill, "tools", None) or []:
        if t in OWN:
            if OWN[t][2] != CHOOSE or t in own_on(policy):
                continue
            out.append({"tool": t, "label": OWN[t][0], "fix": "own",
                        "why": f"It needs \"{OWN[t][0]}\", switched off in {where('tools')}."})
        elif (by is None or (t in by and readable(by[t]))) and t not in policy.ha_read_tools:
            name = _title(by[t]) if by else t
            out.append({"tool": t, "label": name, "fix": "ha",
                        "why": f"It needs \"{name}\" ({t}), switched off in {where('tools')}."})
    return out


def needs(policy: Policy, listed: dict | None, skill) -> list[dict]:
    """Skills → "Tools it needs": each tool of the skill, and whether the AI has it here."""
    by = {t["name"]: t for t in (listed or {}).get("tools") or []}
    out = []
    for t in getattr(skill, "tools", None) or []:
        if t in OWN:
            on = OWN[t][2] != CHOOSE or t in own_on(policy)
            out.append({"tool": t, "label": OWN[t][0], "on": on, "state": "on" if on else "off"})
        elif by and t not in by:
            out.append({"tool": t, "label": t, "on": False, "state": "missing"})
        elif by and not by[t].get("readable"):
            out.append({"tool": t, "label": by[t].get("title") or t, "on": False, "state": "never"})
        else:
            on = t in policy.ha_read_tools
            out.append({"tool": t, "label": (by.get(t) or {}).get("title") or t, "on": on, "state": "on" if on else "off"})
    return out


def _title(tool: dict) -> str:
    return (tool.get("annotations") or {}).get("title") or tool.get("title") or tool["name"]


def label(tool: str, listed: dict[str, dict] | None = None) -> str:
    """A tool's name as the page says it."""
    if tool in OWN:
        return OWN[tool][0]
    t = (listed or {}).get(tool)
    return (t.get("title") if t else None) or tool


# ---------------------------------------------------------------------- the page
def catalog(policy: Policy, listed: dict | None, usage: dict[str, int], now: datetime | None = None) -> dict:
    """Rules › AI tools: the switches as the page draws them, from the list the agent saved."""
    now = now or datetime.now(timezone.utc)
    tools = (listed or {}).get("tools") or []
    first_list = (listed or {}).get("first_list_at") or ""
    seen = (listed or {}).get("first_seen") or {}

    def is_new(name: str) -> bool:
        at = seen.get(name) or ""
        try:
            return bool(at) and at > first_list and now - datetime.fromisoformat(at) < timedelta(days=NEW_FOR_DAYS)
        except ValueError:
            return False

    groups = {k: {"key": k, "label": v[0], "tools": []} for k, v in HA_GROUPS.items()}
    never = []
    for t in sorted(tools, key=lambda t: t["name"]):
        row = {"name": t["name"], "title": t.get("title") or t["name"], "description": t.get("description") or "",
               "note": NOTES.get(t["name"], ""), "on": t["name"] in policy.ha_read_tools, "new": is_new(t["name"]),
               "used": usage.get(t["name"], 0)}
        if t.get("readable"):
            groups[group_of(t["name"])]["tools"].append(row)
        else:
            never.append(row)
    named = {t["name"] for t in tools}
    return {
        "read_at": (listed or {}).get("read_at"), "server": (listed or {}).get("server") or "",
        "count": len(tools), "on": sum(1 for t in tools if t.get("readable") and t["name"] in policy.ha_read_tools),
        "new_off": sum(1 for g in groups.values() for t in g["tools"] if t["new"] and not t["on"]),
        "groups": [g for g in groups.values() if g["tools"]],
        "never": never,
        # named in the file, but this server has no such tool (an older or newer HA MCP): shown, never guessed
        "unknown": [n for n in policy.ha_read_tools if tools and n not in named],
        "own": [{"key": k, "label": v[0], "description": v[1], "kind": v[2], "used": usage.get(k, 0)} for k, v in OWN.items()],
        "roles": [{"key": k, "label": lab} for k, lab in ROLE_GROUPS],
    }
