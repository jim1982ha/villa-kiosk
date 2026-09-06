# VESTA

A Home Assistant add-on: a 3D kiosk for one villa, and an assistant that watches
the villa and tells somebody when it concludes something. This glossary exists
because the same English word has meant two different things here more than
once, on two surfaces that must never describe the villa differently.

## What the assistant concludes

**Concern**:
One thing the assistant has concluded about the villa, with a lifecycle: raised,
delivered, dealt with. What a person sees on the wall and on their phone.
_Avoid_: alert (fine in copy a person reads, ambiguous in code), finding, issue.

**Subject**:
What a concern is about, identified by its device(s). A concern's identity, and
the key every later join uses.
_Avoid_: entity (that is Home Assistant's word for one row of state), thing.

**Informational**:
A concern raised while the villa is set to tell rather than ask. It is delivered
once and never chased, and it asks nothing of the reader.
_Avoid_: observe-mode, shadow, silent. On screen it is written **FYI**.

**Salience**:
How unusual a reading is against that entity's own recent history. What decides
which of a thousand entities the assistant is shown.
_Avoid_: score, priority, anomaly.

## What people do about it

**Act**:
Something a person does TO a concern, changing its lifecycle: close it, dismiss
it, add it to the to-do list, ask for help.
_Avoid_: action (too general), button, command.

**Rating**:
A person's verdict on whether a concern was WORTH raising. It changes how
readily that subject is raised in future and never touches the concern itself.
_Avoid_: feedback, vote, thumb. Deliberately not an **Act** — the two are
different questions and the words must stay apart.

**Acknowledge**:
"Somebody has this." It stops the chase and takes the card off the wall; it does
not mean the villa's problem is over.
_Avoid_: seen, read, resolve.

## Being told, and being told again

⚠️ **Escalate** is banned as a bare term. It has meant two unrelated things in
this repo — chasing a person who has not answered, and judging a flag worth
investigating — and a reader cannot tell which from the word. Use **Chase** or
**Flag**.

**Chase**:
Telling somebody again, and then somebody else, because nobody has
acknowledged. A ladder of recipients on a clock: the same target, then the
counterpart, then everyone.
_Avoid_: escalate, remind, nag, follow-up.

**Flag**:
Triage's judgement that something is worth a closer look, handed on to be
investigated. It is not a concern yet and nobody has been told.
_Avoid_: escalate, alert, ticket.

**Audience**:
Who a concern was written FOR — the owner, or the facility manager. A property
of the concern.
_Avoid_: role, recipient, target. ⚠️ Not **Role**: an audience is who a finding
is written for; a role is who is logged in. They deliberately do not map.

**Role**:
Who is holding the device: owner, facility manager, guest. What a session has,
and what the add-on checks before permitting anything.
_Avoid_: audience, profile, user type.

**Outbox**:
The step that carries a concern to the people it is addressed to, and records
who was told and when.
_Avoid_: notifier, sender, delivery service.

## The assistant's own work

**Triage**:
The cheap pass that looks at everything and decides what deserves attention.
Produces **Flags**, never concerns.
_Avoid_: scan, first pass, filter.

**Investigation**:
The expensive pass that examines one flag and decides whether to raise a
concern. Concluding nothing is a complete and healthy answer.
_Avoid_: reasoning, deep dive, analysis.

**Brief**:
The scheduled written summary of a period, delivered on its own clock. Not a
concern and never chased.
_Avoid_: report, digest, summary.

**Villa document**:
What the assistant is shown about the villa for one pass — a bounded excerpt,
not the whole state.
_Avoid_: context, prompt, snapshot.

**Playbook**:
A procedure the villa's assistant reads at runtime to decide what to do about a
kind of situation.
_Avoid_: skill (that is a procedure for the DEV assistant, a different tree),
runbook, rule.

**Drill**:
A synthetic concern carried through the real delivery path to prove an alert
reaches a person. No model is involved and nothing is wrong.
_Avoid_: test alert, simulation, dry run.

## The two surfaces

**Wall tablet**:
The 3D kiosk, mounted in the villa. Reads the villa's own state live and never
waits on the internet.
_Avoid_: dashboard, UI, front end.

**Chat**:
The messaging platform a concern is delivered to, where the same acts are
offered as buttons.
_Avoid_: Telegram (one platform, not the concept), notification.
