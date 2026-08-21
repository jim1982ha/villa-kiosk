## 2.555.0

### Fixed — the delivery record understated its own briefing, and the privacy panel overstated itself

A briefing built from this property's automations was recorded as containing
nothing: the count and the severity looked only at the add-on's own checks, so
a week opening "1 critical alert is still unresolved" went into the history as a
quiet one. The panel showing what would be sent to an AI service also listed
fields as withheld that are in fact permitted and merely happened to be empty —
claiming a protection that does not exist. A rule name with no label now reads
as words instead of as its identifier, and a setting left behind by an older
version is cleared the next time settings are saved.

