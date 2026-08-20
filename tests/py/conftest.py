"""Make `import reports` work from the test suite.

In production the package resolves for free: the s6 service runs
`python3 /usr/bin/supervisor-proxy.py`, so `sys.path[0]` is `/usr/bin` and
`reports/` sits right there. Nothing about that helps here, where the tree is a
git checkout and pytest's rootdir is the repository.

This is the ONLY place the path is stated for tests. A test that inserts its
own would work until the layout moved, and then fail in a way that looks like a
missing module rather than a stale path.
"""

from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_PARENT = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")

if PACKAGE_PARENT not in sys.path:
    # Appended, not inserted at 0: this directory will hold more modules as the
    # subsystem grows, and putting it ahead of the standard library means any
    # future file named after a stdlib module silently shadows it for the whole
    # test session. The package we want is not a stdlib name, so last is fine.
    sys.path.append(PACKAGE_PARENT)
