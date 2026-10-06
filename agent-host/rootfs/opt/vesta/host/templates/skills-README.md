# VESTA Skills

One folder per skill. The VESTA Agent reads this folder at every use: a skill
added, edited or deleted here counts at once — no restart, no rebuild, no code.

A skill folder holds:

- `SKILL.md`    what the agent reads before doing the skill's job
- `skill.yaml`  what the agent runs, and when:
  - `tools:` the tools the AI needs for this skill (`[ha_get_state, send_message]`):
    its reports get only these, among those switched on (VESTA Agent page →
    Rules → What the AI can use), and the skill shows "Not working" while one
    of them is switched off. Left out: everything switched on.
  - `scripts:` the only scripts the agent may run, and the options each accepts
    (`commands:` a list, or `{status: "what it does", ...}` — the page shows it)
  - `schedule:` jobs at a time — `"07:00"` daily, `"Mon 08:00"` weekly,
    `"1 08:00"` monthly; `prompt:` for a job the AI writes, `run:` for a
    script-only job (no AI, no cost). An AI job also has a `name`: its brain
    and spending limit are set under that name in policy.yaml (`settings.jobs`,
    VESTA Agent page → Rules → AI jobs), and a job not set there does not run.
    Optional: `to` (owner/fm), `on_request: true` (a person may ask for it in a
    chat), `default` (what the page offers), `on_limit` (a script step that
    still finishes the work when the limit stops the job)
  - `every_5_min:`, `on_event:`, `on_reply:` for the alert desk
- `scripts/`    the skill's Python scripts, and anything they read

To change a skill, edit its files. To add one, copy a folder, rename it and
edit it. To remove one, delete its folder: its schedule stops with it.

A `skill.yaml` the agent cannot read switches THAT skill off, and the app's log
names the file and the problem. The others keep working.

The five starter skills were copied here once, at the first start
(`.seeded` records it). An app update brings a new version of a starter skill
you never edited; one you edited is kept (the new version is left in
`.starter/` to compare); a deleted skill never comes back. A file named
`villa.*` in a skill (for example `reports/villa.reports.yaml`) is the villa's
own: it does not count as an edit, and updates keep it. `villa.skill.yaml` holds
this villa's choices made on the page: the commands the AI may not run
(`off_commands: {concierge.py: [find]}`).

The VESTA Agent page's Skills tab switches a skill on or off (policy.yaml
`skills_off`: an off skill has no schedule and is not read), compares an
edited starter skill with the release, and tries a command on the live villa.

This folder belongs to you and the agent: the VESTA Agent host created it once
and never overwrites anything in it. It is included in Home Assistant backups.
