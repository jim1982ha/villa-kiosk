## 0.12.410

What you will see:
- The reports say where each Done was given: "Done on Telegram (JM)", "Done on the tablet (JM)" or "Done in the
  Cockpit (JM)", never "Done (Closed in the Cockpit)".
- A press on the tablet's alert notice is noted as made on the tablet, not on Telegram.
- When a fault done on Telegram is still there afterwards, the Facility Manager reads "Done on Telegram on …, but
  still there", no longer "Closed in the Cockpit".
- A Done in the Cockpit (now work done, with the VESTA tablet app 2.496.617) is taken as the person's Done, re-checked
  as before, and counted once in Recent work.

## 0.12.409

What you will see:
- Need help pressed on a card in the tablet's Cockpit reaches the Owner on Telegram, exactly like the Telegram button
  (within the next 5min check).
- On a card with no alert (a night-check finding, a ticket someone opened), Need help gives the Owner an alert with
  Done and Need help: its Done on Telegram closes that finding or ticket, and Done in the Cockpit closes the alert.
- Telegram says "Done in the Cockpit on … (JM)" where it said "Closed in the Cockpit".

## 0.12.408

What you will see:
- VESTA's check every 5min still took 42.4s after the last update: each question it asked the villa's system opened
  a new connection first (three exchanges for one answer), and each battery's and each level's figures were asked
  for one device at a time. Now one connection serves the whole check, and those figures are asked for all devices
  at once.
- The Agent's log now says, after each skill's time, what it asked the villa's system for ("recheck.py took 6.1 s
  (12 ha_get_history, 3 ha_get_state)"), so a slow check shows why.

## 0.12.407

What you will see:
- VESTA's check of every open problem, every 5min, no longer re-reads each offline device's last week one device at a
  time: it took 41.9s, then 89.6s this afternoon, and should now take a few seconds. Everything else that reads a
  device's past (the night check, the reports, VESTA's answers) asks for all the devices at once, so it is faster too.
- Every alert VESTA follows now shows on the tablet as on Telegram, with its message and Done / Need help, even when
  the tablet missed it (its app restarting, or VESTA started while it was down): VESTA sends it again within a few
  minutes.
- A short spoken answer ("D'accord.") is said in the language you asked in, no longer by the English voice. With
  `languages: [en, fr]` in the villa-concierge skill's villa.voice.yaml, VESTA only ever tells your languages apart
  among those.

## 0.12.406

What you will see:
- A question to VESTA, spoken or typed, no longer waits about 40s on the check of the villa's status that comes before
  every answer while devices are offline: the check no longer reads back since when each one is offline, which its
  lines never said. "Turn on the gym light" took 48s; it should now take about 15s.

## 0.12.405

What you will see:
- A question spoken to VESTA is answered about 2s sooner: the check of the villa's status that comes before every answer
  now runs while Whisper writes out your words, not after.
- The VESTA Agent's log has one line per spoken question with each step's time, from your recording reaching VESTA to
  its voice being ready, and one line per AI run with how long the AI took to start and to reply.

## 0.12.404

What you will see:
- A short spoken answer in French ("J'ai éteint la lumière…") is said by the French voice, no longer by the English
  one. Its few common words were Spanish too, and VESTA fell back to English; French words like "j'ai" and the accents
  now decide. Short Spanish and Italian answers are told apart the same way.

## 0.12.403

What you will see:
- A spoken answer in French, German, Spanish, Italian, Dutch, Indonesian, Chinese or Korean is said in its own Piper
  voice with nothing to set up: the villa-concierge skill now comes with one voice for each. A villa.voice.yaml
  `voices:` line still chooses another voice for a language. Japanese has no Piper voice, so a Japanese answer stays
  in words and says so.

## 0.12.402

What you will see:
- Done or Need help pressed on the tablet and on Telegram at the same moment is handled once: the second press is told
  the alert is already handled, never carried out twice. A press on the tablet after one chat's copy was already
  settled is still carried out.
- An alert handed over during a restart is never taken in a second time, however long the catch-up looks back.
- A step sent to no one (an alert that went to the daily digest), when its card is redrawn in another chat's language,
  now reads "(to: digest)" as everywhere else, never "(to: nobody)".

## 0.12.401

What you will see:
- Nothing changes on screen. A spoken answer now keeps to its time limit as a whole (it could take about twice the
  setting), and each one leaves a record of whether it was spoken and why not.

## 0.12.400

What you will see:
- An alert the villa hands to VESTA while VESTA is restarting (an update) is no longer lost: when VESTA starts, it
  takes in every alert handed over while it was not listening, and the villa's plain message gets VESTA's numbered
  card and its buttons as any other.
- A new alert's card on the tablet tells its first steps at once ("Alert sent …"), not at the next check minutes later.
- A spoken answer whose language could not be told stays in words ("This answer could not be spoken."): never read by
  another language's voice.
- /investigate of a fan that shares its power reading with a light counts the fan's runs only while it ran alone, as
  the night check does.
- Rules › Device kinds: its (i) now says in full what the section is for: what VESTA does with each kind of device,
  why it matters, where the kind comes from, and how to correct it.

## 0.12.399

What you will see:
- Rules › Device kinds: a device's kind now comes from what the villa's system says it is made of (a light, a fan, a
  climate unit, a switch shown as one of them), in any language, before its name. Its parts show beside its name
  ("light + fan") and the row says "From the villa's system" instead of "Guessed". Your choices stay as they are.
- A wall switch with a light and a fan measured by one power reading: the night check now judges the fan by its own
  on and off (how long and how often it runs), and its running power only in the hours the light was off. The light
  counts in the energy figures only. The reports leave such a fan out of their running-power charts.
- A VMC is a fan: its name no longer makes it a light.

## 0.12.398

What you will see:
- A spoken answer in Chinese, Japanese, Korean or Indonesian is now recognised too, so it is said by the voice named
  for it in villa.voice.yaml (or stays in words and says why), never read by the English voice. Every language a
  person may be given on this page is now recognised.

## 0.12.397

What you will see:
- VESTA says each spoken answer in its own language: an answer in French is said by a French voice, never read by
  the English one. Name the voice for each extra language on this page: Skills › villa-concierge › villa.voice.yaml,
  for example `voices:` then `  fr: fr_FR-siwis-medium`. The voice assistant settings' own voice keeps saying their
  language.
- An answer in a language with no voice named stays in words and says "This answer could not be spoken in French:
  the villa has no French voice".

## 0.12.396

What you will see (with VESTA (dev2) 2.496.600):
- Ask VESTA by holding the microphone on the tablet: VESTA writes its answer, then says it aloud in the villa's own
  voice (the text-to-speech chosen in the villa's voice assistant settings). A typed question is answered in words
  only, as before.
- If the voice assistant settings name no text-to-speech, the answer stays in words and says "Spoken answers need the
  villa's voice to be installed."; if the voice fails, it says "This answer could not be spoken."

## 0.12.395

What you will see:
- "/whoami" on the facility manager's tablet ends "VESTA answers you as Facility Manager." (it said "fm"); the owner's
  says "Owner".
- When VESTA starts, an open alert's card on the tablet is drawn from the copy that tells the most steps, never from
  an older copy that listed one person's steps only.

## 0.12.394

What you will see (with VESTA (dev2) 2.496.598):
- On the tablet, "/help", "/status", "/whoami" or "/ask" alone are answered at once ("VESTA has no /help command.
  Write your question in your own words.", "You are Owner at the tablet; VESTA answers you as owner.", "Write your
  question after /ask."), instead of the dots for 10min then "No answer came". Telegram is unchanged: there, such a
  command may be meant for the villa's automations or another bot.
- An alert's card on the tablet lists every step, whoever it was sent to. Before, once VESTA chased the owner, the
  card kept the owner's line only and lost the facility manager's alert and reminder.
- An alert still open with no step since 28/10 (like #83) gets its full card on the tablet when VESTA starts: its
  "To:", "What to do" and Status, as on Telegram.
- Dates in VESTA's messages and on the tablet are now one format from one place: "24/10/2026 19:05".
- A VESTA Agent release copies the rules it shares with the tablet's app by itself (one release had waited a day on a
  copy made by hand).

## 0.12.393

What you will see (with VESTA (dev2) 2.496.597):
- A question spoken on the tablet (hold the VESTA button left of the robot) is written out by the villa's own Whisper,
  as a Telegram voice note is, and answered in the tablet's conversation. The words heard replace "Spoken question" on
  your line. This works with Telegram switched off too.
- When the words cannot be made out, VESTA says so in the conversation, as on Telegram.

## 0.12.392

What you will see (with VESTA (dev2) 2.496.595):
- VESTA follows the tablet's new "Maintenance mode" switch (Advanced Settings › System): while it is on, only urgent
  (P1) alerts are taken up. The hidden setting in the villa's system is no longer read.

## 0.12.391

What you will see (with VESTA (dev2) 2.496.594):
- Nothing new on screen: the shared rules copied from the tablet (every villa message reporting a problem is handed
  to VESTA).

## 0.12.390

What you will see (with VESTA (dev2) 2.496.593):
- Nothing new on screen: VESTA reads the tablet's updated agreement (a request answered or expired is listed under
  Closed on the tablet).

## 0.12.388

What you will see (with VESTA (dev2) 2.496.591):
- Nothing new on screen: VESTA stops sending a detail the tablet no longer reads (which of an alert's buttons closes
  it). The tablet shows an alert with an open ticket as one card with Done · Need help.

## 0.12.387

What you will see (with VESTA (dev2) 2.496.590):
- On the tablet, VESTA's bubble shows three moving dots while it answers or prepares something you asked for (a
  report), as on Telegram's "typing…".

## 0.12.386

What you will see (with VESTA (dev2) 2.496.588):
- On the tablet, an open issue's VESTA card shows Need help only: the issue's own Close does what Done does.

## 0.12.385

What you will see (needs VESTA (dev2) 2.496.587):
- VESTA's buttons work on the tablet as on Telegram: Approve / Refuse, Done / Need help on an alert, VESTA's offers and
  Continue. A press there does exactly what the same press does on Telegram, and every copy says who decided.
- With no Telegram chat that may approve it, a request no longer fails: it waits on the tablet as a notification with
  Approve / Refuse, for the owner or the facility manager signed in there, until it expires.
- An approval request reads more plainly, on Telegram too: "Turn on Indoor Top?", then "Asked by JM.", and "Waiting for
  the owner or the facility manager to approve: the buttons work for 15min from 29/10/2026 13:43."

## 0.12.384

What you will see:
- An action asked on the tablet that "the owner or the facility manager approves" (Allowed actions) now sends its
  Approve / Refuse request to the facility manager's Telegram chat too, not only to yours. The first press decides; the
  other copy then says who decided. One only the owner may approve still goes to you alone. A request asked in a
  Telegram chat is unchanged: it is shown in that chat.

## 0.12.383

What you will see:
- When you ask VESTA for an action on the tablet and the Approve / Refuse request goes to Telegram, VESTA's answer on the
  tablet now changes in place once it is decided: under "I've asked…", a Status line says "Approved on 29/10/2026 13:17
  (JM). Turned on Indoor Top." (or refused, expired, not done). One message, no second one.
- The same on Telegram when a facility manager asks for an action only the owner may approve: their chat's answer says
  what became of it.

## 0.12.382

What you will see:
- On the tablet, the owner and the facility manager are recognised as themselves when VESTA acts: an action your Rules
  let VESTA do at once when you ask is done at once from the tablet too, as from your Telegram chat, instead of
  becoming an Approve / Refuse request on Telegram. A guest still gets answers only.
- Nothing else changes on Telegram: VESTA's buttons and messages work as before (the way they are handled inside VESTA
  was reorganised, ready for the tablet's buttons).

## 0.12.381

What you will see:
- VESTA's log names a question asked on the tablet as the tablet's, no longer as a Telegram message.

## 0.12.380

What you will see (needs VESTA (dev2) 2.496.582 or later):
- Questions typed in Cockpit › Messages › VESTA on the tablet are answered there, by the profile signed in: the owner
  and the facility manager with their usual rights, a guest with answers only (VESTA takes no action and asks for no
  approval for a guest). Each profile is its own conversation, apart from every Telegram chat.
- /investigate, /proposal and /new work there as on Telegram; an answer carries the camera pictures VESTA looked at and
  the page it made; a report's "being prepared" line is replaced by the report.
- An action asked for on the tablet is sent for approval to the owner's Telegram chats, as today.

## 0.12.379

What you will see:
- A problem VESTA still has open gets its record on the tablet again when the tablet app does not hold it (VESTA was
  moved to another tablet app, or its records were reset): Timmerflotte_2623, LED Strip, #83 and #88 come back under
  Messages › Issues with their Open Ticket and Close buttons, shortly after VESTA starts.

## 0.12.378

What you will see (architecture review, 29 October 2026):
- When Telegram refuses one person's copy of an alert, the tablet still shows ONE card for it, naming everyone it was
  for, in place of the villa's own message.
- A message the tablet app refused once (while it restarted) reaches it at VESTA's next try.

## 0.12.377

What you will see:
- VESTA's reports (the morning digest, the weekly and monthly reports, the owner's weekly lines, the night check's
  message) reach the wall tablet's new Messages › Reports, each with its page when it has one. Telegram is unchanged.
- A report sent in two languages is one line on the tablet, in English when there is an English version.
- Needs the VESTA Kiosk 2.496.579 or later for the Reports filter.

## 0.12.376

What you will see:
- A ticket closed as a second copy of an alert's fault, and the investigation report's alert lines, name the alert
  "#91-P2" too.
- Nothing else changes: from the review of tickets 26-27, a priority is checked against one list shared with the
  tablet, an alert's name is read one way everywhere (Telegram's heading included), and a card's "To:" and its list of
  the villa's messages it stands for are trimmed like every other part.

## 0.12.375

What you will see:
- Every message, report and notice names an alert as Telegram's title does, "#91-P2": the morning digest's "Still
  open", the assistant's "Open alerts", the night check's "Followed by alert #41-P2", and the short line left on an
  older Telegram message ("#91-P2 · see the newer message below").

## 0.12.374

What you will see:
- On the tablet (VESTA (dev2) 2.496.574 or later), an alert's ticket, its open issue and its Watch line are named as on
  Telegram: "#91-P2 · …". A ticket made before gets its priority within 5min; when an alert's priority changes, its
  ticket follows.

## 0.12.373

What you will see:
- On the tablet (VESTA (dev2) 2.496.573 or later), a card's "To:" reads exactly as on Telegram. Nothing else changes:
  VESTA now names each card and finishes each copy for the tablet through one shared piece each.

## 0.12.372

What you will see:
- On the tablet (VESTA (dev2) 2.496.569 or later), an alert VESTA took over is one card in Messages, in place of the
  villa's own message of it: also when the villa repeats the alert, or when Telegram refused the villa's message.

## 0.12.371

What you will see:
- Nothing yet on screen. The tablet's add-on now also receives the message VESTA sends when a report you asked for was
  cut by a restart ("could not be prepared"), as it does for the morning digest and for an alert a person reopened in the
  Cockpit (both already did; they are now checked by a test). A question VESTA could not answer after a restart stays
  in the conversation only.

## 0.12.370

What you will see:
- Nothing yet on screen. Every message VESTA writes on Telegram (an alert it took over, its reminders and escalations, a
  camera snapshot, an approval request, the night check, the morning digest, its notes to you) is now also handed to the
  tablet's add-on as it stands, and replaced there when VESTA rewrites it. The Messages list shows them in the next
  tablet release (it needs the tablet's add-on at 2.496.568 or later; an older one simply keeps none).
- Telegram is not slowed by it: the copy for the tablet goes in the background, and a tablet that is down or slow loses
  only that copy.

## 0.12.369

What you will see:
- Nothing changes on screen. VESTA now reads its alert icons (⚠️, ⚠️ ⚙️, ✅) from the list it shares with the tablet,
  so the tablet always reads a cleared alarm as cleared.

## 0.12.368

What you will see:
- A ticket on the tablet now tells its alert's whole short story, as Telegram's "Status:" does: the alert sent and to
  whom, each reminder, an escalation, a button pressed, a note sent when it closed. Until now it started at the first
  reminder, and only what came after the ticket was made.
- A button pressed on Telegram says so on the tablet: "🆘 Need help on Telegram", with who pressed it.
- A ticket taken on in the Cockpit is not told twice: the tablet says it already ("in progress since … by …").

## 0.12.367

What you will see:
- A new card on the Rules tab, "Device kinds": every device the agent reads power or energy for, with what the agent
  thinks it is (Motor, Appliance, Lighting or Meter) and a drop-down to change it. Each row says "Guessed" or
  "Chosen here"; "Back to the guess" undoes a choice. A change is saved at once, listed in Overview › Page changes
  (with Undo), and counts from the next night check and report: a Motor gets the running checks at night, Lighting and
  Meters are only counted in the energy figures. 10 devices a page, with a search box.
- The kinds you had typed into the villa's helper "vesta_asset_kinds" are moved to this card when the agent starts
  after the update, once (Page changes says how many). The helper is no longer read: you can delete it.

## 0.12.366

What you will see:
- An alert has one name everywhere: the Cockpit's fault, the morning message ("Still open", "Also noted"), the weekly
  page's to-do list and the chat's villa status all show its first line, without the 🚨 or the rule code, with how often it came
  back: "Pool pump stopped (again: 3 times in 7 days)". Before, the Cockpit and the to-do list lost the "again"
  count, and the morning message showed the alert's three lines with the emoji, cut through the count on a long one.
- On the Limits tab, the eight lengths that cut a problem's name are one row, "problems.title_chars". If one of the
  old rows had been changed, the tab says so at the top and names the new row to set.
- One list of the kinds of device watched for going offline, for the night check, the reports and the chat: power,
  energy, security, levels, running hours, water, generation, batteries and network devices (routers, access
  points). A router or a battery device that goes offline now gets its offline fault and night-check message like any
  other device, and a water meter or solar inverter offline is now in the weekly report's offline table and in the
  chat's answer. The list is one row on the Limits tab, "offline.watched_kinds".
- On the Rules tab, "Approve buttons work for" and "Siren stops after" accept the same numbers as their Limits rows
  (1 to 1440 and 1 to 60 minutes), read from the one place the agent checks them.

## 0.12.365

What you will see:
- Asking VESTA how long a pump ran (a chat question, or "Investigate") now counts its running hours by the same rule as
  the night check, the weekly report and the energy pages, including the pump's own baseline setting. The same pump
  on the same day no longer gets two different answers.
- A device that still answers through another of its sensors (a door's Wi-Fi signal while its lock reads
  "unavailable") no longer has an offline fault opened and closed again every 5 minutes: it is not offline, at night
  or in between.
- Batteries and offline faults read exactly as before: their levels, steps and closing sentences are unchanged.

## 0.12.364

What you will see:
- An alert card in a chat set to another language now says what was done in the Cockpit in that language too:
  "Ticket ouvert dans le Cockpit le 27/10/2026 10:20 (Luc).", "Clôturé dans le Cockpit le …", "Rouvert dans le
  Cockpit le … Merci de vérifier à nouveau.". These lines came in English before. English chats read as before.
- The same holds for what follows a close in the Cockpit ("… but still there", "confirmed") and for the line kept in
  the card's history once a ticket is opened.
- Night-check messages stay in English for every chat, as the rest of those messages are.

## 0.12.363

What you will see:
- A night-check message (a critical device offline, a battery at 10%) now tells its story in a Status section, as an
  alert card does: "✅ Back to normal at 14:05, watched until 02:00", then "⚠️ Still there after the close at 14:45"
  or "⚠️ Reopened in the Cockpit at 14:50 by Owner", then "✅ Closed at 02:00: it did not come back". Each new line
  strikes the one before it, so only where the problem stands now reads plain. A message about several problems names
  each one at the start of its lines, and strikes each problem's earlier lines only.
- No separate "Fault still there after the close" or "Fault reopened in the Cockpit" message any more for a problem a
  night-check message told: that message is updated instead. A problem no message told (a minor one) still gets its
  own message, as it is the only word of it.

## 0.12.362

What you will see:
- A device that goes offline and is then taken up by one of the villa's own alerts no longer shows twice in the
  Cockpit's Open issues until 02:00: within 5 minutes its fault closes as "Followed by alert #41, which says when it is
  back.", and its Telegram message says the same.
- A night-check message (a critical device offline, a battery at 10%) no longer says a bare "Back to normal" while the
  Cockpit still watches the problem: it says "✅ Back to normal at 14:05, watched until 02:00". At that night check the
  same line becomes "✅ Closed at 02:00: it did not come back", or "⚠️ Back again at 02:00".
- When such a problem is still there after a close, or is reopened in the Cockpit, you still get the message that asks
  to look again, and the first message is updated too ("⚠️ Still there after the close at 14:45"), so it never still
  says "Back to normal".
- These words are in the maintenance skill's settings, as before.

## 0.12.361

What you will see:
- After a restart of the villa's system, a sensor that had already gone silent is reported at once, with how long it
  has really been silent ("has not reported for 3d …"), not a day later. Its open problem no longer shows "Cleared"
  after a restart and comes back the next day. Another reading of the same device, refreshed only by the restart, no
  longer counts as the device still reporting.
- When the villa comes back online, its "no contact" alert closes without a watch: a new outage is a new alert, and
  the old one is never told "it did not come back".
- A closed alert's watch is one length everywhere: Telegram's "Watch …", the Cockpit's "VESTA confirms by …" and the
  "(watch)" title. With the reopen window set to 0, an alert the villa clears is watched nowhere; after a Done that
  VESTA checks again, it is watched until that check.

## 0.12.360

What you will see:
- A restart of the villa's system is no longer taken for the moment a door was unlocked or a sensor last reported:
  - the reports and the chat say "unlocked since Saturday 18:25", not the restart's "Sunday 13:29";
  - "has not reported for 3d …" counts from the sensor's last real reading, not from the restart.

## 0.12.359

What you will see:
- A device offline since before the villa's history the Agent reads says "offline for over 7d 22h", never "7d 22h"
  counted from the start of that read (Timmerflotte_2623 is offline since 17 Oct or earlier). How far back it reads
  is a setting on the Limits page (7 days).

## 0.12.358

What you will see:
- A pump's or a meter's use is compared with earlier days in the same state: days with guests with days with guests,
  an empty villa with empty days. Guests arriving is no longer a fault ("House Pump used 2.73 kWh/day … against a
  normal 0.14", a quiet month); a fault says which normal it used ("… against a normal 0.14 kWh/day when the villa is
  empty"). Until there are a few such days, only what guests cannot explain is said: using less while occupied, more
  while empty (a leak in an empty villa). The energy report's "versus its usual level" follows the same rule.
- Without the villa's "empty" helper, or on a day it did not report, everything is compared as before.

## 0.12.357

What you will see:
- Telegram: once an alert's watch is over, its Status lines are struck through too, all but the last ("✅ Closed on
  …: it did not come back within 1h."), which stays as it is.

## 0.12.356

What you will see:
- Telegram: an alert that clears is titled "(watch)" while it can still come back as the same alert (its "Watch 1h").
  When the watch ends, every copy is updated once more: the "Cleared on … Watch 1h." line moves up into the Status,
  a last line says "✅ Closed on 25/10/2026 19:54: it did not come back within 1h.", the title reads "(closed)" and the
  alert's text is struck through. The time is the moment the watch ended, the time its Cockpit card said "VESTA
  confirms by", when the card leaves the Watched list.
- An alert closed earlier today whose watch already ended gets its last update at the Agent's next look.

## 0.12.355

What you will see:
- Cockpit: every closed fault stays as "being confirmed" while VESTA still watches it, not only one a person closed.
  An alert that clears by itself is watched for its "Watch 1h" (the time a return reopens it under the same number);
  a night-check fault until the next night check. Shown by VESTA Kiosk 2.496.534.

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

