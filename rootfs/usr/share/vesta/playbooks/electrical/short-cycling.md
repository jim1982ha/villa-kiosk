---
kind: playbook
name: short-cycling
domain: electrical
description: Equipment that starts and stops far more often than it used to.
consult_when: transitions per hour for a motor, compressor or pump exceed its own baseline
version: 1
last_confirmed: 2026-08-23
---

# Cycling kills motors faster than runtime does

Starting current is several times running current, and every start heats the
winding and loads the bearings. A machine that runs twice as long is working; a
machine that starts ten times as often is wearing out. Runtime totals hide this
completely — count transitions.

## Check, in order

1. **Transitions per hour against the same machine's own baseline**, on a
   comparable day. Weekday and weekend, occupied and empty, are different
   populations.
2. **Is the cycle time shortening or the count rising?** Shortening on-time
   with unchanged off-time points at a control that is cutting out — a
   thermostat differential, a pressure switch, an overload resetting. Rising
   count with normal on-time is usually demand.
3. **Hysteresis.** Most short cycling is a control problem, not a mechanical
   one: a differential set too narrow, a sensor mounted where it sees the
   output rather than the space, a setpoint fighting another system.
4. **For pumps, suspect the pressure vessel.** A waterlogged expansion vessel
   or a failed bladder removes the buffer that makes each cycle long, and it is
   a cheap part with an expensive symptom.
5. **For compressors, check the airflow path** — a fouled coil or a blocked
   filter raises head pressure until the machine trips its own limit.

## What you may not conclude

That cycling means imminent failure. It means accelerated wear and a control
worth looking at. Say the wear; do not predict a date you cannot support.

## What to say

The transition rate now against its baseline, both with their windows. The most
likely control cause. That the fix is usually an adjustment rather than a part,
which is what makes this worth attending to early rather than late.
