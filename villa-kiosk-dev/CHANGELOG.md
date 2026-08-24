## 2.739.0

### Added — an hourly diagnostic line about the observation record, off by default

2.738.0 stopped every restart re-recording the whole villa; whether that is enough depends on the
property's own steady change rate, which takes days of samples to see and which nobody is watching for.
Switch on **Log observation diagnostics hourly** in the add-on's Configuration page and it prints two
lines an hour: how full the rolling record is, how many days it covers, how fast it is filling, which
devices produce the most entries, and how many baselines a restart had to restore. Every field reads `?`
rather than `0` when it cannot be measured, because a two-day-old log is read by someone who cannot
re-run it. Named heartbeat rather than telemetry: this add-on already has a `/telemetry` ring of browser
diagnostics, and reusing that noun for a different subsystem is a mistake this code has made before.

