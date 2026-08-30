"""Template idioms in the shipped blueprints that fail SILENTLY when wrong.

⚠️ THE WHOLE CLASS OF DEFECT: A JINJA CALL TO A FUNCTION HOME ASSISTANT DOES
NOT HAVE RENDERS EMPTY RATHER THAN RAISING. The automation runs, the trace is
green, the notification is delivered — and the sentence has a hole in it where
the fact should be. Nothing in this repository compiles these files, so the
only thing that can catch it is a scan.

⚠️ FOUND FROM A REAL ALERT (2026-08-27). `critical_watchdog` delivered:

    🚨 Critical Device Unavailable
    has been "unavailable" for over 0.2 minutes.

A critical notification that never names the device it is about, on a villa
where the whole point of the list is that any one of ten entities might be the
one that failed. The cause was `entity_name(trigger.entity_id)`. Verified
against a live template engine: for the same entity, `entity_name(...)`
renders the empty string while `state_attr(..., 'friendly_name')` renders its
name — including while that entity is UNAVAILABLE, which is the only state
this blueprint ever renders in.

⚠️ AND THE GREP FOUND A SECOND FILE THE REPORT DID NOT MENTION.
`critical_schedule.yaml` had the same call at FOUR sites, so all four of its
power alerts were nameless too and nobody had reported it — those fire rarely,
which is exactly why a scan beats a bug report. `control_presence_notify.yaml`
had the CORRECT idiom all along (`entity_name` as a VARIABLE assigned from
`state_attr`), which is what makes the mistake so easy: the same identifier is
right in one file and empty in another. Rolled out by what it APPLIES to
rather than by the one site that was reported — `feedback_audit-applicable-set`.
"""

from __future__ import annotations

import os
import re
from typing import List, Tuple

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BLUEPRINTS = os.path.join(ROOT, "docs", "helpers", "blueprint")

needs_blueprints = pytest.mark.skipif(
    not os.path.isdir(BLUEPRINTS),
    reason="docs/helpers/blueprint is gitignored and absent on a fresh clone")

#: Names that LOOK like Home Assistant template functions and are not. Each
#: renders empty instead of raising, so the automation succeeds and the message
#: is wrong. ⚠️ ADD A NAME HERE THE DAY YOU ARE BITTEN BY IT — the list is the
#: record of which plausible-looking calls have actually cost a delivered alert.
#: `entity_name` is real as a VARIABLE, so the pattern below matches the CALL
#: form (`entity_name(`) only and leaves the assignment form alone.
NOT_TEMPLATE_FUNCTIONS: Tuple[str, ...] = ("entity_name", "entity_friendly_name")


def _yaml_files() -> List[str]:
    """Every shipped blueprint.

    ⚠️ `_archive/` IS EXCLUDED — it holds retired and pre-cutover copies kept
    deliberately as a record, and failing on them would make the only honest
    response deleting the history. Only this directory's own files are read.

    ⚠️ AND `._name.yaml` IS NOT A BLUEPRINT. This tree is edited from a Mac
    (the pipeline runs there) onto a non-Apple filesystem, so macOS writes an
    AppleDouble sidecar beside each file it touches — binary, named after its
    partner, and ending in `.yaml`. Four of them exist here right now and the
    first version of this scan died on `UnicodeDecodeError` rather than
    reporting anything, which is a pin that fails for a reason unrelated to
    its subject: the worst kind, because the fix looks like deleting the test.
    """
    out: List[str] = []
    for name in sorted(os.listdir(BLUEPRINTS)):
        if name.startswith("._"):
            continue
        if name.endswith((".yaml", ".yml")):
            out.append(os.path.join(BLUEPRINTS, name))
    return out


@needs_blueprints
def test_no_blueprint_CALLS_a_function_home_assistant_does_not_have() -> None:
    """⚠️ THE CALL FORM ONLY. `entity_name: "{{ state_attr(...) }}"` is the
    correct idiom and must keep passing; `{{ entity_name(x) }}` is the defect.
    """
    offenders: List[str] = []
    for path in _yaml_files():
        with open(path, "r", encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                if line.lstrip().startswith("#"):
                    continue          # the comment recording this very defect
                for bad in NOT_TEMPLATE_FUNCTIONS:
                    if re.search(rf"\b{bad}\s*\(", line):
                        offenders.append(
                            f"{os.path.basename(path)}:{number}: {bad}(…)")
    assert not offenders, (
        "a blueprint calls a template function Home Assistant does not have. "
        "It renders EMPTY rather than raising, so the automation succeeds and "
        "the message has a hole in it where the device name should be:\n  "
        + "\n  ".join(offenders))


@needs_blueprints
def test_every_notification_that_names_a_device_can_never_be_NAMELESS() -> None:
    """⚠️ THE FALLBACK IS THE POINT, NOT THE LOOKUP. `state_attr` returns None
    for an entity that has been removed from the registry, and `None ~ ' has
    been unavailable'` renders exactly the empty-name sentence this file
    exists to prevent — the same defect through a different door. Every
    `device_name` variable therefore ends in a `default(..., true)` naming the
    entity id, so the worst case is a raw id rather than nothing.

    `true` as the second argument is load-bearing: Jinja's bare `default` only
    substitutes for UNDEFINED, and `state_attr` returns None, which is defined.
    """
    checked = 0
    for path in _yaml_files():
        with open(path, "r", encoding="utf-8") as handle:
            body = handle.read()
        for match in re.finditer(r"^\s*device_name:\s*>-?\s*\n((?:\s+.*\n)+?)(?=\s*\w+:|\s*$)",
                                 body, re.MULTILINE):
            checked += 1
            block = match.group(1)
            assert "default(" in block and ", true)" in block, (
                f"{os.path.basename(path)}: a `device_name` variable has no "
                f"`default(<entity id>, true)` fallback, so a removed entity "
                f"renders a nameless alert:\n{block}")
    # ⚠️ A VACUOUS PASS GUARD. If the variable is ever renamed, this test would
    # silently check nothing and stay green forever — the shape of dead pin
    # `feedback_mutation-testing` names first.
    assert checked >= 2, (
        f"only {checked} `device_name` variables found; this pin has probably "
        f"gone blind to a rename")
