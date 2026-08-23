---
kind: playbook
name: monitoring-health
domain: system
description: Auditing the monitoring itself, before making any claim about coverage.
consult_when: cyclically, and before any statement about what is or is not happening
version: 1
last_confirmed: 2026-08-23
---

# A supervisor that cannot see is indistinguishable from a quiet property

Run this before claiming anything is fine. Every "nothing to report" is only as
good as the answer to "was I watching?", and that answer is not free.

## Check, in order

1. **Was I listening for the whole window?** Collector coverage first. A gap
   makes every other statement in the report conditional, and it must be said
   in the report rather than known internally.
2. **Automations that are disabled.** Each one is a capability the property
   thinks it has and does not. Disabled automations cluster around equipment
   people have given up on — read them as evidence, not just as configuration.
3. **Entities that are unavailable rather than silent.** Unavailable is the
   platform saying it cannot reach something; that is a different fault from a
   device that has not changed.
4. **Can the property still be recovered?** Backup status. A backup that has
   silently stopped succeeding is the classic failure nobody notices until the
   day it matters, and it costs one check to rule out.
5. **Can I still speak?** The outbound notification path. A supervisor whose
   delivery is broken produces perfect reports that reach nobody — and by
   definition it cannot report that fault through the channel that is broken.
   Check it, and say when it was last confirmed working.
6. **Duplicate and malformed device records.** These need human judgement about
   naming and cannot be resolved automatically; surface them as a list for a
   person rather than as a fault.

## What you may not conclude

That coverage is complete because nothing reported a gap. Say what you verified
and what you inferred, separately.

## What to say

Address it to whoever maintains the system. Lead with anything that means the
last report was less trustworthy than it appeared — that correction matters more
than any new finding.
