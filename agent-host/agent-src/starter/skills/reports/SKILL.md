---
name: reports
description: The one composer of every VESTA document: the 07:00 FM daily digest (chat), the FM weekly page, the owner weekly three lines, the owner monthly proof (page), on-demand reports from the cache. Carries the "VESTA suggests" proposals. Use on schedule and when someone asks for a report.
---

# reports

You assemble; you do not fetch. The other skills leave JSON files and rows in
the store; you turn them into the document each reader expects, with the
model writing only the headline and nothing that is a number.

## Files

- `scripts/compose.py`   fm-daily, fm-weekly, owner-weekly, owner-monthly
- `templates/`           `vesta.css` (the visual system of the validated mock-ups), `fm_weekly.html`, `owner_monthly.html`
- Inputs: `energy_period.py` JSON (roi-energy), `filtration_optimiser.py` JSON, `proposals.py` JSON, the store

## Cadence and readers

| When (villa time) | Reader | Form | Command |
|---|---|---|---|
| Daily 07:00 | FM | chat, under 4,096 characters, split if longer | `compose.py fm-daily` |
| Monday 08:00 | FM | page (HTML file attached) and its headline in chat | `energy_period.py --period week` then `compose.py fm-weekly --out fm_weekly.html` |
| Monday 08:00 | Owner | three lines in chat | `compose.py owner-weekly --energy week.json` |
| 1st of the month 08:00 | Owner | page (HTML file attached), the monthly proof, and its four numbers in chat | `energy_period.py --period month`, `filtration_optimiser.py`, `proposals.py`, then `compose.py owner-monthly --out owner_monthly.html` |
| Quarterly | Owner | coverage annex (what is measured, what is not, retention) | the coverage block of the monthly, standalone |
| On demand | either | the matching period, from the cache when it exists | the same two steps as the scheduled one (below) |

The FM reads the digest on a phone in the morning: new items first, then the
open tasks with their numbers so a reply "3 done" closes the right one. The
owner reads the monthly as proof that the villa was looked after: what was
found, what was done, what it cost, what VESTA suggests, and how much of the
villa is actually measured (never hide the unmetered share).

## A weekly or monthly page, step by step (on schedule or on request)

1. `roi-energy` `energy_period.py --period week --out week.json` (`--period month --out
   month.json` for the monthly; add `--end YYYY-MM-DD` for a past period).
2. `reports` `compose.py fm-weekly --energy week.json --out fm_weekly.html` (or `owner-monthly
   --energy month.json ... --out owner_monthly.html`). `--energy` is required: without it the
   script stops and says so.
3. `send_message` with `attachment` the page's file name and, as text, the headline and the key
   numbers from the `facts` the script printed. Asked for in a chat: `to: here`, the chat it was
   asked in. On schedule: `to: fm` (weekly) or `to: owner` (monthly).

## Rules

- Every number in a document comes from a JSON the scripts produced. The model
  writes the headline from the `facts` block the composer prints, in the
  reader's language, and touches nothing else.
- A page over two chat messages is sent as its HTML file attached to a short
  message (the headline and the key numbers), not as text. The file is
  self-contained: it opens in the phone's browser, which can print it or save
  it as PDF.
- A load first seen less than 30 days ago is marked "baseline building".
- Muted rules, devices with no room, and missing helpers are listed under
  "monitoring health" and "what would help" so nothing silently disappears.
- Proposals carry their store id; the reply "accept N / later N / ignore N" is
  handled by villa-concierge.
- Once sent, the rendered document is cached by period in the store; a second
  request returns it, with no new computation and no LLM call.

## What the monthly proof must contain, in this order

Light and headline; four numbers (kWh and trend, cost at the villa tariff,
alerts handled and median time to close, share of electricity attributed);
where the electricity went; what VESTA found and what was done; pool
filtration; VESTA suggests; coverage and retention. If a section has no
content, it says so in one line rather than disappearing.
