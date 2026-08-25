## 2.746.0

### Fixed — alerts were essays with a hole in them, and occupancy has never been readable

A delivered warning ran to four paragraphs and carried "(unsourced figure removed)" mid-sentence. The
concern tool asked for "what is wrong, what it rests on, and what a person should do" with no length
given, so it got an investigation narrated in full; it now asks for at most three short sentences and
says the evidence rows already hold the rest. The number check treated a sigma as a measured reading,
which no evidence row can contain because the model derives it — the same mistake this file already
recorded making with counts, so sigma joins the derived list. Separately the delivery sweep read
occupancy through a function that does not exist, so every sweep raised and swallowed it: nothing was
wrongly held, but nothing could be held back for an empty house either. Step headers are now one line.

