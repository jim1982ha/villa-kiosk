## 2.546.0

### Added — a Checks tab, per-schedule recipients, and destinations beyond the notify list

The built-in analyses had no screen: they could be switched off in the stored
settings and nothing showed them, so a spec'd tab was missing outright. Each
now lists what it needs, whether this property has it, and why it did or did
not run. Each schedule can also name its own recipients instead of sharing one
list — the scheduler has honoured that since the first release and only the
dialog never offered it. And a destination no longer has to be a notify
service: any Home Assistant action that takes a title and a message qualifies,
which is how Telegram appears on a property whose Telegram integration
registers no notify service at all.

