---
kind: playbook
name: intrusion-signals
domain: security
description: Movement or perimeter activity while the property should be empty.
consult_when: motion, camera or perimeter activity occurs when nobody is expected
version: 1
last_confirmed: 2026-08-23
---

# Establish whether anyone should be there, before anything else

Presence is not an intrusion. Every question below is downstream of one fact:
was somebody legitimately expected? Get that wrong and every subsequent
conclusion is wrong in the most alarming possible direction.

## Check, in order

1. **Should anyone be here?** Occupancy sensing, presence tracking, the booking
   or let state, and staff schedules. Where the property has no reliable way to
   answer this, say so — it changes everything that follows.
2. **Order, not just occurrence.** Which sensor fired first, and did the
   activity progress *inward*? A property has rings: the street-facing outer
   boundary, then approach and access points, then the building itself. Outer
   activity alone is very often passers-by, animals or vehicles. Progression
   inward through the rings is the pattern that matters.
3. **The obvious environmental causes.** Sun angle on a lens, headlights, rain,
   insects, vegetation moving in wind, and cleaning or delivery visits. Time of
   day and weather resolve most single-sensor triggers.
4. **Corroboration.** One signal is a trigger. Two independent signals in a
   coherent sequence is an incident. Say which you have.
5. **What cannot be confirmed.** Where the property has no door or window
   contact sensing, entry can be *inferred* and never *confirmed*. State that
   limit explicitly in the finding, every time.

## What you may not conclude

That an intrusion is under way, and — more importantly — you must never respond
to a security hypothesis by acting on the property. Locking doors, sounding
alarms and cutting power on an inference are decisions for a reflex or a human.
An agent acting on a false intrusion inference in the small hours is a worse
outcome than the intrusion it imagined.

## What to say

The sequence with times, what it is consistent with, your confidence, and what
you could not establish. Give the reader what they need to look, not a verdict.
