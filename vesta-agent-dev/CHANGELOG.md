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
