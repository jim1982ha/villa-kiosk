---
kind: playbook
name: tamper-and-cyber
domain: security
description: A tamper trip, or a change in the monitoring system's own security surface.
consult_when: a tamper detector trips, a device leaves the network, or authentication failures rise
version: 1
last_confirmed: 2026-08-23
---

# Two surfaces, one procedure

The physical surface — somebody opening a device — and the digital one —
somebody probing the systems that watch the property — are checked together
because they are the same question asked twice, and because nothing else in the
system asks the second one at all.

## Check, in order

1. **Tamper trips.** Distinguish a device being opened from a device being
   knocked, moved, or having its battery replaced. Legitimate maintenance trips
   tamper detectors constantly; correlate against whether anyone was working.
2. **Devices leaving the network.** A device removed from a mesh or a hub,
   rather than simply going quiet, is a distinct and stronger signal. Removal is
   deliberate; silence is usually not.
3. **Authentication failures.** Repeated failed attempts against the property's
   own interfaces, and whether lockouts triggered. A handful is somebody
   mistyping. A sustained pattern from one source is not.
4. **New devices on the network.** Unexpected clients appearing on internal
   access points. Most are guests' phones and are entirely normal during a let —
   say so rather than reporting each one.
5. **What is exposed outward.** Any tunnel or remote-access path, and what it
   publishes. This changes rarely and should be checked when it does, because an
   expansion of the exposed surface is usually accidental.

## What you may not conclude

That a probe is an attack, or that a tamper trip is an intrusion. Report the
observation, the volume, and the source characteristics you can see. Attribution
is beyond what this data supports and stating it undermines everything else in
the finding.

## What to say

What was observed, how often, and over what period. For the digital half, say
whether existing protections responded — a lockout that worked is a system
behaving correctly and is reassuring rather than alarming.
