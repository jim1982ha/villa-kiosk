---
name: investigate
description: Find out what happened and why, from Home Assistant's records, and answer in the chat with the full account — timeline, evidence, causes ranked by likelihood, what cannot be known, and what would have warned earlier.
---

# investigate

Use this skill when a person asks what happened, why, since when, for how long, what caused something, what turned
something on or off, or asks you to check the logs or the history — about any device, room or event, now or in the
past (a flood, a power cut, a pump or a heater that ran too long, a door, an alarm, a strange bill, a device that
stopped). It is not for "is everything OK now?" (villa-concierge) nor for a report (reports).

The person wants the TRUE and COMPLETE story, not a quick reply. Take the time to read; then answer once, completely.

## Files

- `scripts/investigate.py`   find · timeline · around — reads Home Assistant and returns short, checked facts.
  It never changes anything. Times are the villa's.

## The procedure — follow every step

1. **Pin down the question.** Which device, room or event; which day and hours (turn "yesterday", "on the 9th",
   "last night" into villa dates with the date and time at the top of the message). If the person gave no time, start
   from the last 7 days and find the moment yourself (step 3 shows it). Ask a question only when you cannot tell which
   device or which day at all — one question, then stop.

2. **Find the devices — and their neighbours.**
   `run_skill_script investigate investigate.py find --what "<words of the person>"` (add `--where "<room>"` if said).
   Keep the entities that measure or control the thing asked about (its power, its state, its switch, its sensor).
   Also keep from its "same physical device" and "same room" lists anything that could share a supply or a cabinet:
   a device next to it that stopped at the same moment is evidence of a common cause (a breaker, a power cut).
   If find gives nothing useful, try other words (the device type, the room) before saying so.

3. **Read what they did, against their normal.**
   `run_skill_script investigate investigate.py timeline --entities <ids, separated by commas> --start <…> --end <…>`
   - The period: from at least 2 hours BEFORE the first sign of trouble to AFTER things were back to normal (or now).
     When the moment is unknown, read the whole day or days first, then narrow on what stands out.
   - At most about 5 ids in one `--entities` (it is a short text); repeat `--entities` for more. Only ids from find
     (sensor.…, switch.…), never words. A date alone is a whole day: `--start 2026-10-09 --end 2026-10-09` reads the
     9th from 00:00 to midnight.
   - Each line flagged "⟵" is unusual against the device's own normal (the days before): a run far longer than any
     before, a level 1.5× or more its normal, exactly 0 where it normally reads a little (its supply was off), no
     answer, stop-start cycling. These flags are the backbone of your answer.
   - Read the normal line: how often and how long it usually runs. "Longest normal run 10 s" against "ran 1 h 46 min"
     is the kind of contrast the person needs.

4. **Read everything else recorded then.**
   `run_skill_script investigate investigate.py around --start <…> --end <…> --entities <the ids you focus on>`
   It lists the automations that ran, devices that stopped answering and came back (with times), notifications sent,
   doors, locks, switches, people, and the VESTA Agent's own alerts. Match times to the timeline: a device dropping off
   79 seconds after another stops, an automation that ran at the moment a device turned on, a person arriving.

5. **Check what acts on it.** For each automation that ran on or around the device, or that should have warned
   (search with ha_search the device's name or words like its type), read it with ha_config_get_automation and, for a
   run at the moment that matters, ha_get_automation_traces. Answer: did anything in Home Assistant turn it on or off?
   Which rule saw it, and why did it (not) warn? If nothing in Home Assistant acted, say what did: a person, the
   device's own control (a pressure switch, a thermostat, a timer), or a power cut.

6. **Fill the gaps with the raw tools only where needed:** ha_get_history for an entity the script did not read,
   ha_get_logs (logbook) for a minute that matters, ha_get_state for how things are now.

7. **Reason, before writing.** For each unusual thing, ask what physically explains it. Keep several causes when the
   evidence allows several, rank them, and say for each what points to it and what would confirm it. Separate clearly:
   what Home Assistant SHOWS (measured, with times) · what it most likely MEANS · what it CANNOT tell (no sensor there,
   no reading, a gap). Never present a guess as a measurement. Then: what would have warned earlier or limited the
   damage (a missing sensor, an alert on how long something runs, a rule that only watches the opposite case, a switch
   that does not actually control the device).

## The answer — in the chat, complete

Write it as one complete account, the first thing the person reads. It may be long: the agent sends it in as many
messages as needed. Plain text (Telegram shows no Markdown: no **, no #, no tables). Use these parts, each headed by its
name on its own line:

    WHAT HAPPENED
    One to three sentences: the essence, with the key times and durations.

    TIMELINE (villa time)
    - 02:40 The water heater starts and does not stop (normally it runs about 20 min at a time).
    - 03:15 It draws twice its normal power (about 4,000 W against 2,000 W).
    - … one line per moment that matters, before, during and after, in order.

    WHAT IT MOST LIKELY MEANS
    The causes, most likely first, each with the evidence for it and how to confirm it on site.

    WHAT HOME ASSISTANT CANNOT TELL
    What no sensor saw, gaps in the records, what only a person on site can check.

    WHAT WOULD HAVE WARNED EARLIER
    Concrete: which alert, which sensor, which change — and how much earlier it would have warned.

    HOW I CHECKED
    One line: what you read (devices, the period, logbook, automations), so the person can trust it or ask for more.

Rules for the answer:
- Every number and time comes from a script or a tool. Give units (W, kWh, °C, min). Times as "03:09", with the date
  when the account spans several days.
- Devices and rooms by their names, never an entity id or a rule code.
- Say "I could not read …" for anything that failed, and what that leaves uncertain.
- Do not create a fault or a ticket instead of answering. At the end, you may OFFER one sentence of next step (an
  alert to add, a check to do on site) — offer, never do it unasked.
- Do not make an HTML page unless the person asks for one.
