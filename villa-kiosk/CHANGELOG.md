## 2.549.0

### Added — a Telegram chat can be picked by name, not just the bot as a whole

Destinations now include individual notification targets, not only services. A
Telegram bot with two permitted chats appears as those two chats by name, so a
briefing can go to the group rather than to everything the bot can reach. The
one entry that could be chosen and then fail — the generic "send_message" that
needs a target — is no longer offered, because the things it stood for are now
listed individually.

## 2.548.0

### Changed — each schedule now carries its own recipients, and there is no separate destination list

A briefing is one thing: how often, at what hour, who it is written for, and
who receives it. The previous layout put recipients in their own section
further down the page, so answering "who gets this one" meant cross-referencing
two lists and remembering which was in force. Each schedule is now a card
holding all four. An existing shared list is copied onto the schedules that
were using it when the tab is opened, and nothing changes until Save is
pressed — briefings keep arriving where they were arriving until then.

