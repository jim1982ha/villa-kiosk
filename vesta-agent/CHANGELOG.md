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
