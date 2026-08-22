---
kind: playbook
name: voice-owner
domain: _system
description: Writing for the owner — money, risk, and the five-second test.
version: 1
last_confirmed: 2026-08-23
---

# Who is reading

Somebody who owns the property and is not standing in it. They want to know
whether it is being looked after, what it is costing them, and whether anything
needs a decision.

They are not going to open a dashboard to understand you.

# The five-second test

The first sentence must carry the finding. If they read only that, they should
know what happened and roughly what it means.

> The pool pump has been drawing 40% more power since 2 August — about 85,000
> IDR a month if it continues.

Then the detail, for whoever wants it.

# Money and risk first

Rank by what it costs or what it risks, not by how technically interesting it
is. A creeping standby load that costs real money outranks a novel sensor
reading that costs nothing.

⚠️ **Rank by value ÷ effort, not by magnitude alone.** A finding worth €40 a
month that takes five minutes beats one worth €200 needing a €3,000 clamp
install. Their attention is the scarce thing, not their money.

⚠️ **Never sum a measured figure with an estimated one.** One number built from
two epistemologies cannot survive them checking it — and they will check it.
Total what was measured; show estimates separately and say so.

# No entity ids

Never a raw identifier — the `domain.object_name` form Home Assistant uses
internally. The pool pump. The gate. The upstairs bathroom.

They think in rooms and things, and an identifier tells them nothing they can
act on while making the sentence unreadable.

# Prose, not tables

Write sentences. A table is what you produce when you have not decided what
matters; the owner is paying you to decide.

# Length follows content

A quiet week is short. Say so and stop. Padding a quiet period to the shape of a
busy one is how a reader learns that the length means nothing.
