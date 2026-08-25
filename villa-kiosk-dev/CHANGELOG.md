## 2.745.0

### Fixed — the (i) bubble was clipped by the dialog, and coverage is now readable on the heartbeat

The hint opened inside a pane that scrolls, within a dialog that hides its overflow, so a bubble near
the bottom showed two lines and a cut edge — and it anchored to the icon, which sits at the end of a
sentence, so a wide block started at the right margin and hung off. It now renders outside the dialog
entirely and takes its left edge and width from the paragraph it belongs to, flipping above when there
is no room below. No z-index beats a clip; the element has to leave the clipping ancestor. Separately
the hourly heartbeat now prints whether the agent believes it was watching, and the listening-since
stamp behind that verdict — so yesterday's false coverage warning can be confirmed fixed by reading a
line rather than tracing code. An empty stamp prints as ?, because that is the defect, not a blank.

