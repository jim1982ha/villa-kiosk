---
name: reports
description: The one composer of every VESTA document: the 07:00 FM daily digest (chat), the FM weekly page, the owner weekly three lines, the owner monthly proof (page), on-demand reports from the cache. Carries the "VESTA suggests" proposals. Use on schedule and when someone asks for a report.
---

# reports

The scripts compute every figure (facts.py reads Home Assistant, the store and the
energy period); you write only the sentences reports.yaml asks for, from those
figures; compose.py lays the page out and checks your sentences.

## Files

- `reports.yaml`         the reports: sections and their order, thresholds, the playbook, the words, the sentences you write
- `scripts/facts.py`     every figure of a weekly or monthly page (Home Assistant, the store, the energy period)
- `scripts/compose.py`   fm-daily and owner-weekly (chat text); fm-weekly and owner-monthly (the page, from facts + notes, charts inline)
- `templates/report.html` the page: its style, then one part per section
- `villa.reports.yaml`   (the villa's, optional) its own playbook entries, cards and thresholds; app updates keep it
- Inputs: `energy_period.py` JSON (roi-energy), `proposals.py` (roi-energy, writes the proposals to the store)

## Cadence and readers

| When (villa time) | Reader | Form | Command |
|---|---|---|---|
| Daily 07:00 | FM | chat, under 4,096 characters, split if longer | `compose.py fm-daily` |
| Monday 08:00 | FM | page (HTML file attached) and its headline in chat | the steps below, weekly |
| Monday 08:00 | Owner | three lines in chat | `compose.py owner-weekly --energy week.json` |
| 1st of the month 08:00 | Owner | page (HTML file attached), the monthly proof, and its headline in chat | the steps below, monthly |
| On demand | either | the period asked for (`--end` for a past one) | the steps below |

The FM reads the digest on a phone in the morning: new items first, then the
open tasks with their numbers so a reply "3 done" closes the right one. The
owner reads the monthly as proof that the villa was looked after: what was
found, what was done, what it cost, what VESTA suggests, and how much of the
villa is actually measured (never hide the unmetered share).

## A weekly or monthly report, step by step (on schedule, or started from a chat)

Asked for in a chat ("make the weekly report", "the daily digest"): call `start_job` with `fm-daily`,
`fm-weekly` or `owner-monthly` and tell the person it is on its way. Never make it inside the conversation: the job has its own
brain and spending limit, and it sends the page back to the chat that asked.

You are the analyst here, as a careful property manager would be: the figures are computed for you;
the conclusions are yours.

1. `roi-energy` `energy_period.py --period week --out week.json` (`--period month --out month.json`
   for the monthly; add `--end YYYY-MM-DD` for a past period). For the monthly, first also
   `filtration_optimiser.py --out optimiser.json` and `proposals.py --period-json month.json
   --optimiser-json optimiser.json` (it records the proposals the page shows).
2. `reports` `facts.py fm-weekly --energy week.json --out facts.json` (or `owner-monthly --energy
   month.json`). It prints `to_do`: THE ONE LIST of what needs doing — the playbook's clues and the
   open tasks, merged by device and grouped by kind (one line per device; "4 monitoring devices
   offline" rather than four lines) — each with its playbook guidance (what to look at, what it means,
   what to check, what to ask), and `to_write`: every sentence the page needs, with its instruction.
3. For each line of `to_do`, before you write: look at what its `look_at` says, in Home Assistant
   (ha_get_history for statistics or history, ha_get_logs for the logbook, ha_get_automation_traces,
   ha_get_state). Confirm it, date it, explain it; tie lines together (a pump drawing less power AND
   running as long as before means less water moved, not less running; many devices stopping in the
   same minute is one cause, not many faults). Drop what the data does not support — say so in the
   reading rather than inventing a cause. Say each thing ONCE: the page repeats nothing.
   For every line whose check asks to repair, replace or adjust something (a part, a battery,
   a pump, a relay, a filter, a Wi-Fi link), run web_search once before you write it: look up
   that device's model, or the symptom, and add the most useful link to the sentence (the
   manual, the usual cause, a typical price). These searches are part of the report, not extra
   spending. Use the web to back what Home Assistant shows, never instead of it. If no reliable
   source comes up, write "no reliable source found".
4. Write every sentence of `to_write` in the reader's language: conclusions, not descriptions —
   what it is, what it means, what to do, when, and the question to ask. Your numbers may be your
   own (what you read in Home Assistant); write them as you would to the owner, rounded and dated.
   Save them with `save_file` as `notes.json`: `{"<id>": "<sentence>", ...}`.
5. `reports` `compose.py fm-weekly --facts facts.json --notes notes.json --out fm_weekly.html` (or
   `owner-monthly ... --out owner_monthly.html`). Your readings show as "VESTA's reading"; a slot
   reports.yaml marks `checked: true` is refused if one of its numbers is not in its figures — fix
   it and compose again (once).
6. `send_message` with `attachment` the page's file name and, as text, your headline. Started from
   a chat: `to: here`. On schedule: `to: fm` (weekly) or `to: owner` (monthly).

Spend with care: the job has a spending limit (VESTA Agent page → Rules → AI jobs). Read what the
clues point to, not the whole villa. If the limit stops you, the page is still sent with what is done.

## Rules

- The figures (tiles, tables, charts) come from facts.py. Your sentences are readings: marked as
  VESTA's, with your own numbers; never present a guess as a measurement.
- A page over two chat messages is sent as its HTML file attached to a short
  message (the headline and the key numbers), not as text. The file is
  self-contained: it opens in the phone's browser, which can print it or save
  it as PDF.
- Devices with no room and missing helpers are listed under
  "monitoring health" and "what would help" so nothing silently disappears.
- Proposals carry their store id; the reply "accept N / later N / ignore N" is
  handled by villa-concierge.
- Asked again, make the page again: the figures and this skill may have changed.

## What each page contains

`reports.yaml`: `reports:` the sections of each page, in order, and which ones ask you for a
sentence; `playbook:` the situations to recognise and how to read them; `nothing_happened:` the
words for what did not happen. Money left on the table, the night standby and the
monitoring uptime show "not measured yet" until their calculation is agreed.
