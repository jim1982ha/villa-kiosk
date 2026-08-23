## 2.669.0

### Changed — API usage is its own tab in Advanced Settings, and exports as CSV
It opened from the narration toggle in Briefings, which is exactly the reading its
own text spends a paragraph denying: triage, investigations and every chat turn
spend the same key whether narration is on or off. It now sits beside the settings
that cause the spend, and the requests in the selected window download as a CSV —
the rows, not the summary, because reconciling against a bill is line by line.

## 2.668.0

### Fixed — Save stayed greyed while you were visibly typing, and caching was unmeasurable
A number field told the dialog about an edit only when focus left it, so a box that
had plainly changed sat beside a footer claiming nothing had. The clamp still waits
for the blur — clamping per keystroke is what made the field untypeable — but the
draft learns immediately. The usage panel also folded cached tokens into one "in"
figure, so the caching added last release looked identical to its own absence.

## 2.667.0

### Changed — every modal ends in the same three icon buttons: Cancel · Save · Close
Save commits and stays, so you can keep working. Cancel discards and closes in one
press. Close asks first if anything is unsaved, and closes straight away if not.
The question they share now carries icons and fits one line per button, and three
44px squares fit a phone footer where the labelled row used to wrap.

## 2.666.0

### Fixed — the number boxes in Supervision could not be typed into
They clamped on every keystroke, so typing 24 became max(5, 2) = 5 before the 4
arrived and the field looked stuck at its minimum; clearing it to retype snapped
back too. They now hold what you type and resolve when you leave the box — the
same rule the villa coordinates have followed since they hit this first.

## 2.665.0

### Fixed — the cutover page listed ten hashes instead of ten findings
A blueprint finding was stored by asking a `Group` for a `title` it does not
have, and the diff fell back to the subject key when a title was empty — so the
page a cutover is decided from showed `29d2dd0f3a69762c` ten times. It reads
`label` now, and a titleless row can never render as its own hash again.

## 2.664.0

### Fixed — chat was answering every question on the most expensive model, uncached
28 requests and $1.78 in an afternoon of testing, all of it frontier-model chat.
Two causes: chat had no tier of its own so it used the investigations model, and
the Villa Document — ~11,000 tokens — was re-sent at full price on every turn of
every tool loop. Chat now defaults to the mid tier, the system prompt is cache-
marked, and each model box shows its default and suggests the alternatives.

## 2.663.0

### Added — "Check the villa now", so the cutover evidence can be tested today
`/agent-run-now` has been on the add-on since Phase 2 with nothing in the app
calling it, so the only way to put evidence in front of the cutover decision was
to leave the villa running for days — and a gate whose evidence can only
accumulate is a gate nobody tests. The button is beside the page it fills, and it
says that it spends a request.

## 2.662.0

### Fixed — the cutover evidence could not see the rules it exists to judge
A brief listed pump drift, short-cycling, power factor and a disabled critical
automation; the shadow diff said "the rules found 0" the same minute. History
entries stored only a COUNT, though `store.py` has claimed since it was written
that an entry is "metadata plus findings" — so the column that decides whether an
automation can be retired was structurally always empty. The page is also rewritten:
one verdict, three lists named by what they mean, and the caveat only where it bites.

## 2.661.0

### Fixed — every shadow diff said its own evidence was incomplete
The route asked the collector about coverage without telling it which period, and
the resulting TypeError was swallowed into a log line — so the document that
decides whether working automations can be retired opened by disclaiming itself,
on every villa, always. It now asks about the window the diff actually describes.
Found in the add-on log, one release after it shipped.

## 2.660.0

### Fixed — the tab strip was being squashed by its own dialog's content
It looked different on every tab because it WAS a different height on every tab.
`.fm-tabs` declared no flex value, so it defaulted to shrinkable, while the body
beside it scrolls without `min-height: 0` — so a long tab pushed the column past
the card's fixed height and the browser recovered the difference from the only
item allowed to give. Both halves are fixed on the shell, so it holds for every
tab of every modal, and pinned.

## 2.659.0

### Fixed — the journal ring was quietly deleting equipment from the agent's world
The agent addresses only what the journal has seen, and the journal is a ring that
fills: your pool pump's rows were evicted, so "no pool pump circuit shows up in what
I can address" was true of the journal and false of the villa. Worse, the eviction
is biased — a steadily-running pump emits fewer rows than a chatty sensor, so the
equipment worth asking about goes first. Every entity now keeps its last sighting.
Also: shorter copy in Supervision, and the tab strip stops shifting between tabs.

## 2.658.0

### Added — the villa can now ask permission, and only a person can give it
An action that could let somebody in or silence an alarm was already refused at any
confidence — but the refusal existed only in the agent's own context, so it could
ask "shall I unlock the gate?" with nowhere for anyone to answer. Those now wait on
the Cockpit with a countdown, and expire. There is deliberately no tool that confirms
one: consent arrives through a route with a session and a role, because a confirm
flow the model can complete is worse than none.

## 2.657.0

### Fixed — the villa denied its own pool pump, and sent someone to the wrong subsystem
Asked "is the pool pump OK", the agent said no such circuit exists — of equipment
drawing 863.7 W as it answered; it had read a ranked excerpt as an inventory, which
nothing said it was not. Asked why it could not see overnight, it sent the owner to
Home Assistant's recorder settings: our own prose called VESTA's full journal "a
limit of the recorder", and a test held that wording in place. The shadow diff has a
surface at last, and the API key moved to the tab that spends it.

## 2.656.1

### Changed — a person's row asks the ordinary question first, the rare one only when it applies
The chat and the devices read as one address asked for twice — a fair reading,
since the same person is in both lists. They stay two fields: a group chat can
never identify a sender, and deriving identity from a delivery address would make
adding a device grant the right to command the villa. But devices come first now,
and the chat is labelled by what it does and shown only when it can grant anything.

## 2.655.1

### Fixed — a row's delete button sat a line above the controls beside it
The shared row is top-aligned, which is right for bare controls and wrong once a
caller labels its fields: the delete lined up with the LABEL rather than with the
selects. Fixed on the shared rule, not in the panel that noticed — both callers
want the delete beside the controls, and it now matches their height too.

## 2.655.0

### Changed — Save closes the dialog, a tab switch asks first, and a dead field is gone
Save committed and left you on the same dialog; it now closes, and only when the write
succeeded. Leaving a tab with unsaved changes asks whether to save, discard or stay,
from the shared tab strip, so every tabbed dialog gets it. A person's `Name` was read
by nothing and the migration filled it with their chat id — which is what made the row
look like two chat fields. The device list closes on an outside tap.

## 2.654.0

### Changed — one fixed footer, labelled people rows, and a reachable review queue
The footer swapped Close for Cancel/Save as you typed, which read as two dialogs
arguing; it is fixed now, with Save greyed until there is something to store. A
person's four fields were unlabelled and the migration named people after their
chat id, so it read as two chat fields. A profile whose person has no device said
`(missing)`. Playbook drafts can finally be approved or discarded, in the Cockpit.

## 2.653.0

### Changed — a briefing is addressed to a PROFILE, and every modal saves the same way
v2.651.0 derived the voice from the recipient; the owner asked for the inverse, so a
schedule names a profile and the new People panel says where it is reached — one nobody
is configured for is greyed, marked `(missing)`, and will not save. Supervision's two
panels each held their own revision of one document, so saving either discarded the
other's edit; there is one draft now, committed from the footer.

## 2.652.0

### Changed — Settings is tabbed, like Briefings and Facility
Seven collapsible sections stacked on one screen read as clutter. They are now
four tabs — Villa, Devices, Supervision, System — with two panels each, so no
tab holds a single control. The tab strip itself was duplicated markup in two
modals and is now one component, which also gives Briefings the scroll-into-view
fix only Facility had.

## 2.651.0

### Changed — a briefing's voice now follows who it is sent to
Choosing a recipient already decided this, so picking it a second time in
Schedules was a setting that could disagree with itself. One people table now
answers both "who may message the villa" and "whose voice a briefing is written
in". A schedule that names an explicit audience still wins, and a villa that
configured senders before this keeps working untouched.

## 2.650.0

### Added — see exactly what the API key has been spent on, and by whom
An icon beside "Let an AI service write the summary" opens a per-request ledger
with a date you choose: every call, its cost, and who caused it. It covers
scheduled checks and chat too — those spend the same key with that setting off,
which was the blind spot. Cadence, budget, models and observe-only mode are now
editable in Settings; only the sender list ever was. Also fixed: the anomaly
ranking arrived with no device names, so its rows named nothing.

## 2.649.0

### Added — shipped domain expertise, and a memory of this villa
Twenty-five procedures across electrical, water, climate, connectivity, security,
hospitality and self-audit. Only their one-line descriptions sit in context; a
body is fetched on demand, which is what keeps the cadence affordable. Beside
them a learned store: every claim names its investigation, claims expire so a
stale one stops being asserted, and a human correction is never overwritten.

## 2.648.0

### Fixed — an unclassified severity sorted to the bottom of the list
The order of severities was written out by hand in three places, and two of them
put anything unrecognised last — the quietest position — in the briefing and on
the wall alike. The project's own rule is the opposite: something nobody has
classified is treated as a warning. One ordering now, derived, in both languages.

## 2.647.0

### Fixed — the previous release shipped with one test red
A service name in a new fixture was read as an entity id by the hard-rules pin.
Classified correctly; nothing about the release's behaviour changes.

## 2.646.0

### Added — the agent can act, on nothing, until you say otherwise
Actuation ships switched off with an empty device list, and the two are AND-ed:
turning it on authorises nothing by itself. Anything that could let somebody in
or silence an alarm is offered for a person to confirm and never executed, at any
confidence. Repeating an action that already happened is refused.

## 2.645.0

### Added — the villa's own conclusions on the wall, with two buttons
The Cockpit shows what the agent has concluded beside what the kiosk measures.
Useful / not useful sits on each one, and three dismissals of the same subject
stop it being raised — by a counter, so "stop telling me about the gym lights"
works reliably rather than probably.

### Added — routing that re-evaluates instead of counting down
A condition that cleared on its own now stands down rather than escalating, and
an unreachable facility manager with guests in residence reaches the owner
immediately rather than after forty-five minutes.

## 2.644.0

### Fixed — the agent had never read its own constitution
Six files give it a voice, one severity scale and the rule that an absence of
evidence is never good news. They shipped, they passed their content checks, and
nothing loaded them into a prompt. Both the chat and triage paths read them now,
and the voice follows who is asking.

## 2.643.0

### Added — the agent now checks the villa on its own schedule
Triage existed and nothing called it, so a shadow period only filled when
somebody asked. It runs on the configured cadence now, with every switch read
per pass rather than at start-up.

### Fixed — the spend ceiling you set was ignored
The budget read a key name nothing writes, so it ran on its shipped default
whatever was configured. The same defect was fixed elsewhere two releases ago
and not swept for; a test now derives the key set and covers the whole package.

## 2.642.0

### Added — shadow mode, so the agent can be judged before it is trusted
It runs everything and delivers nothing: no push, no brief line, no kiosk badge.
Concerns go to their own store and are compared against what the existing
automations found. Shadow is the shipped default, so switching the agent on
observes a period rather than acting on it.

## 2.641.0

### Added — concerns have a lifecycle, and a fix can be checked
A concern is opened, acted on, verified and closed with a timestamp at every
step. A second concern about a subject already open is refused unless it says
what it replaces. Verification says "cannot verify" when the villa was not being
watched, rather than reporting that nothing recurred.

### Added — the agent's constitution, and the ladder beneath it
Six files give it a voice, one severity scale and the rule that an absence of
evidence is never good news. When a layer is unreachable the brief still
arrives, in plainer words, saying which layer was missing.

## 2.640.0

### Fixed — the tools were not connected to the villa
Every tool takes its data source as an argument and the registry built them all
with none, so the agent answered about an empty property while the journal held
thousands of entries. They are wired now, in one place.

### Fixed — a role picker offering a profile that does not exist
"Facility" and "ops" were two names for one person and "guest" was missing. The
list now comes from the app's own profiles and shows their real names.

### Changed — chat answers are short
The chat path sent no instructions at all, so a two-line question could return
forty lines about the monitoring system itself. It leads with the answer now.

## 2.639.0

### Fixed — silence that could not be told apart from good news
Two tools returned an empty result when they had no data source, which reads
identically to "this villa has nothing unusual". They refuse now, and say so.
The villa profile made the same over-claim: "nothing known to be unmeasured"
printed whether the property had been surveyed or never looked at.

## 2.638.0

### Changed — pick who may message the villa by name, not by number
The sender list offered a numeric Telegram id copied out of a raw event. It now
lists the bot's own private chats by their names. Groups are deliberately absent:
a group names a room rather than a person, so it could never match a sender.

## 2.637.0

### Fixed — the reply was composed, addressed correctly, and refused by Home Assistant
A notify service and a notify entity are identical as strings, and the two are
called different ways; the resolved chat was handed over as the wrong one, so
every answer ended in HTTP 400 at the last step.

## 2.636.0

### Fixed — the answer was written and never sent
The model replies in prose, and the run returned that prose to nobody: the villa
logged a successful answer and delivered nothing, to either chat.

### Fixed — the agent could not speak or file a concern unless actuation was on
Writing and acting were treated as one permission, so the switch that guards
touching the villa also blocked replying and recording a finding. They are now
separate, and actuation stays off by default as before.

## 2.635.0

### Fixed — the answer went to the wrong chat
A question asked in a private chat was answered in the group, because the reply
used the briefing recipients. It now resolves the asking chat through Home
Assistant's entity registry, so only a chat the bot is already configured for
can be reached at all. The log also says which entity the answer went to —
"it worked" and "you got nothing" were previously the same line.

## 2.634.0

### Fixed — the agent was being handed readings with the numbers removed
The redaction allow-list is by field name, so a tool returning a wattage handed
the model an empty object. Numbers now pass on their own merit; strings are
still allow-listed, which is where injection and identifiers actually live.

### Added — the request is checked locally before it is ever sent
Three malformed requests were found one at a time by sending them to the real
API. A scripted conversation now runs the real loop against a validator built
from those refusals, including the tool-error shape that had never been sent.

## 2.633.0

### Fixed — tool results could not be sent back to the model
A tool returns text, JSON and error blocks; the model's API accepts only text.
The reduction existed but had been written for the MCP surface alone, so a
conversation ran three turns, called its tools, and then could not report what
they found. There is now one flattener and both surfaces use it.

## 2.632.0

### Fixed — the model was sent tools it could not read
The tool list is published in MCP's shape, which spells one field
`inputSchema`; the Messages API wants `input_schema` and rejected every request
carrying tools. The adapter translates now, which is where anything
provider-specific belongs.

## 2.631.0

### Fixed — a question that could not be answered got silence
The villa now says why. A spent API balance declined every message and nothing
was sent back, which is indistinguishable from a broken bot to the only person
who cannot read the add-on log — the one who asked. Strangers are still ignored
in silence; that rule was never about hiding a fault from the owner.

## 2.630.0

### Fixed — the agent refused every message while both switches showed on
It read the stored config through the wire envelope, which exists only in the
HTTP response and not on disk, so every setting read as its shipped default and
the master switch was always off. Reported as a message that arrived and was
answered with nothing.

### Changed — a row's delete now reads as destructive
It used the neutral icon chrome, so the one dangerous control in the row looked
like every other button. The stylesheet had said otherwise since before that
panel existed.

## 2.629.0

### Changed — the sender list now works like the Briefings schedule list
It had invented its own idiom: a draft field plus a ⊕, beside a screen that
already does this with an "Add" button and rows edited in place. Both now share
one set of classes, so the phone-wrap behaviour is inherited rather than
restated. Saving also no longer flashes the panel through a loading state, and
no longer deletes a row you are halfway through typing.

## 2.628.0

### Fixed — turning the agent on deleted the list of who may message it
The config store replaces the whole document rather than merging, so a save that
sent only the changed switch wrote that switch as the entire config. Reported
the first time the switch was used. Saves now carry the stored document.

### Fixed — a greyed-out toggle looked identical to an available one
Nothing styled the disabled state at all, so the only clue was that clicking did
nothing. The dependent switch is also indented under the one it needs.

## 2.627.0

### Added — the two switches that turn the agent on, on screen
The agent and its chat trigger both ship off and had no UI at all, so the only
way to enable either was to PUT the config store by hand. Both now sit above the
sender list in Advanced Settings. The chat switch is greyed rather than hidden
while the master is off — hiding it makes the reason for the silence invisible.

## 2.626.0

### Added — an inbound message now actually reaches the agent
The collector hands chat events to a callback the proxy wires in, so a message
becomes a run: switch, freshness, sender, then a model — each refusing before the
next costs anything. The collector itself still imports nothing from the agent,
because it is the floor the agent stands on and must not fall over with it.

## 2.625.0

### Added — the villa can be messaged, by people you name and nobody else
Inbound Telegram rides the websocket the collector already holds, so no webhook
and no open port. A thread remembers the concerns VESTA sent into it, which is
what lets a reply of "why?" resolve without naming the subject. Nothing is
written to disk: a durable chat log is a transcript of a household. A new owner
panel lists who may talk to the villa; empty means nobody, which is how it ships.

## 2.624.0

### Added — the agent's endpoints, and the one nginx block that must not exist
`/agent-concerns`, `/agent-runs`, `/agent-audit` and `/agent-run-now`, the last
two owner-only. Each gets its own exact nginx location rather than one tidy
`/agent-` prefix block, because a prefix block would also match `/agent-mcp` and
publish the tool surface to any browser tab — silently, with every test green.
The security suite now asserts that prefix block does not exist.

## 2.623.0

### Added — an external agent can now reach the read tools, behind the same gate
`/agent-mcp` publishes them over MCP through the identical function the in-process
agent uses, so a relocated caller gains no permission it did not have. It has no
nginx location on purpose and is therefore unreachable from the tablet.

### Fixed — every setting saved in the agent config was accepted and then ignored
`policy.py` read a prefixed spelling nothing has ever written, so a turn cap set
to 3 stayed at 8 and actuation could not be switched on at all.

## 2.622.0

### Added — the agent loop, runnable end to end with no network

The registry and the run loop, exercised by a scripted fake provider: budget
exhaustion, an open breaker, a raising tool, a hallucinated one, a refused write
and a repeat loop all have cases and none needs an API key. Running it for the
first time found that every tool error was being scrubbed away to nothing before
the model could read it, and that error codes were having their underscores
stripped into values outside the contract.

## 2.621.0

### Added — the provider seam, and a credential that would have reached the log

One protocol, one adapter, and the adapter is the only file that imports the SDK
or names the provider's host. It executes no tool and imports no policy, so
swapping a model stays a quality decision rather than an authority one. Writing
its tests found that a failed provider call would have written the API key into
the add-on log in full: `secrets.redact` only replaces credentials it finds in
the stored secrets file, and this adapter holds the key directly.

## 2.620.0

### Added — the model SDK, pinned while the base images keep floating

The base tags float on purpose so every build takes security patches. The SDK
must not: it decides retry behaviour, streaming and tool-call shapes, so a
floating version would let the villa's supervision change because a package was
published, with no release here to explain it. Verified against the real base
image, including that it replaces the OS-provided `idna` the proxy also uses.

## 2.619.0

### Added — an audit that can show a crash, and kill switches that ship off

Every action writes an intent row before and an outcome row after, so an action
that started and never reported back is visible by the gap rather than looking
like success. A replayed action key is refused across restarts. Alongside it,
`/agent-config` carries three independent kill switches, all off on a fresh
install, and two lists that ship empty because a seeded default in either would
be an open bot or an agent acting on a device nobody authorised.

## 2.618.0

### Added — a spending ceiling that survives a restart

The existing budget lives in memory and says so, which was right for one
narrated sentence per brief. At a fifteen-minute cadence the runaway to stop is
a restart loop, and a counter that resets on restart never binds against exactly
that. The new one persists, rolls on the UTC calendar month, and gives chat its
own slice so a long conversation cannot starve the supervision it is an
interface to. Nothing calls it yet.

## 2.617.0

### Added — the authorization boundary, and the scrubber in front of it

`policy.py` decides what the agent may do; nothing in it is a model, and its
config is snapshotted per run so a mid-run change cannot widen authority. High
harm is judged on physical effect rather than entity domain, and it is never
executed autonomously — a door relay published as a switch is still a door.
`redact.py` scrubs every tool result by looping over an allow-list, never over
the input. Both are mutation-tested; nothing calls them yet.

## 2.616.0

### Added — the agent can read Home Assistant without ever seeing an entity id

Devices reach the model as opaque per-run handles with readable labels, and a
leak detector scans every tool result to prove it. `read_logs` filters
server-side and returns a window with a match count rather than the file,
because tool results are re-sent on every later turn. `read_ledger` returns
counts and statuses only — a guest can write into that store, so the free text
is not there rather than filtered.

## 2.615.0

### Added — the agent's vocabulary, and four tools over what PH-1 records

`agent/contracts.py` and its TypeScript twin define the records the reasoning
layer produces, with the same parity check that already guards the report
vocabulary — extended rather than duplicated. The four read tools are MCP-shaped
from the start, because that interface is the extraction seam and a private one
would be a migration later. Nothing calls any of it yet.

## 2.614.0

### Fixed — salience ranked "the pump is on", which nobody would call out

Reading a Villa Document built from this villa's real data put three pumps at the
top, all saying the same thing: they were running. The baseline was a
distribution of daily means and the reading was instantaneous, an order of
magnitude apart by construction. The comparison's basis is now printed beside
every score so a mismatch is visible, and a value beyond the whole recorded range
says so. Also: "1 climate units", and a concern reading "(open, open 2 days)".

## 2.613.0

### Added — the observation cycle now runs, in the loop that already existed

A third asyncio task beside the scheduler and the collector, not a third
service: it polls Home Assistant on a cadence read from config, journals what
changed since the last pass, and logs one line with the counts. Only
allow-listed attributes are held between cycles, so a room warming by a tenth of
a degree cannot manufacture a journal row. Nothing downstream consumes it yet.

## 2.612.0

### Added — the villa described to a model, stable half first

`observe/snapshot.py` assembles the Villa Document: a profile of the property's
structure, then the period's fresh delta. The order is a cost requirement, not a
style one — prompt caching matches an exact prefix, so a timestamp anywhere in
the profile would end caching silently and quadruple the bill for identical
output. The profile also states what this villa cannot be asked about, in
discovery's own words. Nothing reads it yet.

## 2.611.0

### Added — the villa's own history decides what counts as unusual

Every threshold in the blueprint pack answers "how much is too much" for one
property's equipment, which is why the pack does not travel. `observe/salience.py`
scores each entity against its own recent distribution instead, so it needs no
tuning and works on install day. It never fabricates a score: too little history
returns nothing, with a reason. Nothing reads it yet.

## 2.610.0

### Added — a journal of what the villa actually did

The historical record until now held only `vesta_*` events, so anything no
blueprint was watching never happened as far as a report could tell. `observe/`
records every material state change to a bounded ring that survives a restart,
where material means a value change, any availability transition, or a commanded
attribute — never a measurement that already has its own entity. Nothing reads
it yet.

## 2.609.0

### Fixed — a smoke test counted as 209 IDR the villa could have saved

Anyone firing a test event onto the bus added its cost to the owner's savings
headline, because nothing in the payload told a probe from a finding. Events
carrying `test: true` are now dropped before an Item is built, so no consumer
downstream needs its own guard, and the count is reported rather than silently
subtracted.

## 2.608.0

### Fixed — a brief that declined to narrate gave the wrong reason

A provider answering with a paragraph rather than one sentence had its refusal
recorded as whatever reason the adapter last left behind: the branch naming that
case sat under `elif lead:` inside `if lead:` and could never run. Also clears
four dead code residues and four comments asserting counts the pack outgrew.

## 2.607.0

### Fixed — a redacted task read as a missing word, not a withheld one

The Tasks tab showed "Critical automation(s) found OFF: . Re-enable, or
document as a deliberate decision" — an instruction to re-enable nothing in
particular. The stored task was complete; the entity-id redaction stranded the
colon in front of the full stop. It only handled ids at the start of a line,
and this shape puts them mid-sentence.

## 2.606.0

### Added — Done and Need help buttons on the phone, and escalation

A caretaker task now arrives with two buttons. Done completes the same todo item
the tablet ticks, so the brief's acknowledgement counter keeps working unchanged;
Need help tells the owner and leaves the job open, because "I cannot do this" is
the opposite of done. Unanswered tasks are re-asked at 15 minutes and escalated
at 45 — and never closed by a timeout.

## 2.605.0

### Fixed — the report and the briefing could disagree about open faults

Three rules answered "is this fault open" from one store: two read the status,
one read `resolvedAt`. A fault marked resolved before that field existed was
closed to one and open to another. The kiosk also counted a row with a missing
status as RESOLVED, removing a fault from the report by bad data; unknown is
now open on both sides, and the parity harness diffs them.

## 2.604.0

### Added — findings carry the room they happened in

The Report Spec asks for a roll-up by room then category, and the code refused
it because a report bucket is not a room. True, but the room was never the
bucket's to give: it comes from the entities, via the same map the kiosk itself
renders from, so the brief and the tablet cannot place one device in two rooms.

## 2.603.0

### Changed — the avoidable-cost list is five lines, as the Report Spec says

It was eight, from a `MAX_LINES` that sixteen other sections also read — so
retuning that constant would have truncated standing state, tasks, forecasts and
drift to satisfy a spec item about money alone. The money section now has its
own ceiling. Nothing is lost: the list is ranked by cost, so the tail is the
cheap end, and it still carries the combined figure that keeps the headline
total derivable from the page.

## 2.602.0

### Fixed — six tests were failing, and one had never run at all

The Python suite could not run here (no venv), so two releases shipped against
it blind. Restored, it found six failures: four pinned the naming defect fixed
in 2.601.0, one had a broken path, and the sixth called a helper that does not
exist. That one also asserted "at least one" surface was reachable — true during
the bug it was written for — and now checks every surface.

## 2.601.0

### Fixed — a device name arrived in the brief half-humanised

Both readers of the Home Assistant label map humanised only their FALLBACK, on
the assumption that a supplied name is already prose. Where an automation is
named like an identifier it reached delivery untouched, and only the markup pass
altered it — leaving a half-converted string. All three sites now humanise.

## 2.600.0

### Fixed — the facility manager could not open Briefings, and Checks was two tabs

Briefings was gated on `editConfig`, so the one role the server permits to
complete a task could not reach the tab listing them; it now opens on
`manageFacility`, owner-only tabs filtered inside rather than refused. Checks
absorbed Diagnostics, whose check list was a thinner copy of its own.

## 2.599.0

### Added — caretaker tasks can be acknowledged from the kiosk

A Tasks tab in Briefings lists what the villa's automations have asked for and
lets it be ticked off without opening Home Assistant. Only items this system
wrote can be completed — the caretaker list is also the household's shopping
list on a real deployment — and the uid a browser sends is re-verified server
side. Also fixes the schedule row's delete button wrapping onto its own line on
a phone.

## 2.598.0

### Fixed — the no-villa-data guard scanned two directories of a three-directory repo

`tests/` is tracked and therefore published, and the scan covered `rootfs/` and
`src/` only. So v2.581.1 sanitised a real first name at four sites and left it
at nineteen more, in files the guard could not see. The name is gone from every
tracked file, and the scan now covers everything the repository publishes.

## 2.597.0

### Fixed — the report knew P1..P3 while the catalog defines P1..P4, and ignored severity once it had it

Two rules already carry P4, so adding the `severity` input they are specified to
have would have had the report accuse them of sending an older alert format.
And ordering was by cost only, leaving every unpriced finding in arrival order —
so a P2 rendered below a P4. Both are on the path an operator takes when they
follow the catalog, and both would have punished them for doing so.

## 2.596.0

### Fixed — a clear event from anything but a critical rule was thrown away

Every PM row in the catalog defines a clear/recovery rule and none of the
maintenance blueprints emit one yet. The report asked only critical groups
whether they had ended, so the day somebody implements those rules a resolved
alert would still have read as open — the work would have produced no visible
change. It now asks the data, not a category list.

## 2.595.1

### Fixed — the zone separators wrapped onto a second line on a phone

They were padded to 44 characters and Telegram fits about 32, so all three
arrived split with a ragged stub of box-drawing below them. A decorative rule is
the one element that must never wrap — prose wrapping is normal and invisible.
The separator is now a short fixed prefix that cannot reach any plausible
margin, rather than a narrower guess at a width nobody knows.

## 2.595.0

### Fixed — "vs 1-day average" was not an average, and the worklist led with the wrong half of each line

A delivered brief compared today against a single previous day and called it an
average, reporting a 2934% swing off one quiet sample at the top of the money
section; the chart already refused below two points and the sentence did not.
And the facility-manager lines opened with the instruction, so the left edge —
the only part a reader scans — never said which equipment a line was about.

## 2.594.1

### Changed — two comments from the last release claimed more than they check

`add_heading` recorded three missed sites and omitted the fourth its own pin
found, which is the evidence the pin works; and it now says why a section that
OPENS with a heading must not call it. The pin's docstring claimed nothing
appends a heading any other way — four sections build one via a list literal,
correctly, and a reader would have hunted a gap that is not there.

## 2.594.0

### Changed — /dry-audit: two enums shipped unpinned, the zone list existed twice, and a heading rule had four copies

`ZONE` and `TREND_DIRECTION` were validated outbound but never registered in
`CONTRACT_SETS`, so nothing checked them against the SPA; adding them
immediately demanded the TypeScript twin, which is the pin working. The
renderer also restated the zone tuple instead of reading the contract's. And
"a heading following content needs a blank line" was kept by four hand-written
copies, three of which had already failed it — it is one function now.

## 2.593.0

### Fixed — the kiosk link arrived dead, and four smaller defects in a delivered brief

The link was appended after the sanitiser, which protected it from ours and
handed it unsanitised to the destination's — a platform's own markdown parser ate
the underscore in the ingress path and produced a 404. Markup-active characters
in the URL are now percent-encoded, which no parser can touch. Also: a one-bar
sparkline on the first report, a missing blank line before "Still open from
earlier", a hoisted clause saying "it" about three things, and "1 device need".

## 2.592.0

### Changed — the brief is grouped by what you must do, numbers carry a trend, and the AI writes one sentence instead of the document

Sections are filed into NEEDS YOU / THIS PERIOD / ABOUT THIS REPORT, so the half
that needs a person is no longer interleaved with the half about the monitoring
system. Money carries a comparison against the previous periods and a sparkline,
which needed one new history field. And narration now fills the lead sentence
rather than replacing the whole body — the renderer keeps every figure, chart
and heading, so a weak answer costs one line instead of the report.

## 2.591.0

### Fixed — the kiosk link never worked, and two headings shared a marker

`discovery` stored the URLs under `external`/`internal` while `links` read
`external_url`/`internal_url`, so every link was withheld — silently, because
withholding is that module's correct behaviour and looks the same whether the
cause is policy or a typo. The brief now also says WHY a link is missing when
the owner can fix it. Separately, "Still open from earlier" and "Maintenance
signals" both rendered as the calendar.

## 2.590.0

### Changed — "Right now" groups each state under its own sub-heading

The section was already grouped by kind internally and printed flat, so the
reader saw the state repeated on every bullet and no structure at all. Each
group is now named above its own list, and the state word drops off the lines
beneath it. The label agrees with its count rather than printing "(s)".

## 2.589.0

### Fixed — a daily brief presented fourteen-day findings as if they were today's

The analysis modules read `min_history_days` whatever the cadence is, because a
baseline cannot be computed from one day — so a daily brief genuinely carries
fourteen-day findings, and the previous release put "today" on the Trends
heading above them. The window is a statistical requirement, not a reporting
period, so each finding now states it and Trends no longer claims a period it
does not own.

## 2.588.0

### Added — a brief can now link back into the kiosk, and refuses to when it would not be safe

The link is built only from Home Assistant's own external https URL plus this
add-on's ingress entry, so it lands in VESTA rather than on a Home Assistant
page. It is withheld entirely — never downgraded — when only a LAN address
exists, when the URL is plaintext, or when the ingress entry is unknown; a LAN
address in a message bound for a chat platform would leak the villa's network
shape permanently. Appended after sanitising, so no URL exemption was needed.

## 2.587.0

### Fixed — a brief still said "caretaker", and the follow-up line was three clauses welded together

"Facility Manager" was applied to the renderer and missed `verify`'s evidence
string, so a delivered brief read "the caretaker marked the job done" after the
rule had been accepted. A test now scans string literals — docstrings excluded
by the AST, since `caretaker` is the right engineering word and the blueprints'
own input keeps that name. The same line's semicolon chain and ISO date became
sentences and "21 Aug".

## 2.586.0

### Fixed — the headline's total could not always be reached by adding up the report

Two independent reasons, both invisible on a short list. The list chose minor
units by its own largest value while the total chose by its own magnitude, so
100.4 and 50.4 printed as "100" and "50" under a headline of "151". And past
eight findings the tail read "and N more." with no figure, putting real cost in
the total and nowhere on the page. The headline now sums what is printed.

## 2.585.0

### Changed — the brief now says which days it covers, in the title and in every heading that has a period

"Daily property brief — 2026-08-21" named a SETTING and the SEND date, so
neither said which days the contents describe; the title now carries the span.
Period-scoped headings gained "today"/"this week"/"this month", and the sections
that deliberately look outside the period say so instead. The headline's "3
findings from this property's own checks" counted verifications and named the
one thing it was not. Check names in prose are now quoted everywhere.

## 2.584.0

### Fixed — "7 transitions, max 6 transitions" read as two measurements, and an acknowledged rule could hide

A `max_`/`min_` field is the LIMIT a reading broke, not a second reading, and it
now attaches to what it bounds: "7 transitions (limit 6)". Separately, v2.583.0
exempted any rule with one completed task — the reference villa has `[PM-02]`
nine times with eight ticked off, so its noisiest rule was the one exempted.
Crossing the threshold is now the finding; the acknowledgement count changes the
sentence instead.

## 2.583.0

### Added — the brief now names rules that fire and are never acknowledged

The catalog's own honesty rule (Severity & Routing) had no implementation:
nothing recorded that an alert was acted on, so no rule could be judged noisy —
Coverage Gaps RPT-05, open and blocked. A completed caretaker todo item is the
acknowledgement, which needed no change to delivery because those items were
already being read every run. Escalation stays in the `critical_*` blueprints.

## 2.582.0

### Added — the brief now says when its counts reset, and a test guards the first hard rule

Asked by the owner reading a delivered brief: nothing on the page said when the
numbers reset. The dateline gave the time it was PREPARED (23:35), which is the
one time that is not the boundary. It now states the window beneath it. Also:
nothing anywhere checked that no villa-specific entity id ships — two were being
rendered as example text in Settings and the fault picker on every install.

## 2.581.1

### Fixed — a real entity id naming a person was committed to a public repository

Four comments argued that entity ids must be hashed because they routinely carry
room and person names, and each demonstrated it with a real one that does. The
argument is right; the example was the leak it describes. Replaced with a
placeholder, which makes the point without being anybody's window.

## 2.581.0

### Added — nothing checked that standing state leads the brief

`SECTIONS_FOR` documents that ordering as load-bearing — a reader comparing the
notification against the tablet must meet the matching list first — and no test
held it. The test that claimed to check section order checked three sections and
omitted that one. Also corrected the stale section list where v2.580.0 had fixed
it in only one of five places.

## 2.580.0

### Changed — three comments asserted things nothing checked, and one of them was wrong

`subject_key` and `dedup_key` each spelled out the same hash, held together
only by a docstring saying they must agree; `dedup_key` now calls the other.
The renderer's "the eight sections are the workbook's" stayed eight while
`standing` replaced `headline` — seven are. Both are now pinned by tests.

## 2.579.0

### Fixed — the note under "Checks waiting on a rule" was barely understandable

It read "Check them, or the check they stand in for runs by itself after 45
days" — which inverts what stands in for what ("they" are the blueprints; the
check they stand in for is the built-in one) and never says these checks are
not running. Also `name_of` moved to `reports.text` for `discovery`'s two sites.

## 2.578.1

### Fixed — the group's explanation was wearing a bullet

Under "Checks waiting on a rule that has never reported", the sentence
explaining the group carried the same bullet as the checks themselves, so a
reader counting the list got three where there are two. A bullet means "an item
in this list"; that line is not one.

## 2.578.0

### Fixed — the quoting never reached you, and the stood-down checks now sit together

Rule names were bracketed in 2.577.0 and arrived stripped: Telegram's Markdown
parser eats brackets as link syntax, so the delivered brief still read "covered
by Roi baseline deviation" while the units and headings from the same release
came through. Names are quoted with apostrophes now — the delimiter the
duplicate-target line has been delivering intact all along. The three "did not
run: covered by a rule that has never reported" lines are gathered under one
sub-heading with the explanation written once.

## 2.577.0

### Changed — every number carries its unit, and every rule name is quoted

"current value 1694.7" and "max transitions 6" were field dumps nobody could
read: the unit belongs to the sensor, so it now comes from Home Assistant's own
`unit_of_measurement`, and a bare count carries the noun it counts. Rule,
blueprint and automation names are bracketed so the sentence around them parses.
The three headings inside one section no longer share a wrench, and the brief
calls the Facility Manager by the name the kiosk uses instead of "caretaker".

## 2.576.0

### Fixed — one rule listed twice, and a headline nobody could scan

A rule whose blueprint was updated mid-period emits two payload shapes, and the
grouping key falls back through blueprint to category — so the newer events and
the older ones became two groups and the brief listed "Entrance unlocked while
vacant" twice, resolved after two different durations. They are one line again.
"Closed by itself" now counts repeats the way the recap does instead of printing
the name once per occurrence, and the headline's cost and unresolved-alert lines
are bullets like every other line of fact in the message.

## 2.575.0

### Fixed — findings that were true and impossible to act on

A brief said "Critical automation health: critical automation off" without
saying which, "Re-enable, or document as a deliberate decision" without saying
what to re-enable, "(critical) uses an older alert format" about one of thirteen
rules, "3 alerts resolved" about three already listed above, and "Avoidable cost
identified: 2,146" with no currency. Every one was correct. Each now names its
subject — from the entity ids the events always carried and the currency Home
Assistant already knew — using the display name, not the entity id.

## 2.574.0

### Fixed — Readiness said "2 not locked" and then listed every lock in the house

Its checks were narrowed to the villa's own devices last release; the panel they
open was not, so the two contradicted each other. Both now count the same set.
Alongside it, four duplicates found by the same audit: the unavailable/unknown
state pair was written out at seven places and named at none, an identical
"off-like" set existed under three names, and the add-on had a second definition
of "not reporting" inside the module whose only job is agreeing with the kiosk.

## 2.573.0

### Fixed — briefings could not be delivered: HTTP 500 from every send

A device name containing an underscore — `Timmerflotte_8343 Temperature`, a
normal Home Assistant friendly name — reached the message text for the first
time in 2.571.0, when briefings started reporting what the kiosk shows. A
platform configured to parse markdown reads that underscore as an italic that
never closes and rejects the whole message, which Home Assistant returns as a
500. Every delivery failed. The finished message is now stripped of every
character any notify platform can read as markup, once, before it is sent or
stored.

## 2.572.0

### Fixed — a property with the blueprint pack and no automations detected nothing

Any covering blueprint being installed switched a whole built-in check off,
forever — so a brand-new property that imported the pack and had built no
automations yet was watched by nobody, and a rule covering four of five pumps
left the fifth unreported by anyone. Both layers run now and the report prints
each device once, always preferring the blueprint. Readiness' camera and climate
checks stopped ignoring dismissed devices, the tablet and the briefing derive
their severity from one table, and Cockpit now says whether briefings are being
recorded at all.

## 2.571.0

### Added — the briefing now reports what the kiosk is showing, and a test proves they agree

A brief could report nothing while the Cockpit listed four offline devices,
because the report pipeline had never read the kiosk's device configuration and
`ReportContext` carried no live state and no maintenance record. Briefings now
open with a "Right now" section — offline devices, alarms, open faults, overdue
maintenance — built from the same rules the tablet uses, including the owner's
own labels and dismissals. A parity harness runs the kiosk's real code and the
add-on's over four deployment shapes and fails on any difference.

## 2.570.0

### Fixed — one attention button on the top bar, and its badge counts everything

2.569.0 pointed the alert icon at Facility's new Cockpit tab and left the
Facility icon beside it, so two different glyphs opened the same dialog. Worse,
they carried different numbers: 5 from the shared attention list (offline
devices, open faults, overdue maintenance, active alarms) against 1 from a
second, narrower count re-derived inside the HUD. There is now one button — a
clipboard into Facility, or a triangle into Cockpit for a profile that has no
Facility — and one count, the exhaustive one.

## 2.569.0

### Changed — Cockpit is a tab of the Facility workspace, not a second modal beside it

Two icons on the top bar opened two dialogs that answer the same question, which
is what an owner sees because they can open both. Cockpit is now Facility's
first tab and the alert icon lands on it. The standalone dialog stays for the
profiles Facility is closed to — a guest holds no `manageFacility` and Cockpit
was never gated, so deleting it would have removed the villa's only status view
from the person most likely to be at the tablet. One implementation, two shells.

## 2.568.0

### Fixed — a brief said "your own automations already cover this" about a rule that had never fired

The Cockpit listed four unavailable devices while the brief sent minutes later
mentioned none of them, because the built-in "Meters that stopped reporting"
check stands down wherever a blueprint layer exists — and the blueprint covering
it had `last_triggered: null` on every instance since installation. The
stand-down was decided per CATEGORY, which read healthy because other
maintenance rules were busy. Coverage is now tracked per blueprint, and a check
that stood down for a rule which has never reported says so and names it.

## 2.567.0

### Changed — a briefing result no longer pushes the tab body down to say "sent"

"Sending…" and "Sent to 1 recipient(s)." rendered as a full-width banner above
the tab, so a one-word outcome moved every control under it twice per send. The
result is now a single icon beside the Briefings title, with the wording in its
tooltip. A FAILURE still opens the full sentence in the body, because a tooltip
is mouse-only and this is operated from a tablet; tapping the icon toggles it.

## 2.566.0

### Changed — the briefing says the same things in fewer, plainer words

The monitoring section repeated one ninety-eight character sentence three times,
once per check that stood down, and hedged another line with twenty words that
amounted to "unknown". Checks that stood down for the same reason now share a
line, a silent category is named instead of counted, and the older-format notice
leads with what to change. Two headings that ran together without a gap are
separated.

