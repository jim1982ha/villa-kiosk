# Reachability

enabled: true

## What this watches

Devices the property depends on becoming unreachable — a hub, a camera, a
controller. Not the same as a device being idle or off: unreachable means the
system has lost contact and no longer knows anything about it.

## What it does not cover

Brief drops. Wireless devices flap, and a report for every flap trains people to
ignore reports. What matters is something that has been unreachable long enough
to be a real outage, or something flapping so persistently that it is one.

## What to say

What is unreachable, since when, and what stops working while it is. If several
went at once, say that — it is usually one cause, and one message about it is
worth more than five about symptoms.
