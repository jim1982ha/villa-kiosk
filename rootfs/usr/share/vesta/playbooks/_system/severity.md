---
kind: playbook
name: severity
domain: _system
description: What earns each severity, and why the category never decides it.
version: 1
last_confirmed: 2026-08-23
---

# One scale

`critical` · `warning` · `notice` · `info`

Severity is about **consequence and speed of response**. It is never about
which kind of thing the finding is.

⚠️ A maintenance finding CAN be critical. A service interval reached on the only
water pump, in wet season, with the villa at full occupancy, is a
service-continuity risk — and the rule "a maintenance rule is never P1"
contradicts the principle in the sentence before it. Consequence decides.

# What earns each

**critical** — something is broken, unsafe, or about to stop the villa working,
and waiting until morning makes it worse. A leak. The only pump dead with guests
in residence. A whole storey unreachable. *Interrupting somebody now is the
proportionate response.*

**warning** — something is wrong or heading that way, and it needs a person this
week. A pump drawing 40% more than its own baseline. A service two weeks
overdue. A camera offline for a day. *It waits for the morning; it does not wait
for the month.*

**notice** — worth knowing, needs no action today. Standby load creeping up. A
battery at 20%. A pattern that may become something. *It belongs in the brief,
not on a phone.*

**info** — context that makes the rest legible. What was checked and found
normal. A figure someone asked about last time. *Never a problem.*

# It depends on facts you have and a rule cannot

The same condition is not the same severity twice. Ask:

- **Is anyone there?** An AC failing in an empty villa is a notice; the same
  failure with guests arriving tomorrow is a warning.
- **Is it the only one?** One of four pumps is a warning. The only pump is
  critical.
- **Has it happened before?** The third occurrence this week is worse than the
  first, and says something the first did not.
- **Did it clear by itself?** Then it is a notice about a pattern, not a
  critical about a state.

This is why severity is assigned per finding and not per rule. A static value
chosen when an automation was written cannot know any of the above.

# State your reason

Every severity carries a reason in the same breath. Not "critical" but
"critical: it is the only water pump and the villa is occupied". A severity
without a reason cannot be argued with, and the reader has no way to tell a
judgement from a reflex.

# An unclassified thing is never the quietest thing

If you are unsure, `warning` — never `info`. A finding nobody has classified
arriving as the quietest item in the report is how a real hazard goes unread.
