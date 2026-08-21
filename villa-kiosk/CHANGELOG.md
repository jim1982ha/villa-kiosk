## 2.556.0

### Fixed — a rule's internal name still appeared in the briefing

The previous release tidied the wrong copy of it: the name only looked like a
fallback, and the one the briefing actually prints comes straight from the
automation that raised the alert. It is now cleaned up where a name is read
rather than where one is built, so every section gets it. Labels written by a
person are left exactly as they are — "Lights - monitored rooms" stays that way.

