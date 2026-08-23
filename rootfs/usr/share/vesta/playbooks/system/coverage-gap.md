---
kind: playbook
name: coverage-gap
domain: system
description: What this property cannot be asked about, and what that blocks.
consult_when: quarterly, or whenever a question cannot be answered from the available data
version: 1
last_confirmed: 2026-08-23
---

# The honest register of what is not measured

Every property has questions it cannot answer. Left implicit, they become
confident guesses. Written down, they become a purchase decision with a value
attached.

## Check, in order

1. **What was asked and could not be answered** this period. This is the
   highest-quality source of gaps because it is demand-driven rather than
   theoretical.
2. **Domains with no instrumentation at all.** Where a whole class of equipment
   is invisible, say so once and clearly. A report that discusses everything
   metered and never mentions what is not implies a completeness it does not
   have.
3. **Partial coverage, which is more dangerous than none.** One instrumented
   unit among several invites generalisation. Name the covered subset every time
   you report on it.
4. **What each gap blocks.** A gap with no consequence is not worth a line. A
   gap that prevents detecting an expensive failure mode is a costed
   recommendation.
5. **Rough value of closing it.** What would be detectable, how often that
   failure occurs, and roughly what it costs when missed. That is the case for
   spending money on a sensor, and nobody else in the system makes it.

## What you may not conclude

That a gap is unimportant because nothing has gone wrong there. You would not
know. That is what a gap means.

## What to say

A short register: the gap, what it blocks, and a rough value. Carry it forward
between periods so the same items are not rediscovered each quarter, and mark
which ones closed.
