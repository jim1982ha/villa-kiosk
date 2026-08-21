## 2.557.0

### Fixed — the "next send" line kept describing the schedule you just changed

Editing a schedule from weekly to daily and saving left the line underneath
reading the old day and time. It is computed by the add-on from the stored
settings, and nothing asked it again after a save. It now refreshes when you
save, and while a row has unsaved edits it says so instead of showing a date
that belongs to the previous version of it.

