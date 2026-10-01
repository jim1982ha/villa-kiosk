# Readings carry the AI's own numbers; figures stay computed and checked

The owner's report mock-ups (written by the AI exploring Home Assistant freely) carry conclusions a script cannot produce: a step in a pump's power and what it means, a battery's weeks left, use against occupancy. 0.11.0 refused any AI sentence with a number not computed by the reports skill, which kept every number verifiable but left the reports without that reasoning. Decided with the owner (2026-10-01): in a report, the AI is the analyst. Its **readings** may use numbers it found itself in Home Assistant and are shown marked as VESTA's reading; the **figures** (tiles, tables, charts) stay computed by the skill's script and checked. The script still prepares clues from the playbook so the AI starts from them, which keeps the cost down.

## Considered Options

- Evidence first, every number checked (0.11.0): trustworthy, but the reasoning of the mock-ups is out of reach.
- AI as analyst with numbers unchecked and unmarked: closest to the mock-ups, but a reader cannot tell a computed figure from a concluded one.

## Consequences

- Do not reinstate the number check on readings: it is the rule this record lifts, on purpose.
- A reading can be wrong in a way a figure cannot; the mark is what tells the reader which is which.
