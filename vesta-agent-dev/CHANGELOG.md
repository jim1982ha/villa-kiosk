## 0.12.125

What you will see:
- Every message the agent sends on its own (an alert, its reminder or escalation, a night check, a warning, a scheduled report) starts the same way:

      For: Jean-Marie, Fabien_FM, Incident: Follow Up #9
      First time seen on 09/10/2026 13:12, to Jean-Marie, Fabien_FM
      Escalated on 09/10/2026 13:27, to Fabien
      -------
      (the message)

  "For" names the people of that chat's role, as the Rules page's People list names them. The incident line says New for its first message and Follow Up after, and lists every earlier message: when it was sent, what it was, and who it went to. A message with no incident only has "For" and the line. An answer to someone in a chat has no heading.
- The messages no longer say "Press Done, Not found or Need help" or "Press Done when it is back": the buttons are under them.
- A pressed button now reads "Done pressed by Fabien_FM on 10/10/2026 17:13", with the name this chat knows the person by.
- One Telegram id can now be listed twice in People, once as owner and once as facility manager, each with its own name (for example "Fabien" and "Fabien_FM"). The person has the owner's rights; each name is used where its role is meant.

## 0.12.124

What you will see:
- Every message about an open alert now has its Done / Not found / Need help buttons, in every chat it reaches: the facility manager's, the owner's group, and Home Assistant's own alert once the agent has taken it over. Nobody has to type an answer anymore; the messages say "Press Done" instead of "Reply Done".
- Each new message about an alert still replaces the earlier one in that chat, and now ends with when the earlier messages were sent ("Earlier messages: Fri 9 Oct, 06:11, Sat 10 Oct, 12:17.").
- A press still writes on the message who pressed what, and when.
- "typing…" now shows from the moment your message reaches the agent until its answer arrives, for every kind of message: while a photo is fetched or a voice message transcribed, while the AI answers, and while a report is made. Before, it started only when the AI began, 2 to 3 seconds late for a photo.

## 0.12.123

What you will see:
- The agent now looks at a photo you send it and answers about it. A photo follows the same rule as a text message: in a group, start its caption with /ask (or mention the agent, or reply to one of its messages); in a private chat with the agent, just send it. Until now every photo was dropped without a reply.
- If a photo cannot be fetched from Telegram, or is too large (over 5 MB), the agent says so.
- A file that is neither a photo nor a voice message is still not read, and the agent's activity record now says it was received and why it was left.

## 0.12.122

What you will see:
- Asked about the villa ("what's the status of the villa now?", "is everything ok?"), the agent answers from a full check made just before it replies, every time. Until now it could take one quick look and answer "everything ok" while three pump devices were offline.
- That check names everything: each device that is offline (once, by its name, not each of its sensors), every open problem ("Pool pump ran 7.3 h of 14.0 h yesterday") and every open alert. It never says green while a problem is open, and the agent says "everything is fine" only when it is green.
- If the check cannot run, the agent says it could not check the villa, instead of answering as if it had.
- For skill authors: a skill can name a check the agent runs before every answer (skill.yaml before_answer). The villa-concierge skill uses it.

If the Skills page shows villa-concierge as edited here, it is not updated automatically: open it and choose "Take the release version" to get this change.

## 0.12.121

What changes for you:
- The agent's own records no longer grow forever. Several kinds of notes it keeps were never cleaned up: a request for your approval that nobody answered, a note for every file the AI saved for a report, when you were last warned about a problem, and old conversations. They are now cleaned up with the others (Rules, how long things are kept). A request still waiting within its time is never deleted.
- The date the agent started listening is kept once. It used to be worked out from the oldest record, which moved forward every night as old records were deleted, so a monthly report could leave some rules out of "what did not happen".
- "Take the release version" on a skill's page is safer. If the agent stopped in the middle of it, the skill could end up only in the trash, and the next start took it for deleted. It now always comes back as it was, and the old version still goes to the trash, never erased.
- The page and the agent's start now judge "is this skill as the release" in exactly the same way.

## 0.12.120

What you will see in Telegram:
- A long answer arrives in order. A long list no longer comes before its introduction, and a line is no longer cut in two between messages.
- In a group, replying to the first part of a long answer gets an answer. Until now only the last part counted as the agent's, so a reply to an earlier part was ignored without a word.
- If Telegram refuses the end of a reply after its picture arrived, the reply is no longer sent a second time whole with "the camera picture could not be sent".
- When the agent updates one of its messages (an alert answered, a report on its way), the update looks like any of its messages and is never cut off: a long alert keeps "Done — name, time" at its end.
- Tapping "Done" (or any alert button) twice quickly counts once: the chat no longer ends on "Already closed", and the owner is not told twice. A second tap shows "Already answered."
- A message with a file attached keeps its buttons.

## 0.12.119

Fixes for two mistakes in 0.12.118, and one older miscount:
- On the VESTA Agent page, a switched-off skill no longer makes a working one show "Not working". This happened when you kept a switched-off copy of a skill (to edit it) that uses the same report name: the page, the Offline Test and the setup copy treated the real skill as off, while the agent used it normally.
- Skills, Offline Test: the file list again offers the files your last reports made (this morning's facts.json, for example), each one saying which report made it and when. It no longer offers only older files from before 0.12.118.
- The Overview counts a ticket the AI creates for the facility manager once, not twice.

## 0.12.118

What you will see:
- Two reports made at the same time no longer mix up their figures. The weekly and the monthly report start together at 08:00 when the 1st of the month is a Monday (next on 1 February 2027), and a report asked for in a chat can overlap the scheduled one. Each now works in its own folder.
- What a report may use depends only on who asks for it. On schedule it gets every tool switched on. Asked for by the facility manager, or in their chat, it gets only what the facility manager may use. The tools listed in a skill no longer limit anything: the weekly report has web search whenever web search is on.
- A tool switched off no longer stops a skill. Its reports still run, and the AI says in one sentence what that leaves out. On the VESTA Agent page the skill shows "Works without a tool" with its Switch on button, instead of "Not working".
- Asking for the weekly report in the facility manager's chat while the scheduled one is being made now says it is already being made, with its start time, instead of making it a second time.
- A skill that declares a report name another skill already uses (a copied test skill) is switched off, and the page says why.
- When starting reports from a chat is switched off for a person, the AI says so plainly instead of trying a tool it does not have.
- Note for Skills, Offline Test: the files a report made are now in that report's own folder, so the file list offers only what an Offline Test made itself. Run facts.py first, then compose.py, as before.

## 0.12.117

What you will see:
- In the reports, a device has the same name everywhere: the clues, the equipment cards, the trend charts, the counter resets, the muted list, the morning digest and the energy figures use the device's name in Home Assistant, as the to-do list and the monitoring table already did.
- The morning digest's "New" lists only what is still open: a problem found and closed again during the night no longer shows as news. An alert noted for the morning list shows once, under "Also noted", not again under "Still open". New and still open are now decided the same way as in the weekly report.
- The owner's weekly line counts open alerts and open maintenance problems separately. Before, every open problem was called an "FM task", alerts included.
- A pump's run hours in the energy figures and the filtration schedule are worked out the same way as in the night check. This only changes the numbers for a pump with a baseline power setting.
- The weekly report says a pump's running power "stepped" only when one clear change explains the readings, as the night check does. A day-to-day wobble no longer counts as a step.
- The filtration schedule no longer assumes a pump called "pool pump". It uses the pump whose pool volume is set. If several pumps exist and none is set up, it lists the setting each one needs.
- When the electricity tariff gives no currency (a unit such as "EUR/kWh", or an input_text.villa_currency helper), costs ask for one instead of assuming one. Your tariff already gives it.

## 0.12.116

What you will see:
- In the weekly and monthly reports, an equipment card is marked "Watch" again when the to-do list has something about that device. Since 0.12.115 the to-do list and the cards named devices differently, so no card was marked by it.
- The Kiosk's list of faults is brought up to date right after the night check, when the night check found, kept or closed a problem. Until now it was only brought up to date by the 01:30 rebuild.
- A battery measured in volts is no longer reported as "falling" by mistake: its reading (3.0 V) was taken as a charge (3 %). It is now converted with the nominal voltage you set for it, as the batteries table already did. Without a nominal voltage it is left out instead of guessed.

## 0.12.115

What you will see:
- When the facility manager answers an alert with "Need help", the owner's message about it now keeps its Done / Not found / Need help buttons. Until now the buttons disappeared the moment it arrived, so the owner could not answer it.
- When you ask for two reports in a row, each one's "on its way" message is removed when that report arrives, even if an earlier reply failed to send.
- "typing…" for a report starts once the agent's "on its way" reply is sent, so the two never overlap.
- In the reports, a device is named the same way in every section: the to-do list, the monitoring table and the batteries, which now show the device's name.
- Behind the scenes: the agent's records of what each chat shows about an incident are now one record per chat, cleaned up with the other records. The ones kept so far are converted when the app starts.

## 0.12.114

What you will see:
- In the weekly and monthly reports, "Is the monitoring itself healthy" lists devices, one row each with the name it has in Home Assistant, instead of each of their sensors. A pump plug is now one row, not one row per sensor. The count of devices offline and the "devices offline" line follow the same rule.
- A phone or tablet seen on the Wi-Fi, which Home Assistant knows nothing about (no name, maker or model), is no longer listed: that was the "RX" and "TX" rows. A device with no name but a known maker shows as "Unnamed" and its maker, so you can name it in Home Assistant.
- The app rebuilds its list of the villa's devices when it starts after this update, so the next report already uses it.

## 0.12.113

What you will see:
- "typing…" should now show while a report is made. Every 2 seconds made it disappear completely, and every 4 seconds showed it only now and then, although Telegram accepted every signal both times. A signal sent while the previous one is still showing seems to be ignored, so the app now sends one every 5.5 seconds, just after the previous one ends.

## 0.12.112

What you will see:
- When you ask for a report in a chat, the waiting message says it has just started (with its time), instead of "Still in progress" or "Still running", which made a new report sound like an old one stuck. Asked again later, it says when the report started.
- "typing…" is sent every 2 seconds instead of every 4 while a report is made. The app already sent it without a gap, and Telegram accepted every one. Telegram decides when to show it, so this may or may not make it appear more steadily in Telegram Web.

## 0.12.111

What you will see:
- Nothing changes in the chat. The app's log now records the whole timeline of a report asked for in a chat: when your message reached the agent, every "typing…" signal with its time and how long Telegram took to answer, the longest silence between two of them, then the report and the removal of the waiting message. This is to find out why "typing…" disappears before the report arrives.

## 0.12.110

What you will see:
- The update notes no longer turn into one long blue link. The 0.12.109 notes described a bug with a piece of web page code, and Home Assistant read it as a real link. Every release is now checked for this before it is published.
- Nothing changes in the reports: a test now confirms that any such code the AI writes shows as plain text and never breaks the page or its links.

## 0.12.109

What you will see:
- In the report pages, the links inside "what to check" and the question that follows are now real links you can tap. In 0.12.108 they showed as raw code instead of a link. The links in "VESTA's reading" already worked.
- If you took the release version of the reports skill, this update reaches it by itself.

## 0.12.108

What you will see:
- In the weekly and monthly report pages, every web address the report cites is now a link you can tap. It opens in a new tab. Before, it was plain text.
- The reports skill that comes with the app now includes your web search changes: the web_search tool, and the instruction to look up each repair, replacement or adjustment and give its link. Your edited copy of the reports skill is kept as it is. Open Skills › reports › Compare: the only difference left is the new link handling. "Take the release version" now keeps your web search lines, because the release has them too.
- When a report asked for in a chat ends, the app's log says how many times "typing…" was sent. This is to find out why it disappeared before the weekly report arrived.

## 0.12.107

What you will see:
- Nothing changes on screen. When a report asked for in a chat arrives and its "on its way" message stays, the app's log now says why, step by step. Today at 15:03 the weekly report came and "Weekly report is on its way" stayed in the group, and the log could not say why. Ask for the weekly report in the group again after installing this; the next report will show where it goes wrong.

## 0.12.106

What you will see:
- Each chat now shows only the latest message about an incident. When a reminder, an escalation, an answer or an all-clear arrives, the earlier messages about the same incident are deleted from that chat. This works in the group and in your private chat, for the owner and the facility manager alike.
- Every message about an incident starts the same way, "Incident #10 · " and then where it stands ("New alert", "Reminder: no answer after 15 min", "No answer from the facility manager after 45 min", "Closed: …"). It then repeats the original alert and what to check, so the latest message is enough on its own.
- Home Assistant's own alert in the group now gets the incident number as well: the agent rewrites it as soon as it knows the number, and deletes it when a newer message about that incident lands in the group.
- The owner now gets the Done / Not found / Need help buttons when an incident is escalated to them.
- The morning summary lists open alerts as "Incident #7 · …".
- If you changed the alert-desk skill yourself, open Skills › alert-desk › Compare and use "Take the release version" to get this. Otherwise it updates by itself.

## 0.12.105

What you will see:
- Chats should cost less from the second message on. The AI's instructions used to end with the time to the minute, so they changed every minute and Anthropic could not reuse the conversation it had already read: each message re-sent the whole chat at full price. The time now comes with each message instead, so a continuing chat can be read from Anthropic's cache, at about a tenth of the price. The AI still knows the villa's date and time.
- In Costs, check "Tokens in" over the next days: more of it should now come from the cache.

## 0.12.104

What you will see:
- Nothing in the app changes. Behind it, a release can no longer get stuck for hours on GitHub: the step that installs Debian packages before the tests now has a 10-minute limit. If GitHub's package download hangs again, as it did for 0.12.103, the run fails after 10 minutes instead of waiting up to 6 hours, and a "Re-run all jobs" publishes it.

## 0.12.103

What you will see:
- Skills › About: the first section's title now names the skill that is open, for example "When the reports skill runs", so it is clear which skill the right side shows.

## 0.12.102

What you will see:
- Skills › Files and Rules (file): the switch now reads **View / Edit** (was Formatted / Raw).
- Skills › Files: the file tabs stay in the same order, whichever file is open. When the file list is folded to one line and the open file would be hidden, the list unfolds.
- Skills: picking another skill in the list now opens it on the right without redrawing the list: the list stays put and only the highlight moves.

## 0.12.101

What you will see:
- If policy.yaml cannot be read (for example after an edit in Studio Code Server), **Rules (file) still opens**, with the problem shown at the top, so you can fix it there. Overview, Skills and the Rules forms open too, instead of staying on "Loading…". Any tab that fails now says why.
- "Keep mine" now says why when it is refused, instead of "The page met an error".
- Rules (file) and a skill's files use the same editor now: the Tab key indents in policy.yaml too.
- A skill's SKILL.md and skill.yaml can no longer be deleted from the page (a skill needs both). The button was already hidden, and now the agent refuses it too.
- Out-of-date words fixed: the setup import and export said "The AI" and "allowed lists", which are now "AI brains and limits" and "the devices each service may act on".
- Nothing else should look different. Behind the page, more names and rules now come from one place on the agent: the export's options, the role names, the Page changes labels, the top tabs, the order of the Rules sections, the Offline Test result words, and "WebSearch".

## 0.12.100

What you will see:
- On a phone, in Skills › About › When the skill runs: the job name (fm-daily…) now lines up on the right under its time, with its "AI job" chip beside it. Before, the name sat in the middle of the line. This applies to every table cell that holds a name and a chip; no other table changed.

## 0.12.99

What you will see:
- Rules (file): policy.yaml now opens **formatted**, with the same **Formatted / Raw** switch as a skill's files. Comments are dimmed, setting names, numbers and switches each have their own colour, and the indentation is kept. Raw is the editor, as before.
- Skills › Files: the `.yaml` files (skill.yaml, reports.yaml, villa.*.yaml…) now open formatted the same way. The Formatted / Raw choice is shared by every file and kept while the page is open.

## 0.12.98

What you will see:
- Skills › Files: a Markdown file (SKILL.md and other .md files) now opens **formatted**: headings, lists, tables, code and the skill's name and description at the top. A small **Formatted / Raw** switch beside it shows the raw text, where you edit. The choice is kept while the page is open.
- In Formatted, the text is shown as it is in the editor, saved or not. Lines inside an HTML comment are left out, as the AI also ignores them when reading. A line starting with `#` shows as a heading, which is what it is in Markdown.

## 0.12.97

What you will see:
- Skills › Compare: the **Take the release version** button is now on the Compare tab. It used to be only in the banner at the top, which disappears once "Keep mine" has been pressed, so after that there was no way to go back to the release's version. Its (i) explains what it does.

## 0.12.96

What you will see:
- Overview › Page changes: a change to the instructions now has its Undo button. Undo always worked for it, but the button was hidden.
- Overview › The last 24 hours: "failures" now counts a failed action on the villa too. It was left out before.
- Nothing else should look different. Behind the page, the agent now decides what the page shows: whether a change can be undone, the figures, why a skill is not working, which jobs are not set, and where each tool's switch is. The page no longer keeps its own copy of these rules.

## 0.12.95

What you will see:
- Rules: the **AI tools** section now comes right after **AI brains and limits**, at the bottom of the page.

## 0.12.94

What you will see:
- Skills › About: the three sections now have short names like the rest of the page: **When the skill runs**, **Skill commands** and **Skill tools**. "Skill tools" sits alongside "AI tools" and "Agent tools" in Rules.

## 0.12.93

What you will see:
- The villa-concierge skill now refers to "Rules › Allowed actions", the section's current name, so the AI no longer points people to "What the agent may do". If you edited this skill in Home Assistant, your copy is kept and still has the old wording.

## 0.12.92

What you will see: every section now has one name, used the same way everywhere.
- Rules: "What the AI can use" is now **AI tools**, with the tabs **Home Assistant tools**, **Agent tools** and **Tools by role**. A skill's "Tools used by the Skill" lists some of these same tools.
- Rules › AI tools: the "15 of 77 tools on. From Home Assistant's MCP server…" line is now the (i) beside the Home Assistant tools tab. The paragraph about roles is now the (i) beside the Tools by role tab.
- Rules: "The AI" is now **AI brains and limits**, and its "Tools it gets" column is now **AI tools**. "What the agent may do" is now **Allowed actions**.
- Overview: "Changes made on these pages" is now **Page changes**, and "Copy the setup to another villa" is now **Copy the setup**. Every sentence that sends you to one of them uses those names.
- Costs: **AI cost**, **Cost breakdown** (By work, By model) and **AI runs** (Every run, Tools called). "Tools used" is now "Tools called", since it lists what the AI actually called.
- The messages that say where to switch something on, such as "switched off in Rules › AI tools", and the entries in Page changes use the same names.

## 0.12.91

What you will see:
- Skills › About: "When is the Skill called" is now a table like the others, with "When" and "What runs" column headings. Its second column lines up the way it does in Overview's "Scheduled jobs run". On a phone each line becomes a small labelled card, as in every other table.
- Every table on the page is now built by the same code, and so are all the sections with tabs (Costs, Copy the setup, What the AI can use, a skill's About). They look and behave the same everywhere.
- Rules › Who may use what, on a phone: the "Facility manager" heading no longer runs into "Guest".
- Rules › The AI, on a phone: a job using "Performance (Opus)" no longer pushes its × button past the edge of the card.

## 0.12.90

What you will see:
- Offline Test popup: the line under the title (for example "compose.py fm-daily") and the "Options" heading are gone. The title now names the script and the command, for example "Offline Test · compose.py fm-daily", because two scripts can have a command with the same name.

## 0.12.89

What you will see:
- Skills › About: "When is the Skill called" now sits alone at the top. Below it, one section has two tabs: "Commands run by the Skill" (opened first) and "Tools used by the Skill". The (i) explaining the command switches is beside the Commands tab.

## 0.12.88

What you will see:
- App settings: "Telegram takeover" is now called "Agent replies on Telegram", with a shorter description: "Toggle to indicate if the Agent can send and answer messages to the villa's Telegram bot (if OFF, the agent sends nothing)". Your current setting is kept.
- The log lines about it use the new name.

## 0.12.87

What you will see:
- Skills › About: the "Offline Test" button is now on the command card's top line, left of the switch, so each card is one line shorter. On a narrow card it reads just "Test".
- The Offline Test popup no longer opens with the (i) explanation already showing. It shows only when you point at or tap the (i).
- On a phone, the About sections no longer stick out a few pixels past the right edge of the page.

## 0.12.86

What you will see:
- Skills › About: the "Try a command" tab is gone. Each command card under "Commands run by the Skill" now has an "Offline Test" button that opens the same test in a popup, already set to that command, so there is no "What to run" step.
- Skills › About: "When is the Skill called" and "Tools used by the Skill" are now two tabs in one section at the top. Each tool is shown as a card, like the command cards, instead of in a fold-out list.
- New names: "What the AI may run" is now "Commands run by the Skill", "When it acts" is now "When is the Skill called", and "Tools it needs" is now "Tools used by the Skill".
- In the popup, an (i) now shows its explanation above the popup instead of behind it.

## 0.12.85

What you will see:
- Costs: the "Per day" chart is back to a compact height (about 180 px) on a laptop. Since the page got wider it had grown with it, text included, to about 500 px.

## 0.12.84

What you will see:
- Skills: the list of skills on the left is 30% wider on a laptop, so a skill's name and description fit better. Phones are unchanged.

## 0.12.83

What you will see:
- **A wider page on a laptop**: the agent's page now uses up to 1,650 px of width instead of 1,100, so less empty space on each side. Phones are unchanged.
- **Costs**: "By work" and "By model" are now one card with two tabs ("Where it went"), and "Every run" and the tools those runs used are another ("Runs"). The tab you chose stays when you change the period.
- **Overview › Scheduled jobs run** names each job instead of repeating its time: "fm-daily" instead of "reports:0:07:00", "preventive-maintenance › nightly.py", "knowledge pack" — the time is in the "Ran at" column. The AI's own status report uses the same names.

## 0.12.82

What you will see, on a skill's About page (Skills):
- "What the AI may run" no longer lists each script's options (--as-of, --out…) on its card: the cards say what each command does, and the options stay on "Try a command", where they are used.
- The sentence explaining the switches moved into an (i) beside "What the AI may run", like every other explanation on the page.

## 0.12.81

What you will see:
- On the Costs tab, the (i) of a "without the AI" run now comes before its label, so it lines up with a failed run's (!) in the same column.

## 0.12.80

The seventh architecture review, carried out. What you may notice:
- **An alert's buttons no longer depend on its wording.** A reminder found its incident by reading "#N" in its own sentence: rewording it in the skill would have silently lost the buttons. And with no siren set in Rules, an intrusion warning was sent nowhere; it now reaches the owner and the facility manager.
- **The page always says why something failed.** When the connection drops (the Home Assistant session ended, the app restarting), a save or a switch showed an empty box or "Not changed" with no reason; it now says the VESTA Agent could not be reached, reload and try again.
- **Each skill keeps its own thresholds**, in its own folder (alert desk: rules.yaml; night check and energy: settings.yaml), and a villa's own file (villa.rules.yaml, villa.settings.yaml) refines them and survives updates — the alert desk's routes included, which could only be changed by editing the shipped file before. A missing value is named, never guessed.
- **One time zone rule for every script** (one of them ignored the villa's).
- The host's self-test reads Home Assistant MCP's answer like the agent does (a tool description with a special line break would have made it say "no tools").

## 0.12.79

The sixth architecture review, carried out. What you may notice:
- **The siren always stops by itself.** It was switched off after its minutes only when it had been approved with a button; a villa whose rules let it sound without asking had no stop at all, and a restart of the app forgot a stop that was due. Now every way of turning it on schedules its stop, and a restart still stops it on time.
- **The page checks every change the same way.** Undoing a change (Overview › Changes) or importing a setup could write rules with problems or a script with a syntax error; now they are refused like a save from Rules or the editor.
- **One message for someone the villa does not know**, whatever they press ("You are not registered with the VESTA Agent").
- **The Costs tab:** a job made without the AI is kept as long as the AI runs beside it; a question answered after a lost conversation is one row, not two.

Under the hood: the reports, incoming Telegram messages and the buttons each became one piece of the agent instead of being spread through it; closing an alert or a night-check finding closes its task and its fault in the Kiosk by one rule.

## 0.12.78

What you will see:
- **The Costs tab no longer charges for refused requests.** While the Anthropic account was out of credit, every refused reply showed US$ 0.03 with 0 tokens in and out — the Claude client's own estimate, not Anthropic's bill (the Anthropic Console showed US$ 0.03 of Haiku for the whole day). A run that read and wrote nothing now counts US$ 0.00, past runs included, on the Costs tab and in the reports' "AI cost".

## 0.12.77

The fifth architecture review, carried out. What you may notice:
- **Report buttons are for who may start a report.** In a group, anyone registered could press another person's report button while the AI was unavailable; now a press needs the same right as the offer (Rules › The agent's own tools › Start a report).
- **A lock or a cover still moving is read again** before an approved action is called "not confirmed" (a lock "unlocking" a second before it was unlocked).
- **Reports read Home Assistant less:** each thing once per report (the rules' logbooks were read four times for the weekly page, a pump's power up to three times).
- **The monthly energy figures no longer fail** when the villa names a main meter that has a twin with a shorter name.
- **Nothing secret in the Costs tab's tool list:** a token is now removed by its shape too, not only when it is one of the app's own keys.

Under the hood: a report asked for in a chat, a job's code steps, and what happens when the AI cannot answer each became one piece of the agent instead of two or three, so the kind of bug found today (a button's report deleting the next answer) cannot come back from one path forgetting a step.

## 0.12.76

What you will see:
- **The monthly report's cards keep their text inside.** A long name (a Home Assistant id has no spaces) ran out of its card; the "Proposal" label no longer stretches with the card.
- **No more buttons that do nothing.** "Accept / Later / Ignore" on a proposal looked like buttons, but a report page cannot press anything: it now says what to write in the chat ("accept 4", "later 4" or "ignore 4"). The weekly report's "Done / Not found / Need help" boxes became one line too: answered Done in the chat, or closed in the VESTA Kiosk, a task leaves the list.
- **A missing setting is proposed by the device's name** ("Create the missing setting for Weather station Console Battery"), not by its Home Assistant id.

## 0.12.75

What you will see:
- **The report buttons appear only when you ask about a report.** While the AI is unavailable, "what do you see in the living camera?" got the report buttons as if you had asked for one. Now a question about anything else gets only the reason the AI cannot answer; the buttons come when your message uses a word of a report's name (daily, digest, weekly, monthly, report).

## 0.12.74

What you will see:
- **The report buttons no longer vanish.** After a report made from a button (the daily digest at 14:17), the next answer with buttons disappeared at once: the agent took it for that report's "being prepared" message and deleted it. Now the message whose button you tapped is the one replaced by the report, and later answers stay.

## 0.12.73

What you will see:
- **A report you name starts at once, even without the AI.** "Generate the weekly report…" while Anthropic is out of credit no longer offers buttons: the message names the weekly report, so it is made right away (from its figures and charts) and sent. The buttons appear only when the message names no report, or several.
- **A tapped button's message changes:** its buttons go and it says "Making the Weekly report without the AI…" (before, only a brief toast showed, and the buttons stayed as if nothing had been pressed).

## 0.12.72

What you will see:
- **Asking for a report while the AI is unavailable gives you buttons.** At 12:42 "Generate the weekly report" got only "out of credit": understanding your words needs the AI, so nothing could start the report. Now that answer also offers "Daily digest", "Weekly report" and "Monthly report". A tap makes that report without the AI, from its figures and charts, and sends it in the chat. Buttons are offered only to people who may start reports (Rules › The agent's own tools › Start a report).
- **"typing…" is now proven in the log:** each answer logs a line when Telegram accepts "typing…" (a refusal was already logged). If you still don't see it, the log will tell us whether it was sent.

## 0.12.71

The same as 0.12.70, which did not publish: one of the agent's own tests depended on how fast the build machine was. Nothing changes for you.

## 0.12.70

What you will see:
- **A report still arrives when the AI cannot run.** If Anthropic is out of credit, refuses the key, is overloaded or cannot be reached, the daily digest, the weekly report (and the owner's Monday lines) and the monthly report are still made from their figures and charts, and sent. The page and its message say at the top "Made without the AI", and why; VESTA's readings (and the translation) are what is missing. If even the figures cannot be made, you get "could not be prepared", as before. On the Costs tab such a run shows as "Without the AI", at no cost, with an (i) that says why.
- **An open fault in the Cockpit says what is wrong now.** A battery reported at 5% kept saying 5% after it reached 0%: each night the Kiosk's open faults are brought up to date (the history keeps what they said before).
- **A failed run on the Costs tab is a red (!)**: hover it (or tap on a phone) for the reason in plain words and the error itself, instead of the "api error 400" pill.
- **Every chart in the daily, weekly and monthly reports shows its value** when you hover (or tap) a point or a bar: the day and the figure.
- A repeated alert says since when in the villa's time ("4 times since Thu 1 Oct, 17:00").

## 0.12.69

**An urgent fix.** Since 0.12.67 the skills' scripts ran without the villa's knowledge pack, store and time zone (a mistake in that release). This morning's daily digest stopped on it ("fm-daily needs --pack") and last night's maintenance check most likely did not run — and it was recorded as "nothing to do". Both are fixed: the scripts get them again, and a script that is called the wrong way now counts as a failure (Overview → failures), never as "nothing to do".

Also:
- **The weekly report reads batteries by their unit:** a battery that reports volts (the weather station's) is drawn against its nominal voltage and shows its volts — it showed "3 %, replace". Without a nominal voltage it is left out (the night check asks for it).
- **"Offline" in the report means lost, as in the night check:** a sensor with no value just now (a wind chill on a warm day) is no longer counted as an offline device.
- **Times in the report are the villa's:** "offline since" in a to-do was Home Assistant's UTC time; a task made early on Monday counted in the week before.
- The device list no longer names one villa's phones or a person: a phone or tablet is known by Home Assistant's mobile app, network gear by its router integration — for any villa.
- The night check's thresholds are named settings (overridable by a villa helper), none hidden in its code.
- Reading Home Assistant can no longer loop on a page that keeps saying "more".
- "typing…": if Telegram refuses it, the log now says why (it said nothing). The Anthropic account ran out of credit at 09:43 today: the weekly report (Opus) stopped there and said so.

## 0.12.68

What you will see:
- **"typing…" stays on until the report you asked for arrives** — in a private chat and in a group — not only until "on its way".
- **Asking for a report again starts it again** once the last one is done. At 01:22 the AI answered "already being generated" from memory, 30 s after the report had been sent, and started nothing — so your new brain choice (Opus) was never used. The agent now says itself whether a report is still running.
- **The alert desk follows the villa's own settings**: its maintenance-mode quiet time and the villa's timings (it read them nowhere before, so the defaults always applied).
- **The siren switches itself off** after its minutes without needing a line written in the file by hand.
- The concierge skill no longer tells the AI to run commands it does not have.

Inside (third architecture review): policy.yaml is read once — a hand edit of the wrong shape could stop every reply and report; now it is named and ignored. Two jobs of a skill at the same time both run; the night's tidy never holds the clock; a retried AI run keeps what was asked on the Costs tab; old alert-button records are tidied.

## 0.12.67

What you will see:
- **Skills › About › What the AI may run: each command is a card**, like the tools in Rules › What the AI can use — three a line, two then one on a phone.
- **Tools it needs:** the line "Switched on or off in Rules › What the AI can use." is now the (i) after "6 tools, all switched on".
- **Rules › Acting on the villa:** the title, its (i), then the switch; the "On: it may act…" line is gone (the (i) says it).
- **Rules › What the agent may do:** "Approve buttons work for [15] min (i)" — the (i) after the minutes.
- **Reports:** a day is written "Mon 5 Oct", never "Mon 05 Oct"; "Its readings are missing since…" is now in the villa's time (it showed Home Assistant's UTC time).
- The history of changes names each setting exactly as the page does (it said "US$" and "An Approve button works for" where the page said otherwise).

Inside (the second architecture review of 7 October): one table of the rules file's settings; a skill's scripts read one way; the roi-energy skill no longer depends on the preventive-maintenance skill's folder; the Kiosk tickets, the alert buttons and voice messages are modules of their own; one way to set up the tests.

## 0.12.66

The rest of the architecture review of 6 October, finished:

- **Overview → Changes made on these pages: the instructions brought by an imported setup can be undone,** like every other change (before, Undo refused them).
- Import a setup: the list of what will change is shown 10 lines a page, each line a card on a phone, like the other tables.
- Inside, nothing you will see: the VESTA Agent page is now one file per tab instead of one file of 1,324 lines; every change made on the page is written and recorded in one place; the request behind "Try a command" is checked the same way by the page and by the agent.

## 0.12.65

An internal tidy-up of how the agent is built (the architecture review of 6 October), with three fixes you could have met:

- **The AI is never told "sent" for a message Telegram refused.** It then told you "the report is in your chat" when it was not. Now it is told nothing was sent, and says so.
- **A report you ask for in a chat that cannot run is one message.** Before, you got why it could not run, and its "being prepared" message also changed to "ended without a result". Now the reason replaces the waiting message.
- **A camera photo or a file that Telegram cannot take no longer stops the message** with an error the agent did not catch.
- Overview → "failures" now counts a skill's script that failed whoever ran it (the AI, a scheduled job or Try a command), not only the scheduled ones. Try a command shows "the script's own answer".

## 0.12.64

- Publishes 0.12.63 ("typing…" in Telegram while the AI works): 0.12.63 was not offered because a check on GitHub could not run. Nothing else changed.

## 0.12.63

- **Telegram shows "typing…" while the AI works on an answer.** The moving dots appear at the top of the chat (in a group: "… is typing" above the message box) from the moment the agent starts on a message until its answer arrives, then stop. Telegram does not let a bot draw a bubble with dots in the chat itself: this is its own "typing" sign.

## 0.12.62

- **Skills → Try a command: a try can save its result for the next step.** compose.py owner-weekly stopped with "needs --energy": it needs the week's energy, which roi-energy's energy_period.py makes, and the page could not save that. Commands that write a file now show an "Out" box: run energy_period.py with Period week and Out week.json, then in reports pick week.json under Energy. A saved file appears in the menus at once.
- The (i) of Try a command says so, and says the try changes nothing in Home Assistant (it may update the agent's own records, as nightly.py does).

## 0.12.61

- **Skills → Try a command: a step that needs a file from an earlier step can be tried.** compose.py fm-weekly stopped with "needs --facts": it builds the weekly page from the figures facts.py saved, and the page offered no way to give them. Options that take a file (Facts, Notes, Energy) now show a menu of the files the last runs left, the one with the option's name chosen first (facts.json, notes.json).

## 0.12.60

- **The nightly maintenance check can be run again for a day it already checked.** Running nightly.py from Try a command (or twice for the same day) stopped with "UNIQUE constraint failed": an event noted the first time (a meter going backwards, a pump's running hours…) was written a second time for the same day. Now the second run updates what the first one noted and does not report it as new again.

## 0.12.59

- **Skills → Try a command: a long command no longer ends in "Error 524".** Through the Cloudflare tunnel, a page that waits more than 100 seconds is cut off, and nightly.py checks every device for minutes. Run now answers at once; the page shows "Running on the villa… N s" and fetches the result when the command ends, however long it takes (up to 15 minutes). A long try no longer holds up another try or "Read the list again".
- The explanation under "Try a command" is now in an (i) beside the tab's title, shown on hover or tap like the other (i)s.

## 0.12.58

- **A camera picture the AI looks at now always comes with its answer.** 0.12.57 gave the AI a way to send the photo, but it did not use it: asked again for the living room camera, it looked, wrote "here's the current view", and you got text only. Now the agent itself attaches every camera picture the AI looked at while answering you: the photo arrives with the answer as its caption (up to 4 pictures per answer). Only where cameras are allowed (Rules → What the AI can use). If Telegram refuses the photo, the answer still arrives, saying the picture could not be sent.

## 0.12.57

- **Asked for a camera photo, the AI now sends it to the chat.** Before, it looked at the camera itself, described what it saw, and said "the image I just sent" when nothing had been sent: it had no way to send a picture. Now the photo arrives in the chat, with its answer as the caption. Only where cameras are allowed (Rules → What the AI can use). If the camera gives no picture, the AI says so instead of claiming it sent one.
- A camera photo Telegram refuses is now noted in the log, instead of a message with no photo.

## 0.12.56

- **Rules → The AI: "new conversation" is now "Delete conversation context at"**, under its menu (Every day at 04:00, After 8 hours of silence, Never). The same name appears in the history of changes and in the setup download.

## 0.12.55

- **Rules → The AI: the "New conversation" menu lines up with the brain and the limit** on the Chat answers line, its name under it like "for each reply".

## 0.12.54

- **Rules → What the agent may do shows 10 lines a page** (People keeps 15).

## 0.12.53

- **What the AI can use: each tool is a card** with its name, its switch, what it does and its notes. Cards sit at most four to a row: three, two or one as the screen narrows. Both "Reading Home Assistant" and "The agent's own tools" use them; the Reading tab shows 16 cards a page.
- **Rules → The AI: the two notes under the table moved into (i)s:**
  - "Limit (US$)": what a limit means, and the month's most at those limits, computed as you change them.
  - "Tools it gets": what chats and reports get.

  An (i) now takes the size of the text it sits beside. "New conversation" sits on the Chat answers line.
- **Acting on the villa: just the switch, before the title,** with "On" or "Off" in words beside it. "Approve buttons work for (minutes)" moved to What the agent may do, on its title's line, where the buttons come from.
- **Copy the setup → Download:** the villa files option now reads "This villa's own choices inside the skills", with what that means underneath.

## 0.12.52

- **The (i) beside a title shows its text as a tooltip,** on hover, and on a tap on a phone. It no longer opens text in the page. A second tap, a tap elsewhere, Escape or scrolling closes it.
- **Costs: the period selector sits on the title's line, on the right.**
- **Skills → Try a command:** the line repeating the chosen script is gone; Run sits under the options.
- **The device picker in "What the agent may do" displays properly:** its list floats over the page with normal checkboxes, instead of being squeezed into the table cell with checkboxes as wide as the cell.
- **One way for every floating list:** the menus, the device pickers and the (i) tooltips open and close the same way (below the box, or above when there is no room; closed by a tap elsewhere, Escape or scrolling). The tab bars and the Previous / Next pagers are also one design each.

## 0.12.51

- **Rules → What the AI can use → "Ask for an action on the villa"** now links to "Acting on the villa" and "What the agent may do": a tap scrolls there and highlights it.
- **Skills → About: a script without commands says what it does** (from the skill's own skill.yaml: `description:`), with its options listed one by one, instead of "the AI may run it".

## 0.12.50

- **Rules → What the agent may do: the devices are on the service's own line.** For "Only the devices chosen beside it", a device picker opens on the same line; for every other rule there is nothing to choose. The separate "Allowed lists" card is gone. Services of one kind share one list ("same list as switch.turn_on"). The rule names are plain words.
- **Every card's description is behind an (i) beside its title:** hover, or tap on a phone. A card that has nothing else to show keeps its text.
- **Overview: "Copy the setup to another villa" is one card with two tabs,** Download and Import.
- **Overview: "Changes made on these pages" shows 10 lines a page** and is trimmed every night with the agent's other records (90 days by default).
- **Skills deleted or replaced on the page** (kept in skills/.trash to undo a mistake) are now removed after the same time as the agent's other files (90 days). Until now they were kept for ever.
- **Costs opens on the last 7 days, and everything on it follows the period you choose:**
  - the figures (total, runs, per run, busiest day);
  - the chart;
  - by work and by model;
  - every run;
  - the tools.
- **Skills → Try a command, in three steps:** what to run, its options in words, then the exact command it will run, and Run. The result says "Done", "Nothing to do", or why it stopped.

## 0.12.49

- **Long lists on the Rules page show 15 lines at a time,** with Previous / Next: People, What the agent may do, and What the AI can use → Reading Home Assistant (each group's heading repeats on the page where its tools continue). "Add" opens the last page, where the new line is.
- **Who may use what: the columns line up** under their headings. The guest column shows "—": the agent answers only the people listed under Rules → People (owner or facility manager), so a guest gets no answer at all for now. The text under the tabs says so.

## 0.12.48

- **Skills: each skill's On/Off switch is in the list on the left,** beside its name.
- **The skill page no longer repeats the skill's name and description** above the tabs: the list beside it already shows them. The state ("Follows the releases", "Edited here") sits on the tabs' line.
- **On a phone, where the list is hidden while a skill is open,** the name, the state and the switch stay at the top of the page.
- **Rules → The AI is tidy again.** "Tools it gets" is one line per report ("12 tools from reports"); tap it for the list. The columns line up. On a phone, each report's stop button sits beside its brain and limit.

## 0.12.47

- **A clearer skill page (Skills tab).**
  - **On top:** the skill's name, its state and its On/Off switch. Then only what needs you: the "Not working" fix, or "another version of this skill" with Compare / Keep mine / Take the release version.
  - **Four tabs:** About, Files, Try a command, Compare. One thing at a time instead of everything on one screen.
  - **About** has three sections:
    - **When it acts:** the schedule first, one aligned line each.
    - **What the AI may run:** a switch per command, with what it does underneath.
    - **Tools it needs:** one line ("12 tools, all switched on"), with only the tools that are off shown, and the full list folded away.
  - **Files:** the editor and its file buttons; a dot marks a file that differs from the release or belongs to this villa.
  - **Compare:** only the changed lines and two around them.
- **On a phone:**
  - Opening a skill shows it alone, with "‹ All skills" to go back. Before, the list pushed it a screen down.
  - Rows stack; the comparison is one column with "here" and "release" labels.
  - The skills list keeps each description to two lines.

## 0.12.46

- **Choose what the AI can use: Rules → What the AI can use.** Three tabs:
  - **Reading Home Assistant:** every Home Assistant tool, grouped, with a switch, what it does, and how often it was used this week. Only a tool that changes nothing in Home Assistant can be switched on; the ones that change it are listed as "Never available". A tool added by a Home Assistant update arrives "New" and off. "Read the list again" fetches the list on demand.
  - **The agent's own tools:** switch off web search, facility tickets, starting a report from a chat, or reading its own activity.
  - **Who may use what:** what the facility manager may make the AI use, group by group. The owner gets everything that is switched on.
- **Reports get only the tools their skill lists.** Rules → The AI shows the tools of each report.
- **A fuller Skills tab.**
  - **On/off switch:** a skill switched off is kept, but not used: no schedule, no alert hook, not read in a chat.
  - **Its state:** follows the releases, edited here, or this villa's own.
  - **The tools it needs, when it acts, and its commands as checkboxes.** The checkboxes are this villa's choice, saved in the skill's own villa file, so updates keep them and copying the skill carries them.
  - **"Not working" when a tool it needs is switched off,** with a button that switches it on. Its reports do not run until then, and their chat is told why.
  - **An edited starter skill:** "Compare with the release" shows its files side by side. "Keep mine" or "Take the release version": your edits go to the trash folder, and Undo brings them back.
  - **"Try a command"** runs one of the skill's commands on the villa, exactly as the AI would, with no AI and no cost. Messages and tickets it would make are shown, never sent.
- **Costs: the tools each run used.** Tap a run to see each step. A new table counts how often each tool was used.
- **Overview: changes made on these pages.** Every save on Rules and Skills, newest first, each with Undo. Undo is refused if something changed since.
- **Copy the setup to another villa.** Overview → "Download the setup" saves the skills and the shareable part of the rules in one file. It never includes people, chat ids, devices, keys or records. On the other villa, "Import a setup" shows every change and what does not fit before anything is written.
- **Leaner.**
  - **No test mode any more:** the "Agent mode" and "Stub heartbeat" options are gone. With nothing configured, the app runs, its page opens, and the agent waits, saying in its log what is missing.
  - **Unused and duplicated code removed:** eleven unused pieces, calculations written twice, and test-only material that was installed on the villa.
  - **The VESTA icon now sits in the report page itself.**
  - **Old records converted once:** reports' run names, and tasks from before 1 October, instead of being read two ways.

## 0.12.45

### Fixed
- **When the AI cannot answer, you are told why, in plain words.** Out of Anthropic credit, an API key refused, too many requests, Anthropic's servers overloaded or down, no internet, a conversation grown too long: each now has its own short message. Before, you got a vague "could not answer", or, in some cases, the raw technical error text. When the credit runs out or the key is refused, the owner is also told in the owner chat (at most twice a day), since nothing works until they act.
- **A scheduled report that cannot run now says so** in the chat it goes to. Before, it failed silently and the report never came.
- **Saving the Rules page no longer drops settings it has no fields for.**

### Changed
- **The agent's records no longer grow forever.** Until now nothing was ever deleted: every run, every conversation transcript, every alert copy and report page, every day of device figures. Each night the oldest are removed:

  | What | Kept for |
  |---|---|
  | AI runs (the Costs tab) | 400 days |
  | Its other records | 90 days |
  | Conversation transcripts | 30 days |
  | Its files | 90 days |
  | Daily device figures | 24 months |

  The villa's history (incidents, findings, tasks) is kept. Each limit can be changed under `settings.keep` in Rules (file).
- **Questions on the agent's page use its own style.** "Unsaved changes", "Delete the skill?", naming a new skill or file and error messages now appear in a VESTA window instead of the browser's grey box. (Closing or reloading the browser tab with unsaved changes still shows the browser's own warning: a page can ask for it, never draw it.)

## 0.12.44

### Changed
- **The skill and rules editors wrap long lines.** On the Skills page (and in Rules (file)), a long line now continues on the next line of the editor instead of running off to the right, so everything is readable without scrolling sideways. Only the display changes: the file is saved exactly as written, YAML indentation included.

## 0.12.43

### Changed
- Behind the scenes: the release checks now install the same system library as the app (the one that reads voice messages). 0.12.42 was never published because of this; everything listed under 0.12.42 arrives with this version.

## 0.12.42

### Added
- **Voice messages.** Send the agent a voice message in your private chat, or as a reply to one of its messages in a group, and it answers as if you had typed it. Home Assistant's own speech-to-text (your Whisper) turns it into text; the recording is deleted as soon as it is read. It is transcribed in the language saved for you on the VESTA Agent page, so set that to the language you speak. Needs "Telegram takeover" on.

### Fixed
- **"The kitchen lights" now means the lights in the Kitchen area.** The agent picked devices whose internal name contained "kitchen", and switched on the dining table light, which Home Assistant places in the Living Room. It now goes by the area set in Home Assistant, including the area's other names (aliases). It uses device names only for a device without an area, or when no area has that name.
- **The agent answers in the language you write in.** It used to answer in the language saved for you, whatever language you wrote in. The saved language is now used only when a message doesn't tell (a number, an "ok") and for what the agent sends on its own.

All three rules live in the villa-concierge skill (its instructions and scripts), not in the app, so a villa can adjust them and copy them to another villa. The skill updates itself unless you have edited it.

## 0.12.41

### Changed
- Behind the scenes: every release is now checked with Home Assistant's own app checks before it is published. Nothing in the app changes. Two settings that only repeated Home Assistant's defaults were removed from the app's description. What the app is allowed to do is unchanged: it still has no special access to Home Assistant, and its page is still for administrators only.

## 0.12.40

### Changed
- Behind the scenes: updates are published faster. The ARM image (the one your Home Assistant Yellow runs) is now built and checked on ARM hardware instead of being emulated, which took 4-6 minutes off each release. Nothing in the app changes.

## 0.12.39

### Changed
- **Dates in reports and maintenance messages are written one way: "5 Oct".** Some said "05 Oct" and others "5 Oct", sometimes in the same report. (The reports and maintenance skills update by themselves on the villa unless you have edited them.)
- Behind the scenes: the checks run before each release take about 39 s instead of 77 s, and some unused code was removed.

## 0.12.38

### Fixed
- **A long job no longer pauses the alert chase.** The scheduled jobs ran one after another, so while the 02:00 maintenance check worked (up to 30 minutes), or a morning AI report ran, the every-5-minute alert chase and the "villa silent" watch did not run at all. A real alert in that window was not followed up until the job finished. Every job now runs alongside the others: the chase keeps its 5-minute rhythm, a job still running is never started twice, and the night's checks still wait for the knowledge pack to be rebuilt first.

## 0.12.37

### Fixed
- **A mistyped "may act" setting can no longer switch acting on.** If the rules file said `act_enabled: "false"` (in quotes, as hand edits sometimes do), the page correctly called it a mistake, but the VESTA Agent read it as ON and could act on the villa. Anything that isn't a plain true now means OFF.
- **A mistyped chat id no longer stops the VESTA Agent.** A chat id written as text (not a number) in the rules file made every message, button and job fail until the file was fixed. That chat is now skipped, and the page names the mistake.
- **A person with an invalid Telegram id is really ignored,** as the page says. Before, they were still registered.
- **Only the person who asked can press "Continue"** on an answer that stopped at its spending limit. In a group chat, someone else could continue it, in their own role and on their own budget.

## 0.12.36

### Fixed
- **Chart axes show exact values.** Steps of 2.5 or 0.25 were rounded on the axis: the Costs chart read "$3" and "$8" for $2.50 and $7.50, and a report chart read "0.2" and "0.8" for 0.25 and 0.75. Every axis now shows its values exactly ("$2.5", "0.25"). (The reports skill updates by itself on the villa unless you have edited it.)

### Changed
- Behind the scenes: the reports and the Costs page now share one rule for chart axes.

## 0.12.35

### Changed
- **Costs → "Every run" is shorter on a phone.** Each run takes three lines: when and what, the brain, then tokens and cost.
- **Old runs count under today's job names.** Runs from before 1 October were recorded as "reports:07:00" and "reports:1 08:00". They now show as fm-daily and owner-monthly, so each job is one line in "By work".

## 0.12.34

### Fixed
- **The Costs page's tables read properly on a phone.** "Every run", "By work" and "By model" had their columns running into each other. On a phone each row is now a small card, with every value labelled. On a wider screen the tables are as before. (0.12.29 caused this when it fixed the editable tables.)

## 0.12.33

### Changed
- **"Every run" on the Costs page shows one line per run.** The table now shows only what each run was ("fm-weekly", "Reply to …"). Where a reply came from and what was asked are in a tooltip: hover a dotted-underlined name, or tap it on a phone to show the details under it.

## 0.12.32

### Fixed
- **A report can no longer get stuck drawing a chart.** When a sensor's readings were identical except for a tiny rounding difference in the last decimal place, drawing that chart's axis never finished, and the report never arrived. Such readings are now drawn as a flat line. (The reports skill updates by itself on the villa unless you have edited it.)

## 0.12.31

### Fixed
- **Percentage charts in the reports stay within 0–100 %.** A line ending at 100 % used to be drawn under an axis going up to 110 or 115. The axis now stops at 100 while every value is between 0 and 100. A % figure that really goes above 100 keeps its full range. (The reports skill updates by itself on the villa unless you have edited it.)

## 0.12.30

### Fixed
- **A siren device can sound in an alert.** The Siren choice offered devices of the "siren" kind, but during an alert the VESTA Agent always asked for a switch, so a real siren device was refused ("The siren cannot be requested"). The siren now turns on and off with its own kind of service. As with every action, that service must be allowed in "What the agent may do", and the timed switch-off in the agent's system actions.
- **"Buttons it may press" offers only buttons it can actually press.** It also offered Home Assistant helper buttons, which saving then refused.

### Changed
- The rules, lists and kinds of devices on the Rules page now come from the VESTA Agent itself, so the page and the checks can no longer disagree.

## 0.12.29

### Fixed
- **The service, people and AI tables on the VESTA Agent page fit the screen.** A long rule like "listed — only the devices in the lists below, then approval" pushed the services table off the right of a phone and cut the service names to a few letters. The columns now keep their width, and a long choice ends in "…" (open it to read the whole text). On a phone, each service shows its name with a remove button, and its rule on the line below. Each person shows name and Telegram id, then role and language.

## 0.12.28

### Changed
- **Every dropdown on the VESTA Agent page now opens the page's own list, in its colours.** This covers Language, Role, Brain, New conversation, Rule and the Costs period. They used to open the phone's own picker (on Android, a grey sheet of radio buttons). The list opens under the field, or above it near the bottom of the screen, and the current choice is ticked.

## 0.12.27

### Changed
- **The waiting message of a report you ask for in a chat is now always dealt with.** It is removed when the report arrives, even if the report arrives before the waiting message itself. If the job ends with no report, the waiting message says so, even if the job ends very fast. When one request starts two jobs, the waiting message waits for both.
- **The morning message groups problems exactly as the weekly report does.** Devices are named as in Home Assistant, not guessed from the sentence. A group line shows its most urgent item's priority.
- **The nightly check counts a device once, whichever rule raises it.** "Offline", "not reporting" and "keeps dropping off" now recognise the same device the same way.

## 0.12.26

### Changed
- **Every report you ask for in a chat works the same way: one waiting message, replaced by the report.** This now includes the daily digest, which arrives as text rather than a page (0.12.25 replaced the waiting message only when a page arrived). The weekly and monthly reports behave as in 0.12.25.

## 0.12.25

### Changed
- **A report you ask for in a chat is one message.** The VESTA Agent answers once ("your weekly report is on its way"), and when the report is ready that message is replaced by the report itself. You no longer also get the owner's three weekly lines as a third message: those come only with the scheduled Monday report. If a report cannot be made, the waiting message says so instead of promising one.

## 0.12.24

### Fixed
- **A sensor that really stops is still reported, even if it stopped once before.** Checked against the villa's own history after 0.12.23: the Temp and Humidity sensor that went silent on 2 October had already been frozen for six days in September, and 0.12.23 would have mistaken it for a sensor that only reports on a change. A sensor is now judged on the three days before it went quiet.

## 0.12.23

### Fixed
- **Far fewer false maintenance alerts, in Telegram and in the Kiosk's Cockpit.** One morning message listed 24 "new" problems, then repeated them under "Still open". Most were not problems:
  - **"Has not reported" now means a sensor that normally reports all the time has stopped.** Curtains report only when they move and rain gauges only when it rains; after a Home Assistant restart they looked "silent" for days. A sensor is now judged against its own history, so the Temp and Humidity sensor that really stopped sending is still reported, and the curtains and rain gauges are not.
  - **One device is one line.** A sensor's temperature, pressure and battery were three alerts; a relay, its firmware and its uptime were three more, two of them shown as technical names.
  - **A Home Assistant restart no longer counts as a device dropping off.** Every restart takes every device offline for a moment; that was counted as the device's own Wi-Fi or power problem.
  - **Pump energy is judged on whole days.** The nightly check ran at 02:00 and counted that night's two hours as a full day, and counted a day the plug was offline as a day of low use ("Onsen pump used 0.09 kWh/day … −80 %").
  - **"Unknown" is no longer "offline".** A wind chill has no value on a warm day while the weather station reports normally.
- **The morning message says each thing once**: what is new is not repeated under "Still open", and several of one kind are one line ("4 sensors have not reported: …").
- The tickets these alerts opened in the Kiosk close by themselves after the first night with this version.

## 0.12.22

### Changed
- Nothing changes for you. The agent's own records (which scheduled jobs already ran, which messages carry an alert's buttons, which files the AI saved) are now kept through one set of named operations instead of loose keys; what the agent already holds is read as before. A scheduled job can no longer be started twice in the same slot if two checks run at once.

## 0.12.21

### Changed
- **Costs: the period selector sits on the same line as "Period"**, at its natural width, instead of a wide box on a line of its own. A thin line now separates it from the key figures below.

## 0.12.20

### Changed
- **The agent page's title line holds everything.** The version now sits right after "VESTA Agent", shorter ("v0.12.20 · dev"; hold or hover over it for the full detail), and the Light / Auto / Dark switch sits on the same line, at the right. On a phone the switch no longer takes a line of its own.

## 0.12.19

### Changed
- Nothing changes for you. New checks make sure the agent and the app that starts it always agree on every setting passed between them (names, folders, and the version of the agreement with the VESTA Kiosk), so a renamed setting can no longer leave the agent silently without its Kiosk or Home Assistant access.

## 0.12.18

### Changed
- **The figures on the agent page use the whole width of a phone.** On the Overview ("The last 24 hours") and on Costs, the numbers were stacked one below the other down the screen. They now sit two to a row on a phone, and more side by side on a wider screen.
- How agent releases are made is now one command that writes the versions, runs every check and waits until Home Assistant can offer the update. Nothing else changes for you.

## 0.12.17

### Fixed
- **The agent's reports have the VESTA icon.** A report opened from Telegram showed a blank icon in the browser's tab and bookmarks. Every HTML page the agent sends now carries the VESTA "V" (the same one as the VESTA Kiosk, light or dark to match your phone's theme). The icon is stored inside the page, so it shows with no internet. This applies to every report, including ones from skills you add later. A page that sets its own icon keeps it.

## 0.12.16

### Fixed
- **A fault closed in the VESTA Kiosk stops being chased.** Closing an alert's fault in the Kiosk closed the agent's task but not the alert itself: the agent kept reminding the facility manager and escalated to the owner. Now the alert closes with it, and its Telegram messages lose their buttons ("Closed in the VESTA Kiosk").
- **In a chat, everything the agent sends goes to that chat.** A check the agent ran while answering someone could still send its messages to the facility manager's chat; now, as for the agent's own answers, only the chat that asked receives them.
- **The reports, the morning digest and the concierge agree on what is still open.** The morning digest counted the facility manager's tasks while the weekly page listed the problems themselves; a fault closed in the Kiosk now leaves both. The digest no longer asks to reply with numbers that no reply could close: an alert keeps its "#N", the rest is closed in the Kiosk.
- An alert's outcome in a report is always in words ("Reminder sent", "In the morning digest"…), never the agent's internal word.

### Changed
- Under the hood (no visible change otherwise): one place decides whether a problem is still open, one decides where a message goes and what the AI may do in each situation, and the agent page asks the agent for the brain names and the schedules instead of keeping its own copy.

## 0.12.15

### Changed
- A fault the agent files in the VESTA Kiosk has a short title saying what is wrong ("Rain gauge has not reported for 2.0 days."), and what to check as its note, instead of both in one long title.

## 0.12.14

### Fixed
- **The Kiosk's Cockpit filled with faults that were long gone.** The nightly check closed its findings but never their Kiosk tickets, so every false alarm ("has not reported", a device back online) stayed an "Open fault" for ever. Now:
  - when the night check no longer sees a problem, its Kiosk ticket is resolved ("Cleared: the nightly check no longer sees it.");
  - at each start and each night, the agent closes the tickets of problems already gone (the ones left over from before), and closes its own task when a person resolves the fault in the Kiosk.

## 0.12.13

### Added
- **Light / Auto / Dark** switch in the page's header, like the VESTA Kiosk (Auto follows the device). The choice is kept in that browser.

### Changed
- **Choosing devices:** each box opens a list with a search and a checkbox per device (name, room · id); tick as many as needed. The chosen devices show inside the box. The siren is chosen with a single click.
- The fields of a card line up ("Siren stops after" sat higher than the others), and a long device name no longer spills into the next field.
- **Charts have a Y axis with grid lines and values:** the Costs tab's cost per day (with a date under the bars) and every chart of the weekly and monthly reports.
- Costs: the fourth figure is the average cost per run for the period (it repeated "Last 7 days").

## 0.12.12

### Changed
- People can be answered in Chinese, Japanese and Korean too (Rules → People → Language).

## 0.12.11

### Changed
- One **Rules (file)** tab instead of two: a click on "Rules" opens the forms, a click on "(file)" opens policy.yaml itself.

## 0.12.10

### Changed
- **An alert's buttons go away everywhere at once.** An alert can be in several chats (a P1 goes to the owner's chat and the facility manager's) and repeated by reminders. When someone presses Done, Not found, Need help or Mute on any of them, or types "#2 done", every copy loses its buttons and shows who answered and when ("Done — Alex, 08:31"). When Home Assistant clears the incident itself, every copy says "Cleared in Home Assistant, 08:40. No reply needed."

## 0.12.9

### Added
- **Costs** tab: what the AI cost today, over 7 days, this month and the chosen period (7, 30 or 90 days); a bar per day; the cost by work (chat replies, each AI job) and by model; and every run (when, what it was and who asked, the brain and model, the tokens, the cost, whether it stopped at its limit), 10 to a page. The model and the tokens are recorded from this version on.

### Changed
- **Devices are chosen by name, not typed.** Protected devices and the allowed lists offer the villa's own devices (name and room, from the agent's nightly reading of Home Assistant); each chosen one shows as a tag with ×.
- **Language** is a menu of the languages the agent writes in, not a text box.
- **The AI:** each limit says what it is for ("for each reply", "for each run") and each job says when it runs ("every Monday at 08:00, or when asked in a chat"). Below the table: the most the scheduled runs can cost a month at their limits.
- **Skills:** the green "on" label is gone; a skill whose files have a problem shows "not working" (it was never a switch).
- **Overview:** "Scheduled jobs run" is a table, 10 to a page.

## 0.12.8

### Fixed
- **A report asked for in a chat came back in another chat.** Asked in the group, the weekly was made inside the conversation and sent to the facility manager's chat; the group only got "Done". Now:
  - whatever the agent sends while answering a person goes to that person's chat, never to another one;
  - a report asked for in a chat always runs as its AI job (its own brain and spending limit), never inside the conversation. This holds for every report a person may ask for: the daily digest, the weekly and the monthly.

### Changed
- The daily digest can now be asked for in a chat too, like the weekly and the monthly (it runs once it is set under Rules → The AI).
- **Rules (file)** is its own tab next to **Rules**: the "Forms / The file" sub-menu is gone.
- **Overview:** the Rules and Skills cards are gone (their tabs are one click away); a problem in the rules or a switched-off skill is still shown there. A line now separates "Scheduled jobs run".

## 0.12.7

### Changed
- **The weekly report reads like the example PDFs.** One "Do this week" list: each device appears once (a pump's power drop and its open task are one line), and many devices with the same problem share one line ("4 monitoring devices offline — all since 1 Oct, 09:28: one cause is likely"). The separate "What VESTA noticed" section is gone. The monthly report's "Preventive maintenance" uses the same list.
- **Alerts that fired:** one line per alert with how many times it happened, in plain words ("Entrance unlocked — 6 times"), instead of one row per rule run.
- The reports skill has 6 files instead of 29 (the page is one template file; the charts are in compose.py).

### Fixed
- **The weekly showed 71 "critical alerts" that were not alerts.** It counted every time a safety rule *ran*. The pump schedule rules run twice a day to check the pumps and almost never alert. Home Assistant's record now counts only the rules that alert every time they run (the "condition" rules); the others come from the agent's own record.
- "Nothing happened" only says what was actually watched: for a week the agent was not listening, it no longer claims "no equipment missed its schedule".
- **Sensors reporting an unchanged value were tasks** ("has not reported for 1.6 days"): a rain gauge at 0 or a curtain nobody moved. A sensor is now silent only when it stops *reporting*, not when its value stops *changing*.
- A pump that runs a few minutes at a time no longer shows a fake "power down 31%" (its hourly averages follow its use, not its water).
- Circuits: "+10900%" from almost nothing shows as ">+300%"; an empty comparison shows "—".

## 0.12.6

### Changed
- **The AI** is one section, laid out like "What the agent may do": one line per piece of work (chat answers, then each AI job) with its Brain and its Limit (USD). A job that is not set shows "+"; "×" stops it. On a phone, each line puts the work above its brain and limit.
- "The agent may act on the villa" and the Approve minutes sit on one line, as do "New conversation" and "Web search" (they stack on a narrow screen).
- **Skills:** the file list of a skill shows one line; "All N files" shows the rest ("Show fewer files" folds them back). The open file is always on that line.

### Fixed
- **A report asked for in a chat comes back to that chat, and only there.** Before, the agent was only told to; it could still send the page to the facility manager's chat (the weekly's own steps name it). Now everything such a report sends, including the owner's lines, goes to the chat that asked.
- On a phone, a skill's editor made the page wider than the screen.

## 0.12.5

### Changed
- The "AI jobs" card on the VESTA Agent page now looks like "The AI" above it: each job with its own Brain and Limit per run fields, and Set / Stop buttons.

## 0.12.4

### Fixed
- **The VESTA Agent page still used old page code** through Cloudflare (no app version in the corner, the old "page met an error" line). The page's files now carry the version in their path, which no cache can ignore.
- The app's version did not reach the page; it now does ("app 0.12.4 · agent 0.6.4").

## 0.12.3

### Changed
- The VESTA Agent page shows both versions in its top right corner: the app's (as on Home Assistant's app page) and the agent's inside it, for example "app 0.12.3 · agent 0.6.3 · dev".

## 0.12.2

### Fixed
- The VESTA Agent page showed "The page met an error: error" when Home Assistant is reached through Cloudflare: Cloudflare adds its own analytics script to every page, which the page blocks on purpose. Only the page's own files now count as errors.

## 0.12.1

### Fixed
- **The VESTA Agent page could show the previous version's page** after an update (no "AI jobs" card, no "Add them" banner): when Home Assistant is reached through Cloudflare, Cloudflare kept the old page code. Its files now carry the version in their address, so an old copy can never be used again.
- Two spacings on the page were blocked by the page's own security rule; they now come from its stylesheet.
- If the page meets an error in your browser, it now says so on the page and writes it to the app's log.

## 0.12.0

⚠️ **After updating, open the VESTA Agent page and press "Add them"** (or Rules → AI jobs): the daily digest and the weekly and monthly reports now each need their brain and spending limit set, and do not run until they are.

### Added
- **VESTA's readings in the weekly and monthly reports**, as in your mock-ups: the AI now reads the villa's data like a property manager — what changed and when, what it means, what to check, what to ask, when to act and what ignoring it costs — in the headline, in a new "What VESTA noticed" section, in each task, under each chart and in a "nothing else happened" line. Its conclusions carry its own numbers and are marked "VESTA's reading"; the tiles, tables and charts stay computed.
- **A playbook in the reports skill**: the situations the agent recognises (a pump's power stepping down at the same hours, its running time changing, a battery falling, a safety device offline, electricity used while the villa is empty…). The villa adds its own in `villa.reports.yaml`, which app updates keep.
- **AI jobs on the VESTA Agent page**: each job's brain and spending limit; a job not set does not run (banner, "Add them").
- **Ask for a report in a chat** (`/ask make the weekly report`): it runs as its job and the page comes back to that chat.

### Changed
- A report that reaches its spending limit is still sent, with every figure and the readings written so far.

## 0.11.0

### Changed
- **The weekly and monthly reports follow your mock-ups.** Weekly: the colour of the week, the four tiles, the tasks, the alerts that fired, a chart per pump, the batteries, kWh per day against last week, the circuits, the monitoring's own health. Monthly: the cost, the tiles, what happened, what was fixed and suggested, preventive maintenance, the trends, the monitoring's health and what would help. Every figure comes from Home Assistant and the agent's records; the AI writes only the sentences, and a sentence with a number that is not in its section is refused. Money left on the table, night standby and monitoring uptime say "not measured yet" for now.
- **What a report shows is set in the reports skill** (`reports.yaml`, editable on the VESTA Agent page): its sections and their order, the thresholds, the sentences the AI writes.
- **Alerts in a report include those Home Assistant handled alone** (while the agent was not there), read from Home Assistant's own record of the VESTA rules.
- **One rule decides which chat a message goes to**: a reply where the person wrote or pressed; scheduled and alert messages to their role's chat; approvals to the chat they were asked from, or the owner's; a message for both roles sharing one chat sent once.
- **The siren's sounding time is set in one place**, `policy.yaml` (`siren_auto_off_min`).

### Fixed
- **A skill run from a chat now does what it does on schedule**: its Kiosk faults are created and its messages sent. Before, a maintenance check run from a chat stored its tasks but never created their faults, and the night run then skipped them.
- **Faults that never reached the Kiosk are created**, at every start and every night.
- **The maintenance check read the same logbook page 20 times** and counted each device's drop-outs 20 times; it now reads it once.
- Asking for the next part of a long script answer no longer runs the script again.

## 0.10.0

### Added
- **The VESTA Agent page, in Home Assistant's sidebar** (administrators only), in the VESTA Kiosk's look. **Rules**: the agent's `policy.yaml` as forms (acting on or off, people, chats, what the agent may do and who decides, protected devices, allowed lists, AI settings), plus the whole file. **Skills**: see, edit, add and delete skills and their files while the agent runs. **Overview**: problems to fix and the last 24 hours. Every save is checked with the agent's own rules first, the file's comments are kept, and a file changed elsewhere meanwhile is never overwritten. The page keeps working while the agent is stopped.

### Fixed
- **A report asked for in a chat is sent to that chat.** Asked in the group, the weekly report went to the facility manager's chat (a private chat) and the group got only "report sent".
- **Asked again, the agent does the job again**, instead of repeating an earlier failed attempt from the same conversation.

### Changed
- The app's log now says when `policy.yaml` holds something the agent ignores (a misspelt section, a person without a Telegram id).

## 0.9.4

### Fixed
- **"Generate a weekly report now" works.** The report page was built without the week's energy figures and stopped with "a template error". The reports skill now spells out its two steps, and the page builder says exactly what is missing instead of failing. The owner's Monday lines also use the week's figures (they could say "kWh n/a").
- **A failed skill script is now in the app's log**, with its reason, not only in the chat.

## 0.9.3

### Added
- **Actions without the Approve button, where you choose.** A new rule, `direct`, in `policy.yaml`: for example `light.turn_on: direct` and `light.turn_off: direct`, and a light is switched as soon as a registered person asks in a chat; the reply says whether it worked. Alerts and scheduled jobs still ask, and owner-only devices still wait for the owner. See the Documentation tab, "Acting on the villa".

## 0.9.2

### Fixed
- **An approved action now happens.** Pressing Approve (for example "Turn on Pool Bottom") failed with "Home Assistant refused or failed": the agent sent the device in a form Home Assistant's MCP server does not accept. The app's log now also says why when an approved action fails.

### Changed
- **Updates are much smaller.** The app was built so that any change to the agent re-sent almost the whole app (about 840 MB of 1.1 GB). It is now stacked with the agent's own code last: an update that changes only the agent downloads only that, well under 1 MB. This update itself is still a full download, one last time.
- **No more PDF: the app is half the size** (about 530 MB instead of 1.1 GB). The weekly and monthly reports arrive as a message with the headline and the key numbers, plus the full report as an attached page: tap it and the phone opens it in its browser, which can print it or save it as PDF.
- **Starter skills now follow the updates, unless you edited them.** A starter skill you never changed is replaced by the new version and the log says so; one you edited is kept, and the new version is left beside it in `skills/.starter/` to compare.

## 0.9.1

### Changed
- **Alert buttons go once pressed.** The alert message then says who answered, what, and at what time, and the answer goes to the chat where the button was pressed (no longer to the group).
- **Plain text on Telegram**: no more `**` around words.
- **While acting is off, the agent no longer offers to do things** ("shall I turn it on?"); it says it informs only.
- The Kiosk fault created for an alert no longer starts with 🚨.
- **The app's log tells the story of each alert**: received, handled, each message sent and to which chat, each button pressed, each Kiosk fault created or resolved, each reply and what it cost.
- **Ask "what did you do last night?"**: the agent reads its own record (jobs run, alerts followed, buttons pressed, faults, cost) and answers. It changes nothing.
- The help text for the Home Assistant token was wrong: keep the "VESTA Agent" user **Active**, with "Can only log in from the local network" on. Turning its login off makes Home Assistant refuse its token.

## 0.9.0

### Added
- **The real VESTA Agent is inside the app.** Switch *Agent mode* to `agent` to run it: it answers the owner and the facility manager on Telegram, follows up every critical alert of the VESTA rules (Done / Not found / Need help, reminders, the owner after 45 minutes), records each job for the facility manager as a ticket in the VESTA Kiosk, runs the night's maintenance checks, and sends the daily digest and the weekly and monthly reports with their PDF.
- **Skills you can change without an update.** Each skill is a folder under the app's `skills` folder: edit it, add one, delete one, and it counts at once. The five starter skills are copied there at the first start; updates never touch them.
- **The Documentation tab explains the set-up**: the "VESTA Agent" Home Assistant user (administrator, active, local network only — corrected in 0.9.1), registering people with `/whoami`, and the agent's `policy.yaml`.

### Changed
- **Telegram: Home Assistant keeps the bot.** The agent reads the bot's messages from Home Assistant and only sends, so the gate button, the alerts and every Telegram automation keep working whether the agent runs or not. *Telegram takeover* now means "the agent may send on the bot" — turn it on for one app only.
- The Home Assistant MCP server always runs inside the app: the *Home Assistant MCP*, *External MCP address* and *External MCP secret* fields are gone (an older value left in them is ignored).
- The app is smaller where it can be (no Node.js) and larger where the reports need it (a headless Chromium, used only while a PDF is printed).

## 0.8.0

### Changed
- **Nothing to see in the app.** The app now checks the VESTA Kiosk connection against the same written agreement the Kiosk itself uses (the version and what a message may contain), instead of a copy typed from memory. Its tests fail the moment the two differ, so a change on the Kiosk side can no longer silently break the agent.
- The agent's settings file (`vesta-agent.yaml`) and the app's own start-up state are each read in one place and tested directly.

## 0.7.0

### Added
- **The app now updates itself.** Every hour, the app's build service looks for a newer release of the VESTA Agent (once its repository is set) and of the HA MCP server. When there is one, it builds a new version of this app with it, checks that it starts correctly, and only then does Home Assistant show "Update available". A version that fails the check is never offered. You only press Update.
- **The real VESTA Agent can now be built into the app**, from its own GitHub repository at the release it names: its libraries are installed while the app is built, never on the Home Assistant machine. Until the agent's repository is set, the app keeps the test agent.

### Changed
- The HA MCP server is no longer fixed at one version: it follows HA MCP's releases, each one checked before it is offered (today: 8.5.0).
- The Documentation tab no longer shows internal engineering notes, and explains how a new agent version reaches the app.

## 0.6.0

### Added
- **"Stub heartbeat" now tests the whole connection with the VESTA Kiosk.** Besides showing the agent as online, the stub posts one test message with two buttons (*Looks good* / *Not now*) each time the app starts. Answer it in the Kiosk's VESTA Agent area, and within about 15 seconds this app's log says which button was pressed and by whom — the same path a real agent's question and your decision will take.

## 0.5.2

### Changed
- The help text of **VESTA Kiosk address** no longer says the default is the stable VESTA Kiosk: the dev channel's default is VESTA (dev2).
- The documentation records what was confirmed on the HA Yellow: the app reaches Home Assistant and the VESTA Kiosk by their internal names, uses Home Assistant's time zone, and needs about 142 MB of memory with the HA MCP server running.

## 0.5.1

### Maintenance
- Nothing changes in the app: internal notes in the source were brought up to date.

## 0.5.0

### Added
- **The same app runs outside Home Assistant.** A ready-made `docker compose` setup (`agent-host/standalone/`) runs the identical image on any machine, with settings in a file instead of the Configuration page. For a machine outside the villa, the Cloudflare Access service token is sent with every request to Home Assistant, the HA MCP server and the VESTA Kiosk.
- **Complete documentation** on the Documentation tab: modes, what each log line means, folders, the HA MCP server, restarts, running outside Home Assistant, what the VESTA Agent receives and must follow, and the measured image size and memory use.

### Checked
- Each release is now also checked for never touching the VESTA Kiosk's files, and for a skill added while the app runs being visible at once.

## 0.4.0

### Added
- **The agent's own Home Assistant MCP server now runs inside the app** (HA MCP **8.5.0** — the same version as the development instance; it changes only when deliberately upgraded). It starts when a Home Assistant token is set, is reachable only from inside the app, and the self-test's "HA MCP" line now reports **pass** with the number of tools it offers. In "external" mode it is not started and the given address is checked instead. It does not check for updates on the internet and does not ask HACS to refresh anything.
- **Crash handling.** If the agent (or the stub) stops unexpectedly, it is restarted after 5 seconds, then 10, 20… up to 5 minutes. After 5 crashes within 10 minutes it is no longer restarted: the app stays running, says so in its log, and the VESTA Kiosk will show the agent offline. Restarting the app tries again.
- **Clean stop.** On stop the agent gets the time its manifest asks for (up to 22 seconds) to finish, then the HA MCP server stops — all within the 30 seconds Home Assistant allows.

## 0.3.0

### Added
- **Self-test at every start.** The log now shows one line per connection — Home Assistant, HA MCP, VESTA Kiosk, Anthropic, Telegram and Presence — each marked **pass**, **fail** or **skipped** with the reason. A connection with no key or token yet, or one the other side does not offer yet, is marked skipped, never failed. The result is also saved to the app's data (`selftest.json`).
- **The stub now runs in the agent slot.** It stands in for the VESTA Agent: it confirms it received all its settings, and with "Stub heartbeat" on it tells the VESTA Kiosk every minute that the agent is online.
- **Stub mode always starts,** even when a check fails. **Agent mode waits** until Home Assistant and Anthropic both pass, retrying from every 5 seconds up to every 5 minutes.
- Telegram is only ever asked "who are you" (`getMe`), and only once Telegram takeover is on. It is never asked for messages.

## 0.2.0

### Added
- **The app now reads its settings and checks them when it starts.** The log opens with a short summary: the app version, whether it runs as a Home Assistant app or on its own, and each connection (Home Assistant, HA MCP, VESTA Kiosk, Anthropic, Telegram) with whether its key or token is set. Keys and tokens themselves are never shown; any that appear in a log line are replaced by `***`.
- **Stub mode (the default) starts with nothing configured.** Each missing key is listed as a check that will be skipped. **Agent mode refuses to start** without the Anthropic API key and the Home Assistant token, and says which one is missing.
- **Telegram stays off.** While "Telegram takeover" is off, the bot token is not passed on at all.
- On first start the app creates its folders: `skills` and `agent` under its folder in `/addon_configs` (each with a short README), and its own data folder. Files you edit there are never overwritten.

## 0.1.0

### Added
- **First installable build of the VESTA Agent host.** It installs from the store by downloading a ready-made image (nothing is built on the HA Yellow), starts, and stays idle: the agent slot is empty and no connection is made yet. This release only proves the install path.
