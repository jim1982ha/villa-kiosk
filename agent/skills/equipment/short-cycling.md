# Short cycling

enabled: true

## What this watches

Equipment that turns on and off more often than it used to. A pump, compressor
or motor that cycles rapidly is doing the same work with far more wear, and it
is one of the few signals that reliably precedes a failure rather than
reporting one.

## What it does not cover

It cannot tell a fault from a legitimate change in demand — a hot week, a
filled pool, a new occupant. It compares an asset against its own past, so a
first week of history is not enough to say anything, and it says so instead of
guessing.

## What to say

How often it is starting now against how often it used to, over a period long
enough to mean something. Name the change, not a threshold: "starting four
times an hour where it used to start once" is actionable, "exceeded a limit" is
not.
