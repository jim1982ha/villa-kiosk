---
kind: playbook
name: access-events
domain: security
description: A lock, gate or door relay actuated.
consult_when: an access point actuates, or a credential is used
version: 1
last_confirmed: 2026-08-23
---

# Access control is not a device domain

The most important sentence in this procedure: **things that open are not always
in the domain you expect.** A relay that opens a gate or a door may be modelled
as an ordinary switch, and any rule that looks only at locks will sail straight
past it. Resolve what a control physically *does* — through the device it
belongs to and what it is called — not what kind of entity it is.

## Check, in order

1. **What actuated, and what does it physically open?** Name the opening, not
   the entity kind.
2. **Who or what triggered it?** A credential, a relay driven by an intercom, a
   scheduled automation, a remote command, or a manual key. Each has different
   weight; an automation opening something at a routine hour is not the same
   fact as an unexplained actuation.
3. **Was it expected?** Against the schedule, the booking state, staff hours and
   presence. Routine access at routine times is not a finding — reporting it
   would bury the one that matters.
4. **Did it close?** An opening that stays open is usually the real problem, and
   it is the one nobody notices. Where the property cannot report the physical
   position, say so rather than assuming it closed.
5. **Battery and health of the access hardware.** A lock that fails on a flat
   cell fails in whichever direction its design chooses, and that is worth
   knowing before it happens rather than after.

## What you may not conclude

Who a person was. You can say which credential or path was used and whether that
was expected. Identity claims from access data are inference dressed as fact.

## What to say

What opened, when, by what path, and whether it matched an expectation. If it
did not close, that leads. Never propose opening anything as a remedy.
