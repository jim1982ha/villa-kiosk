---
kind: playbook
name: lighting-circuit
domain: electrical
description: A lighting circuit whose draw does not match how it is being used.
consult_when: a lighting circuit reads high, flat, or unchanging against occupancy
version: 1
last_confirmed: 2026-08-23
---

# Three faults look identical from the meter

A lighting circuit reading a constant value can be a circuit left on, a driver
that has failed to a constant load, or a meter that has stopped reporting and is
repeating its last value. They are the same line on a chart and they need three
different responses.

## Check, in order

1. **Does the value ever change?** A perfectly flat reading over days is a
   reporting fault until proven otherwise. Real lighting varies with switching,
   dimming, and temperature.
2. **Against occupancy and schedule.** Light in an unoccupied space outside its
   schedule is either an override nobody cleared or an automation that turned
   something on and did not turn it off. Check whether the space has any
   occupancy sensing at all before concluding it was empty.
3. **Against daylight.** Exterior and perimeter lighting that draws in daylight
   is a sun-position or schedule fault, and it is one of the largest avoidable
   costs in a property because it runs every day and nobody sees it.
4. **Driver failure.** LED drivers commonly fail to a *higher* constant draw
   with reduced or flickering output, so a circuit costing more while lighting
   less is a real and specific pattern.
5. **Dimming.** A dimmed circuit's draw is not proportional to its brightness,
   and on some drivers barely falls at all. Do not present dimming as a saving
   without evidence from the circuit itself.

## What you may not conclude

Which fixture is responsible. A circuit is a group; the meter cannot resolve
inside it. Say "this circuit", name what it feeds if the profile knows, and let
the person with eyes on it resolve the rest.

## What to say

The circuit, the pattern, and which of the three faults it is consistent with —
and if you cannot separate them, say which check would.
