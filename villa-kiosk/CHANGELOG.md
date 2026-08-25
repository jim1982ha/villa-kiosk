## 2.747.0

### Fixed — the (i) bubble had no background, and twelve other rules were dropped the same way

The bubble named six colour and radius tokens that this stylesheet has never declared, and a `var()`
with no fallback and no declaration is an invalid value — so `background` simply did not apply and the
text rendered straight over the row beneath it, unreadable on a phone. It now uses the same tokens as
the existing banner surface. The scan for it found the same fault in twelve other places: eight rules
reading `--text-muted` and four reading `--status-ok`, neither of which exists, both silently
colourless. This had already been found once and fixed at a single call site, with a comment recording
it — so a test now refuses any rule that reads a property nothing declares, deriving the runtime-set
exceptions from the app rather than from a list, so removing a writer fails too.

