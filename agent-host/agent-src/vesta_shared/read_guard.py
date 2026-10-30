"""May this call to the villa's system go through, with these arguments? ONE answer, for the AI's own reads
(vesta_agent/tools.py) and for every skill script's client (ha_client.McpClient.tool).

⚠️ ONE GUARD, TWO DOORS (architecture review, 2026-10-17). The AI's reads went straight to the server with their own
list of refused arguments; the scripts' client had its own list of read-only actions; the "6 hours of the whole villa's
logbook" was written in both. A rule added on one side left the other open. Which TOOLS a caller may use stays its own
(the AI: the tools the owner switched on that the server marks read-only; a script: READ_TOOLS); what their ARGUMENTS
may ask is decided here, whoever asks.
"""
from __future__ import annotations

from datetime import timedelta

from .limits import limit

#: The only ha-mcp tools a skill script's client calls. Anything else is refused there, whoever asks.
READ_TOOLS = {
    "ha_get_state", "ha_get_entity", "ha_get_device", "ha_search", "ha_eval_template", "ha_get_history",
    "ha_get_logs", "ha_get_automation_traces", "ha_config_get_automation", "ha_config_get_script",
    "ha_config_list_helpers",
    "ha_list_floors_areas", "ha_get_camera_image", "ha_get_todo", "ha_get_overview", "ha_get_system_health",
    "ha_get_integration",
}
WRITE_TOOLS = {"ha_call_service"}
#: A tool that can also write, allowed for its READ actions only, refused for every other one: {tool: (the argument
#: that names the action, the values that only read)}. ha_manage_blueprints `get`: what an automation built from a
#: blueprint can do (investigate's automation_able). ha_manage_energy_prefs mode `get`: the villa's Energy settings
#: (vesta_shared.energy_setup) — ⚠️ ITS ARGUMENT IS `mode`, NOT `action`: set / add_device / remove_device / add_source
#: rewrite the owner's Energy dashboard (ha-mcp marks the tool destructive), so every mode but get stays refused.
#: ha_manage_pipeline `list`: the villa's voice settings, which name the text-to-speech VESTA's spoken answers use
#: (vesta_agent.speech); create / update / set_preferred change them, `process` runs a sentence through the villa's
#: assistant (it ACTS: "turn on the light" turns it on).
READ_ACTIONS = {"ha_manage_blueprints": ("action", {"get"}), "ha_manage_energy_prefs": ("mode", {"get"}),
                "ha_manage_pipeline": ("action", {"list"})}
#: Arguments pinned to these values. ha_get_logs can read other apps' container logs (source "supervisor"), which may
#: print secrets: only the logbook and the system log.
ARG_VALUES: dict[str, dict[str, set]] = {"ha_get_logs": {"source": {"logbook", "system"}}}
#: Arguments never sent (ha_get_logs `slug`: another app's log).
ARG_FORBIDDEN: dict[str, set] = {"ha_get_logs": {"slug"}}
#: The only arguments a tool may be sent, whoever asks.
#: ⚠️ AN INTEGRATION'S STATE, NEVER ITS SETTINGS (owner, 2026-10-30: VESTA could not tell the ZBT-2 "is not plugged in",
#: the integration's own reason): ha_get_integration lists the villa's integrations and one by its entry, nothing else —
#: its options, schema, subentries and diagnostics can hold keys and passwords.
ARG_ONLY: dict[str, set] = {"ha_get_integration": {"entry_id", "query", "exact_match", "limit", "offset"}}
#: What of a tool's answer is handed on: for each list or record of it (`entry`, `entries`), only these fields. An
#: integration's entry answers its options even when not asked for them.
_INTEGRATION_KEPT = {"entry_id", "domain", "title", "state", "reason", "error_reason_translation_key", "disabled_by",
                     "source"}
RESULT_KEEP: dict[str, dict[str, set]] = {"ha_get_integration": {"entry": _INTEGRATION_KEPT,
                                                                 "entries": _INTEGRATION_KEPT}}


def kept(name: str, body):
    """`body` (a tool's parsed answer) with only what RESULT_KEEP hands on for `name`; any other tool's as it is."""
    keep = RESULT_KEEP.get(name)
    if not keep or not isinstance(body, dict):
        return body
    out = {k: v for k, v in body.items() if k not in keep}
    for k, fields in keep.items():
        v = body.get(k)
        if isinstance(v, dict):
            out[k] = {f: v[f] for f in fields if f in v}
        elif isinstance(v, list):
            out[k] = [{f: e[f] for f in fields if f in e} for e in v if isinstance(e, dict)]
    if isinstance(out.get("data"), dict):         # ha-mcp may wrap the answer in `data`
        out["data"] = kept(name, out["data"])
    return out
#: The villa-wide logbook covers at most this many hours a call — a longer period names its entity_id, and a script's
#: client reads a long period by slices of this size (McpClient.logbook).
#: ⚠️ A WEEK OF THE WHOLE VILLA, PAGE AFTER PAGE (villa, 2026-10-15): an /investigate read 8 to 15 October's logbook of
#: every device, a call every 15 seconds for 14 minutes — ha-mcp fetches the whole period from the villa's system at
#: each page.
def logbook_villa_hours() -> float:
    """How many hours of the whole villa's logbook one call may read (the AI's, and a script's slice)."""
    return limit("logbook.villa_window_hours", 6, unit="hours", group="read", lo=1, hi=48,
                 says="How many hours of the whole villa's logbook may be read in one go (one device's logbook has no "
                      "such window); a longer period is read in slices of this size.",
                 reached="The AI's longer read is refused with the reason; a skill reads on, slice after slice.",
                 told="ai")


def logbook_slice() -> timedelta:
    return timedelta(hours=logbook_villa_hours())


def logbook_too_wide(name: str, args: dict) -> str | None:
    """Why this ha_get_logs call is refused (the villa-wide logbook over more than logbook_villa_hours()), or None."""
    if name != "ha_get_logs" or (args.get("source") or "logbook") != "logbook" or args.get("entity_id"):
        return None
    try:
        hours = float(args.get("hours_back") or 1)
    except (TypeError, ValueError):
        return None
    window = logbook_villa_hours()
    if hours <= window:
        return None
    return (f"The logbook of the whole villa is read {window:g} hours at a time at most (asked: {hours:g}). "
            "Name the entity_id for a longer period, or read the hours around the moment that matters.")


def refused(name: str, args: dict | None, known: set | None = None) -> str | None:
    """Why the arguments of this call are refused, whoever calls — or None. `known`: the arguments the tool declares
    (the AI's calls: anything else is refused too)."""
    args = args or {}
    if name in READ_ACTIONS:
        key, reads = READ_ACTIONS[name]
        if args.get(key) not in reads:
            return f"{name} refused: only its {', '.join(sorted(reads))} {key} is allowed."
    only = ARG_ONLY.get(name)
    bad = sorted({k for k in args if (known is not None and k not in known) or k in ARG_FORBIDDEN.get(name, set())
                  or (only is not None and k not in only)})
    if bad:
        return f"Argument not allowed for {name}: {', '.join(bad)}."
    if why := logbook_too_wide(name, args):
        return why
    for k, allowed in ARG_VALUES.get(name, {}).items():
        if k in args and args[k] not in allowed:
            return f"{k} must be one of: {', '.join(sorted(allowed))}."
    return None
