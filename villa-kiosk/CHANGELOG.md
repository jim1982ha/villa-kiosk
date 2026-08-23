## 2.689.0

### Added — the approval queue is answerable, and TASK-063's missing precondition is recorded
`investigate_mode: approve` shipped one release ago writing an audit row per
flagged subject and nothing more: no list, no way to answer it, so choosing it
gave a villa that flagged things into a file. The Cockpit now shows what is
waiting, with a button that runs the investigation the check would have run —
through the same function the automatic path uses, not a second one — and a
dismiss that settles it. The queue is derived from the audit rather than stored,
so approving cannot lose an item. Separately: `agent/route.py` is imported by
nothing shipped, so "turn off shadow" would have delivered to nobody and a
supervised period would have measured silence and read as success.

