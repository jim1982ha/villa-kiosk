---
name: investigate
description: Find out what happened and why, from Home Assistant's records — answered with a short message and the whole account (timeline, charts, causes ranked by likelihood, what cannot be known, what would have warned earlier) as an HTML page.
---

# investigate

You are here because the person wrote /investigate with their question: find out what happened, why, since when,
for how long, what caused it or what turned it on or off — about any device, room or event, now or in the past (a flood,
a power cut, a pump or a heater that ran too long, a door, an alarm, a strange bill, a device that stopped).

The person wants the TRUE and COMPLETE story, not a quick reply. Take the time to read; then answer once, completely.

## Files

- `scripts/investigate.py`   find · timeline · around — reads Home Assistant and returns short, checked facts.
  It never changes anything. Times are the villa's.
- `settings.yaml`             what counts as unusual (a villa's own villa.settings.yaml may change it)

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
   Read every on/off control found next to it (a switch, a relay, a light, a valve…) in the SAME timeline as the
   device: the timeline then says whether that control could have turned it on (step 3).
   If find gives nothing useful, try other words (the device type, the room) before saying so.

3. **Read what they did, against their normal.**
   `run_skill_script investigate investigate.py timeline --entities <ids, separated by commas> --start <…> --end <…>`
   - The period: from at least 2 hours BEFORE the first sign of trouble to AFTER things were back to normal (or now).
     When the moment is unknown, read the whole day or days first, then narrow on what stands out.
   - At most about 5 ids in one `--entities` (it is a short text); repeat `--entities` for more. Only ids from find
     (sensor.…, switch.…), never words. A date alone is a whole day: `--start 2026-10-09 --end 2026-10-09` reads the
     9th from 00:00 to midnight.
   - Each line flagged "⟵" is unusual against the device's own normal (the days before): a run far longer than any
     before, a level well above or below its normal, exactly 0 where it normally reads a little (its supply was off),
     no answer, stop-start cycling — each line says by how much (the limits are in settings.yaml). These flags are the
     backbone of your answer.
   - Read the normal line: how often and how long it usually runs. "Longest normal run 10 s" against "ran 1 h 46 min"
     is the kind of contrast the person needs.

4. **Read everything else recorded then.**
   `run_skill_script investigate investigate.py around --start <…> --end <…> --entities <the ids you focus on>`
   It lists the automations that ran, devices that stopped answering and came back (with times), notifications sent,
   doors, locks, switches, people, and the VESTA Agent's own alerts. Match times to the timeline: a device dropping off
   79 seconds after another stops, an automation that ran at the moment a device turned on, a person arriving.

5. **Check what acts on it — from what things CAN do, never from their running at the time.**
   - A control the timeline marks "stayed off for the whole period … it is NOT what turned it on" is not a cause: a
     control that never left "off" turned nothing on. Never write that it "controls" the device.
   - `around` says under each automation that ran what it is ABLE to do. "Switches nothing" means it cannot have
     turned anything on or off: it only watched — say what it saw, never that it "misfired". "CAN change things"
     lists what it could switch: only those can be a cause, and only if its run matches the moment. "Not proven either
     way" (its actions could not be read) is never a cause without other evidence: say it could not be checked.
   - For an automation that should have warned, read it with ha_config_get_automation: which case does it watch, and
     why did it (not) warn?
   - If nothing in Home Assistant acted, say what did: a person, the device's own control (a pressure switch, a
     thermostat, a timer), or a power cut. For every long or unusual run, ask both directions: did the device cause the
     damage, or did the damage keep it running (water escaping keeps a pump running; an open window keeps cooling on)?

6. **Fill the gaps with the raw tools only where needed:** ha_get_history for an entity the script did not read,
   ha_get_logs (logbook) for a minute that matters, ha_get_state for how things are now.

   **Search the web (web_search) when the records alone cannot explain what they show** — never instead of them:
   - the device's manual, or the known failure modes of its make and model (its name and model are in its Home
     Assistant device: ha_get_device) — how its own control behaves (a pressure switch, a thermostat, a protection);
   - what an error code, or a pattern of readings, means for that kind of device;
   - an outside event at that time and place (a storm, a grid outage) when several devices stopped together.
   Every time and number still comes from Home Assistant: the web only explains them. Say where it came from ("the
   maker's manual says…"). Do not search for what the records already answer, nor for anything about the people.

   **Web research — only when the message says "Web research: ON"** (the person asked for it in their own words):
   once the timeline and `around` are read, describe the pattern you found in general words (the kind of device and
   what it did, e.g. "a pump that runs without stopping, then its circuit's protection trips") and search the web for
   its known causes, the correlations that usually go with it, and any outside event at that time (weather, grid).
   - At most 5 searches. Never the villa's name, its address, a person, or a device's name in a search: the pattern,
     the kind of device and its make and model only; for weather or a grid outage, at most the town.
   - Every lead found is a QUESTION for the records, never an answer: for each, say what the records show for or
     against it. In the account, each such cause carries "source" (where it came from) and "verdict": consistent
     (the records fit it), not supported (the records contradict it — say so, keep it in the list as ruled out) or
     cannot tell (no record can judge it — say what would).
   - Nothing from the web replaces a time or a number from Home Assistant. In "checked", say web research was on and
     how many searches you made.
   When the message says "Web research: off", do none of this: the web only for a manual or an error code (step 6).

7. **Reason, before writing.** For each unusual thing, ask what physically explains it. Keep several causes when the
   evidence allows several, rank them, and say for each what points to it and what would confirm it. Separate clearly:
   what Home Assistant SHOWS (measured, with times) · what it most likely MEANS · what it CANNOT tell (no sensor there,
   no reading, a gap). Never present a guess as a measurement. Then: what would have warned earlier or limited the
   damage (a missing sensor, an alert on how long something runs, a rule that only watches the opposite case, a switch
   that does not actually control the device).

## The answer — a short message, and the whole account as a page

The person reads a SHORT message in the chat and opens the page for the rest (owner, 2026-10-11: "the response in the
chat bubble shall be much more synthetic and shorter"). The page is made by the reports skill, so it looks like every
report the agent sends.

8. **Save the account** with save_file, as `investigation.json` — plain sentences, no Markdown:

       {"title": "Water heater on the night of 9 October",     (at most 90 characters)
        "summary": "4 to 6 sentences, at most 750 characters: what happened (the key times and durations, against
                    the device's normal), the most likely cause and what points to it, what to check on site first,
                    and what would have warned earlier. It is the whole chat message: the details go in the other
                    fields, which make the page.",
        "timeline": [{"time": "09/10 02:40", "text": "The water heater starts and does not stop (normally about
                      20 min at a time).", "unusual": true}, … one per moment that matters, before, during, after],
        "causes": [{"cause": "…", "evidence": "what in the records points to it", "confirm": "how to confirm on site"},
                   … most likely first; a lead from web research also has "source" (where it came from) and
                   "verdict" ("consistent", "not supported" or "cannot tell")],
        "cannot_tell": ["what no sensor saw, gaps in the records, what only a person on site can check", …],
        "warned_earlier": ["which alert, sensor or change — and how much earlier it would have warned", …],
        "checked": "what you read: devices, the period, the logbook, the automations"}

   (the example is invented: write the devices and times of THIS investigation). For the charts, your last timeline
   run must be the one of the whole period with `--out timeline.json`, all the devices that matter in it.

9. **Make the page:** `run_skill_script reports compose.py investigation --notes investigation.json --data timeline.json
   --out investigation.html`. It prints a `message` {title, text}.

10. **Send it:** send_message(to="here", title= the message's title, text= the message's text, attachment=
    "investigation.html"). That message and its page ARE the answer: after it, write nothing — the agent does not
    send anything you write after the page, and puts the fault buttons under the page's message itself.

If the page cannot be made (a script failed), say so in one line and write the account in the chat instead, in the
same parts, plain text.

Rules for the account:
- Every number and time comes from a script or a tool. Give units (W, kWh, °C, min). Times as "03:09", with the date
  when the account spans several days.
- Devices and rooms by their names, never an entity id or a rule code.
- Say "I could not read …" for anything that failed, and what that leaves uncertain.
- A fault is never the answer. Only if a person must check or do something on site, you may call create_ticket once —
  in a chat it is only offered, with a button, and the person decides. Never write that a fault was created.
