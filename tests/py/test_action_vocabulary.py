"""The act names cross a language boundary on a bare string. TASK-062.

⚠️ PART 5's SHAPE, EXACTLY: a rule whose two halves are in different files, in
different languages, joined by nothing a compiler can see. `AgentTodo.tsx` sends
`actOnAlert(id, "done")`; `agent/actions.py` answers only if some `Act` carries
that same id. Rename either side and the other keeps compiling, the tests keep
passing, and the button 400s the first time somebody presses it — in the field,
on a phone, on the one surface where a failure is least visible.

⚠️ AND IT IS THE SAME FAMILY AS THE STORE-ENVELOPE BUG. There, `data` against
`config` was a string literal in TypeScript and a string literal in Python; the
PUT 400'd and BOTH reads had been silently wrong since they shipped, because a
config store that parses to nothing renders exactly like one nobody configured.
The pin that caught it derives the keys from the proxy rather than listing them,
and this derives the acts from the module rather than listing them, for the same
reason: a pin you have to EDIT to cover a seventh act is already broken.

⚠️ THE PHONE'S HALF NEEDS NO PIN HERE and that is not an omission. A button's
callback data is BUILT from `Act.code` by `buttons.encode` and READ back by
`buttons.decode` through `act_by_code`, so both ends are the same Python table
and `test_buttons.py` round-trips every act through it. Only the browser states
an act name as a literal, so the browser is the only half that can drift.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Set

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

from vesta.supervise.agent import actions

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "src")


def _spa_sources() -> dict:
    """Every TS/TSX file, by path. Derived, so a new caller is covered."""
    out = {}
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".ts", ".tsx")):
                path = os.path.join(root, name)
                with open(path, encoding="utf-8") as handle:
                    out[os.path.relpath(path, REPO)] = handle.read()
    return out


def _acts_the_spa_sends() -> Set[str]:
    """Act names passed to `actOnAlert`, from wherever they are written.

    ⚠️ MATCHED ON THE CALL, NOT ON A FILE. The To-Do List is the only caller
    today; the Reason tab is the obvious next one, and it must be covered on the
    day it is written rather than when somebody remembers this file.
    """
    found: Set[str] = set()
    for code in _spa_sources().values():
        # `actOnAlert(id, "done")` and `actOnAlert(String(c.id), "seen", note)`
        for match in re.finditer(r'actOnAlert\([^,)]+,\s*"([a-z_]+)"', code):
            found.add(match.group(1))
    return found


def test_every_act_the_TABLET_sends_is_one_the_SERVER_knows() -> None:
    """⚠️ THE ASSERTION THAT WOULD CATCH A RENAME. Nothing else can: TypeScript
    sees a string, Python sees a dict lookup, and the failure surfaces as a
    refused button rather than as a build error."""
    known = {a.id for a in actions.ACTS}
    sent = _acts_the_spa_sends()
    assert sent, (
        "no `actOnAlert` call was found anywhere in src/ — either the tablet "
        "stopped performing acts, or this test's pattern has gone blind and is "
        "now comparing two empty sets")
    unknown = sent - known
    assert not unknown, (
        f"the tablet sends act(s) the server does not define: {sorted(unknown)}. "
        f"`agent/actions.py` knows {sorted(known)}. A press would be refused "
        f"with 'there is no ... action' — visible only when somebody tries it.")


def test_the_ENDPOINT_the_tablet_posts_to_is_the_one_the_server_routes() -> None:
    """⚠️ THE OTHER HALF OF THE SAME CONTRACT, and the failure is worse: nginx's
    final `location /` serves the SPA, so a route with no location block answers
    200 with `index.html` and surfaces as a JSON parse error blaming the client.
    `test_nginx_routes` covers the nginx side; this covers the client's spelling
    of the path, which nothing else reads."""
    paths: Set[str] = set()
    for code in _spa_sources().values():
        for match in re.finditer(r'postJson\("([a-z-]+)"', code):
            paths.add(match.group(1))
    assert "agent-action" in paths, (
        "the tablet no longer posts to `agent-action`; if the endpoint was "
        "renamed, the proxy route and the nginx location must move with it")

    with open(os.path.join(REPO, "rootfs", "usr", "bin", "vesta",
                           "supervise", "api.py"), encoding="utf-8") as handle:
        proxy = handle.read()
    assert 'web.post("/agent-action"' in proxy, (
        "the tablet posts to /agent-action and the proxy does not route it — "
        "nginx's catch-all would answer 200 with index.html")


def test_an_act_NAME_and_its_WIRE_CODE_are_separate_on_purpose() -> None:
    """⚠️ SO THAT RENAMING A BUTTON CANNOT BREAK A PRESS ALREADY IN FLIGHT. A
    message sitting in somebody's chat carries `vd:c7`; if the code were derived
    from the id, renaming `done` would silently retire every button already
    sent. The label is free to change, the id is the HTTP contract, and the code
    is the chat contract."""
    for act in actions.ACTS:
        assert len(act.code) == 1, f"{act.id}'s wire code is not one character"
        assert act.label, f"{act.id} has no label for a person to read"
        # ⚠️ EVERY LABEL CARRIES WORDS, NOT ONLY A GLYPH (2026-08-28). Two of
        # them were bare thumbs, and a picture with no word beside it is read
        # from its NEIGHBOURS: sitting between "Done" and "Add to the To-Do
        # List", they were taken for a third thing that files something.
        assert any(ch.isalpha() for ch in act.label), (
            f"{act.id} is drawn as a bare glyph, so what it does can only be "
            f"guessed from the buttons either side of it")
    # ⚠️ THE GUARD THAT KEEPS THIS FROM PASSING VACUOUSLY on an empty table.
    assert len(actions.ACTS) >= 5


def test_the_ONE_IRREVERSIBLE_ACT_NAMES_ITSELF() -> None:
    """⚠️ THE OWNER'S REQUIREMENT, IN THE ONE PLACE IT IS CHECKABLE: "use another
    icon that will explicitly mention that this icon is about dismissing the
    alert completely" (2026-08-28). Dismissal used to ride the thumb down, so
    the control that throws an alert away — out of the Reason tab, out of the
    briefing, its job ticked off, its subject quieted in future — was the one
    control that never said so.

    Every other act leaves the villa's problem standing and is undoable by
    acting again; this one is not, so it is the one that has to be unmistakable.
    """
    dismiss = actions.act_by_id("dismiss")
    assert dismiss is not None, (
        "dismissal has no act of its own again, so it is riding another "
        "button's meaning")
    # ⚠️ IT SAYS THAT THE ALERT ENDS, IN A WORD A PERSON WOULD USE. The label
    # has already moved once — "Dismiss completely" while `Seen` sat beside it,
    # "Nothing more is needed — close this" now that it has absorbed it — so
    # this asks for the MEANING rather than a phrase.
    ends = ("close", "nothing more", "dismiss", "done with")
    assert any(w in dismiss.label.lower() for w in ends), (
        f"{dismiss.label!r} does not say the alert ENDS, so the one "
        f"irreversible act reads like the reversible ones")
    # ⚠️ NO OTHER ACT MAY READ AS FINAL, or two buttons look like the end and
    # the irreversible one stops standing out. `done` is exempt: it ends the
    # WORK, a different claim, which is why it has its own button.
    others = [a.id for a in actions.ACTS
              if a.id not in ("dismiss", "done")
              and any(w in a.label.lower() for w in ends)]
    assert not others, f"{others} also read as final, so neither stands out"


def test_the_TABLET_OFFERS_THE_ACTS_IN_THE_SAME_ORDER_AS_THE_PHONE() -> None:
    """⚠️ `ACTS` STATES THE RULE AND ONLY ONE SURFACE WAS FOLLOWING IT. Its own
    comment: "a rating is a comment on the supervisor, not on the villa, so it
    must never be the first thing offered" — Telegram's keyboard builds from the
    table and obeys it; the Reason tab hand-wrote its buttons and put `+1` first
    with the act last. Two surfaces teaching opposite habits for one alert, and
    nothing could see it: the order lives in a Python tuple on one side and in
    JSX source order on the other (2026-08-28, found by /phone-parity).

    ⚠️ DERIVED FROM THE TABLE, NOT TRANSCRIBED. The rule is "every rating comes
    after every act", so a sixth act added anywhere sensible keeps passing and a
    rating promoted to the front fails on both sides at once.
    """
    ids = [a.id for a in actions.ACTS]
    rating = {"useful", "not_useful"}
    first_rating = min(ids.index(i) for i in rating)
    last_act = max(i for i, name in enumerate(ids) if name not in rating)
    assert first_rating > last_act, (
        f"the acts table now offers a rating before an act: {ids}. The phone's "
        f"keyboard builds from this order, so the rule has to hold here first.")

    with open(os.path.join(REPO, "src", "vesta", "supervise", "components",
                           "AgentConcerns.tsx"), encoding="utf-8") as handle:
        wall = handle.read()
    act_at = wall.find('act(c.id, "dismiss")')
    rating_at = wall.find("judge(c.id, true)")
    # ⚠️ THE GUARD THAT KEEPS THIS FROM PASSING VACUOUSLY. Two `-1`s compare
    # perfectly happily, and this file has had four counters read 0 for exactly
    # the case they existed to measure.
    assert act_at > 0 and rating_at > 0, (
        "neither the act nor the rating was found in AgentConcerns.tsx — this "
        "test's anchors have moved and it is comparing two absences")
    assert act_at < rating_at, (
        "the Reason tab offers the rating before the act, which is the order "
        "`ACTS` forbids and the phone does not use")
