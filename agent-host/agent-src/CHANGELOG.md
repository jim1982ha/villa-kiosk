# Changelog

## 0.6.332 (24 October 2026)

- A close (`IncidentThread.close`) and a restate draw the alert's words in the language the copy's heading now reads
  (`_own_words` → `Translations.draw`: kept, drawn; not yet, asked in the background), as `sync` already did. A chat
  whose language changed while its alert was open read its Status in the new language over the words in English
  (owner, 2026-10-24: group switched from Indonesian to Chinese, #80).

## 0.6.331 (24 October 2026)

- Review J, 4: a job time moved on the Limits tab after it ran no longer runs it again that day. The slot key still
  holds the time (`scheduler.job_key`, unchanged, so nothing claimed before is lost); `State.claim_job_slot(..., entry)`
  also refuses when another time of the same entry (`skill:index:`) was claimed on the slot's day.
- Review J, 6: Done on an alert the desk cannot read again (`judged` false) closes at once and now says its watch
  (`watched(pressed, reopen_hours)`), as every other close does.
- Review J, 5: a villa-wide setting (`vesta_shared.daily.VILLA_WIDE`: `on_threshold_fraction`) is ONE Limits row
  (`id {src: shared}`, `limits_tab._villa_wide`), its value the skills' when they agree, their differences said when
  not; its save writes every skill's villa file (`_save_shared`, each through the checked, recorded skill save);
  setting chips in any skill's guide link to it.
- Page changes (owner, 2026-10-24): a change of a list of rows (People) says each row by name, field by field
  (`history._rows`: "People › Luc: language French → English", "+ Wayan", "− Luc", "order changed"), never "3 items →
  3 items"; a line recorded that way before is said again from its saved texts (`History.rows`, `COUNTED`). The Done
  watch is also on the alert's other copies when settled by a typed answer (`settle` note).

## 0.6.330 (23 October 2026)

- Limits: every number shows its unit (owner, 2026-10-23). `limits_tab.unit_of(key)`: one rule from the setting's own
  name (_minutes/_min, _hours, _days, _months, _weeks, _s/_seconds, _pct, _points, _usd, _kwh, _w, _ratio, share/
  fraction/margin/spread), the counts a name cannot tell named once (`COUNTS`); a job's time says "villa time".

## 0.6.329 (23 October 2026)

- A closed alert's last line says how long it stays on watch, from `behaviour.reopen_hours` (live: the villa's helper,
  villa.rules.yaml, rules.yaml; 0 says nothing), in every language (alert-desk words.yaml `watch`, desk `watched()`):
  "✅ Cleared on 22/10/2026 19:28: back to normal. Watch 1 h.", "✅ Done (JM). Checked after 10 min: right. Watch 1 h."
  (shortened to hold one phone line). Ends that cannot reopen (the automation gone, the villa back online) say none.
- No setting written as a fixed number where a person or the AI reads it: the skills' SKILL.md files name their
  settings (reask/escalate/clear/reopen times, siren signals, drift and battery thresholds, baseline days, …), the
  reports' prompts no longer say "It is 07:00", filtration's "no statistics" follows `filtration.measured_days`.
- The Agent page draws a value a person can change as a setting chip (core.setting): a press opens Limits on that
  exact limit, its tab open, the row first, scrolled into view and lit. Used on Overview › Page changes (records kept),
  Skills › When the skill runs (a job's time, now a Limits row of its own), and a SKILL.md's named settings in
  Skills › Files.

## 0.6.328 (23 October 2026)

- Limits: a search counts its matches in every tab's title ("Skill settings (1)"), and an open tab with none gives way
  to the first that has some (owner, 2026-10-23: "reopen" found nothing while another tab was open).
- alert-desk SKILL.md: `reopen_hours` read from rules.yaml `behaviour:` (a villa's villa.rules.yaml first), not "(4)".

## 0.6.327 (23 October 2026)

- Rules › AI brains and limits (owner, 2026-10-23): the Chat answers line says only "replies in the chats"; "Forget
  Translations" (no language menu: every language but English, the only ones kept) sits right of the "Delete
  conversation context at" menu, on its line. Skills › alert-desk: "an alert card in non-english", its text put in the
  chat's language with the Chat answers brain and limit, where Forget Translations is.

## 0.6.326 (23 October 2026)

- The alert-card translation is no AI job (owner, 2026-10-23: "fully integrated in the existing alert-desk skill,
  inside the Chat answers"): it runs with the Chat answers' brain and per-reply limit (`turn.chat_brain`, one owner for
  `chat_terms` and `translation_terms`), so it is on whenever a chat reads another language. Gone from /api/jobs, the AI
  brains table's skill rows, "Add them", the Limits tab's skill pairs and the setup copy. The Chat answers row says it
  also translates alert cards and holds "Forget the translations" (/api/rules `translations`); the Skills page's
  alert-desk row says it uses the Chat answers brain; Costs: "Chat replies › alert translation" (0.12.334–335's
  `job:alert-translation` records shown there too). alert-desk skill.yaml keeps `translate: {instructions}` only; an
  older copy's name/description/jobs_default are read and ignored; a leftover settings.skill_ai["alert-desk"] is never
  read.

## 0.6.325 (23 October 2026)

- Architecture review I, the translation (#2, #3): `vesta_agent/phrases.py` owns what is kept, asked again and
  forgotten. An answer line is kept only if it keeps every slot once and is not the English skeleton echoed; a failed
  (skeleton, language) waits `alerts.translate_retry_hours` (24) before it is asked again, said once in the log, a
  success clears it; kept rows are filed under a fingerprint of the skill's instructions and the slot rules (another
  fingerprint's rows are deleted at first use: 0.12.334's rows go); POST /api/translations/forget (all or one
  language) and a "Forget the translations" button under alert-translation on the Rules page (its own dialog).
- Names at the event seam: the alert's devices' names are read live when it arrives (`alerts.names_read_seconds`, 1 s,
  never fatal; kept in State for redraws), first, then the knowledge pack's; matched as whole words, a name of two or
  more words in any capitals, a one-word name as written.
- The agreement copy follows the Kiosk's 2.496.508: a reopen by either side removes `confirmsBy`.

## 0.6.324 (23 October 2026)

- An alert's own text in each chat's language (owner, 2026-10-23), `vesta_agent/translation.py`. The card goes out
  (or is taken over) in English at once; a referenced background run, bounded by `alerts.translate_seconds`, then
  translates its lines for each non-English chat and `IncidentThread.translated` redraws that copy. Only the SKELETON
  is translated: numbers (with their unit), times, dates, quoted values, the incident's device and room names, "#N" and
  [CODES] become numbered slots (`mask`); the answer must keep every slot once (`fits`), else English. Skeletons are
  kept per language in State (`phrase:{lang}:{sha}`, a BOUNDED lifetime, `alerts.translations_kept`), so the same
  pattern with other values is drawn translated at once, with no AI call. Any failure leaves the English. The run is
  the alert-desk skill's `translate` (its instructions; `jobs_default` economy, 0.05 US$), with its brain and limit
  from policy.yaml settings.skill_ai["alert-desk"]: not set, not run (logged once; the page offers "Add them").

## 0.6.323 (23 October 2026)

- Every "could not be prepared" goes out titled ("Report not prepared"; a question cut by a restart "Question not
  answered", `api_errors`): the job's error edit, a report made without the AI that failed too, and what the next start
  says (`ChatJobs` takes the Poster: `_say` rewrites the waiting message with the title and "To:", else posts it).
- A heading-less message's "Status:" section (a button pressed under a plain answer) is styled as every other
  (`message_format._status_parts`, keyed on the exact shape `layout.render` writes).
- A test that started a conversation without keeping its task lost the record to garbage collection under load (it
  failed now and then in CI); it keeps the task.
- The layout never keeps a message from its chat: `posting.laid_out` sends the same words plain when render or paging
  raises; `telegram._italic` sends unstyled when the entities cannot be computed.

## 0.6.322 (23 October 2026)

- `ChatJobs.idle` waits only on job tasks still running and drops the ended ones: a task that ended as its loop closed
  stayed in the set (its done-callback never ran) and the wait awaited it for ever without yielding — 0.12.331's CI
  hung 40 min in the tests. Two tests that raced on a slow runner wait on what they check (a bounded wait for the
  result in test_chat_facts; the restart notice counted sent or written over its waiting message). The CI's gates
  step has a 20 min limit.

## 0.6.321 (23 October 2026)

- A fault a person closed (a Done on Telegram, a Close in the Cockpit) carries `confirmsBy` while the alert desk's
  watch runs (agent-contract `ticket.fields.confirmsBy`, copied from the Kiosk's): `Problems.confirms_by` = the
  incident's close + its `watch_minutes` (the desk's `clear_minutes`, carried as `Notes.WATCH_MINUTES`), only while
  `check_quiet` waits; `kiosk.confirming(at)`, `resolve_ticket(confirms_by=)`, `reopen_ticket` drops it;
  `tickets._converge` writes or clears it; the desk asks for a repair when a watch ends, whatever it read. An older
  Kiosk that does not list the field never gets it (`Kiosk._gated`).
- A Close pressed in the Cockpit was reopened: its step `{kind: "cleared", by: <profile>}` was taken for the agent's
  own clearing (`tickets._take_in`), so the close was never taken in and `_converge` reopened the fault. Only the
  agent's own cleared close is skipped now (`fault_of(...).closed_mine`); `closed_in_kiosk(at=)` counts the watch
  from the person's close.

## 0.6.320 (23 October 2026)

- What happened in a chat outside its conversation is told to the AI with every message (`chat_facts.ChatFacts`): the
  reports being prepared for that chat now (InProgress, who asked and when), or that none is, and since its last answer
  there the reports that reached it or could not be prepared, alert steps sent there (from the incident history), Done
  / Need help pressed there, fault offers answered there (capped: the last 5 and a count). Before, a conversation that
  had said "on its way" for a report the job had since sent promised it again: "the daily digest will arrive in this
  chat" with nothing running (villa, 2026-10-23 14:50). `InProgress.verdict` also marks the chat job; `start_job`
  carries who asked.
- No space before ":" ";" "!" "?" in anything sent (`messaging.tight_punctuation`, at `telegram.layout` and
  `Telegram.edit`, and on a page's notes): "(à: FM)", "Toujours ouvert:". The French Status words and the desk's French
  words are written so. Code, links and times are untouched.
- alert-desk: a Done (or a Cockpit close) whose watch ends with the device right now says so on the card
  ("Done (JM). Checked again after 10 min: it is right. Closed.", `confirmed_after_done` in every language); it closed
  without a word.

## 0.6.319 (23 October 2026)

- An alert card's "Status:" section in each chat's language (owner, 2026-10-23). `vesta_shared/status_words.py`: the
  engine's fixed words (the label, every STEPS line, ordinals, "(to: …)", role words, acted, closing, stage words,
  "N earlier notices") for every language of `policy.LANGUAGES`; English goes through `message_format` unchanged.
  `Notices.lang(chat)` (the chat's first row) is kept in a copy's heading facts; `layout.render` draws in it;
  `message_format._alert_parts` knows every language's label. The desk's reason words stay in the skill
  (alert-desk `words.yaml`; `desk.py` sends `status_in` / `note_in`; buttons' `labels:`); the engine picks the chat's,
  English when a language or an older skill lacks it. `parts["said"]` keeps the step so `IncidentThread.sync` redraws
  each copy in its own language (`Notices.restatus`), where it copied the latest chat's English status to every chat.
  Copies recorded before keep their English lines. The alert's own text, its first line and "To:" are unchanged.

## 0.6.318 (23 October 2026)

- One answer to "who reads this message, in which language": `Routing.readers(to, origin)` → [(Language, chats)]
  (architecture review H). A job asked for in a chat is told its asker's language only (`AiJobs._language_of(role,
  origin)`), and `Routing.versions` picks the version in the reader's language (before: the role's languages, and the
  first version written, so a French facility manager asking got German). A job's `on_limit` steps run once per
  language of its readers (`AiJobs.on_limit`; `{suffix}` "" for the first, "_French" for another; `job_steps.run(...,
  language=)` tags what goes to the job's destination), so each reader gets the page of their own notes when the limit
  stops a report. `without_ai` stays one English text for every chat.
- `policy.Language`: one code↔name value (`of`, `parse`, `name_of`) for ai_jobs, app, routing and tools (four
  hand-written matches before). The People check names a language outside the menu's list (it accepted any two or
  three letters); that person is written to in English until it is corrected.
- reports skill: `on_limit` reads `notes{suffix}.json` and writes `fm_weekly{suffix}.html` / `owner_monthly{suffix}.html`.

## 0.6.317 (23 October 2026)

- A role's report reaches each of its people in their own language. `Policy.languages_for(role)` (every language its
  chats read, in the list's order), `chats_for(role, language)`, `language_of(chat, role)`. `send_message` takes `text`
  (and `attachment`) as one value or one per language (`{"German": "…", "French": "…"}`, a code works too);
  `Routing.versions` refuses a single text for a role read in several languages (nothing sent, the languages named),
  and each version goes to the chats of its language (a send item's `language`, `Routing.target`). `{fm_language}`
  and `{owner_language}` name every language ("German and French"). Before, `AiJobs._language_of` took the role's
  first row: the facility manager's daily report came in German to a facility manager who reads French.
- reports skill: the daily digest, the weekly and the monthly write one version per language; a page is composed once
  per language (`notes_<Language>.json`, `fm_weekly_<Language>.html`; SKILL.md "Several languages"), the
  investigation done once. The owner's weekly lines attach the page in the owner's language when there is one.

## 0.6.316 (23 October 2026)

- "Investigate this" under a follow-up question now carries what the answer read. `Toolbox.about` keeps, per read of
  the villa, its tool, its entities (named "House Pump (sensor.x)" where the knowledge pack names them, else the id;
  entity-id shapes only) and its period in words (`status.read_subject`, also the Costs tab's line);
  `TurnResult.about` carries it (THEN: added once). `command_offers.subject` keeps the reads of the skill's
  `after_reading` tools beside the question (`command_offer:` `about`), and the press runs
  `handle_message(..., about=)`, which adds "about: ..." under the request's prompt (a command only; never read from
  an event). A command still starts a fresh conversation. Before, the press gave the investigation the follow-up's
  words alone ("and why did it keep starting?"): no device in it. An offer no longer on record
  (`State.command_offer_kept`) toasts `TOO_OLD`, not "Already started." (nothing had run).
- A voice note is no longer told "could not make out, try again" when the speech-to-text is down.
  `transcriber.unheard_words`: any `NOTHING`, the plan's `otherwise` or UNHEARD; else the `no_stt` words for the
  villa's only one not found (none, several); else (every attempt `FAILED`/`REFUSED`, the device lookup failed, no
  WAV) the plan's new `down` (villa-concierge `voice.DOWN`: "Voice messages can't be written out right now. Please
  write it."), an older skill's `otherwise`, else the engine's `DOWN`.
- A battery's fault title follows the level the recheck judged. `recheck.battery_restated`: a CRIT/LOW fault still at
  its step whose level moved by a whole point is raised again (`Problems.record`, as the night does) and its open task
  named moved, so the summary (Problems.current_title) and the Kiosk's fault (`retitled`) say what the page shows.
  Before, the page said 15 % beside "battery at 18%" until the next night.
- `battery.keep_judged` keeps, per battery, the record with the later `at`: a past night replayed with `--as-of` no
  longer overwrites last night's level (the page fell to the reading of the moment).
- Tests: test_command_offer (the follow-up scenario's prompt names the pump and its period, by name with a pack;
  `subject` keeps the earning reads; a typed command's event cannot give a subject; entity-id shapes only; an offer
  pruned says TOO_OLD); test_transcriber (each kind's words, a service down, end to end with the skill's plan);
  test_reports (the recheck retitles at a whole point only, through the real nightly.py, recheck.py and facts; a
  replayed night). Changed where they pinned the old words: test_voice_language and test_transcriber (all failed:
  DOWN), test_voice_prepare (the plan carries `down`), test_turn_reply's stand-in takes `about`.

## 0.6.315 (23 October 2026)

- A voice note Whisper heard but found no words in is "could not make out", never the speech-to-text setup sentence.
  Each attempt now answers `Missed(kind, why)` (kinds `NOTHING`, `FAILED`, `REFUSED`, `UNFOUND`) instead of a bare
  string; `wyoming.NoWords` (a `WyomingError`) is an empty transcript, told apart from a broken or closed answer, and
  /api/stt answering "success" with an empty text is `NOTHING` too. `Transcriber.run` gives the plan's `no_stt` words
  only when no attempt reached a transcriber that heard nothing. Before, every Whisper failure was its exception's
  name and the sentence followed the villa's lookup alone: a silent note, with two (or no) speech-to-text services,
  told the person to name one in villa.voice.yaml. The refusal memory and `auto_refused` read the kind:
  `refused()`, `refusal()` and `REFUSED_BEFORE` are gone; the 400/415 statuses are `REFUSED_STATUS`. The record keeps
  its fields; Whisper's empty transcript is now why "no words" (was "WyomingError").
- The weekly report shows a battery at the level the last night judged. `battery.RESTED` now holds {entity:
  {"level", "at"}}, written only by `nightly.battery_findings(..., at=)` for the night and the recheck: the level each
  battery was judged with (None when it had no reading). `battery.rested(store, eid, now, at)` uses it while it is no
  older than `JUDGED_HOURS` (36 h), else the reading now. `keep_rested` is gone. Before, each window's best reading
  was merged and never dated: a night with no hourly statistics for a battery kept the 50 % of weeks before, and the
  page showed it beside the night's 8 % "replace now". An undated record from before is never read and is dropped
  at the next write.
- Tests: test_transcriber (heard nothing with two or no speech-to-text: "could not make out"; Whisper unreachable
  and none: the setup words; the kind decides across the plan; /api/stt empty text; `all_entity_ids(fresh=True)` on
  the real client); test_reports (two real nights then the page, the recheck's kept level, a judged level ageing out,
  the undated record); `stt_fake.FakeSTT` answers `("json", body)`. Changed where they pinned the old collapse:
  test_voice_whisper's empty transcript why, test_transcriber's recording adapters answer `Missed`, test_reports'
  kept record is dated.

## 0.6.314 (23 October 2026)

- Whisper is tried even when the villa's device list cannot be read. villa-concierge `voice.py` no longer reads the
  villa's system: when villa.voice.yaml names no `stt:` (as shipped), the plan says `{"stt": null, "language": …}`
  ("the villa's only one") and gives `no_stt: {"none", "several"}`, the person's words. `VillaSpeech.only` looks it up
  when such an attempt is reached (`villa_entity_ids` over the app's reader, read afresh; within what is left of the
  clock), once per message; a failed, empty or ambiguous lookup is that attempt's `why`. Before, the script read the
  whole device list first, and a failed read ended the message ("This voice message could not be prepared."),
  Whisper never asked. `Transcriber.run` returns `Heard` or `Unheard(say)`; a named entity is still shape-checked.
  `McpClient.all_entity_ids(fresh=True)` reads the list again.
- Whisper's connection keeps to the time left: the name's lookup and each address get min(`voice.whisper_connect_s`,
  what is left), worked out each time, TimeoutError when nothing is left (`wyoming._connect` takes the deadline).
  Before, two silent addresses each waited the whole time left and overran the one clock.
- Tests: `helpers.voice_agent(stt=None, reader=…)`; test_transcriber through the agent with no `stt:` (the device
  list failing while Whisper answers; one speech-to-text found when Whisper is silent; none, several, failed: what
  the person reads); test_voice_whisper two silent addresses within the deadline.

## 0.6.313 (23 October 2026)

- A voice message becomes words in ONE engine module, `transcriber.py` (architecture review, 2026-10-23). The skill
  answers a PLAN, `{"wav", "seconds", "attempts": [{"whisper": "host:port"}, {"stt": "stt.x", "language": "auto"},
  {"stt": "stt.x", "language": "<saved>"}], "otherwise"?}` (a fixed language: `[{"stt", "language": "de"}]`);
  `Transcriber` runs the attempts in order through two adapters with one interface (`WhisperDirect`, `VillaSpeech`:
  `attempt(step, audio, seconds) -> Heard | why`) and stops at the first words. The skill script no longer calls
  Whisper; the Wyoming client is `vesta_agent/wyoming.py` (every address, IPv4 first, kept). `speech.py` is gone.
- ONE clock: `voice.timeout_s` (120 s) covers the skill's preparation and every attempt, each given what is left; a
  slow Whisper leaves the villa's speech-to-text only the rest. `voice.whisper_timeout_s`, `voice.transcribe_timeout_s`
  and `voice.script_timeout_s` are gone (worst case was about 243 s, and the script's could kill the fallback);
  `voice.whisper_connect_s` stays, never beyond what is left.
- What the villa's speech-to-text refused (415/400) is not asked again while the app runs (`Transcriber.refused`, by
  entity and language): after one refusal of "auto", a voice message goes straight to the person's saved language.
  Any other failure moves on to the next attempt (before, it ended the message).
- ONE "voice" record: `via`, `stt`, `used`, `detected`, `auto_refused`, `attempts` (each with why it gave no words),
  `took`, `ok`, `why`; one log line. Never the words, the audio, an address or the token.
- The "spoken in" note to the AI stays for a Whisper that says the language; the villa's never does (measured): the
  test fake now behaves like it, and a test pins that the prompt then claims no language.
- Tests: `tests/stt_fake.py` the one /api/stt stand-in (the two copies removed), `helpers.voice_agent`/`voice_event`,
  `tests/test_transcriber.py` (order, one clock, skip, record).

## 0.6.312 (23 October 2026)

- Whisper asked directly tries every address of its name, IPv4 first (villa-concierge `voice.py` `_resolve` and
  `_connect`). Measured on the owner's villa: "Whisper directly: ConnectionRefusedError". The apps' network also gives
  the name an IPv6 address, listed first, where Whisper does not listen; only the first address was tried, while the
  villa's system, trying each, reached it. Test: a refusing address listed first, then the one that listens.

## 0.6.311 (23 October 2026)

- A voice message reaches Whisper directly (owner, 2026-10-22, "the Agent asks Whisper directly"): villa-concierge's
  `voice.py prepare`, with the language "auto", asks the Whisper app over Wyoming (`whisper:` in `villa.voice.yaml`,
  default `core-whisper:10300`, `off` never) with no language, so Whisper finds the one spoken, and answers
  `{"text", "language", "via": "whisper"}`. Unreachable, refused, silent past `voice.whisper_timeout_s`, empty or not
  Wyoming: the 0.6.310 `stt` spec, with `whisper` saying why. A fixed `language:` keeps the villa's path only.
- `voice.Voice.transcribe` takes a skill's ready words and runs the villa's speech-to-text only for an `stt` spec; it
  returns `voice.Heard(text, language)`, and the AI reads "a voice message, as transcribed (spoken in French)". The
  log line and the "voice" record add `via`, `detected` and `whisper`; never the words, the audio or an address.

## 0.6.310 (22 October 2026)

- A voice message's language: villa-concierge's `voice.py prepare` asks for `"language": "auto"` (the speech-to-text
  finds the language spoken) with `"fallback"`: the person's saved language. `villa.voice.yaml` `language: xx` still
  fixes one (no auto, no fallback); `language: auto` names the default. `speech.LANGUAGE` accepts "auto".
- `voice.Voice.transcribe` asks in `language`; when the villa's system refuses it (415 or 400, `speech.refused`), it
  asks once more in `fallback`. A timeout, a network error or any other answer is not retried. The log line and the
  "voice" record say the language asked, the one used and `auto_refused`; never the words, the audio or the token.

## 0.6.309 (22 October 2026)

- Architecture review 2026-10-22, one rule for a device asleep by design over a past window: `asleep.held_window`
  (its "unavailable" rows dropped, the "unavailable" carried into the window replaced by its last real state before
  it, read back `asleep.last_real_days`). Read by device_state.out_since (the alert desk's "closes at" and close, now
  given the pack) and investigate's timeline and baseline; `without_sleep` and out_since's inline filter removed.
  investigate find reads `read_states` (a sleeping device's last report, said as such) and uses commas.
- A device asleep with no real report within `asleep.last_real_days`: `last_real` answers `nothing_since` and
  `last_known` (its last real state within the history kept) instead of leaving it out; it stays asleep, never
  offline. `asleep.unheard` words it ("no report for 9 d (it sleeps between its reports)"): the weekly report's
  battery line (last known charge, else "no reading"), the alert desk's lines, the night check's notes; the night
  check judges its battery on `asleep.last_value`. last_real reads through history_read (a cut read cannot tell).
- tests/wording.py: ONE list of wording rules (platform name, " — ", "rule" for an automation), read by
  tests/test_wording.py over every shipped person-read text and by tests/conftest.py over every message, button and
  toast the Telegram fake shows; AI-only text exempt by name. Fixed what it caught: setup preview and Rules page
  ("agent rules", "standing instructions"), two Limits notes, two report prompts.

## 0.6.308 (22 October 2026)

- Owner 2026-10-22 (standing vocabulary): the villa's automations and blueprints are "automations", never "rules",
  in every text a person reads (SKILL.md, skill settings, reports, Telegram, Kiosk fault texts, Limits notes); a
  skill's own detection rules are "checks"; the Agent's policy is "the agent's rules" (Limits group "Agent rules").
- Limits: a "Who is told" column (limits_tab), the pill out of the Reached sentence. Costs: no line under the AI
  cost card's title.

## 0.6.307 (22 October 2026)

- Owner 2026-10-22: the day's counters (alerts followed, buttons pressed, actions done, replies written, reports
  made, failures) leave Overview's "The last 24 hours" and join the Costs tab's figures, counted over its chosen
  period (status: one counting function for both); Overview's "Scheduled jobs run" heading removed.
- " — " → ", " (or ": " before a list) in every text a person reads: SKILL.md, skill settings, report and
  investigation page texts, the Telegram alert status line; shipped-skills.json regenerated. AI-only texts, logs and
  comments untouched.

## 0.6.306 (22 October 2026)

- Owner 2026-10-22: " — " replaced by ", " in the text the Agent's own pages show (rules.js, limits.js, overview.js,
  core.js, ui/server.py, skills.py); Telegram texts, skill folders and comments untouched.

## 0.6.305 (22 October 2026)

- Architecture review 2026-10-22 (the Agent): a battery that moves a step ("within the week" ↔ "replace now") is handed
  to its new fault, never cleared — nightly.battery_moved feeds record_night's handed_over, and recheck_open hands it
  over (Problems.record_rechecked `handed`) and opens the new step at once (told_now for a new P2); no told_cleared edit.
- alert-desk seen_again (no claim): the time shown and the close are one reading — device_state.out_since (out_for its
  boolean), over read_states, so a device asleep between reports is judged on its last report; still_there reads at the
  tick's `now`.
- reports s_batteries shows a battery's rested level (vesta_shared.battery.RESTED, kept by the night and the recheck
  from battery_best), raised to its reading now.
- test: the night's still_there_after_close.minutes equals the alert desk's clear_minutes.

## 0.6.304 (22 October 2026)

- Owner 2026-10-21 (a motion sensor read 1 % between two readings near 50 %: a coin cell dipping under load): the
  night check and its 5-minute recheck judge a battery on its HIGHEST reading of the last
  `battery_level_window_hours` (preventive-maintenance settings.yaml, 24): nightly.battery_best reads the hourly
  maxima; battery_findings takes the higher of it and the reading now. A dip no longer opens "replace now", nor closes
  a fault a resting battery still deserves. The villa's critical_battery blueprint judges the same way.

## 0.6.303 (21 October 2026)

- Owner 2026-10-21 (#65: a door locked at 14:38:50 still a fault at 14:45): alert-desk seen_again records
  Notes.CLOSES_AT while what an incident claims reads over — a claim: clear_since + clear_minutes; bad states: the
  youngest last_changed + clear_minutes — and drops it when it holds again or cannot be told, asking the repair
  (faults_changed) when it changes. Problems.card `closes_at`; tickets._converge writes it as the fault's `closesAt`
  (kiosk.closing, agreement ticket.fields, gated by the Kiosk's ticket_fields).
- Heartbeat cadence `lastLookAt`: Scheduler.last_look (the last every-5-minutes start) — the Kiosk's Next check counts
  from it. An older Kiosk drops the key (never refuses it). Agreement copied from the Kiosk.

## 0.6.302 (21 October 2026)

- Architecture review 2026-10-21 (ARCHITECTURE.md "Where a device stands"): KnowledgePack.standing (device_state
  ASLEEP_NOW) and is_watched; asleep.read_states read by nightly, recheck_open, reports Ctx.states, concierge status and
  the alert desk; KnowledgePack.load attaches the Kiosk's list (is_asleep's VESTA_PACK fallback removed; tools read the
  pack once per run; app.pack() reloads on the list file too); recheck.back_online HIDDEN_NOTE; ASLEEP_NOTE points to
  the Kiosk; build_pack writes through os.replace; investigate: NO_VALUE never notable, its band "reported no value".

## 0.6.301 (21 October 2026)

- policy.RETIRED_SECTIONS (asleep_entities): never "Unknown section"; policy_doc.apply_form drops every one of them.

## 0.6.300 (21 October 2026)

- The devices unavailable by design are the VESTA Kiosk's list (owner, 2026-10-21): the heartbeat answer's
  `unavailableByDesign` (agent-contract.json copied from Kiosk 2.496.458), kept by app.kiosk_answered beside the
  knowledge pack (vesta_shared.asleep FILE / told / save / listed). policy.yaml `asleep_entities` retired (Policy,
  FIELDS, the example; policy_doc.apply_form drops it); the Rules page shows the Kiosk's list read only.

## 0.6.299 (21 October 2026)

- ha_events.REGISTRY_EVENTS (entity_registry_updated, device_registry_updated) subscribed; app.devices_changed reads
  the knowledge pack again once the registries have been still `pack.registry_settle_s` (60); a start with a usable
  pack reads it again in the background. build_pack holds one lock (night, start, registry change).

## 0.6.298 (21 October 2026)

- policy.yaml `asleep_entities` (Rules › Protected devices › "Unavailable by design"), read by vesta_shared.asleep
  (`listed`, `without_sleep`, `last_real`, `awake_states`) and KnowledgePack.is_asleep (a listed entity's whole
  physical device; `asleep_are` for the agent's own process). Applied in offline.devices_offline (PM-UNAVAILABLE,
  reports, concierge), reconnect_findings, silent_findings, hidden_in_rule_findings, recheck.back_online (closes an
  open PM-UNAVAILABLE, ASLEEP_NOTE), investigate timeline (rows without "unavailable") and around, alert-desk
  still_there (last real state; a claim is not judged on a sleeping device), and tools.with_asleep (the AI's reads).

## 0.6.297 (21 October 2026)

- PM-HIDDEN-IN-RULE: only hidden entities that no longer answer (offline, or no state) are looked for in the villa's
  rules (nightly.hidden_in_rule_findings reads their states first); a live hidden one is a tidied screen, not a fault.
  The open ones on live devices close at the next recheck.

## 0.6.296 (21 October 2026)

- investigation_facts: past `investigate.log_repeats` (3) a device's flagged periods of one kind are one log row (count,
  first, last, the longest); past `log_rows` the unusual rows are kept first and the rest counted. `established` reads
  the same rows.
- investigate: `telegram_bot` is a messaging domain (HARMLESS); an idle period at least `level_change_gap_s` long whose
  mean is `rest_high_share` (0.02) of the rest-to-running gap above its usual rest is flagged (periods.WORDS gains IDLE).
- investigate SKILL.md: a claim about WHEN is read hour by hour first.

## 0.6.295 (21 October 2026)

- investigate timeline: `days_line` — a runs or level device's daily mean over `days_context` (14) days from the
  long-term figures, flagged ⟵ when the days from its baseline on are `days_change_ratio` (3) times above or below
  the days before them, naming the day it began (none without `days_context_min` earlier days, or without figures).
  Test: test_investigate_shapes (mutation-proved).

## 0.6.294 (21 October 2026)

- investigate: a stop-start burst's reason says its runs against the usual run ("as long as / shorter than / longer
  than its usual run of 33 s"; settings `burst_run_short_ratio`). `level_jumps`: a level must hold
  `level_change_gap_s` before a change from it is reported (a start's surge no longer read as one).
  Tests: test_investigate_shapes (both mutation-proved).
- villa-concierge "A question about what happened": only what the lines say; a line without ⟵ is the device's normal;
  a cause only when a line shows it; another device a lead only when its own readings change at the same moments; a
  ticket only for something marked ⟵. "This afternoon" just after midnight is yesterday's.

## 0.6.293 (20 October 2026)

- investigate timeline: an id with no state, no reading and no figure says "no device of the villa's system has this
  id", never "nothing recorded" (villa, 21:57: the AI read the history of switch.house_pump, which does not exist).
  Test: test_investigate_shapes (mutation-proved).

## 0.6.292 (20 October 2026)

- villa-concierge "A question about what happened": start_time/end_time as villa times covering the whole period named
  (this afternoon from 12:00, last night from 18:00 the day before, today from 00:00), never "the last N hours": the
  21:25 turn read "last 6 h" for "this afternoon" and missed 12:00-15:25.

## 0.6.291 (20 October 2026)

- Instructions rule 6: "The reader's language" becomes "the language the message is written in; the saved one only
  for a message that does not tell" (the AI took the saved language: owner, 2026-10-20, a French question answered in
  English). The sentence moves out of villa-concierge; INSTRUCTION_REWRITES brings an installed villa's rule 6 to it.
- villa-concierge "A question about what happened": resolve the device, read its history over the period asked (so
  `reads_history` works it out), never answer from the status's problem titles. investigate SKILL.md: a message
  without /investigate goes to that section (the 20:45 turn read only the investigate skill and answered from the
  status).

## 0.6.290 (20 October 2026)

- State.conversation_read and its use in app._converse removed: `offer: after_reading` judges the answer's own turn
  again (owner, 2026-10-20: "i see the button `investigate this` for all the message responded by the agent"). The
  `session_read:` rows 0.6.287-289 wrote are pruned with the records. Test: test_command_offer (a later answer in the
  same conversation that read nothing carries none).

## 0.6.289 (20 October 2026)

- investigate timeline: `by_hour` — runs' starts (and a flagged state's entries) per hour of a period of 1-24 h, each
  beside the most that hour had on one day before; periods hidden while the device starts far more often than usual
  are said as "the counts above include them", never "like its normal" (owner, 2026-10-20: the answer said the House
  Pump went idle after its burst while it kept starting all afternoon). Test: test_investigate_shapes (the afternoon
  of 20 October's shape).
- skill.yaml `offer: decline` and button kind `d:<offer id>` (CommandOffers.decline): the offer's "No" — used up like a
  press, both its buttons removed (`_without_offer`), nothing run; investigate names "No, thanks" (owner: "add a
  button to reject the Investigation"). Test: test_command_offer.

## 0.6.288 (20 October 2026)

- investigate timeline: `schedule_line` — starts outside the hours of the schedule the knowledge pack attached to the
  device's asset (`schedule_of`: pack.row → pack.asset → schedule, the nightly check's own link), against the same
  hours of the days before, flagged by `starts_ratio` / `starts_min`. No device, kind or family named (owner,
  2026-10-20). investigate.py now gets the pack (`inject: [pack, store, zone]`; find's same-device lookup had none).
  Test: test_investigate_shapes (flagged in trouble, quiet on a normal day, absent without a schedule).

## 0.6.287 (20 October 2026)

- `offer: after_reading` judges the conversation: State.conversation_read keeps the reading tools a session used
  (kv `session_read:<session>`, RECORDS family), joined with the resumed one's; app._converse passes them on as
  TurnResult.read (owner, 2026-10-20: the House Pump question asked again was answered in 7 s from the earlier
  readings, read nothing, and got no button). Test: test_command_offer (a resumed turn that reads nothing still
  offers; a new conversation does not).
- skill.yaml `reads_history` (Skill.reads_history, "when the AI reads a device's history" on the skill's page): every
  ha_get_history of the AI (source history) is answered with that command's lines over the period and devices the
  villa's system read — investigate's `timeline` — in place of the readings (Toolbox._history_facts); a command that
  fails is said ("could not be worked out… never answer from a part"), never replaced by the readings (owner,
  2026-10-20: "I never want to see wrong responses"; the chat read the House Pump's 100 newest readings as its
  afternoon). Test: test_history_facts.
- investigate timeline, every kind against the same hours of its days before (owner: "universally handle all type of
  dataset"): `shape` runs · level · state · counter; `starts_line` (how often it started; `starts_ratio`,
  `starts_min`), `level_line` (range vs the usual band, when it left it; `level_band_margin`), `state_lines` (times
  per state), `counter_line` (rise; `rise_ratio`); levels and counters list no per-reading period, a state with more
  than `ordinary_hide_over` changes neither. `rests_at_zero` (`zero_rest_share`): a device whose rest reads 0 has no
  "no power" periods. Test: test_investigate_shapes (each kind flagged in trouble, nothing on a normal day).

## 0.6.286 (20 October 2026)

- skill.yaml `offer: after_reading: [tools]` (Skill.offer_after): a chat answer whose turn used one of those reading
  tools carries the skill's button, named in the answer or not. Toolbox.read lists the reading tools a run used
  (successful calls, each once), carried by TurnResult.read (THEN: joined) to CommandOffers.rows(read=). The
  investigate starter skill names ha_get_history and ha_get_logs (owner, 2026-10-20: the House Pump answer skipped
  the /investigate line and carried no button). Tests: test_command_offer (read → button; a state read → none; the
  parse refuses a non-list).

## 0.6.285 (20 October 2026)

- agent-contract.json copied from Kiosk 2.496.452: no "day" check word, no heartbeat `dayChecksAt`. `ticket.checks`
  == `checksBeforeList`, so `Kiosk.checks()` and `_gated`'s check-word gate are removed (`refresh` waits on
  `step_kinds` only); test_kiosk_cadence's sample is the agreement's whole cadence; test_fault_steps' "day" gate test
  removed.

## 0.6.284 (20 October 2026)

- PM-BATTERY-LOW / -CRIT keep a margin once open (owner: "yes, 5 points"): settings.yaml
  `battery_clear_margin_points` (5); rules.battery_rules takes `held`, the battery rules already open for the entity,
  and holds each up to its line plus the margin (the voltage LOW too). nightly.battery_findings reads them from the
  store, for the night and for recheck.py alike. The margin never opens a fault; the trend still projects to
  `battery_crit_pct`.

## 0.6.283 (20 October 2026)

- Every open finding of the night is read again every 5 minutes (owner: "remove the split, check every 5 min for all
  the reported issues"): recheck.READS maps every STATE/EVENT rule but PM-UNAVAILABLE to the night's own reading
  (nightly.asset_findings / level_findings extracted from run(); reconnect_findings takes a kept `book=`, its unused
  `only=` gone). Rules judged on a finished day read the last finished day, settled `recheck.day_settle_minutes` (15)
  after midnight, their verdict cached per finding and day. The reconnect loops' logbook is kept between ticks
  (`recheck.loopbook`): each tick reads only the minutes since the last.
- skill.yaml `rechecks: all` (→ Skill.rechecks ["*"]); `day_rechecks`, `kiosk: day_check`, Skill.day_checks_at /
  day_checked, the heartbeat's `dayChecksAt`, `recheck.py day` and the card's "day" are gone. Problems.card(task,
  rechecked) no longer takes the Kiosk's check words.
- test_day_recheck.py → test_recheck_all.py: a day-total fault that stays open mid-day and closes on the first tick
  after a clean day (and stays open after a bad one); the kept logbook counts as a whole read.

## 0.6.282 (20 October 2026)

- Skills › About's runs table: one width for the When column on every skill (`table.data.skill-runs`, 18em, nowrap,
  desktop only); test_ui checks it holds every starter skill's When.

## 0.6.281 (20 October 2026)

- A rewrite's backup (owner: "isn't it a risk of never receiving the information?"): result.edit(…, fallback=, to=,
  fallback_title=). Outcome.rewrite is the one decision: a chat whose kept copy cannot be rewritten (refused, deleted,
  two pages) gets ONE new message — a reply to that copy (Delivery.send reply_to → Telegram reply_parameters), else
  once without the reply — never twice (State.fallback_told / mark_fallback_told); with no copy kept at all, the
  backup goes to `to` like any message (Outcome.unkept_backups). Telegram's "message is not modified" stays a success.
- preventive-maintenance: told_cleared gives the backup — one line per item that cleared NOW (settings.yaml
  `told_cleared.fallback`, {time} and {what}); told_now keeps the message's role.

## 0.6.280 (20 October 2026)

- A message a skill may rewrite later: result.message(key=…) — the engine keeps where it went, its title and its
  "To:" (State.keep_message / kept_messages) — and result.edit(key, text, title) under a result's `edits`
  (outcome.CARRIED_KEYS): Outcome.rewrite → Poster.rewrite renders the same single-page layout and edits it in place
  (Delivery.edit). Never a new message: a message of two pages, or one Telegram refuses, is left and logged
  (rewrite_skipped).
- preventive-maintenance: a P2 it told (told_now, with its store) is kept; when one of its findings clears — the
  night, the day recheck, the back-online read — told_cleared rewrites that message: the item marked, the title too
  once every item cleared (settings.yaml `told_cleared`: tell, line, all_title).
- Copy the setup: instructions.md ticked at first. policy_doc.existing_off is THE rule for `skills_off` (only skills
  the villa has): the export, the import, every save of the page (PageFiles.form_policy → known_off) and deleting a
  switched-off skill (it leaves the list).

## 0.6.279 (20 October 2026)

- Copy the setup: a new part, the Limits tab's values (limits.yaml), ticked by default — checked on import against
  this agent's code (an unknown limit or a value out of its range is left out and said), shown as a row of the
  preview and written in one change of the history (LimitsTab.fitting / changes / write). The AI settings go in the
  current shape: an older file's `jobs` / `skill_brains` are moved as the page's next save would (policy_doc.ai_moved)
  before export. `skills_off` carries only skills the villa has; an import leaves out, and says, one it will not have.
- vesta_shared.store.alerted_states: which states an open alert is about, ONE reading for the alert desk (rule_states)
  and the night check (alerted_offline). A numeric rule's events carry its blueprint's default bad_states
  ["unavailable"]; the night check took an open overload alert as already following the meter going offline.
- vesta_shared.critical.run_when: a critical rule's "When this rule runs" (blueprint input `run_when`, stand-alone
  variable `vg_run_when`). The reports' quiet lines say when the rules watch (reports.yaml nothing_happened_scope);
  investigate says it after what a rule is able to do (settings.yaml words.runs_when_*); alert-desk and
  villa-concierge SKILL.md explain the choice.

## 0.6.278 (20 October 2026)

- One name for a job everywhere: its skill, then what ran (skills.job_title). An AI job reads "reports › fm-daily"
  in Overview › Scheduled jobs run and on the Costs tab, as a code job already read "preventive-maintenance ›
  recheck.py". The costs answer says `job` and `by_job` (was `work`, `by_work`).
- Costs › Every run: a run's steps show their number first, across the run's whole width.

## 0.6.277 (20 October 2026)

- The Kiosk agreement copied from Kiosk 2.496.445: its message channel (/agent/v1/messages, /choices), never
  used by the agent, is gone; the entity-id pattern moved to the top level. Nothing the agent does changes.

## 0.6.276 (20 October 2026)

Retro of 20 October:
- PM-HIDDEN-IN-RULE (preventive-maintenance, nightly, P3, a state rule): one fault per villa automation or script that
  names an entity hidden in the villa's system (pack.hidden) — whole ids only (rules.ids_named: never inside a longer
  id, never in a rule's alias, description or notes). A night that cannot read the rules keeps the open ones. Read by
  the new client method rules_mentioning (one ha_search per hidden id, every page, each rule read once:
  ha_config_get_automation / ha_config_get_script, now a READ_TOOL). Owner, 2026-10-20: the "critical devices
  offline" rule still watched two locks replaced by corrected copies and alerted on one.
- test_every_starter_skill_version_is_recorded_as_shipped skips a skill git sees changed and not yet committed (`ship`
  records it as it commits); a committed, unrecorded one still fails. The suite was red between every skill edit and
  its release.

## 0.6.275 (20 October 2026)

Architecture review of 20 October, #6 — one list of the faults read again in the day:
- skill.yaml `day_rechecks` is the ONE list of WHICH rules the day recheck reads (what the Kiosk card's "Next check: at
  12:00" says); recheck.DAY_READS is only HOW, a named RecheckRule(rows, entities, found) per rule instead of positional
  lambda tuples. A rule the skill names without a RecheckRule is refused (recheck.Unreadable): `recheck.py day` exits 1
  and its last stderr line, which Overview shows, names it — it was a stderr line and a silent skip while the card kept
  promising. Test: a copied skill naming PM-POWER-CHANGE stops the run, reads nothing and says which; three mutations red.

## 0.6.274 (20 October 2026)

Architecture review of 20 October (the day's changes), its Strong candidates:
- The reconnect period has ONE owner: features.flips_per_day(..., end) files each drop under the 24-hour periods ending
  at `end` — at the night's end (midnight) the calendar days, as before; at the day recheck the true last 72 hours. The
  12:00 recheck counted two and a half days against a three-day threshold: a real loop "cleared" at noon and opened
  again at night. nightly.reconnect_findings passes its `end`; drops after it are not counted. Tests: the same
  logbook at midnight and noon, and a loop spread over the whole 72 hours kept open by the real day recheck.
- Limits tab: no `jobs_default` rows (the reports' starting brain and limit — Rules' settings.skill_ai is what runs, so
  they changed nothing), and every row whose save writes a skill's own file (skill.yaml, a number inside a list) says
  that the skill then becomes the villa's copy, its updates waiting in Skills › Compare.
- `KnowledgePack.detailed_days`: the one reading of the measured days (script.Context, tools, the Limits tab each
  parsed it).

## 0.6.273 (20 October 2026)

- Skills: the button is "Delete Skill" (it read "Delete the skill"), and it is on the About tab too, not only on
  Files — one button and one handler for both (skills.js delSkillButton; owner, 2026-10-20). Test pins both places.
- Overview › Scheduled jobs run: the engine's nightly job is "Villa's device list (refreshed)" (scheduler.ENGINE_JOBS;
  "knowledge pack" named nothing a person knows — the Limits tab's measured line says the same), and its run is kept
  like every scheduled job's (in_progress kept, Item SCHEDULED "engine:pack"), so it reads "done" — it read "run"
  beside the night check's "done". Housekeeping's label is "Old records removed". Test through the real scheduler.

## 0.6.272 (20 October 2026)

- Rules › AI tools › Tools by role: the line "Asking for an action is decided by Allowed actions: who approves stays
  there." is gone (owner, 2026-10-20) — who approves is Allowed actions' own, said there.

## 0.6.271 (20 October 2026)

- Limits tab: "Changed from its usual …" only under a value that differs from its usual one (the test was inverted:
  every row said it, beside its own usual value — owner's screenshot). Test pins it.

## 0.6.270 (20 October 2026)

- The day recheck (08:00, 12:00, 16:00, 20:00) reads the open reconnect loops again (owner, 2026-10-20: "yes" — 17 false
  loops waited for the night to close): preventive-maintenance skill.yaml `day_rechecks` adds PM-RECONNECT-LOOP, and
  recheck.DAY_READS reads it with the night's own reading, now one function (`nightly.reconnect_findings(..., end,
  today, ..., only)`), the villa-wide logbook of the last reconnect_days read ONCE per day recheck whatever the number
  of loops open. A loop no longer found closes ("Cleared: the check at 12:00 no longer sees it."), one still there is
  recorded as seen. The Kiosk's "Next check" for such a fault is the next day-check time. Test (test_day_recheck): a
  fan whose drops were reloads closes, a relay that really drops stays. Mutation-proved.

## 0.6.269 (20 October 2026)

- One brain and one spending limit per run for all the AI jobs of a skill (owner, 2026-10-20: "define the cap only once
  … for the report skill as a whole"): policy.yaml `settings.skill_ai: {skill: {brain, limit_usd}}` replaces 0.12.277's
  `skill_brains` + `jobs.<job>: {limit_usd}`. `Policy.skill_setting` is the one reading; `job_settings(owners, starters)`
  gives each declared job its skill's pair. A skill's starter pair is its skill.yaml `jobs_default` (reports: auto,
  2 US$; an older skill copy falls back to its jobs' strongest brain and largest limit), `skills.job_starters`. Both older
  file shapes are read without a problem — the brain as 0.12.277 resolved it, the skill's starter limit, never the
  jobs' own — and every form save moves them to `skill_ai` (`policy_doc.ai_moved`, comments kept; a new-shape file
  unchanged byte for byte). Rules › AI brains and limits: one row per skill (brain, limit for each run, tools, +/×), its
  jobs named under it. `/api/jobs` gives `skill_ai` and `skill_default`; Add them writes the starter pair. The Limits
  tab (one brain and one limit row per skill, saved whole), setup copy, history words, policy.example.yaml and DOCS
  follow. Tests: the real job path, both older shapes read and migrated, the form round-trip, Add them, the tab,
  `jobs_default` and its fallback. Mutation-proved.
- Night check: a drop back within `reconnect_min_drop_seconds` (preventive-maintenance behaviour, 10 s) is not a
  reconnect (features.flips_per_day). The villa's 20 October night opened 19 "dropped and reconnected 10 times in 3
  days" faults: every ceiling fan, two inverted locks, a test lock, a curtain and template sensors — each save of a
  template, helper or package reloads the villa system's virtual devices, "unavailable" for ~50 ms, nine times in two
  days. Measured on the villa's logbook of 17–20 October: 30 entities over the line before, 2 real devices after (a
  Thread sensor, a relay; the hidden TV is left out already). Tests: the counting by value and the night check itself.
- Costs › Every run: the chat name before the steps pill, the pill at the line's right end; the Tools called column
  gone (the steps list them); a run's steps have a header and the skill each step read or ran a script of first
  (status.steps_of `skill`); When on one line.
- Limits tab: Save at the right end of its line.

## 0.6.268 (20 October 2026)

One brain for all the AI jobs of a skill (owner, 2026-10-20): policy.yaml `settings.skill_brains: {skill: brain}`, and
`settings.jobs.<job>: {limit_usd}`. `Policy.job_settings(owners)` is the one reading of a job's brain and limit, with
`owners` from `skills.job_owners` (the skills' own declarations). An older file's `profile` per job is still read: the
skill's brain is the strongest of them, logged once when they differ. Every form save of the page (Rules forms, Add
them, the Limits tab) moves it to the skill (`policy_doc.brains_moved`, comments kept; a file in the new shape is
unchanged byte for byte). Rules › AI brains and limits: one brain row per skill, its jobs and their limits under it.
`/api/jobs` gives `skill_brain` and `brain_default`; Add them sets a skill's starter brain when it has none. Setup
copy, Page changes wording, the Limits tab (one brain row per skill), policy.example.yaml and DOCS follow. The reports
skill's owner-monthly starter brain is auto. Tests: the real run path (one change, every job), the older file read and
moved on save, the form round-trip, Add them. Mutation-proved.
- Long-term figures where the skills read older periods: the investigation page's chart covers the whole period, the
  part before the detail kept drawn from the hourly figures (each one's highest) on a band "from the hourly figures:
  every change is no longer kept" (page.FIGURES); the reports' "electricity while the villa is empty" clue says where
  its count begins (playbook). Tests in test_retention, mutation-proved.
- Skills › About: the skill's whole description above "When the … skill runs" (skills.js aboutSkill).
- Limits tab: two columns — what happens when the limit is reached, and who is told, inside its description; the value,
  its unit, its bounds and Save on one line; lower rows (limits.js, app.css).

## 0.6.267 (20 October 2026)

- Costs › Every run: a chat run's chat name ("fm private chat") sits on its title line, after the steps or "Whole
  question" pill (owner, 2026-10-20), no longer on a line of its own (costs.js runWhat).

## 0.6.266 (20 October 2026)

- The knowledge pack's rules are 4 (PACK_RULES): a pack without the measured days of detailed history is rebuilt when
  the agent starts, so an update measures it at once — not at the next 01:30 (owner, 2026-10-20, updating at 01:40).
- The Limits tab shows the measured days ("detailed history kept (measured)", group How long things are kept): the
  villa's own setting (recorder purge_keep_days), shown and never saved from the page (a save is refused).
- `retention.figure_period`: the 7 days up to which older figures are read one an hour is a limit
  (`history.hourly_figures_days`).
- Tests: the tab's measured row (not measured yet; 11.3 days from a pack; a save refused).

## 0.6.265 (20 October 2026)

How far back the villa's detailed history goes is MEASURED on the villa, and every reader switches to the long-term
figures before it (owner, 2026-10-20: "be clever enough to switch to long-term memory when necessary" — ha-mcp only
says "~10 day retention" in its help and never reads the real setting nor switches; the skills read a period older than
it as empty and said "nothing recorded").
- New `vesta_shared.retention`: `measure(client)` — the oldest change of sun.sun the villa's system still holds (a day
  window at a time, by halving: about 12 reads), in days; the knowledge pack's nightly build stores it
  (`retention.raw_history_days` / `logbook_days`, None when it cannot be measured). It replaces the 10 days the pack
  claimed (the limits `villa.history_days` and `villa.logbook_days` are gone: the footer prints the measure).
- `HABase.detailed_days` (script.Context sets it from the pack) and `kept_from(now)`; `History` and `Logbook` carry
  `older_than_kept`: where detail begins when the period starts before it. One sentence: `retention.not_kept`.
- investigate: a device's timeline over a period (partly) older than the detail says so and lists its long-term
  figures for that part (`older_figures`: one an hour up to a week, one a day beyond; mean, min, max, change), or that
  none are kept of it (doors, locks, switches) — never "nothing recorded"; the logbook's `around` says the logbook
  before it is no longer kept.
- reports: an alert count over a period older than the logbook kept is said as "counted from …".
- The AI's own reads (tools.Toolbox): a history read reaching before the detail gets `older_than_detail` in its answer
  — the note, and the long-term figures of that part read by the engine (or the devices that have none); a logbook
  read gets the note.
- Tests (test_retention): the days measured on a synthetic villa (12.25 and 30 days); History/Logbook through HABase
  and the real McpClient; Context gives the pack's measure to its client; an investigation 20 days back reads the
  pump's figures and says the door has none; the AI's answer gets figures and note, untouched when kept or not
  measured; through the real Toolbox. Mutation-proved.

## 0.6.264 (20 October 2026)

Every limit on what the agent reads, says and keeps is declared where it applies and set in one place: the VESTA Agent
page's new Limits tab (owner, 2026-10-20: "keep them, but create a temporary tab in the Agent UI to define them
centrally and exhaustively"; a change there changes the value the other tabs show, and nothing on them moved).
- New `vesta_shared.limits`: `limit(key, default, *, unit, group, lo, hi, says, reached, told)` answers the villa's
  value from `limits.yaml` (beside policy.yaml; `VESTA_LIMITS`, given to every skill script by `script_env`) or the
  default — a value of the wrong kind or out of its bounds is the default. Read again when the file changes, so the
  long-running engine calls it where the value is used. `scan(roots)` reads every `limit()` call from the source.
- 141 numbers written in the code are now `limit()` calls with today's value as default (behaviour unchanged): the
  history, statistics and logbook readers (pages, slices, calls, timeouts), the logbook's 6-hour villa window, the
  AI's tool answers (parts, description, status), investigate (find 20, neighbours, 12 devices a timeline, lists of
  40, 120 lines, page and facts), the night check (battery read 14 days, temperature 2 days, raw power 1 day, runs
  under 30 minutes, the rules' minimums), reports (digest 8 lines, headline 5 and 3, playbook 8), energy (loads 8,
  headline 3, movers 5), the chat status (12 names), alert and fault titles and notes, Telegram's sizes, "again" 7
  days, kept days, timeouts of scripts, jobs and voice. Module constants other files read became functions
  (`history_page()`, `logbook_villa_hours()`, `part_chars()`, `again_days()`…); a few kept as aliases for scripts.
- The AI's own reads get the villa's limits where the AI gives none (tools.ai_read_defaults: history and statistics
  rows 100, logbook 50, search 10, 24 hours, 30 days; the fewest rows it may ask for, 1) — only an argument the
  tool declares, after the read guard.
- The page (ui/limits_tab.py, static/limits.js, places.TABS "limits"): every limit of the code, every number of every
  skill's settings files (its comment is its description; `…families` lists and a command's brain too) and the rules'
  numbers (brain, limit per reply, conversation reset, each AI job's brain and limit, keep, approve buttons, siren).
  Saved where each lives, through PageFiles (checked, in Page changes, undoable): limits.yaml (new kind "limits"); a
  skill's villa.<file> (a number inside a list: the skill's own file); policy.yaml, checked by the agent's rules. Each
  row says where else it is shown, and that a vesta_<name> helper wins over a skill's behaviour value.
- Tests (test_limits): every declared limit readable, described and within its bounds; limit() reads the file, falls
  back and re-reads; the page lists the three sources and saves each where it lives (the skill reads the villa file,
  a list's comments kept, policy checked, Page changes); a value set reaches the AI's own reads through the real
  Toolbox; and no list or text is cut by a bare number anywhere in the agent (NOT_LIMITS: the 33 that are not limits,
  each with why). Mutation-proved.

## 0.6.263 (20 October 2026)

What the AI writes to a person never names the platform underneath: "the villa's system" (owner rule, 2026-10-15; a
chat on 20 October read "The investigate skill will trace through Home Assistant's history and logs around that time…"
although instructions.md rule 6 forbids it — the skills the AI reads named it, and the rule was left to the model).
- New `vesta_shared.messaging.no_platform_name(text)`: "Home Assistant's X" (and "HA's X") → "the villa's X"; "Home
  Assistant" (any case) and "HA" standing alone → "the villa's system", the word before it that it replaces going with
  it ("your / the / this / a … Home Assistant"); a capital at a sentence's or a list line's start. Never touched: "HA"
  inside or joined to another word (HACS, ha_get_history, HA_TOKEN, HA-MCP, /HA), code spans and blocks, links.
  `no_platform_name_in(notes, keep=())`: the same on every text of a page's notes (dicts and lists), `keep` as written.
- Applied where the AI's words leave for a person, once each: TurnReply.compose's final text (rule 9), the AI's own
  send_message text (tools._send), the report page's notes (reports compose.page) and the investigation's notes, its
  page and its chat message (investigate page.py; its `sources` — a web page's own title — kept). Logs and the Agent's
  page untouched.
- Starter skills say "the villa's system" / "the villa's records" instead of Home Assistant in every description
  (preventive-maintenance's skill.yaml, investigate's and alert-desk's SKILL.md, investigate.py's script line) and in
  the prose the AI may repeat (alert-desk, investigate, preventive-maintenance, reports, roi-energy, villa-concierge
  SKILL.md; reports' job prompts and its reading instruction). Every rule kept, word for word apart from the name;
  step numbers unchanged. The investigation page's own footer and "no web page" line said "Home Assistant's records".
  Code comments, tool names (ha_*) and the logbook text reports.yaml matches ("Home Assistant starting") unchanged.
- instructions.md names it once, where the AI needs to know what it is ("the villa's system (Home Assistant
  underneath)"), and in rule 6, which forbids it; rules 4 and 8 say "the villa's system".
- Tests (test_no_platform_name): the function by value (12 sentences: possessive, "in HA", a capital, "your", a list
  line; HACS, ha_get_history, HA_TOKEN, HA-MCP, links, code unchanged); a chat turn whose AI answers "Home
  Assistant's history" and sends "HA restarted" reaching Telegram as the villa's; a report page and an investigation
  page and its message from notes naming it; every starter skill's descriptions (skill.yaml, its scripts and commands,
  SKILL.md front matter) and the investigation page template; instructions.md naming it only twice. Mutation-proved
  (17 mutants, each RED by its own test).

## 0.6.262 (19 October 2026)

A reply that tells the person to write /investigate carries a button that does it (owner's screenshot, 19 October: asked
about the pool pump, the reply ended "write /investigate followed by your question…").
- skill.yaml `offer: {label, pressed?}` (skills.Skill.offer; only on a skill with `command:`, label required, nothing
  else): a command skill a chat reply may offer. The investigate starter skill: "🔎 Investigate this" / "Investigating";
  proposals has none (it needs a number). The page's "in a chat" row says the button too (when_it_runs).
- New `command_offers.CommandOffers`, the offer start to end. `rows`: every "/command" the answer names
  (intake.SKILL_TOKEN, the skills switched on) whose skill has `offer`, not under that same skill's own request, with a
  question asked — judged by `app.Vesta.gate` (intake.gate with the villa's rules, now one method that handle_message
  uses too) on the message the button stands for: "/<command> <question>" typed by the asker in that chat. The
  question kept is the turn's `asked` (the person's words), in State `command_offer:<id>` (a RECORDS family, pruned
  with the records); the button's data is `o:<id>` (button_data.COMMAND, FOR_PEOPLE_ONLY).
- `press`: the offer read (unused, this chat), the gate asked again for the person pressing (a group taken out of
  People since, a skill switched off since: a toast, nothing runs, the button stays), then claimed once
  (State.claim_command_offer; a second press: "Already started."), the toast and the message's status say
  "<pressed>: “<question>” (<name>)", the pressed button goes and the reply's other buttons stay (its reply_markup),
  and app.handle_message runs the typed command — the same intake, command_request, brain, limit, page and fault offer.
- turn_reply: rule 7 (the command offers, added to the other buttons); the approval rule is now 8.
- `Delivery.settle(chat, mid, msg, said, keyboard=None)`: a pressed message, whole, its status under it within its own
  limit (a caption's 1,024) — FaultOffers' "_say" moved there and both use it.
- Tests: test_command_offer (9: the button for the owner and the facility manager with the question kept, none
  without the mention / for a switched-off skill / for someone the villa does not know / without a question / under
  the investigation itself, the press equal to typing it (skill, tools, brain, limit, prompt), once, judged again at
  the press, the other buttons kept, the claim, skill.yaml checks); test_turn_reply rule 7; test_page_controls'
  fields list and row. Mutations red: see ARCHITECTURE.md.

## 0.6.261 (19 October 2026)

Costs › Every run: the question whole, and each step in a line (owner's screenshots, 19 October).
- status.script_args: one reading of a script's arguments (a list, its JSON text, or a command line) for the run
  (tools.run_skill_script: list(text) spread it letter by letter and the call was refused) and the page
  (command_line). Test: test_a_scripts_arguments_sent_as_text_run_as_the_list_they_are (one mutation red).
- The question was cut at 160 characters by runner.run (`(asked or "")[:160]`, both the finished and the cut run's
  record), mid-word on the row and in its tooltip. Now `runner.kept_asked`: whole up to `ASKED_CHARS` = 2,000 (any
  typed or spoken question; a pasted page stays bounded in a record kept a year), through `redact.scrub` (it was not
  scrubbed before). Questions recorded before this version stay cut.
- A step records its arguments (`runner.step` → `{tool, args}`, `vesta_part` dropped, each text cut to `ARG_CHARS` =
  300, lists to 25 items, three levels deep; `kept_steps` scrubs them as one JSON text) instead of a 160-character
  line. Its old line spread a script's `args` sent as text letter by letter (`map(str, "[\"--period\", …]")`).
- `status.steps_of` serves each step as `{n, tool, summary, raw, code}`; `status.step_summary(tool, args, name_of)`
  is its line: read_skill → the skill; run_skill_script → `command_line` (a list, or that list as JSON text, joined
  with shlex quoting); ha_get_history/state/logs → the devices by name (knowledge pack, else the id; three, then
  "+N more") and the period; ha_search → "lights matching “dining”"; ha_call_service → "light.turn_off · 2 lights:
  …"; web_search → the query in quotes; save_file → the name; send_message → "to here · page.html"; any other →
  key=value, each value 40 characters, the line 160, cut with "…". `raw` is the arguments as indented JSON (the
  tooltip). A step recorded before shows its old line as it was. The UI server passes `KnowledgePack.name_of`; the
  tool log line (`tools.py`) uses the same summary.
- Page: `core.paged(head, rows, per, {cls, widths})` takes a row `{cells, more}` — `more` on a line of its own under
  the row, across every column, opened by `core.moreButton` ("11 steps ▸"); each row's two lines are made once, so a
  page turned and back keeps its state. costs.js `runWhat` (label, chat, the question held to three lines, its tooltip
  the whole question) and `runMore` (the whole question, then a grid of number · tool chip · summary, each line
  ellipsized, `raw` its tooltip, the command line in the typewriter face). Every run: cells at the top, columns given
  widths. CSS for both themes from the existing tokens; `.what-tip`/`.what-detail` removed.
- Tests: test_ui (a 600-character question recorded and served whole, 2,000 the limit, a secret scrubbed; the page
  draws the served text, no cutting; the layout pins), test_page_controls (/api/costs serves each tool kind's line,
  the list-as-text script, names from the pack, the cut, an older step), test_tool_access (a step keeps its bounded
  arguments; scrubbed by key and by shape).

## 0.6.260 (19 October 2026)

Each AI run's own cost, not its conversation's (owner's screenshot, 19 October: one chat's Haiku replies of ~48k tokens
at 0.44 … 0.56 USD, climbing).
- Measured: the SDK's `ResultMessage.total_cost_usd` on a resumed conversation is the conversation's running total —
  the bundled CLI 2.1.284 restores a "cost-state" from the transcript on resume (and its own budget check subtracts it,
  so `max_budget_usd` stayed per run). `usage` is the run's own.
- runner.run records `session` and `session_total_usd`; the run's cost is `agent_records.turn_cost(total,
  session_before(State.runs_of(resume, who), resume, who))`: the total minus the conversation's last recorded total
  (by session; a pre-0.6.260 row of the chat, whose cost was the CLI's total, the first time; the whole total when it is
  lower — a count started afresh). Holds across a restart (the records are the base). Past rows are not rewritten.
- Costs › Every run: a "Skills" column before "Tools called". A run records `skills` — the skill it was started for
  (`Terms.skill`: an AI job's declaring skill, `Turns.job(..., skill)`; a command skill's, `chat_terms(..., skill)`),
  then each `read_skill` / `run_skill_script` skill, in order, once each (`runner.skills_of`); `status.costs` serves
  them, `costs.js usedSkills` draws them as chips, "—" for an older row.
- Tests: test_run_records (a resumed conversation's turns each with their own cost, across a restart and a Continue by
  someone else; an older conversation's first resume; a count started afresh; the skills of a chat and a job run),
  test_page_controls (/api/costs serves the skills; the page draws them before the tools), test_ai_jobs (a job's run
  carries its skill), test_ticket_offer (a command's run carries its skill; an ordinary message none).

## 0.6.259 (19 October 2026)

The night's open faults read again during the day (owner, 19 October: "refresh the open ones every 4 hours during the
days … just re-check the identified ones").
- preventive-maintenance: `recheck.py day`, run without the AI by four schedule entries marked `kiosk: day_check`
  (08:00, 12:00, 16:00, 20:00 — the villa moves, adds or removes them in skill.yaml; none switches it off), reads the
  open findings of skill.yaml `day_rechecks` (PM-BATTERY-CRIT, PM-BATTERY-LOW, PM-SILENT) each by its own rule over its
  own device — `recheck.DAY_READS` calls the night's own functions, `nightly.battery_findings` and
  `nightly.silent_findings`, moved out of nightly.run (one implementation per rule). Never a full night, never another
  finding, never a new one; a state not read back or a battery with no value closes nothing. Left nightly, judged on a
  finished day: PM-POWER-CHANGE, PM-ENERGY-CHANGE, PM-RUNHOURS, PM-LEVEL-HIGH; PM-RECONNECT-LOOP (the villa-wide
  logbook); PM-UNAVAILABLE stays every 5 minutes.
- `Problems.record_rechecked(rechecked, seen, day, at, note=, settle_minutes=)`: each finding read is recorded seen
  (Problems.seen — a person's close the settle time or more before opens it again, "Still there after the close.") or
  closed and settled with `note`; only among those read. One close wording: nightly.CLEARED / `cleared_note` —
  "Cleared: the nightly check no longer sees it." at night, "Cleared: the check at 12:00 no longer sees it." in the
  day. Nobody is messaged for a close (the night's rule).
- The card's "Next check": `Problems.card(task, rechecked, day_rechecked, checks)` says "day" for a rule a day recheck
  reads, to a Kiosk whose /agent/v1/info lists it in `ticket_checks` (`Kiosk.checks()`; else the agreement's
  `ticket.checksBeforeList`, and "nightly"); `Kiosk._gated` writes no check word the Kiosk does not show; `refresh`
  re-reads the info while it lists no `ticket_checks`. Skill.day_rechecks, Skill.day_checks_at, Skill.day_checked;
  skills.KIOSK_JOBS + "day_check". The heartbeat's cadence carries `dayChecksAt` (absent without a day recheck).
- The agreement (agent-contract.json) copied from the Kiosk 2.496.429: ticket.checks + "day", ticket.checksBeforeList,
  heartbeat cadence `dayChecksAt`, info `ticket_checks`.
- Tests: test_day_recheck (the day recheck end to end, a read that failed, a person's close and reopening,
  record_rechecked, back again at night, the skill's lists, the scheduler's times), test_fault_steps (one device with an
  alert and a night fault: "minutes" and "day"; an older Kiosk: "nightly"; the gate), test_kiosk_cadence,
  test_contract_ticket.

## 0.6.258 (19 October 2026)

The night check owns each number asked twice (owner, 19 October: "proceed with the recommended implementation").
- The page (owner, 2026-10-19): tool_access.catalog's role rows carry `from` (the tab their switch is in, places
  titles) and rules.js draws it; skills.js shows no Tools tab for a skill that lists none (`hasTools`);
  skills.when_it_runs words a command skill's chat row with its `usage` as an example; proposals' usage rewritten.
  Test: test_a_command_skill_says_how_it_is_used_and_a_skill_without_tools_has_no_tools_tab (two mutations red).
- A PUMP'S "RUNNING POWER DROPPED" HAS ONE OWNER: an equipment card on the weekly page is "Watch" exactly when the one
  list names its device (its clues and the night's open findings — PM-POWER-CHANGE for a pump's power). Gone: the
  card's own "last 3 days 10 % under the days before" (facts._status_from, reports.yaml thresholds.pump.watch_drop_pct)
  and the playbook's "running power stepped down" clue (playbook.clue_power_step, its reports.yaml entry). Tests:
  test_reports (the same 850 W → 740 W is "OK" with nothing found at night, "Watch" with the finding; one to-do line).
- A BATTERY'S STATE HAS ONE OWNER: new vesta_shared/battery.py — `charge` (device_state.battery_charge moved here, its
  old name kept as a re-export for a villa-edited skill), `projection(points, floor_pct, level=None)` → {per_day,
  days_left} (the night's PM-BATTERY-TREND projects to its battery_crit_pct, passed in) and the rule ids CRIT / LOW /
  TREND. The weekly page draws each battery's charge and the night's verdict: "replace" from an open PM-BATTERY-CRIT /
  LOW problem, "watch" from an open PM-BATTERY-TREND finding, with the finding's sentence (`night`) under the bars when
  the AI wrote none. Gone: the page's 20 % / 35 % (reports.yaml battery.replace_below_pct / watch_below_pct) and the
  "battery falling" clue (its own weeks left to 20 %). Tests: test_reports, test_one_day_format, a unit test of
  battery.projection and of the night's trend sentence.
- A RETIRED SETTING IS NAMED: `skill_settings.retired(skill_dir, file)` — a skill's `retired:` maps a dotted setting to
  what decides it now; a villa.<file> that still sets one gets one sentence ("villa.reports.yaml sets
  thresholds.pump.watch_drop_pct, which is no longer used: …"): the report's problems, the investigation's answer
  (`settings_not_used`, and the script's log). A villa playbook entry of a retired `when` kind (power_step,
  battery_trend: reports.yaml `retired_kinds`) says so instead of "unknown when kind".
- "RUNNING" FOR /investigate IS THE VILLA'S ONE RULE: `daily.hour_rows_of` buckets raw readings per hour (max, mean of
  the readings) and `daily.threshold_from_readings` asks `running_threshold`; investigate.threshold(rows, params) uses
  it (its flat_spread check stays). Retired: running_fraction, high_quantile, running_min (named if a villa file sets
  them). Measured: the test heater's threshold 250 W → 150 W, the idle-every-10-s meter 75 W → 150 W; every
  investigate test passed unchanged. on_threshold_fraction is now in four skill files (investigate's added), held
  equal by test_skill_settings, each saying the villa helper vesta_on_threshold_fraction is how to change it.
- THE INVESTIGATION'S CHARTS ARE THE SHARED PAGE MODULE'S: timechart, hourchart and strip moved to vesta_shared.page,
  their colours and words parameters (band, readings, usual, bar, colour_of); investigate's page.py binds its
  BAND_COLOURS / LANE_STYLE and imports no private name (test over every starter script). One `legend` and one `pill`
  macro in vesta_shared/templates/page_parts.html, imported by report.html and investigation.html (the report's
  energy-days legend takes the investigation's look; `.legend i` removed from page_head.html).
Owner-approved fixes to the villa's own alert messages (19 October).
- "TO:" BY PRIORITY IS THE ALERT DESK'S TABLE: message_format.priority_to reads the desk's released rules.yaml
  (people_roles, priority_does) and jinja_words writes it into vesta_message.jinja as vm_priority_to; the template
  says it when a rule passes vm_priority (P1 "Owner & FM", P2 "FM", P3 "digest", P4 "log", as desk.reaches and the
  agent's card), else vm_to, else the villa-wide helper, as before. The blueprints drop their hand-written
  "P1 → Owner, Facility Manager" expression. Tests: test_ha_message_layout (every priority → the desk's own words;
  the table read from the settings, never typed; "P1", "'digest'" forbidden outside the words block).
- ONE CLOSING WORDING: message_format.closing(tail) — "Cleared on {time}." / "Cleared on {time}: <tail>." — is
  STAGE_WORDS["closed"] (it was "Closed: nothing more to do", reached by no renderer) and every end of the desk
  (resolved, seen again, stopped watching, the rule gone, the villa back online: "Closed on …" retired). The template
  fills "{time}" with its clock in timeutil.MOMENT_FORMAT (moment_label's, now one constant); the agent, with no time
  to give, says "Cleared." (stage_words). Tests: test_ha_message_layout, test_alert_desk (the desk's note IS the
  stage's words; the rule-gone end opens with them), test_one_saying.
- THE TEMPLATE NO LONGER DRAWS A PRESS: vm_who, the 'help' stage, the "Done"/"Need help" labels and the hand-written
  strftime are gone (no enabled rule sends task_text; only the agent chases). PRESSED stays the agent's.
Architecture review, 19 October (owner: "proceed with the recommended implementation").
- ONE RULE FOR A CLOSE WHILE THE PROBLEM IS STILL THERE: a person's close holds until the source is read again and is
  still bad; then the task opens again saying "Still there after the close." (problems.STILL_THERE) and the facility
  manager is told by the skill. An alert keeps today's path (desk.quiet_after_done). A finding: each reading records
  the fact — store.finding_seen (findings.seen_at, settle_minutes; migrated), written by Problems.record (the night,
  the recheck's new findings) and Problems.seen (recheck.py's reading of a device whose finding is open; it skipped
  them) — and Problems.wants_open decides (still_there_after_close: read its settle time or more after the close).
  The settle time, recipient, title and words are preventive-maintenance settings.yaml `still_there_after_close`
  (minutes 10 = the alert desk's clear_minutes; none in code: a missing one is named on stderr and the close holds);
  recheck.still_there_untold tells each once (store.untold_findings_reopened). A night fault closed in the Cockpit
  while the pump was still unavailable stayed closed, nothing said. Tests: test_back_online (reopens at the recheck
  after the settle time, told once; a close after the device came back stays closed), test_problem_close (re-pinned).
- FAULT ACTIONS CARRY ONLY WHAT IS READ: a task's change is result.faults_changed() ({"action": "faults_changed"});
  Problems.settle / settle_all return task ids, record `task_ids` / record_night `resolved` ids (their old `tasks`,
  `reopen_actions`, `resolve_actions` kept, built from the ids, for a skill edited before 0.12.267), close_incident /
  close_finding [faults_changed] (result.moved); desk._ladder / _reprioritised, nightly and recheck send it.
  result.fault is a chat's fault. The engine still reads ticket {task_id}, ticket.resolve, ticket.reopen (and a task
  id in `actions`) as the same — a starter skill edited on a villa sends them; result.reopened / resolved and
  fault(task_id=) stay for it. nightly's --out: tasks_to_create / tasks_resolved are id lists. Tests: test_outcome
  (every shape repairs; no starter skill builds an old one), the desk, back-online and close tests re-pinned.
- THE KIOSK-VERSION GATE IS THE KIOSK CLIENT'S ONLY DOOR: Kiosk._gated runs in add_ticket, amend, reopen_ticket and
  resolve_ticket: a step kind the Kiosk does not list is written without its kind (a close read by its note), or not
  at all when it changes no status (notStatusChanges: it would read as a change of status); a declared field it does
  not list is not written. A Kiosk that lists nothing gets the agreement's base sets (ticketUpdate.kindsBeforeList,
  ticket.fieldsBeforeList — new keys, the Kiosk's 2.496.355 and 2.496.381 sets). takes / says are gone; tickets
  asks nothing (Kiosk.refresh re-reads /agent/v1/info while it lists no kinds). Tests: test_fault_steps, test_card_story.
- THE HEARTBEAT FOLLOWS THE KIOSK'S WINDOW: its interval is a third of the answer's offline_after_minutes, never under
  30 s, 120 s until the first answer (kiosk.beat_every; HEARTBEAT_EVERY gone); a "cadence": "refused: …" answer is
  logged once. A Kiosk set to "offline after 1 minute" showed the agent offline and online by turns. Tests:
  test_kiosk_cadence.

## 0.6.257 (19 October 2026)

Architecture review scan 4, 19 October (one verdict per fact, one sentence per outcome, places named once).
- ONE VERDICT ON WHETHER A SKILL WORKS: tool_access.health is the verdict object the page draws — its `line` (the
  skills list and the skill page's "Skill tools" heading say the same), its `tools` rows with each tool's state in
  words (STATE_WORDS), `where_tools` behind the tab's (i), in the owner's rule of 2026-10-10 (a tool switched off is
  gone without; the skill runs). skills.js counted "N of M not available" itself and its (i) still said a switched-off
  tool made the skill "not working". setup_copy judges a tool by tool_state and says "the villa's system" (it said
  "this Home Assistant's MCP server"); test_no_platform_name reads it. Tests: test_tool_access, test_page_controls
  (the heading equals health.line through HTTP; no verdict words of the page's own).
- A JOB WHOSE AI SENT NOTHING IS ITS OWN OUTCOME: AiJobs.run judges "did this job deliver" (TurnResult.sent plus its
  on_limit steps'): a run neither failed nor sent is recorded (agent_records.JOB_NO_RESULT {job, why}), a failure on
  the Overview, a row on the Costs tab beside the run ("not sent", the why), and told ONCE — the one sentence
  (api_errors.NOT_COME, NO_RESULT) sent through Outcome as the job's result, so the waiting message goes like any
  result; on schedule it goes to the job's own chats. It was logged "done" with its cost, counted as a reply written,
  nobody told on schedule, and in a chat the waiting message edited to "ended without a result" (now only for a task
  that died). Tests: test_ai_jobs (recorded, counted, told once; the limit's cause), test_jobs.
- "SCHEDULED JOBS RUN" SAYS WHAT THE RUN DID: in_progress.kept writes how a scheduled run ended (jobend: ended /
  failed / cut, when, why — state.keep_run_end); a body that knows better says so (InProgress.verdict: an AI job's
  model could not run, made without the AI, sent nothing, not set up; a code job's script that stopped).
  status.jobs_run reads it (RUNNING while the run's row stands; the claim alone for an older row); the Overview draws
  an Outcome column ("done", "not prepared (why)", "stopped by a restart"). The scheduler's claim (job:) is unchanged.
  Tests: test_in_progress (each end, a chat's job leaves none), test_scheduler_runner_stop (a cut run reads "cut"),
  test_page_controls (the row through HTTP).
- ONE SENTENCE FOR "WHAT YOU ASKED FOR DID NOT COME": api_errors.NOT_COME(name, cause, asked, when) — asked in a chat
  ("Ask again in a moment."), on schedule ("It will run again at its next time." — only there: a report asked for in
  a chat read it too), cut by a restart (at its time), no result. for_job takes the origin; chat_jobs, in_progress
  (cut_text) and ai_jobs call it; "report" is the one noun a person reads (not_set, "There is no … report").
  Tests: test_api_errors, test_in_progress, test_chat_jobs, test_jobs.
- THE OVERVIEW'S FIGURES MEAN WHAT THEIR LABELS SAY: status.figures reads the records as the Costs tab does (who →
  reply or report, problem → failure): "replies written" counts chat runs without a problem, "reports made" (new)
  the job runs and the reports made without the AI, "failures" the failure kinds and every run with a problem. "Per
  run" and "Busiest day" come from status.costs (per_run, busiest); the page only draws them. Tests: test_script_run,
  test_run_records, test_ui.
- ONE TABLE OF CAUSES: api_errors.CAUSES {kind: (cause, what to do, what the owner does)}; FOR_PERSON, why_job and
  NEEDS_THE_OWNER are built from it (the person's sentences take one shape: "I cannot answer right now: cause. what
  to do"). The Costs tab's (!) gets the cause and what to do, never the first-person sentence (error_words gone).
  Test: test_api_errors.
- EVERY SENTENCE NAMING A PLACE GOES THROUGH places: places.tab("skills") for a whole tab; not_set points at
  Rules › AI brains and limits (it named "AI jobs", a card that no longer exists); the start_job refusal is one
  sentence, tool_access.start_job_off (app.py and tools.py each worded it). tests/test_places_named.py greps the
  tracked engine for "page →" / "page ›" outside places.py.
- "ALREADY BEING MADE" SAID ONCE, TRUTHFULLY: ChatJobs.start answers Started(kind new / just_started /
  running_since, since, by asked / scheduled); ai_jobs.being_made words it once for the AI's instruction and the
  report button's answer — "scheduled at 19/10/2026 08:00" when a run nobody asked for holds the chat (it read
  "asked for here started at 08:00"); the time by notice.when. JUST_STARTED_S lives in chat_jobs; started_at is gone.
  Tests: test_chat_jobs (a scheduled run says scheduled), test_jobs.
Architecture review round 3 (shared leads): one clock on an investigation and one number rule; the agreement's words
read from the file; one filler of "{time}", the waiting words in the one table, one siren title; one reading of
"devices offline now".
- ONE CLOCK ON AN INVESTIGATION (`vesta_shared.timeutil.clock(t, zone, days=, seconds=)`): the lines the AI reads
  (investigate.py `at`), the page's log (investigation_facts `_Clock`), its three charts (page.py) and the example
  SKILL.md gives the AI all word a moment the same way — "03:09", "9 Oct, 03:09" when the period spans several days.
  The lines the AI reads keep their seconds ("03:09:46", "9 Oct, 03:09:46": a 71-second drop needs them); they said
  "09/10 03:09:46" before, and SKILL.md asked for "09/10 07:30" into the same column as "9 Oct, 03:09". SKILL.md's
  rules and step numbers are unchanged (the page's "SKILL.md step 6" still names step 6). `month_label(d)` and
  `day_label(d, short=True)` replace the reports' two strftime calls; `timeutil.said(value, zone, weekday=, day=)` is
  the ONE reader of a stored ISO day or moment (playbook `_fill` and compose `day()` / `when()` each sniffed them by
  length); facts.json keeps ISO. Tests: test_investigate (one clock: the AI's row and the recorded row), test_one_day_format.
- ONE NUMBER RULE (`vesta_shared.page.number(v, unit=None, whole=)`): the reports' composer, the charts and the energy
  headline each had their own ("12.3" / "12" / "12"; a 0.15 tariff was "0.2"). Now: whole numbers and from 100 on with
  their thousands, one decimal from 10 on, two under 10, `whole` for a tile; the energy headline's dates through
  `day_label` ("5 Oct to 11 Oct", not 2026-10-05).
- THE AGENT READS THE AGREEMENT'S WORDS FROM THE FILE: kiosk.py's step kinds (`KINDS` = `ticketUpdate.kinds`), the
  agent's stamp (`AGENT_BY` = `ticket.agentStamp`), the take-on step (`taken_step`, `ticket.takenStep`: status, no
  kind, by anyone but the stamp) and the card's origin and check words (`problems.agreed`, `ticket.origins` /
  `ticket.checks`: a word the agreement does not declare is not written). They were typed in the engine and pinned to
  the file after the fact; now one assertion per table says the engine reads it (test_contract_ticket,
  test_fault_steps; the host's test_kiosk_contract stays THE pin that the copy is the Kiosk's). `OLD_TITLE_NOTE`
  ("Now: ") stays a literal: the agreement names no key for it, its twin is the Kiosk's faultNotes.ts.
- ONE FILLER OF "{time}" (`layout.fill_time(text, now, zone)`): posting, the thread's close and restate, and a
  taken-over message's status each replaced it by hand. The waiting words of a pending approval request live in the
  approvals' one table (`STATES["pending"]`, `note("pending", who=, minutes=)`), not in actions.py beside it. One
  siren title, `vesta_shared.messaging.SIREN_TITLE` ("Siren"): outcome's "the siren cannot be requested" reads it
  (it said "Siren request"); app.py's "Siren switched off" message already says the word (its literal is to be
  replaced by the constant).
- ONE READING OF "DEVICES OFFLINE NOW" (`vesta_shared.offline.devices_offline(pack, states, now, families,
  min_minutes=, alerted=, integration_min=)` → `Group`): the night check and recheck.py (`nightly.offline_findings`:
  its settings, its words, an integration down worded by `nightly.integration_name`), the reports' monitoring table
  (`facts.Ctx.offline`) and the concierge's status each walked the pack their own way. One grouping
  (`pack.device_key`), one name (the device's own, else its asset's, else its entity's), "a device the villa's system
  knows nothing about is not the villa's" applied once; the merge of an integration down moved from features.py to
  `offline.merged_integrations`. No threshold in vesta_shared: the minimum, the alerted devices and the integration
  count are each caller's. The three family lists stay in their skills (test_offline keeps them side by side; they
  differ today: the reports add battery and network, the night check water and generation — the owner's call).

## 0.6.256 (19 October 2026)

Architecture review, 19 October (the Telegram layer, measured with a probe on the real harness): one copy per chat
whatever wrote it, "To:" from the priority, one title word per incident, one writer of "what on when (who)".
- ONE COPY PER CHAT, WHATEVER WROTE IT: the villa's own message of a step, taken over in a chat (ha_messages: the
  number, the heading, the buttons), is the desk's copy there — the desk's message of the same step is no longer sent
  to that chat (outcome.carry_out, after adopt_ha: the (incident, chat, step) adoption showed; the chat still gets
  this result's snapshot, and counts as reached for `first_in_line`). A P1 rang the owner's group twice: the rule's
  message edited, then deleted for an identical one (measured: EDITS (GROUP, 500), SENT GROUP, DELETED (GROUP, 500)).
  Decided in Outcome, not routing: what adoption showed is known only once Telegram answered, and routing's roles
  (Notices.audiences) are what the taken-over copy says. Test: test_the_villas_message_taken_over_is_the_desks_copy_in_that_chat
  (two mutations red).
- "TO:" FOLLOWS THE PRIORITY, NEVER THE CHAT (owner, 2026-10-17): the alert desk carries whom a priority reaches on the
  incident (store.Notes.TO, desk.reaches / carry_to — at an opening, a reopening, a priority change and every tick,
  as it carries the check), in rules.yaml's own terms: the roles of people_roles, else what the priority does instead
  (priority_does: "digest", "log"). The engine reads it (Incidents.reaches → Notices.to_line): every copy's "To:" is
  the roles the priority reaches widened by every step's (an escalation names the owner); a priority nobody is sent
  reads "To: digest" / "To: log", and its steps "(to: digest)" — a P3's own message in the owner's group read
  "To: Owner" (measured). Its history line is recorded with the roles given and `reach` (never the chat's roles), so
  no later heading reads the chat out of it; Notices.went_to is the one order for a taken-over message's roles (the
  step's, the priority's, this result's, the incident's). An incident of an older desk (no Notes.TO) keeps the old
  reading until the next tick carries it. Test: test_to_follows_the_priority_a_p3_in_the_owners_group_is_never_to_owner
  (four mutations red: desk.reaches, Notices.to_line, Notices.record, Outcome.adopt_ha).
- ONE TITLE WORD PER INCIDENT, EACH CHAT ITS OWN STATUS LINES (#55 unchanged): IncidentThread.sync re-heads EVERY
  copy; a chat the step does not concern (`quiet`) keeps its own words and lines and takes only the heading through
  Notices.retitle — now "the title word and 'To:' as the incident stands now", both ways (closed ↔ existing; it was
  one-way, closed only). Measured: Done by the FM, the fault reopened in the Cockpit, the tick asked the FM again —
  the owner's group kept "#1-P2 (closed)" over "Done on … (Wayan)." while the FM's copy read "(existing)". Now both
  read "(existing)"; the group keeps "Done on … (Wayan)." as its own last line. Consequence pinned in two older tests:
  a reminder to the FM alone turns the group's "(new)" into "(existing)" (its own "⚠️ ⚙️ Still open"), an escalation
  widens the FM copy's "To:" — never their Status lines. Test: test_every_copy_carries_the_incidents_word_and_its_own_status_lines
  (three mutations red: sync's quiet branch, retitle's word, Outcome's quiet set).
- ONE WRITER OF "<what> on <when> (<who>)": message_format.acted writes PRESSED, the approvals' "Approved / Refused /
  Expired on …" (STATES, their tails kept) and the desk's "Noted on … (who): label". A mutation of acted goes red in
  test_ha_message_layout (the villa's template words), test_people_routing (the approvals' notes, pinned) and
  test_alert_desk.
Architecture review round 2, 19 October (seam leads: how a fault was closed, a refused fault, a reopened night
fault, "an automation ran").
- How a Kiosk fault was closed is read by the agreement's own rule (`ticketUpdate`: notStatusChanges, clearedNotes,
  clearedNotePrefixes — read from the host's agent-contract.json at run time through `vesta_shared.agreement`, never
  typed again): the last close is the last STATUS CHANGE in time order (a rename or a Telegram line noted after it
  carries "resolved" too; a step whose time cannot be read sorts first), and "cleared" is that step's kind, or its
  note for a close written before kinds. kiosk.fault_of read the last step in list order by its kind alone, so a blip
  the agent cleared and the facility manager renamed was written into its alert's history as "Closed in the Cockpit on
  … (Facility manager)". test_contract_ticket replays every history the agreement lists (6 of 16 read the other way).
- A fault the Kiosk refuses stops no other: `KioskError` carries the answer's status and the proxy's own sentence
  (`refused`: it answered; unreached: connection refused, a timeout), the repair logs the sentence and goes on to the
  next fault — only an unreached Kiosk ends the round — and the chat answer quotes it ("The Kiosk did not record the
  ticket: writing the Facility records answered 403: …", not "KioskError"). tests/kiosk_fake.py `refuses()`.
- A night fault a person reopened in the Cockpit is told by its own skill: the engine marks the reopening on the task
  (`reopen_told_at`, migrated: rows from before are told; `store.untold_reopenings`, `reopening_told`; the Kiosk's own
  time in `reopened_at`), and the preventive-maintenance recheck sends it to settings.yaml `reopened_in_kiosk.tell`
  under its `title` ("Fault reopened in the Cockpit"), the body kiosk_words.reopened as before. `Tickets.tell_fm`
  and the engine's "Fault reopened in the Kiosk" title are gone; an alert's reopening stays the desk's (marked told).
  An older recheck.py that does not send leaves the task marked: nothing lost, nothing sent twice.
- "An automation ran" is one reading, `vesta_shared.past.automation_run(row)` → (at, started_by, is_system): only a
  "triggered…" row is a run, `is_system` from the logbook's own shape (a reload of the rules, a start). The weekly
  page applies its `not_an_alert_when_started_by` list to `started_by`; the investigation keeps runs only and says a
  reload or a start as ONE line (settings.yaml `words.rules_reloaded` / `system_started`, carried to the page as
  `system_runs`) instead of a "ran … check whether it did" line per rule (23 for one reload at 16:59).

## 0.6.255 (19 October 2026)

Architecture review, 19 October (six leads: one owner of "what to do", a new number says the week, one opener, the
desk's durations, the Monday lines' figures, dead duplicates).
- "What to do" on site has ONE owner, the alert desk's route (rules.yaml `check`), and every reader gets its current
  words. Telegram read it live, the task froze it at its opening for the Kiosk fault's note, and the digest's "Still
  open" line read a key nobody wrote (an alert's line had no check, a finding's had one). The desk now carries it on
  the incident (store.Notes.CHECK: desk.carry_check at an opening, a repeat, a restate, a return and every tick), as it
  carries the claim; Problems.check_of reads the SOURCE (the carried check, a finding's detail.check the night
  rewrites) and the task's check_text only for a record from before; Problems.card carries it as `todo`; the repair
  amends the fault's note (kiosk.todo, in the one write) — only a note the agent wrote ("What to do: …", "Check: …"),
  a person's stays. No agreement change: a ticket's `note` is a field the agent may change. Tests:
  test_the_check_follows_the_rules_words_on_telegram_the_digest_and_the_kiosk (four mutations red),
  test_what_to_do_is_the_sources_words_now_…, test_a_faults_note_follows_what_to_do_unless_a_person_wrote_it.
- A NEW number of an alert seen this week says so: its "Alert sent" line counts the week ("…, 3rd time in 7 days")
  as a "Back at" line does — message_format.STEPS "new" carries {times}, notice.record writes its run; the count is
  problems.incident_runs, as before. It said New while the card and the digest said "(again: 3 times in 7 days)".
  Tests: test_a_new_number_within_the_week_counts_it_too, test_a_new_number_of_an_alert_seen_this_week_says_so_on_its_card
  (two mutations red).
- One opener for an alert's task: desk._ladder always goes through Problems.reopen_task (open / reopened / new); a
  priority raised after a lowering reopens the SAME task and Kiosk fault, saying rules.yaml `raised_words` ("Raised to
  P2."); Problems.settle reopens through the same method. Before, the raise went through open_task (open tasks only)
  and made a second task and a second fault for the same number. Tests:
  test_lowered_then_raised_is_one_task_reopened_saying_why, test_lowered_then_raised_reopens_the_one_fault_in_the_kiosk,
  test_settle_reopens_a_task_through_the_one_opener (three mutations red).
- alert-desk: its durations ("No answer after … ", "No answer from FM after …", the siren's window and sounding time,
  the villa-silent message) are worded by timeutil.lasting ("1 h 30 min"), as everywhere else. Test:
  test_the_desks_durations_are_worded_as_both_apps_word_one (two mutations red).
- reports: the owner's Monday lines read every number from the weekly page's own figures (facts.py s_kpis: alerts, p1
  — new —, alerts_open, open_tasks) and compute nothing; `compose.py owner-weekly` requires --facts (the job and
  SKILL.md already pass it); a figure an older facts.json lacks reads "n/a". The critical ones, the alerts still open
  and the problems open were still counted by the composer, by other rules than the page's. Tests:
  test_the_owners_weekly_line_says_the_pages_own_figures, test_an_alert_that_came_back_counts_each_run_in_the_week
  (two mutations red).
- Deleted, no caller: outcome_words.clean_summary (messaging.no_code is the one copy), Kiosk.ticket_states /
  update_ticket / note_ticket / tag_ticket (their tests call amend(retitled / tagged)), Tickets.resolve (a
  ticket.resolve action only runs the repair), tickets.kiosk_reopen_note (kiosk_words.reopened). The test that
  counted tag_ticket calls could never fail (the repair never called it): it now checks the record's revision.

## 0.6.254 (19 October 2026)

- alert-desk rules.yaml: `unrouted` carries the owner's decision and the two designs the owner rejected (a route per rule, a
  whole blueprint raised to P1), so neither is proposed again. No behaviour change. Agent CLAUDE.md: the checks are
  `tools/release.py gates`, which also records the starter skills (it said a whole-tree ruff must be clean: 57 errors).

## 0.6.253 (19 October 2026)

- alert-desk: a rule SAVED at a new priority while its alert is open (phase "restated") now changes what the alert
  does, as a repeat does: desk._reprioritised, shared by `_restated` and `restated`. It changed the number only, and
  the FM was still reminded until the rule alerted again (owner: "is it possible to lower a priority?"). Still nothing
  is sent on a restate. Test: test_a_rule_saved_at_a_lower_priority_stops_the_chase_without_alerting_again (red with
  the old restated).

## 0.6.252 (19 October 2026)

Architecture review, 19 October evening (owner: "proceed to all of the recommended ones"), cards 2 and 3.
- alert-desk: what a priority does is rules.yaml `priority_does` (chase / digest / log), read by `_ladder` and by
  `_restated` (desk.does). A priority LOWERED while its alert is chased now stops the chase: the incident goes to the
  digest (or the log), its task and Kiosk fault close (Problems.settle — wants_open is false for a LOGGED or DIGEST
  incident), and every copy of its card loses its buttons and says `lowered_words`. It changed the number only: the FM
  reminded, the owner told after 45 min, the fault left open, for a digest item. A route without the ladder records,
  as before. Tests: test_a_priority_lowered_while_its_alert_is_chased_stops_the_chase (three mutations red),
  test_what_a_priority_does_is_read_from_the_settings. Not changed: the night check's 02:00 message to the FM
  (findings, addressed by role in another skill — see the owner's note).
- knowledge_pack.subject(entity_id, whole_device): what a problem is about, key and name — a whole device's fault
  (result.WHOLE_DEVICE: offline, silent, keeps dropping) by its device, any other by its reading. The to-do list
  (playbook.one_list's device_of / name_of take it) and the daily digest (compose.fm_daily) ask it: two pumps' power
  findings on one relay were one line "House & Pool Relay" beside the cards "House Pump" and "Pool Pump". Test:
  test_a_problem_is_named_by_its_reading_unless_it_is_about_the_whole_device (two mutations red).

## 0.6.251 (19 October 2026)

- Test only (owner, 2026-10-19: "double check this"): a rule on "Follow Vesta Agent Setting" of a kind with no route —
  the villa's critical_battery and audit_config_integrity — runs through the agent end to end: its own message in the
  owner's group (its "To:" the villa-wide setting) is taken over by the card of the priority its name gives (P1 "To:
  Owner & FM", replaced with the owner's buttons; P2 "To: FM", rewritten in place), and the FM is told.
  test_alert_card_runs::test_a_follow_rule_of_a_kind_with_no_route_is_retitled_by_its_names_priority, both red when
  rules.yaml `unrouted` is changed.

## 0.6.250 (19 October 2026)

- alert-desk: a VESTA rule whose kind (blueprint) has no route and which names no priority takes rules.yaml
  `unrouted` by its name — its entity id without "automation." starting with `critical_` is P1, any other P2 (owner,
  2026-10-19). It fell to the defaults' P3 (the next morning's digest). The kinds with a route keep theirs; a rule's
  own priority still wins; the agent's own findings (PM-, critical_internet) are unchanged. A villa file without
  `unrouted` keeps the defaults', never a guess. Test: test_a_rule_of_a_kind_with_no_route_takes_its_names_priority
  (four mutations red).
- On the villa (not in this release): the VESTA blueprint critical_battery (low batteries, its rule
  critical_battery---low_battery created switched off), and audit_config_integrity with "VESTA priority", "Who the
  message is for" and a vesta_critical_event — both alerts reach the agent, which classifies them by this rule.

## 0.6.249 (19 October 2026)

The second week-42 report checked (owner, 2026-10-19), and the owner's two asks on the page.
- reports: a rule's run started by the villa's system starting is not an alert either — the logbook writes it in words
  ("triggered by Home Assistant starting"), not as an event: seven "alerts" at the 17 Oct 16:59 restart. reports.yaml
  not_an_alert_when_started_by now lists what the logbook gives as a run's `source`, exactly.
- energy_period: a finished period's figures are kept under calc_tag (this script, vesta_shared.daily and
  energy_setup, and the pack's build time): week 42 was kept under the period alone, and the report made after
  0.12.257 read the figures made before it ("Main Power Device" three times).
- report.html: "Alerts that fired" (weekly) and "What happened" (monthly: the same alerts) are folded by default,
  their count in the heading (owner).
- "Is the monitoring itself healthy" lists no villa device (owner: they are in "Do this week" and the "devices
  offline" figure): the agent listening (since when, when it started during the period), the safety rules, meters'
  counters stepping back, the AI's cost.
- tests/test_reports.py puts the report scripts on its own path: ten tests failed alone or in another order ("No
  module named 'playbook'"), so a mutation run on that file could not tell a caught mutant — every mutation of the
  day re-run on a clean baseline, each red by its own test.

## 0.6.248 (19 October 2026)

The week 42 FM weekly report, checked line by line against the villa (owner, 2026-10-19), and every report kept on one
calculation (owner: "apply to any other report ... consistency in calculations").
- reports: a VESTA rule's run started by the villa's system itself (reports.yaml not_an_alert_when_started_by:
  automation_reloaded, homeassistant_start(ed)) is not an alert. Week 42 counted 400 such re-checks — the rules were
  reloaded 57 times — as "403 critical alerts"; read in the logbook and five traces (each stopped in 2 ms). The weekly
  KPI, the alerts table and the monthly count share facts._read_ha_alerts.
- knowledge_pack.part_of: a device hanging under another ("via") is part of it only when it is the same product (both
  models given and equal); a Zigbee sensor under its bridge is its own device (five batteries read "Zigbee2MQTT
  Bridge"; the night grouped every Zigbee sensor as one). A registry without models is not judged.
- knowledge_pack.device_label: a device with no maker, no model and no name from the owner ("named", new in the pack;
  PACK_RULES 3 rebuilds it at start) is a client of the Wi-Fi, not the villa's: a guest's iPhone and a "wlan0" laptop
  were "monitoring devices offline".
- knowledge_pack.reading_name / reading_key: a READING is named by its own device (the relay's channel "House Pump",
  the meter's phase) — equipment cards, battery rows, energy trends, the energy table (energy_period: three rows
  "Main Power Device"), the playbook's clues. A whole device's fault keeps device_of. An equipment card is "Watch"
  by its own reading (items carry entity_ids): the house pump's finding no longer marks the pool pump's card.
- daily.running_series: a device without a steady hour has no running power (draw_w removed): the house pump's
  "power" swung 1,500–6,410 W with its start-up peaks and the AI read "watch for a leak" in it. Its card shows hours
  running per day; the power-step clue never sees it.
- nightly: a quiet reading of a device whose other readings report (_device_still_talks) is not silent: the system
  monitor's disk use held at 2.4 % for days while its processor use reported every minute.
- compose.owner_weekly: with the weekly page's facts (--facts, skill.yaml), the page's count of alerts — the owner's
  Monday line counted the agent's alerts only, the page beside it the villa's own as well.
- report.html: the footer said "read through Home Assistant"; test_no_platform_name now reads the report page and
  its scripts.
- Tests: each shown red by tools/mutate.py, the night's caller included (run for real).

## 0.6.247 (19 October 2026)

One "running" for every page (owner, 2026-10-19: "do both").
- vesta_shared.daily.power_daily_features: an hour runs when its MAXIMUM passes the threshold, for mean ÷ max of it
  (was: its mean). A pump in short bursts never has an hourly mean near its running power: the villa's pressure pump
  read 0 h in the night check on a day it used 3.0 kWh at about 3 kW; now 1.1 h. New `draw_w` (energy over run hours).
- daily.typical_peak: the threshold's reference is the hourly maximum at the middle of the ENERGY drawn (maxima
  weighted by their mean), not the median of every hour — for a pump off most of the day that was idle noise (the
  jacuzzi pump 1 W, the pool pump 2.4 W under its own 10 W idle peaks). Tried on the villa and dropped: from the
  highest peak down (a lone 546 W reading of a 34 W pump stayed the reference), and several hours behind the
  reference (four 4–7 kW start-ups of a 1 kW pump did).
- daily.running_series: one measure of power per series (running_power when every day it ran has a steady hour,
  else draw_w).
- reports: the weekly page asks daily (facts.Ctx.hour_rows / running_days; playbook._days_power) instead of its own
  "hourly mean above run_min_w" (it read the pressure pump at 18 h a day). reports.yaml: run_min_w removed,
  `behaviour: on_threshold_fraction` added (the facts script's Context now reads reports.yaml's behaviour).
- Measured on the villa (17–18 Oct; September replay): house pump 1.1 h/day (energy ÷ power ≈ 1 h), pool 6.5,
  jacuzzi 7.5, massage jet 3.1, onsen 13.9 — each within its kWh ÷ running power. Tests: test_device_day (bursts,
  the typical peak's three traps, one measure, the weekly caller), each shown red by tools/mutate.py.

## 0.6.246 (19 October 2026)

Architecture review scan 3 (2026-10-19).
- tools.without_hidden on EVERY read tool's answer (records, bare ids, a hidden entity's own record) — only
  ha_search was filtered; the overview and a state read showed a hidden device.
- actions.outcome: one "done / moving / failed" for the direct and the approved path (moving only for a device that
  said it is on its way, or a slow one: cover, valve); a direct action answers in done_words.
- tool_access.tool_state: the one state of a skill's tool (on/off/missing/never); needs() and unavailable() read it.
- reports: playbook raises vesta_shared.params.MissingParameter (one class; `said=` keeps the skill file's sentence).
  Not done: the weekly report's own "running" rule (run_min_w) — vesta_shared.daily's would read the villa's
  pressure pump (short bursts inside each hour) as never running: an owner decision.

## 0.6.245 (19 October 2026)

Architecture review scan 2 (2026-10-19).
- Store.move(iid, frm, to, **stamps): a state moves only from where it was read (BEGIN IMMEDIATE); the desk's
  reminder and escalation and Problems.taken_in_kiosk use it — a tick could overwrite a Cockpit "Open Ticket".
- desk.back_alert beside open_alert: an alert back after its close is found under its number or its rule's name, its
  rule's name brought up to date; intake no longer knows the by-name key.
- kiosk.Kiosk.amend(tid, *amends) with pure retitled / tagged / noted: a fault brought up to date in ONE write
  (tickets._converge); kiosk.fault_of: a fault's person acts read from its steps, pure.
- notice.Notices.audiences: who each of a result's notices is for, worked out before sending (Outcome).

## 0.6.244 (19 October 2026)

Architecture review scan 1 (2026-10-19).
- incident_thread.IncidentThread: one lock per incident in every public method (post, adopt, close, restate, sync,
  rewrite, catch_up) — two posts of one incident at once left one Telegram copy with nothing pointing at it (#55
  twice in the owner's group). `stray(iid, chat, mid)`: a pressed copy that is not the one on record goes.
- alert_buttons: after a press, the pressed message is removed when it is not the incident's copy on record.
- Problems.record_night(handed_over=): a finding left out because an open alert follows the device closes "Followed
  by alert #N", never "Cleared"; nightly.alerted_offline gives each device's alert number.
- incident_runs counts the runs filed under the rule's name as well as its permanent number.
- KnowledgePack.device_key: the one device key (physical device, else platform:asset); the night's checks call it;
  investigate's "same physical device" includes the parts listed under it (pack, `via`).
- incidents.Incidents: the one reader of the alert desk's incidents for the engine (buttons, notices, unreached);
  app.py's three store helpers and Outcome's reach into the tickets' private store are gone.

## 0.6.243 (19 October 2026)

Architecture review "One answer per question" (2026-10-19), cards 2 and 4, and the owner's wording of 2026-10-19.
- notice.Notices.heading(before=): the ONE heading of a chat's copy — the first copy, the villa's own alert taken
  over, a replaced status and every other chat's refresh. `rehead` (the sent copy's heading re-parsed, its lines
  swapped) is gone; Outcome keeps each posting's stage and "To:" roles and heads the other chats with them.
- routing.Routing.deliveries (was Outcome._deliveries): which chats a step goes to, and for which roles.
  message_format.ROLES is the one list of roles (routing's targets, the shared-chat role merge, the siren's
  fallback order, the jobs' targets).
- message_format.acted / PRESSED: "<what> on <when> (<who>)" for every person's act — a press, an approval or a
  refusal, a close / reopen / ticket in the Cockpit; Done says "VESTA will monitor it for <clear_minutes>"
  (timeutil.lasting). vesta_message.jinja's word table regenerated.
- preventive-maintenance nightly: a hidden entity's drops are no reconnect fault (pack.hidden), as every other check.

## 0.6.242 (18 October 2026)

Owner, 2026-10-18 (#55): each chat its own steps — reversing part of 2026-10-11 "one incident, one picture".
Notices.history_lines(incident, chat) lists the steps sent to the chat's roles (and lines to nobody in particular);
Outcome no longer syncs a copy in a chat none of whose roles the step went to (Notices.concerns), and a synced copy's
heading is rebuilt for its own chat (Notices.rehead, incident_thread.sync head_for). No People list: every step, as
before.

## 0.6.241 (18 October 2026)

Architecture review "One problem, one card" #1 (owner, 2026-10-18): an alert's identity is its rule's permanent
number (`rule_uid`, the automation's `id` attribute, sent by every critical_* blueprint beside `rule_id`) and its
entity — desk.alert_keys / open_alert, one place instead of four inline keys; an incident filed under the rule's
name is moved under its number when the rule first sends one; its rule_id follows a rename. rule_gone looks a rule
with a number up by it (_automations_by_uid): renamed is not gone; unreadable closes nothing.

## 0.6.240 (18 October 2026)

Owner, 2026-10-18 (#56, the silent Shelly Pro 3EM listed as 4 devices: "shelly integration (3 devices) offline" on a
second card): the knowledge pack keeps each device's "via" (via_device_id); KnowledgePack.unit_of /
physical_device_of — the physical device an entity is on — is what offline, silent, reconnect, critical, device_of
(report names) and entities_of_device (an action's reach, restarted) group by. Universal, from the registry: no make
named.

## 0.6.239 (18 October 2026)

Owner, 2026-10-18 (#41 and #55, one laundry door: the rule's entity ID changed while #41 was open, and the Cockpit's
Close closes a device's faults together): alert-desk desk.rule_gone — an open incident whose rule_id (an automation)
the villa's system answers "not found" for (client.not_found, never a failed read), on two ticks clear_minutes apart, is
closed with its fault, saying why. Rules page reminder reworded in the owner's terms (critical automations, entity ID,
title).

## 0.6.238 (18 October 2026)

Owner, 2026-10-18 (#41: "Alert sent … to Owner & FM" beside "Back at …, 2nd time in 7 days (to: Owner & FM)"): every
step of an alert card ends "(to: …)" — message_format.Step.line "{sent} {at} (to: {who})"; a timed step's bottom line
puts the skill's words before whom ("Escalation sent … — No answer from FM after 45 min (to: Owner)"); the Kiosk card's
notes "Reminder sent (to: Facility Manager)".

## 0.6.237 (18 October 2026)

Owner, 2026-10-18 ("never create helpers via the UI; always a file in the packages folder"): the shipped package
homeassistant/packages/vesta_message.yaml defines input_text.vesta_alert_audience, the villa-wide "To:" the message
layout reads — it was a helper made from the screens.

## 0.6.236 (18 October 2026)

Owner, 2026-10-18 ("confirm there is no more reference to villa mode"): the alert desk's reader and its event field are
`occupancy` (empty / occupied / unknown, from the villa's "Villa empty" helper), no longer named after the mode no villa
had; `intake(occupancy_reader=…)`. Behaviour unchanged.

## 0.6.235 (18 October 2026)

Owner, 2026-10-18: the siren gate read input_select.villa_mode, a mode the villa never had — every intrusion read
"unknown", the siren could never be offered. It reads the villa's one "empty" helper now (alert-desk rules.yaml
`siren.villa_empty`, binary_sensor.villa_empty: on = empty; missing or unreadable = never empty), the one its presence
rules read. The report's "electricity used while the villa is empty" reads it too (`mode_entity`, empty ["on"]).

## 0.6.234 (18 October 2026)

Architecture review 2026-10-18, offline devices card 2 (owner: "the list in the villa's critical devices offline"):
- ONE list of critical devices: vesta_shared.critical reads every automation built from the `critical_watchdog`
  blueprint, input `critical_entities` (the agreement's `criticalDevices`, shared with the Kiosk); the nightly pack
  keeps it (`KnowledgePack.critical`, `is_critical` by entity or device; a failed read keeps the last list).
  `asset.critical` follows it; the knowledge pack's lock/motor/schedule rule and reports.yaml `critical_families`
  are gone; an integration down is critical only when one of its devices is. The energy rule keeps motors by kind.
- The AI's own search never offers an entity hidden in the villa's system (`tools.without_hidden`; the pack names
  them): the Rules page already said so. PACK_RULES 2: a pack built before is rebuilt at start.

## 0.6.233 (18 October 2026)

- Architecture review 2026-10-18, offline devices card 3: no PM-UNAVAILABLE finding (night or recheck.py) for a device
  an open alert already follows for being offline (`nightly.alerted_offline`: bad states holding "unavailable").
- Starter policy: media_player.turn_on/turn_off `direct` (owner: "a default service that shall be available as
  baseline").

## 0.6.232 (18 October 2026)

Architecture review 2026-10-18 (offline devices, card 1 — owner: "implement the recommended finding"):
- recheck.py, every 5 minutes, opens the fault of a device gone offline (`unavailable_minutes`) with no open finding,
  through the night's own reading (`nightly.offline_findings`); a critical one sends the FM the night's P2 message.
  Timmerflotte_5969 had waited from 21:46 to the 02:00 night check.
- `Problems.record`: the night's ledger without its closing; `record_night` = record + close what the night missed.
- Scripts get `VESTA_PACK` (as `VESTA_STORE`); `--pack` defaults to it.

The villa's #54 (alert-desk): an alert back again kept the "clear since" of the run before, so the desk closed it 2 s
after the device answered (main power, back 11:30:15, closed 11:30:17) — `reopen` drops it: each run waits its own
`clear_minutes`.

Owner, 2026-10-18 ("turn off the TV"): a request the villa's rules refuse is a line in the log ("Refused
media_player.turn_off on …, asked by …: …"); it was only in the agent's own records, so the TV's refusal looked like a
request never made.

## 0.6.231 (18 October 2026)

Owner, 2026-10-18 ("turn off the TV" turned off its screen switch only): ha_call_service's description says to act
on the named device through its own entity, never a part or feature of it in its place, and to say a refusal plainly
instead of asking for something else. The starter policy allows media_player.turn_on/turn_off for any approver.

## 0.6.230 (18 October 2026)

Architecture review 2026-10-18 (an alert that goes and comes back; the villa's #52), owner's wording for #52:
- A task keeps its reopening's words (`reopen_note`, beside `close_note`); Problems.card returns them and the repair
  writes them on the fault. The desk's "Still there after the close." reached nothing before: the Kiosk wrote its own
  "Back again" for both.
- incident_runs(inc, store) counts the AGAIN_DAYS of every incident of the alert's key (Store.incidents_of_key), not
  one incident's runs.
- Kiosk.held_tickets says `cleared` (the last close was the agent's own); tickets._take_in never reads it as a
  person's close. The time comparison is the fallback for a record without the step.
- "back": "Back at {at}{times} (to: {who})", times ", 3rd time in 7 days".

## 0.6.229 (17 October 2026)

Owner, #51/#52 (the "— Came back … —" divider looked unlike every other step, and said "came back" twice):
- message_format.Step gains `line` (default "{sent} {at} to {who}"); "back" is "Back at {at}{times}, alert sent to
  {who}", its Kiosk note "Back: alert sent to …". Notices.step takes the run count; Notices.divider is gone.

## 0.6.228 (17 October 2026)

Owner, #48–#50 (six "#49 · One mains phase lost" lines in the Cockpit):
- tickets.repair runs one at a time (asyncio.Lock): seven results in one second ran seven repairs, each found the same
  open tasks with no fault and made one.
- tickets._close_doubles: an open agent fault ("va-…", kiosk.MINE) no task holds, for an alert whose task holds
  another fault, is closed as the agent's own clearing — never deleted. 1 test, 3 mutations RED.

## 0.6.227 (17 October 2026)

- The Agent page's words never name the platform: 8 strings in core.js, rules.js, skills.js and 4 served from
  Python (places "ha_tools" → "Villa system tools", tool_access ha_get_logs line, ui/server sign-in refusal and
  refresh error). test_no_platform_name now reads every static .js/.html without its comments (a small JS reader
  keeps strings and template literals whole) plus places.py, tool_access.py, ui/server.py. 2 mutations RED.

## 0.6.226 (17 October 2026)

- Rules page: a muted reminder under "Acting on the villa" to install the Agent before new alert-rule templates
  (owner, after the 14:41 alert storm). test_ui pins its words, place and style, and holds it to the platform-name
  rule (the page's JS is not in test_no_platform_name's files: 13 platform names remain on the page — reported).

## 0.6.225 (17 October 2026)

- alert-desk: a phase it does not know (PHASES: opened, resolved, abandoned, restated) is audited "phase_unknown" and
  nothing else — a newer blueprint can never raise alerts on an older desk (14:41: "restated" on 0.12.231 opened
  #46-#50 and reopened #41, #45). No phase is still "opened". 1 test, 2 mutations RED.

## 0.6.224 (17 October 2026)

Owner, #45: an open alert kept the claim it was raised with after its rule's threshold changed (4000 → 6200 W).
- alert-desk: phase "restated" (the critical_condition blueprint sends it on automation_reloaded and at start): the
  rule's open incident takes its new claim / bad_states / mode / entities and priority; nothing is sent; seen_again
  closes it once the new claim is false. 1 test, 2 mutations RED.

## 0.6.223 (17 October 2026)

Owner, 2026-10-17: "a label shall never be hardcoded to a value that can be changed as parameter of the alert"; "To:"
follows the priority (owner told it reverses 2026-10-16's #43).
- outcome: a card's roles are the desk's (priority + later steps); adopt_ha no longer unions the rule chat's roles, and a
  copy for no role (an answer in its own chat) records the incident's roles. A taken-over villa message is remembered as
  the agent's (state.remember_message): a press on it was ignored. Notices.roles_of.
- alert-desk: role words from CHASE + ROLE_SHORT (role_said), assignee from CHASE, "in {AGAIN_DAYS} days"; engine's
  Kiosk reopen no longer sets assignee="fm" (the desk sets chase.asks when it reads the mail). SKILL.md files name
  settings, not numbers. preventive-maintenance: "its {baseline_days}-day normal" / "its normal before this was found".
- actions/policy approval words from ROLE_WORDS. test_jobs waits for the chat jobs (idle), never 0.1 s.
- 4 tests, 9 mutations RED.

Owner, #45 (mains overload, 17 October): two steps on the card were mislabelled.
- alert-desk intake: a repeat of an open incident (the rule alerted again) is stage "still", not "reminder".
- alert-desk abandoned (still_true): stage "still" sent where an escalation goes (tell(..., escalate=True)), not a
  second "escalated"; its words drop "at {time}" (the timed step line says it). 2 tests, 3 mutations RED.

## 0.6.222 (17 October 2026)

Architecture review round two, 2026-10-17 (owner: "proceed fully"):
- vesta_agent/turn_reply.py: TurnReply.compose decides a chat turn's reply (7 rules, in order); app._converse
  sends it. tests/test_turn_reply.py: a table per rule, without an agent (14 mutations RED).
- vesta_shared/store: Notes, notes_of, Store.note / take_note change an incident's notes in place under BEGIN
  IMMEDIATE. The alert desk, problems, facts and investigate no longer rewrite the whole payload. Fixes a lost
  "kiosk_reopened" when the Kiosk reopened a fault while quiet_after_done read the villa (race test, RED on the old
  write). The stored format is unchanged; a broken payload reads as {}.
- vesta_shared/read_guard.py: one guard (READ_ACTIONS, argument values and forbidden arguments, the 6-hour villa-wide
  logbook) for tools._proxy and McpClient.tool; its refusal names no skill script. tests/test_read_guard.py runs one
  table through both doors (11 mutations RED).
- tools/release.py ship records shipped starter skills (record_shipped) when a skill ships.

## 0.6.221 (17 October 2026)

Architecture review, 2026-10-17 (owner: "do all of them"), the alert card:
- message_format.STEPS: one table of an alert's steps (history words, title word, timed, noted); result.STAGES is its
  keys + "pressed". notice.STAGES / HEAD_WORDS / TIMED_STAGES / NOTED_STAGES are gone.
- layout.head(title, to, history, word): a heading is facts; Notices.heading returns it, retitle sets its word. A
  text heading (stored by 0.12.229 or earlier, "For: …") is read once by layout.head_of; INCIDENT_TITLE now reads only
  old records and the AI's text.
- message_format.jinja_words writes the words block of homeassistant/custom_templates/vesta_message.jinja (python -m
  vesta_shared.message_format). The template says roles as an alert card does ("Owner & FM"), each read from any of its
  words separated by "," (the villa's helper reads "Owner, Facility Manager"). Template tests run in an immutable
  sandbox. 4 new tests, 9 mutations RED.

## 0.6.220 (16 October 2026)

Architecture review round 2, "how much electricity the villa used" (owner asked; done while offline):
- vesta_shared/energy_setup.py: the Kiosk's energyModel rule in Python (nesting from included_in_stat; used = grid in
  + solar − grid out; untracked = used − top-level devices; overlap). roi-energy's energy_period and the reports'
  days/trend/use-while-empty read the villa's own Energy settings (Ctx.daily_total); the name guess + main-meter
  helper is only the fallback (basis: names). Cache key energy:v2.
- ha_client READ_ACTIONS is {tool: (argument, read values)}: ha_manage_energy_prefs is a read only with mode "get";
  set/add/remove stay refused, even for the executor's writing client. HABase/McpClient.energy_prefs().
- Fallback wording no longer names a helper id. tests/test_energy_setup.py (7), 8 mutations RED.

## 0.6.219 (16 October 2026)

Architecture review round 2 (owner asked; done while offline):
- One duration rule with the Kiosk: timeutil.lasting follows chartUtils.fmtDuration (seconds under a minute, never
  under "1 s"; minutes rounded, half up; from a day on days + whole hours), held to the agreement file's 28
  duration.cases (tests/test_duration_words.py). The reports skill's "Lasted" column uses lasting instead of its own
  rule. agent-contract.json copied from the Kiosk's 2.496.397.
- A read of the villa's past says how far it got: HABase.history_read/logbook_read return rows with their reach and
  clamp the end to now; vesta_shared/past.py (History.state_at/periods never past the reach, Logbook, until, unread —
  one sentence "{what} could not be read whole: nothing is known after {when}"). investigate, investigation_facts,
  nightly (+features.ended_runs), facts, playbook and device_state.out_for use it. history()/logbook() still return
  plain lists and still set *_cut, for skill copies edited on the villa. tests/test_past.py (11 tests).
- Starter fingerprints recorded for investigate, preventive-maintenance, reports.

## 0.6.218 (16 October 2026)

Architecture review round 2, "a job cut short by a restart" (owner asked; done while offline):
- vesta_agent/in_progress.py: one record of work in progress (Item: kind, name, chat, start, the message standing in
  for its result, the question, whether its result arrived). begin/promised/kept/held/arrived/left; kept() is the one
  cut/finally (was copied in scheduler.py and twice in chat_jobs.py); arrived() is the one "its result came" (replaces
  the RUNNING_JOB contextvar and ChatJobs.result's own clearing); left() reads what the last stop cut once, and ON_START
  decides per kind (scheduled: run again in its window; a chat's job or question: tell the chat; arrived: nothing).
- Every text a chat is told is unchanged. Rows keep their keys and shapes; an arrived result now deletes its row instead
  of appending "|delivered", and a "|delivered" row from an older engine still reads as arrived.
- tests/test_in_progress.py (9 tests), 10 mutations RED. Left as it was, for the owner: a reply that lands after its
  chat job's result already arrived can still re-arm that job's row.

## 0.6.217 (16 October 2026)

Alert cards (owner, 2026-10-16, alert #43: a mains-phase alert cleared at 15:40, back at 18:03, reopened under its number):
- message_format.ROLE_SHORT / audience(short=True): an alert card's "To:", every "Status:" line and its bottom line say
  "FM" (notice.Notices.heading/step). Reports, the People page, the Kiosk card's story and the villa's own messages keep
  ROLE_WORDS ("Facility Manager"). The desk's statuses: "No answer from FM after N min", "Not delivered to FM: …", a
  press without a name "by FM".
- notice.Notices.bottom (TIMED_STAGES: reminder, escalated, back, still, reopened): a step's bottom line is its own
  history line first — "Reminder sent 16/10/2026 18:20 to FM — No answer after 15 min" — so a quiet edit of another
  chat's copy never reads as of that message's time. Its roles are the step's own (outcome `told`, per incident and
  stage), never every role of the result (a Need help's answer to the presser). The desk's reminder status is now "No
  answer after N min" (the step says "Reminder").
- desk.py: the rule's all-clear taken over is a "closed" step (resolved, resolved late, cleared as the rule stopped
  watching): ONE "Closing note sent … to Owner & FM" line, never "Update sent … to Owner" beside it.
- notice.Notices.divider: a "back" step's run starts under "— Came back 16/10/2026 18:03 (2nd time in 7 days) —"; the
  count is problems.incident_runs at the time it was recorded (app._runs → history "run"); an older record has none.
- outcome.adopt_ha: the rule's own chat's roles count in "To:" and the step's roles from the first message taken over,
  and in the result's later messages (`going`).
- Not changed: the alert's quoted text ("… 4580 W / Above 4000 W, Held 15 min") is the villa rule's own message, copied
  as written — its wording is the blueprint's. Every P2 step keeps Done / Need help in the owner's group (owner's choice).
- tests/test_alert_card_runs.py drives the #43 run end to end (9 mutations red); tests pinning the old words updated.
  Starter skills recorded.

## 0.6.216 (16 October 2026)

Retro 2026-10-15:
- script_run.run logs "Skill <s>: <script> <command> started" for the AI's scripts (the end was all that was logged);
  tools._proxy logs "AI: <tool> <args in short> took <s> s" for each of the AI's own Home Assistant reads (runner.step).
  test_ha_reads pins both (two mutations red).
- agent-host/tools/release.py check-push (the repository's pre-push hook calls it for agent-dev): a push changing
  agent-host/ or vesta-agent/ without a newer vesta-agent/config.yaml version is refused. test_release pins it.
- agent-host/tools/mutate.py: a RED names the failing tests; a pytest run ending 2–5 (interrupted, crashed, usage, none
  collected) is CHECK BROKEN (exit 3), never a RED. test_mutate pins both.
- ARCHITECTURE.md: rewriting a skill's instructions — every old rule found in the new text.

## 0.6.215 (15 October 2026)

- investigate.py timeline / around: `end = min(end, ctx.now)` — a day given as --end is the whole day, but never past
  now (villa, 2026-10-15: the 23:05 investigation's last period ran to 24:00, "6 d 7 h" for 6 d 6 h). A period that has
  not begun is refused as before. test_investigate (mutation red). Starter skills recorded.

## 0.6.214 (15 October 2026)

- UI Costs: an interrupted run's marker is core.alertButton (the failed run's (!)), its words in the tooltip (owner,
  2026-10-15), no longer a written chip. test_run_records pins it.

## 0.6.213 (15 October 2026)

- McpClient.logbook reads the whole villa's logbook by slices of LOGBOOK_SLICE (6 h), each its own hours back from its
  own end (_logbook_slice: the paging, the repeat stop and the cap as before), rows kept once; one entity's logbook stays
  one read (Home Assistant filters it). The villa, 2026-10-15: investigate's `around` over a week ran minutes — ha-mcp
  fetches the whole period at every page (about 30 pages for a week). The cause had been mistaken in 0.6.211 for the
  AI's own logbook calls (that cap stays). Also the nightly check's 3-day reconnect read. Tests in test_ha_reads:
  slices asked, every row read once, each call fetching its own hours only, a read cut short says where (mutation red).

## 0.6.212 (15 October 2026)

- agent_records.RUN_CUT ("run_cut", in COSTS_KINDS): runner records a run cut by a stop under it, not RUN — a Costs row
  (status.costs `interrupted`), counted in tool_usage, never in "replies written". script_run: an exit of -15 (SIGTERM:
  the agent stopping) is "script_stopped", not "script_failed" (Overview → failures; owner, 2026-10-15). Test in
  test_run_records (three mutations red).

## 0.6.211 (15 October 2026)

Villa, 2026-10-15 — an /investigate read 8–15 October's villa-wide logbook every 15 s for 14 minutes:
- tools.logbook_too_wide (LOGBOOK_VILLA_HOURS = 6): the AI's ha_get_logs on the logbook without an entity_id over more
  than 6 hours (hours_back) is refused, saying how to read it instead; with an entity_id, or the system log, as before.
- investigate.py find: one ha_get_device per device and one ha_search per unique-id prefix (`asked`), not per entity
  (50 s for two sensors' twenty entities). SKILL.md: a device silent for days — its timeline shows when it stopped;
  the raw logbook for the hours around a moment (6 h villa-wide), `around` for a period. Starter skills recorded.
- runner.run: a run cancelled by a stop is recorded (interrupted, its tokens so far from each AssistantMessage's
  usage — Collector.partial_tokens —, its steps, no cost); status.costs carries `interrupted`; the Costs tab shows
  "stopped by a restart" and "not reported" for its cost. Tests: test_ha_reads (the cap through the proxy; find asks
  once), test_run_records (a cut run on the tab). Four mutations red.

## 0.6.210 (15 October 2026)

- chat_jobs.ChatJobs.answering (owner, 2026-10-15: an /investigate cut by the update "went quiet"): a question being
  answered is kept like a chat job (state chatjob:<chat>:answer, what was asked) for the length of app.converse; a stop
  (CancelledError, or no clean end) leaves it, and recover() tells the chat at the next start, once. A question answered
  leaves nothing. Tests in test_recorded_is_shown (three mutations red).

## 0.6.209 (15 October 2026)

- investigate SKILL.md, after a reading of 0.6.208 as the AI reads it: the `summary` note restored (the message shows it
  under the line of recorded times: explain, never repeat — the rewrite had lost it); the example summary carries no
  clock time (it repeated "02:14 to 06:40"); "your last timeline/around runs cover the whole period" moved from the
  account's fields (step 8) to making the page (step 9), where it is a precondition. test_investigate: the example
  summary holds no time (mutation red). Starter skills recorded.

## 0.6.208 (15 October 2026)

- investigate SKILL.md rewritten (owner: "you can edit and optimise this skill"), same ten steps (page.py and skill.yaml
  still point at step 6): a cause's `source` is "[n]" or "the records" in the one place it is defined — the account's
  format said "the web page's name", which page.py refuses (CITE / RECORDS); each rule said once (the page writes the
  recorded facts: said once, before step 8); instructions stated as what to do, not as capitals and prohibitions; the
  owner's dated notes left to the changelog; one invented example of a summary and a cause; the description says when it
  is used. One file still: read_skill reads SKILL.md only, so nothing moved to a reference file. test_investigate runs
  the example cause through page.py's rules (two mutations red). Starter skills recorded.

## 0.6.207 (15 October 2026)

Architecture review 2026-10-15 (the problem lifecycle), 3:
- agent-contract.json (the Kiosk's 2.496.382, copied): ticket fields `titlePattern` and `since`; the Kiosk lists the
  fields it reads in /agent/v1/info `ticket_fields` (Kiosk.takes). preventive-maintenance rules.since_of: PM-UNAVAILABLE
  and PM-SILENT keep {since, since_words} (nightly passes now). Problems.card adds pattern (its title with "{since}" for
  since_words) and since. Tickets._pattern: written on create and by the repair (tag_ticket) only to a Kiosk that takes
  titlePattern, never on a person's title (held `person_titled`), and taken away when a person retitles (tag_ticket
  drops a None). FakeKiosk's info lists ticket_fields from the agreement. Tests: test_fault_steps (rules → repair →
  card; person's title; an older Kiosk) and test_maintenance_noise (the night keeps since); four mutations red.
  Starter skills recorded.

## 0.6.206 (15 October 2026)

Architecture review 2026-10-15 (the problem lifecycle), 4 and 6:
- preventive-maintenance recheck.py reads the rules it reads again from its own skill.yaml `rechecks` (rechecked());
  OFFLINE_RULE, the second copy, is gone. Starter skills recorded.
- tests/villa_timeline.py: TimelineVilla (an HABase built from each entity's timeline: states, history with the
  carried-over first row, not_found) and history_rows, the one rule. test_alert_desk, test_closed_not_over,
  test_fault_steps and test_comes_back use it; FixtureClient.history goes through history_rows. (test_investigate's
  _Client and ha_fake.FakeHA are tool-level adapters and stay.)

## 0.6.205 (15 October 2026)

Architecture review 2026-10-15 (the problem lifecycle), 1 and 2:
- Problems.wants_open / settle / settle_all: ONE decision whether a source's task is open (finding at a task severity
  or incident not ended, unless a person closed it since its latest return; a person-reopened task closes only on a
  person's Done; a task with no source waits for a person). close_finding, close_incident, record_night (new, again
  AND still open) and the repair all go through it. Gone: clear_source, close_outlived, restore_unseen, the night's
  backfill and its "ever had a task" rule, record_night's task_severities parameter. unseen() is wants_open with no
  open task. The re-run gap (recheck clears, the same night runs again: raise_finding reopens the day's row in place,
  its task stayed cleared) is closed by construction; test_problem_close pins it (red on 0.6.204).
- outcome.carry_out: ticket / ticket.resolve / ticket.reopen about a task, or FAULTS_CHANGED, run tickets.repair at
  once — one mover of Kiosk faults; only a fault with no task (a chat's) is created directly. run_code_job's own repair
  after FAULTS_CHANGED removed. repair returns {created, reopened, resolved}; a created or reopened fault is titled by
  current_title (Problems.card's). Tests: test_comes_back's lost resolve made real (close_incident), test_outcome,
  test_maintenance_noise (the engine reads FAULTS_CHANGED in carry_out); villa tests use kiosk_fake. Five mutations
  red.

## 0.6.204 (15 October 2026)

- agent-contract.json (the Kiosk's 2.496.380, copied): `ticket.checks` ["minutes", "nightly"] and the fault's `check`.
  Problems.card gives it: an incident "minutes" (the alert desk's every look), a finding of a rule the skills list in
  `rechecks` "minutes", any other finding "nightly", a chat's none. Skill.rechecks (skill.yaml, beside every_5_min);
  preventive-maintenance says `rechecks: [PM-UNAVAILABLE]` (test: the very rule recheck.py reads again). Kiosk.add_ticket
  writes it, tag_ticket and the repair give it to faults made before. Tests in test_fault_steps (five mutations red).
  Starter skills recorded.

## 0.6.203 (15 October 2026)

- device_state.out_for (owner's go, 2026-10-15): "out of the bad states for N minutes" for every entity — by its
  state's age when old enough, else by its history over the N minutes (which must open with the carried-over state;
  without it, not yet; one second of grace on its stamp). recheck.py (back online) and desk.py seen_again (the clear
  after an abandoned rule) call it instead of out_of over the state's age: a humidity sensor reporting every 4 min 53 s
  was never "10 minutes unchanged", its fault stayed until 02:00. Tests' FixtureClient.history and test_alert_desk's
  Villa answer as Home Assistant does (the state carried over, stamped at the start). Tests in test_back_online and
  test_alert_desk (five mutations red). Starter skills recorded.

## 0.6.202 (15 October 2026)

- Problems.restore_unseen, called by tickets.repair after close_outlived: every unseen() problem (open, a task
  severity, no open task, no person's close since its return) gets its last task reopened (or a new one); a task whose
  Kiosk fault is no longer held loses its id so the repair makes a new fault. The warning (0.6.186) was all there was:
  Timmerflotte_2623's task had been closed by the agent while the sensor stayed dead (cause not readable from here).
  Test in test_fault_steps through repair and the real Kiosk over FakeKiosk (three mutations red).
- alert-desk desk.abandoned: "Still not fixed at {time} (will close itself once fixed or press Done)" (the owner's
  words). Starter skills recorded.

## 0.6.201 (15 October 2026)

- alert-desk desk.abandoned (owner's request, 2026-10-15): the still-true status is "Still not fixed at {time}. It
  closes by itself once fixed, or press Done." test_one_saying pins it (mutation red). Starter skills recorded.

## 0.6.200 (15 October 2026)

- timeutil.lasting: from a day on, "1 d 9 h" / "3 d" (the Kiosk's chartUtils.fmtDuration). preventive-maintenance
  rules.py (owner's request, 2026-10-15): PM-UNAVAILABLE "offline for {lasting}" (was "33 h") and PM-SILENT "has not
  reported for {lasting}" (was "1.4 days"). Starter skills recorded (shipped-skills.json). Test in
  test_maintenance_noise through the rules (three mutations red).

## 0.6.199 (15 October 2026)

- knowledge_pack.PACK_RULES (1 = hidden entities left out) is written into the pack as `rules`; app.pack_needs_build
  rebuilds at start a pack written by older rules. 0.6.197's rule otherwise waited for the 01:30 rebuild: the owner
  updated and the villa status still said "unlocked" of the hidden locks. Raise PACK_RULES with every rule that
  changes what the pack holds. test_reports pins a devices-but-older-rules pack (each half proven red).

## 0.6.198 (15 October 2026)

- UI, Rules › Protected devices: a line in the card (owner, 2026-10-15) saying that a device hidden in the villa's
  system is ignored by the agent (0.6.197's knowledge_pack rule), in the page rather than behind the (i).

## 0.6.197 (15 October 2026)

- knowledge_pack.build_pack leaves out an entity HIDDEN in Home Assistant (registry hidden_by set, by anyone), as it
  already left out a disabled one, and as the Kiosk does (registryResolve). The owner corrected two reversed locks at
  the source (template locks reading the real ones inverted, the real ones hidden): the villa status still said
  "unlocked" of the hidden originals. A hidden entity's device stays in entity_devices, so an alert that names it
  still names its device. McpClient.registry passes hidden_by. tests/test_hidden_entities.py, driven from ha-mcp's
  answer through the client and the pack to concierge.status (each half proven red with tools/mutate.py).

## 0.6.196 (15 October 2026)

Retro, 2026-10-15:
- release.py gates: ruff F on vesta_agent, vesta_shared and starter; F821/F822/F823 on tests; pytest -n auto
  (pytest-xdist: 60 s instead of 130); tools/mutate.py and its test (agent-host/tests/test_mutate.py). The 25 ruff
  findings in the agent's own code fixed (unused imports, an unused `as e`, an f-string without a placeholder);
  test_ticket_offer imports the offer buttons from fault_offers.
- tests: helpers.alert_desk(); the hand-written alert-desk messages in test_outcome and test_telegram_events are now
  desk.tell's (a P1's reminder reaches every chat of both roles: 6 messages, each with the buttons while it is open).
  desk.tell's docstring corrected: the engine puts the buttons under every copy of an open alert (owner, 2026-10-10);
  first_in_line is who is chased.

## 0.6.195 (15 October 2026)

Architecture review, 2026-10-15 (counts and alerts):
- #3: the investigation's page is the investigate skill's: scripts/page.py (was reports compose.py investigation),
  scripts/investigation_facts.py and templates/investigation.html moved there; SKILL.md step 9 runs `investigate
  page.py`. The charts' drawing, linked/say and page_head.html are vesta_shared.page (a skill's own templates/ first,
  then vesta_shared/templates); for_the_ai is vesta_shared.message_format's. reports: the `investigation` command and
  its --data/--around flags gone.
- #4: alert-desk desk.tell — ONE answer to who hears each notice and with which buttons: escalated to
  chase.escalates_to; every other notice to people_roles of its priority, plus chase.asks while chased; only the
  asked role's carry the buttons, marked result.message(first_in_line=True). outcome.carry_out's "nobody received
  it" reads first_in_line, no longer "fm". rules.yaml `chase: {asks: fm, escalates_to: owner}`. Policy.group_role:
  member, may_approve_in and tool_access.allowed_for read one group role; test_who_acts... covers tool_access.
- #5: vesta_shared.device_state.RestartDrops (at_restart / theirs / kept_down): flips_per_day and investigate around
  ask it; around marks a drop the restart took down and that never came back.
- #6: the heartbeat carries `cadence` {checkMinutes, nightlyAt} (agent-contract.json `heartbeat`, copied from the
  Kiosk 2.496.372): Vesta.kiosk_cadence reads the scheduler's tick and the schedule entry a skill marks
  `kiosk: nightly_check` (preventive-maintenance's 02:00 job); skills.py validates `kiosk` (KIOSK_JOBS).

## 0.6.194 (15 October 2026)

Architecture review, 2026-10-15:
- #2: agent-contract.json `ticket` (stamp, source, origins, fields, takenStep, sample) copied from the Kiosk;
  tests/test_contract_ticket.py holds AGENT_BY, the origins problems.card/tickets write, and held_tickets on the sample.
- #3: a card's Telegram lines matched by their MOMENT, never their words (kiosk.note_ticket, tickets._converge) — a
  rewording no longer re-adds them; a press is the story's line on Telegram too (Notices.heading renders "pressed",
  `_pressed`), and its answer in its own chat is stage "pressed", not recorded (result.STAGES + Notices.record);
  kiosk_words: "in the Cockpit" (desk reads the old "in the VESTA Kiosk" too). shipped-skills recorded.

## 0.6.193 (15 October 2026)

- Every person-facing text without "Home Assistant" (owner, 2026-10-15): alert-desk desk.py statuses and notes,
  rules.yaml check, recheck GONE_NOTE, actions.py answers, api_errors.py, concierge voice errors, reports' incident
  words, facts outcome, investigation_facts, investigate facts, roi-energy proposal title, knowledge_pack question,
  tools.py error. Vocabulary: "the villa's system"; where it only said where, dropped.
- instructions.md rules 5 and 6 (+ INSTRUCTION_REWRITES for installed villas). shipped-skills.json recorded.
- tests/test_no_platform_name.py: the spoken files' string literals (docstrings and logs aside), the sent yaml texts
  and the model's speaking rule.

## 0.6.192 (15 October 2026)

- vesta_agent.incident_thread: a REPLACED status (close, restate) redraws the copy's whole heading from the
  incident's history (`reheading` = notice.Notices.heading) — the step it showed becomes a history line.
- vesta_agent.notice: `note_step(state, incident, stage, note)` keeps a step in its own words ("Ticket opened in the
  Cockpit by …"), listed by heading(); app._alert_taken records it after restating. Tests: test_taken_in_kiosk.py
  (the villa's 15 October sequence), test_one_saying / test_telegram_events updated to the redrawn history.

## 0.6.191 (15 October 2026)

- Incident state `taken` (vesta_shared.store.Incident.TAKEN): open, not chased. `Problems.taken_in_kiosk(task, said)`
  moves a chased incident there when a person put its Kiosk fault in progress ("Open Ticket").
- vesta_agent.kiosk.held_tickets: `taken_at` / `taken_by` from the person's in-progress step (never an agent's).
- vesta_agent.tickets._take_in: an alert taken on in the Kiosk stops its ladder and restates every copy
  (incident_thread.IncidentThread.restate: the status, no buttons, NOT settled — its close still shows).
- alert_buttons.open(): a taken incident carries no buttons. kiosk_words.taken(). Tests: test_taken_in_kiosk.py.

## 0.6.190 (14 October 2026)

- vesta_agent.kiosk: `add_ticket(origin=)` writes the fault's `origin` ("alert" | "night" | "chat"), the Kiosk card's
  source icon (2.496.359); `tag_ticket(tid, number, origin)` replaces number_ticket; `held_tickets()` gives `origin`.
- vesta_shared.problems: `card()` says the origin (incident → alert, finding → night); a fault with no task (a chat's
  "Create this fault") is "chat". tickets.repair tags open faults made before.

## 0.6.189 (14 October 2026)

- vesta_agent.notice: `Notices.story(incident)` — the Kiosk card's lines of an incident's Telegram life (reminder,
  escalation, still there, back, reopen request, a button pressed other than Done), from the same history as
  Telegram's "Status:"; `note_press()` keeps a press in that history (alert_buttons), never shown as a Status line.
- vesta_agent.kiosk: step kind `noted` (agreement 2.496.356); `note_ticket()` writes the missing lines, each at its own
  time, never twice; `says(kind)` reads /agent/v1/info `step_kinds`; `held_tickets()` gives `noted`.
- vesta_agent.tickets: `_converge` writes an open alert fault's missing lines (from its task's run on), only to a
  Kiosk that shows them; repair re-reads the Kiosk's info until it does. Tests: test_card_story.py.

## 0.6.188 (14 October 2026)

Architecture review, 2026-10-14 (problem ↔ Kiosk fault):
- vesta_shared.problems: `in_persons_hands(task)` — a task a person reopened is closed only by a person:
  `clear_source` (close_finding, close_incident when cleared) skips it, as repair already did. `closed_by_person(source,
  since)`: one reading of a person's close for open_problems and unseen. `card(task)`: what the task's Kiosk fault must
  say (open, title, alert number, close note, who). `close_outlived()`. `current_title` follows an open incident's
  message (Home Assistant re-wording it). Tasks keep `close_note` / `closed_who` (store columns, added on start).
- vesta_agent.tickets: `repair()` = take in a person's gestures (`_take_in`), close outlived tasks, make every fault
  what its task says (`_converge`), create missing faults — a failed resolve is redone with its person and note.
- vesta_agent.kiosk: `_ticket_id()` (the id seam the tests' document uses).
- tests: kiosk_fake.FakeKiosk is the REAL Kiosk over an in-memory Facility document (only `_req` replaced) with a
  person's Cockpit gestures as verbs (held, person_closes/reopens/moves/renames); the two other stand-ins are gone.
  New: test_persons_hands.py, test_card_from_task.py.

## 0.6.187 (14 October 2026)

- vesta_agent.kiosk: `add_ticket(number=)` writes `alertNumber` on the Kiosk fault (the incident's number, "#5");
  `number_ticket()` gives it to a fault made before; `held_tickets()` reads it back (`alert_number`).
- vesta_agent.tickets: `create()` passes the number when the task's source is an incident (none for a finding);
  `repair()` numbers open incident faults that lack it. tests/test_alert_number.py.

## 0.6.186 (14 October 2026)

Retrospective, 2026-10-14: Timmerflotte_2623 sat open five days with no fault and nothing anywhere said so.
- vesta_shared.problems: `TASK_SEVERITIES` (one place: the severities that earn a task — record_night's default);
  `Problems.unseen()`: open findings at a task severity with no open task and no person's close (Done, closed in the
  Kiosk).
- vesta_agent.tickets.repair (every start, after the night check, every 5 minutes): logs "N open problem(s) have no
  Kiosk fault: <rule> <entity>, …" when any is found.
- tests: test_unseen_names_an_open_problem_with_no_fault_and_no_persons_close (a run of nights leaves none; a
  person's close is not unseen; a task cleared under a still-open problem is), and
  test_the_repair_says_when_an_open_problem_has_no_fault (the caller, pinned). Both red when broken.

## 0.6.185 (14 October 2026)

Villa, 2026-10-14: Timmerflotte_2623 offline for five days, open in the night check every night, never in the Cockpit
(the owner's Closed list: no fault for it, ever). A task — hence a Kiosk fault — was asked for only on the night a
finding was new or came back; one opened before it earned a task stayed open and unseen for the life of the problem.
- vesta_shared.problems.record_night: a still-open finding at a task severity with no open task and NO task ever
  (store.last_task of its source) gets one; tickets.repair gives it its fault within 5 minutes. One that had a task is
  left alone: a person's close keeps a still-true problem quiet.
- tests: test_an_open_problem_that_never_had_a_fault_gets_one_and_a_hand_closed_one_stays_quiet (red two ways: no
  catch-up, and a hand-closed one revived).

## 0.6.184 (14 October 2026)

Owner, 2026-10-14: a fault about a device deleted from Home Assistant stayed open until 02:00, then closed "Cleared: the
nightly check no longer sees it", as if the device had come back.
- preventive-maintenance recheck.py (every 5 minutes): any open finding whose every entity Home Assistant answers
  "not found" for closes with "Closed: it no longer exists in Home Assistant."; an offline finding whose devices are
  back or deleted closes as back online. It now reads whenever a finding is open (one bulk read), not only an offline one.
- vesta_shared.ha_client `not_found(ids)`: only HA's own ENTITY_NOT_FOUND, asked as a list (one id alone is an error);
  a failed read is never "deleted". `tool(partial=True)` lets a bulk read whose every lookup failed answer.
- tests: test_a_fault_about_a_device_deleted_from_home_assistant_closes_saying_so (red three ways: no close, a missing
  row taken for deleted, a deleted device still counted as offline). Checked live: only a made-up id is "not found".

## 0.6.183 (14 October 2026)

Villa, 2026-10-14 (Cockpit audit): the House & Pool relay's reconnect fault was keyed on the switch on 10 Oct and on
the uptime sensor on the 11th — whichever entity the night's logbook named first — so each change closed one fault
and opened another, and the open one kept its first night's words.
- preventive-maintenance nightly `_standing_entity`: a device's reconnect finding is kept under ONE entity — its first
  classified entity, else its first entity, never a control with no state (`_NO_STATE_DOMAINS`: on the villa the
  relay's first entity was its Restart button). Replayed on the villa's last four nights: one finding, refreshed.
- tests: test_a_device_s_reconnect_fault_keeps_one_entity_whichever_drops_first (red before the fix).

## 0.6.182 (13 October 2026)

Owner, 2026-10-13: "restart-filter fix … remove all code and workflow that would then become redundant".
- vesta_shared.device_state `ha_restarts` (Home Assistant's own logbook entry: domain homeassistant, message
  "started") and `in_restart` (within `restart_settle_minutes`): the one rule for "was this drop the restart's".
- preventive-maintenance: features.flips_per_day leaves out drops near a restart; the crowd count (20 ENTITIES in a
  minute — three relays losing one access point) and settings `restart_crowd_entities` are removed;
  `restart_settle_minutes: 10` replaces it.
- investigate `around`: says the restarts once and leaves out devices that dropped and answered again with them
  (one still lost stays listed); settings `restart_settle_minutes: 10`.
- Tests: test_maintenance_noise (restart from its own entry; three devices dropping together are counted),
  test_investigate (a restart said once).

## 0.6.181 (13 October 2026)

Owner, 2026-10-13 (Cockpit faults checked against Home Assistant's history; "never hardcode … universal"):
- ha_client.paged returns (rows, reached the end); logbook reads up to 200 pages (ha-mcp gives 500 rows a page) and
  sets `logbook_cut` when stopped short — nightly notes it, investigate's `around` says it. history's cut check uses
  the flag (it assumed 1,000-row pages).
- KnowledgePack.entity_devices (every enabled entity's device, classified or not), `device_id_of`,
  `entities_of_device`; device_of / device_name use them. actions.related_entities finds unclassified siblings.
- nightly: reconnect groups by `device_id_of` (an unclassified uptime sensor joined its relay); device findings
  (battery, offline, silent, reconnect) named by `_device_named` (device_label), measurements keep the asset's name;
  `_restarted` reads the device's own "uptime" entity (HA device class) — rules.flap_rules says Wi-Fi when it did not
  restart. rules `_held`: energy and running-power changes need EVERY confirm day beyond the threshold.
- Tests: test_ha_reads, test_call_service_shape, test_maintenance_noise (one device, device name, uptime both ways,
  odd day for energy and running power, battery named for its device).

## 0.6.180 (13 October 2026)

Architecture review 5, 2026-10-13 (owner: "do all of them in one release"):
- State.prune keeps an OPEN incident's records (own_messages of its copies, inc:, incthread:, inchist:) whatever their
  age; housekeeping passes the store's open incidents. Test: test_housekeeping.
- `skills.when_it_runs` is the page's "When the skill runs" (server.skill_detail read its own copy and missed
  before_answer); HOOK_EVENTS carries each event's words. Test: test_page_controls (every Skill field placed).
- `actions.related_entities` (was app.py's): no pack, or an id the pack never saw (rows + unclassified), is unknown —
  None, the owner asked — as Home Assistant not answering already was. Tests: test_call_service_shape (the real
  wiring); tests/helpers.known_devices gives a test villa its pack.
- `result.PRIORITIES` / `PRIORITY_ORDER`: app's heading, desk, Problems and playbook read the one list.
- Offline Test runs a script with VESTA_ASKER "page"; proposals' answer.py checks and records nothing then.

## 0.6.179 (13 October 2026)

Owner, 2026-10-13 (review 4): reports/SKILL.md said the digest's numbers let "a reply '3 done' close the right one" —
no typed reply ever closed anything. Corrected there and in compose's comment; villa-concierge/SKILL.md tells the AI a
typed "#9 done" closes nothing (the Done button under the alert does; a fault closes in the Kiosk). Text only.

## 0.6.178 (13 October 2026)

Owner, 2026-10-13 (review 4, #1): a proposal is answered with /proposal — the monthly page asked for "accept 3" and
nothing recorded it (`Store.decide_proposal` had no caller since 0.12.68).
- New starter skill `proposals` (skill.yaml `command: proposal`, the /investigate mechanism): `answer.py answer
  --number N --choice accept|later|ignore` — accepted / open / ignored; the reply names the proposal and says what it
  was; the owner only. A run's scripts know who asks: `Settings.asker` → VESTA_ASKER (a conversation's Origin now
  carries the person's role, as a job's did). `Store.add_proposal` keeps one proposal per title whatever its answer.
- report.html: "Proposal N" and "/proposal accept N…"; reports, roi-energy and villa-concierge SKILL.md say /proposal.
- Tests: test_proposals (through the real /proposal command; owner only; a wrong number; answering again; ignored is
  never made again; "accept 3" alone refused), test_reports, test_config_and_skills (seven starter skills).

## 0.6.177 (13 October 2026)

Architecture review 4, 2026-10-13 (owner: "implement #3 and #4"):
- Investigation rules once: compose `SUMMARY_SENTENCES` ("3 to 5 sentences") is what the refusal says and what
  investigate's SKILL.md asks for (test). The agent tells a run's scripts whether it may search the web
  (`Settings.web_search_on` → VESTA_WEB_SEARCH_ON, from `Toolbox.include_web`); compose investigation refuses a page
  with no search when it is on (skill.yaml said so, nothing checked it). `messaging.CITE` / `uncited` — the chat
  message and the Kiosk fault offered from an investigation (`fault_offers.ensure`) both drop "[n]".
- preventive-maintenance settings.yaml behaviour: reconnect_days (read by nightly.py's logbook window AND flap_rules,
  and said in the message), reconnect_events, ran_min_hours, intermittent_share, intermittent_min_days, full_day_hours,
  energy_baseline_min_kwh — were typed in rules.py / nightly.py. Defaults unchanged. Tests: test_maintenance_noise
  (a villa's 5 days widens the read, the count and the words), test_investigate, test_ticket_offer.

## 0.6.176 (13 October 2026)

Architecture review 3, 2026-10-13 (owner: "do 2. and 3."):
- message_format.pages never loses text: an item longer than a page is cut into pieces (`_pieces`: between
  paragraphs, lines, sentences, words — mid-word only for a word longer than a page), never shortened with "…". A
  labelled section's paragraphs are one item (_sections), so six paragraphs under "Findings:" went as one truncated
  message. Test: test_message_format (every character sent, in order).
- reports/compose: TO_ROOM is `len(message_format.TO_LONGEST)` (the longest roles-only "To:"), was 120 for names;
  SUMMARY_MAX 554 → 646; investigate's SKILL.md asks for at most 640 characters. Tests: test_investigate (the
  caption is filled; the SKILL.md limit agrees with SUMMARY_MAX).

## 0.6.175 (13 October 2026)

Owner, 2026-10-13 (alert #5, the house pump; message layout):
- alert-desk: `priority(ev, route)` — the event's `priority` (P1–P4, the rules' new "VESTA priority" input), else its
  route; Home Assistant's `severity` word is never a priority. A repeat goes to `recipients(sev)` (was "fm" whatever
  the priority) and carries the latest words, claim and priority (`_restated`, RESTATED); a priority that chases
  arriving on a logged incident starts the ladder. `claim`: a Home Assistant template the rule sends with every
  alert, rendered by `HABase.template` (McpClient: ha_eval_template; FixtureClient: templates.json) — `still_there`
  reads it first, `seen_again` closes any open incident whose claim reads false for clear_minutes (payload
  clear_since), "unknown" keeps it open and is said once. SEEN_AGAIN, watched_for and ha_silent_hours removed: no
  blueprint is named; an alert without a claim is judged by its bad_states (mode absent or "state"). Tests:
  test_alert_desk (claims, priority, repeats), test_closed_not_over.
- "To:" is roles: `message_format.ROLE_WORDS` / `audience` ("Owner & Facility Manager"); `Notices.roles_for` replaces
  the names (`_for`, `addressed`, `Policy.names_for` removed); history lines record the roles per chat (an older line's
  names read back as roles). `fill_to` / `titled` / `pages` take the audience text. policy.ROLE_WORDS is
  message_format's. The HA jinja writes only those three forms (any other value: "Owner & Facility Manager").
- Telegram layout: titles bold (TELEGRAM["title"]); `document` writes a labelled section's items one per line and
  `parts` reads ONE item / note span per section (an AI's items written apart too; an alert's history and status one
  note); `pages` cuts between items and repeats a section's label. The jinja title is <b>, the package's check
  sensor expects it. Tests: test_message_format, test_one_saying, test_ha_message_layout.

## 0.6.174 (13 October 2026)

Architecture review 2, 2026-10-13 (owner: "do all of them"):
- vesta_shared.device_state is the one reading of a state (reading: answers / no value / offline / absent; has_value,
  is_offline): features.flips_per_day counts "unavailable" only (it counted "unknown" too, and the dead
  from_unavailable), rules.availability_rules, the night's battery read, the alert desk's silent devices, investigate
  and VillaParams read it. Test: test_shared_grouping (red with "unknown" counted).
- skill.yaml `buttons` ([{option, label, mark}], checked by skills._buttons): the alert buttons are the skill's.
  alert_buttons draws them and passes `option` to on_reply (and `text`, the label, for a skill.yaml from before:
  BEFORE_BUTTONS); desk.py decides by option and writes every press with message_format.PRESSED (it read the label
  back by its first word, and wrote the sentence by hand). Tests: test_one_message_per_incident (a renamed button still
  closes the alert; red when the label is passed as the option), test_config_and_skills.
- TurnResult.then joins a follow-up turn by a rule per field (THEN; test holds it to the class) — app._delivered merged
  12 fields by hand. _converse adds its buttons up (report without the AI, Continue, fault offers): a Continue
  replaced the report buttons. Test: test_api_errors.

## 0.6.173 (13 October 2026)

Architecture review, 2026-10-13 (owner: "fully proceed"):
- vesta_shared.timeutil.lasting is the one duration wording; vesta_shared.periods the investigation's period kinds and
  their words (sentence and chart band), read by investigate.py, investigation_facts.py and compose.py (three
  `lasting` copies, two word tables before). Test: test_investigate (red with the old 5400 s rule).
- command_request.Requests: a command skill's request (its skill, id, brain and limit, web searches) from its first turn
  to its Continue; the searches are records (state.keep_request_searches, "request_searches:"), so a restart before a
  Continue keeps them. skill.yaml `modes` retired (no skill declared it; VESTA_MODES gone). Test: test_ticket_offer
  (a restart between a stopped /investigate and its Continue).
- message_format holds STAGE_WORDS (was layout.py) and PRESSED, the Done / Need help sentence (alert_buttons);
  homeassistant/custom_templates/vesta_message.jinja writes a status from its stage (vm_stage, vm_who) in the same
  words and icons. Test: test_ha_message_layout compares it with layout.stage_line for every stage.

## 0.6.172 (12 October 2026)

- homeassistant/custom_templates/vesta_message.jinja: an empty vm_to is input_text.vesta_alert_audience (the one
  villa-wide "To:" of every alert), "Owner, Facility Manager" without it; test_ha_message_layout covers the three cases.

## 0.6.171 (12 October 2026)

- notice.addressed: the one rule for the names of a "To:" line and a history line — the people, a role's word only
  when nobody is named (owner, 2026-10-12: "To: the Owner, Fabien, JM"). Used by Notices.heading (incident and not),
  Notices._names and Outcome's merged recipients. Test: test_people_routing (red without it).

## 0.6.170 (12 October 2026)

- homeassistant/custom_templates/vesta_message.jinja: the one layout (message_format) in Telegram's HTML, for the alerts
  Home Assistant sends itself (telegram_bot.send_message parse_mode html), used by `{% include … ignore missing %}`
  with vm_title / vm_to / vm_text / vm_status; escapes & < > once. homeassistant/packages/vesta_message.yaml:
  sensor.vesta_message_layout ("ok" / "missing" / "changed", every minute) — a blueprint formats only while it is ok.
- tests/test_ha_message_layout.py holds the file to message_format.document and the TELEGRAM style table, and the
  sensor to the file (proven red by changing either side alone).

## 0.6.169 (12 October 2026)

- ONE LAYOUT for every message sent on its own (owner, 2026-10-12): `layout.render` has one path — a heading (title +
  "To:" + an incident's history) is laid out with `message_format.document`; without one (an answer to the asker),
  the text then "Status:". The "For: … / -------" layout is gone: `Poster.post` heads a message about no incident
  with its `title` (`message_format.titled`; UNTITLED "Message from VESTA" as the last resort) and "To:" naming
  everyone it went to (`also`), in the asker's chat too when it has a title. Titles: approvals.TITLE "Approval
  request", outcome.SIREN_TITLE "Siren request", and the engine's own sends (unreachable, fault reopened, siren, AI
  out of credit, report not prepared). A "For: …" heading recorded before is drawn under UNTITLED; `layout.legacy`
  also reads a text in the shape. A single history line longer than half the message is cut (it could exceed it).
- `messaging.incident_tag` is "#N" (was "Incident #N"); `messaging.RULE` is gone, and `incident_message` (a skill
  edited before 0.12.142) joins its status as a paragraph. alert-desk: "There is no alert #N."
- Test: every engine-written message is in the layout and styled (test_people_routing; proven red by two mutations).

## 0.6.168 (12 October 2026)

- reports: compose.py owner-weekly --page P attaches P (the fm-weekly page) to the owner's lines, in the AI's result
  (`attachment`) and in the without_ai step; the line says "Details in the attached page." (without --page: "The
  facility manager has the details in their weekly page."). The fm-weekly job's prompt and without_ai step pass it.

## 0.6.167 (12 October 2026)

- compose._framed lays every <text> of a chart over it as page text (.chart .ax, 13 px; 11 px under 480 px wide).
- investigate.state_series: more than `state_lane_max` (settings.yaml, 8) different states = a value (`as: value`): its
  lane draws only its offline bands.

## 0.6.166 (12 October 2026)

- compose._tip is a mark laid over the chart as page text by _framed (CSS .chart .pt, 13 px, after the svg): every
  report chart. hourchart: 0–60 for hours, the usual as one path. naming(): a cause's source as its page's title + [n];
  a source neither [n] nor "the records" is refused. investigation.html: CSS-only Light / Auto / Dark switch
  (page_head :root:has(#th-…:checked)), descriptions above charts, pills usual = ok, reported = watch.

## 0.6.165 (12 October 2026)

- investigate: no `modes` (web research is SKILL.md step 6, always). An investigation's web searches are one list
  across its turns (app._web_searches by `inv` → Toolbox(searched=)), so its page follow-up knows them.
- compose.py investigation: [n] citations (cited/citing: every source cited, every [n] a source; links #src-n; the
  chat message drops them); web_said; BANDS plain words + own colours (--c5 added), READINGS / USUAL; hourchart
  (investigate.running_per_hour: minutes running per hour vs the same hour's average before); normal_series only for a
  device read as levels; normal_words in sentences; axis labels through timeutil.
- investigation_facts: `log` (time order, pills unusual / usual / reported), `findings` (Ruled out / To check / What the
  records cannot tell, grouped), `alerts` per device and rule; plain alert rules and period reasons in investigate.py.

## 0.6.164 (12 October 2026)

- vesta_shared.ha_client READ_ACTIONS: ha_manage_blueprints allowed for `get` only (every other action refused, even
  on a write client's read path). investigate.automation_able reads a blueprint automation's actions
  (_from_blueprint: {"__input__"} filled from use_blueprint.input, else the blueprint's default).
- investigation.html: the AI's reading first; established facts and timeline in <details class="fold">; one legend
  macro (charts: readings / bands / days before; strip: compose.strip_legend from LANE_STYLE); checked + sources one
  section. compose._tip: TIP_FONT 8.5, _wrap to the chart width, at most 3 lines (every report's charts).
- investigate.spoken(): a name for an entity with no state; "Where the lead came from" for a cause's source.

## 0.6.163 (11 October 2026)

- Facts first: reports/scripts/investigation_facts.py lays out, from investigate.py's readings (timeline --out, and
  now around --out: offline/back, automations with `can` nothing/changes/unproven, `changes`, `does`, notifications),
  the page's "What the records show", "Ruled out by the records", timeline, "What would have warned earlier" and the
  message's key line (KEY_MAX; SUMMARY_MAX now 554). compose.py investigation --around; its result lists the facts.
- investigate.py: each flagged period carries `alert` {rule, at} — the earliest an alert on the limit that flagged it
  would fire, only within the period; a level is judged over level_change_gap_s, a zero over offline_min_s;
  `coincide_s` (600) joins events to unusual moments; automation_able (automation_can kept as its text).
- investigate.py timeline --out: `normal_series` (same_hours_before: the baseline's same hours, per day, period ≤ 1
  day) and, for an entity without numbers, `states` (state_series: on/off/offline/other by the timeline's own
  vocabularies); worth_a_line groups stop-start BEFORE hiding ordinary periods (the burst vanished with > 40 periods).
  compose.py: BANDS / band_of (band word + colour, the legend), timechart(normals), strip(lanes); investigation_facts
  `lanes`; web_pages() is the one "which sources are links"; "Sources (web)" always rendered.
- script_run logs each AI script's duration; app logs each answer's duration ("Answered … (cost, N s)").
- The run's web searches: runner.make_guard records each WebSearch query in tools.Kit.searched (Toolbox.searched);
  run_skill_script passes them as Settings.web_searches → VESTA_WEB_SEARCHES. compose.py investigation refuses a page
  without `sources` after any search; the page lists the searches. tests/ai_fake: call["web_search"] through the real
  hook.

- skill.yaml `brain` (economy / auto / performance: skills.BRAINS = policy.PROFILES) and `limit_usd` (0.05–20): a
  command skill's answers, its page follow-up included, use them (turn.chat_terms). investigate: auto, 3 US$.
- investigate.threshold: "high" is the top `high_quantile` (0.999, settings.yaml) of the readings, not the 95th
  percentile — a device idle 99 % of the time had its runs never counted.
- The request's active modes reach the skill's scripts (Settings.request_modes → VESTA_MODES), through the page's
  follow-up turn and a Continue (continuations.modes, migrated). Skill.active_modes.
- reports compose.py investigation: `sources` [{title, url}] rendered as "Sources (web)"; with web_research on, refused
  without them; a cause with a source refused without its verdict.

## 0.6.162 (11 October 2026)

- skill.yaml `modes:` (a command skill): name → words / said_on / said_off; Skill.modes_for(text) matches whole words
  and app._converse says each mode's line before the request. investigate: `web_research` (internet, web, online, en
  ligne); SKILL.md "Web research"; the page shows a lead's source and verdict.

## 0.6.161 (11 October 2026)

- investigate: web_search in skill.yaml tools (the page's Skill tools card; read_skill says when it is switched off);
  SKILL.md step 6 says when to search the web and that it only explains the records.

## 0.6.160 (11 October 2026)

- investigate.py timeline: an on/off control (CONTROL_DOMAINS) that stayed in OFF_STATES the whole period and its
  baseline, read with a device that ran, is marked "NOT what turned it on"; one always on, "does not explain".
- investigate.py around: each automation that ran says what it is able to do (automation_can: its config's actions at
  any depth, HARMLESS kinds vs what can change things; a blueprint's: unproven, with its kept traces in the period).
- SKILL.md step 5 reads them; both cause directions are asked.

## 0.6.159 (11 October 2026)

Architecture review 32:
- fault_offers.FaultOffers: an offer's whole life (ensure one per investigation from an account written for it,
  keep_page, show — marked shown once delivered —, press within the caption limit). state: ticket_offers.inv,
  pending_offers / offers_shown / offers_of; the per-chat `invoked:` key is gone.
- A Continue carries its command skill and investigation (continuations.invoked / inv, migrated).
- _delivered's follow-up passes on its stop, problem, error, photos and approvals.
- intake.gate answers a switched-off skill's command (command_off); skill.yaml `usage:`; RESERVED_COMMANDS from
  intake.OWN_COMMANDS.
- vesta_shared.messaging.TELEGRAM_CAPTION, used by telegram.py and reports' compose (SUMMARY_MAX derived, TO_ROOM).
- investigate: settings.yaml behaviour thresholds (th()); McpClient.history_cut, said by timeline and never stretched.

## 0.6.158 (11 October 2026)

- A command skill's page message is the answer: the AI's text after it is not sent (logged), the fault offer's buttons go
  under it (Telegram.buttons: editMessageReplyMarkup; Delivery.buttons; outcome's done["messages"]; Toolbox.pages,
  TurnResult.pages, carried through _delivered's follow-up), the named offer message only when Telegram refuses.
  A press on it edits the caption.
- compose.py investigation: the summary is the chat message, at most 800 characters and the title 90 (refused above):
  title, "To:" and summary fit Telegram's 1,024 under a file — one bubble.
- A fault created from an investigation keeps its report: each offer gets its own copy of the page
  (state.ticket_offers.document, migrated), tickets.create(document=) uploads it (Kiosk.add_document:
  /agent/v1/fm-document, Kiosk 2.496.326) and writes documentIds; a Kiosk without it gets the fault and a note.

## 0.6.157 (11 October 2026)

- investigate's command is /investigate only (owner). skill.yaml `command:` may also be a list (the first is written,
  the others start it too: Skill.also).
- A command skill's turn (Skill.command) never resumes the chat's conversation (app._converse): resumed, the AI answered
  the command from an earlier answer with no tool call. A Continue still resumes; the next turn resumes the
  investigation's session.
- skill.yaml `deliver:` (a command skill only): `page` the file every answer must have sent, `fault_offer` the saved
  account a fault is offered from when the AI offered none — checked by app._delivered after the turn (one
  follow-up turn for a missing page, then the person is told). Toolbox.attached / offered, TurnResult fields.

## 0.6.156 (11 October 2026)

- skill.yaml `command:` (skills.Skill.command; Skills.commands): a skill only its "/command" starts — out of the AI's
  skill list (named apart in the system prompt), refused by read_skill / run_skill_script without it (Toolbox.gated),
  called for by intake.gate (as Telegram's command or anywhere in the text; it addresses the agent in a group), carried
  through a Continue (State.invoked). investigate declares `command: investigation`; the concierge points to it.
- runner.Collector: the answer is the text after the last tool call (Collector.answer); the last text before one
  (`earlier`) is said only when the run sent nothing (TurnResult.sent).
- A fault offer: buttons Create / Don't create (button_data.TICKET t:<id>:<y|n>); alone in its own message when the
  answer was a page.
- reports: compose.py investigation (templates/investigation.html, time charts `timechart`), the page head shared
  (templates/page_head.html); investigate.py timeline --out saves each device's chart series.

## 0.6.155 (11 October 2026)

- McpClient.history reads by time slices (6 h, halved when a slice holds more than a page, doubled when quiet, at most
  400 calls): ha-mcp fetches the whole period for every page. A slice's carried-over opening state is dropped after
  the first. tests/test_ha_reads.py: a recorder stand-in that answers as ha-mcp does.

## 0.6.154 (11 October 2026)

- create_ticket in a conversation only OFFERS (state.ticket_offers; button kind "t", app._press_ticket: claimed once,
  released when the Kiosk refuses); one offer per answer; a scheduled job or alert hook still creates at once.
  tests/test_ticket_offer.py.
- The chat prompt no longer ends with "Answer short."; the system prompt asks for the matching skill on every new message.
- INSTRUCTION_REWRITES: rule 4 (offered in a chat); a rewrite applies once even when the new wording begins with the old.

## 0.6.153 (11 October 2026)

- McpClient.logbook: hours_back is counted back from end_time (ha-mcp), not from now — a past period read every hour
  between its start and now (67 h for one day two days ago, 24 pages, 75 s on the villa); test_ha_reads pins it.
- investigate.py: a date alone as --end is the whole of that day; --entities refuses what is not an entity id.
- config.load logs what seed_config wrote (an instruction rewording left no trace).

## 0.6.152 (11 October 2026)

- README: a starter skill is copied once, on the first start or by the release that adds it. The image's start-up check
  (agent-host/tests/container_test.sh) and DOCS.md list the six starter skills.

## 0.6.151 (11 October 2026)

- Starter skill `investigate` (find / timeline / around: read-only, every flag against the device's own previous days,
  no device named; tests/test_investigate.py).
- A starter skill a later release adds reaches an install made before it: `skills.OFFERED` (.offered.json) records the
  names an install was given (`OFFERED_BEFORE_THE_RECORD` for installs from before the record); a name not in it is
  copied once, a deleted one stays deleted. The start logs and records it in History ("added by engine").
- `config.INSTRUCTION_REWRITES`: a starter instruction sentence a release rewrote replaces the villa's copy only where
  it still stands word for word (rule 6: an investigation is complete and may be long).
- villa-concierge's SKILL.md leaves questions about what happened in the past to investigate.

## 0.6.150 (11 October 2026)

- No villa's name in tracked files: examples in message_format, compose and two tests now say "Villa Example" (the
  Kiosk's hard-rules gate refused the published changelog on main).

## 0.6.149 (11 October 2026)

- Review 31 (agreement: ticketUpdate kind "cleared", copied from the Kiosk 2.496.325): Kiosk.resolve_ticket with `who`
  records a completion (who; its by stamped by the Kiosk), without it writes kind cleared; reopen_ticket writes `was`
  when it changes the title; the desk's Done always passes who.

## 0.6.148 (11 October 2026)

- Review 30: record_night keeps an event finding with a task open until a quiet night (closes_tonight takes event_rules);
  open_problems dates an incident the villa's day (problems.villa_day_of, TZ); _came_back counts the run before when it
  ended in the window; facts.s_fixed_suggest skips what opened and closed the same day; message_format.document says no
  empty section. Skills: night check told_now in the one shape (title=, fault_note); concierge uses device_state.is_offline
  and leaves the battery to the night check.

## 0.6.147 (11 October 2026)

- Review 29: tickets.repair hears a Kiosk "reopened" step at any age (the 2 days only retry a failed close);
  vesta_shared/kiosk_words is the one wording of a Kiosk close / reopen (who and the Kiosk's time; timeutil.moment_label
  the one moment format); Problems.closed_in_kiosk / reopened_in_kiosk carry it; stage "reopened". kiosk.person_titled
  reads the Kiosk's rename step (by ≠ VESTA Agent), and a ticket with no agent title is the person's; held_tickets
  who-or-by; ticket.resolve carries who (desk Done --name). desk.seen_again: a silent device keeps the incident open,
  said once (silent_told) — reverses review 23 by the owner's choice. result.fault_note "What to do: ".

## 0.6.146 (11 October 2026)

- vesta_shared/message_format.py: the ONE shape of alerts and reports (title, "To:", sections; document / titled /
  pages / split_title) and the ONE style table (TELEGRAM: title underline, item blockquote, note blockquote+italic),
  read back by `parts` — an alert by fixed zones, its Home Assistant text one item whatever it says; telegram.py only
  applies `telegram_entities` (MessageEntities, never markup). test_no_style_is_written_anywhere_else.
- notice.heading: "#9-P2 (new|existing|closed)", "To:" everyone the incident went to (names read now from the chats in
  history), history lines "- Alert sent …", the first notice always kept ("- … N earlier notices"). retitle rebuilds a
  copy sent before. layout: stage icons and marks (result.MARKS help / unchecked).
- outcome: one history line per stage; every other copy synced (IncidentThread.sync, buttons kept: record "kb");
  close() settles every copy. A report is titled as data (result.message title=, send_message title=): posting writes
  its title and "To:" and cuts it into whole pages.
- alert-desk: statuses in its own words (no Home Assistant phase text), the person's name (--name), one Need help
  sentence, one closing wording; reports: fm-daily / owner-weekly / page messages in the shape.

## 0.6.145 (11 October 2026)

- Review 26: a fault's step says what it is — `kind` reopened / retitled (`title`, `was`) / reading (`title`), the
  Kiosk agreement's `ticketUpdate.kinds` (agent-contract.json, copied from the Kiosk 2.496.323); no "Now: …" note.
  `kiosk.agent_title` (its steps' `title`, or an old "Now: …" note) and `person_titled`: a person's title stays —
  update_ticket writes a reading, reopen_ticket keeps it. `held_tickets` gives agent_title and the last reopened step
  (`reopened_at` / `reopened_by`); tickets.repair reads a person's reopening from it, never from `updated_at`, and tells
  the facility manager of a night fault reopened (`tell_fm`, `kiosk_reopen_note`). alert-desk `still_there`: a device
  absent, unavailable or unknown (not a bad state of its rule) is "cannot check … does not answer". Tests:
  test_fault_steps.py (11), each shown failing on its rule.

## 0.6.144 (11 October 2026)

- Tickets.reopen, when it makes a new fault (none, or the Kiosk lost it): its note is the task's check (result.fault_note), never the reopening's "Back again." (villa: the Onsen pump's new fault). Test shown failing without it.

## 0.6.143 (11 October 2026)

Architecture review 25, all points:
- alert-desk: still_there (True / False / None with what each device reads) after every Done and Kiosk close; still bad → reopen "still" (stage "still", Kiosk note "Still there after the close.", payload abandoned so seen_again watches it); not knowable → "Note: VESTA cannot check this one"; watched_for also takes a condition whose rule was silent ha_silent_hours (12); the tick asks the fm on payload kiosk_reopened and escalates on payload unreached; one counter "Back again: N times in 7 days".
- Problems.reopened_in_kiosk (tasks.reopened_by; repair compares the ticket's last update with the task's done_at instead of re-resolving; source_gone never clears a task a person reopened); Problems.unreached; Kiosk.held_tickets gives updated_at.
- Outcome marks an alert whose fm chats were all refused; Delivery.on_unreachable → Vesta._tell_unreachable tells the owner once.
- notice: closed callable, word() and retitle(); IncidentThread.close retitles a settled copy.
- store: incident_counts in one pass; reopen_incident keeps each run's words and drops runs older than 40 days.
- Tests: tests/test_closed_not_over.py; 21 mutants, each red (run without bytecode).

## 0.6.142 (11 October 2026)

Architecture review 24, all points, and the heading's word:
- notice.heading(stage=): HEAD_WORDS — "new" New, "closed" Closed, any other stage Follow Up (by history only without a stage); Poster.post and adopt_ha pass the stage; result.STAGES gains "back" and "closed"; the desk's closing messages are "closed", a reopening "back".
- desk.siren_gate counts an intrusion incident by last_seen_at.
- Incidents keep their runs: store.reopen_incident / incident_occurrences (columns reopened_at, occurrences); count_incidents counts runs; facts.Ctx.incidents and compose.owner_weekly read runs; open_problems lists an incident as of its latest run with again_title (problems.incident_runs).
- One problem, one fault: Problems.reopen_task (store.last_task / reopen_task, tasks.reopened_at); result.reopened → ticket.reopen (Tickets.reopen → Kiosk.reopen_ticket, else a new ticket); the desk's _ladder and record_night reopen instead of opening; repair reopens a fault resolved before its task reopened and resolves a recently closed task's fault still open.
- Problems.current_title goes through again_title.
- One desk `reopen` (a new run: Home Assistant's latest words and states, snapshot, siren; or the same run after a Done); Problems.closed_in_kiosk sets check_quiet ("Closed in the Kiosk").
- The retune proposal is one per rule. d1.sqlite removed, agent-src/*.sqlite ignored, a test refuses a tracked store.
- Tests: tests/test_comes_back.py and report/desk cases; 21 mutants, each red (run without bytecode: a stale .pyc had served a same-length mutant back).

## 0.6.141 (10 October 2026)

Architecture review 23, all points:
- Findings that come back: store columns reopened_day / reopened_at / occurrences (migration); Problems._came_back keeps the days seen in AGAIN_DAYS; open_problems lists it as of reopened_day with `again_title` and ignores a person's close older than the reopening; the task and the Kiosk fault carry the same title; nightly.told_now tells a returning P2; nightly's unread digest_lines removed; tests/replay.py records "again".
- alert-desk: abandoned+cleared adopts Home Assistant's message with the closing note; came_back/_reopen reopen an incident closed within reopen_hours (rules.yaml, 4) — counted, ladder and fault again, ha_incident updated; `_ladder` shared with a new incident; Done sets check_quiet when the rule names its states and quiet_after_done reads the device once (rule_states; watched_for keeps the abandoned gate); seen_again tolerates offline when the rule does (device_state.out_of offline_ok); normalise turns a one-word bad_states into a list.
- outcome.adopt_ha fills "{time}" in an adopted status; incident_thread drops owed_since when it gives up.
- Tests: recurrence in every reader, reopening, the Done check, offline tolerance, the adopted wording; 17 mutants, each red (four survivors first: three tests added, one redundant filter removed).

## 0.6.140 (10 October 2026)

Architecture review 22, all points:
- alert-desk: `watched_for` replaces `held_states` (no history sampling): critical_watchdog and abandoned critical_condition in "state" mode are judged by the event's `bad_states` (a watchdog alert from before: its `state`); over = every watched entity out of every bad state for clear_minutes (`device_state.out_of`). `abandoned` with `still_true` false closes (`abandoned_cleared`); otherwise it marks the payload abandoned with mode/bad_states. `resolved` adopts Home Assistant's all-clear into an incident closed in the last day (`resolved_late`). The Kiosk note says the agent read it again.
- Blueprints (live, saved through HA): critical_condition sends mode and bad_states with every phase and still_true with "abandoned"; critical_watchdog sends bad_states.
- vesta_shared.device_state.out_of: the one "is it back" (recheck.py uses it, "unknown" counting as back there only).
- incident_thread: owed copies retried for OWED_FOR (2 h, `owed_since`), not 12 tries (housekeeping runs every 30 s).
- problems.record_night: a state finding closed in the last AGAIN_DAYS (7) days is reopened as "again" (detail count; store.last_closed_finding / reopen_finding); its task says "again: N times in 7 days"; the digest line too.
- chat_jobs.result drops the job's record; state.RUNNING_JOB (set by the scheduler in the run's task) lets Delivery.send mark a scheduled run delivered, and a delivered run cut by a stop is not run again.
- Tests: the live blueprint's shape (several entities, several bad states) in test_alert_desk.py, recurrence, delivered runs, a result before a stop; 17 mutants, each red.

## 0.6.139 (10 October 2026)

Faults that are over close by themselves (villa, 2026-10-10: three of nine Cockpit rows were long over):
- alert-desk: tick reads again what Home Assistant never says is over (SEEN_AGAIN: critical_condition after "abandoned", critical_watchdog): the state the incident opened on (the watchdog's event; a condition's from Home Assistant's history, read once and kept as payload "held"), left for `clear_minutes` (rules.yaml, 10) and not offline, closes it through `_close` (task, Kiosk fault, settle, the facility manager told when chased); a number is never compared. The tick CLI is given the live client.
- preventive-maintenance: recheck.py every 5 minutes — an open PM-UNAVAILABLE finding whose devices (detail "entities"; an integration-down finding now lists one per device) are all back `back_online_minutes` (settings.yaml, 10) closes as the night check would; Home Assistant is read only when a finding is open.
- Tests: tests/test_back_online.py, alert-desk's seen-again cases (the CLI included); 12 mutants, each red.

## 0.6.138 (10 October 2026)

Architecture review 21, all seven points:
- incident_thread: a copy is recorded shown only when Telegram took the edit (`_show`); one refused is `owed` and retried by `catch_up` from housekeeping, OWED_TRIES (12) times; `settled` stays the decision. telegram.edit: "message is not modified" is shown; a photo's or a file's message is edited through editMessageCaption.
- approvals: resume ends every "approved" decided before this process started (Approvals.started, no 2-minute guard) and settles a decided request whose copies still carry buttons; ask records a request no chat received "undelivered" (state.undeliver_approval; STATES row); STATES gains the note column (approvals.note / toast) — actions.decide returns the state, never words.
- outcome's siren gate: a request no owner chat took is said as the warning with "The siren cannot be requested", to the fm chats when no owner chat takes it either.
- Policy.may_approve_in(chat, role): the approver chats of an owner request leave out a group listed for both roles; Policy.member names a listed person as `name_in` (one name per chat; app's alert press uses it).
- chat_jobs: a job asked for in a chat is recorded (state.chat_job) and kept when cut by a stop; ChatJobs.recover at start says so in its waiting message. scheduler: a scheduled run is recorded (state.job_running) and a run cut by a stop may claim its slot once more (state.jobs_cut).
- app._press_report keeps the answer whole (parts, not layout.legacy); removed Notices.compose, Outcome.send, the outcome re-export of the record words; stale comments.
- Tests: tests/helpers.restarted (a new agent on the same records, through start()); tests/test_recorded_is_shown.py; FakeTelegram refuses edits ({"edit"}) or one chat ({"blocked 111"}); 16 mutants, each red.

## 0.6.137 (10 October 2026)

Architecture review 20, all seven points:
- posting.py (new): Poster.post (from Outcome._post) — the message's limit by its media (CAPTION for a photo or a file), its parts and limit recorded; Outcome(poster=, ask=) at construction, a guard when ask is missing; approval_thread moves to approvals.py.
- approvals.STATES: one table (AI words, toast) — "blocked" for the rules refusing at the press; now() reads decisions by decided_at (state.approvals_decided_since) and words each state with "(by X on …)"; expire only announces what expire_approval claimed (it now returns bool); resume ends an "approved" left by a stop (device read: done, else unknown); Approvals.idle().
- layout.render(p, limit): the head's oldest history lines go first ("… N earlier notices", counted in the fit), the head at most half the message, the status capped, never a negative room.
- Tests: Approve pressed through handle_callback with the follow-up; a decision on a request asked 3 h before; a half-done approval after a restart; expiry racing a press; the rules' refusal worded; a long head as one caption through Poster; each shown red without its fix (three tests strengthened after their mutants stayed green).

## 0.6.136 (10 October 2026)

Architecture review 19, all seven points:
- layout.py (new): parts head / lead / body / status, render, changed, legacy; IncidentThread records parts (post/adopt/close/rewrite), with_status gone; notice.heading has no line (layout adds it); Outcome._post builds parts (status, lead); result.message / ha_message take `status`; alert-desk's about() returns text + status.
- approvals.py (new): Approvals — ask, shown_in, press, follow (+ resume at start), expire (housekeeping), now (for the AI). actions.decide records "moving" for a device on its way and gives honest toasts; state: approvals_in, decided_name. Outcome.ask and app's approval code moved here.
- Delivery.reply sends the pictures when the words are dropped.
- Policy.knows_chat; actions' direct rule asks member; routing asks knows_chat; intake's dead private-chat rule gone; a private chat listed in both roles names its person once.
- Incident.ENDED ("muted" from before 0.12.132 is over); Store.is_muted / mutes / mute and record_night's old argument kept as no-ops.
- Tests: the moving curtain recorded then done, resumed after a restart, expiry and a 3-hour wait, pictures kept, the parts (an alert holding "-------", the siren's lead), the role table, the muted leftovers; each shown red without its fix.

## 0.6.135 (10 October 2026)

- app._converse: no written reply when this turn put an approval request in the asker's chat (the engine decides; the AI is told to answer anything else with send_message). The delete-after-decision backstop (state apprreply:, set_approval_answer) removed: one mechanism. Tests: the echo dropped even when the AI writes it; one message after an immediate press; shown red without the rule.

## 0.6.134 (10 October 2026)

- app.approvals_now: the approval requests waiting and decided in the last 2 hours, added to before_answer (acting on) as "checked just now, never from memory"; ha_call_service's description: call it for every action asked now. State.approvals_since. Test; two mutations red.

## 0.6.133 (10 October 2026)

- actions: PROGRESS verbs; done_words(settled=False) says "Opening …" for a device still on its way; decide returns `follow`; Actions.recheck reads it again. app._follow looks every FOLLOW_EVERY_S up to FOLLOW_FOR_S and IncidentThread.rewrite changes the request's body in every copy. Test with a curtain that reads "closed" until it opens; shown red without the follow-up.

## 0.6.132 (10 October 2026)

- tools.ha_call_service: a request shown in the asker's chat tells the AI not to announce it (empty answer unless something else was asked); app sends no answer when it is blank. Test; both changes shown red.

## 0.6.131 (10 October 2026)

- notice: in a private chat the heading names that chat's own person.
- actions: _words is the one reading of an action; done_words gives an approved request's body (PAST verbs; unconfirmed or failed said plainly); decide's note is "Approved by X on {time}." and returns `body`; execute flags `failed` / `unconfirmed`. IncidentThread.close / with_status take `body`. Tests; three mutations red.

## 0.6.130 (10 October 2026)

Every send scanned: what the agent sends on its own goes through Outcome._post (heading, RULE, status); answers to the asker carry none. Three left out, fixed: the snapshot (heading with its incident, "Camera snapshot"), the siren's "cannot be requested" (under RULE), the report-button press (incident_thread.with_status). Tests pin each; three mutations red.

## 0.6.129 (10 October 2026)

- Approvals in the notice layout everywhere: actions.request writes the action, RULE, "Waiting for approval by … (asked on {time}, …)"; Outcome.ask composes the heading in the asking chat too (Outgoing.asked_in gone); a decision replaces the status (with_status).
- The answer that said an approval was asked is deleted once it is decided: Toolbox.approvals → TurnResult.approvals → state `apprreply:` (RECORDS) set after the reply, read and dropped by app._press_approval. Test of the round trip; three mutations red.

## 0.6.128 (10 October 2026)

- Policy.member: in a listed group everyone — a listed person included — acts with the group's role (fm when listed for both); a person's row applies in their private chat. Test shown red without it; the approval test presses in the owner's private chat.
- app: the start-up warning is for an empty People (no destinations), not for People without persons.

## 0.6.127 (10 October 2026)

- policy.read_policy: a file with a People (or older chats) section names each role with no destination ("at least one Owner is needed…"); the page refuses such a save. A snippet without the section is not checked. The page tests start from a villa set up; the refusal shown red without the rule.

## 0.6.126 (10 October 2026)

Not found and Mute removed (owner, 2026-10-10: "too complex for now, I want to simplify it"):
- alert_buttons.LADDER is Done / Need help; RETIRED buttons on older messages answer what to use instead.
- Store: Incident.NOT_FOUND / MUTED, the mutes table, mute / is_muted / mutes gone. Migration at open: an open not_found incident becomes asked (asked_at now: the chase restarts); DROP TABLE mutes.
- alert-desk: no mute check at intake, no Not found / Mute replies, LADDER_OPTIONS, status without mutes, rules.yaml without mute_days; SKILL.md and skill.yaml say Done / Need help. Problems.record_night has no muted list (no muted_at argument); nightly.py follows. Reports: no "Muted alerts" row; "muted" kept only as the word for an older closed incident.
- Tests updated; the two buttons, the retired-button answer and the migration each shown red without their change.

## 0.6.125 (10 October 2026)

- notice.Notices(severity=): the heading says the incident's priority ("P2 Incident: New #18"), read from the store (app._severity, P1-P4 only; any failure leaves it out). ROLE_WORDS capitalised ("the Facility Manager"). Tests pin both; the priority shown red without it.

## 0.6.124 (10 October 2026)

The owner's notice layout (2026-10-10): heading / alert / status, each under messaging.RULE.
- messaging.incident_message(status, details): the alert first, the status under a line (RULE moved here; notice imports it).
- incident_thread.with_status: a settle note replaces the status (or goes under a line); IncidentThread.post logs each replacement (deleted, pointer, kept).
- Outcome fills "{time}" (the villa's time, notice.when) in a message when it is sent; Outcome takes timezone_name.
- alert-desk: no "New alert" status (the heading says New); every answer and all-clear says when ("on {time}"). Starter fingerprint recorded.
- Tests: helpers.status; the layout, the replacement and the time each shown red without their change.

## 0.6.123 (10 October 2026)

Architecture review 18 (points 1 to 5), and the owner's rule for group members:
- Policy.member(id, chat, name): a listed person's entry; else, in a group People lists, a member with its role (fm when listed for both), its language, the name Telegram gives. intake.gate, the press handler and actions.decide ask it; `direct` also for a listed group's member.
- config.Settings.policy: ANY failed reading keeps the last good rules (a YAMLError gave Policy({})). siren: the stop records its entity (state `siren:entity`); check_service(system=True, siren=) allows turning that one off.
- outcome._deliveries returns (chat, message, roles), one copy per chat with the roles merged; notice takes roles. Outcome._post: heading, send and thread in one step — approvals (Outgoing.to, asked_in), the siren warning and snapshots (thread `snapshot-N`) go through it.
- telegram: TelegramError.refused (403, or 400 chat not found / upgraded / kicked); Delivery marks unreachable only then.
- policy.legacy_rows: the page moves an old chat into People only for a group or someone listed; others stay in `chats:`.
- Tests: each shown red without its fix (11 mutations).

## 0.6.122 (10 October 2026)

People is the one list of where the agent posts (owner, 2026-10-10):
- policy: a People entry may be a group (a negative id): a destination, never a person. `destinations` (chat, role) — the entries, then an older file's `chats:` (read, a destination only, an unreadable value named); `chats_for(role)`, `roles_in(chat)`, `names_for(roles)` (persons only), `chat_label`. `chats` and `chat_role` gone; FIELDS keeps `chats` read-only.
- routing.target and approver_chats return every chat; outcome.carry_out expands each message to its chats (`_deliveries`, one per incident and chat), a `skip` for chats already told; the For line follows the message's role (notice `to`).
- Approvals: actions.Outgoing.chats; Outcome.ask sends each copy and keeps them as one IncidentThread (`approval_thread`); a press closes them all with decide's `note`. Delivery.send has no approval_id.
- One way out: the send_message tool, a failed job's notice and the owner's warnings go through carry_out; Toolbox takes `ask`, not `send`.
- tool_access.allowed_for: limited in a GROUP listed for fm; in a private chat the person's role decides.
- intake: an unlisted group is dropped; /whoami answered there to a listed person.
- Delivery records a chat Telegram refuses (state `unreachable:`); status.unreachable names it on the Overview.
- policy_doc: an older file's chats shown as People rows, `chats:` dropped at the next save. The Chats card and place are gone.
- Tests: test_people_routing (every chat of a role, the approval in every owner chat, the migration, the unreachable chat, the rights per chat, the For line), each shown red without its fix; the tests' stand-in policies replaced by the real Policy.

## 0.6.121 (10 October 2026)

Architecture review 17, defects A and B:
- policy._one_of: every value of the file tested against its choices (profile, conversation_reset, a job's profile, a person's role, an action's rule) is a word first — a list or a mapping raised TypeError at every reading. config.Settings.policy keeps the last good rules on any other error; ui.changes.rules_problems names it instead of an error 500; siren.tick reads the rules before it clears the stop.
- app.related_entities returns None when Home Assistant cannot say what the entities hold; actions._wrap_check then asks the owner (required_role owner, never direct). It swallowed the error and a group looked empty.
- Tests: no shape in any section raises; the last good rules kept; the siren's stop kept across a failed reading; an unreadable group asks the owner. Each shown red with the old behaviour.

## 0.6.120 (10 October 2026)

- app.housekeeping reads the Kiosk every KIOSK_EVERY_S (300 s): tickets.repair, so a fault closed in the Cockpit settles its alert's messages within minutes (it ran at start, at 01:30 and after the night check only).
- kiosk.held_tickets gives each ticket's resolved_at and the profile of its last update (`by`, recorded by VESTA 2.496.320); tickets.kiosk_close_note: "Closed in the VESTA Kiosk by <profile> on dd/mm/yyyy HH:MM", the Kiosk's own moment (notice.when).
- Tests: the note, the 5-minute read, the real reader of the Kiosk's answer, the note on Telegram after a close in the Kiosk. Each shown red with the old behaviour.

## 0.6.119 (10 October 2026)

One heading for every notice, and one person in two roles (owner, 2026-10-10):
- notice.Notices: compose(chat, text, incident) = "For: <names>[, Incident: New|Follow Up #N]", one line per earlier notice of the incident ("First time seen|Reminded|Escalated|Updated on dd/mm/yyyy HH:MM, to <names>"), "-------", the text; record(incident, stage, chats) after each result, one line for its chats together (state inchist:, KV_FAMILIES RECORDS). outcome.carry_out composes every message except an answer to its asker in their chat, and Home Assistant's taken over; app._tell_owner(_text) and the AI's send_message on schedule (tools) too. IncidentThread's own times / earlier() removed.
- result.message / ha_message stage= (new · reminder · escalated · update); vesta_shared.messaging.incident_message(status, details) is the body only; alert-desk sets each stage, drops ASK and "Press Done" from its rules' checks.
- Footers: "<button> pressed by <name> on dd/mm/yyyy HH:MM" (IncidentThread.close {time} as notice.when; the name policy.name_in(telegram id, chat)); "answered by", "Cleared in Home Assistant on", "Closed in the VESTA Kiosk on".
- policy: a telegram id may be listed once per role (still refused twice in one role); people[id] is the owner's entry when it has both; entries lists all; names_for(chat), name_in(id, chat).
- Tests: the heading and its history; one person in two roles named per chat; the footer. Updated: every test reading an incident's text reads its body (helpers.body). Each shown red with the old behaviour.

## 0.6.118 (10 October 2026)

Two baselines (owner, 2026-10-10):
- Every message about an open alert carries its buttons, in every chat: outcome.carry_out gives the keyboard when the skill asks or the incident is open (AlertButtons.open); adopt_ha edits Home Assistant's message with the keyboard (Telegram.edit / Delivery.edit keyboard=, IncidentThread.adopt keyboard=). IncidentThread keeps each chat's message times and earlier() adds "Earlier messages: …" to a new message. alert-desk: "Press Done…" (ASK, rules.yaml checks, SKILL.md "Answers"). Reports and digests carry no buttons.
- One "typing…" for every wait: Delivery.hold(chat, label) — one loop per chat, held by whatever the person waits for, released by each; Delivery.typing(held=) is a hold. handle_message holds from the message's acceptance (a photo fetched, a voice transcribed) and hands the hold to converse; ChatJobs holds for its jobs (its own loop removed).
- Tests: buttons on every open alert's message and on Home Assistant's taken over, none saying "Reply Done"; the earlier messages' times; one loop per chat however many hold it, released by the last; "typing…" already shown while a photo is fetched. Each shown red with the old behaviour.

## 0.6.117 (10 October 2026)

A photo is a message (owner, 2026-10-10: two screenshots with "/ask" in the group were dropped without a reply or a record):
- intake.gate: an image attachment goes through the same rules as a text message. Its caption is put in the command's own shape (Home Assistant fires a caption as text, never as a command event) and meets the one command rule; no rule of its own. A file that is neither voice nor image is dropped with its reason recorded.
- app.handle_message fetches the photo (PHOTO_MAX_BYTES, 5 MB, the API's limit; a failure is said to the person); converse(image=); the message says a photo is attached; the Costs row's question reads "[photo] caption".
- runner.message: the text, or one user message with the image block and the text; runner.run(image=), turn.Turns.chat(image=).
- Tests (tests/test_photo_messages.py): the gate's rules for photos in a group and a private chat, a pdf dropped and said; the AI given the picture and its caption; a photo that cannot be fetched is said; the SDK message. test_intake, test_voice_messages and test_prompt_cache updated from "a photo is not a message". Each shown red with the old behaviour.

## 0.6.116 (10 October 2026)

The villa's status, given, not fetched (owner, 2026-10-10: "what's the status of the villa now?" answered "everything ok" with three Shelly pump devices offline; the run made one HA MCP call and never ran concierge.py status):
- skill.yaml before_answer: a command of the skill's own (checked as every hook), run by the engine before each conversation turn (not a Continue); its "text" heads the message, or a line saying the check could not run (app.before_answer).
- villa-concierge: before_answer "concierge.py status". status names each offline device once (knowledge_pack.device_of; a device HA knows nothing about left out), every open problem and alert by title (lists cut at 12 with "and N more"); red for a critical device, lock or alarm, amber for anything else offline, on watch or open, green only with nothing. It listed offline sensors as "Watch" cut at 6, open problems as a count, and stayed green with a problem open. SKILL.md: answer status from the check, "everything is fine" only on GREEN, name every item.
- Tests (tests/test_villa_status.py): devices named once, a problem never green, problems named; the check heads the message, a failed one is said; the starter skill declares it. Each shown red with the old behaviour.

## 0.6.115 (10 October 2026)

Architecture review 16, candidates C and E:
- state.KV_FAMILIES: every named record family with its lifetime (RECORDS: pruned with the records; CURRENT: one per thing); prune walks it. saved_by_model:, owner_told: and hasent: now go with the records (saved_by_model: was one row per file per run, forever); claim_job_slot writes its date. A pending approval goes once expired and past the records' limit (it stayed forever); sessions go by the conversations' limit (prune sessions_before, housekeeping passes it).
- state keeps listening_since once (from the oldest record at first start); agent_records.listening_since reads it before min(at), which housekeeping moved forward each night.
- Skills.verdict (OWN / GONE / SAME / UPDATE / EDITED), read only: update_starters and release_state judge by it; Skills._replace is the one two-rename replace (name.old aside), used by update_starters and take_release; Skills.recover, at start only, brings back a skill cut mid-replace and trashes a leftover name.old. take_release trashed the folder before renaming the new one in.
- Tests: every family written has a declared lifetime and a date, prune leaves only CURRENT ones and removes the five that piled up; listening_since survives housekeeping; take_release stopped after its first rename, and after both, never loses the skill; the page's verdict moves nothing. Each shown red with the old behaviour. tests/test_housekeeping: an expired pending approval now goes, one within its time stays.

## 0.6.114 (10 October 2026)

Architecture review 15 (the agent's edges), candidates A, B and C:
- telegram.layout: one message as Telegram calls (photo or file first, caption at most CAPTION, the rest in parts, the buttons on the last part, also with a file; the reply on the first). Telegram.send follows it and returns every message id; a failure carries the ids that arrived (TelegramError.delivered). tests/telegram_fake follows the same layout (it kept one id and the buttons the real one dropped).
- messaging.split_message keeps the order and cuts between paragraphs, else lines, counting Telegram's UTF-16 units (tg_len): a paragraph longer than a message went out before the text above it, cut mid-line.
- Delivery.send remembers every part (a reply to the first part of a long answer in a group was dropped), and a partly sent message counts as sent (Delivery.reply sent the whole answer again with NO_PICTURE).
- Delivery.edit / delete / toast: the one way to Telegram for a message's whole life (plain_text, fit between lines); IncidentThread, ChatJobs and the button presses use them. IncidentThread.close shortens the alert's own text to keep its note whole.
- AlertButtons.press: one press per incident and chat at a time, none on an incident the chat shows settled ("Already answered.").
- Tests (tests/test_telegram_messages.py): order and lines, Telegram's count, buttons with a file, every part remembered, a partly sent reply not sent again, an edit keeps its note and its plain text, a double tap answers once. Each shown red with the old behaviour.

## 0.6.113 (10 October 2026)

Architecture review 16, its defects:
- Skills.all claims an AI job's name by the villa's own switches whatever the reader (include_off): a switched-off skill claims no name and is refused for none. 0.6.112 judged it on the reader's `off`, so the page's reading let a switched-off copy that sorted first knock out the live skill (page, Offline Test, setup copy), and each page read flipped the load log.
- skills.out_files / take_run_file: the Offline Test offers the files of the last ten report runs (runs/NAME-TIME/FILE, labelled with the report and the time) beside the out folder's own; a chosen one is copied into the out folder, where the test runs, and checked as every file argument. ui.server._out_files returns {value, label}.
- create_ticket no longer logs `executed` itself: tickets.create does (each AI ticket was two actions on the Overview).
- Tests: a switched-off copy sorting before or after the live skill; the run files offered and copied, never outside out/runs; one action per ticket. Each shown red with the old behaviour.

## 0.6.112 (10 October 2026)

Architecture review 14 (one AI turn), all six candidates and the owner's rule on tools:
- turn.Turns: chat_terms / job_terms decide a run's tools, brain (policy.PROFILES), limit and record once; each turn gets its folder, the runner takes tools.Kit (server, names, tool objects) and turn.Terms, and returns into one TurnResult (answer, photos, problem, limit). The owner is told by the turn when no retry helps. runner.run had eleven parameters and chose the brain itself; Settings.reply_limit_usd was read in three places.
- Who asks decides (owner, 2026-10-10): tool_access.allowed_for(policy, tools, role, chat), SYSTEM for a scheduled job; Origin.role carries who asked a job (start_job, ChatJobs.start). allowed_for_person / allowed_for_job / blockers removed: a skill's tools list limits and stops nothing; tool_access.unavailable says what a run lacks (read_skill tells the AI; health gives "without", ok stays true; the page shows "Works without a tool"). The job_only refusal sends the AI to start_job only when the run has it.
- One folder per run: config.Settings.in_folder (run_folder); ai_jobs.run_folder for a job and its on_limit / without_ai steps; out/chats/ID for a chat. Outcome.carry_out(folder=) for attachments; save_file's guard keyed by folder and name.
- One running record: ChatJobs.held for a scheduled job, where it sends. Skills.all refuses a skill whose AI job name another skill (or itself) already declares.
- tests/ai_fake.FakeAI: the run's record has call(name, args) through the run's own tools, refused when not given; tests use it instead of a hand-built toolbox.
- Tests: two reports at once in two folders; a run's terms by who asks; the facility manager's report cannot use a tool refused to them; a scheduled report asked for meanwhile runs once; a duplicate job name refused; the start_job redirect only with start_job; a skill works without a switched-off tool and the AI is told; what a skill lacks judged on the run's own tools. Each shown red with the old behaviour.

## 0.6.111 (10 October 2026)

Architecture review 13 (the skills' data path), candidates 1 to 6:
- One device name: KnowledgePack.device_name (device_of's name, the asset's name for a row without a device, the caller's words for an entity the pack does not have). The step / run / battery clues, the equipment cards, the trend charts, the counter resets, the mutes (once each), the to-do list's and the digest's subjects, roi-energy's loads and pumps. features.device_key stays the night check's stored finding identity (no migration; nothing compares it with device_of).
- One "running": vesta_shared.daily.running_threshold / power_days (a fraction of the typical peak, capped by the baseline helper, the floor without data; no floor asked when nothing peaked). nightly, energy_period and filtration_optimiser ask it. The weekly page's own 15 W (reports.yaml pump.run_min_w) is unchanged: moving it is a skill-file change. facts._best_split asks stats.step_index; facts.daily_kwh reads daily.energy_daily_features.
- One "new / still open": Problems.since(day). compose.fm_daily takes New and Still open from it (it read closed findings as new and listed a noted alert twice); owner_weekly counts alerts apart from maintenance problems.
- One way to the settings: facts.Ctx takes script.Context.params. params.tariff raises MissingParameter(villa_currency) instead of defaulting to one villa's currency; filtration_optimiser has no --asset default (filtration_pump: the "_pump" asset whose pool volume is set, the only one, or each one's missing helper named) and says a missing tariff with the rest.
- Written once in vesta_shared.result: PARAM_MISSING, COUNTER_RESET, finding_detail / finding_name (rules.py writes them; facts, proposals and nightly read them).
- reports/scripts/playbook.py: the clues and the one list moved out of facts.py (facts.py 1,008 → 685 lines).
- Tests: device names on every page; the threshold's cap, floor and no-floor; no script keeps its own threshold; the step detector against noise; the digest's new / noted / still open and the owner's counts; the currency, the pump choice, the settings' way in; every field the page prints exists; the rule ids written once. Each shown red with the old behaviour.

## 0.6.110 (9 October 2026)

Architecture review 13 (the skills' data path), its three live defects:
- facts.s_equipment compares the to-do list's devices by the one identity (knowledge_pack.device_of): since 0.6.109 it compared them with the asset slug and no card reached "Watch" through the to-do list (a regression of review 12).
- The night check prints result.FAULTS_CHANGED (new, still open or closed findings), the key app.run_code_job reads to repair the Kiosk's faults; it read new_findings / still_open / closed, which the night check never printed.
- facts.battery_pct: a battery's charge from its reading, % as it is, volts against its nominal; clue_battery_trend and s_batteries both ask it (the clue read 3.0 V as 3 %).
- Tests: a card watched through its device, the night check's printed key and the engine reading it, a volt cell's clue in %; each shown red without its fix.

## 0.6.109 (9 October 2026)

Architecture review 12 (the chat path), all five candidates:
- incident_thread.IncidentThread: what each chat shows of an incident, one record per incident and chat (state.incident_message; the incmsg: and inclast: families migrated at start, inclast: was never pruned). post / adopt / close; AlertButtons keeps keyboard and press. outcome.carry_out settles before it posts: "Need help" had taken the owner's new buttons away the moment the escalation arrived (live defect). The hasent: clean-up is one delete, not a scan on every write.
- chat_jobs.ChatJobs owns a job asked for in a chat: its turn (turn, replied, called by app._converse), its waiting message (JobNotices keyed by turn: a failed reply no longer lets the next answer be taken for it, two jobs from two turns no longer share one), one "typing…" loop per chat started once the conversation's reply is out, and its result told by name (routing.Origin.job, Delivery.on_job_result). Delivery only sends. start_without_ai has the 60 s "just started" window too.
- KnowledgePack.device_of: one device identity for every report section (the to-do list, the offline table, the batteries).
- compose.say: the one way a sentence reaches the report page; text already made for the page is kept, never escaped twice.
- Tests: Need help keeps the buttons, a second close changes nothing, records pruned, the migration; each turn its own waiting message; the to-do list, the offline table and the batteries name one device; every sentence of a to-do line shown once, linked once. Each shown red with the old behaviour.

## 0.6.108 (9 October 2026)

- reports: the monitoring table, the offline count and the "devices offline" line list DEVICES (owner: "only devices, not entities related to a device"). facts.Ctx.offline groups offline sensors by Home Assistant device: its name (the owner's first), the earliest time a sensor went, critical if any is. A sensor with no device keeps its own row; a device Home Assistant knows nothing about (no name, maker or model: a phone seen on the Wi-Fi, the "RX"/"TX" rows) is left out; one with no name but a maker or model shows as "Unnamed <maker> <model>". KnowledgePack keeps the devices (devices, device_label) from the registry already fetched. app.pack_needs_build rebuilds at start a pack built before devices were kept (format change, its migration). Tests: one row per device, nameless left out, an old pack groups nothing; the migration (each shown red).

## 0.6.107 (9 October 2026)

- "typing…" every 5.5 s (delivery.TYPING_EVERY_S). Measured on 9 October: at 4.4 s apart (group, 16:47) Telegram Web showed it with long gaps; at 2.4 s apart (private chat, 17:26, 24 of 24 accepted, longest gap 2.5 s) it never showed. Every signal was accepted both times, so one sent while the previous still runs is not passed on; 5.5 s sends each just after the last has ended.

## 0.6.106 (9 October 2026)

- start_job answers with the report's start time (ai_jobs.AiJobs.start, ChatJobs.started_at). A report started under JUST_STARTED_S (60 s) ago is "started now" even when asked again: the model called start_job twice in one turn, the second answer said "still running", and the group read "Still in progress" for a report that had just started. Later on, the answer says when it started. test_jobs pins it (shown red without the window).
- "typing…" every 2 s (delivery.TYPING_EVERY_S, was 4). The log at 16:47 had 30 of 30 accepted, evenly spaced (longest gap 4.4 s), while Telegram Web showed long stretches without it; tried at the owner's request, with no promise of how Telegram displays it.

## 0.6.105 (9 October 2026)

- The log covers a report asked for in a chat from end to end: "Message received in chat …" when the message reaches the agent (app.handle_message), and at the job's end every "typing…" with its time, how long Telegram took when over a second, refusals, and the longest gap (delivery.typing_timeline). Owner, 16:21: "no signal at all from a certain point", while the log said only "sent 34 times, 34 accepted", which cannot tell an even spread from bursts. Code checked: Home Assistant reads and skill scripts run in threads (asyncio.to_thread), so they do not stall the loop. Test: the timeline and its longest gap (shown red with min for max).

## 0.6.104 (9 October 2026)

- test_reports: HTML-like text the AI writes in a report (an unclosed tag, a script) shows as its characters and breaks nothing; the links stay one each, opened and closed. Shown to fail with the escaping switched off. Owner, after 0.12.109's changelog turned blue: "I want to make sure the reports will NOT have this issue".

## 0.6.103 (9 October 2026)

- reports: a check and its question showed the raw <a> tag (villa, 15:56). note() returned an already linked text, and the template's sentence() made it a string again, so it was escaped a second time. Now note() returns the text as written and sentence() makes the links after the words. test_reports renders a "Do this week" check and its question; with the old code it fails (the cache cleared between runs: a mutation and its restore in the same second left a stale .pyc that hid the result).

## 0.6.102 (9 October 2026)

- reports: every web address in a reading or a check is a link (compose.linked: escaped around it, a quote or angle bracket ends it, a closing full stop or bracket is not part of it; opens in a new tab; style a.src wraps on a phone). The reports skill lists web_search, and step 3 of SKILL.md asks for one search per line whose check repairs, replaces or adjusts something (the owner's wording, 2026-10-09). test_reports pins the links (three mutations shown red); test_tool_access expects web_search for a report while it is switched on.
- delivery.py: a chat job's "typing…" loop says at its end how often it was sent and accepted, and when last (villa, 15:27: it vanished before the weekly report came).

## 0.6.101 (9 October 2026)

- delivery.py logs each step of a chat job's waiting message (job asked for, the reply recorded, the result, the delete or the edit), with job_notices.JobNotices.describe. Villa, 15:03: a weekly report asked for in the group arrived and "on its way" stayed, with no delete tried; the notice lives in memory only and the case did not reproduce with the test stand-ins (private chat and group). Instrument only: no behaviour change.

## 0.6.100 (9 October 2026)

- One message per incident per chat (owner). alert_buttons.AlertButtons.replace: a message with an incident_id is sent, then the incident's earlier messages in that chat are deleted (state inclast:*); one past Telegram's 48 hours is edited to a pointer. adopt: Home Assistant's own messages of the run (ha_events now listens to telegram_sent; every event's context id travels as data["_context_id"]; state.note_ha_sent / ha_sent, kept 24 h) are rewritten and tracked under the incident. outcome: new key ha_messages (vesta_shared.result.ha_message); two messages of one result for one incident and chat keep the one with the buttons. vesta_shared.messaging.incident_tag / incident_message: the one layout ("Incident #N · status", the original alert, what to answer). alert-desk: every message through desk.about (the original alert and what to check repeated), escalations and the owner's messages carry the buttons; reports' digest lists "Incident #N · …". tests/test_one_message_per_incident.py (each check shown to fail by a mutation).

## 0.6.99 (9 October 2026)

- Prompt cache: app.system_prompt no longer carries the clock (it changed the cached prefix every minute). runner.with_time puts "[Villa time: …]" at the head of every message (chats, Continue, AI jobs). tests/test_prompt_cache.py: the instructions are identical at two different times (checked to fail with the old line), and every run sends with_time.

## 0.6.98 (8 October 2026)

- places.py: a title may carry a {slot} ("When the {skill} skill runs"). places.title(key, **names) and core.place(k, names) fill it, or drop it with its space, by the same rule. aboutSkill names the open skill. test_ui pins.

## 0.6.97 (8 October 2026)

- viewer.fileViewer: "View" / "Edit".
- skills.js: the CSS `order: -1` that moved the open file first is removed; fits() unfolds the list when the open file is off its first line (checked again once fonts load and after the file loads).
- skills.js: show(name) moves the highlight and opens the pane without redrawing the list; a skill's switch reopens the skill open now. test_ui pin.

## 0.6.96 (8 October 2026)

Ninth architecture review: all six candidates and the live defects.
- Live defects:
  - An unparseable policy.yaml made api/jobs, api/overview and api/skills answer 500, and Rules (file) hung (fixed: changes.page_policy, and the file view asks for the file only).
  - Keep mine had no catch.
  - Stale words ("The AI", "only the devices in the lists", "allowed lists", "Try a command" in docstrings).
  - Page copies of server facts ("WebSearch", "not recorded", the verdict words, which files may be deleted; the server allowed deleting SKILL.md and skill.yaml).
- 1: GET api/rules returns the Rules tab in one answer. core.go shows a failed tab's reasons. page.PROFILES is gone (each tab keeps its own).
- 2: places.ORDER and core.inOrder (the Rules section order is data). Code-shape test pins replaced by data, HTTP and Node tests.
- 3: viewer.fileEditor (one editor for both). rules.openTools (the skill page no longer writes Rules' tab keys).
- 4: dead CSS removed and duplicates merged. AI and roles column widths are data (core.table {width, cls}); no nth-child column rules. test_ui fails on an unused stylesheet class. Measured identical before and after on a laptop and a phone.
- 5: setup_copy.offer, policy.ROLE_WORDS, history.CHIPS, places.TABS (index.html filled by the server), core.api({file}) for the export.
- 6: ui/changes.PageFiles holds the write, check, record and Undo code, moved out of the HTTP class; setup_copy.apply takes PageFiles.

## 0.6.95 (8 October 2026)

- core.cell: a labelled cell (paged) with several pieces wraps them in one span.cell-v, so the phone card's "label … value" keeps them together. Checked on all 48 phone cells: only the 3 "What runs" cells moved.

## 0.6.94 (8 October 2026)

- static/viewer.js: the one file viewer, `fileViewer(ta, path)` returning {toggle, box, show}. Rules (file) and Skills › Files both use it. Markdown is drawn by markdownView (moved from skills.js), YAML by yamlView.
- static/yaml.js: `lines(text)` turns each line into pieces (indent, comment, dash, key, colon, number, switch, quoted text, value). A `#` inside a word or quotes is not a comment, and the pieces join back to the exact text. No HTML string is produced.
- page.fileView replaces page.mdView. test_ui: the tokenizer is run in Node on policy.example.yaml (lossless) and on edge cases, checked with two mutations.

## 0.6.93 (8 October 2026)

- static/markdown.js: `parse(text)` turns Markdown into plain blocks (front matter, headings, paragraphs, nested lists, tables, fenced code, quotes, rules; inline code, bold, italic and links). HTML comments are dropped and no HTML string is produced. skills.js `markdownView` draws the blocks with core.h, tables with core.table, and opens a link only when it is an http(s) address. Nothing is fetched.
- Files: a .md file opens Formatted by default; core.segmented gives the Formatted / Raw switch (styled like the theme switch); page.mdView keeps the choice.
- test_ui: the reader is run in Node on real input (it fails, never skips, without Node; checked with two mutations), plus a pin on the Files view.

## 0.6.92 (8 October 2026)

- skills.js `takeReleaseButton(name)`: one button, drawn by the release banner and the Compare tab (the banner is hidden after "Keep mine", while the Compare tab still described the button). test_ui pin; checked in the browser with a kept edit.

## 0.6.91 (8 October 2026)

Eighth architecture review: the page draws the agent's verdicts.
- server.undoable is the one answer for Page changes and Undo; history rows carry `undoable`. Fixed: Undo was hidden for instructions.
- status.figures and FAILURE_KINDS: `last_24h.figures`. Fixed: action_failed was not counted; script_refused (a refusal) is still not a failure.
- tool_access.health `line` for the skills list. tool_access.switch_on with POST api/tools/on, and POST api/jobs/missing: the page no longer reads, changes and writes the whole form.
- policy_doc: the form gives agent_tools and tool_access.fm as true/false switches, web search included. apply_form writes the file's own shape back; the file written for an unchanged form is byte-identical to before.
- skill_detail `acts`: rows of {when, job, script, kind[, note]} in display order (no "when — job" sentence, no "AI job" magic value).
- Tests through HTTP (test_page_controls): each new rule went red under a mutation.

## 0.6.90 (8 October 2026)

- rules.js: the AI tools card after AI brains and limits (owner). test_ui pin.

## 0.6.89 (8 October 2026)

- places.py: skill_when / skill_commands / skill_tools renamed "When the skill runs" / "Skill commands" / "Skill tools" (owner).

## 0.6.88 (8 October 2026)

- Starter skills (asked for by the owner): villa-concierge SKILL.md says "Rules › Allowed actions"; the reports and villa-concierge skill.yaml comments say "Rules › AI tools". Both recorded in shipped-skills.json. test_ui's old-names guard now covers starter/.

## 0.6.87 (8 October 2026)

- vesta_agent/places.py: one name per place on the page (title, and where it sits). The server writes the table into index.html as JSON; core.js `place(k)` / `where(k)` read it. policy.FIELDS section words, tool_access's "why", the history and setup_copy use it as well. Renamed as listed in the app's changelog.
- Rules › AI tools: the Home Assistant tools count/source and the roles paragraph are now tab (i)s (tabbed's info; the count is worked out when the (i) opens).
- test_ui: no multi-word place title and no "Tab › …" sentence is typed by hand in the page code, and the old names are gone from the code. Checked to fail with both kinds of mutation.

## 0.6.86 (8 October 2026)

- DRY pass on the page, as the owner asked. core.table / cell / tableRow build every table: paged, editTable, Rules' AI and roles tables. core.tabbed builds every tab section: Costs' tabbedCard, setupCard, toolsCard and aboutSkill. Its open tab is kept in page.tabs (it replaces costTabs, setupTab, page.toolsTab and aboutTab).
- A skill's "When" list is now paged(["When", "What runs"]); `.kv` is removed.
- Dead CSS removed: .spaced, .tool-row/.tool-text, .cmd-row/.cmd-text, .try-row/.try-go/.try-preview, .files .special.
- Phone fixes: the roles table's column widths, and the AI table's cells can now shrink. test_ui: a test that every table and tab section comes from one builder (checked to fail when one is built by hand).

## 0.6.85 (8 October 2026)

- skills.js tryPanel: no code subtitle, no "Options" heading; the popup title is "Offline Test · <script> <command>". test_ui pin.

## 0.6.84 (8 October 2026)

- skills.js aboutSkill: "When" is its own section on top; the tabs are Commands (with the switches' (i), via subTabs' info) and Tools; Commands first, absent for a skill without scripts. test_ui pins.

## 0.6.83 (8 October 2026)

- Log lines name the app setting by its label, "Agent replies on Telegram" (the option key stays `telegram_takeover`).

## 0.6.82 (8 October 2026)

- core.toggleCard `action`: a button in the card head left of the switch (`.tool-card-side`); the Offline Test pill moved there, "Offline " hidden by `@container (max-width: 300px)`. core.popup focuses Close (`autofocus`): showModal focused the title's (i), whose focus opened its tip. app.css `.about > * {min-width: 0}`. test_ui pins.

## 0.6.81 (8 October 2026)

- skills.js: the Try tab removed; `offlineTestPill` on each command card (and on a whole-script card) opens `tryPanel(name, d, script, command)` in `core.popup`, with no script or command choice. About opens with `subTabs` of when/tools; the tools are `core.tileCard` cards (toggleCard builds on it); renames live in `ABOUT_TEXT`.
- core.js: `floating` attaches a panel inside an open `<dialog>` (the top layer), so a tip or a list in a popup is drawn above it. test_ui pins.

## 0.6.80 (8 October 2026)

- costs.js: the per-day chart's viewBox is the card's pixel width (no stretch); axis text 12 px. test_ui pin.

## 0.6.79 (8 October 2026)

- app.css .skills: the list column 280 → 364 px (test_ui pin).

## 0.6.78 (8 October 2026)

- app.css --page-width 1650px (was 1100, four places). costs.js tabbedCard (subTabs, tab kept per page life): By work/By model, Every run/Tools used.
- scheduler.job_key (the stored slot key, unchanged) and job_label (AI job name, skill › script, engine words); status.report(label=) → scheduled_jobs[].label; overview.js and the agent_status tool show it. Tests.

## 0.6.77 (8 October 2026)

- skills.js About › What the AI may run: no flag chips on a whole-script card; the explanation is the title's withInfo (i). test_ui pin.

## 0.6.76 (8 October 2026)

- costs.js madeWithoutAi: the (i) before the chip, aligned with alertButton's (!) (test_ui pin).

## 0.6.75 (7 October 2026)

Seventh architecture review (all candidates):
- vesta_shared.result (message/fault/fault_note/resolved/snapshot/settle/siren); desk, nightly, compose, problems and tickets.repair use it; outcome reads a message's incident_id (no "#N" regex) and an armed gate's prompt goes to gate["to"] when no siren is configured (no text-equality drop).
- vesta_shared.script (arguments, Context: client / live_client / pack / store / settings / params / zone / Z / now / day; of()); nightly, energy_period, filtration_optimiser, proposals, facts, compose, desk, concierge, voice; desk drops --helpers / --villa-mode (fixture dir), intake takes zone; no store made unasked.
- vesta_shared.skill_settings (load/merge/behaviour); params.BEHAVIOUR_DEFAULTS and behaviour_text_default removed; VillaParams.defaults / with_defaults, behaviour() raises MissingParameter; behaviour sections in alert-desk/rules.yaml, preventive-maintenance/settings.yaml, roi-energy/settings.yaml (+ proposals thresholds); facts.load_cfg via skill_settings, alert_blueprints from reports.yaml alert_words; compose names a missing todo.group_from.
- Problems.record_night (+ worsened, closes_tonight); features.integration_down pure.
- Page: api() always gives problems (UNREACHABLE, session ended), core.reasons, saveWith (rules ×2, skill file).
- Host selftest._sse_events by the SSE rule; tests/sse_samples.py run against both readers.

## 0.6.74 (7 October 2026)

Sixth architecture review (all candidates):
- siren.Siren: Actions(executed=) hook on every execution; stop time in State (siren:stop_at); watch() task in main; app.after_execution removed. Tests: direct path, restart, wrong entity, failed stop.
- ai_jobs.AiJobs: run / start / start_without_ai / run_without_ai / find / without_ai_able; not_set() one wording; app wires it (scheduler, toolbox start_job, ai_down, the press).
- intake.gate (pure: drop / whoami / unregistered / new / converse) and intake.resume_for (tested for the first time); button_data (APPROVAL/CONTINUE/ALERT/REPORT make/read, FOR_PEOPLE_ONLY), handle_callback a lookup + Press; policy.NOT_REGISTERED (actions said "VESTA" alone).
- agent_records holds RUN, COSTS_KINDS, who helpers, without_ai(), detail(); vesta_agent/run_records.py removed; status reads rows through detail(); state.prune keeps COSTS_KINDS on the runs' limit; runner does not record a retried resume that did nothing.
- problems.close_incident / close_finding (state decides; returns ticket.resolve actions); desk.py resolved/reply(done, mute)/recovered and nightly use them.
- ui/server: text_change(base_rev=) checks version (_check_rev) and kind (_check_text: rules problems, .py compile, YAML) for every write; rules_problems() one reading; tool_access.health for the list and the skill page.
- ChatJobs keeps its tasks; idle(); tests await it instead of polling.

## 0.6.73 (7 October 2026)

- agent_records.run_cost: a record whose token counts (input and output present) are all zero cost 0.0 — read side, so past records are corrected; runner records and logs the same figure. Records without counts keep theirs.

## 0.6.72 (7 October 2026)

Fifth architecture review (all candidates):
- chat_jobs.ChatJobs: one lifecycle for a job asked for in a chat (running set, job_started, job_waiting, Origin JOB, job_ended in finally); app._running_jobs and _requested_job removed; the press passes waiting_mid (no startswith("Making")).
- job_steps.run: on_limit (now a one-step list from skills._without_ai) and without_ai run alike; routing.job_to replaces 4 copies.
- ai_down.offer / keyboard (pure) + api_errors.AI_DOWN; tool_access.may_start_job for offer and press (the press checked only "registered").
- redact.scrub, the one scrubber (runner._scrub removed; runner.kept_steps); run_records (who for job/person, without_ai record).
- facts.Ctx: incidents, ha_alerts, rule_states, hourly_means read once per run; running_power/_days_power on hourly_means. energy_period keeps the named main meter for its asset; an unknown one is a note, not a KeyError.
- KnowledgePack.row / name_of replace six hand-written walks (app, facts, compose).
- UI: check_skill, folder_change, policy_now, save_policy, text_change public; setup_copy uses only public methods (test).
- actions: a state in ON_ITS_WAY is read again (up to 5 s) for one device too.
- compose.py: mode (ai / limit / no_ai) named once; --finish without --out, --no-ai/--since/--limit without --finish, and a chat text's --finish without --no-ai are refused.

## 0.6.71 (7 October 2026)

- report.html: `.asset` align-content:start + min-width:0, its pill justify-self:start, `.wrap` overflow-wrap:anywhere; proposals say "To answer, write in the chat: accept N…" (no fake buttons); P1/P2 tasks say how they leave the list; detail/benefit as sentences.
- preventive-maintenance: PM-PARAM-MISSING detail carries the asset's name; roi-energy proposals title the missing setting by it ("Create the missing setting for …").

## 0.6.70 (7 October 2026)

- AI down: the report buttons are offered only when the message shares a word (4+ letters) with a report's `button` — the skill's words.

## 0.6.69 (7 October 2026)

- FIX: a job started by a `w:` button registered no reply, so JobNotices kept a done notice and deleted the next conversation reply. Delivery.job_waiting makes the pressed message the waiting message (test, mutation-proven).

## 0.6.68 (7 October 2026)

- AI down: a message naming exactly one report by its `button` words starts start_without_ai directly (no keyboard); the `w:` press edits its message (text + what is being made), which removes the buttons.

## 0.6.67 (7 October 2026)

- converse: on an AI-down problem (api_errors.NO_RETRY), a person with start_job gets one button per on_request job with without_ai that policy sets up (skill.yaml `button`, callback `w:<problem>:<job>`); handle_callback `w:` → start_without_ai (registered presser, not twice per chat, job_started/ended, "could not be made without the AI either" when nothing was sent).
- telegram.typing returns whether Telegram accepted it; Delivery logs the first acceptance per answer (INFO).

## 0.6.66 (7 October 2026)

- test_jobs: the typing test waits for the job's run to end (an Event, 10 s) instead of a fixed 0.15 s sleep — CI was slower and 0.12.70 failed there.

## 0.6.65 (7 October 2026)

- Reports without the AI: skill.yaml AI jobs take `without_ai` (code steps in order; `{skill, run, on_schedule_only}` for another skill's script, checked when it runs). app.run_without_ai runs them on any LLM problem, each needing the one before (a stale file never stands in), carries out what a step sends, logs a `without_ai` record; for_job is sent only when nothing was. compose.py `--no-ai WHY` (with --finish): page banner, message note, an old notes.json ignored; fm-daily / owner-weekly gain a --finish send path. status.costs lists `without_ai` rows (cost 0, outside runs_count and the groups); costs.js shows them. api_errors.why_job / why_job_sentence.
- Kiosk tickets follow their finding: Kiosk.held_tickets / update_ticket (title + an update entry), _edit skips a no-op PUT; tickets.repair updates open titles from problems.current_title; run_code_job repairs after a night check that changed findings.
- Costs: a failed run is core.alertButton (!) with api_errors.FOR_PERSON words and the raw error; infoTip takes a kind.
- compose.py charts: one `_tip` per point/bar/day (title + hover/focus label, no script).
- alert-desk: the repeat count's "since" through timeutil.day_time_label in the villa's time.

## 0.6.64 (7 October 2026)

- FIX (regression from 0.6.62): skills.injected() named the declaration and the argument list both `inject` — every script ran without --pack/--store/--zone. Test drives the real list and a real script. script_run: exit 2 with an argparse usage error is "stopped", not "nothing to do".
- Fourth review 1: knowledge_pack classifies by platform (mobile_app: a person's device; router integrations: network) — NOISE_PREFIXES with one villa's devices and a person's name removed; night-check thresholds into params.BEHAVIOUR_DEFAULTS (worsened takes its step).
- Fourth review 2: vesta_shared/device_state (is_offline: unavailable only; battery_charge by unit, V against nominal); facts.py uses it and Ctx.params() (live_params); report template shows volts; rules.py uses battery_charge.
- Fourth review 3: timeutil.villa_time / villa_date (UTC → villa; naive = UTC; dates kept); facts.offline "since" in villa time, kpis/kpis_month and compose's day comparisons through villa_date; ha_client.paged() — one paging rule for statistics, history, logbook.
- telegram.typing logs a refusal as a warning, once per 10 min per reason.

## 0.6.63 (7 October 2026)

Third architecture review, all six candidates, and two owner reports:
1. `policy.read_policy(raw) -> (values, problems)`: one pass; Policy and problems() both read it. Fixes: list-shaped allowed_services / system_actions crashed Policy() (every reply and job); reply/job limits as text, unknown chat roles, tool_access.owner, repeated person ids (first wins), refused service lines are now the default/absent; siren_entity lower-cased and checked; a protective device list written as text still protects (named). check_service(system=True) allows the configured siren's turn_off. test_policy_agreement +5.
2. `vesta_shared.params.live_params(client, store, max_age_minutes=10)`; alert-desk reads it (no --helpers in production before: params None, maintenance_mode never read); the desk's literals come from BEHAVIOUR_DEFAULTS.
3. villa-concierge: propose/execute/readback and catalogue.yaml removed (unreachable); SKILL.md "Acting" is ha_call_service; SKILL_PREFACE's concierge clause dropped; test: a SKILL.md never names a `script.py command` the skill lacks.
4. `store.Incident` (states, CHASED, ANSWERED_OR_CLEARED) used by desk/problems/compose; Store.finding / set_finding_detail / prune_features / pack_seen_empty replace raw SQL in nightly, problems, housekeeping, build_pack; guard test.
5. Scheduler: start key = claim key (two jobs at one time both run); housekeeping hook started beside the tick. runner: the lost-session retry passes `asked`. State: kv gains `at` (migration dates existing rows), prune removes inc:/incmsg: with the other records.
6. release.py: GATES carry their lane; test_release holds every gate whose test file uses the sidecar port to "sidecar".
Owner: start_job keeps (chat, job) running and answers "still running" (the AI had answered from memory, nothing started); Delivery keeps "typing…" in the chat while a requested job runs (stops at its result or end).

## 0.6.62 (7 October 2026)

Second architecture review, all five candidates:
1. `policy.FIELDS` (+ RESET_WORDS): sections, labels, form/setup membership; SECTIONS, FORM_KEYS (form_sections), setup_copy AI_SETTINGS/TOOL_SECTIONS/ACTION_SECTIONS (setup_fields), history.WORDS and the page (schema words/resets) derive from it. Label drift fixed (history vs page). test_policy_fields.
2. `skills.Script` replaces the spec dict (commands, flags, inject, job_only, off_all/off; runnable, runnable_commands, view, switched) + `switch_command`; `_parse`/`_files` → public `parse_skill`/`skill_files`. test_skill_scripts.
3. timeutil: `day_label(weekday, long, year)`, `day_time_label(weekday, year)`, `villa_day(zone, as_of, last_finished)`; 7 hand-written "%a %d %b" removed (rules.py, compose.py, facts.py); compose's when() converts HA's naive UTC to the villa zone (facts carries "zone"); `vesta_shared/daily.py` (power/energy day features) — roi-energy no longer imports preventive-maintenance's scripts by path; 8 dead `_shared` sys.path lines removed. Starter skills recorded as shipped. test_one_day_format.
4. Tests: `helpers.make_agent` / `make_skill`; `ha_fake.FakeHA`, `kiosk_fake.FakeKiosk` (contract tests in test_fakes; test_telegram_fake's scan now sees handed-on methods too); 7 fixtures, 5 readers, 2 kiosks consolidated.
5. `tickets.py` (create/resolve/repair), `alert_buttons.py` (keyboard/remember/settle/press, LADDER), `outcome_words.py`; Outcome takes tickets + buttons (8 deps, carry_out only); `voice.py` (transcribe) out of app.py.
Page: `core.toggleCard` shared by Rules tools and Skills commands (`.tool-grid.three`); Tools-it-needs (i); Acting title order; ttl (i) after "min".

## 0.6.61 (7 October 2026)

Architecture review, the rest (candidate 5 and the leftovers):
- Page JS split into ES modules by tab (core, costs, overview, rules, skills; app.js the entry). Done by a TypeScript-checker transform: 77 statements moved verbatim, the 5 cross-module mutable lets (dirty, current, PROFILES, jumpTo, toolsTab) into `core.page`, `go` reads `page.views`; verified statement-by-statement and by name resolution (0 unresolved, mutation-proven), all tabs rendered with no browser error.
- `UI._text_change` / `_folder_change`: the only writers of page_history; Undo of policy, instructions and a skill's file is one rule (`TEXT_KINDS`). Fixes: imported instructions recorded as a kind Undo refused.
- `requests_box.try_request` / `try_of`: a try's payload checked by the page and again by the agent.
- `tool_access.saved_server_tools`: the saved list back in the server's shape (was rebuilt in ui/server.py).
- Import preview through `paged()`.
- Tests: `tests/ai_fake.py` FakeAI replaces 8 hand-written runner.run stubs (contract test vs runner.run); `helpers.page_js()` / `body_of()` read the page's modules.

## 0.6.60 (6 October 2026)

Architecture review candidates 1–4 (candidate 5, splitting the page's files, not done):
- `delivery.py` (new): every send, its failure verdict (id or None), photos/caption of a reply, "typing…", the job notices. Fixes: send_message answered "Sent." on a refused message; carry_out counted unsent as sent; a failed/blocked job asked for in a chat sent its reason AND its waiting message was edited (two messages) — its sends now carry the JOB origin and replace the wait. `Vesta.send` and `_job_notice_step` removed; Outcome and Toolbox take `Delivery.send(..., photo=, origin=)`.
- `telegram.py`: sendDocument/sendPhoto go through `_post_form`, failing as TelegramError like `api()`; one attachment per message.
- `script_run.py` (new): run + verdict (done/nothing/stopped) + scrub + JSON + one record (`script` / `script_failed`, with `by`) for the AI, jobs and the page; app.code_command, tools.run_skill_script and app.try_command use it; the page reads `verdict`. status counts `script_failed` (and old `code_script_failed`).
- `Toolbox.for_run(person, origin)` → (server, names): names read off the built tools; every tool built only when tool_access allows it; read tools computed once per Toolbox (no tool_denied row per call). `model_tool_names` / `server` removed.
- Tests: one Telegram stand-in `tests/telegram_fake.py` (4 copies removed), `test_telegram_fake.py` holds it to Telegram's interface; tests for each fix, each mutation-proven.

## 0.6.59 (6 October 2026)

- converse(): sendChatAction "typing" every 4 s (TYPING_EVERY_S) from the start of the run until the reply is sent (`telegram.typing`, failures logged at debug only).

## 0.6.58 (6 October 2026)

- UI Try a command: `outfile` flags as a text box (validated as for the AI: a plain name in the out folder); after a run the skill's `out_files` are fetched again so the next step offers the file.

## 0.6.57 (6 October 2026)

- UI: skill detail carries `out_files` (the out folder's files, newest first); Try a command offers `infile` flags as a menu of them (preselected: the file named after the flag), `outfile` still hidden. validate_script_args checks them as for the AI.

## 0.6.56 (6 October 2026)

- vesta_shared.store.raise_finding: no open row → the row of the same (rule, entity, opened_day) is reopened and updated (is_new False) instead of a UNIQUE crash; nightly.py reports an event rule as new only when is_new. preventive-maintenance recorded as shipped.

## 0.6.55 (6 October 2026)

- requests_box: `submit` / `result` (page polls GET /api/tries/<id> every second; POST /try answers {"pending": id} at once); the agent renames a request to <id>.taken.json and runs each as its own task. Cause: a 180 s page request outlived Cloudflare's 100 s (Error 524) on nightly.py. `ask` kept for refresh_tools.
- subTabs: [key, label, info] puts an (i) beside the tab (`infoButton`, shared with withInfo).

## 0.6.54 (6 October 2026)

- The model did not call send_message(camera=) (live, 20:19): removed. Toolbox.photos records every image a read tool returned in the run; converse() sends them (last 4, deduplicated) with the reply as the last one's caption; a refused photo falls back to the text. One mechanism, not chosen by the model.
- telegram.send: a reply longer than a caption (1,000) continues as text after the photo (was cut).

## 0.6.53 (6 October 2026)

- send_message takes `camera` (camera.*) when ha_get_camera_image is allowed for the run: the agent fetches the picture and sends it with sendPhoto, the text as caption; no picture or a refused photo is an error, never "Sent.". One fetch for both paths: `outcome.camera_photo` (also the alert desk's snapshot.get).
- telegram.send raises on a refused sendPhoto (was a silent caption-only message).

## 0.6.52 (6 October 2026)

- UI: settings.conversation_reset is named "Delete conversation context at" (caption, aria-label, history wording, export line).

## 0.6.51 (6 October 2026)

- UI: The AI's chat line puts the New conversation menu in a captioned cell (td.with-caption) aligned with the brain and limit. test_ui pins it.

## 0.6.50 (6 October 2026)

- UI: editTable takes `per`; the services table pages at 10 (owner). test_ui pins it.

## 0.6.49 (6 October 2026)

- UI (owner):
  - toolCard() in .tool-grid (4 / 3 / 2 / 1 columns) for both tool tabs, 16 a page.
  - withInfo() for headings and fields; infoTip takes a function (the month's ceiling at open). The (i) is sized in em.
  - The AI: New conversation on the chats' line; the notes are gone from below the table.
  - Acting: a title switch only. Approval minutes on the services card's title line.
  - The villa files option is reworded.
  - test_ui pins it.

## 0.6.48 (6 October 2026)

- UI (owner):
  - infoTip(), a floating tooltip on hover, focus or tap, replacing the inline text. titleWithInfo takes a right-aligned control (the Costs' period). tryPanel: no command preview.
  - DRY:
    - floating(): the one floating panel (body, fixed, flips above; closes on outside, Escape, scroll, resize), used by dropdown(), the device picker (whose absolute panel took a table cell's input rules) and the tooltip; focus with preventScroll.
    - subTabs(): the one tab bar.
    - paged() runs on pagedBlock().
    - The table input rule spares checkboxes and radios; search inputs share the input style.
  - test_ui pins it all.

## 0.6.47 (6 October 2026)

- skill.yaml scripts.<s>.description (optional), shown by the page; the roi-energy and preventive-maintenance starters describe their scripts (recorded).
- UI: jump() links from "set elsewhere" to the #rules-acting and #rules-services cards; flags as code chips.
- test_page_controls: the skill page follows a hand edit of skill.yaml (scripts, commands, flags, tools, schedule), and the page's code names no starter skill or script.

## 0.6.46 (6 October 2026)

- **UI:**
  - Services: a devices column (the picker for "listed", first service of a domain; "same list as" for the others); the Allowed lists card removed; RULE_WORDS "listed" reworded. editTable passes refresh to cells.
  - card() puts the lead behind an (i) (titleWithInfo), except in a card with no other content.
  - The Overview setup card has two tabs.
  - Costs defaults to 7 days (page and server) with period figures (total, runs, per run, busiest day).
  - tryPanel in three steps, with a preview of the exact command.
- **Retention, DRY (owner):**
  - skills.to_trash is the one way into skills/.trash, and stamps the folder's date. Used by delete, take_release, Undo and import.
  - carry_villa_files is the one copy of a skill's villa.* files (update_starters, take_release, import).
  - housekeeping._files_older(whole=True) trims the trash under files_days. The separate folder helper and the history row cap went: the page's history follows records_days like every other record.
  - Tests: the trash's dating (mutation-checked); the Costs default pinned at 7.

## 0.6.45 (6 October 2026)

- UI (owner): pagedBlock(), 15 lines a page (PER_PAGE), for editTable (People, the services) and the Reading Home Assistant list (flat, group heading repeated per page). Roles table: fixed layout, switch columns centred; Guest is "—" with the reason. test_ui pins the paging.

## 0.6.44 (6 October 2026)

- UI, Skills (owner): skillSwitch() in each list row (the row is now a div: an open button plus the switch). The pane has no title, description or switch on a wide screen (.skill-head hidden); the state pill is on the tabs' line (.skill-bar). On a phone (≤760 px) the head comes back with the name, pill and switch, and the bar's pill is hidden. test_ui pins it. Rules → The AI: the tools column is a <details> summary ("N tools from <skill>") instead of chips; columns are fixed width and top-aligned, the header reads "Limit (US$)"; on a phone the × sits on the brain/limit row.

## 0.6.43 (6 October 2026)

- UI, Skills (owner: "very messy", mobile):
  - openSkill is a head (name, state chips, switch), banners, then sub-tabs About / Files / Try a command / Compare.
  - aboutSkill(): .kv rows for the acts, .cmd-row switches for the commands, the tools' verdict with a folded list.
  - Files: dots in place of " · differs" labels.
  - Compare: shown() keeps changed rows ±2.
  - Phone (≤760 px): .skills.has-open hides the list, with "‹ All skills". ≤600 px: .kv stacks, the comparison is one labelled column.
  - test_ui pins the phone rule. Checked by screenshots at 1280 / 390 px.

## 0.6.42 (6 October 2026)

- tool_access.py: one answer to "what may the AI use".
  - **Rules:**
    - ha_read_tools, only HA MCP readOnlyHint (and not destructive). Before, only destructiveHint was refused.
    - agent_tools: create_ticket, start_job, agent_status; web search stays in settings.web_search.
    - tool_access.fm, by group; the facility manager's chat is capped at the facility manager's tools.
  - **Toolbox(allowed=...)** builds nothing else: allowed_for_person in converse, allowed_for_job in run_model_job (the skill's `tools` ∩ switched on + always-on; no `tools` → everything but web search, as before).
  - **blockers():** a needed tool the villa switched off. read_skill and run_skill_script refuse in words; an AI job does not run and tells its chat (state `job_blocked`).
  - **The page's list:** the agent saves HA MCP's list (ha_tools.json, first_seen → "New"), plus catalog() and needs().
- **Skills:**
  - skill.yaml `tools:`; `commands` may be {name: words}.
  - villa.skill.yaml off_commands, lenient, enforced by validate_script_args and listed by read_skill.
  - policy.yaml skills_off: Skills(off=...), all(include_off).
  - release_state / keep_mine (.kept.json) / take_release.
  - Starter skill.yaml files declare their tools and command words.
- **runner:**
  - Collector records each ToolUseBlock as {tool, input} (step(): short, secrets scrubbed, ≤ 40) in the run's record.
  - status.costs gives each run's steps and the period's tool counts; tool_usage(7 d) feeds the switches.
- requests_box.py: the page's requests ("try", "refresh_tools") as files the agent answers (the UI holds no token). Vesta.try_command validates as the AI's call and never carries out.
- history.py (page_history.sqlite):
  - Every UI save: policy (form or file), skill file, create/delete, on/off, commands, take-release, import. Starter updates are "Release".
  - policy_change() says it in the page's words.
  - Undo only while the target still holds the change's result.
  - Pruned with records_days.
- ui/server.py: /api/tools, /api/tools/refresh, /api/skills/{name} (detail), /on, /commands, /compare, /keep, /take-release, /try, /api/history (+ /undo), /api/setup/export, /api/setup/import.
- ui/setup_copy.py: export (skills, optionally villa.*, settings for the AI and keep, allowed_services, the tool sections, instructions.md). Never people, chats, entity lists, the siren, system_actions, notify_recipients, keys or records. Import is read() (paths checked), then preview() (added/replaced/changed/same, plus misfits: policy problems, listed services with empty lists, absent tools, blocked skills, unset jobs, fingerprint), then apply().
- Page (app.js/app.css): the What the AI can use card (three tabs), Tools it gets, the fuller Skills tab (switch, state, needs, acts, commands, Try a command, Compare with the release, 2C fix), Costs Tools used and tool table, Overview history/export/import. Checked by screenshots at 1280 and 390 px, light and dark.
- **Leaner:**
  - Removed with no caller: is_known_chat, read_tool_allowed, match_any, reply_keyboard, asset_number, feature_series, audit_rows, water_rules, days_back, timeutil.tz, release.init_version.
  - One reading each:
    - timeutil.local_day (features._day, facts._ms_day);
    - stats.slope_per_hour (facts' battery slope);
    - KnowledgePack.rows/read for the engine's names, related devices and the page's pickers;
    - Settings.policy() as the one policy cache (app.py's own gone).
  - FixtureClient → tests/fixture_client.py and replay.py → tests/ (no longer installed).
  - favicon.py → the reports template's <head>; telegram sends files as written.
  - Store rewrites pre-0.6.16 tasks once (source, check_text) and problems.py's second reading went. State.rename_job_runs rewrites "job:skill:when" runs once at start and status' job_names went. Pre-0.12.10 alert-message settle went.
- Tests:
  - New: test_tool_access.py and test_page_controls.py.
  - Old shapes updated: test fakes list tools with readOnlyHint; packs in their real shape.
  - 19 mutants red.
- Starter skills recorded.

## 0.6.41 (6 October 2026)

- API failures (api_errors.py): runner.Collector reads the SDK's three ways to fail (AssistantMessage.error with the raw "API Error" as its text — never the answer now; ResultMessage is_error/api_error_status; exceptions incl. ResultError). classify() → credit / key / rate_limit / busy / offline / too_long / unknown; FOR_PERSON words in the chat; NEEDS_THE_OWNER (credit, key) told in the owner chat at most every 12 h (State.owner_told); NO_RETRY: a failed resume is not retried for those. run_model_job: a failed job tells its chat (for_job) instead of logging "done". tests/test_api_errors.py, 4 mutants red.
- Housekeeping (housekeeping.py, policy.KEEP / settings.keep): runs 400 d, other records 90 d (calls, decided approvals, continuations, own_messages), CLI transcripts (claude/projects) 30 d, out folder 90 d, store features 24 months. At start and nightly after the pack. params' photo_retention_days / feature_retention_months removed (declared, never enforced); State.prune_own_messages folded in. policy_doc carries settings.keep through the Rules form (a save dropped it). tests/test_housekeeping.py, 4 mutants red.
- UI: ask() — a styled <dialog> for every confirm/alert/prompt; guard() async. tests/test_ui.py forbids the native ones, 2 mutants red.

## 0.6.40 (6 October 2026)

- UI: textarea.editor (Skills and Rules (file)) is white-space: pre-wrap + overflow-wrap: anywhere instead of pre (owner: no sideways scrolling). Soft wrap only, nothing added to the saved text. tests/test_ui.py pins it, mutation-checked.

## 0.6.39 (5 October 2026)

- Voice messages (owner, 2026-10-05): ha_events also listens to `telegram_attachment`; an audio attachment from a person the agent answers (private chat, or a reply to the agent in a group) is fetched with getFile (Telegram.download; only with takeover), handed to the skill hook `on_event.voice_message` (new HOOK_EVENT) with {audio, language}, and the WAV the skill returns goes to Home Assistant's /api/stt/<entity> (speech.py: the engine holds the token, a script never does). The text then reaches converse(voice=True). Audio and WAV are deleted after. tests/test_voice_messages.py (real hook, fake Telegram and STT), mutation-checked.
- villa-concierge: scripts/voice.py decodes Ogg/Opus with libopus (ctypes) to 16 kHz mono WAV and picks the stt entity (the only one, or villa.voice.yaml `stt:`; several and none named: refused, never guessed) and the language (villa.voice.yaml `language:`, else the person's). vesta-agent.yaml system_packages: libopus0. tests/test_voice_prepare.py (a real Opus fixture: duration, energy, 440 Hz), mutation-checked.
- villa-concierge find(): the Home Assistant area decides (place(): area name or alias, accents and case folded, exact before contains); a device with no area counts by its name; names only when no area answers; an entity id never. The pack carries area_aliases. SKILL.md: resolve every place with find, never from ha_search text. tests/test_concierge_place.py, 5 mutants red.
- Reply language: converse() no longer says "Answer in <saved language>"; it gives the saved language as information. The rule (the message's own language) is the skill's (villa-concierge SKILL.md).
- Starter skills recorded.

## 0.6.38 (5 October 2026)

- Workflow and DRY passes 1–2:
  - vesta_shared.timeutil.day_label / day_time_label: the one day format ("5 Oct"), used by the 7 hand-written strftime("%d %b") calls in the reports and preventive-maintenance skills (mixed "05 Oct"/"5 Oct"). A test forbids a new hand-written one.
  - Removed helpers with no caller: timeutil ms_to_local, parse_iso, local_now, day_of, fmt_dt, fmt_day, daterange; stats.mad; messaging.fmt_kwh, fmt_pct.
  - tests: the stop tests wait for the agent's own readiness line, not a fixed 3/6 s (suite 45 → 38 s).
  - Starter skills recorded.

## 0.6.37 (5 October 2026)

- Architecture review round 3:
  - Scheduler.tick starts every job as a task (_start, keyed; a job still running is not restarted; a scheduled job awaits a running pack rebuild) instead of awaiting each in turn. The nightly check, up to 1,800 s, held every_5_min (the alert chase) and could let other slots' windows close. Scheduler.idle() for tests and a clean stop. Test test_a_long_job_never_holds_the_alert_chase, mutation-checked.
  - outcome.CARRIED_KEYS / has_work(): the keys carry_out reads, used by run_skill_script, which kept its own copy. A drift test reads carry_out's source.

## 0.6.36 (5 October 2026)

- Architecture review round 2: Policy and problems() read values through shared readers (read_bool, read_int_in, _id): the agent uses the default exactly when problems() names the value. Fixes `act_enabled: "false"` read as True, a non-numeric chat id crashing Policy(), and a negative person id registered. Also: State.use_continuation(by=) refuses (without using it) a Continue pressed by someone other than requested_by, which was written and never read. tests/test_policy_agreement.py (29 cases), each fix mutation-checked.

## 0.6.35 (5 October 2026)

- Architecture review round 1: vesta_shared/axis.py (nice_axis, label, is_flat). It is the one Y-axis rule: reports compose._ticks/_axis/line delegate to it, and status.costs serves the Costs chart's `axis` (app.js only draws it). Both old copies took decimals from the step's size and mislabelled 2.5 and 0.25 steps; app.js had no tick bound and no flatness rule. tests/test_axis.py, mutation-checked; reports starter skill recorded.

## 0.6.34 (5 October 2026)

- status.costs(job_names=…): a run recorded before 0.12.0 as "job:skill:when" is counted under the job's name (the UI server maps skill:when → name from the skills). paged(): a head cell's `half` pairs columns on a phone (Every run: When/What, Tokens/Cost). tests/test_ui.py, mutation-checked.

## 0.6.33 (5 October 2026)

- UI: table-layout: fixed only for the editable tables (.edit, .ai); 0.6.28 had applied it to every table.rows, so the paged data tables overlapped. paged() labels each cell (data-label); on ≤ 600 px a data table is labelled cards. tests/test_ui.py pins it.

## 0.6.32 (5 October 2026)

- UI, Costs → Every run: app.js runWhat() keeps a run's label in the cell, with the chat and the asked text as its title tooltip and a tap-to-expand detail (no hover on a phone). tests/test_ui.py pins it.

## 0.6.31 (5 October 2026)

- reports compose._ticks/line(): a span of float noise (≤ 1e-9 of the values) is flat, and ticks come from their index, at most 100. `v += step` never moved for readings like 21.4 and 21.400000000000002 and the report job hung (the Kiosk crashed on the same data, 2.496.282). tests/test_shared_grouping.py, mutation-checked; starter skill recorded.

## 0.6.30 (5 October 2026)

- reports compose.line(): a "%" series whose values all lie in 0–100 gets its axis top at 100 at most (the 15 % padding no longer passes it); any value outside keeps the old range, so nothing is capped. tests/test_shared_grouping.py, mutation-checked. Starter skill recorded.

## 0.6.29 (4 October 2026)

- Architecture review (fourth pass):
  - policy.form_schema(): the rule words, the entity lists with their domains and labels, the siren's domains and the actionable domains, from the tables the checks read (RULE_WORDS, ENTITY_LISTS, SIREN_DOMAINS, ACTIONABLE). Served by /api/policy as `schema`; app.js keeps no copy, and policy_doc.LISTS is ENTITY_LISTS.
  - Two drifts fixed: button_allowlist offered input_button (refused on save), and siren_entity offered siren.* while outcome asked switch.turn_on. The siren now uses its own domain for turn_on and auto-off, and problems() names a siren outside SIREN_DOMAINS.
  - app.js editTable(): People and services from one builder. Columns carry their <col> width and phone place; generic .rows.edit grid CSS replaces the nth-child blocks.
  - tests/test_policy_schema.py (every offered domain accepted, siren asked with its own domain) and test_ui, all mutation-checked.

## 0.6.28 (4 October 2026)

- UI: editable tables (table.rows) use table-layout: fixed with per-table column widths (svc, people, ai). An automatic table sized a column to its longest unbreakable dropdown label and overflowed a phone. On ≤ 600 px the svc and people rows stack as a grid, as the ai rows did. tests/test_ui.py pins it.

## 0.6.27 (4 October 2026)

- The UI's dropdowns: app.js dropdown() (a picker-box button, its own listbox fixed on the page body, under or above the button, keyboard arrows/Home/End/Enter/Escape) replaces every native select (Costs period, sel(): brain, conversation reset, role, language; the service Rule). app.css .dropdown*. tests/test_ui.py refuses a native select in app.js or index.html.

## 0.6.26 (4 October 2026)

- Architecture review (third pass), behaviour-preserving apart from the drifts it closes:
  - vesta_agent/job_notices.py: the "being prepared" message is a pure JobNotices (started / replied / result / ended → delete or edit), replacing a dict app.py edited in three places. It fixes the result arriving before the reply (the reply stayed), the end before the reply (the reply promised a report), and two jobs in one turn. tests/test_job_notices.py drives each order.
  - preventive-maintenance features.device_key / device_name: one device key for offline, silent and flapping (flaps keyed on asset slug, the others on platform:asset). features.worsened / to_close: the persist loop's two decisions, now pure.
  - reports facts.group_kinds: one grouping for the weekly list and the 07:00 digest. The digest's own copy guessed names from the summary text, used the first member's severity, and raised KeyError on a {kind} group line. Names now come from the knowledge pack.
  - vesta_shared.messaging.no_code: one copy, where there were three.
  - tests/test_shared_grouping.py, all mutation-checked.

## 0.6.25 (4 October 2026)

- Every report asked for in a chat (owner, 2026-10-04: "all report messages"): the waiting message is replaced by the job's FIRST result whatever its form — the daily digest is text, not a page, and 0.6.24 replaced only on a page. app.send(from_job=…), passed by send_message and outcome.carry_out for an Origin JOB. tests/test_jobs.py: the daily digest's case (red when keyed on the page again) and the list of on-request jobs (fm-daily, fm-weekly, owner-monthly) the rule covers.

## 0.6.24 (4 October 2026)

- A job asked for in a chat is ONE message, then its result (owner, 2026-10-04: "I don't want to see 3 messages"). The conversation reply that started it is remembered per chat (app._job_notices) and deleted when a page is sent to that chat (Telegram cannot turn a text message into a file message: telegram.delete, deleteMessage on the bot's own message); a job that ends without a page edits it to say so. reports skill.yaml fm-weekly: the owner-weekly lines on schedule only; asked in a chat, the page is the whole answer. tests/test_jobs.py: 3 new, each red under its mutation.

## 0.6.23 (4 October 2026)

- PM-SILENT judges a sensor on the 72 hours BEFORE it went quiet (silence_history_hours, was a 14-day window). Checked against the villa's live history after 0.6.22 was installed: the one sensor that really stopped had been frozen once before (6 days), so over 14 days it moved in ~45 % of hours and 0.6.22 would have taken it for a change-only sensor. tests/test_maintenance_noise.py: the earlier-freeze case (fails with the 14-day window).

## 0.6.22 (4 October 2026)

preventive-maintenance and reports (villa, 2026-10-04: a morning message of 24 "new" lines, repeated under "Still open"; the Kiosk's Cockpit filled with the same tickets):
- nightly.py judges the LAST FINISHED day (live: yesterday). It ran at 02:00 and judged its own date — a 2-hour stub — so "the last 2 days" of a pump were yesterday and that stub.
- PM-SILENT only for a sensor that normally reports all the time: features.reporting_share over its hourly statistics before it went quiet (silence_history_days 14, silence_reporting_share 0.5, overridable as vesta_<name>). A curtain, a rain gauge at 0, a sensor with no history: never silent. One finding per device.
- PM-RECONNECT-LOOP: a minute in which restart_crowd_entities (20) or more entities drop together is a restart, not counted against any of them; one finding per device, named in words (never a raw entity id).
- PM-UNAVAILABLE: "unknown" is not offline (a wind chill on a warm day).
- PM-ENERGY-CHANGE: a day the plug had energy_gap_hours (3) or more without data, from its first data to the day judged, is left out of the comparison.
- compose fm-daily: a new finding is not repeated under "Still open"; a kind with todo.group_from items and a todo_groups line is one line (PM-RECONNECT-LOOP added).
- tests/test_maintenance_noise.py (9; each fix mutated red); two silence tests given hourly history. Villa replay: 54 pass (it caught a first version of the offline-day filter that starved a baseline).

## 0.6.21 (3 October 2026)

- State: named records — claim_job_slot (atomic under the lock; was get-then-put) / jobs_run, set_alert_skill / alert_skill, remember / alert_messages / is_alert_message / forget_alert_message, mark_saved_by_model / saved_by_model. Same stored keys (no migration). outcome, scheduler, status, tools use them. tests/test_state_records.py (incl. old-key compatibility and ownership); 3 mutations red.

## 0.6.20 (3 October 2026)

- UI Costs: Period as a one-line field (.field.row), the figures in a .divided block. tests/test_ui.py pins it.

## 0.6.19 (3 October 2026)

- UI header: the short version (app version · channel, full line as the title attribute) inside .brand; the theme toggle margin-left:auto on the same line. tests/test_ui.py pins it.

## 0.6.18 (2 October 2026)

- UI: one figures() builder for every set of figures (Overview's last 24 hours, Costs), its own .figures grid: two 120px columns on a phone instead of .grid's one 220px column. tests/test_ui.py pins it.
- tests/test_engine_version.py: vesta-agent.yaml, __version__ and this file's top entry are one version (nothing compared them).
- tests/test_favicon.py reads the Kiosk's icons from dev2 in git (as the contract test does), not this branch's stale public/.

## 0.6.17 (2 October 2026)

- vesta_agent.favicon: every HTML document sent (telegram.Telegram.send, the one path) carries the VESTA mark inline as data: URIs (light/dark SVG + 32 px PNG, the Kiosk's own files; tests/test_favicon.py fails if they drift). A page declaring its own icon keeps it; non-HTML and non-UTF-8 files are sent untouched. No skill edited.

## 0.6.16 (1 October 2026)

Architecture review (all five candidates):
- vesta_shared.problems: one owner of a problem's lifecycle (finding / incident / task / Kiosk ticket). Status words DONE / CLEARED / CLOSED_IN_KIOSK; a task keeps its source and its check (store migration adds tasks.source, tasks.check_text); open_problems() is the one "still open" for facts, compose (fm-daily, owner-weekly) and concierge. A fault closed in the Kiosk closes its incident and settles its messages. alert-desk, preventive-maintenance and the reconcile go through it; outcome.create_ticket no longer parses "Check:".
- routing.Origin(kind=conversation|job|press): Routing.offered / target / is_conversation answer every "where may it go" question; a conversation holds every message, scripts' included, to its chat. Toolbox.tool_objects(person, origin, include_web).
- vesta_shared.agent_records: the one reader of the agent's records (cost, listening since) for status.py and the reports; reports.yaml incident_words (every desk state) and alert_follow_window_min; facts.followed_by_agent.
- reports: one_list(...) builds the "Do this week" list from plain inputs; a line names its device from the pack.
- UI: /api/jobs gives when_words and runs_per_month (scheduler.describe), /api/policy and /api/costs the brain labels (policy.profile_labels); app.js keeps no copy.

## 0.6.15 (1 October 2026)

- outcome.create_ticket: "<finding> Check: <what>" becomes the ticket's title and its note.

## 0.6.14 (1 October 2026)

- preventive-maintenance: a state finding closed by the night closes its task ("cleared") and emits ticket.resolve.
- outcome.repair_tickets reconciles: a task whose Kiosk ticket is resolved is closed ("done_in_kiosk"); a task whose findings are all closed is closed with its ticket resolved; tasks without a finding (alerts) are left alone. kiosk.ticket_states().

## 0.6.13 (1 October 2026)

- UI: theme switch (theme.js in the head; `data-theme` light/dark, none = auto; tokens for both in app.css).
- UI: the device picker is a dropdown (search, checkboxes, single choice for the siren); fields holding a picker are a <div> (a <label> forwards clicks to its first control); grid items `min-width: 0`.
- UI: the Costs chart has Y ticks (1/2/2.5/5 × 10^k), grid lines and dated bars; the 4th KPI is the average per run.
- reports: compose.py charts (line, bars, pairs) draw a Y axis with grid lines (`_ticks`, `_axis`).

## 0.6.12 (1 October 2026)

- policy.LANGUAGES: zh (Chinese), ja (Japanese), ko (Korean).

## 0.6.11 (1 October 2026)

- UI: one "Rules (file)" tab; its "(file)" part opens the file view (`#rules-file`).

## 0.6.10 (1 October 2026)

- outcome: every message sent with an incident's buttons is remembered (`incmsg:<id>:<chat>:<message>`); `settle(id, note)` edits all of them (buttons removed, the note added) and forgets them. A press settles every copy, by name; the standard form gains `settle: [{incident_id, note}]` ("{time}": villa time).
- alert-desk: a reply (Done / Not found / Need help / Mute, typed or pressed) and an incident Home Assistant clears emit `settle`.

## 0.6.9 (1 October 2026)

- runner: each `run` record keeps the profile, the model, the tokens (input, output, cache read/write), turns, duration and the first 160 characters of what a person asked.
- status.costs: the Costs tab's reading (runs, by work, by model, by day, today/7 days/month); UI `/api/costs?days=7|30|90`, a "Costs" tab, a shared 10-row paged table (also "Scheduled jobs run").
- UI `/api/entities` (the knowledge pack's entities): device pickers for the protected devices and the allowed lists; `policy.LANGUAGES` is the one language list (app and the page's menu).
- UI: cost limits say per reply / per run, jobs say their cadence, the scheduled runs' monthly maximum; skills show "not working" only.

## 0.6.8 (1 October 2026)

- send_message: with a chat (a person answered, or a job asked for), `here` only, and any other name is held to that chat; without one (a scheduled job), owner or fm.
- skill.yaml `scripts.<s>.job_only: {command: job}`: in a conversation, that command is refused and points to start_job. reports: fm-daily, fm-weekly, owner-monthly; fm-daily is now on_request. A test fails when an on_request job has no job_only command.
- UI: "Rules (file)" top tab (no sub-tabs); Overview without the Rules and Skills cards (their problems still shown); divider above "Scheduled jobs run".

## 0.6.7 (1 October 2026)

- reports: one list (`todo`: clues and open tasks merged by device, grouped by kind when reports.yaml gives the kind a group line, "same time" detected); `noticed`, `tasks`, `maintenance` sections removed. Alerts grouped per alert with a count; alert names from `alert_words`.
- reports: HA's logbook counts as alerts only the runs of the blueprints in `alert_on_every_run` (a schedule rule's run is a check, not an alert); `nothing_happened` only for what was watched (`listening_since`).
- reports: 6 files — templates/report.html holds the style and every section; charts.py merged into compose.py.
- reports: power_step needs `min_hours` of running a day; circuits cap `circuit_change_max_pct`.
- preventive-maintenance: PM-SILENT reads `last_reported` (ha_client asks for it), not `last_changed`.

## 0.6.6 (1 October 2026)

- A job asked for in a chat sends only to that chat: `Origin.requested` makes routing send every `to` (here, owner, fm) there, for send_message and for its scripts' results; send_message offers only `here`.
- UI: The AI and the AI jobs are one table (Work / Brain / Limit), stacked per row on a phone; the AI jobs card is gone.
- UI: a switch and its field share one line (Acting on the villa; New conversation and Web search).
- UI: a skill's file list is folded to one line, with "All N files" when it does not fit; the open file comes first.
- UI: the skills grid no longer widens the page on a phone; the error reporter ignores the browser's "ResizeObserver loop" notice.

## 0.6.5 (1 October 2026)

- UI: the AI jobs card uses The AI card's fields and grid (one block per job, Set / Stop) instead of a table.

## 0.6.4 (1 October 2026)

- UI: the page's files are linked as `static/<version>/…` (a path), not `?v=` — on the villa, behind Cloudflare,
  0.12.3's page still ran 0.6.1's code. The app's version comes from the host (host.json), not the environment.

## 0.6.3 (1 October 2026)

- UI header: the app's version too (`VESTA_APP_VERSION`, given by the host to the UI process only).

## 0.6.2 (1 October 2026)

- UI errors.js: a failed resource load counts only for the page's own files (same origin); the villa's Cloudflare
  inserts beacon.min.js, which the CSP blocks, and it was reported as "page error: error".

## 0.6.1 (1 October 2026)

- UI: index.html is served with the version in its files' addresses (`static/app.js?v=…`): on the villa, 0.12.0's
  page showed 0.10.0's code with the new data. `errors.js` (loaded first, plain script) shows a page error on the
  page and posts it to `/api/client-error`, logged as `UI: page error: …`; `UI: page opened (agent …)` per load.
  Cause found from the owner's console: the villa's HA is behind Cloudflare, which served 0.10.0's app.js.
- UI: no inline `style` (the CSP refused it): `.spaced`, `.push-right`; a test forbids `style:` in app.js.

## 0.6.0 (1 October 2026)

Readings (owner's design, agent-host/docs/adr/0001; glossary agent-host/CONTEXT.md).

- AI jobs: `schedule` entries with `prompt` need a `name` (+ optional `to`, `on_request`, `default`, `on_limit`,
  `description`); policy.yaml `settings.jobs.<name>: {profile, limit_usd}`; a job not set does not run.
  `runner.run(profile=)`. At the limit, the job's `on_limit` code step runs ({to}, {started}, {limit}).
- Tool `start_job`: a person (never a job) starts an on_request job; it runs as itself and answers `here`.
- Skill messages may carry an `attachment` (a file of the out folder).
- Files named `villa.*` in a starter skill: not an edit (fingerprint), kept by updates.
- UI: AI jobs card, "not set" banner and "Add them" on Overview and Rules; `/api/jobs`.
- reports: `playbook:` (when kinds power_step, run_change, battery_trend, offline, use_while_empty; entries without
  `when` are knowledge), `nothing_happened:`, sections `noticed` and `quiet`; readings unchecked and marked, slots
  `checked: true` still checked; `compose.py --finish/--since/--limit`; `villa.reports.yaml` merged.

## 0.5.0 (1 October 2026)

Owner's architecture review (all six candidates, one release); rule: whatever a skill can define lives in the skill.

- `outcome.py`: one module carries out a script's result (send / ticket / ticket.resolve / snapshot.get / siren gate)
  for every caller — scheduler, hooks, alert buttons and the model's run_skill_script (before: dropped on the model
  path, losing tickets). The alert buttons live there (`press`). `repair_tickets()` at start and nightly.
- `routing.py`: the one routing rule (`here`, role chats, approver chat, one send per chat). alert-desk replies use
  `to: here`. send_message, Actions.request and the siren notice route through it.
- `policy.py` is the one reader of policy.yaml: settings block, `siren_auto_off_min`, defaults; config, the UI and
  the skills read from it. Skill scripts get `VESTA_POLICY` and `VESTA_STATE` (read only).
- alert-desk: the dead `siren` command and `siren.on` action removed; the gate prompt reads the policy's minutes.
- ha_client logbook: stops at a page that brings nothing new, keeps each row once (ha-mcp 8.5.0 repeated page 1).
- run_skill_script serves part N of a long answer from the first run, never runs the script again.
- New tool `save_file`: a .json/.txt/.md in the out folder, never over a script's file.
- reports: `reports.yaml` (sections, order, thresholds, sentences, gaps), `facts.py` (every figure: HA statistics,
  states, the VESTA rules' logbook, the store, the AI cost), `compose.py` renders `report.html` + `blocks/*`, inline
  SVG charts (`charts.py`), and refuses a note whose numbers are not its section's. Old page templates removed.

## 0.4.0 (30 September 2026)

- The UI (`python -m vesta_agent.ui`, the manifest's `ui`): aiohttp, plain HTML/CSS/JS, no build step, the
  Kiosk's tokens and self-hosted fonts. policy.yaml forms and raw file (ruamel.yaml, comments kept; `rev`
  refuses a stale save), skills and their files (checked with `skills._parse` on a trial copy, Python with
  `compile`). Only the Ingress gateway may connect (standalone: loopback); writes need a JSON body and the
  page's header. Skills deleted go to `skills/.trash`.
- `policy.problems()`: the file's checks in one place, used by the UI (refuses to save) and the agent (logs).
- `status.report()` shared by the `agent_status` tool and the UI overview.
- `send_message` `to: here` (the chat asked in); the system prompt says to redo a job, never replay one.
- `ruamel.yaml==0.19.1`.

## 0.3.4 (30 September 2026)

- reports: `compose.py` fm-weekly / owner-weekly / owner-monthly require `--energy` and say what to run when it is
  missing (without it Jinja stopped on `Undefined.__round__`, reported as "a template error"). SKILL.md gives
  the two steps; the Monday prompt passes `--energy week.json` to owner-weekly.
- A failed skill script (model tool or code job) is logged with the last line of its stderr, scrubbed.

## 0.3.3 (30 September 2026)

- `allowed_services` rule `direct`: executed at once when a registered person asked in a chat
  (`Actions.request`, logged `direct`); no requester (a job, an alert, a skill) or an owner-only device, directly
  or behind a group, still goes through an approval. The system prompt and the tool description say so.

## 0.3.2 (30 September 2026)

- Fixed: every approved action failed. `McpClient.call_service` sent `entity_id` as a list; ha-mcp 8.5.0's
  `ha_call_service` takes one string. One device now goes as that string (ha-mcp waits for its state), several
  as Home Assistant's list inside `data` (the read-back then polls up to 5 s). Pinned against ha-mcp's real input
  schema (`tests/fixtures`); the host's container test fails when the server in the image stops matching it.
  A failed approved action is logged with its reason.
- No PDF: `compose.py` writes a self-contained HTML page (`--pdf` and `to_pdf` removed); the weekly and monthly
  pages are sent as an attachment with the headline and key numbers in the message. `system_packages` is empty.
- Starter skills follow the release when never edited: `starter/shipped-skills.json` holds the fingerprint of every
  shipped version; `Skills.update_starters()` replaces a matching folder, keeps an edited one and leaves the new
  version in `skills/.starter/`. A test fails until a changed starter is recorded (`record_shipped`).
- `install_files: [requirements.txt]` in the manifest: the image build installs the libraries from that file alone.

## 0.3.1 (30 September 2026)

- A reply to an alert button goes to the chat where it was pressed; the pressed message loses its buttons and
  says who answered, what, and when (Telegram `editMessageText` without a keyboard).
- Telegram messages are plain text: Markdown the model writes anyway is removed before sending, and the system
  prompt says so.
- Acting off: the model is told never to offer an action.
- Kiosk ticket titles: no leading emoji or rule code.
- Log lines per alert received and handled, message sent, button pressed, ticket created/resolved, reply answered.
- New read-only tool `agent_status`: the agent's own jobs, calls, incidents and AI cost over the last hours.

## 0.3.0 (30 September 2026)

Integrated into the VESTA Agent host (Home Assistant app "VESTA Agent"); decisions D1–D5 approved by the owner.

- Runs in the host's agent slot, started from `vesta-agent.yaml`; built by the host's CI, never on the Yellow.
- Settings from the host's environment (connections and secrets); the villa's people, lists and the agent's own
  settings (brain, limit per reply, web search, conversation reset) in `policy.yaml`, reloaded live.
- Skills are files in the skills folder, each with a `skill.yaml` (its scripts and flags, its schedule, its hooks):
  added, edited or deleted without code or rebuild. The five skills are copied there once, at the first start.
- Critical alerts arrive as Home Assistant's `vesta_critical_event` (opened, resolved, abandoned) on one
  listen-only websocket; no incoming port, no alert secret, no `rest_command`, no heartbeat automation.
- Telegram: Home Assistant stays the bot's only receiver; the agent reads its `telegram_*` events and only sends.
  It never polls the bot and never leaves a group. Button presses on Home Assistant's own messages (the gate)
  are left to Home Assistant.
- Facility manager tasks are VESTA Kiosk tickets; presence is the Kiosk heartbeat. The Home Assistant to-do list
  and `input_datetime.vesta_last_run` are gone.
- Web search is Claude's own WebSearch tool; `websearch.py` and the `anthropic` package are gone. `requests` too
  (the scripts' HA client uses the standard library).
- No villa data in the code: an empty example policy, no regional time zone (Home Assistant's `TZ`), invented
  ids in comments.

## 0.2.1 (30 September 2026)

Reviewed against a live villa (the nightly batch and the weekly numbers run for real through ha-mcp on 30 September).

- Asset kinds in the knowledge pack: motor, lighting, meter, appliance. The physics rules (running draw, run hours, sag) now apply to motors only. Before, light circuits with power meters and the mains phase averages raised false findings as if they were pumps.
- One energy counter per asset in the ROI numbers (a smart plug exposing "energy" and "energy consumed" for the same kWh was counted twice). The pumps table lists motors only.
- Devices of one integration offline together become one finding (four cameras of one integration were four P2 lines).
- The 02:00 job runs entirely in code: pack rebuild, batch (30 minutes allowed, it takes about 3 minutes through ha-mcp), to-do items, P2 to the FM. Zero tokens at night; the 07:00 digest carries the words. Before, the batch ran inside a model turn with a 15-minute cut.
- Level sensors are read only when a threshold helper exists for them (89 sensors were read every night for nothing); the logbook read is capped at 20 pages.
- DOCS: the heartbeat automation and the helpers to create (vesta_last_run, villa_mode, the pool parameters).

## 0.2.0 (30 September 2026)

Hardened from vesta-agent 0.1 (permissions audit of 30 September 2026) and packaged as a Home Assistant add-on.

- The model has no built-in tool: no shell, no file access. It sees only VESTA's own tools.
- Every Home Assistant access goes through ha-mcp, the skills' scripts included. No Home Assistant token.
- Layer 1: the Home Assistant read tools are named one by one in policy.yaml; a tool added by a later ha-mcp version stays hidden. A tool the server marks destructive is refused whatever the list says.
- Layer 2: every service call is checked by code on domain, service, entities and data. restart, shell, scripts, MQTT, updates, recorder, toggles, automation trigger are refused even with an approval.
- Approvals are buttons pressed by a registered person (Telegram id and role), never by the group; anonymous presses refused; one use; 15 minutes; bound to the exact action.
- Owner-only devices: the locks, the gate, the siren and the siren scene. Automations on and off: owner only.
- v1 informs only: `act_enabled: false` refuses every action until switched on.
- 1 USD per reply by default, with a Continue button. No turn limit.
- Alerts, the chase ladder and its buttons run in code, without the model.
- Rule codes removed from what people read. PDF by the system Chromium instead of Playwright.
