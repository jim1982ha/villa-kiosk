---
kind: playbook
name: pump-runtime
domain: water
description: A supply or circulation pump running outside its schedule, or stopping part-way through it.
consult_when: runtime, start time or stop time diverges from the schedule the villa declares, including a run that ends early
version: 1
last_confirmed: 2026-08-23
---

# Four different faults, one symptom

"The pump did not run as scheduled" covers an overrun, a failure to stop, a
schedule that no longer matches how the property is used, and a run that ended
early. They are not the same finding, and the last one is the only one where
the ELAPSED TIME carries the diagnosis.

## Check, in order

1. **Schedule against actual.** Read the villa's own schedule declaration
   rather than assuming one. A pump running to a pattern the schedule does not
   contain is either a manual override or a second controller nobody documented.
2. **Overrun or never-stopped?** An overrun ends. A pump that never stops is
   the serious case: it is both continuous energy and evidence of demand that
   is not being satisfied — a leak, a stuck non-return valve, an open outlet, or
   a level sensor that never reads full.
3. **Failure to start** is the quiet one. Nothing alarms; the tank simply does
   not fill, and it is discovered by a person in a shower. Compare against the
   expected start, not only against a running state.
4. **Seasonal load.** Circulation and pool pumps legitimately run longer in some
   seasons. Check the season's own baseline before calling a longer run a fault.
5. **Stopped part-way through its window.** It started, ran, and went to zero
   before the schedule ended. The elapsed time before stopping is the
   diagnostic, not the fact of stopping: a thermal overload cuts out after a
   REPEATABLE run duration, so a pump that stops after about the same interval
   on successive days is overheating — check ventilation, the impeller and the
   suction line before the electrics. A breaker or an RCD trips on a fault, at
   no consistent elapsed time.
   - **How it went to zero separates supply from mechanism.** A step to zero in
     a few seconds is a switched supply — breaker, relay or controller. A power
     factor that collapses with it says genuinely unpowered rather than a
     stalled motor still drawing current.
   - **If it recurs, it is a cycling question**, and the short-cycling
     procedure owns that: shortening on-time with unchanged off-time is a
     control cutting out, which this page cannot distinguish from a single
     event.
6. **Cross-check the electrical signature** if the circuit is metered — the
   pump-anomaly procedure separates "running long" from "running badly".

## What you may not conclude

That a pump running longer is wasting energy. It may be meeting a real demand
that has changed. The waste finding requires the demand to be unchanged, and you
should say which of the two you established.

## What to say

Which pump, the schedule, the actual, and which of the three faults it is. A
pump that never stops is both a cost and a leak indication — say both, because
the reader will act on the second and only budget for the first.
