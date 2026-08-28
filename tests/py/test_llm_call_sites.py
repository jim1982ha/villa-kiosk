"""The backend has exactly TWO places that can ask a model anything.

Found — as a property, already true — by the agentic-workflow audit of
2026-08-27, and pinned so it stays a property rather than a coincidence:

  1. `agent/registry.py` — the ONE agent loop (`run`), shared by every tier
     and every entry point (scheduled, kiosk, chat, event). ARCH-012.
  2. `reports/pipeline.py` — the narration overlay, ONE optional call per
     brief, filling one sentence (the lead slot).

⚠️ WHAT THIS FORBIDS IS "LLM PING-PONG" ARRIVING SILENTLY. A reviewer stage, a
summariser-of-a-summary, a second formatter call — every one of them begins
life as a third call site somewhere plausible, individually defensible, and
invisible in review because the diff that adds it is small. The audit
established that cost here is `prefix × turns` and that every deleted stage of
this subsystem (the stand-down machinery, the whole-body narrator, the 44-tool
catalogue) was priced before it was cut; a new call site is a new bill and a
new failure mode, and it should have to say so in this file's exemption style
rather than merely compile.

⚠️ TRANSPORT LIVES ONE LEVEL DOWN AND IS PINNED SEPARATELY. The SDK/API calls
themselves (`messages.create`, the provider POST) belong to the two adapter
files — `agent/llm/anthropic_sdk.py` and `reports/narrate/providers.py` — and
`test_narration_provider.py` already pins their hostnames out of `src/`. This
file pins the CALLERS of the seam, not the seam's own plumbing.

⚠️ DERIVED FROM THE TREE, NEVER LISTED BY FILE COUNT. The assertion names the
two files that MAY hold a call site and fails on any other file gaining one —
so a legitimate third site (if the product ever earns one) is added by editing
the expectation here, alongside a sentence about what it costs per run.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND = os.path.join(REPO_ROOT, "rootfs", "usr", "bin")

#: The seam's invocation shapes. `provider.run(` is the agent loop's entry into
#: `llm/base.Provider`; `.narrate(` is the narration provider's. Comment lines
#: are stripped before matching, so prose about the seam does not count.
CALL = re.compile(r"(?:await\s+)?\w+\.(run|narrate)\(")

#: file (repo-relative) -> the seam methods it may invoke. Everything else in
#: the backend may invoke neither.
ALLOWED: Dict[str, set] = {
    # The one agent loop. ⚠️ `run` here is Provider.run — the loop's single
    # model call per turn, bounded by depth/deadline/budget upstream.
    "rootfs/usr/bin/vesta/supervise/agent/registry.py": {"run"},
    # The brief's narration overlay: one optional sentence per report.
    "rootfs/usr/bin/vesta/brief/pipeline.py": {"narrate"},
    # The seam's own plumbing: the bounded wrapper forwards run() to the inner
    # provider, and the adapter table's entries implement narrate() — callers
    # one level INSIDE the boundary, not new doors through it.
    "rootfs/usr/bin/vesta/supervise/agent/runtime.py": {"run"},
    "rootfs/usr/bin/vesta/brief/narrate/providers.py": {"narrate"},
}

#: Names whose `.run(`/`.narrate(` is NOT the provider seam. Each is verified
#: at the pattern below by requiring the receiver to be provider-shaped.
_PROVIDER_RECEIVERS = ("provider", "self._inner", "inner", "adapter")


def _call_sites() -> List[str]:
    """Every `<provider-shaped receiver>.run(|.narrate(` in the backend."""
    hits: List[str] = []
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, REPO_ROOT)
            with open(path, encoding="utf-8") as handle:
                for lineno, line in enumerate(handle, 1):
                    code = line.split("#", 1)[0]
                    for match in re.finditer(
                            r"(?:await\s+)?(?P<recv>[\w.]+)\."
                            r"(?P<meth>run|narrate)\(", code):
                        recv = match.group("recv")
                        if not any(recv == r or recv.endswith("." + r)
                                   or r in recv
                                   for r in _PROVIDER_RECEIVERS):
                            continue
                        hits.append(f"{rel}:{lineno}:{match.group('meth')}")
    return sorted(hits)


def test_exactly_the_allowed_files_invoke_the_seam() -> None:
    sites = _call_sites()
    # ⚠️ VACUOUS-PASS GUARD: the two real sites MUST be found, or the regex has
    # drifted off the idiom and every other assertion here is comparing empty
    # sets — the four-counters-read-zero failure this suite keeps meeting.
    assert any(s.startswith("rootfs/usr/bin/vesta/supervise/agent/registry.py")
               and s.endswith("run") for s in sites), (
        f"the agent loop's own call site was not found — pattern drift; saw {sites}")
    assert any(s.startswith("rootfs/usr/bin/vesta/brief/pipeline.py")
               and s.endswith("narrate") for s in sites), (
        f"the narration call site was not found — pattern drift; saw {sites}")

    strays = []
    for site in sites:
        rel, _, meth = site.rsplit(":", 2)
        if meth not in ALLOWED.get(rel, set()):
            strays.append(site)
    assert not strays, (
        "a NEW model-invocation site appeared outside the two allowed files.\n"
        "If it is deliberate, add it to ALLOWED with a sentence about what it "
        "costs per run — a third LLM call is a bill and a failure mode, not "
        "an implementation detail:\n  " + "\n  ".join(strays))
