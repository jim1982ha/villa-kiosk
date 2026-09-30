#!/usr/bin/env python3
"""Replay the nightly batch over a range of dates and print the timeline.

  python replay.py --pack pack.json --fixture-dir DIR --from 2026-09-03 --to 2026-09-29 [--store tmp.sqlite]
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nightly  # noqa: E402


def replay(pack: str, fixture_dir: str, start: date, end: date, store: str | None = None, zone: str | None = None) -> list[dict]:
    store = store or os.path.join(tempfile.mkdtemp(), "replay.sqlite")
    timeline = []
    d = start
    while d <= end:
        ns = argparse.Namespace(pack=pack, store=store, fixture_dir=fixture_dir, zone=zone, as_of=d.isoformat(), out=None, skip_raw=False)
        res = nightly.run(ns)
        for f in res["new_findings"]:
            timeline.append({"night": d.isoformat(), "kind": "new", **f})
        for f in res["still_open"]:
            if f.get("worsened"):
                timeline.append({"night": d.isoformat(), "kind": "update", **f})
        for f in res["closed"]:
            timeline.append({"night": d.isoformat(), "kind": "closed", "rule_id": f["rule_id"], "entity_id": f["entity_id"],
                             "severity": f["severity"], "summary": f["summary"]})
        d += timedelta(days=1)
    return timeline


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--fixture-dir", required=True)
    ap.add_argument("--from", dest="start", required=True)
    ap.add_argument("--to", dest="end", required=True)
    ap.add_argument("--store")
    ap.add_argument("--zone")
    a = ap.parse_args(argv)
    for row in replay(a.pack, a.fixture_dir, date.fromisoformat(a.start), date.fromisoformat(a.end), a.store, a.zone):
        print(f"{row['night']}  {row['kind']:7}{row['severity']:5}{row['rule_id']:20}{row['summary']}")


if __name__ == "__main__":
    main()
