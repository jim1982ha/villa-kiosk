---
name: alert-desk
description: Receives every critical alert of the VESTA automations (the villa system's vesta_critical_event), removes duplicates, routes by severity to the owner and facility-manager chats, runs the Done / Need help chase (its reminder and escalation times are rules.yaml settings), gates the siren behind two signals and one human approval, and watches the villa from outside (villa silent). The engine runs it on every alert, every ladder button and every 5 minutes; you only read its status.
---

# alert-desk

The villa's system detects in seconds and already sends its own Telegram message.
This desk makes those alerts land, get handled, and stop repeating. It never
decides alone to act on the villa.

## Files

- `skill.yaml`        what the engine runs, and when (intake on each alert, tick every 5 minutes, reply on a button)
- `rules.yaml`        routing by blueprint and rule id, cooldowns, siren policy, which role gets which severity
- `words.yaml`        what the desk says on a card's Status lines, in each language a chat can read (each chat's copy
                      reads its own; the alert's own text is not in it: the engine has the AI translate that)
- `scripts/desk.py`   intake, tick, reply, status (each prints JSON: `send` and `actions`)

## Inputs (all run by the engine, never by you)

1. `vesta_critical_event` from the villa's system, fired by the VESTA automations AFTER their own message:
   `{blueprint, rule_id, incident_id, phase, label, entities, summary, timestamp, priority?, claim?}`.
   - `opened`: a new incident. `resolved`: the villa's system says it cleared (the chase stops).
     `abandoned`: the automation stopped watching while it was still true (the owner hears it).
     `restated`: the automation was saved, reloaded or the villa's system started: it sends what it claims now, and its
     open alert is judged by that from now on (no message to anyone).
   - `priority` (P1–P4, the automation's "VESTA priority" input) decides who hears it (`people_roles`);
     without one, the automation's route in `rules.yaml`. The villa system's own `severity` word is not a priority.
   - `claim`: a template of the villa's system the automation wrote with its own entities and limits, true while
     what the alert reports still holds. Every 5 minutes (`tick`) the desk renders it for every open
     incident: false for `clear_minutes` (its setting) closes it, with its Kiosk fault; a device that does not
     answer keeps it open, said once. An alert from an automation that sends no claim but its `bad_states`
     is read by those states (no watched entity in any of them); with neither, it waits for a person.
     The desk knows no automation by name: whatever an automation claims is the automation's.
   - `abandoned` with `still_true: false` (back to normal just as the automation gave up) closes the
     incident; still true, the owner hears it.
   - An alert back within `reopen_hours` hours of its incident closing (its setting: rules.yaml `behaviour:`, a
     villa's villa.rules.yaml first) reopens it: "Back again: N
     times since …", under its own number, the villa system's latest words, its ladder started again
     and its OWN task and Kiosk fault open again, titled "(again: N times in D days)", D the limit
     `problems.again_days`. Each run is counted on its own by the digest, the reports and the retune proposal.
     Every closing line that can reopen ends with that watch ("Watch 1 h."); a `reopen_hours` of 0 says none.
   - An alert that no chat of the facility manager's received (Telegram refused them all) is handed
     to the owner at the next tick.
2. The engine's own connection to the villa's system: while it is up, a beat every minute. Its absence
   is how the desk knows the villa is cut off (internet, power, the villa's system down).
3. Ladder button presses (Done / Need help) carrying the incident number.

## Procedure per alert (`desk.py intake`)

The decision is one of:
- `maintenance_mode`: `input_boolean.maintenance_mode` is on, nothing sent unless P1.
- `counted`: the same automation on the same entity is already open and inside its cooldown. Nothing sent.
- `repeat`: open and past the cooldown: one "still there, N times since" message to the roles its
  priority reaches (as the first alert), with the villa system's latest words and claim.
- `new`: the roles its priority reaches (rules.yaml `people_roles`) get the message, the asked role's
  (`chase.asks`) with the ladder buttons;
  a P1 or P2 also becomes a Facility ticket in the VESTA Kiosk; a camera snapshot travels with
  the message when the event names one.
- P3 goes to the store with state `digest`; the reports skill picks it up for its daily digest (at that job's time in its skill.yaml). P4 is logged only.

## One message per incident per chat

Every message about an incident is titled `#N-P2 (new)` (or `existing`, `closed`), then "To:" with the people it
went to, the original alert and what to check, then "Status:" with what was sent and where it stands; the engine
writes the title, "To:" and "Status:" (the skill gives the text and the status apart). A chat shows only an incident's
latest message: the engine deletes the earlier ones when a new one lands, the villa system's own alert
included (it is rewritten with the incident's number as soon as the desk knows it).

## The chase ladder (every 5 minutes: `desk.py tick`)

Every timing and role below is a setting (rules.yaml, or the villa's own `villa.rules.yaml` / its helpers): when a
person asks, read the value in force, never quote a number from here.

- After `reask_minutes` (rules.yaml `behaviour`) without reply: one reminder to the role the chase asks
  (`chase.asks`), with the buttons.
- After `escalate_minutes`: escalation to `chase.escalates_to`, the incident assigned to them.
- Only one chase may run: the agent's. The villa system's `vesta_task_actions` ignores these
  events (they never carry `task_text`).
- Villa silent: no contact with the villa's system for `villa_silent_minutes` opens one P1 incident to both chats;
  the next contact closes it with a "back online" line.
- Alert fatigue: an automation that fired more than `alert_fatigue_per_month` times in `alerts.fatigue_window_days` (a limit) days becomes a "retune" proposal in the
  weekly report. Nothing is changed automatically.

## Answers

Every message about an open alert carries the buttons below, in every chat it reaches (the agent adds them); the
message then says who pressed what, and when. Typing the word works too.

| Button | Effect |
|---|---|
| Done | incident closed, its Kiosk ticket resolved; the device is read once `clear_minutes` (its setting) later. Still bad (its automation names its bad states): the incident opens again, "still there" ("Done (…), but … still reads …: still open. VESTA keeps watching it."), and the desk closes it when it is right. Not knowable (an older alert, a number): the people asked are told what it reads. The same for a fault closed in the Kiosk ("Closed in the Kiosk, but …"); a fault a person REOPENS in the Kiosk asks the facility manager again at once |
| Need help | escalated to the owner with the detail |

## When a critical automation runs

Each critical automation has a "When this rule runs" choice (2026-10-20): Always (the default), Only while the villa is
empty, or Only while someone is in, read from the same "Villa empty" helper. An automation set to one of the last two raises
nothing outside those hours, so "no alert" then means "not watched", never "nothing happened", and it looks again
when the villa becomes empty (or someone comes in), alerting then on a problem already there. If the helper has no
answer (after a restart), the automation alerts anyway.

## The siren: strict human validation

`rules.yaml` section `siren`. The gate arms only when all three hold:
1. At least `siren.min_signals` independent intrusion signals (different entities) inside `siren.window_min` minutes.
2. The villa is empty: its "Villa empty" helper reads on (`rules.yaml` `siren.villa_empty`, the same one its
   presence automations read). Missing or unreadable: not empty, the siren is not offered.
3. The owner approves the siren request with the Approve button (it expires after policy.yaml's
   `approval_ttl_minutes`). It sounds for policy.yaml's `siren_auto_off_min`, then stops.

The approval goes through the engine's policy like any action, with read-back and its automatic stop
(`siren_auto_off_min`). A single sensor, an occupied villa, a late press: nothing fires. The snapshot
is always sent before the question so the human looks first.

## What you may do

`desk.py status` shows the open incidents and the last beats: use it to
answer "what is open?". Everything else is the engine's.

## Never

- Never send the same incident twice inside its cooldown.
- Never act on a device from this skill except the siren, after the gate and the owner's approval.
- Never fill the chat with P3: they belong to the digest.
- Never assume the villa is fine because no alert came: check the villa-silent watch.
