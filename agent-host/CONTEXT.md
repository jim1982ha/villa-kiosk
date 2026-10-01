# VESTA Agent

The villa's assistant on Telegram: it follows the VESTA rules' alerts, records jobs for the facility manager, and writes the villa's reports. This glossary covers the agent and its skills, not the VESTA Kiosk.

## Language

**Skill**:
A folder of instructions, scripts and settings that defines one job of the agent; edited live, never part of a release.
_Avoid_: plugin, module

**Playbook**:
The organised list, in a skill, of situations the agent can recognise in the villa's data, each with what to look at, what it means, what to check on site and what to ask.
_Avoid_: rules (taken by the VESTA rules), heuristics, knowledge base

**VESTA rule**:
A Home Assistant automation built on one of the VESTA blueprints, which raises a critical alert.
_Avoid_: alarm, guard

**Figure**:
A number in a report computed by a skill's script from Home Assistant or the agent's records, the same every time for the same period.
_Avoid_: stat, metric, KPI

**Reading**:
A conclusion the AI writes in a report after looking at the villa's data itself, shown marked as VESTA's reading; its numbers are the AI's own, not computed figures.
_Avoid_: insight, analysis, comment

**Clue**:
An observation a skill's script finds in the villa's data from a playbook entry's condition, handed to the AI as the starting point of a reading.
_Avoid_: hint, signal, alert

**Problem**:
Something wrong in the villa that someone has to deal with: seen by the night check (a finding) or raised by a VESTA rule (an incident), with the facility manager's task about it and its fault in the VESTA Kiosk. Open until it clears by itself, or a person answers it (Done) or closes its fault in the Kiosk.
_Avoid_: issue, ticket (the Kiosk's record of it), task (the facility manager's job about it)

