"""nginx must not serve before the backend it proxies to is accepting.

⚠️ FOUND IN THE ADD-ON LOG, NOT IN A TEST — pairs of
`connect() failed (111: Connection refused) ... upstream: 127.0.0.1:8100` on
`/telemetry` and `/core/websocket`, recurring across restarts.

⚠️ THE TWO ENDPOINTS ARE THE EVIDENCE, NOT A COINCIDENCE. They are what a kiosk
page requests the instant it loads, which is exactly when a just-restarted
add-on is still inside `on_startup`. Every other route in the allow-list was
answering 200 seconds later, which is what ruled out "the backend is down".

⚠️ WHAT s6's DEPENDENCY ACTUALLY BUYS, AND IT IS LESS THAN IT LOOKS.
`nginx/dependencies.d/supervisor-proxy` orders the START of the two services:
s6 considers a longrun up the moment it has SPAWNED. It has no idea whether the
process has bound a socket. The proxy's `on_startup` then makes two Supervisor
round trips before aiohttp serves anything, so the window is real and is as long
as the Supervisor is slow.

⚠️ AND THE FIX MUST NOT BE ABLE TO WEDGE THE CONTAINER. nginx serves the
add-on's own diagnostics, so a wait that never gives up would hide the fault
somebody is trying to read. The wait is bounded and starts nginx regardless.
"""

from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S6 = os.path.join(ROOT, "rootfs", "etc", "s6-overlay", "s6-rc.d")
NGINX_RUN = os.path.join(S6, "nginx", "run")


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def test_nginx_waits_for_the_backend_before_it_serves() -> None:
    run = _read(NGINX_RUN)
    port = _backend_port()
    assert re.search(rf"nc -z 127\.0\.0\.1 {port}", run), (
        f"nginx no longer waits for 127.0.0.1:{port}, so every restart serves "
        "requests the backend refuses")
    # the wait must come BEFORE nginx is exec'd, or it waits for nothing
    assert run.index("nc -z") < run.index("exec nginx"), (
        "the readiness check runs after nginx has already replaced the shell")


def test_the_wait_is_BOUNDED_and_starts_nginx_anyway() -> None:
    """⚠️ A BACKEND THAT NEVER COMES UP IS A REAL FAILURE, and nginx serving
    502s is strictly better than nginx never starting — the diagnostics that
    would explain the failure are served through it."""
    run = _read(NGINX_RUN)
    assert "while" in run and re.search(r"-lt \d+", run), "the wait is unbounded"
    tail = run[run.index("done"):]
    assert "exec nginx" in tail, (
        "nginx is not started after the wait gives up, so a slow backend wedges "
        "the whole add-on including its own diagnostics")


def _backend_port() -> str:
    """The port nginx proxies to, read from the config rather than restated.

    ⚠️ DERIVED, BECAUSE A LITERAL HERE WOULD BE A THIRD PLACE THE PORT LIVES —
    it is already in `nginx.conf` and in `supervisor-proxy.py`'s `run_app`, and
    the whole point of this file is that those two must agree at STARTUP as
    well as in configuration.
    """
    conf = _read(os.path.join(ROOT, "rootfs", "etc", "nginx", "nginx.conf"))
    ports = set(re.findall(r"proxy_pass http://127\.0\.0\.1:(\d+)", conf))
    assert len(ports) == 1, f"nginx proxies to several backends: {ports}"
    return ports.pop()


def test_the_port_nginx_WAITS_for_is_the_port_it_PROXIES_to() -> None:
    """⚠️ THE CROSS-ARTEFACT HALF. A wait on the wrong port succeeds instantly
    and reports health forever — the shape of a check that passes while
    measuring nothing. Both sides are read from the shipped files."""
    port = _backend_port()
    proxy = _read(os.path.join(ROOT, "rootfs", "usr", "bin",
                               "supervisor-proxy.py"))
    assert re.search(rf"port={port}\b", proxy), (
        f"nginx waits for and proxies to {port}, but the app does not bind it")
    assert f"127.0.0.1 {port}" in _read(NGINX_RUN)
