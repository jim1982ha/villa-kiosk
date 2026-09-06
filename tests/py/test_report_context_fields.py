"""Every field on `ReportContext` either reaches a reader, or says why not.

⚠️ AND THE SAME MEASUREMENT FOR `ModuleContext.supervision_enabled`, WHICH IS
THE VILLA'S MASTER SWITCH AND REACHES NOBODY. It is threaded five hops —
`agent-config.json` to `BriefRequest.from_config`, to `run_report`, to
`analyse`, to `ModuleContext` — under a comment naming "the thirteen-times
defect this repository calls `pin-the-caller`". `registry.gate` refuses on
`requires`, `settings["enabled"]`, `failures`, `min_days` and `audiences`, and
has never mentioned it. The proxy's diagnostics banner reads its own local
`supervision_on`, so the defending test's claim that "the banner reads it" is
false as written.

It is NOT deleted here. Removing the field touches 53 tests that construct a
`ModuleContext`, and a wide mechanical edit is where a mistake hides; the
measurement is what makes the thread visible, and pulling it is a change worth
making on its own. `test_the_master_switch_reaches_no_reader` below is that
measurement, and it fails the day somebody wires it — which is the good
outcome, not a false alarm.

⚠️ THREE OF ITS FOURTEEN FIELDS ARE BUILT EVERY BRIEF AND READ BY NOTHING, and
one of them carries a product claim in its own doc-comment: `ran` says
"Without this, 'no checks are configured' and 'every check ran and found
nothing' are the same empty result — and they mean opposite things to the
person reading the report." That is true, and it is true of `pipeline`'s LOCAL
`ran`; the FIELD reaches no reader at all.

⚠️ THIS DOES NOT DELETE THEM, DELIBERATELY. Whether "which checks ran" should
cross into the narration payload is a product decision, and a field removed is
harder to notice than a field listed. What this refuses is the third state —
a field that looks wired, is not, and nobody knows which.

`ReportContext` has exactly one consumer, `narrate/payload.from_context`, which
duck-types its reads through `getattr` on purpose: "Importing the dataclass
would make this module depend on the object it exists to keep out." So the set
of fields that actually cross is not visible from the dataclass, and this is
where it is written down.
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


def test_the_master_switch_reaches_no_reader() -> None:
    """⚠️ MEASURED, NOT ASSUMED, AND IN BOTH DIRECTIONS. If `supervision_enabled`
    ever gains a reader this fails, and the right response is to delete this
    test — not to widen it. A gap recorded as a gap is the only honest state
    for a switch that is threaded and never consulted."""
    text = _readers()
    readers = re.findall(r'(?<![\w.])(?:context|ctx)\.supervision_enabled\b', text)
    assert not readers, (
        "`supervision_enabled` has %d reader(s) now — the five-hop thread is "
        "live, so this test has served its purpose and should go" % len(readers))

    # ⚠️ THE CONVERSE, or the assertion above passes on a typo in the pattern.
    assert re.search(r'(?<![\w.])(?:context|ctx)\.audience\b', text), (
        "the reader scan finds nothing at all — it would report an unwired "
        "switch whatever the code said")
