## 2.739.1

### Fixed — a placeholder entity id shipped past the hard-rules gate, for the second time

`tests/py/test_heartbeat.py` reached the repository carrying `light.quiet`, which nothing had
classified. The gate that exists to stop this was run and was green: it builds its file list from
TRACKED source, so a brand-new file is invisible to it until the commit that adds it — and the commit
is the one moment nobody re-runs the suite. Classified now, and the ship procedure has been changed
rather than the lesson merely re-noted: staging new files moved ahead of verifying, because the old
step order guaranteed the blind spot for any release adding a file.

