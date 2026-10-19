---
name: investigate
description: Investigates what happened and why, from Home Assistant's records — a short message with the whole account as an HTML page (what the records establish and rule out, timeline, charts, causes ranked by likelihood, what cannot be known, what would have warned earlier). Used when the person writes /investigate.
---

# investigate

The person wrote /investigate with a question: what happened, why, since when, for how long, what caused it or what
turned it on or off — about any device, room or event, now or in the past (a flood, a power cut, a pump or a heater that
ran too long, a door, an alarm, a strange bill, a device that stopped). They want the whole, true story: read
everything the steps below ask for, then answer once, completely.

## Files

- `scripts/investigate.py`: `find`, `timeline`, `around`. Reads Home Assistant (read-only) and returns short, checked
  facts, in the villa's time.
- `scripts/page.py`: makes the page and the short message from your account and the readings.
- `settings.yaml`: what counts as unusual (a villa's villa.settings.yaml may change it).

## The procedure

1. **Pin down the question.** Which device, room or event, and which day and hours: turn "yesterday", "on the 9th",
   "last night" into villa dates using the date and time at the top of the message. With no time given, start from the
   last 7 days and find the moment in step 3. Ask one question, and stop, only when you cannot tell which device or
   which day at all.

2. **Find the devices and their neighbours.**
   `run_skill_script investigate investigate.py find --what "<the person's words>"` (and `--where "<room>"` if said).
   - Keep the entities that measure or control the thing asked about: its power, its state, its switch, its sensor.
   - From its "same physical device" and "same room" lists, also keep anything that could share its supply or cabinet:
     a neighbour that stopped at the same moment points to a common cause (a breaker, a power cut).
   - Keep every on/off control next to it (a switch, a relay, a light, a valve): read in the same timeline as the
     device, it shows whether that control could have turned the device on.
   - If find gives nothing useful, try other words (the device type, the room) before saying so.

3. **Read what they did against their own normal.**
   `run_skill_script investigate investigate.py timeline --entities <ids, comma-separated> --start <…> --end <…>`
   - Read from at least 2 hours before the first sign of trouble to after things were normal again (or now). When the
     moment is unknown, read the whole day or days first, then narrow on what stands out. A device that has not
     answered for days: its timeline over those days shows when it stopped (an "offline" period from its first
     moment), with no logbook needed.
   - About 5 ids per `--entities`, repeated for more; only ids that find returned. A date alone is the whole day:
     `--start 2026-10-09 --end 2026-10-09` reads the 9th from 00:00 to midnight.
   - Lines flagged "⟵" are unusual against the device's own normal (the days before): a run far longer than any before,
     a level well above or below normal, exactly 0 where it normally reads a little (its supply was off), no answer,
     stop-start cycling. Each says by how much (the limits are in settings.yaml). They are the backbone of the answer.
   - The normal line gives how often and how long it usually runs: "longest normal run 10 s" against "ran 1 h 46 min" is
     the contrast the person needs.

4. **Read everything else recorded then.**
   `run_skill_script investigate investigate.py around --start <…> --end <…> --entities <the ids you focus on> --out around.json`
   over the same period as your last timeline. It lists the automations that ran, devices that stopped answering and
   came back (with times), notifications sent, doors, locks, switches, people and the VESTA Agent's own alerts. Match
   its times to the timeline: a device dropping off 79 seconds after another stops, an automation running at the moment
   a device turned on, a person arriving.

5. **Check what can act on it — by what each thing is able to do, not by its running at the time.**
   - A control the timeline marks "stayed off for the whole period" turned nothing on: it belongs to what the records
     rule out, and the page already says so.
   - Under each automation that ran, `around` says what it is able to do:
     - "Switches nothing": it only watched. Say what it saw.
     - "CAN change things": what it lists can be a cause, when its run matches the moment.
     - "Not proven either way" (its actions could not be read): say it could not be checked; it becomes a cause only
       with other evidence.
   - For an automation that should have warned, read it with ha_config_get_automation: which case does it watch, and
     why did it (not) warn?
   - When nothing in Home Assistant acted, name what did: a person, the device's own control (a pressure switch, a
     thermostat, a timer) or a power cut. For every long or unusual run, look both ways: did the device cause the
     damage, or did the damage keep it running (water escaping keeps a pump running; an open window keeps cooling on)?

6. **Fill the gaps, then search the web.** Use the raw tools only where needed: ha_get_history for an entity the script
   did not read, ha_get_logs (logbook) for the hours around a moment that matters (the whole villa's logbook is read 6
   hours at a time at most; `around` reads a whole period), ha_get_state for how things are now.

   **Search the web (web_search) — always**, once the timeline and `around` are read, as a source of leads:
   - Search for the pattern in general words (the kind of device and what it did, e.g. "a pump that runs without
     stopping, then its circuit's protection trips"): its known causes and what usually goes with it; the make and
     model's known failures (ha_get_device) or its manual; what an error code means; an outside event at that time (a
     storm, a grid outage) when several devices stopped together.
   - At most 5 searches. The words of a search are the pattern, the kind of device and its make and model, and for
     weather or a grid outage at most the town. The villa, its address, its people and its devices' names stay out.
   - Each lead is a question for the records: say what they show for or against it. Times and numbers always come
     from Home Assistant.

7. **Reason before writing.** For each unusual thing, ask what physically explains it. Keep several causes when the
   evidence allows, rank them, and give for each what points to it and what would confirm it. Keep apart what Home
   Assistant SHOWS (measured, with times), what it most likely MEANS, and what it CANNOT tell (no sensor there, no
   reading, a gap): a guess is never written as a measurement. Then: what would have warned earlier or limited the
   damage (a missing sensor, an alert on how long something runs, a rule that only watches the opposite case, a switch
   that does not actually control the device).

## The answer: a short message, and the whole account as a page

The person reads a short message in the chat and opens the page for the rest. The page is drawn like every report the
agent sends, and it writes the recorded facts itself from your `--out` files: every unusual period with its times and
its normal, what else stopped answering, the automations that ran and could act, what the records rule out, the
recorded timeline, and when an alert on the same limits would have warned. The message opens with a line of those facts.

Your account adds what the facts MEAN: the causes, what cannot be known, what to check on site. It stays consistent
with the facts; if one seems misleading, say why in "cannot_tell".

8. **Save the account** with save_file as `investigation.json`, in plain sentences (no Markdown):

       {"title": "at most 90 characters",
        "summary": "3 to 5 sentences, at most 640 characters: the most likely cause and what points to it, and what to check on site first",
        "timeline": [{"time": "07:30", "text": "what a person saw or did", "unusual": true}],
        "causes": [{"cause": "…", "evidence": "what in the records points to it", "confirm": "how to confirm on site"}],
        "cannot_tell": ["what no sensor saw, a gap in the records, what only a person on site can check"],
        "warned_earlier": ["a sensor, rule or change that would have warned"],
        "checked": "what you read: the devices, the period, the logbook, the automations",
        "sources": [{"title": "the page's title", "url": "https://…"}]}

   - `summary`: the message shows it under the line of recorded times and durations: explain them, in other words
     than theirs, rather than give them again.
   - `timeline`: only what a person saw or did that the records do not show (the page draws the recorded one); leave it
     out when there is none. Its `time` as the rules below say: "07:30", or "9 Oct, 07:30" when the account spans
     several days — the page lists it beside the recorded moments, worded the same way.
   - `causes`: most likely first. A cause that came from a lead also has `"source"`, written `"[2]"` for a web page (its
     place in `sources`) or `"the records"`, and `"verdict"`: `"consistent"` (the records fit it), `"not supported"`
     (they contradict it: the page then lists it under ruled out) or `"cannot tell"` (no record can judge it; say what
     would).
   - `warned_earlier`: what the records cannot measure; the page already gives when an alert on each unusual period
     would have fired.
   - `sources`: every web page you used, numbered by place ([1] is the first), each cited as [n] in the text that used
     it (the summary, a cause, cannot_tell, warned_earlier). The page refuses an uncited page or a [n] it does not have.

   An example of the tone (invented; write this investigation's own devices and times):

       "summary": "The pool pump most likely kept running because water was escaping: the pool's level fell while it
                   ran, and a pump of this kind runs on its own pressure switch for as long as pressure stays low [1].
                   Check the pool's return pipes and the skimmer seal first."
       {"cause": "A leak on the pool's return circuit", "evidence": "Level −11 cm from 02:10 while the pump ran 4 h 26
        min, its longest normal run 2 h", "confirm": "Look for wet ground along the return pipe", "source": "[1]",
        "verdict": "consistent"}

9. **Make the page.** First make sure your last timeline run covers the whole period with `--out timeline.json` and
   every device that matters (with its controls), and your last around run the same period with `--out around.json`.
   Then `run_skill_script investigate page.py --notes investigation.json --data timeline.json --around
   around.json --out investigation.html`. It prints a `message` {title, text} and the facts the page states
   ("established", "ruled_out"). Read them against your account; if they disagree, fix the account and make the page
   again.

10. **Send it:** send_message(to="here", title= the message's title, text= the message's text,
    attachment="investigation.html"). That message and its page are the whole answer: the agent sends nothing you write
    after it, and puts the fault buttons under the page's message.

If the page cannot be made (a script failed), say so in one line and give the account in the chat instead, in the same
parts, plain text.

## Rules for the account

- Every number and time comes from a script or a tool, with its unit (W, kWh, °C, min). Times as "03:09", with the date
  when the account spans several days.
- Devices and rooms by their names; entity ids and rule codes stay out.
- For anything that failed, say "I could not read …" and what that leaves uncertain.
- The answer is the account. Only when a person must check or do something on site, call create_ticket once: in a chat
  it is offered with a button and the person decides, so the account never says a fault was created.
