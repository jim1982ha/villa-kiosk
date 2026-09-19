"""Everything the layer remembers, as JSON files under one configurable root.

⚠️ FILES, NOT SQLITE, AND THE TRIGGER TO CHANGE THAT IS A MEASUREMENT. The case
for a database rested on the journal, and the journal problem does not transfer
to this layer: the branch that filled 9,355 rows/day POLLED ~484 entities every
15 minutes, while this layer is push-driven and allowlisted to assets — on the
plan's own funnel, ~300 events a MONTH. Files win on what matters on a villa
with no tooling: readable with `cat`, backed up as-is by the Supervisor, no
schema and no migration from commit one. Revisit at ~100k journal rows, or when
a query needs a time-range index — on the number, not on the feeling.

⚠️ THE ROOT IS AN ARGUMENT. A module that hardcodes /data is a module whose
tests either touch the real volume or do not run.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

#: Supervisor's private, backed-up volume for this add-on.
DATA_ROOT = Path("/data")

_KEY = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class Store:
    """A tiny key→JSON document store. One file per key, atomically written."""

    def __init__(self, root: Path | str = DATA_ROOT) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        if not _KEY.match(key):
            raise ValueError(
                f"store key {key!r} is not a plain name — a key names a document, "
                f"it is not a path, and accepting one lets a caller write outside "
                f"the add-on's own volume")
        return self.root / f"{key}.json"

    def get(self, key: str, default: Any = None) -> Any:
        """The document, or `default` when it is absent or unreadable.

        Unreadable counts as absent on purpose: a truncated file from a power
        cut must not take the layer down on every subsequent start.
        """
        # ⚠️ OUTSIDE THE `try`. With the path computed inside it, the broad
        # except that absorbs a truncated file also absorbed `_path`'s
        # ValueError — so a caller passing "nested/key" or "../escape" got a
        # silent default instead of the programming error it is.
        path = self._path(key)
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            return default
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return default

    def put(self, key: str, value: Any) -> None:
        """Replace the document, atomically.

        ⚠️ TEMPFILE-THEN-RENAME, BECAUSE THE POWER GOES OFF IN A VILLA. An
        interrupted plain write leaves valid-looking half-JSON that every later
        read fails on; a rename is atomic on POSIX, so a reader sees either the
        old document or the new one and never a partial one.
        """
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{key}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(value, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def append(self, key: str, entry: Any, keep: int | None = None) -> None:
        """Add one row to a list document, keeping at most the newest `keep`."""
        rows = self.get(key, default=[])
        if not isinstance(rows, list):
            rows = []
        rows.append(entry)
        if keep is not None and keep >= 0:
            rows = rows[-keep:]
        self.put(key, rows)
