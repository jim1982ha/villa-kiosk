# VESTA Agent

The Home Assistant app that runs the **VESTA Agent**: the villa's assistant on
Telegram. It reads Home Assistant, follows up the critical alerts of the VESTA
rules, records jobs for the facility manager in the VESTA Kiosk, writes the
daily, weekly and monthly reports, and **asks before any action**: every
action is an Approve / Refuse button pressed by a registered person.

It has one page, **VESTA Agent** in Home Assistant's sidebar (administrators
only), to edit its rules and its skills. Nothing else connects to it: no port
is opened, and the page is reachable only through Home Assistant's own login.
It is installed by downloading a ready-made image; nothing is built on the HA
Yellow.

## The VESTA Agent page

In the sidebar, **VESTA Agent**. It opens on:

- **Overview** — whether the rules and the skills have a problem, and the last
  24 hours: alerts followed, buttons pressed, actions, replies, AI cost,
  failures, scheduled jobs run.
- **Rules** — `policy.yaml` as forms: acting on or off, the people, the chats,
  what the agent may do and who decides (`any`, `owner`, `listed`, `direct`),
  the protected devices, the allowed lists, the AI settings. **The file** shows
  the whole file for everything else. The file's comments are kept.
- **Skills** — every skill, on or switched off (and why). Open one to edit its
  files; add a file, delete one, create a skill, delete a skill (kept in
  `skills/.trash`, it does not come back by itself).

Every save is checked first with the agent's own rules: a change the agent
would refuse or misread is not written, and the page says why. If the file was
changed elsewhere since you opened it (Studio Code Server), the save is refused
rather than overwriting that change. A saved change counts within seconds, no
restart. The page keeps working while the agent is stopped, so a file that
stops the agent can be fixed from it.

## Modes

- **stub** (default) — a self-test of every connection, and nothing else.
  Starts with nothing configured.
- **agent** — runs the VESTA Agent. Needs the Anthropic API key and the Home
  Assistant token; without them the app stops at once and its log says which
  setting is missing. The agent starts once Home Assistant and Anthropic both
  answer.

## Before the first start in agent mode

1. **The "VESTA Agent" Home Assistant user.** Settings → People → Users → Add
   user, named "VESTA Agent":
   - **Administrator: ON.** The agent reads automation settings and traces,
     templates and system logs, which Home Assistant keeps for administrators.
     It changes nothing without an approved button: its own code refuses
     every other write.
   - **Active: ON** and **Can only log in from the local network: ON**, with
     a long random password nobody keeps. Do not deactivate the user or turn
     its login off: Home Assistant refuses the token of a user that cannot log
     in, and the agent would lose Home Assistant.
   - Log in as that user once, then its profile → Security → **Long-lived
     access token**: that is the *Home Assistant token* below.
2. **The Anthropic API key** (from the Anthropic Console).
3. **The VESTA Kiosk.** In the Kiosk's configuration, turn the agent on and set
   its agent token; put the same value in *VESTA Kiosk agent token* here. The
   dev channel talks to VESTA (dev2).
4. **Telegram.** The villa bot's token, and *Telegram takeover* ON — on **one**
   app only (the dev app while testing, the stable one after).

Keep backups encrypted if they leave the machine: they hold these tokens.

## Configuration

| Field | What to put |
|---|---|
| Agent mode | `agent` |
| Anthropic API key | the key |
| Home Assistant address | keep the default on the same machine |
| Home Assistant token | the VESTA Agent user's long-lived token |
| VESTA Kiosk address | keep the default |
| VESTA Kiosk agent token | the same value as in the Kiosk |
| Telegram takeover | ON on one app only |
| Telegram bot token | the villa bot's token |
| Log level | `info` |

## First start

The log shows the start summary (never a key or token), one self-test line per
connection, then the agent:

```
Starter skills copied to the skills folder (first start): alert-desk, preventive-maintenance, reports, roi-energy, villa-concierge
Skills: alert-desk, preventive-maintenance, reports, roi-energy, villa-concierge
Telegram: sending as @<the bot> (Home Assistant receives; the agent reads its events)
VESTA Kiosk: agreement 1
HA MCP: 77 tools on the server, 15 shown to the model
policy.yaml has no people yet: the agent answers nobody. ...
Acting on the villa is OFF (informs only)
```

**Register the people.** In each chat the agent should use (a private chat
with the bot, the villa group), each person sends `/whoami`; the bot answers
with their Telegram id and the chat id. Then, on the VESTA Agent page, **Rules**
(or the file `/addon_configs/<id>_vesta_agent[_dev]/agent/policy.yaml` with
Studio Code Server): `people` (id, name, role `owner` or `fm`, language) and `chats`
(`owner`, `fm`: a group id is a negative number). Saved changes apply within
seconds, no restart. The same file holds the owner-only devices, the allowed
actions and the agent's settings (AI model, limit per reply, web search).

## Telegram

**Home Assistant stays the one receiver of the villa bot, for good.** The agent
reads what the bot receives from the events Home Assistant already fires
(`telegram_text`, `telegram_command`, `telegram_callback`), and only sends. So
nothing Home Assistant does with Telegram changes, whether the agent runs or
not: its alerts, the doorbell's gate button, any automation that waits for a
Telegram button.

- In a private chat, the agent answers any message from a registered person.
- In a group, it answers a message that mentions the bot, a reply to one of its
  own messages, or `/ask …`. Anything else is dropped by its code, unread by
  the AI. (A mention reaches it only while the bot is a group administrator;
  replies and commands always do.)
- It answers only the chats listed in `policy.yaml`, and never leaves a group.
- A button press on a Home Assistant message (the gate) is left to Home
  Assistant; the agent handles only the buttons of its own messages.
- An alert's buttons disappear once one is pressed; the message then says who
  answered, what, and at what time. The answer goes to the chat where the
  button was pressed.
- Messages are plain text: Telegram shows exactly what is written.
- Ask it "what did you do last night?": it reads its own record (the jobs run,
  the alerts followed, the buttons pressed, the tickets, the cost).
- `/new` starts a new conversation; a reply that reaches the cost limit stops
  and offers a **Continue** button.

## What it does on its own

| When | What | AI (cost) |
|---|---|---|
| A VESTA rule fires | the alert follow-up: the facility manager gets the alert with Done / Not found / Need help / Mute, a ticket in the Kiosk; a reminder after 15 min, the owner after 45 min; closed when Home Assistant says it cleared | No |
| Every 2 min | presence in the VESTA Kiosk (online / offline) | No |
| 01:30 · 02:00 | inventory of Home Assistant, the night's maintenance checks, a ticket per job, anything urgent to the facility manager at once | No |
| 07:00 | the facility manager's daily digest (also the agent's daily sign of life) | Yes |
| Monday 08:00 | the facility manager's weekly page (a file attached to the message) and three lines for the owner | Yes |
| 1st of the month 08:00 | the owner's monthly report (a file attached to the message) | Yes |

These times come from the skills (below): changing them is a skill edit.

The weekly and monthly reports arrive as a message with the headline, and the
full report as an attached page (`.html`): tap it and the phone opens it in its
browser, which can also print it or save it as PDF.

**What a report shows** is set in the reports skill's `reports.yaml` (VESTA
Agent page → Skills → reports): the sections of each report and their order,
the thresholds (a battery to replace, a pump to watch…), the sentences the AI
writes, and "what would help". Every figure is computed from Home Assistant
(its statistics, states and, for the VESTA rules that fired, its logbook — kept
about 10 days) and the agent's records. The AI writes only the sentences
`reports.yaml` asks for, and a sentence with a number that is not among its
section's figures is refused. A threshold missing from the file is named in the
report ("parameter missing"), never guessed. Money left on the table, night
standby and monitoring uptime show "not measured yet" for now.

**A skill run from a chat behaves exactly like a scheduled one**: its Kiosk
faults are created and its messages go to their usual chats, and the agent also
answers in the chat where it was asked. A fault that a task never got (the
Kiosk was off, for example) is created at the next start and every night. An
alert always starts from Home Assistant: the AI cannot run the alert desk.

If Home Assistant cannot be reached for 30 minutes, both chats get "Villa
silent"; the next contact closes it.

## Skills: edit, add, delete — no code, no rebuild

`/addon_configs/<id>_vesta_agent[_dev]/skills/` holds one folder per skill:
`SKILL.md` (what the agent reads), `skill.yaml` (its scripts, their options,
its schedule) and `scripts/`. The agent reads the folder at every use: a change
counts at once. Edit them on the VESTA Agent page (**Skills**), or as files
(Studio Code Server, Samba): to remove a skill, delete its folder; to add one,
copy a folder and edit it. The `README.md` in that folder explains `skill.yaml`. A
`skill.yaml` the agent cannot read switches that skill off alone, and the log
says why.

App updates never touch a skill you edited. A starter skill you never edited
follows the app: when an update brings a new version of it, it is replaced, and
the log says `Starter skills updated to this version (never edited here): …`.
If you edited it, yours is kept, the log says so, and the new version is put in
`skills/.starter/` to compare. A deleted skill stays deleted.

## Acting on the villa

Off at first (`act_enabled: false` in `policy.yaml`). Once on, an action asked
in a chat sends Approve / Refuse to the person allowed to decide: lights,
covers, fans and the listed switches by the owner or the facility manager; the
owner-only devices (locks, the gate, the siren) by the owner only. Never,
whatever the file says: restarting Home Assistant, shell or REST commands,
scripts not listed, MQTT, updates, the recorder, any toggle, triggering or
reloading automations. A button works once, for 15 minutes, for the exact
action shown.

Each service in `allowed_services` has one rule:

| Rule | Who decides |
|---|---|
| `any` | the owner or the facility manager, with Approve / Refuse |
| `owner` | only the owner, with Approve / Refuse |
| `listed` | only the devices named in the file's lists (`switch_entities`, `scene_allowlist`, `script_allowlist`, `button_allowlist`), then as `any`; any other device is refused |
| `direct` | no buttons: done at once when a person listed in `people` asks in a chat, and the answer says whether it worked. A scheduled job or an alert still asks, and an owner-only device still waits for the owner |

For example, `light.turn_on: direct` and `light.turn_off: direct` switch
lights without an approval.

## Log lines

| Line | Meaning |
|---|---|
| `Setting missing: …` | a field of the Configuration page is empty |
| `The VESTA Agent is waiting: …` | the Anthropic key or the HA MCP server is missing: nothing runs until fixed |
| `Skill <name>: skill.yaml refused (…)` | that skill is off until its file is fixed |
| `Home Assistant events: connection lost …` | retried every 5 s up to 5 min; after 30 min the chats get "Villa silent" |
| `Home Assistant events: Home Assistant refused the VESTA Agent token` | the token is wrong or was revoked |
| `VESTA Kiosk: …` | the Kiosk's agent interface is off, or the token differs |
| `Telegram: off` | *Telegram takeover* is off: nothing is sent |
| `Unregistered sender: id …` | someone not in `policy.yaml` wrote to the agent |
| `Alert received: opened — …` | Home Assistant sent a critical alert; the next line says what the agent did with it |
| `Alert handled by alert-desk: new, incident #…` | the follow-up started (`repeat`, `counted`, `muted`, `resolved`, `abandoned` otherwise) |
| `Sent to chat … (fm chat)` | one message sent, and to which chat |
| `Button Done on incident #… pressed by …` | someone answered an alert |
| `Kiosk ticket … created / resolved` | a fault in the Kiosk's Facility records |
| `Answered … in chat … (0.012 USD)` | a conversation reply and what it cost |
| `Kiosk tickets created for N open task(s) that had none` | missing faults repaired (at start, every night) |
| `A message for 'fm' had nowhere to go` | a skill addressed a chat `policy.yaml` does not set |
| `Skill <name>: <script> failed (exit …): …` | a skill's script stopped; the end says why |
| `policy.yaml: …` | something in the file the agent ignores (a misspelt section, a person without an id) |
| `UI: policy.yaml saved` · `UI: skill …` | a change made on the VESTA Agent page |
| `UI: refused a connection from …` | something other than Home Assistant's sidebar tried to open the page |

## Folders

| In the app | In Home Assistant | Content |
|---|---|---|
| `/config/skills` | `/addon_configs/<id>_vesta_agent[_dev]/skills` | the skills — edit here |
| `/config/agent` | `/addon_configs/<id>_vesta_agent[_dev]/agent` | `policy.yaml`, `instructions.md` |
| `/data/agent` | app data | conversations, approvals, incidents, reports |
| `/data/host` | app data | `selftest.json`, `crashes.json`, `last_start.json` |

All are kept across restarts and updates and included in backups, except the
agent's scratch folders (`agent/work`, `agent/out`).

## HA MCP server

The agent's own HA MCP server runs inside the app, with the VESTA Agent user's
token, on `127.0.0.1:9583` — reachable only from inside the app. It updates
itself: every hour the app's build service looks for a newer HA MCP release,
builds a new version of this app with it, checks that it starts, and only then
does Home Assistant offer the update.

## Restarts and stop

- A crashed agent restarts after 5 s, doubling to 5 min; a run longer than
  10 min resets the delay. After 5 crashes within 10 min it is no longer
  restarted; the app says so, and the Kiosk shows the agent offline.
  Restarting the app tries again. Nothing in a chat can restart or stop it.
- On stop the agent gets up to 20 s to finish; everything fits in the app's
  30 s.

## Running outside Home Assistant

The same image runs as a plain container: `VESTA_OPT_<OPTION>` environment
variables instead of the Configuration page. A ready-made setup is in
`agent-host/standalone/`. Remote deployments also set
`VESTA_CF_ACCESS_CLIENT_ID` and `VESTA_CF_ACCESS_CLIENT_SECRET`.

## For the VESTA Agent's developer

The agent's source is `agent-host/agent-src/` in this repository; the app's
build installs it (its `vesta-agent.yaml`). It receives only these variables
(and `PATH`, `HOME` = `/data/agent`, `LANG`):

| Variable | Content |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key |
| `VESTA_HA_URL`, `VESTA_HA_TOKEN` | Home Assistant and the VESTA Agent user token |
| `VESTA_HA_MCP_URL` | the sidecar, `http://127.0.0.1:9583/mcp` |
| `VESTA_KIOSK_URL`, `VESTA_KIOSK_TOKEN` | VESTA Kiosk agent interface and its token |
| `VESTA_CF_ACCESS_CLIENT_ID`, `VESTA_CF_ACCESS_CLIENT_SECRET` | empty on the Yellow; set when remote |
| `VESTA_TELEGRAM_ENABLED` | `true` / `false` |
| `VESTA_TELEGRAM_BOT_TOKEN` | present **only** when enabled |
| `VESTA_SKILLS_DIR`, `VESTA_AGENT_CONFIG_DIR`, `VESTA_DATA_DIR` | `/config/skills`, `/config/agent`, `/data/agent` |
| `VESTA_LOG_LEVEL`, `TZ` | log level; Home Assistant's time zone |
| `VESTA_DEPLOYMENT`, `VESTA_INSTANCE` | `ha_app`/`standalone`; `dev`/`prod` |

```yaml
name: vesta-agent
version: "x.y.z"
runtime: python
install: "pip install --no-cache-dir -r requirements.txt"   # run at image build, never on the Yellow
install_files: [requirements.txt]   # the only files `install` sees: libraries rebuilt only when these change
start: "python -m vesta_agent"
stop_grace_seconds: 20              # at most 22
system_packages: []                 # Debian packages, installed at image build
```

The image stacks what changes least first and the agent's code last, so an
update that changes only the code downloads only the code.

## Resources

| | Measured |
|---|---|
| Image, unpacked | about 530 MB (0.9.2; 1.1 GB in 0.9.0–0.9.1 with the PDF browser) |
| An update that changes only the agent's code | its code: under 1 MB |
| Idle memory | to measure on the HA Yellow (0.8.0, stub + HA MCP: about 142 MB) |

The largest parts are the Claude program the agent runs on (about 230 MB) and
the HA MCP server (about 100 MB); both change rarely.
