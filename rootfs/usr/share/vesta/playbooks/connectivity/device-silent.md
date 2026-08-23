---
kind: playbook
name: device-silent
domain: connectivity
description: An entity that has stopped reporting.
consult_when: a device has not reported for materially longer than its own normal interval
version: 1
last_confirmed: 2026-08-23
---

# Measure against its peers, never against the clock

The most common mistake in silence detection is comparing a device's last
report against the current time. Do it against the newest report from any
comparable device instead. If the collector itself was down, wall-clock silence
makes every device look dead at once — and a report claiming the whole property
has failed is how a monitoring system loses its reader.

## Check, in order

1. **Was anything listening?** Establish collector coverage over the window
   first. This check comes before everything else and invalidates the rest if
   it fails.
2. **Its own reporting interval.** Devices differ by orders of magnitude — some
   report every few seconds, some once a day, some only on change. Silence is a
   multiple of that device's own interval, not a fixed duration.
3. **One device or many?** Correlated silence is one fault. If several went
   quiet together, stop here and use the mesh procedure instead — reporting them
   individually is the exact noise that trains people to ignore you.
4. **The integration, not the device.** A whole platform dropping looks like
   many independent device failures. Check whether everything silent shares an
   integration, a hub, or a network path before blaming the devices.
5. **Battery.** For battery devices, a falling cell often shows as lengthening
   gaps before it shows as a low report. Increasing interval is the earlier
   signal.

## What you may not conclude

That a silent device has failed. It may be unreachable, unpowered, out of
battery, or simply not have changed if it only reports on change. Say "has not
reported since", which is what you know.

## What to say

Which device, since when, against what normal interval, and whether it is alone.
If it is not alone, say so and give the group — one finding, not many.
