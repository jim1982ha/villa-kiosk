---
kind: playbook
name: power-events
domain: electrical
description: A supply interruption, or phases that have diverged.
consult_when: the mains dropped, a phase reads far from its siblings, or devices restarted together
version: 1
last_confirmed: 2026-08-23
---

# The outage is not the finding. What failed to come back is.

Everything reports the loss. Almost nothing reports the recovery, and the
recovery is where the damage lives: equipment that does not restart, clocks that
reset, automations whose duration timers were counting when the power went and
started again from zero.

## Check, in order

1. **Bound the event.** When did the supply drop, when did it return, and was
   it one interruption or several in quick succession? Repeated short
   interruptions are far harder on motors than one long one.
2. **What did not come back.** Walk the equipment that was running before and
   compare with after. Pumps without automatic restart, network hardware,
   recorders, and anything on a switch that fails to a safe state are the usual
   casualties. This is the whole reason to read this playbook.
3. **What came back wrong.** A device that restarted into its default rather
   than its previous state — a setpoint reset, a schedule cleared, a valve in
   the position it powers up to rather than the one it was in.
4. **Duration-based automations.** Anything that acts after a condition has
   held for a period lost its clock. It is not broken, but it has forgotten,
   and it will not act until the condition has been continuously true again for
   the full period.
5. **Phase divergence, if the supply is three-phase.** Compare each phase
   against the others rather than against a number. Modest imbalance is
   untidiness — loads distributed unevenly by history. Severe or *changing*
   imbalance is a fault: a loose neutral, a failing connection, or a large
   single-phase load that has developed a problem.

## What you may not conclude

That the villa is fine because everything reports available again. Availability
is the network answering, not the equipment doing its job. Say which pieces you
positively confirmed running, and say plainly which you could not.

## What to say

The interruption's timing and count, the list of things that did not resume, and
the automations whose timers were reset. Where the supply is unreliable by
nature, the recurring recommendation is equipment that restarts itself — say it
once and do not repeat it every event.
