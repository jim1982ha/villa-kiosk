# Agent code

Rules specific to the VESTA Agent (`agent-host/`, `agent-src/`). Its hard rules and module map are in
`agent-host/CLAUDE.md` and `agent-host/ARCHITECTURE.md`.

## Skills before code

Never hard-code in the engine (`vesta_agent/`) what a skill can define: what is computed, thresholds, report sections
and their order, wording and prompts, which scripts run, which automations count as alerts, routes. The engine stays
generic.

**Why:** owner, 2026-10-01: "the skills shall handle as much as possible … so that less coding will become necessary".
Skills are editable live; the engine needs a release.

**How to apply:** before adding a constant, a list or a text to the engine, ask whether a skill's files could say it.
Changing a starter skill records its fingerprint.

## Skill folders are hands-off

Never change a skill's files unless the request literally names that change. A temporary or test skill is delivered as
its own folder the owner adds and deletes.

**Why:** owner, 2026-10-01: "don't change anything in the skill folder, unless i explicitly ask you"; hit again
2026-10-09.

**How to apply:** a request to fix one thing in a skill does not cover its other files; write a merge problem up as
options and let the owner choose.

## Tools follow the asker

Only the role of the person who triggered a run decides which tools the AI may use; a skill's own tool list limits
nothing, and the skill adapts to what is missing. A scheduled job, with no person, gets everything switched on.

**Why:** owner, 2026-10-10: "the report skill shall never limit the tool access. Only the user role shall control what
is available".

## The engine delivers what must be seen

When a person must SEE something (a photo, a file), the engine delivers it from what the run did, never from an
optional argument the model must remember. An action the person did not ask for is gated by the engine, never by
wording.

**Why:** a small model looked at a camera and answered in text without sending the photo; another created tickets
nobody asked for. In a conversation the AI only OFFERS a ticket.

**How to apply:** read the run's tools used (the Costs page, the app log) before claiming a fix; check the engine's own
prompt text before blaming a skill.

## Never in the critical path

A critical alert never depends on the Agent: the villa's system formats and sends its own, with a plain-text fallback.
The Agent listens, translates and adds; notifications are never blocked by it, and when a translation is not possible
the original stays.

**Why:** the owner's design (2026-09-30): the villa's system stays the only receiver of the villa's bot; the Agent reads
its events and only sends.

## Format changes need migrations

The Agent writes files into the owner's folders (skills, settings, its knowledge pack). Before changing their shape,
handle what is already there: migrate what the Agent wrote, refuse loudly what the owner wrote, and rebuild a nightly
artefact at start-up when its rules change.

**Why:** a new rule in the nightly knowledge pack did nothing until the next night, and the owner asked why.

## Test the real argument path

After a refactor, test the caller path with real wiring, and read the villa's app log the morning after a release for
script failures, not only the tests.

**Why:** a rename inside a function dropped every script's injected arguments; the tests passed them directly, and the
nightly scripts failed on the villa.

## The Agent's test environment

Tests run with `agent-host/.venv/bin/python` (Python 3.13, gitignored; how to rebuild it is at `PY` in
`agent-host/tools/release.py`). Mutation runs use `PYTHONDONTWRITEBYTECODE=1` and `-B`, and name tests in full.
