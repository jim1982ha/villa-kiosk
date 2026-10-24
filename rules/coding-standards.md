# Coding standards: read at review time

Judgement calls a reviewer checks on a diff. Anything a script can check belongs in the release gates
(`tools/release.py`, `agent-host/tools/release.py`) instead.

## The owner's action, end to end

Every "What you will see" line in `villa-kiosk/CHANGELOG.md` or `vesta-agent/CHANGELOG.md` names the action the owner
takes (saves an automation, replies on a card, opens a report), and a test performs THAT action and reads the result
where the owner sees it (the card, the page, the report).

**Why:** 2026-10-19, "lowering a priority stops the chase" was true when the automation alerted again and false when it
was only saved: two paths each changed the priority, one of them only the number. Found by the owner's question.

**How to apply:**
- The same job reached by two paths shares one function, and the test drives the path the owner uses.
- A claim made to the owner ("X now does Y") is checked against every path that can trigger X before it is written.

## One owner per job in the diff

A diff that adds a second way to do something the code already does (a second store, a second copy of a list, a
per-caller flag on a shared component) is sent back: see the owner's rules "One mechanism per job", "Defined once" and
"No per-caller switch".

## Words a person reads

New text a person reads follows the owner's wording rules: the screen's words, no platform name, "automation" for the
villa's automations, durations joined, no long dash, every number from its setting.

## Comments explain why

Comments explain WHY, in the style of the surrounding code: the decision, the owner's words and date when an owner's
rule shaped it. A comment never records a real id from the villa, and a comment describing a fixed defect is written in
the past tense.
