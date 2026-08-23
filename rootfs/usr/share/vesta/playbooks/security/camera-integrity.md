---
kind: playbook
name: camera-integrity
domain: security
description: A camera unreachable, frozen, or showing an image that has stopped changing.
consult_when: a camera drops, its stream stalls, or its stored image stops updating
version: 1
last_confirmed: 2026-08-23
---

# Why this is a security procedure and not a maintenance one

A camera being offline is a maintenance fact. A camera going offline *alone*, in
the small hours, immediately before activity elsewhere, is a different fact
entirely — and only context separates them. That correlation is the whole reason
this is written here.

## Check, in order

1. **Offline, frozen, or blind?** Unreachable is a network answer. Reachable
   with a stalled image is worse — the system looks healthy and is recording
   nothing new. An image that updates but shows an obstruction is a third case.
   Compare image freshness independently of reachability.
2. **One or all?** Every camera dropping together is the recorder, its host, its
   power, or the network. One dropping alone is that camera — and it is the
   alone case that carries security weight.
3. **Recorder-side or device-side.** A shared recorder failing takes everything
   with it including the recordings, which means the outage also destroyed the
   evidence of the outage.
4. **Timing against other signals.** Did anything else happen in the same
   window — motion, an access event, a supply interruption? Say the coincidence
   plainly and let the reader weigh it; do not assert causation between them.
5. **Repositioned or obstructed.** A view that changed without an outage is
   worth reporting: cameras get knocked, and one pointed at a wall is offline in
   every way that matters while reporting perfectly healthy.

## What you may not conclude

That a camera outage is an attack. The overwhelming majority are power, network
or hardware. Report the coincidence when it exists, with the alternatives, and
say which is more likely.

## What to say

Which camera, what kind of failure, whether it is alone, and what else happened
in that window. If it recorded nothing during the gap, say that explicitly —
that is the consequence the reader actually cares about.
