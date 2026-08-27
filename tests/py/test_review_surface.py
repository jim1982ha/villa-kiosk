"""The playbook review queue must be OPENABLE by whoever the server lets decide.

⚠️ THE BACKEND SHIPPED WITHOUT THE SURFACE AND EVERY TEST WAS GREEN. v2.650.0
delivered `agent/review.py`, both routes, an nginx location and 16 tests, and
nothing could reach the queue: a draft could not be approved, and — worse — it
could not be REFUSED either, so `MAX_PENDING` would eventually stop the agent
proposing at all. A gate nobody can open is a gate that jams shut, and the
suite that proved the gate worked could not see that nobody could reach it.

That is the same shape `test_modal_shell`'s reachability test was written for
(the Tasks tab behind a door its own user could not open): neither half is
wrong on its own, and nobody owns the question "can the role the server permits
actually GET here". This file owns it for this feature.

⚠️ EVERY SIDE IS DERIVED, NEVER RESTATED. The roles come from the proxy, the
capability from the component, the capability's holders from `permissions.ts`.
A change to any one of them is covered on the day it lands, which is the
difference between a pin and `grep -l` wearing a test's clothes.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")
PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")
PERMISSIONS = os.path.join(SRC, "auth", "permissions.ts")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _code(path: str) -> str:
    """Source with comments stripped.

    ⚠️ FIVE TESTS IN THIS REPO HAVE NOW MATCHED THE PROSE EXPLAINING THE THING
    THEY CHECK. `AgentReview`'s header quotes the capability it gates on and
    names the test that forbids it in the shells; a bare substring search reads
    that sentence as the code.
    """
    text = _read(path)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE)


def _buttons(code: str) -> list:
    """Every `<button …>…</button>`, walked BACKWARDS from each close tag.

    ⚠️ `[^>]` CANNOT FIND A TAG'S END IN JSX AND THIS PIN PAID FOR IT ONCE
    ALREADY, one file over. `onClick={() => …}` puts a `>` inside the
    ATTRIBUTES of almost every button here, and the label sits behind an icon
    element, so a forward regex either truncates at the arrow or refuses to
    cross the `<Check />`. `test_modal_shell` reached the same conclusion and
    the same shape; this is that helper, not a fifth invention.
    """
    out = []
    at = code.find("</button>")
    while at >= 0:
        start = code.rfind("<button", 0, at)
        if start >= 0:
            out.append(code[start:at])
        at = code.find("</button>", at + 1)
    return out


def _surfaces() -> dict:
    """Every component that calls the review-queue client, from the tree."""
    found = {}
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith(".tsx"):
                continue
            path = os.path.join(base, name)
            code = _code(path)
            if "loadReviewDrafts" in code:
                found[os.path.relpath(path, REPO_ROOT)] = code
    return found


def test_the_queue_HAS_a_surface() -> None:
    """⚠️ THE ONE THAT WOULD HAVE CAUGHT v2.650.0. The backend, the routes and
    16 tests were all green with nothing on any screen able to reach them."""
    found = _surfaces()
    assert found, (
        "nothing in the SPA reads the review queue. The backend can propose "
        "playbooks that no person can approve OR discard, and the queue fills "
        "to MAX_PENDING and stops.")


def test_the_surface_can_BOTH_approve_and_discard() -> None:
    """⚠️ APPROVE ALONE IS NOT A REVIEW. A queue that can only accept is a queue
    that fills with the drafts nobody wanted, and `review.discard` records a
    refusal precisely so the same draft is not re-proposed next quarter."""
    found = _surfaces()
    assert found, "no surface — every loop below would compare empty sets"
    for path, code in found.items():
        assert '"approve"' in code and '"discard"' in code, (
            f"{path} reaches the queue but cannot express both decisions")


def test_APPROVAL_requires_the_draft_to_have_been_OPENED() -> None:
    """⚠️ TASK-094's ARCHITECTURAL CONSTRAINT, AS THE UI CAN BREAK IT. "NOTHING
    enters the live playbook set without human approval" — and approving text
    nobody has read is approval in name only, which is the failure the
    constraint is written against. An approved playbook is consulted on every
    later investigation of its class, so this is the one button in the app whose
    consequence compounds.

    Discard is deliberately NOT gated the same way: a refusal is recorded rather
    than deleted, and refusing something unread costs a re-proposal at worst.
    """
    found = _surfaces()
    assert found, "no surface — every loop below would compare empty sets"
    for path, code in found.items():
        approve = [b for b in _buttons(code) if "Approve" in b]
        assert approve, f"{path} has no Approve button to check"
        for button in approve:
            assert re.search(r"disabled=\{[^}]*read\.has", button), (
                f"{path} can approve a draft nobody has opened — the whole "
                f"reason this queue exists is that a person reads it first")
        # ⚠️ AND DISCARD MUST NOT INHERIT THE GATE. Refusing an unread draft is
        # cheap and recorded; gating it would leave a queue that can only fill.
        discard = [b for b in _buttons(code) if "Discard" in b]
        assert discard, f"{path} has no Discard button"
        for button in discard:
            assert "read.has" not in button, (
                f"{path} gates Discard on having read the draft, so a queue at "
                f"MAX_PENDING can only be emptied by approving")
            # ⚠️ EACH BUTTON SENDS ITS OWN DECISION, and mutation testing is why
            # this line exists: pointing Discard's handler at "approve" left
            # every other assertion here green. A label is not a decision.
            assert '"discard"' in button, (
                f"{path}'s Discard button does not send the discard decision — "
                f"the label and the action have come apart")
        for button in approve:
            assert '"approve"' in button, (
                f"{path}'s Approve button does not send the approve decision")


def test_the_surface_is_actually_RENDERED_somewhere() -> None:
    """⚠️ A COMPONENT THAT EXISTS IS NOT A SURFACE THAT IS REACHABLE, and this
    is the v2.650.0 defect one step later: deleting `<AgentReview />` from the
    tab leaves the file, its client and every other assertion in this module
    intact, with nothing on any screen again. Mutation testing found it — the
    first version of this file collected the component by its own import and
    then asked the component about itself.
    """
    found = _surfaces()
    assert found, "no surface to look for"
    for path in found:
        name = os.path.basename(path)[:-4]
        hosts = []
        for base, _dirs, files in os.walk(SRC):
            for other in files:
                if not other.endswith(".tsx") or other == os.path.basename(path):
                    continue
                if f"<{name}" in _code(os.path.join(base, other)):
                    hosts.append(other)
        assert hosts, (
            f"{path} is never rendered by anything — the review queue has no "
            f"surface again, and only this assertion can tell")


def test_the_ROLES_the_server_permits_can_REACH_the_surface() -> None:
    """⚠️ NEITHER HALF IS WRONG ON ITS OWN, which is why nothing else catches
    this. The proxy permits `TASK_ACK_ROLES`; the surface renders its buttons on
    a CAPABILITY. If the capability is held by a different set, the feature is
    either invisible to somebody the server would accept or offered to somebody
    it will 403.
    """
    proxy = _read(PROXY)
    # ⚠️ RESOLVED BY IMPORT, NOT BY REGEX (2026-08-28). `TASK_ACK_ROLES` is now
    # an ALIAS of `actions.MAY_ACT` — one tuple for the tablet, the phone's
    # buttons and every handler — and a pattern matching `= (…)` read that as
    # "not found" and said so, which is this file's own vacuous-pass guard doing
    # its job. Importing follows the alias wherever it points and cannot go
    # blind the next time the declaration moves.
    from agent import actions as actions_mod
    assert "TASK_ACK_ROLES" in proxy, (
        "TASK_ACK_ROLES not found; this test is checking nothing")
    permitted = set(actions_mod.MAY_ACT)
    assert permitted, "the permitted-roles tuple is empty"

    # ⚠️ THE HANDLERS MUST ACTUALLY USE IT. A route that checked a different
    # list would make everything below a comparison against the wrong constant.
    handlers = proxy[proxy.index("async def agent_review_get_handler"):]
    handlers = handlers[:handlers.index("async def agent_chats_handler")]
    assert handlers.count("TASK_ACK_ROLES") == 2, (
        "the review routes no longer gate on TASK_ACK_ROLES")

    capabilities = set()
    for code in _surfaces().values():
        capabilities.update(re.findall(r'hasCapability\(role,\s*"(\w+)"\)', code))
    assert capabilities, "the surface reads no capability at all"

    permissions = _read(PERMISSIONS)
    for capability in capabilities:
        holders = set()
        for role in ("guest", "owner", "ops"):
            block = permissions[permissions.index(f"{role}: {{"):]
            block = block[:block.index("},")]
            if f'"{capability}"' in block:
                holders.add(role)
        assert holders == permitted, (
            f"the review surface gates on `{capability}`, held by "
            f"{sorted(holders)}, while the server permits {sorted(permitted)}. "
            f"One of those two lists is offering or hiding the wrong people.")


def test_the_surface_reads_its_capability_IN_THE_LEAF() -> None:
    """⚠️ THE COCKPIT VIEW IS REACHABLE BY EVERY PROFILE and must stay so —
    `test_cockpit_is_gated_nowhere` forbids `manageFacility` in either shell,
    because `CockpitModal` exists precisely so a profile without it can see the
    villa's status. A control that needs the capability therefore carries its
    own check, exactly as `AgentConcerns` does; hoisting it into the shell
    would turn a control's gate into a gate on the view."""
    found = _surfaces()
    assert found, "no surface — every loop below would compare empty sets"
    for path, code in found.items():
        assert "hasCapability" in code, f"{path} reads no capability"
    shells = [os.path.join(SRC, "components", "cockpit", "CockpitModal.tsx"),
              os.path.join(SRC, "components", "cockpit", "CockpitTab.tsx")]
    for shell in shells:
        assert "manageFacility" not in _code(shell), (
            f"{os.path.relpath(shell, REPO_ROOT)} now names manageFacility — "
            f"the Cockpit view must stay open to every profile")
