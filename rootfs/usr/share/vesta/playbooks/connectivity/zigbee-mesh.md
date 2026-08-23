---
kind: playbook
name: zigbee-mesh
domain: connectivity
description: Several low-power devices that went quiet together.
consult_when: multiple mesh devices lose contact in the same window
version: 1
last_confirmed: 2026-08-23
---

# Correlated silence is one fault, not many

This is the clearest case in the whole system for reasoning across signals
rather than one at a time. Four devices dropping in four minutes is not four
findings; it is one, and the correct output is one concern naming the group.

## Check, in order

1. **The window.** How close together did they go? Simultaneous points at the
   coordinator or its host. Spread over an hour points at interference or a
   router.
2. **The coordinator.** Its uptime, whether the host restarted, whether the
   integration reloaded. A restart explains everything downstream and usually
   resolves itself within a predictable recovery period — say the expected
   recovery so nobody attends unnecessarily.
3. **Shared route.** Mesh devices reach the coordinator through mains-powered
   routers. If the silent set all sit behind one router, that router is the
   fault and the battery devices are innocent.
4. **Interference and physical change.** A new device on a congested band, an
   access point moved, a door closed that was open, something metal now where
   nothing was. Silence that begins at a specific time and never recovers is
   often physical.
5. **Recovery.** Say whether they came back and how long it took. A mesh that
   recovers in a predictable window is healthy behaviour; one that needs a
   power cycle every time is a fault worth fixing.

## What you may not conclude

Which device is at fault, from the mesh's own data. You can identify the group
and the most likely shared cause. Naming a culprit you cannot see costs a wasted
visit.

## What to say

One concern: the group, the window, the shared factor you found, and whether it
recovered. If it recovers on its own within its usual window, this is a notice —
not something to wake anyone for.
