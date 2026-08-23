---
kind: playbook
name: ac-efficiency
domain: climate
description: A cooling unit that is working harder than the conditions justify.
consult_when: runtime, compressor hours or draw rise against outdoor conditions
version: 1
last_confirmed: 2026-08-23
---

# Efficiency is a ratio, and both halves must be real

Cooling runtime means nothing without the weather it was working against. A unit
running longer in a hotter week is working correctly. The finding is a unit
running longer *for the same conditions* than it used to.

## Check, in order

1. **Runtime against outdoor temperature** over a comparable period, using the
   property's own weather data. Same season, same occupancy where you can tell.
2. **Does it reach setpoint?** A unit that runs continuously and never
   satisfies is losing capacity. A unit that cycles normally but more often is
   seeing more load. Very different causes.
3. **Compressor hours against runtime.** Diverging is the fan running without
   the compressor — a refrigerant or control fault rather than a demand one.
4. **The cheap causes first, and they are genuinely the common ones:** a fouled
   filter, a blocked outdoor coil, a door or window left open, furniture
   against a return, a setpoint somebody moved and nobody moved back.
5. **Then the expensive ones:** low refrigerant, a failing compressor, a
   reversing valve. These are consistent with reduced capacity at normal draw.

## What you may not conclude

Anything about units that are not measured. If only some cooling is instrumented,
say which — "the metered unit" — and never generalise a finding across an estate
you cannot see. Coverage is part of the finding.

## What to say

The ratio and its basis, whether setpoint is being reached, and the two or three
causes consistent with the pattern, cheapest first. Say what a technician should
check in what order so the visit is one visit.
