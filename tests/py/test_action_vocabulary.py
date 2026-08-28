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
    # ⚠️ THE LABELS ARE EMOJI, AND THIS PIN SAID THE OPPOSITE FOR HALF A DAY
    # (2026-08-28, both by the owner, both from screenshots). Words went ON
    # against two bare THUMBS — a glyph that says nothing is read from its
    # neighbours — and came OFF once the glyphs said what they are (✅ 🆘 🚫
    # ⬆️ ⬇️) and the row was ruled a single line, where five worded buttons
    # are five slivers. What the pin now holds is the RULE under both rulings:
    # a single-glyph label must be one everyone recognises, so every act the
    # keyboard draws is either WORDS or a NON-ASCII glyph — a bare ASCII "+1"
    # is neither, and was the confusing middle state.
    for act in actions.ACTS:
        wordy = any(ch.isalpha() for ch in act.label)
        glyphy = any(ord(ch) > 0x2000 for ch in act.label)
        assert wordy or glyphy, (
            f"{act.id}'s label {act.label!r} is neither words nor a real "
            f"glyph, so it explains nothing on any surface")
    # ⚠️ `job` KEEPS ITS WORDS — it appears ALONE on an alert-only notice,
    # with no neighbouring set to teach a reader what a glyph means there.
    job = actions.act_by_id("job")
    assert job is not None and any(ch.isalpha() for ch in job.label), (
        "the To-Do act lost its words; on an FYI it is the only button, and "
        "an unexplained glyph standing alone is the thumbs bug again")
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
    # ⚠️ THE LABEL IS `🚫` BY THE OWNER'S RULING (2026-08-28), which replaces
    # this pin's earlier demand for a WORD like "close". What survives the
    # ruling is the distinctiveness half: the ending glyph must appear on
    # exactly ONE act, or the irreversible button stops standing out — the
    # property both versions of this pin existed to hold.
    # ⚠️ ✅, NOT 🚫, AND THE CHANGE WITHIN THE HOUR WAS THE OWNER'S THIRD MERGE
    # (2026-08-28): once `Done` folded into the closer, the survivor means
    # "handled" at least as often as "not needed", and a red prohibition sign
    # on the button most presses reach for reads as a warning. ✅ was already
    # the owner's chosen glyph for Done; the meaning moved onto it.
    assert dismiss.label == "\u2705", (
        f"the closer is {dismiss.label!r}; the owner's rulings put ✅ on it, "
        f"and a drive-by rename would desync the phone from what the outcome "
        f"notes and the tablet's title describe")
    others = [a.id for a in actions.ACTS
              if a.id != "dismiss" and "\u2705" in a.label]
    assert not others, f"{others} also carry ✅, so the closer stops standing out"


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


def test_the_TABLET_DRAWS_THE_PHONE_S_GLYPHS() -> None:
    """⚠️ ONE VOCABULARY, TWO RENDERERS (owner, 2026-08-28: "edit everything
    that needs to be updated to be consistent with this, also in the VESTA
    Addon UI"). The backend owns the labels because it builds the phone's
    keyboard from them; the tablet mirrors them in `ACT_GLYPH`. A symbol that
    means one thing on the phone and another on the tablet is this subsystem's
    signature bug, and it happened WITHIN this change: the closer was 🚫 on the
    card and ✅ on the keyboard for an hour, because the merge moved one and
    not the other.

    ⚠️ ONLY THE ACTS THE TABLET DRAWS. `help` and `job` are phone-only, so the
    mirror is deliberately partial — and the direction that matters is checked
    both ways: every mirrored id must exist in `ACTS` with the same label, and
    every act the tablet RENDERS must be mirrored.
    """
    with open(os.path.join(REPO, "src", "vesta", "shared",
                           "agentTypes.ts"), encoding="utf-8") as handle:
        mirror_src = handle.read()
    block = mirror_src.split("export const ACT_GLYPH")[1].split("};")[0]
    mirrored = dict(re.findall(r'(\w+):\s*"([^"]+)"', block))
    # ⚠️ THE GUARD. TS escapes are written `\uXXXX`, so a parse that silently
    # yields nothing would compare two empty sets and report health for ever.
    assert len(mirrored) >= 3, (
        f"ACT_GLYPH parsed to {mirrored} — this test's reader has gone blind "
        f"and is about to pass vacuously")

    known = {a.id: a.label for a in actions.ACTS}
    for act_id, raw in mirrored.items():
        glyph = raw.encode("ascii", "backslashreplace").decode("unicode_escape") \
            if "\\u" in raw else raw
        assert act_id in known, (
            f"the tablet mirrors an act {act_id!r} the server does not define")
        assert glyph == known[act_id], (
            f"{act_id} is {known[act_id]!r} on the phone and {glyph!r} on the "
            f"tablet — one symbol, two meanings, depending on the screen")

    # ⚠️ AND THE OTHER DIRECTION: an act the CARD renders must be mirrored, or
    # somebody hard-codes a glyph beside the ones that are checked.
    with open(os.path.join(REPO, "src", "vesta", "supervise", "components",
                           "AgentConcerns.tsx"), encoding="utf-8") as handle:
        card = handle.read()
    drawn = set(re.findall(r"ACT_GLYPH\.(\w+)", card))
    assert drawn, "the card draws no mirrored glyph; the anchor has moved"
    assert drawn <= set(mirrored), f"{drawn - set(mirrored)} is drawn but not mirrored"
    assert 'aria-hidden>✅' not in card and 'aria-hidden>🚫' not in card, (
        "a glyph is hard-coded on the card beside the mirrored ones, so it "
        "can drift from the phone without anything noticing")
