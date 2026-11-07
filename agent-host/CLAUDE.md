# VESTA Agent (`agent-host/`)

A Home Assistant app hosting the VESTA Agent: the host (`rootfs/opt/vesta/host`) starts the agent (`agent-src/`) from
its manifest. Commands and release: the repository's `CLAUDE.md`. Module map and verified facts: `ARCHITECTURE.md`
(read the entry for the module you touch).

## Hard rules

- **The siren needs a human, always.** No script, skill, automation, AI answer, schedule, timer, restart or default
  sounds a siren. Only a person's own press for that sounding (the owner's Approve, the tablet's confirmation, the
  villa's siren control); an expired, unanswered or refused request sounds nothing. Stopping one needs no one. A change
  touching anything that could reach a siren proves by a check that it still cannot sound without that press.
- **Skills before code.** Whatever a skill can define (what is computed, thresholds, sections, wording, prompts, which
  scripts run, which automations are alerts, routes) lives in the skill, never in `vesta_agent/`. A missing threshold
  is named, never guessed. Changing a starter skill records its fingerprint (`ship` does it).
- **Never in the critical path.** A critical alert reaches Telegram and the tablet without the Agent: the villa's
  system formats and sends its own, with a plain-text fallback. The Agent listens, translates and adds; it never blocks
  a notification, and what it cannot translate stays original. Never make a blueprint wait on the Agent.
- Nothing villa-specific in shipped code; real-data tests live in `agent-src/tests/villa/` (gitignored).
- Never touch Kiosk files (`check_isolation.sh`); `rootfs/opt/vesta/host/agent-contract.json` is the Kiosk's, copied
  by `ship`, never edited here.
- No secret in a log, a file under `/config`, the repository or CI. No Telegram call unless `telegram_takeover`.
- Images are built by GitHub Actions only, never on the villa. Pin Actions by commit SHA.
