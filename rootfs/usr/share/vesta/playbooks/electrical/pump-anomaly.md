---
kind: playbook
name: pump-anomaly
domain: electrical
description: A metered pump whose electrical signature has changed.
consult_when: power, power factor or runtime deviates from a pump's own baseline
version: 1
last_confirmed: 2026-08-23
---

# What a pump's electrical signature tells you

A motor's power factor and its real power move together in health and apart in
fault. That relationship is the diagnosis; the absolute figures are the villa's,
not yours.

## Check, in order

1. **Power factor against real power.** Power factor falling while real power
   holds is the classic failing run capacitor: the motor is drawing more
   apparent current to do the same work. It gets worse, and it takes the
   windings with it if left.
2. **The dry-run signature.** Real power collapses toward the motor's no-load
   figure while power factor *rises*. The impeller is spinning in air — lost
   prime, a closed suction valve, or a sump below the inlet. This is the one
   pattern on this page that is urgent rather than merely important: seals and
   bearings are water-cooled, and they fail in minutes, not weeks.
3. **Locked rotor.** A brief very high draw, then a trip. Do not recommend
   repeated restarts to "see if it clears" — each attempt is another
   locked-rotor current through a winding that is already hot.
4. **Its peers.** Pumps of the same class on the same supply are the best
   baseline available, because they share the tariff, the ambient temperature
   and the day. A change all of them show is a supply or a season; a change one
   of them shows is that pump.
5. **The meter, before the motor.** A negative mean power, a step change at
   exactly midnight, or a value that never moves are metering faults. A clamp
   that slipped reads like a pump that stopped, and the correct finding is
   "this circuit is no longer measured", which is a real and reportable defect.

## What you may not conclude

Real power alone does not diagnose anything. Head varies with valve position,
filter loading, tank level and how many outlets are open, so a pump drawing less
than yesterday may simply be pushing against less. Say what changed and what it
is consistent with; do not assert a failed part you cannot see.

## What to say

Name the pump. Give the change, the window, and its basis. State the physical
hypothesis and what would confirm it — a clamp meter reading, a capacitor
check, a look at the sight glass — so whoever attends brings the right thing.
