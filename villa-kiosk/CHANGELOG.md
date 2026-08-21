## 2.560.0

### Fixed — the briefing still carried internal names, and the previous fix could not reach them

Underscored identifiers were reaching the delivered message — "level_anomaly did
not run", "entity_id (use entities)" — where Telegram reads an underscore as the
start of italics and ran the emphasis on through the following sentences. The
previous release tried to stop Telegram interpreting the text at all, which
cannot work for a message addressed to a specific chat: that route offers no
such setting. The names are now written out properly instead — "Meters that
stopped reporting did not run" — so there is nothing left to misread.

