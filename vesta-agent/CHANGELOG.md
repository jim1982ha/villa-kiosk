## 0.12.350

What you will see:
- Skills: an "Import skill" button beside "New skill" takes a .skill file made offline, the way Claude imports one (a
  zip of one skill folder with its SKILL.md, scripts, references, assets). The skill is checked as a save is, then
  appears in the list. A skill of the same name already here is refused, never replaced. Its scripts are kept but run
  only once its skill.yaml declares them, as for every skill.

## 0.12.349

- Nothing changes in the app. The rules every contributor's Claude follows (CLAUDE.md and the rules folder) and the
  guards that keep work off main are now part of this branch too, the same as the Kiosk's; a release stops when they
  differ.

## 0.12.348

What you will see:
- Skills, a guide's View mode: numbered steps keep their own numbers (1, 2, 3…) as written in the file, even when
  each step has its own points under it. They all read "1." before.

## 0.12.347

What you will see:
- An alert card's lines now reach every chat in its own language even when the AI answers in a slightly different
  form than asked. "Master Bedroom Aqara is unlocked for 10min" stayed English on the French chat because the AI's
  answer was not read; now it is read, and if it still cannot be read the AI is asked once more at once.
- Lines that stayed English for that reason are translated again on the next card, without waiting a day.

## 0.12.346

What you will see:
- Rules › Devices: "Asleep between reports" no longer has a sentence under it. Where the list is set, and what the
  agent does with it, is behind the (i) next to the title.

## 0.12.345

What you will see:
- Skills, reading a SKILL.md on a phone: a table now keeps its columns readable and scrolls sideways if it is too wide,
  instead of breaking a column one letter per line. A long setting chip (such as telegram.message_chars) wraps inside
  the screen.
- Limits: "Delete conversation context at" offers the same words as the Rules tab ("Every day at 02:00"), following
  its settings.
- Page changes: a person who appears twice under the same name, or a list emptied, is now told apart correctly.
- Scheduled jobs: deleting or moving a job never takes another job's run for the day, and a job moved to a later time
  runs once that day.
- The villa's own messages: each one is redrawn in the order the villa wrote them, in the chat's current language.
  Device names stay as they are and are never sent for translation. The record of them stays small.
- The guides no longer say a setting's unit a second time after its chip.
- Opening a skill or the Limits tab no longer pauses the page while the code is read.

