# Talking to the owner

The owner reads results on a phone, between other things, and decides from what they read. These rules shape every
reply, report and review page.

## Speak in UI terms

Answer in the words of the screen: the tab, the button label, the chip text, the message received. Name a file,
function, config key, record id or version number only when the reader's decision depends on it, and then say what it
means in the same breath.

**Why:** told three times (2026-08-27 and 28): stored ids, record numbers, release numbers and invented names for UI
parts ("the chase line") appear nowhere in the app; the owner had to ask what they meant.

**How to apply:**
- Before sending, reread every sentence holding an identifier: is this word visible anywhere in the app? If not,
  replace it. Status and readiness summaries are the riskiest place: draft, then translate.
- Never build a table whose cells are identifiers.
- Log lines quoted as evidence are exempt.
- A control's shape is part of what it says: when a control surprises people, ask what its icon tells them before
  rewriting its tooltip; an act that cannot be undone says so.

## Short plain questions

Ask at most three questions per round, each answerable in one word, about what the owner will SEE. Decide mechanism,
edge cases and anything with an obvious default yourself and state it in one line.

**Why:** a round of eight questions, each with paragraphs of mechanism, made the owner drop a whole review: "you are not
clear at all".

## List every request

When a message carries several asks, the reply ends with one line per ask, as the owner wrote it, and what was done (or
not, and why). Every line is checked in the code or the live system, not recalled.

**Why:** 2026-10-14, the owner could not tell whether four asks had all landed from a summary written by theme.

## Review pages for the owner

Architecture review pages are written in plain English for the owner, never for a programmer, never in French. Each
card says, in order: what the owner SEES today (drawn as a chat, a page or a report), what they would see after, why
in one sentence without code words, and the cost (effort, risk). File names, line numbers and design terms go in a
folded "For the developer" box at the bottom. The finished page is sent to the owner as a file to read on another
device.

**Why:** the owner chooses candidates from the page; French was dropped on 2026-10-15 ("barely understandable"); code
words in the visible part lost them.

**How to apply:** never draw a fixed bug as "today"; a short "Words on this page" box at the top when UI terms need
explaining.

## Report prose rules

- Never a number without its unit where one exists; the unit comes from the reading's own unit, and an ambiguous unit
  prints none. A bare count carries its noun ("6 transitions").
- Quote the name of an automation, blueprint or file with apostrophes ('like this'): brackets are eaten by Telegram's
  Markdown.
- One glyph per heading, sub-headings included: a marker shared by siblings distinguishes nothing.
- Group repeated report lines on a reason code, never on their sentence.
- Write each grammatical number as a whole sentence; never assemble clauses (it produced double negatives).
- The role is "Facility Manager", never "caretaker".

**Why:** each rule followed a delivered briefing that was true and unreadable. A rendering rule is verified only when
the delivered message shows it, not when the function's output does.

## Check notes before listing them

Before telling the owner an item is open, parked, failed or "forever", open the code path or changelog that would make
it true and say what was checked. After an interrupted or rejected command, read the actual state (git log, origin,
CI) before saying what happened.

**Why:** 2026-10-14, four items told from status notes were all wrong in the code; a release reported "rejected" had
committed, pushed and published.

## Check an agent's claims

Before a finding from another agent reaches the owner, verify it against the current code: `git show` any release it
cites as evidence, and grep for a documented rule it would contradict. Verify every candidate, not only the strong ones.

**Why:** a sub-agent's cause was wrong and another candidate described code fixed releases earlier; both reached the
owner's report.

## Test steps the owner can do

Before giving the owner steps to check a change, measure the change on the villa and name the exact place to look and
what changes, or say plainly there is nothing visible to check. When the check is about something on screen, start
with a small text sketch of that screen with the spot marked, then the steps.

**Why:** steps for a case the villa barely has could not be done ("i don't understand how to validate it"); "the
four new buttons at the top right of the camera window" was not understood until a sketch showed where (2026-10-27).
