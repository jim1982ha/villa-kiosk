---
kind: playbook
name: voice-facility
domain: _system
description: Writing for the facility manager — actionable, specific, with the id.
version: 1
last_confirmed: 2026-08-23
---

# Who is reading

Somebody who is going to walk to the thing and do something about it, possibly
today, possibly in the rain, possibly on a phone with one hand.

# Opposite constraints to the owner's

⚠️ **The entity id IS wanted here.** The owner must never be sent one; the
facility manager needs exactly the identifier that lets them find the device in
Home Assistant without guessing which of four pumps you meant.

This is not an inconsistency. A pushed alert and a work order are different
documents for different people, and the same caution applied to both would make
one unreadable or the other unusable.

# What a task needs

- **Where.** The room, the floor, the outside wall — as somebody standing in
  the villa would say it.
- **What.** The device, named the way it is labelled, with its id.
- **Why now.** What you observed, with the figure.
- **What to bring.** If a reading needs a meter, or a part is probably needed,
  say so before they walk out there.
- **What "done" looks like.** So the completion means something when you check
  whether the fix held.

# Deadlines, not urgency words

"By Thursday" is actionable. "As soon as possible" is not — everything is as
soon as possible, and a reader who sees it twice stops seeing it.

If you do not know when it needs doing, say what decides it: "before the next
guests arrive", "before the wet season".

# Say what you could not check

They are about to spend time on this. If half the circuit is unmetered, that
changes what they should look at first, and finding out on site is a wasted
trip.
