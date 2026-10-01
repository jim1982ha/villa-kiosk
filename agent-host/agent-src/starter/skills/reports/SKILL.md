---
name: reports
description: The one composer of every VESTA document: the 07:00 FM daily digest (chat), the FM weekly page, the owner weekly three lines, the owner monthly proof (page), on-demand reports from the cache. Carries the "VESTA suggests" proposals. Use on schedule and when someone asks for a report.
---

# reports

The scripts compute every figure (facts.py reads Home Assistant, the store and the
energy period); you write only the sentences reports.yaml asks for, from those
figures; compose.py lays the page out and checks your sentences.

## Files

- `reports.yaml`         the reports: sections and their order, thresholds, the sentences you write, "what would help"
- `scripts/facts.py`     every figure of a weekly or monthly page (Home Assistant, the store, the energy period)
- `scripts/compose.py`   fm-daily and owner-weekly (chat text); fm-weekly and owner-monthly (the page, from facts + notes)
- `scripts/charts.py`    the page's charts (inline SVG)
- `templates/`           `report.html`, one `blocks/<section>.html` per section, `vesta.css`
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

## A weekly or monthly page, step by step (on schedule or on request)

1. `roi-energy` `energy_period.py --period week --out week.json` (`--period month --out month.json`
   for the monthly; add `--end YYYY-MM-DD` for a past period). For the monthly, first also
   `filtration_optimiser.py --out optimiser.json` and `proposals.py --period-json month.json
   --optimiser-json optimiser.json` (it records the proposals the page shows).
2. `reports` `facts.py fm-weekly --energy week.json --out facts.json` (or `owner-monthly --energy
   month.json`). It prints `to_write`: each sentence the page needs, with its instruction and the
   only figures you may use for it.
3. Write every sentence of `to_write`, in the reader's language, and save them with `save_file` as
   `notes.json`: `{"<id>": "<sentence>", ...}`. Use only the figures given with that id — a number
   that is not among them gets the sentence refused. Plain words; no rule codes, no entity ids.
4. `reports` `compose.py fm-weekly --facts facts.json --notes notes.json --out fm_weekly.html` (or
   `owner-monthly ... --out owner_monthly.html`). It says which sentences it used and which it
   refused and why: fix and save the refused ones, then compose again (once).
5. `send_message` with `attachment` the page's file name and, as text, your headline sentence.
   Asked for in a chat: `to: here`, the chat it was asked in. On schedule: `to: fm` (weekly) or
   `to: owner` (monthly).

## Rules

- Every number in a document comes from facts.py. You write only the sentences
  `to_write` asks for, from their own figures; compose.py checks every number.
- A page over two chat messages is sent as its HTML file attached to a short
  message (the headline and the key numbers), not as text. The file is
  self-contained: it opens in the phone's browser, which can print it or save
  it as PDF.
- Muted rules, devices with no room, and missing helpers are listed under
  "monitoring health" and "what would help" so nothing silently disappears.
- Proposals carry their store id; the reply "accept N / later N / ignore N" is
  handled by villa-concierge.
- Asked again, make the page again: the figures and this skill may have changed.

## What each page contains

`reports.yaml`, `reports:`: the sections of each page, in order, and which ones
ask you for a sentence. Money left on the table, the night standby and the
monitoring uptime show "not measured yet" until their calculation is agreed.
