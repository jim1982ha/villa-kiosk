## 2.691.0

### Added — the villa now says what it cannot see, and you can tell it when it is wrong
Two requirements that read as met and were not. The profile has a block for the
things this property does not measure — no tariff, no per-device metering — and
nothing ever filled it, so every check the agent ran said "NOT SURVEYED" instead:
discovery is a fan-out across Home Assistant and running it 96 times a day was
the cost that left it unwired. It is now surveyed once a day and cached. And the
villa forms claims about the property that it reuses in every later check, which
it has always refused to overwrite once a person corrected one — but nothing
could correct one, so the protection guarded something unreachable. The Cockpit
now lists what it believes; your note is added underneath and outranks it.

## 2.690.0

### Fixed — dismissing a concern three times now actually silences it, and agent settings are validated
Two halves that never met: the dismissal counter computed the right suppression
list and handed it to the browser, while the gate read a config key nobody ever
wrote — so "stop telling me about the gym lights" was recorded and discarded.
`for_run` now unions the earned list into the run snapshot. Found by walking the
64-requirement catalogue against the code rather than the task ledger, which also
caught `config.errors` being called by nothing: agent settings went through the
generic store handler, so an unlisted `investigate_mode` returned 200 and read as
the wrong one. A new test fails on any public function in `agent/` that only its
own tests call — the shape eight separate defects here have taken.