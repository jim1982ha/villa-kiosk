---
kind: playbook
name: standby-creep
domain: electrical
description: Idle draw that has risen over weeks rather than jumped.
consult_when: the overnight or unoccupied floor of a circuit is trending upward
version: 1
last_confirmed: 2026-08-23
---

# The floor, not the peaks

Standby creep hides inside normal use. Look at the daily *floor* — the lowest
sustained draw in each day, taken as a low percentile rather than a minimum, so
one instantaneous dip does not define it. A floor that steps is a device added.
A floor that ramps is a device degrading.

## Check, in order

1. **Date the onset.** A creep with no start date is an observation; one with a
   date is a lead, because it can be matched against what changed — an
   installation, a firmware update, a guest arrival, the start of the wet
   season.
2. **Step or ramp.** A step within one day is something switched on and left.
   A ramp over weeks is thermal: a failing power supply, a swelling capacitor,
   a fan that has stopped and left its load running hot.
3. **Rule out the obvious owner.** Before concluding degradation, look for a
   load that simply stayed on — a heater, a pump in manual, a lighting circuit
   with an override. This is the common case and the cheap fix.
4. **Correlate with temperature.** A floor that tracks outdoor temperature is
   cooling load, not waste. Say so; it protects your credibility for the next
   finding.
5. **Quantify at the live tariff.** Convert to money per month using the
   villa's own tariff figure from its profile, never an assumed rate, and state
   both the figure and the basis.

## What you may not conclude

That a rising floor is waste. Some of it is legitimate — a new appliance, a
season, a guest in residence. The finding is the *change* and its cost; the
judgement about whether it is wanted belongs to the person reading.

## What to say

The rise as a proportion, the money per month at the stated tariff, the date it
began, and the shape (step or ramp) with what that shape implies. Rank it by
value against effort, not by magnitude alone: a small saving behind a plug is
worth more of the reader's attention than a large one behind an electrician.
