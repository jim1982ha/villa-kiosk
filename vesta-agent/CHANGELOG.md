## 0.12.354

What you will see:
- Every Telegram message (alerts, approvals, a doorbell's or a camera's photo, an answer with a button pressed): no
  empty line before "Status:" any more; it follows the text directly. A message already sent keeps its look until it
  next changes.
- The villa's own alerts (sent when the Agent is down) need the new layout file: copy custom_templates/
  vesta_message.jinja and packages/vesta_message.yaml to the villa, then reload custom templates.

## 0.12.353

What you will see:
- A device is reported offline only when none of its parts answers. A camera whose stream, Wi-Fi signal or noise
  sensor still reports is not offline because its event sensors (motion, person detection) wait for their next event
  ("Tapo Server Room has been offline for 5d 13h" while it worked). Such a card already open closes at the next
  check, saying the device answers.

## 0.12.352

What you will see:
- "Devices offline" messages, the daily report and the chat status say how long a device has REALLY been offline,
  read from the villa's history: a restart of the villa's system no longer starts the count again ("Timmerflotte_2623
  has been offline for 10h 2min" while it had been offline for days).
- An "integration (N devices) offline" line now appears only when those devices went offline together (within
  `integration_down_window_minutes`, 30min, a new setting of preventive-maintenance on the Limits tab). Three devices
  offline for three unrelated reasons are three separate lines, each with its own time ("matter integration (3
  devices)" last night, while the integration and its other devices worked).

## 0.12.351

What you will see:
- An alert card in another language shows only the translation. An AI reply with words around it ("Voici la
  traduction : …") is no longer printed on the card: the AI is asked again at once.
- The villa's own messages keep every device's name as written, like alert cards do ("House Pump" stays "House Pump"
  in French), and one translation serves every device.
- Overview › Scheduled jobs run: a job that ran keeps its own name after another job of the skill is deleted (it read
  the next job's name).
- Limits tab and Page changes: "Delete conversation context at" reads "After 12 hours of silence", never
  "after_8h_silence", in the save message, in "Changed from its usual" and in Page changes; a skill's change says its
  value before and after. A setting counted as a share (from 0 to 1) refuses a value above 1.

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

