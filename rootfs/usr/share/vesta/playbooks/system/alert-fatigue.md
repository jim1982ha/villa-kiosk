---
kind: playbook
name: alert-fatigue
domain: system
description: Reviewing whether the supervision itself has become noise.
consult_when: monthly
version: 1
last_confirmed: 2026-08-23
---

# Name your own noisiest output

Alert fatigue is the single failure mode that kills systems like this one. A
reader who has learned to dismiss without reading is worse off than one who was
never told anything, because they now believe they are covered.

## Check, in order

1. **Raised against acted on, per subject.** Volume alone is not noise. A
   finding raised many times and acted on every time is a real recurring
   problem, correctly reported.
2. **Outcome, not acknowledgement.** Acknowledgement counts mean very little on
   their own — a reflexive dismissal and a considered one look identical. The
   real measure is whether a finding was followed by a state change, a
   completed task, or an explicit confirmation.
3. **Dismissals with a reason.** These are the most valuable signal in the whole
   system. A reason like "that area is out of use" is a fact about the property
   that should stop an entire family of findings, not just the one dismissed.
4. **Your own worst offenders.** Name the subjects generating the most output
   with the least action. Be specific and be blunt about your own performance;
   a review that finds nothing wrong with itself will not be believed.
5. **The opposite failure.** Findings that were acted on urgently but were
   reported quietly, or late. Under-reporting is harder to see than
   over-reporting and does more damage.

## What you may not conclude

That a suppressed subject was wrong. Suppression is a signal about usefulness to
this reader at this time, not about whether the underlying condition is real.

## What to say

The counts, your worst offenders by name, and what you propose to stop saying.
Then say what you would need in order to resume saying it.
