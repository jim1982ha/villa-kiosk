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
