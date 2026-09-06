"""Every field on `ReportContext` either reaches a reader, or says why not.

⚠️ AND WHERE THE VILLA'S MASTER SWITCH LIVES. `supervision_enabled` was
carried four hops — `agent-config.json` to `BriefRequest.from_config`, to
`run_report`, to `analyse`, to `ModuleContext` — under a comment warning that
without the last line the flag would "never reach the gate". It reached the
gate and the gate never asked, and the test defending it named the diagnostics
banner as a reader when the banner reads the proxy's own `supervision_on`.

The three plumbing hops are gone (2.967.0). The switch is not: it is resolved
on `BriefRequest`, which is where a reader that needs it will look, and
`test_the_master_switch_is_resolved_and_goes_no_further` below is what keeps
that honest in both directions — it fails if the switch stops being read from
config, and it fails if the plumbing comes back.
"""

from __future__ import annotations

import re
import subprocess

from conftest import REPO_ROOT, strip_prose

#: field -> why it is built and not read. ⚠️ A DECISION PER ENTRY, like every
#: other exemption map in this suite, and the same rot check.
NOT_YET_CONSUMED = {
    "ran": "the modules that DID run. Its doc-comment states a real need — "
           "'no checks are configured' and 'every check ran and found nothing' "
           "mean opposite things — and `payload.from_context` does not carry "
           "it, so the provider cannot tell them apart either. Wiring it is a "
           "product decision about what may leave the villa",
    "skipped": "the modules that did not run, and why. Same gap as `ran`, and "
               "the same decision: a skip reason names a module, not a device, "
               "so the privacy question is answerable — it has not been asked",
    "generated_at": "the stamp. The payload carries `period` and `cadence`; "
                    "nothing has needed the exact moment",
}


def _readers() -> str:
    out = subprocess.run(["git", "ls-files", "rootfs"], cwd=REPO_ROOT,
                         capture_output=True, text=True).stdout.split()
    body = []
    for rel in out:
        if not rel.endswith(".py"):
            continue
        try:
            text = open(f"{REPO_ROOT}/{rel}", encoding="utf-8").read()
        except OSError:
            continue
        try:
            body.append(strip_prose(text))
        except SyntaxError:                        # pragma: no cover
            body.append(text)
    return "\n".join(body)


def _declared() -> list:
    src = open(f"{REPO_ROOT}/rootfs/usr/bin/vesta/brief/narrate/base.py",
               encoding="utf-8").read()
    block = src[src.index("class ReportContext:"):]
    block = block[:block.index("\n\n\n")] if "\n\n\n" in block else block
    return re.findall(r"^    (\w+):", block, re.M)


def test_every_field_is_read_or_named_as_not_yet_consumed() -> None:
    declared = _declared()
    assert len(declared) >= 10, (
        "only %d fields parsed off ReportContext — the scan has rotted and "
        "would report health for ever" % len(declared))
    text = _readers()
    unread = []
    for field in declared:
        pattern = re.compile(rf'(?<![\w.])context\.{field}\b'
                             rf'|getattr\(context,\s*"{field}"')
        if not pattern.search(text):
            unread.append(field)
    unexplained = sorted(f for f in unread if f not in NOT_YET_CONSUMED)
    assert not unexplained, (
        "these ReportContext fields are built every Brief and read by nothing: "
        "%s.\nEither give one a reader, or name it in NOT_YET_CONSUMED with "
        "what it would take — a field that looks wired and is not is the "
        "shape this repository keeps paying for." % unexplained)


def test_the_not_yet_consumed_map_does_not_rot() -> None:
    """⚠️ AN ENTRY FOR A FIELD THAT NOW HAS A READER RE-BLESSES THE NEXT ONE.
    Two of the sixteen exemption maps in this suite had no rot check when this
    was written; that is how a decision list decays into a suppression list."""
    declared = set(_declared())
    text = _readers()

    gone = sorted(f for f in NOT_YET_CONSUMED if f not in declared)
    assert not gone, (
        "NOT_YET_CONSUMED names fields that no longer exist: %s" % gone)

    wired = []
    for field in NOT_YET_CONSUMED:
        pattern = re.compile(rf'(?<![\w.])context\.{field}\b'
                             rf'|getattr\(context,\s*"{field}"')
        if pattern.search(text):
            wired.append(field)
    assert not wired, (
        "these have a reader now, so the entry is a stale decision: %s" % wired)


def test_the_master_switch_is_resolved_and_goes_no_further() -> None:
    """⚠️ BOTH DIRECTIONS, because half of this is a feature and half was a leak.

    The switch must still be READ from the villa's config — a brief that cannot
    tell whether supervision is on has lost the fact, not the plumbing. And it
    must not be threaded into the analysis context again, where four hops
    arrived at no reader and looked like a live gate.
    """
    import dataclasses
    import sys

    sys.path.insert(0, f"{REPO_ROOT}/rootfs/usr/bin")
    from vesta.brief.request import BriefRequest
    from vesta.shared.analysis.base import ModuleContext

    on = BriefRequest.from_config({}, {"enabled": True}, {})
    off = BriefRequest.from_config({}, {"enabled": False}, {})
    assert on.supervision_enabled is True and off.supervision_enabled is False, (
        "the master switch is no longer resolved from the agent config")

    assert not any(f.name == "supervision_enabled"
                   for f in dataclasses.fields(ModuleContext)), (
        "the switch is threaded into the analysis context again — welcome the "
        "day something reads it, and `registry.gate` still does not")

    readers = re.findall(r'(?<![\w.])(?:context|ctx)\.supervision_enabled\b',
                         _readers())
    assert not readers, (
        "`context.supervision_enabled` has %d reader(s) — if that is "
        "deliberate, put the field back and delete this test" % len(readers))

    # ⚠️ THE CONVERSE, or the assertion above passes on a typo in the pattern.
    assert re.search(r'(?<![\w.])(?:context|ctx)\.audience\b', _readers()), (
        "the reader scan finds nothing at all — it would report an unwired "
        "switch whatever the code said")
