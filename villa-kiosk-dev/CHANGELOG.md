## 2.738.0

### Fixed — every restart re-recorded the whole villa, filling the observation journal and evicting real history

The agent reported its monitoring journal full and dropping its oldest data, and it was right. The
observation cycle keeps its comparison baseline in process memory while the journal lives on disk, and
nothing joined the two — so the first cycle after every restart saw no baseline, called all 1,256
entities new and wrote the whole villa in one go: ~12 ordinary cycles, three hours of history, evicted
per restart to re-record states already held. Eleven restarts in one afternoon of dev releases cost over
a day of the window. The baseline now comes back from the journal, so a restart re-journals only what
moved while the process was down and a cold start still sweeps as designed; seeded attributes are marked
unknown rather than empty, or every climate unit and cover would re-journal on each restart.

