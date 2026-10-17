---
name: alert-desk
description: Receives every critical alert of the VESTA rules (Home Assistant's vesta_critical_event), removes duplicates, routes by severity to the owner and facility-manager chats, runs the Done / Need help chase with the 15 and 45 minute ladder, gates the siren behind two signals and one human approval, and watches the villa from outside (villa silent). The engine runs it on every alert, every ladder button and every 5 minutes; you only read its status.
---

# alert-desk

Home Assistant detects in seconds and already sends its own Telegram message.
This desk makes those alerts land, get handled, and stop repeating. It never
decides alone to act on the villa.

## Files

- `skill.yaml`        what the engine runs, and when (intake on each alert, tick every 5 minutes, reply on a button)
- `rules.yaml`        routing by blueprint and rule id, cooldowns, siren policy, which role gets which severity
- `scripts/desk.py`   intake, tick, reply, status (each prints JSON: `send` and `actions`)

## Inputs (all run by the engine, never by you)

1. `vesta_critical_event` from Home Assistant, fired by the VESTA rules AFTER their own message:
   `{blueprint, rule_id, incident_id, phase, label, entities, summary, timestamp, priority?, claim?}`.
   - `opened`: a new incident. `resolved`: Home Assistant says it cleared (the chase stops).
     `abandoned`: the rule stopped watching while it was still true (the owner hears it).
   - `priority` (P1–P4, the rule's "VESTA priority" input) decides who hears it (`people_roles`);
     without one, the rule's route in `rules.yaml`. Home Assistant's own `severity` word is not a priority.
   - `claim`: a Home Assistant template the rule wrote with its own entities and limits, true while
     what the alert reports still holds. Every 5 minutes (`tick`) the desk renders it for every open
     incident: false for `clear_minutes` (10) closes it, with its Kiosk fault; a device that does not
     answer keeps it open, said once. An alert from a rule that sends no claim but its `bad_states`
     is read by those states (no watched entity in any of them); with neither, it waits for a person.
     The desk knows no rule by name: whatever a rule claims is the rule's.
   - `abandoned` with `still_true: false` (back to normal just as the rule gave up) closes the
     incident; still true, the owner hears it.
   - An alert back within `reopen_hours` (4) of its incident closing reopens it: "Back again: N
     times since …", under its own number, Home Assistant's latest words, its ladder started again
     and its OWN task and Kiosk fault open again, titled "(again: N times in 7 days)". Each run is
     counted on its own by the digest, the reports and the retune proposal.
   - An alert that no chat of the facility manager's received (Telegram refused them all) is handed
     to the owner at the next tick.
2. The engine's own connection to Home Assistant: while it is up, a beat every minute. Its absence
   is how the desk knows the villa is cut off (internet, power, Home Assistant down).
3. Ladder button presses (Done / Need help) carrying the incident number.

## Procedure per alert (`desk.py intake`)

The decision is one of:
- `maintenance_mode`: `input_boolean.maintenance_mode` is on, nothing sent unless P1.
- `counted`: the same rule on the same entity is already open and inside its cooldown. Nothing sent.
- `repeat`: open and past the cooldown: one "still there, N times since" message to the roles its
  priority reaches (as the first alert), with Home Assistant's latest words and claim.
- `new`: the roles its priority reaches (rules.yaml `people_roles`) get the message, the asked role's
  (`chase.asks`) with the ladder buttons;
  a P1 or P2 also becomes a Facility ticket in the VESTA Kiosk; a camera snapshot travels with
  the message when the event names one.
- P3 goes to the store with state `digest`; the reports skill picks it up at 07:00. P4 is logged only.

## One message per incident per chat

Every message about an incident is titled `#N-P2 (new)` (or `existing`, `closed`), then "To:" with the people it
went to, the original alert and what to check, then "Status:" with what was sent and where it stands; the engine
writes the title, "To:" and "Status:" (the skill gives the text and the status apart). A chat shows only an incident's
latest message: the engine deletes the earlier ones when a new one lands, Home Assistant's own alert
included (it is rewritten with the incident's number as soon as the desk knows it).

## The chase ladder (every 5 minutes: `desk.py tick`)

Every timing and role below is a setting (rules.yaml, or the villa's own `villa.rules.yaml` / its helpers): when a
person asks, read the value in force, never quote a number from here.

- After `reask_minutes` (rules.yaml `behaviour`) without reply: one reminder to the role the chase asks
  (`chase.asks`), with the buttons.
- After `escalate_minutes`: escalation to `chase.escalates_to`, the incident assigned to them.
- Only one chase may run: the agent's. Home Assistant's `vesta_task_actions` ignores these
  events (they never carry `task_text`).
- Villa silent: no contact with Home Assistant for `villa_silent_minutes` opens one P1 incident to both chats;
  the next contact closes it with a "back online" line.
- Alert fatigue: a rule that fired more than `alert_fatigue_per_month` times in 30 days becomes a "retune" proposal in the
  weekly report. Nothing is changed automatically.

## Answers

Every message about an open alert carries the buttons below, in every chat it reaches (the agent adds them); the
message then says who pressed what, and when. Typing the word works too.

| Button | Effect |
|---|---|
| Done | incident closed, its Kiosk ticket resolved; the device is read once `clear_minutes` (10) later. Still bad (its rule names its bad states): the incident opens again, "still there" — "Done by …, but … still reads …: still open. VESTA keeps watching it." — and the desk closes it when it is right. Not knowable (an older alert, a number): the people asked are told what it reads. The same for a fault closed in the Kiosk ("Closed in the Kiosk, but …"); a fault a person REOPENS in the Kiosk asks the facility manager again at once |
| Need help | escalated to the owner with the detail |

## The siren: strict human validation

`rules.yaml` section `siren`. The gate arms only when all three hold:
1. At least 2 independent intrusion signals (different entities) inside 5 minutes.
2. The villa is marked vacant or away (`input_select.villa_mode`).
3. The owner approves the siren request with the Approve button (it expires after policy.yaml's
   `approval_ttl_minutes`). It sounds for policy.yaml's `siren_auto_off_min`, then stops.

The approval goes through the engine's policy like any action, with read-back and a 3-minute
automatic stop. A single sensor, an occupied villa, a late press: nothing fires. The snapshot
is always sent before the question so the human looks first.

## What you may do

`desk.py status` shows the open incidents and the last beats: use it to
answer "what is open?". Everything else is the engine's.

## Never

- Never send the same incident twice inside its cooldown.
- Never act on a device from this skill except the siren, after the gate and the owner's approval.
- Never fill the chat with P3: they belong to the digest.
- Never assume the villa is fine because no alert came: check the villa-silent watch.
