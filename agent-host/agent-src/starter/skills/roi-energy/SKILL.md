---
name: roi-energy
description: Electricity use and cost of a villa per load and per period (week, month, on demand), the filtration optimiser for pool pumps (volume x turnovers / real flow, schedule proposal versus current), and the "VESTA suggests" proposals with their benefit. Use when the owner asks about consumption or cost, for the weekly and monthly numbers, or when a pool parameter changes.
---

# roi-energy

You turn Home Assistant's long-term statistics into money and decisions for the
owner. Code computes every number; you only phrase. One statistics read per
period, cached: a second question on the same period costs zero tokens.

## Files

- `scripts/energy_period.py`         kWh and cost per load for a period, comparisons, pumps run hours, cache
- `scripts/filtration_optimiser.py`  hours per day and blocks for a filtration pump, from helpers only
- `scripts/proposals.py`             "VESTA suggests" items from the two above and the open findings
- Shared code: `vesta_shared`, part of the engine

## Where the numbers come from

- kWh: daily `change` of every entity in the energy family of the knowledge pack.
  The main meter is the energy asset containing "main" (or `input_text.villa_main_meter`).
  Phase sub-meters and "returned" counters are excluded from the loads.
- Cost: `input_number.electricity_tariff_kwh` and its unit (IDR/kWh). A USD line
  appears when `input_number.villa_fx_idr_per_usd` exists.
- Unmetered remainder: main meter minus the sum of the metered loads. It is
  shown, not hidden: it is the honest coverage of the report and the first
  proposal when it is above 50%.
- Comparisons: same length previous period, and the 30-day daily median before
  the period. A load first seen less than 30 days ago is labelled "measured
  since N days, baseline building" (the pack diff records first sight).

## Filtration optimiser

hours per day = volume x turnovers per day / real flow. The message states
which flow it used: a flow sensor (measured), the pump curve at the measured
draw (medium confidence), or the proportional estimate on the rated point
(low confidence, and it says a flow meter would replace it).

Required helpers, by naming convention `<asset>_<parameter>` where the pool
prefix is the asset slug without `_pump`:

| Helper | Meaning |
|---|---|
| input_number.pool_volume_m3 | pool plus balancing tank |
| input_number.pool_target_turnovers_per_day | usually 2 for a private pool |
| input_number.pool_pump_rated_flow_m3h | from the pump plate at the design head |
| input_number.pool_pump_rated_power_w | from the pump plate |
| input_text.pool_pump_curve | optional JSON [[W, m3/h], ...] |
| input_text.pool_pump_model | optional, for the message |
| input_number.pool_pump_blocks_per_day, input_text.pool_pump_window | optional, default 2 blocks in 07:00-18:00 |

A missing required helper stops the computation with the exact helper name
to create. Nothing is assumed. Changing `pool_volume_m3` changes the
proposal without touching this skill (acceptance test of the plan, step 4).

The timer is manual on this villa: the proposal is a message to the pool
technician; the preventive-maintenance skill then checks the run hours on
the power signature over the following days and reports whether the new
schedule is in place.

## Procedure

- Weekly (Monday, before the reports skill): `energy_period.py --period week --store $VESTA_STORE`.
- Monthly (1st): `--period month`, plus `filtration_optimiser.py` for every asset whose slug ends in `_pump` and whose pool helpers exist, then `proposals.py`.
- On demand ("how much did the pool pump cost last month"): run `energy_period.py` with `--period custom --start --end` or the matching period; answer from the JSON; never estimate from memory.
- Proposals are stored once by title. The owner answers accept / later / ignore in the chat; the concierge skill records the decision (`Store.decide_proposal`). Accepted proposals are tracked in the next reports.

## Waste events

The `roi_` automations in Home Assistant (currently off) fire `vesta_roi_event`
in the logbook when they run. When they do, count them per rule and per week
from the logbook and add them to the period result under `waste_events`. Until
they are enabled, the section says "no waste rules active".

## What not to do

- Do not compare a period with fewer than 5 days of data; say the data is incomplete.
- Do not present the unmetered remainder as "other appliances": it is unknown.
- Do not turn a proposal into an action. Proposals are read by a human.
