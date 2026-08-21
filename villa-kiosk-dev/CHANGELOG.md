## 2.562.0

### Changed — a check that was reporting success on cases it could not read

The check added last release, meant to keep every dialog's save button in its
footer, could not see a button whose handler is written inline — which is nearly
all of them. It caught the one it was written for by coincidence. It now reads
whole buttons, and knows that a save belonging to a single record rather than to
the dialog is allowed to sit beside that record. No behaviour changes here; the
guard around it does.

