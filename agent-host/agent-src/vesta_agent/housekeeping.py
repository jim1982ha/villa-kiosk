"""What the agent keeps, and for how long: the one place anything it records is deleted (owner, 2026-10-06).

Until 0.6.41 nothing was ever deleted: every run and every refusal in the agent's
records, every AI conversation transcript, every alert copy and report page in its
out folder, every day of every device's figures. Each grows a little every day, on a
Home Assistant Yellow's storage, for the life of the villa.

The limits are the villa's, in policy.yaml `settings.keep` (policy.KEEP: defaults and
bounds). Runs nightly after the knowledge pack, and once at start. Kept on purpose:
the villa's history (incidents, findings, tasks, proposals), pending approvals, the
sessions table (one row per chat), and anything a conversation in use still writes.

A deleted row frees its space inside the SQLite file for the next ones: the file
stops growing; it does not shrink (no VACUUM: it would lock the agent for seconds).
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger("vesta.housekeeping")


def _files_older(folder: str, days: int, now: float, suffixes: tuple[str, ...] | None = None,
                 skip: tuple[str, ...] = (), whole: bool = False) -> int:
    """Delete the files under `folder` last written more than `days` ago. Returns how many.
    `whole`: each entry directly in `folder` is one thing, judged by its own date and removed whole (the skills'
    trash: skills.to_trash dates a folder the day it went there)."""
    if not os.path.isdir(folder):
        return 0
    cut, n = now - days * 86400, 0
    if whole:
        import shutil
        for name in os.listdir(folder):
            p = os.path.join(folder, name)
            try:
                if os.path.getmtime(p) < cut:
                    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
                    n += 1
            except OSError:
                continue
        return n
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            p = os.path.join(root, f)
            if suffixes and not f.endswith(suffixes):
                continue
            try:
                if os.path.getmtime(p) < cut:
                    os.remove(p)
                    n += 1
            except OSError:
                continue
    for root, dirs, files in os.walk(folder, topdown=False):      # folders a deletion emptied
        if root != folder and not os.listdir(root):
            try:
                os.rmdir(root)
            except OSError:
                pass
    return n


def tidy(settings, state, keep: dict[str, int], now: datetime | None = None) -> dict[str, int]:
    """Apply settings.keep. Returns what was removed, by kind (logged by the caller)."""
    now = now or datetime.now(timezone.utc)
    ago = lambda days: (now - timedelta(days=days)).isoformat()            # noqa: E731
    out = state.prune(runs_before=ago(keep["runs_days"]), records_before=ago(keep["records_days"]))
    stamp = now.timestamp()
    # The AI's transcripts: the CLI writes one file per conversation under its config folder (projects/).
    out["conversations"] = _files_older(os.path.join(settings.claude_dir, "projects"), keep["conversations_days"],
                                        stamp, (".jsonl", ".json"))
    out["files"] = _files_older(settings.out_dir, keep["files_days"], stamp)
    out["daily_figures"] = _prune_figures(settings.store_path, now, keep["daily_figures_months"])
    from .history import History
    out["page changes"] = History(settings.history_path).prune(keep["records_days"], now)
    # skills deleted or replaced on the page (skills/.trash): kept to undo a mistake, as long as the out folder's files
    from .skills import TRASH
    out["skills in the trash"] = _files_older(os.path.join(settings.skills_dir, TRASH), keep["files_days"], stamp, whole=True)
    return out


def _prune_figures(store_path: str, now: datetime, months: int) -> int:
    """The skills' daily figures per device (vesta_store features), day by day, older than `months`."""
    if not os.path.exists(store_path):
        return 0
    cut = (now - timedelta(days=round(months * 30.44))).date().isoformat()
    for attempt in range(3):            # a skill script may be writing: wait for it, never fail the night
        try:
            from vesta_shared.store import Store          # the store owns its tables' SQL
            st = Store(store_path)
            st.db.execute("PRAGMA busy_timeout = 30000")
            try:
                return st.prune_features(cut)
            finally:
                st.db.close()
        except sqlite3.OperationalError as e:
            if "no such table" in str(e):
                return 0
            time.sleep(2 * (attempt + 1))
    log.warning("Housekeeping: the daily figures could not be trimmed tonight (store busy)")
    return 0
