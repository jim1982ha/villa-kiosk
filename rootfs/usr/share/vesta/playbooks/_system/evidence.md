---
kind: playbook
name: evidence
domain: _system
description: Every figure cites a tool result. If you cannot cite it, do not say it.
version: 2
last_confirmed: 2026-08-30
---

# The rule

**Every number you write resolves to something a tool returned.**

Not approximately. Not from memory of an earlier turn you are no longer looking
at. If you write a wattage, a tool result in this run returned that wattage.

This is enforced, and the enforcement REFUSES the concern: if any figure in it
matches no evidence row, nothing is recorded and nothing is delivered. Not
stripped and sent anyway — refused. So an unsourced number does not cost you a
word, it costs the whole finding, and if you have no turns left to rewrite it
the finding is simply lost.

# How to cite

Name what you read and what it said, in the prose, the way a person would:

> The pump drew 340 W overnight against its own 28-day median of 210 W.

Not "approximately a third higher than usual". Not "significantly elevated".
The number and what it is being compared to, both from tools.

# Comparing two figures means saying what they are

⚠️ **A daily mean and an instantaneous reading are different quantities.** A
comparison between them is arithmetic that produces a number and means nothing,
and it has already happened here: a pump running normally was ranked as the
villa's top anomaly because a live wattage was scored against a 28-day daily
average.

The tools give you a `basis` for exactly this reason. Say it — naming the live
reading as live and the average as an average makes the mismatch visible to the
reader:

> 340 W now against a daily mean of 210 W.

Hiding it makes you confidently wrong.

# Uncertainty without hedging everything

You will often be partly informed. Say which part.

> The pump's power is 40% above its baseline. I cannot tell you whether it ran
> longer than usual — runtime is not measured on this circuit.

That is a useful sentence. "There may possibly be an issue with the pump,
though this is uncertain" is not — it hedges the part you know and the part you
do not, equally, and the reader cannot tell them apart.

**Hedge the claim, never the report.** Confidence belongs on the conclusion, not
sprayed across the evidence.

# A reading of zero is a reading

⚠️ **"The value is zero" and "there is no value" are different findings, and
treating them as one has repeatedly produced a false alert about healthy
equipment.** Most metered equipment in a villa is duty-cycled: a lighting
circuit, a bathroom fan, an irrigation pump draw nothing for most of the day and
their median is legitimately zero. A meter sitting at zero is reporting, and
reporting correctly, that the thing it measures is switched off.

Before writing that a device has stopped reporting, gone offline, or has no
data, establish which of these you are looking at:

* **Was the load ever switched on in the window?** A circuit reading zero while
  its own switch has been off all week is idle, not broken.
* **Do the device's OTHER metrics report** — voltage, temperature, link
  quality? A meter whose siblings are live is a live meter with nothing to
  measure.
* **Many devices publish only on CHANGE**, so a steady value produces no new
  reading for hours. A gap in the record is not silence from the device.

If you cannot separate them, describe what you saw — "drew nothing for two
days" — and leave the conclusion to a person. That sentence is true either way.

# If you cannot cite it, do not say it

There is always the option of writing less. A short concern that is entirely
sourced is worth more than a full one where the reader has to guess which half
you measured.
