"""Whom an alert reaches, by the alert desk's rules (its rules.yaml, the villa's own on top): ONE reader of its routes
and people_roles, asked by the desk for every alert it carries and by message_format for the values the villa's own
messages are sent with while VESTA is away.

  route(rules, rule_id, blueprint)  → the alert's route: the defaults, then the first route that matches
  reaches(rules, priority)          → the roles a priority reaches ("digest" never one of them)
  follow(rules)                     → what "Follow the VESTA Agent" means for each kind of VESTA rule, as data

⚠️ ONE READER, TWO ASKERS (architecture review, 2026-11-27): the desk read the routes in order (blueprint or prefix,
first match wins) and the villa's values read them again their own way. On 2026-11-26 (ce6ecafbe) the villa's
"Follow" table had drifted to the last route of a kind, so the villa's own message could say one "To:" and VESTA's
copy a second later another.
"""
from __future__ import annotations

PRIORITIES = ("P1", "P2", "P3", "P4")


def route(rules: dict, rule_id: str, blueprint: str | None = None) -> dict:
    """A route by the rule's blueprint first (the live event names it), then by rule id prefix; a VESTA rule (it names
    a blueprint) that neither matches takes rules.yaml `unrouted`, by its name.

    ⚠️ AN UNCLASSIFIED ALERT IS NOT A DIGEST LINE (owner, 2026-10-19): a rule of a kind with no route fell to the
    defaults' P3, kept for the next morning's digest. Now its name decides: `critical_…` is P1, any other P2."""
    r = dict(rules.get("defaults") or {})
    for cand in rules.get("routes") or []:
        if not isinstance(cand, dict):
            continue
        if (blueprint and cand.get("blueprint") == blueprint) or \
                (cand.get("prefix") and rule_id.startswith(cand["prefix"])):
            r.update(cand)
            return r
    if blueprint:
        by_name = rules.get("unrouted") or {}
        name = rule_id.removeprefix("automation.")
        said = by_name.get("critical_") if name.startswith("critical_") else by_name.get("other")
        if said:                                     # a villa file without it: the defaults', never a guess
            r["severity"] = said
    return r


def reaches(rules: dict, priority: str) -> list[str]:
    """The roles priority `priority` reaches (people_roles), in their order there; "digest" is what a priority does,
    never a role it reaches."""
    return [role for role, sevs in (rules.get("people_roles") or {}).items()
            if role != "digest" and priority in (sevs or [])]


def follow(rules: dict) -> dict:
    """What "Follow the VESTA Agent" means for a VESTA rule, as the villa's blueprints read it: the priority of each
    kind of rule (`blueprints`), else by the rule's name (`critical_`, `other`), each `route`'s answer for an
    automation of that kind. The villa reads it from data (message_format.FOLLOW_PRIORITY), so this is that answer."""
    kinds = [str(c["blueprint"]) for c in rules.get("routes") or [] if isinstance(c, dict) and c.get("blueprint")]
    sev = lambda rule_id, bp=None: str(route(rules, rule_id, bp).get("severity"))   # noqa: E731
    # a blueprint no route names: its rule's name decides, as `route` does for an automation of that kind
    unnamed = "\0no route"
    return {"blueprints": {bp: sev("automation.", bp) for bp in dict.fromkeys(kinds)},
            "critical_": sev("automation.critical_", unnamed), "other": sev("automation.", unnamed)}
