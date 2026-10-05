#!/usr/bin/env python3
"""The crash-loop rule every s6 `finish` script calls
(rootfs/usr/bin/vesta-service-finish), run for real with sh — off the
container, with its three paths pointed at a temporary folder and `halt`
replaced by a script that records being called.

A one-off crash must keep s6 restarting the service in place (as before);
CRASH_LIMIT crashes within CRASH_WINDOW must stop the container with the
service's code, so Home Assistant shows the add-on failed and its watchdog
can restart it; a clean exit or the container's own stop must do nothing.

Run: python3 tests/service-finish.py   (also `npm run test:service-finish`)
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "rootfs" / "usr" / "bin" / "vesta-service-finish"
FAIL = 0


def ck(name, ok, detail=""):
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}" + (f"  →  {detail}" if detail and not ok else ""))
    FAIL += 0 if ok else 1


class Box:
    def __init__(self):
        self.d = Path(tempfile.mkdtemp())
        self.results = self.d / "exitcode"
        self.results.write_text("0\n")
        self.halt = self.d / "halt"
        self.halt.write_text(f"#!/bin/sh\necho halted >> {self.d / 'halted'}\n")
        self.halt.chmod(0o755)

    def run(self, code, signal="0", service="nginx"):
        env = dict(os.environ, VESTA_FINISH_RESULTS=str(self.results),
                   VESTA_FINISH_DIR=str(self.d / "crashes"), VESTA_FINISH_HALT=str(self.halt))
        return subprocess.run(["sh", str(SCRIPT), service, str(code), str(signal)],
                              env=env, capture_output=True, text=True)

    @property
    def halted(self):
        return (self.d / "halted").exists()

    @property
    def code(self):
        return self.results.read_text().strip()


b = Box()
b.run(0)
ck("a clean exit: nothing recorded, nothing stopped", not b.halted and not (b.d / "crashes" / "nginx").exists())
b.run(256, 15)
ck("the container's own stop (SIGTERM): nothing recorded, nothing stopped", not b.halted and not (b.d / "crashes" / "nginx").exists())

b = Box()
outs = [b.run(1) for _ in range(4)]
ck("four crashes in a row: restarted in place each time, the add-on keeps running",
   not b.halted and all(o.returncode == 0 and "restarting" in o.stdout for o in outs) and b.code == "0",
   [o.stdout for o in outs])
o = b.run(1)
ck("the fifth within two minutes: the container is stopped with the service's code",
   b.halted and b.code == "1" and "stopping the add-on" in o.stdout, (o.stdout, b.code))

b = Box()
b.results.write_text("3\n")
for _ in range(5):
    b.run(1, service="supervisor-proxy")
ck("  ...keeping the code another service stopped it with first", b.halted and b.code == "3", b.code)

b = Box()
for _ in range(5):
    b.run(1, service="nginx") if _ % 2 else b.run(1, service="supervisor-proxy")
ck("crashes are counted per service (3 + 2 is not a loop)", not b.halted)

b = Box()
(b.d / "crashes").mkdir()
old = int(time.time()) - 500
(b.d / "crashes" / "nginx").write_text("".join(f"{old}\n" for _ in range(10)))
b.run(1)
ck("crashes older than the window do not count (ten old ones + one new is not a loop)", not b.halted)

b = Box()
for _ in range(5):
    b.run(256, 9)
ck("a service KILLED by a signal counts as a crash, with code 128 + signal", b.halted and b.code == "137", b.code)

print("\n✅ the crash-loop rule holds" if FAIL == 0 else f"\n❌ {FAIL} failed")
sys.exit(1 if FAIL else 0)
