## 0.12.29

### Fixed
- **The service, people and AI tables on the VESTA Agent page fit the screen.** A long rule like "listed — only the devices in the lists below, then approval" pushed the services table off the right of a phone and cut the service names to a few letters. The columns now keep their width, and a long choice ends in "…" (open it to read the whole text). On a phone, each service shows its name with a remove button, and its rule on the line below. Each person shows name and Telegram id, then role and language.

## 0.12.28

### Changed
- **Every dropdown on the VESTA Agent page now opens the page's own list, in its colours.** This covers Language, Role, Brain, New conversation, Rule and the Costs period. They used to open the phone's own picker (on Android, a grey sheet of radio buttons). The list opens under the field, or above it near the bottom of the screen, and the current choice is ticked.

## 0.12.27

### Changed
- **The waiting message of a report you ask for in a chat is now always dealt with.** It is removed when the report arrives, even if the report arrives before the waiting message itself. If the job ends with no report, the waiting message says so, even if the job ends very fast. When one request starts two jobs, the waiting message waits for both.
- **The morning message groups problems exactly as the weekly report does.** Devices are named as in Home Assistant, not guessed from the sentence. A group line shows its most urgent item's priority.
- **The nightly check counts a device once, whichever rule raises it.** "Offline", "not reporting" and "keeps dropping off" now recognise the same device the same way.

## 0.12.26

### Changed
- **Every report you ask for in a chat works the same way: one waiting message, replaced by the report.** This now includes the daily digest, which arrives as text rather than a page (0.12.25 replaced the waiting message only when a page arrived). The weekly and monthly reports behave as in 0.12.25.

## 0.12.25

### Changed
- **A report you ask for in a chat is one message.** The VESTA Agent answers once ("your weekly report is on its way"), and when the report is ready that message is replaced by the report itself. You no longer also get the owner's three weekly lines as a third message: those come only with the scheduled Monday report. If a report cannot be made, the waiting message says so instead of promising one.

## 0.12.24

### Fixed
- **A sensor that really stops is still reported, even if it stopped once before.** Checked against the villa's own history after 0.12.23: the Temp and Humidity sensor that went silent on 2 October had already been frozen for six days in September, and 0.12.23 would have mistaken it for a sensor that only reports on a change. A sensor is now judged on the three days before it went quiet.

## 0.12.23

### Fixed
- **Far fewer false maintenance alerts, in Telegram and in the Kiosk's Cockpit.** One morning message listed 24 "new" problems, then repeated them under "Still open". Most were not problems:
  - **"Has not reported" now means a sensor that normally reports all the time has stopped.** Curtains report only when they move and rain gauges only when it rains; after a Home Assistant restart they looked "silent" for days. A sensor is now judged against its own history, so the Temp and Humidity sensor that really stopped sending is still reported, and the curtains and rain gauges are not.
  - **One device is one line.** A sensor's temperature, pressure and battery were three alerts; a relay, its firmware and its uptime were three more, two of them shown as technical names.
  - **A Home Assistant restart no longer counts as a device dropping off.** Every restart takes every device offline for a moment; that was counted as the device's own Wi-Fi or power problem.
  - **Pump energy is judged on whole days.** The nightly check ran at 02:00 and counted that night's two hours as a full day, and counted a day the plug was offline as a day of low use ("Onsen pump used 0.09 kWh/day … −80 %").
  - **"Unknown" is no longer "offline".** A wind chill has no value on a warm day while the weather station reports normally.
- **The morning message says each thing once**: what is new is not repeated under "Still open", and several of one kind are one line ("4 sensors have not reported: …").
- The tickets these alerts opened in the Kiosk close by themselves after the first night with this version.

## 0.12.22

### Changed
- Nothing changes for you. The agent's own records (which scheduled jobs already ran, which messages carry an alert's buttons, which files the AI saved) are now kept through one set of named operations instead of loose keys; what the agent already holds is read as before. A scheduled job can no longer be started twice in the same slot if two checks run at once.

## 0.12.21

### Changed
- **Costs: the period selector sits on the same line as "Period"**, at its natural width, instead of a wide box on a line of its own. A thin line now separates it from the key figures below.

## 0.12.20

### Changed
- **The agent page's title line holds everything.** The version now sits right after "VESTA Agent", shorter ("v0.12.20 · dev"; hold or hover over it for the full detail), and the Light / Auto / Dark switch sits on the same line, at the right. On a phone the switch no longer takes a line of its own.

## 0.12.19

### Changed
- Nothing changes for you. New checks make sure the agent and the app that starts it always agree on every setting passed between them (names, folders, and the version of the agreement with the VESTA Kiosk), so a renamed setting can no longer leave the agent silently without its Kiosk or Home Assistant access.

## 0.12.18

### Changed
- **The figures on the agent page use the whole width of a phone.** On the Overview ("The last 24 hours") and on Costs, the numbers were stacked one below the other down the screen. They now sit two to a row on a phone, and more side by side on a wider screen.
- How agent releases are made is now one command that writes the versions, runs every check and waits until Home Assistant can offer the update. Nothing else changes for you.

## 0.12.17

### Fixed
- **The agent's reports have the VESTA icon.** A report opened from Telegram showed a blank icon in the browser's tab and bookmarks. Every HTML page the agent sends now carries the VESTA "V" (the same one as the VESTA Kiosk, light or dark to match your phone's theme). The icon is stored inside the page, so it shows with no internet. This applies to every report, including ones from skills you add later. A page that sets its own icon keeps it.

## 0.12.16

### Fixed
- **A fault closed in the VESTA Kiosk stops being chased.** Closing an alert's fault in the Kiosk closed the agent's task but not the alert itself: the agent kept reminding the facility manager and escalated to the owner. Now the alert closes with it, and its Telegram messages lose their buttons ("Closed in the VESTA Kiosk").
- **In a chat, everything the agent sends goes to that chat.** A check the agent ran while answering someone could still send its messages to the facility manager's chat; now, as for the agent's own answers, only the chat that asked receives them.
- **The reports, the morning digest and the concierge agree on what is still open.** The morning digest counted the facility manager's tasks while the weekly page listed the problems themselves; a fault closed in the Kiosk now leaves both. The digest no longer asks to reply with numbers that no reply could close: an alert keeps its "#N", the rest is closed in the Kiosk.
- An alert's outcome in a report is always in words ("Reminder sent", "In the morning digest"…), never the agent's internal word.

### Changed
- Under the hood (no visible change otherwise): one place decides whether a problem is still open, one decides where a message goes and what the AI may do in each situation, and the agent page asks the agent for the brain names and the schedules instead of keeping its own copy.

## 0.12.15

### Changed
- A fault the agent files in the VESTA Kiosk has a short title saying what is wrong ("Rain gauge has not reported for 2.0 days."), and what to check as its note, instead of both in one long title.

## 0.12.14

### Fixed
- **The Kiosk's Cockpit filled with faults that were long gone.** The nightly check closed its findings but never their Kiosk tickets, so every false alarm ("has not reported", a device back online) stayed an "Open fault" for ever. Now:
  - when the night check no longer sees a problem, its Kiosk ticket is resolved ("Cleared: the nightly check no longer sees it.");
  - at each start and each night, the agent closes the tickets of problems already gone (the ones left over from before), and closes its own task when a person resolves the fault in the Kiosk.

## 0.12.13

### Added
- **Light / Auto / Dark** switch in the page's header, like the VESTA Kiosk (Auto follows the device). The choice is kept in that browser.

### Changed
- **Choosing devices:** each box opens a list with a search and a checkbox per device (name, room · id); tick as many as needed. The chosen devices show inside the box. The siren is chosen with a single click.
- The fields of a card line up ("Siren stops after" sat higher than the others), and a long device name no longer spills into the next field.
- **Charts have a Y axis with grid lines and values:** the Costs tab's cost per day (with a date under the bars) and every chart of the weekly and monthly reports.
- Costs: the fourth figure is the average cost per run for the period (it repeated "Last 7 days").

## 0.12.12

### Changed
- People can be answered in Chinese, Japanese and Korean too (Rules → People → Language).

## 0.12.11

### Changed
- One **Rules (file)** tab instead of two: a click on "Rules" opens the forms, a click on "(file)" opens policy.yaml itself.

## 0.12.10

### Changed
- **An alert's buttons go away everywhere at once.** An alert can be in several chats (a P1 goes to the owner's chat and the facility manager's) and repeated by reminders. When someone presses Done, Not found, Need help or Mute on any of them, or types "#2 done", every copy loses its buttons and shows who answered and when ("Done — Jean-Marie, 08:31"). When Home Assistant clears the incident itself, every copy says "Cleared in Home Assistant, 08:40. No reply needed."

## 0.12.9

### Added
- **Costs** tab: what the AI cost today, over 7 days, this month and the chosen period (7, 30 or 90 days); a bar per day; the cost by work (chat replies, each AI job) and by model; and every run (when, what it was and who asked, the brain and model, the tokens, the cost, whether it stopped at its limit), 10 to a page. The model and the tokens are recorded from this version on.

### Changed
- **Devices are chosen by name, not typed.** Protected devices and the allowed lists offer the villa's own devices (name and room, from the agent's nightly reading of Home Assistant); each chosen one shows as a tag with ×.
- **Language** is a menu of the languages the agent writes in, not a text box.
- **The AI:** each limit says what it is for ("for each reply", "for each run") and each job says when it runs ("every Monday at 08:00, or when asked in a chat"). Below the table: the most the scheduled runs can cost a month at their limits.
- **Skills:** the green "on" label is gone; a skill whose files have a problem shows "not working" (it was never a switch).
- **Overview:** "Scheduled jobs run" is a table, 10 to a page.

## 0.12.8

### Fixed
- **A report asked for in a chat came back in another chat.** Asked in the group, the weekly was made inside the conversation and sent to the facility manager's chat; the group only got "Done". Now:
  - whatever the agent sends while answering a person goes to that person's chat, never to another one;
  - a report asked for in a chat always runs as its AI job (its own brain and spending limit), never inside the conversation. This holds for every report a person may ask for: the daily digest, the weekly and the monthly.

### Changed
- The daily digest can now be asked for in a chat too, like the weekly and the monthly (it runs once it is set under Rules → The AI).
- **Rules (file)** is its own tab next to **Rules**: the "Forms / The file" sub-menu is gone.
- **Overview:** the Rules and Skills cards are gone (their tabs are one click away); a problem in the rules or a switched-off skill is still shown there. A line now separates "Scheduled jobs run".

## 0.12.7

### Changed
- **The weekly report reads like the example PDFs.** One "Do this week" list: each device appears once (a pump's power drop and its open task are one line), and many devices with the same problem share one line ("4 monitoring devices offline — all since 1 Oct, 09:28: one cause is likely"). The separate "What VESTA noticed" section is gone. The monthly report's "Preventive maintenance" uses the same list.
- **Alerts that fired:** one line per alert with how many times it happened, in plain words ("Entrance unlocked — 6 times"), instead of one row per rule run.
- The reports skill has 6 files instead of 29 (the page is one template file; the charts are in compose.py).

### Fixed
- **The weekly showed 71 "critical alerts" that were not alerts.** It counted every time a safety rule *ran*. The pump schedule rules run twice a day to check the pumps and almost never alert. Home Assistant's record now counts only the rules that alert every time they run (the "condition" rules); the others come from the agent's own record.
- "Nothing happened" only says what was actually watched: for a week the agent was not listening, it no longer claims "no equipment missed its schedule".
- **Sensors reporting an unchanged value were tasks** ("has not reported for 1.6 days"): a rain gauge at 0 or a curtain nobody moved. A sensor is now silent only when it stops *reporting*, not when its value stops *changing*.
- A pump that runs a few minutes at a time no longer shows a fake "power down 31%" (its hourly averages follow its use, not its water).
- Circuits: "+10900%" from almost nothing shows as ">+300%"; an empty comparison shows "—".

## 0.12.6

### Changed
- **The AI** is one section, laid out like "What the agent may do": one line per piece of work (chat answers, then each AI job) with its Brain and its Limit (USD). A job that is not set shows "+"; "×" stops it. On a phone, each line puts the work above its brain and limit.
- "The agent may act on the villa" and the Approve minutes sit on one line, as do "New conversation" and "Web search" (they stack on a narrow screen).
- **Skills:** the file list of a skill shows one line; "All N files" shows the rest ("Show fewer files" folds them back). The open file is always on that line.

### Fixed
- **A report asked for in a chat comes back to that chat, and only there.** Before, the agent was only told to; it could still send the page to the facility manager's chat (the weekly's own steps name it). Now everything such a report sends, including the owner's lines, goes to the chat that asked.
- On a phone, a skill's editor made the page wider than the screen.

## 0.12.5

### Changed
- The "AI jobs" card on the VESTA Agent page now looks like "The AI" above it: each job with its own Brain and Limit per run fields, and Set / Stop buttons.

## 0.12.4

### Fixed
- **The VESTA Agent page still used old page code** through Cloudflare (no app version in the corner, the old "page met an error" line). The page's files now carry the version in their path, which no cache can ignore.
- The app's version did not reach the page; it now does ("app 0.12.4 · agent 0.6.4").

## 0.12.3

### Changed
- The VESTA Agent page shows both versions in its top right corner: the app's (as on Home Assistant's app page) and the agent's inside it, for example "app 0.12.3 · agent 0.6.3 · dev".

## 0.12.2

### Fixed
- The VESTA Agent page showed "The page met an error: error" when Home Assistant is reached through Cloudflare: Cloudflare adds its own analytics script to every page, which the page blocks on purpose. Only the page's own files now count as errors.

## 0.12.1

### Fixed
- **The VESTA Agent page could show the previous version's page** after an update (no "AI jobs" card, no "Add them" banner): when Home Assistant is reached through Cloudflare, Cloudflare kept the old page code. Its files now carry the version in their address, so an old copy can never be used again.
- Two spacings on the page were blocked by the page's own security rule; they now come from its stylesheet.
- If the page meets an error in your browser, it now says so on the page and writes it to the app's log.

## 0.12.0

⚠️ **After updating, open the VESTA Agent page and press "Add them"** (or Rules → AI jobs): the daily digest and the weekly and monthly reports now each need their brain and spending limit set, and do not run until they are.

### Added
- **VESTA's readings in the weekly and monthly reports**, as in your mock-ups: the AI now reads the villa's data like a property manager — what changed and when, what it means, what to check, what to ask, when to act and what ignoring it costs — in the headline, in a new "What VESTA noticed" section, in each task, under each chart and in a "nothing else happened" line. Its conclusions carry its own numbers and are marked "VESTA's reading"; the tiles, tables and charts stay computed.
- **A playbook in the reports skill**: the situations the agent recognises (a pump's power stepping down at the same hours, its running time changing, a battery falling, a safety device offline, electricity used while the villa is empty…). The villa adds its own in `villa.reports.yaml`, which app updates keep.
- **AI jobs on the VESTA Agent page**: each job's brain and spending limit; a job not set does not run (banner, "Add them").
- **Ask for a report in a chat** (`/ask make the weekly report`): it runs as its job and the page comes back to that chat.

### Changed
- A report that reaches its spending limit is still sent, with every figure and the readings written so far.

## 0.11.0

### Changed
- **The weekly and monthly reports follow your mock-ups.** Weekly: the colour of the week, the four tiles, the tasks, the alerts that fired, a chart per pump, the batteries, kWh per day against last week, the circuits, the monitoring's own health. Monthly: the cost, the tiles, what happened, what was fixed and suggested, preventive maintenance, the trends, the monitoring's health and what would help. Every figure comes from Home Assistant and the agent's records; the AI writes only the sentences, and a sentence with a number that is not in its section is refused. Money left on the table, night standby and monitoring uptime say "not measured yet" for now.
- **What a report shows is set in the reports skill** (`reports.yaml`, editable on the VESTA Agent page): its sections and their order, the thresholds, the sentences the AI writes.
- **Alerts in a report include those Home Assistant handled alone** (while the agent was not there), read from Home Assistant's own record of the VESTA rules.
- **One rule decides which chat a message goes to**: a reply where the person wrote or pressed; scheduled and alert messages to their role's chat; approvals to the chat they were asked from, or the owner's; a message for both roles sharing one chat sent once.
- **The siren's sounding time is set in one place**, `policy.yaml` (`siren_auto_off_min`).

### Fixed
- **A skill run from a chat now does what it does on schedule**: its Kiosk faults are created and its messages sent. Before, a maintenance check run from a chat stored its tasks but never created their faults, and the night run then skipped them.
- **Faults that never reached the Kiosk are created**, at every start and every night.
- **The maintenance check read the same logbook page 20 times** and counted each device's drop-outs 20 times; it now reads it once.
- Asking for the next part of a long script answer no longer runs the script again.

## 0.10.0

### Added
- **The VESTA Agent page, in Home Assistant's sidebar** (administrators only), in the VESTA Kiosk's look. **Rules**: the agent's `policy.yaml` as forms (acting on or off, people, chats, what the agent may do and who decides, protected devices, allowed lists, AI settings), plus the whole file. **Skills**: see, edit, add and delete skills and their files while the agent runs. **Overview**: problems to fix and the last 24 hours. Every save is checked with the agent's own rules first, the file's comments are kept, and a file changed elsewhere meanwhile is never overwritten. The page keeps working while the agent is stopped.

### Fixed
- **A report asked for in a chat is sent to that chat.** Asked in the group, the weekly report went to the facility manager's chat (a private chat) and the group got only "report sent".
- **Asked again, the agent does the job again**, instead of repeating an earlier failed attempt from the same conversation.

### Changed
- The app's log now says when `policy.yaml` holds something the agent ignores (a misspelt section, a person without a Telegram id).

## 0.9.4

### Fixed
- **"Generate a weekly report now" works.** The report page was built without the week's energy figures and stopped with "a template error". The reports skill now spells out its two steps, and the page builder says exactly what is missing instead of failing. The owner's Monday lines also use the week's figures (they could say "kWh n/a").
- **A failed skill script is now in the app's log**, with its reason, not only in the chat.

## 0.9.3

### Added
- **Actions without the Approve button, where you choose.** A new rule, `direct`, in `policy.yaml`: for example `light.turn_on: direct` and `light.turn_off: direct`, and a light is switched as soon as a registered person asks in a chat; the reply says whether it worked. Alerts and scheduled jobs still ask, and owner-only devices still wait for the owner. See the Documentation tab, "Acting on the villa".

## 0.9.2

### Fixed
- **An approved action now happens.** Pressing Approve (for example "Turn on Pool Bottom") failed with "Home Assistant refused or failed": the agent sent the device in a form Home Assistant's MCP server does not accept. The app's log now also says why when an approved action fails.

### Changed
- **Updates are much smaller.** The app was built so that any change to the agent re-sent almost the whole app (about 840 MB of 1.1 GB). It is now stacked with the agent's own code last: an update that changes only the agent downloads only that, well under 1 MB. This update itself is still a full download, one last time.
- **No more PDF: the app is half the size** (about 530 MB instead of 1.1 GB). The weekly and monthly reports arrive as a message with the headline and the key numbers, plus the full report as an attached page: tap it and the phone opens it in its browser, which can print it or save it as PDF.
- **Starter skills now follow the updates, unless you edited them.** A starter skill you never changed is replaced by the new version and the log says so; one you edited is kept, and the new version is left beside it in `skills/.starter/` to compare.

## 0.9.1

### Changed
- **Alert buttons go once pressed.** The alert message then says who answered, what, and at what time, and the answer goes to the chat where the button was pressed (no longer to the group).
- **Plain text on Telegram**: no more `**` around words.
- **While acting is off, the agent no longer offers to do things** ("shall I turn it on?"); it says it informs only.
- The Kiosk fault created for an alert no longer starts with 🚨.
- **The app's log tells the story of each alert**: received, handled, each message sent and to which chat, each button pressed, each Kiosk fault created or resolved, each reply and what it cost.
- **Ask "what did you do last night?"**: the agent reads its own record (jobs run, alerts followed, buttons pressed, faults, cost) and answers. It changes nothing.
- The help text for the Home Assistant token was wrong: keep the "VESTA Agent" user **Active**, with "Can only log in from the local network" on. Turning its login off makes Home Assistant refuse its token.

## 0.9.0

### Added
- **The real VESTA Agent is inside the app.** Switch *Agent mode* to `agent` to run it: it answers the owner and the facility manager on Telegram, follows up every critical alert of the VESTA rules (Done / Not found / Need help, reminders, the owner after 45 minutes), records each job for the facility manager as a ticket in the VESTA Kiosk, runs the night's maintenance checks, and sends the daily digest and the weekly and monthly reports with their PDF.
- **Skills you can change without an update.** Each skill is a folder under the app's `skills` folder: edit it, add one, delete one, and it counts at once. The five starter skills are copied there at the first start; updates never touch them.
- **The Documentation tab explains the set-up**: the "VESTA Agent" Home Assistant user (administrator, active, local network only — corrected in 0.9.1), registering people with `/whoami`, and the agent's `policy.yaml`.

### Changed
- **Telegram: Home Assistant keeps the bot.** The agent reads the bot's messages from Home Assistant and only sends, so the gate button, the alerts and every Telegram automation keep working whether the agent runs or not. *Telegram takeover* now means "the agent may send on the bot" — turn it on for one app only.
- The Home Assistant MCP server always runs inside the app: the *Home Assistant MCP*, *External MCP address* and *External MCP secret* fields are gone (an older value left in them is ignored).
- The app is smaller where it can be (no Node.js) and larger where the reports need it (a headless Chromium, used only while a PDF is printed).

## 0.8.0

### Changed
- **Nothing to see in the app.** The app now checks the VESTA Kiosk connection against the same written agreement the Kiosk itself uses (the version and what a message may contain), instead of a copy typed from memory. Its tests fail the moment the two differ, so a change on the Kiosk side can no longer silently break the agent.
- The agent's settings file (`vesta-agent.yaml`) and the app's own start-up state are each read in one place and tested directly.

## 0.7.0

### Added
- **The app now updates itself.** Every hour, the app's build service looks for a newer release of the VESTA Agent (once its repository is set) and of the HA MCP server. When there is one, it builds a new version of this app with it, checks that it starts correctly, and only then does Home Assistant show "Update available". A version that fails the check is never offered. You only press Update.
- **The real VESTA Agent can now be built into the app**, from its own GitHub repository at the release it names: its libraries are installed while the app is built, never on the Home Assistant machine. Until the agent's repository is set, the app keeps the test agent.

### Changed
- The HA MCP server is no longer fixed at one version: it follows HA MCP's releases, each one checked before it is offered (today: 8.5.0).
- The Documentation tab no longer shows internal engineering notes, and explains how a new agent version reaches the app.

## 0.6.0

### Added
- **"Stub heartbeat" now tests the whole connection with the VESTA Kiosk.** Besides showing the agent as online, the stub posts one test message with two buttons (*Looks good* / *Not now*) each time the app starts. Answer it in the Kiosk's VESTA Agent area, and within about 15 seconds this app's log says which button was pressed and by whom — the same path a real agent's question and your decision will take.

## 0.5.2

### Changed
- The help text of **VESTA Kiosk address** no longer says the default is the stable VESTA Kiosk: the dev channel's default is VESTA (dev2).
- The documentation records what was confirmed on the HA Yellow: the app reaches Home Assistant and the VESTA Kiosk by their internal names, uses Home Assistant's time zone, and needs about 142 MB of memory with the HA MCP server running.

## 0.5.1

### Maintenance
- Nothing changes in the app: internal notes in the source were brought up to date.

## 0.5.0

### Added
- **The same app runs outside Home Assistant.** A ready-made `docker compose` setup (`agent-host/standalone/`) runs the identical image on any machine, with settings in a file instead of the Configuration page. For a machine outside the villa, the Cloudflare Access service token is sent with every request to Home Assistant, the HA MCP server and the VESTA Kiosk.
- **Complete documentation** on the Documentation tab: modes, what each log line means, folders, the HA MCP server, restarts, running outside Home Assistant, what the VESTA Agent receives and must follow, and the measured image size and memory use.

### Checked
- Each release is now also checked for never touching the VESTA Kiosk's files, and for a skill added while the app runs being visible at once.

## 0.4.0

### Added
- **The agent's own Home Assistant MCP server now runs inside the app** (HA MCP **8.5.0** — the same version as the development instance; it changes only when deliberately upgraded). It starts when a Home Assistant token is set, is reachable only from inside the app, and the self-test's "HA MCP" line now reports **pass** with the number of tools it offers. In "external" mode it is not started and the given address is checked instead. It does not check for updates on the internet and does not ask HACS to refresh anything.
- **Crash handling.** If the agent (or the stub) stops unexpectedly, it is restarted after 5 seconds, then 10, 20… up to 5 minutes. After 5 crashes within 10 minutes it is no longer restarted: the app stays running, says so in its log, and the VESTA Kiosk will show the agent offline. Restarting the app tries again.
- **Clean stop.** On stop the agent gets the time its manifest asks for (up to 22 seconds) to finish, then the HA MCP server stops — all within the 30 seconds Home Assistant allows.

## 0.3.0

### Added
- **Self-test at every start.** The log now shows one line per connection — Home Assistant, HA MCP, VESTA Kiosk, Anthropic, Telegram and Presence — each marked **pass**, **fail** or **skipped** with the reason. A connection with no key or token yet, or one the other side does not offer yet, is marked skipped, never failed. The result is also saved to the app's data (`selftest.json`).
- **The stub now runs in the agent slot.** It stands in for the VESTA Agent: it confirms it received all its settings, and with "Stub heartbeat" on it tells the VESTA Kiosk every minute that the agent is online.
- **Stub mode always starts,** even when a check fails. **Agent mode waits** until Home Assistant and Anthropic both pass, retrying from every 5 seconds up to every 5 minutes.
- Telegram is only ever asked "who are you" (`getMe`), and only once Telegram takeover is on. It is never asked for messages.

## 0.2.0

### Added
- **The app now reads its settings and checks them when it starts.** The log opens with a short summary: the app version, whether it runs as a Home Assistant app or on its own, and each connection (Home Assistant, HA MCP, VESTA Kiosk, Anthropic, Telegram) with whether its key or token is set. Keys and tokens themselves are never shown; any that appear in a log line are replaced by `***`.
- **Stub mode (the default) starts with nothing configured.** Each missing key is listed as a check that will be skipped. **Agent mode refuses to start** without the Anthropic API key and the Home Assistant token, and says which one is missing.
- **Telegram stays off.** While "Telegram takeover" is off, the bot token is not passed on at all.
- On first start the app creates its folders: `skills` and `agent` under its folder in `/addon_configs` (each with a short README), and its own data folder. Files you edit there are never overwritten.

## 0.1.0

### Added
- **First installable build of the VESTA Agent host.** It installs from the store by downloading a ready-made image (nothing is built on the HA Yellow), starts, and stays idle: the agent slot is empty and no connection is made yet. This release only proves the install path.
