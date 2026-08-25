## 2.744.0

### Fixed — the villa reported a coverage gap that never happened, on the owner's phone

At 19:03 the agent escalated "Coverage incomplete", investigated it and delivered a warning that part
of the period had not been observed, extent unknown. The villa had been observing perfectly. The
observation loop called its own cycle without a timestamp, so the journal wrote an empty "listening
since" on every pass — and coverage is computed as "do we have a listening-since", which answered no.
It has answered no since that loop was written, on every property, which is why every villa document
has carried "part of this window was not observed" above it. The same message said log access was down:
that tool is published with no source wired, so it can only refuse. A tool that cannot answer is no
longer offered to the model, and the gap is logged for the operator instead of reaching a household.

