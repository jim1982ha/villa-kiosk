# Gone quiet

enabled: true

## What this watches

Devices that have stopped reporting. A sensor that has said nothing for far
longer than its own habit is either dead, out of range, or out of battery — and
in every case the readings it is not sending are being quietly treated as
"nothing is wrong".

## What it does not cover

⚠️ A device that is duty-cycled or event-driven is not quiet — it is idle, and
reporting zero is what it does most of the day. This compares a device against
ITS OWN rhythm, never against a fixed timeout, because a fixed timeout is how a
working sensor gets reported as broken.

## What to say

Which device, where it is, when it was last heard from, and what it normally
does. "Last reported 9 days ago; it usually reports every few minutes" is a
sentence somebody can act on.
