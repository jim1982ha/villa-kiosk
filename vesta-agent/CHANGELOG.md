## 0.12.505

- **An alert's "To:" now says who that copy was sent to**, in each chat. The facility manager's still-there reads
  "To: FM"; the owner's escalation copy reads **"To: Owner (escalation)"**, so the owner sees why they got a P2.
  Before, every copy said everyone the alert had reached so far ("To: Owner & FM" even in the facility manager's chat,
  after an escalation the day before). The Status lines still say who got each step.
- The tablet's card, which is everyone's, names everyone the alert went to, with the same note: "To: Owner
  (escalation) & FM".

## 0.12.504

- **A "has not run" alert is held while nobody was there to use the device.** Every night VESTA learns, hour by hour,
  which devices run only when people are in (a house pump drawing water, a jacuzzi pump), from their own runs and the
  villa's "Villa empty" sensor. Nothing to set: a device that also runs while the villa is empty (a fridge, a pool pump
  on its timer, a pump that must turn anyway) is never held.
- For such a device, its "has not run" alert gets its number as usual, but nobody is asked: its card says why, for
  example "Expected: Pump runs only when people are in, and nobody has been in since Wed 11/11/2026 20:11. It becomes an
  alert after 6h with people in and still no run." On the tablet it is on **Watch** (VESTA Kiosk 2.496.782 or later).
  Once people have been in that long and it still has not run, the facility manager is asked as for any alert
  ("Still no run once people had been in for 6h"). It closes on its own when the device runs.
- The night check no longer reports such a device as "ran shorter than expected" or "did not run" on a day the villa
  was empty, and the daily report lists a held alert under "Also noted (no action needed yet)", not "Still open".

## 0.12.502

- **Knowledge › Devices replaces the two tabs "Device kinds" and "Device links".** One list, one line per device:
  what it is (its kind), whether the night check compares its running hours with a schedule ("Checked" or "Not
  checked"), and when not, why, in plain words. A switch above the list shows All, Checked or Not checked.
- A device's **Edit** opens its kind and its three links (Schedule, Normal power, Run hours) under its line, each a
  list to pick from, saved at once as before.
- Why a device is not checked is said plainly, on the page and in the night's notes. For example, the Onsen pump:
  "Its schedule, Onsen Pump Expected Runtime, is used only by the automation onsen_pump_daily_schedule, switched off."
- **The (i) texts on the Agent's page are 50% wider**, use the screen's full height when they need it, and stay open
  while the pointer is on them, so a long one can be read to the end.

## 0.12.501

- On the Agent's page, everything that does the same job now looks the same on every tab, because each is drawn by
  one piece: the buttons, the pills, the switches, the notes at the top of a tab, the headings inside a box, the
  tables and the words of an empty list. A change to one of them now shows everywhere at once.
- The notes at the top of a tab have one look: amber when something is worth a look ("AI jobs are not set", "The
  agent uses this skill without…", "another version of this skill"), red only when something is refused or broken.
  "The agent uses this skill without…" was red although the skill still works.
- What is locked or simply off is grey, never red: the tools that are "Never available", a tool a skill works
  without. Red stays for what needs attention (a device that is gone, a skill not working).
- Every table has the same lines between its rows and the same headings; the rows of "Allowed actions" are a little
  taller for it.
- "Acting on the villa": its switch is at the right of its title, where every other box keeps its control.
- A small pill is one size everywhere (Knowledge, Limits, Skills, Rules): some were stretched to their row's height,
  some were smaller. A tool's use reads "used 12× in the last 7 days".
- Overview › Import a setup: one button of the page's own, "Choose the setup file", in place of the browser's grey
  "Choose file… No file chosen".
- The Limits tab's lists of words are switches, like every other on/off of the page.
- Nothing else changes: no tab, no setting and no wording of a message moved.

## 0.12.500

- Every date on the Agent's page is in the villa's time and written as the messages write it ("10/11/2026 09:01").
  The page used the time of the device it was read on: read from another country, a run showed an hour that was not
  the villa's.
- The page comes back where it was. A reload, or the address sent to someone, opens the same tab, the same sub-tab
  (in Costs, Rules, Knowledge, Limits or a skill), the same skill and its file, the same Costs period. It always
  reopened on the tab's first view. Back from the Limits tab returns to the skill, the file and the place in the
  page it was opened from.
- On a phone, the Limits tab reads from the left: what a limit is, then its value, then who is told. The sentence
  was pushed to the right edge under a label.
- A limit that tells nobody shows "Nobody is told" in grey. It was red, the colour of something that needs attention.
- The Costs tab's figures are never cut in two ("US$ 10.68" stays on one line); on a phone they stand two a row.
- A scheduled job's time is picked, not typed: how often (each day, each week, each month, each hour), the day,
  then the hour and the minutes. A job the VESTA UI's "Next check" follows runs every day, so it offers its hour
  only.
- A skill's "(file)" beside its tab answers a press over the tab's whole height: it was a few letters wide and easy
  to miss on a phone.
- The page says "VESTA UI" wherever it said "VESTA Kiosk" (the Limits tab's sentences, Knowledge › Asleep devices,
  the set-up page).

## 0.12.499

- On the Agent's page, a list that is not in time's order turns its pages with "‹ Previous" and "Next ›": the Limits
  tab, a skill's "When it runs", and the Costs tab's tables by job, by model and by tool. They said "‹ Newer" and
  "Older ›", which is true only of the lists that are newest first (the scheduled jobs, the changes, every AI run):
  those keep their words.
- The Costs tab's chart is drawn again when the screen changes width (a phone turned, a window resized). It kept
  its first drawing, squeezed or stretched, its letters smaller or larger than the page's.

## 0.12.498

- The version beside "VESTA AGENT" at the top of the Agent's page shows on every tab. It was empty when the page
  opened or was reloaded on a tab other than Overview.
- Every date on the Agent's page is written the same way, without seconds. Overview's "Ran at" column and the
  Rules tab's "read …" line for the villa's tools still showed the seconds.
- Nothing else changes in what the page shows. Its repeated pieces (a save and its answer, a search box, a card of
  tabs, the light and dark colours) are now written once, and code that nothing used is removed.

## 0.12.497

- A problem that comes back on the same day is told as back. A critical device offline a second time in one day
  sends "Back again: … (2nd time in 7 days)" at once, and its fault in the VESTA UI opens again with its count.
  Before, only a return on a later day was told: the same day stayed silent until the night check.
- A night-check or devices-offline message whose problem comes back now says so itself: "Back at 21/10/2026 02:00",
  its "Cleared" line struck, its title no longer "All back to normal." The "Back again" message that follows says
  each thing once: no "Back at …" line added every night while the problem is simply still there, no "Closed on …:
  it did not come back." repeated night after night.
- Messages this had left on "Cleared …: watched until 02:00." although their problem came back are corrected at the
  next check (within 5min of the update).

## 0.12.496

- In chats that read another language, a Status no longer carries an English weekday: "Toujours là: 4 fois depuis
  06/11/2026 18:20" where it read "depuis Fri 06/11/2026 18:20" (the same for "Villa silent since"). English keeps
  "since Fri 06/11/2026 18:20".
- The weekly page's alert tile reads "7 alerts: 2 critical, 1 still open", as the Monday message does. It read
  "7 critical alerts", which called every alert of the week critical.

## 0.12.495

- Nothing changes in what you see. Each night-check rule is now described in one place, and a visit's steps (the
  villa told, its photos, the siren's snapshots) run in one place: a fix there is made once.

## 0.12.494

- A visit's "+N more photos in the VESTA UI" line counts the cameras the siren snapped too: before, the photos those
  snapshots pushed off the Telegram picture were never mentioned. A card redrawn after the siren's question keeps
  its "Siren offered" line.

## 0.12.493

- In chats that read another language, a message's Status lines are in italics and an older line is struck, as in
  English chats.

## 0.12.492

- A doorbell message that is over (the gate opened, or nobody answered) has its text struck, like a closed
  alert, in every chat's language: what still waits for you stands out.

## 0.12.491

- Nothing changes in what you see; releases check more before they go out, so a broken update is caught before it
  reaches the store instead of 40min later.

## 0.12.490

- Nothing changes in what you see; reminders and escalations are simpler inside: one place decides when an alert's
  reminder or escalation is due (the villa's own reminder counts as the one reminder), and each step of a visit is
  confirmed to the villa at once, then its messages told, always in that order.

## 0.12.489

- Nothing changes in what you see; the alerts are simpler inside: whether a step rings is decided in one place, the
  siren question only ever goes on the alert itself (an Owner chat that missed the alert gets it, with the question
  on it), and the photo sheet of a visit is made in one place, so every copy shows the same picture.

## 0.12.488

- When someone presses Need help, the message forwarded to the Owner rings again, so a request for help is never missed.

## 0.12.487

Fewer notifications for one alert (needs VESTA (dev2) 2.496.757 or later for the pop-ups):
- The siren question is on the alert itself: the Owner's copy of a visit's card gets "🚨 Sound siren" and "No siren"
  on their own row, and its Status says "Siren offered to the Owner 08:47: waiting for your answer". No separate
  "Approval request" message any more, on Telegram or in the VESTA UI. Only the Owner's own press sounds the siren;
  unanswered, refused or expired, nothing is done and the buttons go. The facility manager's copy never has them.
- One reminder per alert, and only once the alert has gone quiet: while a visit keeps getting new steps, the "No
  answer after 15min" reminder waits until 15min pass with no new step.
- A message rings only for the first alert, its return, a stronger step (a door or a lock opened), the siren question
  and the one reminder. Everything else (an escalation, a repeat, an answer, a close) quietly updates the card you
  already have, keeping its pictures; the VESTA UI pops up only for the same steps.
- A visit's card sent again (the reminder) keeps its photos instead of becoming a text message.
- Each step of a visit is acknowledged to the villa at once, so the villa no longer takes the visit back and posts its
  own extra message while VESTA is still updating the cards.
- "+3 more photos in the VESTA UI" on Telegram (it said "on the tablet"); the line is no longer shown in the VESTA UI
  itself, which shows every photo. Every other text that said "the tablet" now says "the VESTA UI".

## 0.12.486

- A visit's card on the tablet now shows the camera pictures VESTA took when it offered the siren, the same photos as
  its Telegram picture (needs VESTA (dev2) 2.496.756 or later on the tablet).

## 0.12.485

- Nothing changes in what VESTA does; fewer checks before each release.

## 0.12.484

- A maintenance fault judged on a whole day (a pump's daily energy or run time, a tank's highest level) no longer says
  "next check within 5min" on the tablet: its verdict can only change once the next day has finished, so its card now
  says the nightly check's time ("next check 02:00").

## 0.12.483

- Nothing changes in what VESTA does; releases are simpler and faster.

## 0.12.482

- A visit's photos are put in one order everywhere VESTA shows them: the strongest step's photo first (the large one
  on the Telegram picture), then the others oldest first. "📷 All photos" now starts with that photo too.

## 0.12.481

- Every Telegram copy of an alert now shows the same Status, in its chat's language: the owner's group, joined at an
  escalation, no longer shows only its own steps, and "(to: …)" says who was told each time.
- Every copy is updated at every change of the alert (a reminder, a return, a close, a press), whichever chat the step
  was sent to. Before, the owner's group could still read "Cleared … Watch 1h" on an alert that had come back and been
  closed since.
- The tablet's short story of an alert says the same lines as Telegram ("Reminder sent (to: FM)", "Back, 2nd time in 7
  days (to: FM)"), each with its own time beside it.
- A press in the Status says where it was made: "🆘 Need help on Telegram at 11:18 (Wayan)".

## 0.12.480

- Nothing changes on screen. Whether a visit is still open or already over, since when and why, is now worked out in
  one place, the same way when a signal arrives, when VESTA restarts and at the regular check, so a visit the villa
  closed while VESTA was off can only appear once, as a closed card.

## 0.12.479

- A visit's Telegram card with two photos or more has a "📷 All photos" button on its own row: it sends every photo of
  the visit, whole, oldest first, each named with its camera and time ("Parking · 11:57"), as a reply to that card in
  that chat only, in albums of up to 10. Pressing it again later sends the photos as they are then.
- The card's picture now holds up to 9 photos, and no photo is cut any more: the camera's own date, time and name stay
  visible, with dark bands beside a photo of another shape.
- On the tablet, a card's state line is now short ("Reminder sent 11:43"); the rest of what was said ("No answer after
  15min. Seen at … Was this visit expected? (to: Owner & FM)") is a Status line just above it. Telegram is unchanged.
- "+N more photos on the tablet" is always the last Status line, just above the state.

## 0.12.478

- Every visit's Status now says when its alert was sent ("Alert sent 11:24 (to: Owner & FM)"), from its first message,
  even when nothing stronger came after the first signal.
- When someone is seen inside the same room again, its line now spans both moments ("Someone is inside (Living Room)
  at 11:24–11:28"), like the cameras' lines; a sound or a person seen again in the same room too.
- Updates are prepared faster: a change to the shared test setup no longer re-runs all 2,000 tests on the developer's
  computer; the store's build still runs them all.

## 0.12.477

- At each step of a visit, the tablet's card now changes its name and its "monitoring until" together with its words,
  instead of about 15 seconds after Telegram.
- Cleaned up after the presence automation's switch to visits: VESTA no longer keeps the old way of handling presence
  alerts one by one (its separate "Camera snapshot" messages before the siren question, its own siren count across
  alerts, its "repeat counted" timer for presence). Nothing changes for the other alerts. The siren question of a visit
  is unchanged: a reply to the visit's card, its pictures in the visit's photo sheet, only the owner can approve.

## 0.12.476

- A visit the villa had already closed while VESTA was stopped is no longer shown open on the tablet for about 20
  seconds when VESTA starts again: its card and its fault arrive closed at once, with no "(new)" pop-up.
- A visit answered on the tablet while VESTA was stopped now says where, like every other press: "Done in the Cockpit
  at 09:43 (Owner)" (or "on Telegram"), in every language.
- At each step of a visit the tablet's card (its name, pill and lines) now follows Telegram's message within about a
  second, instead of 10 to 12 seconds later.

## 0.12.475

- A visit someone closed on the villa's own Telegram message (Done) while VESTA was stopped is now closed in VESTA too
  as soon as VESTA starts again: one closed alert, "Done at 08:53 (Jm)", no new alert popping up on the tablet and
  nothing sent on Telegram. Alert #140 from this morning's drill closes by itself within 5 minutes of the update.
- The tablet's card no longer says "monitoring until" twice: its state line reads "New alert", the time stays on its
  pill. Telegram still reads "New alert, monitoring until 08:47".
- The villa's own line for a button pressed while VESTA is away says the time only, like VESTA: "Done on Telegram at
  08:53 (Jm)" (needs the updated visit package and a one-word change in the presence automation).

## 0.12.474

- Nothing changes in what VESTA does. Updates are prepared faster: the step that proved each test could fail is gone,
  and the shared rulebook is cut to your product decisions and the facts about the villa.

## 0.12.473

- A visit the villa ended while VESTA was stopped is recorded by VESTA when it starts again as one closed alert, with
  its story and the villa's own close time ("Cleared at 07:16"): VESTA no longer reopens it, sends or edits nothing on
  Telegram (the villa's messages stay as they are) and no longer rewrites the villa's record of it. The tablet shows
  it as one closed card, with the visit's photos.
- The tablet's card of an alert, when it shows the short story, now has every line Telegram has: "Alert sent (to: …)"
  and, on the step that sent it again, ": alert sent again (to: …)".

## 0.12.472

- A visit closed on the tablet (Done, Not a problem, or any other answer) goes straight to Closed, as one the villa
  closes; it no longer waits on the Watch list with no state.
- A fault about an automation watching a device that no longer answers reads the same whether that device is hidden
  or not: "The automation 'Server room person' watches 1 device that no longer answers: …".
- While a visit is open, its last line on Telegram reads "⚠️ New alert, monitoring until 06:40" (the time moves later
  at each new sign), in every language; the tablet's card says "monitoring until 06:40" beside its state.
- A lock opened by hand during a visit reads "Test lock opened at the lock, 06:35".

## 0.12.471

- Every alert's Status, on Telegram and on the tablet, gives each line its time alone when it happened on the alert's
  own day ("Alert sent 05:14, 8th time in 7 days (to: Owner & FM)", "Cleared at 05:23: …"), and the day without the
  year for a line of another day ("Reminder sent 08/11 09:20 (to: FM)"). Alerts already open read the same way at
  their next update.
- A visit's alert sent again for a stronger step is said on that step's own line: "Test door opened, 05:14: alert
  sent again (to: Owner & FM)", in every language; there is no separate "Stronger signal sent" line any more.
- A visit's motion line now ends at the detection that opened the visit: "Seen at Test motion, 05:13–05:14".
- On the tablet, a visit's card takes the name of its strongest step (for example "Test lock") while its words change,
  no longer only at the next step.

## 0.12.470

- Nothing changes in VESTA. Updates reach the store faster: fewer checks are repeated on the developer's computer
  before an update is sent, and the store's build still runs every check before it offers the update.

## 0.12.469

- When VESTA closes an alert (a visit drill that ended, a door locked again), the tablet's card now goes to Closed as
  soon as the closed message arrives. Before, for about ten seconds, the card stayed under Open issues saying
  "Cleared on …" with its Done and Open Ticket buttons.
- A visit VESTA takes over after a restart now shows, on the tablet's card, the time the villa first sent it (the time
  of "Alert sent" on Telegram), not the time VESTA took it over.

## 0.12.468

- A visit's photo sheet on Telegram is now wide instead of tall, each photo with its camera and time written on it:
  Telegram no longer cuts off the names of the last row. It shows at most 6 photos (the setting's highest value is
  now 6); the tablet's card still shows every one.

## 0.12.467

After the visit drill of 7 November (#132):
- When VESTA comes back during a visit the villa was handling alone, it no longer sends the alert again for a step
  the villa already announced: it takes over the villa's message silently. A step that comes after VESTA has taken
  the visit over still rings when it is stronger.

## 0.12.466

After the first visit drills on the villa (6 November, #127 to #129):
- Every step of a visit is told to the villa as taken, a lock locked again too: the villa no longer takes the visit
  back a minute later and writes its own words over VESTA's card.
- VESTA back after a restart takes over the villa's own card in place (number, photo sheet, story, buttons) and
  removes the villa's reply messages under it: one message per chat. It no longer rings the door a second time when
  the villa already did.
- A card someone deleted in a chat is sent again once, never pointed at; the close no longer posts a new message: the
  card itself says "Cleared on …", its photo sheet kept.
- The Status is in time order, and "Alert sent" says when the villa sent the alert, not when VESTA took it over.
- A lock opened from the app by no known person says "opened from the app", never "(?)".
- "Stronger signal sent" is a line of the Status; the card's state stays "New alert" (on Telegram and the tablet).
- The tablet: each step's notification is taken by the visit's card (no second notification), the card is named after
  the strongest step's device (the lock, the door), and a closed visit goes straight to Closed (with VESTA (dev2)
  2.496.733 or later).

## 0.12.465

Prepares the villa's side of "one visit, one story"; nothing changes until the presence automation is updated
(announced before it is saved):
- The reminder delay is one value: when the villa has its "VESTA reminder after" setting, the VESTA Agent page shows
  it in Limits › Skill settings (alert-desk, "reask minutes") and saving it there changes the villa's setting.
- A press on the villa's own buttons of a visit is answered by the villa only: no more "Unknown button." beside it.
- A room's sound (the server and storage rooms) adds "Sound heard in the Server Room at 18:40" to a visit already
  open; on its own it never raises an alert, and it never counts toward offering the siren.
- A test visit (a drill) is marked "TEST" and never offers the siren.

## 0.12.464

What you will see, once the villa's presence automation sends a visit step by step (its next update, announced
before it is saved); until then nothing changes:
- One visit is ONE alert with one number and one message per chat, updated as it goes: "Seen at Parking → Entrance
  Left → Waterwall Buddha → Main House Door, 18:34–18:35", "Outdoor entrance Lock opened at the lock (not from the
  app), 18:35, locked again 18:36", "Someone is inside (Living Room) at 18:36", "Person seen in the Server Room at
  18:40", and "Same time as the last 4 evenings (18:18–18:33)" when it came at about this time on 3 days of the week.
  No "Still-there" lines and no "Cleared" in the middle.
- Its picture is one sheet of every camera of the visit, labelled with the camera and the time, replaced in place.
- A stronger step (a lock or a door after a camera) sends the message again, so the phone rings.
- A reminder says what changed: "No answer after 15min. Someone went inside at 18:36. Was this visit expected?"
- The siren question is a reply to the visit's message in the owner's chat, with no separate camera photos; the
  Status says "Siren offered to the Owner 18:35", then how it ended. It still needs the owner's Approve.
- The visit ends once: "Cleared on …: no further signal for 30min.", or "Expected: Jim came home at 18:40." when a
  resident comes home (the siren question is then withdrawn).
- Also fixed now: an alert's message no longer gets lost when its reminder replaced it and the all-clear came after;
  an alert that comes back counts its own alerts from its return.
- The update asks for one new access: reading the villa's media folder (read only), where the camera photos are.

## 0.12.463

What you will see:
- An alert that comes again several times in a row shows ONE line in its Status, with its count and its latest time,
  on Telegram and on the tablet's card: "Still-there alert sent 06/11/2026 18:35, 3 times (to: Owner & FM)", never
  the same line three times. The ticket's story in the Cockpit shows it once too. Alerts open now read this way as
  soon as the app has restarted with this update.
- "Still there: N times since …" counts the alerts that came: 5 alerts say 5 times. It said one more.

## 0.12.462

What you will see:
- Open Ticket pressed on Telegram is said as such in every chat: "Ticket opened on Telegram on 05/11/2026 16:28
  (Wayan)." in each chat's language. It said "Ticket opened in the Cockpit". Open Ticket on the tablet still says "in
  the Cockpit".

## 0.12.461

What you will see:
- An alert's buttons on Telegram are in the tablet's order: Done · Not a problem · Open Ticket · Need help. Open Ticket
  is new on Telegram, its label in each chat's language ("Ouvrir un ticket", "Buka tiket" …).
- Open Ticket pressed on Telegram does what the tablet's Open Ticket does: the alert's fault becomes a ticket in
  progress in the Cockpit ("Opened by" the person who pressed), its reminders stop, and every chat's Status says
  "Ticket opened in the Cockpit on … (name)". The message keeps Done and Need help; Not a problem and Open Ticket go.
  An alert taken on in the Cockpit now keeps Done and Need help on Telegram too.
- If the VESTA Kiosk cannot be reached, the message says "The VESTA Kiosk cannot be reached: open the ticket on the
  tablet." and keeps its buttons; nothing else changes.

## 0.12.460

What you will see:
- Every date VESTA writes is in the app's one format, "04/11/2026 08:56" (a day alone "04/11/2026"), never "4 Nov,
  08:56": in Telegram messages and their status lines, in the tablet's notifications and reports, and on the reports'
  and investigations' pages (a report's dates, "Generated", a chart's points, an investigation's log). Messages already
  sent keep their words.

## 0.12.459

What you will see:
- An alert reopened in the Cockpit is told in every chat that read its close. The owner's group kept "Done on …
  Watch 4h." under "(existing)", reading as ended an alert that was open again, while only the facility manager's
  chat said "Reopen request sent …"; that line is now under the Done in the owner's group too.

## 0.12.458

What you will see:
- A fault closed after it was fixed is no longer reopened by readings from before the fix. A device that kept dropping
  and reconnecting, fixed and pressed Done, was "Fault still there after the close" at the next 5-minute check (the
  3 days counted still held the old drops), and again at every check for 3 days; it now reopens only if it drops again
  after the close. A pump fixed and pressed Done during the day is no longer "still there" because the night judged
  that same day, most of it from before the fix: the next whole day answers it, and the Cockpit's "VESTA confirms by"
  names the night that judges that day.
- The 5-minute check's messages give their time as every Status line does: "Example Villa, devices offline on
  05/11/2026 09:13." (also "devices missing on …" and "batteries on …"), no longer "on 5 Nov, 09:13".

## 0.12.457

What you will see:
- A device that keeps dropping and reconnecting stays a fault after the night check that found it: in a villa ahead of
  UTC, the 5-minute check just after midnight counted none of the last day's drops, closed the fault minutes after the
  night check opened it, and the next night opened it again "(2nd time in 7 days)".
- The night check's message says a close made on Telegram or on the tablet in the chat's language: "Terminé sur
  Telegram le … (JM)." in a French chat, no longer "Done on Telegram on … (JM)." in English.
- Done then Reopen pressed in the Cockpit while VESTA was restarting: the facility manager's chat and the tablet's
  alert card keep the "Done in the Cockpit on … (Luc). Watch 4h" line above "Reopened in the Cockpit …", as when the
  two are pressed apart.
- "No action needed" pressed in the Cockpit is said as such in every chat and on the tablet's alert card: "✅ No action
  needed in the Cockpit on … (Owner). Watch 4h.", as the Kiosk's own card says it, no longer "Done in the Cockpit". It
  is still checked again, as a Done is.

## 0.12.456

What you will see:
- Done or "Not a problem" pressed in the Cockpit is said as a Telegram press is, in every chat and on the tablet's alert
  card: "✅ Done in the Cockpit on … (Luc). Watch 4h." under "(watch)", no longer "(closed)" with no watch. The problem
  back within that time reopens the same alert number, even when it comes back minutes after the close.
- "Not a problem" pressed in the Cockpit on a person's ticket with a Need help alert open says "Not a problem in the
  Cockpit on … (JM)." and VESTA does not check it again; it said "Done in the Cockpit" and checked it.
- Need help pressed on Telegram or the tablet is said once: "🆘 Need help on … (Luc): Owner is asked to act.", no longer
  also a "- 🆘 Need help on … (Luc)" line above it. Once something follows, the press keeps its own line.
- "Fault still there after the close" names the person and the time of their close: "Done in the Cockpit on 04/11/2026
  23:45 (JM), but still there: Pump weak. Please look again.", no longer the time of the check and no name. VESTA's wait
  before it looks again counts from that close.
- The night check's Telegram message says when a person closes one of its faults ("Done in the Cockpit on … (JM)." under
  Status), before any "Still-there alert sent …" that follows.

## 0.12.455

What you will see:
- The tablet's alert card keeps every line when the villa's own automation reports a problem over after the watch
  ended: the "- Not a problem on … (Jm). Watch 1h" line no longer disappears.
- The night check's Telegram message says when a battery changes step during the day ("Status: Now: Gate lock battery
  at 17%: replace within the week."), not only at the next night.
- A fault that is not about a device being offline ends with the true reason: a device hidden since says it is hidden,
  one added to "Asleep between reports" says it sleeps, and a quiet sensor that goes offline is followed by its offline
  fault. None of them reads "Cleared: … no longer sees it" any more, and a battery of a hidden device no longer promises
  "Next check: within 5min" all day.
- The tablet's alert card is in English, whichever chat was drawn last: a French chat's "Rappel envoyé …" no longer
  replaces the English lines; the French stays on the card as its French version.
- Every fault's words follow what the 5-minute check finds (a reconnect count, the devices an integration takes down),
  not only after the next night; a running time such as "for 1d 2h" alone never rewrites it.
- An alert's Status keeps its close in its own words once something follows it: "- Not a problem in the Cockpit on …
  (Luc)" or "- Cleared on … Watch 1h", in each chat's language, never "- Closing note sent …".
- The Cockpit card of an automation watching a hidden device ends with its own words: "Closed: the automation '…' no
  longer exists in the villa's system." when the automation is deleted, "Cleared: back online." when its devices answer
  again.

## 0.12.454

What you will see:
- A Cockpit card about an automation watching a hidden device takes its new words within 5 minutes of the update
  ("… that no longer answers: … (offline)."), not only after the next night check.

## 0.12.453

What you will see:
- An alert closed with "Not a problem" (or Done) keeps that close as its last line when the villa's own automation
  reports the problem over later: it no longer becomes "Cleared on … Watch 1h" (#118).
- A close is told once: no "- Closing note sent …" line above the close, nor twice. When the watch ends, the card
  reads the alert, the press, then "✅ Closed on …: it did not come back within 1h."
- Every chat ends an alert with the same last line, its watch included: the owner's group read "✅ Not a problem on …
  (Luc)." while the facility manager's chat read "… (Luc). Watch 1h."
- A button pressed on the tablet is said "on the tablet" on the fault's card in the Cockpit, never "on Telegram".

## 0.12.452

What you will see:
- The Cockpit card of an automation watching a hidden device now says why it is there: the device no longer answers
  ("… watches 1 device hidden in the villa's system that no longer answers: Tapo Server Room Person Detection
  (offline)."), and what to do first: bring it back online; only if a copy replaced it, point the automation at the copy.

## 0.12.451

What you will see:
- An alert closed with "Not a problem" on Telegram or the tablet says the press once, in its last line ("✅ Not a
  problem on 05/11/2026 00:19 (Jm). Watch 1h."), as Done does; it was also listed as a line above it.

## 0.12.450

What you will see:
- An alert closed by a person (Done or Not a problem) no longer gets a second, nameless message when its automation
  gives up later ("Still not clear after 30min: no longer tracking this incident"): that message becomes the alert's
  card again (its number, its priority, how it was closed).

## 0.12.449

What you will see:
- An alert's "Not a problem" pressed on the Cockpit's card is said so on Telegram, on the tablet's card and in its
  notice ("✅ Not a problem in the Cockpit on 04/11/2026 15:11 (Owner)."), never "Done in the Cockpit".
- Every alert on Telegram and on the tablet offers Done · Need help · Not a problem. "Not a problem" closes it with
  nothing done and VESTA does not raise it again while it lasts, as the Cockpit's does; its fault in the Cockpit says
  "Not a problem" too.

## 0.12.448

What you will see:
- In VESTA's conversation on the tablet, an answer's "Investigate this" and "No, thanks" no longer come back once one
  was pressed: the answer keeps its words, the buttons go, and what was chosen, by whom, is written under it, as on
  Telegram. Answers pressed before this version lose their buttons when VESTA starts.

## 0.12.447

What you will see:
- An intrusion while the villa is empty always brings the siren's Approve / Refuse, even with a typing mistake in
  VESTA's rules file (the request could be lost before).
- In a Telegram group, VESTA answers everyone, and reads their voice, in the group's language: a person with their own
  chat no longer gets their private chat's language in the group.
- Costs › AI runs: a step's "What it did" says in words what was read ("worked out from every binary sensor"), never
  the template's code.
- Knowledge › Device links: a device is under "Run-hours check off" whenever the night check does not compare its hours,
  with the reason on its line (lighting, a schedule used only by switched-off automations, no time blocks…). A linked
  helper deleted from the villa's system says "No longer in the villa's system", and the night check says so too.
- Knowledge › Device kinds: a device made a Motor by a link says "From its link", never "Found by name".
- Removing a link of a device no longer found reads "Schedule removed", on the page and in Page changes.
- The villa's "VESTA chats by priority" sensor (its package file) now also holds what "Follow the VESTA Agent skill"
  means, so an automation set to Follow reaches the right people with or without VESTA running.

## 0.12.446

What you will see:
- Knowledge › Device links reads first: one line per device saying what VESTA uses for its Schedule, Normal power and
  Run hours (the helper's name, then "Found by name" or "Set by you", or a dash), each column with its own (i).
- The drop-downs open for one device only, on its Set or Change button; Done closes them.
- The devices whose run-hours check is off come first, under "Run-hours check off"; the others are folded under
  "Schedule linked"; a device the villa no longer has is last, under "No longer found".
- Plainer words here and in Device kinds: "Found by name" (was Guessed), "Set by you" (was Chosen here), "Use the one
  found" (was Back to the guess), a dash (was None linked).

## 0.12.445

What you will see:
- Rules › People: a role pill that would not fit on one line (a phone's narrow column) says "FM" instead of
  "Facility Manager"; where it fits, the full words stay.

## 0.12.444

What you will see:
- Nothing changes in how VESTA works. Its notes now say the tablet's "Maintenance mode" switch is in Advanced
  Settings › Villa, where the tablet now shows it.

## 0.12.443

What you will see:
- A chat added in the VESTA Kiosk, or a chat's language changed there, is taken up within a few minutes even while
  VESTA's rules file has a typing slip in it. Before, VESTA kept its old lists until the slip was fixed: the new chat's
  presses were answered "This chat is not on the villa's lists", while VESTA's People card already showed it.
- Nothing else changes on screen.

## 0.12.442

What you will see:
- VESTA's page, Rules › People: each chat shows its name, its role and its language, read only. The Telegram id column
  and the language menu are gone: who gets the messages and each chat's language are both set in the VESTA Kiosk,
  under Settings › Messages › Who gets the messages, with a language beside each chat (VESTA Kiosk 2.496.673 or later).
- policy.yaml holds no chat languages any more. The page's next save takes out the old `languages:` and People rows.
- A language set before on VESTA's page is not carried over: every chat reads English until its language is set in the
  Kiosk. Your three chats were all English, so nothing changes for you.
- Copy this setup now says "Who gets the messages, and each chat's language" stay with the villa.

## 0.12.441

What you will see:
- Someone writing to VESTA from a Telegram chat that is not on the villa's lists now reads: "This chat is not on the
  villa's lists. Ask the owner to add it in the VESTA Kiosk (Settings › Messages › Who gets the messages)." It no
  longer says "You are not registered with the VESTA Agent" or shows their Telegram id. A button pressed there shows
  the same words.
- On the VESTA Agent page, Copy this setup now says each chat's language stays with the villa (it named People and
  their Telegram ids, which are the Kiosk's lists now), and the rule "no approval when a registered person asks" reads
  "no approval when someone on the villa's lists asks". The app's Documentation tab describes the Kiosk's lists.
- Nothing else on screen: the rest is how VESTA is built inside (who is who in one place, the lists' format agreed with
  the VESTA Kiosk in writing, the device list keeping the chats apart from the villa's people).

## 0.12.440

What you will see:
- The same as 0.12.439, which was never offered: its build check still expected the old People rows in a new
  install's settings file.

## 0.12.439

What you will see:
- Who gets VESTA's messages, and who may press their buttons, is set in one place: the VESTA Kiosk (Settings ›
  Messages › Who gets the messages). Each Telegram chat in the owner's list or the facility manager's list gets that
  role's messages and may approve what that role may approve; everyone in a listed group acts with the group's role.
- On the VESTA Agent page, Rules › People now shows those lists, read only: each chat's name, Telegram id and role. The
  Language menu beside each chat is the one thing set there. Your languages are kept as they were.
- A chat only in the old People list, and no longer in the Kiosk's lists, gets nothing from VESTA and cannot approve.
- Until the Kiosk's lists name a Telegram chat, the People card says so, and VESTA answers nobody and sends nothing
  (the villa's own alerts are not affected).
- The next save on the Rules page tidies the file: the old People rows go, each chat's language stays.

## 0.12.438

What you will see:
- An answer VESTA gives on the tablet while the tablet's app is restarting is no longer lost: it appears within
  about 5 minutes, even if VESTA restarts meanwhile. An earlier answer edited after a restart keeps its pictures.
- After a power cut, a fault closed in the Cockpit reaches Telegram at VESTA's first round, not 5 minutes later.
- Nothing else changes on screen: VESTA prepares each answer in one place, a guest's included, and records "taken" in
  an alert's story where it records "cleared".

## 0.12.437

What you will see:
- Everything 0.12.436 says (it was not published: a check failed), and:
- An approval request always reaches a chat where it can be approved, even when the villa's list of who gets the
  messages names only chats your People list does not give that right.
- VESTA reads the villa's lists as soon as it starts, not 5 minutes later.

## 0.12.436

What you will see:
- VESTA sends its alerts, reminders and reports to the chats of the villa's lists of who gets the messages (the VESTA
  Kiosk: Advanced Settings › Messages › Who gets the messages), the same chats the villa's own alerts go to. A change
  there reaches VESTA within 5 minutes. A role with no Telegram chat in its list still goes to the chats your People
  list gives that role. Who may approve, and each chat's language, are still set in People.

## 0.12.435

What you will see:
- An approval request shown only on the tablet loses its Approve button once it is decided or expired, even when VESTA
  restarted while it waited. Before, a restart left the button on the tablet.
- After a restart, each open alert's card on the tablet is sent again exactly as VESTA last told it.
- In the Cockpit, every press reaches VESTA once, in the order it was made. A Done followed by Reopen before VESTA's
  next read now counts as both: the alert is closed, then opened again and the Facility Manager asked. Before, neither
  was seen.
- A Done on your own ticket in the Cockpit closes its Need help alert once, instead of being handed over again at every
  read.

## 0.12.434

What you will see:
- The night check no longer says a scheduled device "ran shorter than expected" when every automation that uses its
  schedule is switched off. Switch one back on and the check starts again.
- When you answer a fault with "Not a problem while it lasts" on the tablet, VESTA does not raise it again for as long
  as the problem lasts. If the problem ends and comes back later, VESTA raises it as new.

## 0.12.433

What you will see:
- During an intrusion you keep the siren's Approve button when something moves indoors and neither known phone is home.
  Before, any movement indoors took it away, so an intruder walking past a motion sensor removed your button. The
  request says "while no known phone is home, with movement indoors": look at the camera first, it could be staff.
- The request is withdrawn only when a known phone comes home, and then says "someone came home". If VESTA cannot tell
  where the phones are, it treats someone as home and does not ask.
- The siren still never sounds without a person's press. Unanswered, expired, refused or withdrawn: nothing sounds.
  That is now the first of the rules every change to VESTA follows, and a test proves each of those cases.

## 0.12.432

What you will see:
- No more "AP … has been offline for over 8d" for a device that was gone for a few minutes. On 1 Nov at 00:29 the
  five access points dropped out for about 6 minutes; VESTA read them as offline for more than 8 days and raised a
  fault for each at once. The cause: each one's Restart button, which reads "unknown" until someone presses it, gave
  no reading in the days VESTA reads back, and counted as "offline since the start of the read". Now, when some of a
  device's parts gave a real reading, only those say when it went offline; a part that never reports (a button, an
  event) says nothing about it. A short drop is then under the night check's minimum and raises nothing, for every
  kind of device. A device truly dead for weeks, none of whose parts report, still reads "offline for over …".

## 0.12.431

What you will see:
- Nothing changes on Telegram or the tablet. VESTA's own checks now hold its test copy of the tablet to what the real
  tablet keeps of each message (its page, its language, its buttons, its texts cut at their limits), from the same
  examples the tablet is tested with. A message that passes VESTA's checks is now one the tablet shows exactly as
  checked.

## 0.12.430

What you will see:
- A fault now closes with the same sentence whichever check notices first, the 5-minute check or the 02:00 night
  check. A device you hid reads "Closed: this device is hidden in the villa's system, and hidden devices are not
  watched." at night too, a device you set asleep "Closed: this device sleeps between its reports …", a device deleted
  "Closed: this device no longer exists in the villa's system.", a device back "Cleared: back online.", one followed by
  an alert "Followed by alert #41-P2, which says when it is back.", one now missing "Followed by: … is missing from the
  villa's system …". The night check no longer says "Cleared: the nightly check no longer sees it" for any of these; it
  says it only when nothing else explains why the fault is gone (a battery that was changed, for example).
- During an intrusion, when VESTA cannot ask you for the siren (no siren chosen, or the request reached none of your
  chats), the "Intrusion suspected…" warning now goes to you AND the facility manager, every time. Before, with a siren
  chosen but the request unsendable, only you were told (the facility manager only if none of your chats took it). A
  chat listed for both of you gets it once.
- Nothing else changes about the siren: VESTA only ever asks you for it, never while someone is home, the camera
  pictures come before the question, a waiting request is withdrawn as soon as someone is home, and the siren stops by
  itself after its minutes.

## 0.12.429

What you will see:
- Everything in 0.12.428 (VESTA calls what it raises a fault; only Open Ticket in the Cockpit makes a ticket), now
  published: that release stopped before reaching the store because the Kiosk had just reworded one line of its
  agreement with VESTA ("Close, nothing done"). VESTA's copy now matches. Nothing else changes.

## 0.12.428

What you will see:
- VESTA now calls what it raises a fault, everywhere: in its messages, its answers, its settings page and its record of
  what it did. A fault goes to the Kiosk's Open issues; only a person pressing Open Ticket in the Cockpit makes it a
  ticket. VESTA never makes a ticket itself.
- The VESTA Agent page, AI tools: the switch reads "Raise a fault for the facility manager" (it read "Create a facility
  ticket"). A skill's offline test says "Messages or faults it would raise".
- The monthly report's figure reads "faults closed / raised", with "median N days to close" under it (it read "tasks
  closed"): it counts the faults VESTA raised and cleared in the month.
- Asked "what did you do last night?", VESTA speaks of the faults it raised or cleared, not tickets.
- Your saved instructions are brought up to date by themselves: the line that called a facility manager's job a
  ticket now says it is a fault, and that only a person makes it a ticket. A line you reworded yourself is left alone.

## 0.12.427

What you will see:
- Every row of the Limits tab now says in full what it controls, in a whole sentence: what it changes and when it
  applies. Rows that showed only a name ("routes.0.cooldown min", "limit usd", "schedule.0.timeout") or a half
  sentence ("…and longer than it by at least this") now read, for example, "How long after a tripped-sensor alert
  (a water leak, for one) a repeat on the same device is counted, not sent again." Each row reads on its own.
- The "How long records are kept" rows say what is kept: "How long report pages, alert copies and files VESTA saved
  are kept on the villa's disk before the nightly clean-up deletes them; skills put in the trash are deleted then too."
- A scheduled job's time row names the report it makes ("When the Facility Manager's daily digest runs").
- Nothing else changes: every value stays as it was.

## 0.12.426

What you will see:
- The night check's message tells its fault's story as an alert card does, with the date, in the chat's language:
  "Cleared on 20/10/2026 12:30: watched until 02:00.", "Closed on 21/10/2026 02:00: it did not come back.",
  "Back at 21/10/2026 02:00 (to: FM)", "Reopened in the Cockpit on 20/10/2026 13:00 (Owner)". A French chat reads
  "Statut: … Résolu le 20/10/2026 12:30: surveillé jusqu'à 02:00." The tablet keeps the English. Messages already
  sent keep their words until their next update.
- How often an alert came back is said one way everywhere, and in the chat's language: "Back at 16/10/2026 18:03, 2nd
  time in 7 days (to: FM)" (it read "Back at …, Back again: 2 times in 7 days"), and a fault's name "Pool leak (3rd
  time in 7 days)" in the Cockpit, the morning message and the reports (it read "(again: 3 times in 7 days)").
- A night-check fault closed while still there opens again after the alert desk's own wait ("clear" time in its
  settings), the one setting for both, no longer a copy of it.

## 0.12.425

What you will see:
- An automation is always named by its own name, in apostrophes, without its blueprint's prefix: "Retune 'Pool
  leak': it fires too often" in the weekly report's suggestions (it gave the automation's technical name), "Turn on
  the automation 'Pool leak'" in a request, "The automation 'Pool leak' watches 1 device hidden…" in a fault. A
  suggestion you already answered keeps your answer under its new name.
- The night check's faults say hours as durations, as the rest of the card does: "ran shorter than expected on
  Monday: 2h 18min against 4h scheduled" (it said "2.3h against 4.0h"), "1h 30min without any data", "scheduled 4h
  … and did not run". The steps of a question read "last 1h 30min" the same way.
- An alert closed because its automation is gone now says the automation "was renamed or deleted in the villa's
  system" (it spoke of an "entity ID"), in every language.

## 0.12.424

What you will see:
- Nothing changes on screen. VESTA and the tablet now check "since when a missing device left" against the same
  examples, so Telegram and the device's window on the tablet give the same moment.

## 0.12.423

What you will see:
- Costs › AI runs › Every run: a reply in a Telegram group now names the group with the same role words as everywhere
  else, "Owner and FM group" or "Owner group" (it read "fm and owner group").
- Nothing else changes on screen. What the tablet tells VESTA (devices asleep between reports, Maintenance, the villa
  empty sensor) is now kept by one shared piece, in the same files as before, and "on means empty" is said in one
  place for every report.

## 0.12.422

What you will see:
- A reply at the tablet no longer says 'private chat' on the Costs page.

## 0.12.421

What you will see:
- Knowledge: "Asleep between reports" and "Translations" are now two cards at the top of the tab, read without a tap.
  Under them, the tabs hold only "Device kinds" and "Device links".
- The page's tabs: a tab's name stays on one line on a phone ("Rules (file)" no longer breaks under "Rules"); the
  row of tabs scrolls sideways instead.
- Costs › AI runs › Every run, on a phone: every line of a run reads the same way, its name on the left and its value
  on the same line at the right: When, What, Brain · model, Skills, Tokens in / out, Cost. What's label and its chat
  sit at the right too.
- On a phone, a run's "N steps" (or "Whole question") button now sits after its Cost line, at the right, and opens
  the steps under it as before.
- The question a run answered is shown once, in its steps, no longer repeated on the run's line.
- A device missing from the villa's system now says since when it really left ("missing from the villa's system
  since 31/10/2026 00:19"), read from the villa's history, not the moment VESTA first looked. A missing fault already
  open is corrected at the next check, without a new message.

## 0.12.420

What you will see:
- A device that disappears from the villa's system altogether (its hub stops sharing it, it is deleted) is now a
  fault: "Entrance Lock is missing from the villa's system since 31/10/2026 00:19." What to do: "Re-pair it, or press
  Done if it was removed on purpose." When automations still name it, the fault says which ones ("Still named in
  automation 'Critical watchdog': remove it there.").
- A critical device that goes missing is found within 5 minutes and the facility manager gets a P2 message at once;
  any other device is found by the night check, as a P3 fault.
- A device that only could not be read is never called missing.
- Its other faults (offline, battery) now say "Followed by: … is missing from the villa's system …" instead of closing
  as if the device no longer mattered.
- Done on the missing fault: VESTA forgets the device and never raises it again. When the device comes back, its
  fault closes: "Cleared: back in the villa's system."
- Devices removed before this update are not raised: only the ones that go missing from now on.
- On a phone, typing in a device list's search box no longer closes it.

## 0.12.419

What you will see:
- The siren's approval request names the devices as the villa's system names them ("Drive Motion, Entrance Lock"),
  never their codes.
- When a camera can show the place (the camera an alert names, or one in the same room or area as a sensor that
  tripped), its picture arrives in your chat just before the siren's request, and the request then says "Look at the
  camera picture above first." With no picture, the request no longer mentions one.
- When someone comes home: the villa's "empty" sensor is read again just before the siren is asked; someone is in
  the villa, it is not asked. A request already waiting is withdrawn as soon as the villa is no longer empty, its
  buttons gone and its message saying "Withdrawn on 31/10/2026 00:19: the villa is no longer empty. Nothing was done."; an
  Approve pressed after that sounds nothing.
- The siren is always the owner's to approve, whatever the rules for switches say: also when it is reached through
  the plug it is on, or a scene that turns it on.

## 0.12.418

What you will see:
- A guest asking VESTA on the tablet is now answered only from what the guest's tablet shows: no people, no motion or
  door sensors, no cameras, nothing from a group of devices the guest's map hides, and not the villa's status (offline
  devices, open alerts, locks). A question about something hidden gets "not something I can tell you". On VESTA's
  page, Rules › AI tools › Tools by role now fills the Guest column with what a guest's VESTA may use; the old line
  "a guest gets no answer at all for now" is gone.
- The Facility Manager has one name everywhere: "Facility Manager" in VESTA's messages and in an alert's history
  ("Ticket opened in the Cockpit on … (Facility Manager)"), "FM" only on an alert card where space is tight. Steps
  saved earlier as "Facility manager" read the new way too.
- A device's running time on a report's chart says "ran 1h 30min" instead of "ran 90min", and the chat reset choice
  says "After 8h of silence".

## 0.12.417

What you will see:
- A button pressed or a question sent on Telegram while VESTA was restarting (an update takes about 20s) is now acted
  on when VESTA is back, once, in the order they were sent: a Done pressed then takes the buttons off the alert, a
  question gets its answer. A press or a question older than 15min (VESTA's Limits tab, telegram.catch_up_minutes) is
  not acted on; VESTA replies to it with one line instead, for example "VESTA was restarting when you pressed Done on
  #93-P1; press it again."
- When Telegram asks VESTA to slow down for a few seconds, or does not answer for a moment, the message is sent again
  instead of being lost: an answer with several pictures, or a long reply in parts, now arrives whole, each part once.
  How long VESTA waits for Telegram is on VESTA's Limits tab (telegram.retry_wait_max_s, 30s; telegram.retry_pause_s,
  2s).

## 0.12.416

What you will see:
- A job set for day 29, 30 or 31 of each month now runs on the month's last day when the month is shorter (a report
  set for the 31st comes on 30 November and on 28 February), and the job's line on VESTA's page says so.
- A job set just before midnight (23:45, say) that VESTA missed during an update or a restart now still runs after
  midnight, within the usual catch-up time, instead of being lost for the day.

## 0.12.415

What you will see:
- Maintenance mode now holds every new problem below P1, not only the villa's alerts: a device that goes offline, a
  battery or a night check finding no longer sends the facility manager a message or opens a fault while it is on.
  What was already open carries on as before. A problem still there when you turn maintenance mode off is taken up at
  the next check (within a few minutes for a device offline, at the night check for the rest); one gone meanwhile is
  never sent afterwards.
- VESTA now asks the VESTA Kiosk which sensor says the villa is empty: the one picked in Settings › Villa, the same
  one the presence tile follows. The siren request, "electricity while the villa is empty" and VESTA's answer to "is
  the villa empty?" all read it. ⚠️ Pick it in the Kiosk's Settings › Villa if the presence tile shows nothing: until
  one is picked VESTA cannot tell whether the villa is empty, and the siren is never offered.

## 0.12.414

What you will see:
- Need help or Done pressed on a card on the tablet now reaches Telegram within seconds, not up to 10 minutes later:
  Need help asks the owner at once, and Done takes the buttons off the alert. The regular check every few minutes
  stays as a backup.
- Nothing changes on the page: Device kinds and Device links save, undo and count from the next run as before. Under
  the hood, the Knowledge tab's choices now go through one shared path, so a choice added there later is checked,
  undoable and read by the night check without being wired by hand.

## 0.12.413

What you will see:
- A new Knowledge tab on VESTA's page, beside Rules. Device kinds, Asleep between reports and Forget Translations move
  there, so Rules now shows only what policy.yaml holds.
- New Knowledge › Device links: for each device, choose its schedule, its normal power and its run-hours helper from
  the villa's helpers, by name, or switch one off with None. "Back to the guess" undoes a choice; the next night check
  uses it. A device with no schedule linked says so: "No schedule linked: the run-hours check is off for it".

## 0.12.412

What you will see:
- Rules › Device kinds: the (i) is now short titled sections: which devices are listed (every device that measures
  its own power or energy, the number on this villa), what each kind changes, as a list, where the kind comes from,
  how to correct it. The card itself also says how many devices it lists, and why.

## 0.12.411

What you will see:
- VESTA can read an integration's state and its reason, for example "the ZBT-2 radio: setup_retry, The
  device is not plugged in", never its settings, options or diagnostics. On this villa, switch it on in VESTA's page ›
  Rules › AI tools: tick "ha_get_integration" (a new villa has it on).

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

