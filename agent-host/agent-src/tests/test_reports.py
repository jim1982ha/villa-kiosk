"""The reports composer, as the model calls it (synthetic: no villa data)."""
from __future__ import annotations

import os
import subprocess
import sys

from helpers import ROOT, STARTER_SKILLS

COMPOSE = os.path.join(STARTER_SKILLS, "reports", "scripts", "compose.py")


def test_a_page_without_its_energy_file_stops_and_says_what_to_run(tmp_path):
    # 2026-09-30: called without --energy, the weekly page died in Jinja ("type Undefined
    # doesn't define __round__") and the model told the owner "a template error".
    for cmd in ("fm-weekly", "owner-weekly", "owner-monthly"):
        r = subprocess.run([sys.executable, COMPOSE, cmd, "--pack", str(tmp_path / "none.json"), "--out", "x.html"],
                           capture_output=True, text=True, env={**os.environ, "PYTHONPATH": ROOT})
        assert r.returncode == 1, (cmd, r.stderr)
        assert f"{cmd} needs --energy" in r.stderr and "energy_period.py" in r.stderr
        assert "Traceback" not in r.stderr
