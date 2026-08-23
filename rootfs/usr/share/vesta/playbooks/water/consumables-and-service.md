---
kind: playbook
name: consumables-and-service
domain: water
description: Run-hour intervals, batteries, filters and anything else that is due.
consult_when: a service counter approaches its interval, or consumables are ageing across the estate
version: 1
last_confirmed: 2026-08-23
---

# Bundle the visit, do not schedule five

Every consumable in a property has its own clock and none of them coordinate.
The value here is not detecting one due item — a counter does that. It is
seeing them together far enough ahead that they become one visit.

## Check, in order

1. **Counters against intervals**, in remaining service life rather than
   elapsed time, so items are comparable to each other.
2. **Rate of consumption, not just the total.** An interval reached early
   because the machine ran twice as much is a different conversation from one
   reached on schedule.
3. **Batteries across the whole estate at once.** Battery devices fail
   individually and predictably, which makes them the single most bundleable
   maintenance item in a property. Look at the distribution: how many are in
   their last quarter, and when does the next cluster land.
4. **Season.** Filters load faster in some seasons; chemical demand and
   humidity-driven wear follow the same curve. A due date computed on a flat
   rate will be late in the heavy season.
5. **What "serviced" should record.** If completions do not record what was
   done and when, the next interval starts from a guess. Say so once when you
   notice it.

## What you may not conclude

That an item not yet at its interval is fine. Intervals are conservative
averages, and condition beats schedule where you can see condition.

## What to say

Group by visit, not by device. The reader wants "these six things are due within
the month, one trip" — not six notices arriving separately. Give each a due
window and say which one sets the date.
