## 2.748.0

### Fixed — every add-on restart fired a full supervision pass, ignoring the cadence

The triage loop ran a pass before its first sleep and nothing recorded when the last one had run, so a
restart reset the clock to zero. On a day of add-on updates that turned a 360-minute cadence into ten
passes in twelve hours; four of them escalated into eleven frontier-model investigations, and the
exported ledger for that window is $4.21 against roughly $0.85 the cadence actually promises. The last
pass is now written to disk and a restart waits out whatever is left of the period. A villa that has
never run one still goes immediately, so a fresh install proves itself without waiting six hours, and a
clock that jumps backwards — an NTP correction after a power cut, which is exactly when a villa
restarts — is clamped rather than silencing supervision for days.

