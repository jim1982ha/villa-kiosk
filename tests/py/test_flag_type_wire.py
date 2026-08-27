"""The `/agent-flag-types` contract: Python one side, TypeScript the other.

⚠️ FOUND BY /dry-audit PART 5, ONE RELEASE AFTER THE ROUTE SHIPPED. The taught
flag types are served by a BESPOKE handler pair rather than
`_json_store_handlers`, so `test_store_envelope` — which derives its set from
that factory's call sites — could not see it. A new store, a new set of string
literals in two languages, and nothing holding them together.

⚠️ AND THE FAILURE IS THE SILENT ONE THIS FAMILY OF TESTS EXISTS FOR. The
client reads `Number(x.factor ?? 1) || 1`, so renaming `factor` on the Python
side does not error — every row renders at **1.0**, which is exactly what an
untouched kind looks like. An owner would see their tuning quietly reset and
have no way to tell it from a screen that had never been tuned. That is the
same shape as the 2.545.0 envelope-key defect, where two GET paths had been
wrong since they shipped because a config store parsing to nothing renders
identically to one nobody has configured.

⚠️ THE OTHER DIRECTION IS DELIBERATELY NOT PINNED, because it is already loud:
an unknown `action` returns a 400 whose reason the panel displays. Pinning a
failure that already announces itself would be padding; this file covers the
half that goes quiet.
"""

from __future__ import annotations

import os
import re
from typing import Set

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FLAGTYPES = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                         "flagtypes.py")
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
CLIENT = os.path.join(REPO_ROOT, "src", "agent", "agentApi.ts")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _no_comments(source: str) -> str:
    """⚠️ COMMENT BLOCKS AS BLOCKS. A filter keyed on the first character passes
    the OPENING line of a `/* */` and then flags every continuation, because
    those start with an ordinary word — four pins in this repo have matched the
    prose recording their own fix."""
    source = re.sub(r"/\*[\s\S]*?\*/", "", source)
    return "\n".join(line for line in source.split("\n")
                     if not line.lstrip().startswith(("//", "#")))


def written_keys() -> Set[str]:
    """The row fields Python STORES, derived from `flagtypes.replace`.

    ⚠️ FROM THE IMPORT PATH, WHICH IS THE ONE THAT BUILDS A COMPLETE ROW.
    `record` writes incrementally and would under-report; `replace` constructs
    every field from scratch, which is why its dict is the contract.
    """
    body = _no_comments(_read(FLAGTYPES)).split("clean[key] = {")[1]
    body = body.split("}")[0]
    return set(re.findall(r'"(\w+)":', body))


def read_keys() -> Set[str]:
    """The row fields the browser READS out of the response."""
    source = _no_comments(_read(CLIENT))
    block = source.split("export async function loadFlagTypes")[1]
    block = block.split("export ")[0]
    return set(re.findall(r"\bx\.(\w+)", block))


def test_the_walk_finds_both_sides() -> None:
    """⚠️ THE VACUOUS-PASS GUARD. If either anchor moves, the two comparisons
    below run over empty sets and report health forever — this project has had
    four counters read 0 for the exact case they existed to measure."""
    assert len(written_keys()) >= 4, f"parsed too few Python keys: {written_keys()}"
    assert len(read_keys()) >= 4, f"parsed too few client keys: {read_keys()}"


def test_every_field_the_BROWSER_READS_is_one_PYTHON_WRITES() -> None:
    """⚠️ THE SILENT DIRECTION. A field the client reads and the server never
    writes arrives as `undefined`, and every reader here defaults it — so the
    row renders as an untouched kind rather than as an error."""
    # `key` is added by `listing()` rather than stored on the row, so it is a
    # legitimate member of the response and not of the stored document.
    missing = read_keys() - written_keys() - {"key"}
    assert not missing, (
        f"the browser reads {sorted(missing)} and Python writes "
        f"{sorted(written_keys())}. Each of these silently becomes its default "
        f"— a tuned kind renders as 1.0, indistinguishable from one nobody has "
        f"touched.")


def test_the_LISTING_really_does_add_the_key_field() -> None:
    """The one exemption above, checked rather than assumed — or `key` could be
    dropped from `listing()` and this file would still pass."""
    body = _no_comments(_read(FLAGTYPES))
    assert '{"key": k, **v}' in body, (
        "`listing` no longer adds `key`, so every row the panel renders has no "
        "identity to send back when you press + or the bin")


def test_the_ACTIONS_the_client_sends_are_all_HANDLED() -> None:
    """⚠️ DERIVED FROM BOTH SIDES, NOT LISTED HERE. A sixth verb added to the
    client's union and not to the handler would 400 at the moment somebody
    pressed it — loud, but only for whoever presses it first."""
    # ⚠️ SCOPED TO THE ONE FUNCTION, and the first cut was not — it swept the
    # whole client and picked up `approve` from `decideEscalation`, an
    # unrelated endpoint that also has an `action`. A pin that reads more than
    # its subject reports a defect in code it was never about.
    handled = set(re.findall(r'action == "(\w+)"', _no_comments(_read(PROXY))))
    block = _no_comments(_read(CLIENT)).split(
        "export async function tuneFlagTypes")[1].split("\nexport ")[0]
    sent = set(re.findall(r'action: "(\w+)"', block))
    assert len(handled) >= 4 and len(sent) >= 4, (
        f"parsed too few actions — handled {handled}, sent {sent}")
    assert sent <= handled, (
        f"the client sends {sorted(sent - handled)}, which no handler answers")


def test_the_bounds_the_dial_uses_come_from_PYTHON() -> None:
    """⚠️ THE STEP AND THE LIMITS ARE THE STORE'S RULE. A literal in the panel
    would be a second copy of the arithmetic, and 0.1 is precisely the value
    that does not survive binary floating point — the two would drift and the
    screen would stop matching what a press produced."""
    served = _no_comments(_read(PROXY))
    assert "agent_flagtypes.MIN_FACTOR" in served
    assert "agent_flagtypes.MAX_FACTOR" in served
    assert "agent_flagtypes.STEP" in served
