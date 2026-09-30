---
name: alert-desk
description: Receives every critical alert of the VESTA rules (Home Assistant's vesta_critical_event), removes duplicates, routes by severity to the owner and facility-manager chats, runs the Done / Not found / Need help chase with the 15 and 45 minute ladder, gates the siren behind two signals and one human approval, and watches the villa from outside (villa silent). The engine runs it on every alert, every ladder button and every 5 minutes; you only read its status.
---

# alert-desk

Home Assistant detects in seconds and already sends its own Telegram message.
This desk makes those alerts land, get handled, and stop repeating. It never
decides alone to act on the villa.

## Files

- `skill.yaml`        what the engine runs, and when (intake on each alert, tick every 5 minutes, reply on a button)
- `rules.yaml`        routing by blueprint and rule id, cooldowns, siren policy, which role gets which severity
- `scripts/desk.py`   intake, tick, reply, siren, status (each prints JSON: `send` and `actions`)

## Inputs (all run by the engine, never by you)

1. `vesta_critical_event` from Home Assistant, fired by the VESTA rules AFTER their own message:
   `{blueprint, rule_id, incident_id, phase, label, entities, summary, timestamp}`.
   - `opened`: a new incident. `resolved`: Home Assistant says it cleared (the chase stops).
     `abandoned`: the rule stopped watching while it was still true (the owner hears it).
   - Only `critical_condition`, `critical_binary_trip` and `critical_presence_guard` ever send
     `resolved`. Incidents of `critical_schedule`, `critical_system` and `critical_watchdog` close
     through the ladder only.
2. The engine's own connection to Home Assistant: while it is up, a beat every minute. Its absence
   is how the desk knows the villa is cut off (internet, power, Home Assistant down).
3. Ladder button presses (Done / Not found / Need help / Mute) carrying the incident number.

## Procedure per alert (`desk.py intake`)

The decision is one of:
- `muted`: nothing sent, counted.
- `maintenance_mode`: `input_boolean.maintenance_mode` is on, nothing sent unless P1.
- `counted`: the same rule on the same entity is already open and inside its cooldown. Nothing sent.
- `repeat`: open and past the cooldown: one "still there, N times since" line to the FM.
- `new`: the owner and FM (P1) or the FM (P2) get the message, the FM's with the ladder buttons;
  a P1 or P2 also becomes a Facility ticket in the VESTA Kiosk; a camera snapshot travels with
  the message when the event names one.
- P3 goes to the store with state `digest`; the reports skill picks it up at 07:00. P4 is logged only.

## The chase ladder (every 5 minutes: `desk.py tick`)

- 15 min without reply: one reminder to the FM with the buttons.
- 45 min: escalation to the owner, incident assigned to the owner.
- Only one chase may run: the agent's. Home Assistant's `vesta_task_actions` ignores these
  events (they never carry `task_text`).
- Villa silent: no contact with Home Assistant for 30 min opens one P1 incident to both chats;
  the next contact closes it with a "back online" line.
- Alert fatigue: a rule that fired 20 times in 30 days becomes a "retune" proposal in the
  weekly report. Nothing is changed automatically.

## Replies

| Reply | Effect |
|---|---|
| Done | incident closed, its Kiosk ticket resolved, a "stays quiet" check the next night |
| Not found | stays open, mentioned in the weekly report |
| Need help | escalated to the owner with the detail |
| Mute | rule + entity muted 30 days, listed in the report |

## The siren: strict human validation

`rules.yaml` section `siren`. The gate arms only when all three hold:
1. At least 2 independent intrusion signals (different entities) inside 5 minutes.
2. The villa is marked vacant or away (`input_select.villa_mode`).
3. The owner approves the siren request with the Approve button within 10 minutes.

The approval goes through the engine's policy like any action, with read-back and a 3-minute
automatic stop. A single sensor, an occupied villa, a late press: nothing fires. The snapshot
is always sent before the question so the human looks first.

## What you may do

`desk.py status` shows the open incidents, the muted rules and the last beats: use it to
answer "what is open?". Everything else is the engine's.

## Never

- Never send the same incident twice inside its cooldown.
- Never act on a device from this skill except the siren, after the gate and the owner's approval.
- Never fill the chat with P3: they belong to the digest.
- Never assume the villa is fine because no alert came: check the villa-silent watch.
