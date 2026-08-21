## 2.559.0

### Fixed — underscores vanished from briefings delivered to Telegram

A briefing arrived reading "criticalschedule---poolpump" where the add-on had
written "critical_schedule---pool_pump". Telegram is configured to interpret
messages as Markdown, in which an underscore starts italics, so it consumed
them. Every briefing was affected and nothing on this side could tell: the
message was sent exactly as composed and the delivery was logged as successful.
Any service that offers a "do not interpret this" option is now told to use it.

