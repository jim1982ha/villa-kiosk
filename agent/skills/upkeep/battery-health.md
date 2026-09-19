# Battery health

enabled: true

## What this watches

Batteries approaching the end of their life, early enough to replace them on a
visit that was happening anyway rather than on an emergency one. The useful
signal is the slope over weeks, not today's percentage.

## What it does not cover

Devices that report no battery level at all, and devices whose level is a coarse
step rather than a percentage — for those, silence is the only signal available
and that is a different check. About one battery device in six on a typical
property reports nothing usable; say which those are rather than omitting them.

## What to say

Which devices, how long they have left at the current rate, and where they are.
Group them: one message about six batteries is read, six messages are not.
