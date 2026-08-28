"""No internal reference may reach a person. REQ-038, and the owner's rule.

⚠️ ASKED FOR TWICE, AND THE SECOND TIME WAS ABOUT A SCREEN (2026-08-28): *"i see
internal reference in the UI again (like `c7`): which should never be the case
right? Can you check and confirm you have definitely fixed the root cause?"*.
The honest answer at the time was that there had been no earlier fix to hold —
`feedback_speak-in-ui-terms` is about the words I write in a session, and nothing
had ever checked the app itself. So this is the fix, rather than a promise.

⚠️ `c7` IS NOT A BUG IN A FORMATTER. It is a CORRECT id that two surfaces chose
to print, each for a reason that had expired:

  * `TasksTab` rendered `ruleId` beside every row as CORROBORATION — its comment
    read "an agent-derived row could not have one", which was true until
    2.763.0 taught `agent/task.py` to write `[cN]` into a to-do summary. The tab
    is deleted; its producer (the `maintenance_*`/`roi_*`/`audit_*` blueprints)
    had been retired before it was.
  * `digest._line` appended `[c7]` to each line of a message sent to a phone,
    on the reasoning that the reference "ties a line to the alert behind it".
    True of the software and worth nothing to the reader, who cannot type `c7`
    anywhere.

Both were deliberate. Neither was a mistake anybody would catch in review,
because each carried a written justification — which is exactly why a test is
the only thing that would have caught the day the justification stopped holding.

⚠️ WHAT IS DELIBERATELY NOT FORBIDDEN: the bracket in the STORED to-do summary.
`ledger.TASK_PREFIX` is the join every reader uses, so it must be in the item's
text, and it is therefore visible in Home Assistant's own to-do panel — a
surface this add-on does not render and cannot strip. That is the one place the
id is unavoidable, and it is the reason the SPA strips it on the way in rather
than the backend never writing it.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Dict, List

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "rootfs", "usr", "bin"))

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "src")

#: The shapes an internal reference takes on its way to a screen. ⚠️ NAMED BY
#: WHAT THEY ARE, not by a regex over the rendered text: `c7` as a literal is
#: unsearchable (it matches prose, hex, class names), so what is banned is the
#: FIELD reaching a render position.
ID_FIELDS = ("ruleId", "rule_id", "subjectKey", "subject_key", "concernId")


def _tsx() -> Dict[str, str]:
    """Every component file, derived — a listed set would miss the next one."""
    out: Dict[str, str] = {}
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".tsx", ".ts")):
                path = os.path.join(root, name)
                with open(path, encoding="utf-8") as handle:
                    out[os.path.relpath(path, REPO)] = handle.read()
    return out


def _strip_comments(code: str) -> str:
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    return "\n".join(l for l in code.splitlines()
                     if not l.strip().startswith("//"))


def test_no_component_RENDERS_an_internal_reference() -> None:
    """⚠️ THE RENDER POSITION, NOT THE FIELD. Carrying `rule_id` in a type or
    joining on it is correct and necessary — `AgentTodo` matches on it to find
    the alert behind a row. What is banned is `{task.ruleId}` reaching JSX,
    which is precisely what put `c7` on the owner's screen."""
    offenders: List[str] = []
    for path, code in _tsx().items():
        if not path.endswith(".tsx"):
            continue
        body = _strip_comments(code)
        for field in ID_FIELDS:
            # `{x.ruleId}` or `{x.ruleId && …}` in a JSX position
            for m in re.finditer(rf"\{{[^{{}}\n]*\b{field}\b[^{{}}\n]*\}}", body):
                text = m.group(0)
                # ⚠️ A HANDLER IS NOT A RENDER, and the first cut of this said
                # it was: `onClick={() => submit(m.subjectKey)}` passes the id
                # to a function, which is the CORRECT use — joining on it. Two
                # false positives on the first run, both in AgentMemories.
                if "=>" in text or ";" in text:
                    continue
                # a prop or a key is not a render: `key={t.ruleId}`, `id={…}`
                before = body[max(0, m.start() - 40):m.start()]
                if re.search(r"(key|id|htmlFor|aria-\w+|data-\w+)=$", before):
                    continue
                offenders.append(f"{path}: {text.strip()}")
    assert not offenders, (
        "an internal reference is rendered to a person:\n  "
        + "\n  ".join(offenders)
        + "\nA person cannot type it anywhere and no screen asks for it. Join "
          "on it if you must; never print it.")


def test_the_SPA_strips_the_bracket_before_showing_a_to_do_row() -> None:
    """⚠️ THE ONE PLACE THE ID LEGITIMATELY ARRIVES. `task.summary_for` writes
    `[c7] Pool pump…` because `ledger.TASK_PREFIX` is the join, so every reader
    of a to-do item receives the bracket and must remove it before drawing."""
    todo = _tsx()["src/components/agent/AgentTodo.tsx"]
    assert re.search(r"replace\(/\^\\s\*\\\[\[\^\\\]\]\*\\\]\\s\*/", todo) or \
        "\\[[^\\]]*\\]" in todo, (
        "the To-Do List draws the stored summary verbatim, so every row shows "
        "its bracket")


def test_a_DELIVERED_message_carries_no_reference() -> None:
    """⚠️ THE DIGEST GOES TO A PHONE, which is a screen this app does not own
    and cannot correct afterwards. Checked on the rendered body, not on the
    source, so a reference reintroduced by any means fails."""
    from agent import digest
    body = digest.compose([{"rule_id": "c7", "text": "Pool pump cycling"},
                           {"rule_id": "c12", "text": "Filter overdue"}])
    assert "Pool pump cycling" in body, "the digest stopped naming the work"
    for ref in ("c7", "c12", "[c7]", "[c12]"):
        assert ref not in body, (
            f"the daily digest puts {ref!r} on somebody's phone; they cannot "
            f"type it anywhere and no screen asks for it")


def test_the_TAB_a_message_points_at_is_one_that_EXISTS() -> None:
    """⚠️ THE COMPANION DEFECT, AND IT SHIPPED THE SAME HOUR. The digest told
    the reader to tick an item on "the To-Do List tab" — merged into Act & Tell
    minutes earlier at the owner's instruction, so the message sent somebody
    looking for a tab that is not there. A name in prose is a claim about the
    UI and nothing checks prose."""
    from agent import digest
    body = digest.compose([{"rule_id": "c1", "text": "x"}])
    named = set(re.findall(r"under ([A-Z][A-Za-z& -]+?) in VESTA", body))
    assert named, "the digest no longer says where to act"

    modal = _tsx()["src/components/agent/AgentModal.tsx"]
    labels = set(re.findall(r'label: "([^"]+)"', modal))
    missing = {n.strip() for n in named} - labels
    assert not missing, (
        f"the digest points at {sorted(missing)}, which is not a tab in the "
        f"agent dialog. Its tabs are {sorted(labels)}.")


def test_the_TUNING_PANEL_can_SEE_why_it_is_empty() -> None:
    """⚠️ A SCREEN THAT GUESSES AT ITS OWN EMPTY STATE WILL GUESS WRONG. The
    tuning list said "Nothing judged yet. Press a thumb on an alert raised
    after this update" — and the owner had just pressed one, on an alert raised
    that same day. The real cause was that a pipeline drill's subject is a
    TOPIC, so it carries no measurement, and no thumb on one will ever teach
    anything however new it is. The panel could not tell the two apart because
    `flag_type` was never mirrored into the SPA's `Concern`.

    ⚠️ THE FIELD IS THE FIX, NOT THE SENTENCE. Rewording alone would have left
    the screen unable to distinguish them, so the next reword would guess too.
    """
    types = _tsx()["src/agent/agentTypes.ts"]
    assert re.search(r"^  flag_type\?: string;$", types, re.M), (
        "`flag_type` is not mirrored, so no screen can explain why judging an "
        "alert taught the villa nothing")
    panel = _tsx()["src/components/settings/FlagTypesPanel.tsx"]
    assert "flag_type" in panel, (
        "the tuning panel no longer reads the kind, so its empty state is "
        "guessing at its own cause again")
    assert "after this update" not in panel, (
        "the empty state names 'raised before this feature' as the only reason "
        "a verdict teaches nothing; a topic-level alert is the other one")


def test_the_RETIRED_tab_is_gone_rather_than_emptied() -> None:
    """⚠️ ITS PRODUCER WAS RETIRED BEFORE IT WAS, AND IT DID NOT GO BLANK —
    which is why nobody noticed. "What it asked for" listed to-do items the
    villa's BLUEPRINTS raised; the cutover retired every blueprint that called
    `todo.add_item`, and the tab then quietly started listing the AGENT's rows
    under a "Safety reflex" chip. A tab whose source is gone must go with it.
    """
    assert not os.path.exists(
        os.path.join(SRC, "components", "reports", "TasksTab.tsx")), \
        "the retired tab's component is back"
    reports = _tsx()["src/components/reports/ReportsModal.tsx"]
    assert "What it asked for" not in _strip_comments(reports), \
        "the retired tab is registered again"

    # ⚠️ AND NO SHIPPED BLUEPRINT MAY QUIETLY BECOME A PRODUCER AGAIN. If one
    # does, this tab's premise returns and the decision to delete it needs
    # revisiting — deliberately noisy rather than silent.
    blueprints = os.path.join(REPO, "sources", "files", "blueprint")
    if os.path.isdir(blueprints):
        # ⚠️ `._*` EXCLUDED: the blueprint tree comes off a Mac and carries
        # AppleDouble resource forks, which are binary and named `._x.yaml`.
        # Reading one as UTF-8 raised, so the pin failed for a reason that had
        # nothing to do with what it measures.
        writers = []
        for name in os.listdir(blueprints):
            if not name.endswith(".yaml") or name.startswith("._"):
                continue
            with open(os.path.join(blueprints, name), encoding="utf-8",
                      errors="replace") as handle:
                if "todo.add_item" in handle.read():
                    writers.append(name)
        assert not writers, (
            f"{writers} raise to-do items again, so 'what the automations "
            f"asked for' is a real category once more")
