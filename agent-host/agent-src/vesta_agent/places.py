"""The VESTA Agent page's places: what each section is called, and where it is.

⚠️ ONE NAME PER PLACE (owner, 2026-10-08: "all the titles and sub-titles consistent between the views, so the user
knows what shows what, and where it is linked to"). A card, a tab or a section is named HERE, once: the page's titles
and tabs read this table (the server writes it into the page), and so does every sentence that sends the reader
somewhere ("switched off in Rules › AI tools"), on the page, in a chat, in the change history and in policy.FIELDS.
Before this table the same tools were "What the AI can use" in Rules and "Tools used by the Skill" on a skill, and
"Overview › Changes" sent the reader to a card titled "Changes made on these pages".

The words: "the agent" is the VESTA Agent, the program; "the AI" is the model it asks; a TOOL is what the AI may
call (Home Assistant's, or the agent's own); an ACTION is a change on the villa, which a person approves.
"""

from __future__ import annotations

import re

#: the page's top tabs: key (its address, #rules) → its name. index.html is filled from it (architecture review 9: the
#: names were typed there, and again as the first word of every place below — checked against this at import)
TABS = {"overview": "Overview", "rules": "Rules", "skills": "Skills", "costs": "Costs"}

#: key → (the title the page shows, the place it sits in: a top tab, or "Tab › Card")
PLACES: dict[str, tuple[str, str]] = {
    # Overview
    "last_day": ("The last 24 hours", "Overview"),
    "jobs_run": ("Scheduled jobs run", "Overview › The last 24 hours"),
    "changes": ("Page changes", "Overview"),
    "setup": ("Copy the setup", "Overview"),
    "setup_out": ("Download this villa's setup", "Overview › Copy the setup"),
    "setup_in": ("Import a setup", "Overview › Copy the setup"),
    # Rules
    "acting": ("Acting on the villa", "Rules"),
    "ai": ("AI brains and limits", "Rules"),
    "people": ("People", "Rules"),
    "actions": ("Allowed actions", "Rules"),
    "protected": ("Protected devices", "Rules"),
    "tools": ("AI tools", "Rules"),
    "ha_tools": ("Home Assistant tools", "Rules › AI tools"),
    "agent_tools": ("Agent tools", "Rules › AI tools"),
    "tool_roles": ("Tools by role", "Rules › AI tools"),
    # Skills (owner, 2026-10-08: short names like the others — "Skill tools" beside "AI tools" and "Agent tools")
    "skill_about": ("About", "Skills"),
    "skill_files": ("Files", "Skills"),
    "skill_compare": ("Compare", "Skills"),
    # "{skill}": the open skill's name (owner, 2026-10-08: "When the reports skill runs"), left out where no skill is
    "skill_when": ("When the {skill} skill runs", "Skills › About"),
    "skill_commands": ("Skill commands", "Skills › About"),
    "skill_tools": ("Skill tools", "Skills › About"),
    # Costs
    "cost": ("AI cost", "Costs"),
    "cost_day": ("Per day", "Costs › AI cost"),
    "cost_split": ("Cost breakdown", "Costs"),
    "by_work": ("By work", "Costs › Cost breakdown"),
    "by_model": ("By model", "Costs › Cost breakdown"),
    "runs": ("AI runs", "Costs"),
    "every_run": ("Every run", "Costs › AI runs"),
    "tools_called": ("Tools called", "Costs › AI runs"),
}


assert all(place.split(" › ")[0] in TABS.values() for _, place in PLACES.values()), "a place outside the top tabs"

#: the order of a tab's sections, top to bottom, by place key (architecture review 9: the order was a line of code,
#: and every "move X below Y" edited it and the test that quoted it). The page draws its sections in this order.
ORDER = {
    "rules": ["acting", "people", "actions", "protected", "ai", "tools"],   # AI tools below AI brains (owner, 2026-10-08)
}
assert all(k in PLACES for keys in ORDER.values() for k in keys), "an ordered section with no place"


def title(key: str, **names: str) -> str:
    """A place's title; a {slot} is filled from `names`, or left out with its space ("When the skill runs")."""
    return re.sub(r"\{(\w+)\} ?", lambda m: f"{names[m.group(1)]} " if names.get(m.group(1)) else "", PLACES[key][0])


def where(key: str) -> str:
    """The way a sentence sends the reader there: "Rules › AI tools"."""
    return f"{PLACES[key][1]} › {title(key)}"
