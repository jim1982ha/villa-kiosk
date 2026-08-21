## 2.554.0

### Added — a one-paste check that the briefing subsystem is working

`tests/qa/briefings-qa.js` is pasted into a browser console on the kiosk and
prints a pass/fail line per feature: the endpoints, the stored settings, when
each schedule next goes out, the destinations offered, the checks, and — for
narration — exactly what would leave the property. It reads and previews only:
no setting is written and no notification is sent.

