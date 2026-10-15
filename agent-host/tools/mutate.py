#!/usr/bin/env python3
"""Prove a check can fail: break one piece of code, run the check, put the code back — whatever happens.

  python3 tools/mutate.py FILE 'exact old text' 'new text' -- CMD [ARGS...]
  python3 tools/mutate.py --restore            # put back what a killed run left broken

RED (exit 0): the check went red on the mutant — it catches this. STILL GREEN (exit 1): it does not. Exit 2: refused
(the old text is not in FILE exactly once, a previous run left a breadcrumb, the command could not start).

⚠️ WHY A TOOL (retro, 2026-10-15): proving a check by hand was "back the file up, sed it, run, copy it back" — nine
times in one session, each one a live mutant left behind if the run was killed (a sweep did exactly that once). Here:
the old text is literal (no regex: a `sed` that matches nothing proves nothing — refused), the file is restored in a
`finally` and on SIGINT/SIGTERM, a breadcrumb (.mutate-breadcrumb.json at the repository root) names the file and its
original until the restore is done, and the restored bytes are checked against the original.

Each app keeps its own copy (docs/adr/0001: no tooling shared across branches); this one is the VESTA Agent's:
  agent-host/.venv/bin/python agent-host/tools/mutate.py FILE OLD NEW -- CMD…
"""
from __future__ import annotations

import json
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CRUMB = ROOT / ".mutate-breadcrumb.json"


class Refused(Exception):
    pass


def _put_back(path: Path, original: bytes) -> None:
    path.write_bytes(original)
    if path.read_bytes() != original:
        raise Refused(f"{path} could not be restored: its original is in {CRUMB}")
    CRUMB.unlink(missing_ok=True)


def restore() -> int:
    if not CRUMB.exists():
        print("nothing to restore")
        return 0
    crumb = json.loads(CRUMB.read_text())
    _put_back(Path(crumb["file"]), crumb["original"].encode("latin-1"))
    print(f"restored {crumb['file']}")
    return 0


def mutate(file: str, old: str, new: str, cmd: list[str]) -> int:
    if CRUMB.exists():
        raise Refused(f"a previous run left {json.loads(CRUMB.read_text())['file']} mutated: run --restore first")
    path = Path(file).resolve()
    original = path.read_bytes()
    text = original.decode("utf-8")
    if text.count(old) != 1:
        raise Refused(f"the old text occurs {text.count(old)} times in {file}: it must occur exactly once")
    if not cmd:
        raise Refused("give the check to run after --")
    CRUMB.write_text(json.dumps({"file": str(path), "original": original.decode("latin-1")}))

    def stop(signum, _frame):
        raise KeyboardInterrupt(f"signal {signum}")
    before = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
        try:
            code = subprocess.run(cmd, cwd=Path.cwd(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT).returncode
        except OSError as e:
            raise Refused(f"the check could not start: {e}") from None
    finally:
        _put_back(path, original)
        for s, h in before.items():
            signal.signal(s, h)
    if code != 0:
        print(f"RED (exit {code}): the check catches this mutation of {file}")
        return 0
    print(f"STILL GREEN: the check misses this mutation of {file}")
    return 1


def main(argv: list[str]) -> int:
    try:
        if argv[:1] == ["--restore"]:
            return restore()
        if "--" not in argv or argv.index("--") != 3:
            print(__doc__.split("\n\n")[1], file=sys.stderr)
            return 2
        return mutate(argv[0], argv[1], argv[2], argv[4:])
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted: the file is restored", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
