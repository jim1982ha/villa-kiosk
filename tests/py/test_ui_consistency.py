"""One pager, one hint, and descriptions that fit on two lines.

⚠️ EVERY RULE HERE WAS A DIVERGENCE FOUND BY LOOKING, NOT BY GREPPING FOR A
NAME. Four mechanisms existed for "this list is too long for a dialog" and
thirteen control descriptions had grown to four, five and six lines — a settings
pane where every control carries a paragraph is one nobody reads, which is how
it was reported.
"""

from __future__ import annotations

import os
import re

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO_ROOT, "src")

#: Two lines at a settings dialog's width. ⚠️ ONE NUMBER, because "keep it
#: short" enforced per reviewer is what produced six-line descriptions.
MAX_NOTE_CHARS = 200


def _files(*rel):
    for r in rel:
        base = os.path.join(SRC, *r.split("/"))
        for root, _d, names in os.walk(base):
            for n in sorted(names):
                if n.endswith(".tsx"):
                    yield os.path.join(root, n)


def _read(p):
    with open(p, encoding="utf-8") as h:
        return h.read()


def _notes(src):
    """Every `note=` value, as (first line, whole block).

    ⚠️ BALANCED SCAN, NOT AN END-MARKER REGEX, AND THE FIRST DRAFT WAS THE
    REGEX. It looked for a newline before the next attribute or `/>`, so a note
    whose closing `" />` sits on the SAME line as its last words never matched
    and the block ran on into the following elements — reporting three
    perfectly short descriptions as too long. The instrument, not the code:
    third time in one session. Counting delimiters cannot make that mistake.
    """
    out = []
    for m in re.finditer(r"^[ \t]*note=", src, re.M):
        i = src.index("=", m.start()) + 1
        depth, quote, j = 0, None, i
        while j < len(src):
            c = src[j]
            if quote:
                if c == quote and src[j - 1] != "\\":
                    quote = None
                    if depth == 0:
                        break
            elif c in "\"'`":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        block = src[m.start():j + 1]
        out.append((block.split("\n")[0].strip(), block))
    return out


# ── one pager ───────────────────────────────────────────────────────────────

def test_no_surface_rolls_its_own_pager() -> None:
    """⚠️ `.usage-pager` WAS UsagePanel's PRIVATE CLASS while three other long
    lists each did something else. A second pager is a second set of edge cases
    around an empty page and a stale page number."""
    for p in _files("components"):
        src = _read(p)
        if "usage-pager" in src:
            raise AssertionError(f"{os.path.basename(p)} still uses the private "
                                 "pager class; use <Pager> from common/Paged")


def test_long_logs_page_rather_than_capping_silently() -> None:
    """⚠️ A CAP WITH NO AFFORDANCE IS A LIST LYING ABOUT ITS SIZE. TelemetryPanel
    showed the newest ten and told the reader to use Copy or Download "for the
    rest" — a log directing you out of the app to read it."""
    for name in ("UsagePanel.tsx", "TelemetryPanel.tsx"):
        src = _read(os.path.join(SRC, "components", "settings", name))
        assert "usePaged(" in src, f"{name} does not use the shared pager"
        assert "<Pager " in src, f"{name} pages but shows no controls"
        assert "VISIBLE_ROWS" not in src and "PAGE_SIZE" not in src, (
            f"{name} kept a private page size beside the shared one")


def test_there_is_exactly_ONE_page_size_in_the_app() -> None:
    paged = _read(os.path.join(SRC, "components", "common", "Paged.tsx"))
    assert "export const PAGE_ROWS" in paged
    # ⚠️ `useTruncated`'s 3 is NOT a rival: it answers a different question and
    # its own header says so. This asserts no THIRD number appears.
    sizes = set()
    for p in _files("components"):
        sizes |= set(re.findall(r"usePaged\([^,)]+,\s*(\d+)\s*\)", _read(p)))
    assert not sizes, f"a caller overrode the shared page size: {sizes}"


# ── one hint, and short descriptions ────────────────────────────────────────

def test_the_shared_controls_all_offer_a_hint() -> None:
    """A control wrapper without `more` forces its caller to write a paragraph,
    which is how the descriptions grew in the first place."""
    tog = _read(os.path.join(SRC, "components", "common", "ToggleField.tsx"))
    assert "more?" in tog and "InfoHint" in tog
    panel = _read(os.path.join(SRC, "components", "settings",
                               "AgentTuningPanel.tsx"))
    for fn in ("function Num(", "function Text(", "function Choice<"):
        i = panel.index(fn)
        assert "more?" in panel[i:i + 400], f"{fn} takes no hint"


def test_no_control_description_runs_past_two_lines() -> None:
    """⚠️ THE RULE, AS A TEST RATHER THAN AN INTENTION. Counted in SOURCE lines,
    which is the thing an author controls; the rendered wrap is narrower still,
    so two source lines is the generous reading of "at most two"."""
    # ⚠️ MEASURED IN VISIBLE CHARACTERS, NOT SOURCE LINES, AND THE FIRST TWO
    # DRAFTS USED SOURCE LINES. A note wrapped by the formatter, or written as
    # a ternary with a branch per state, spans more source lines than it renders
    # — one such reported a 58-character sentence as too long. Two lines at a
    # dialog's width is roughly 200 characters; that is the thing the rule is
    # about and the thing a reader sees.
    bad = []
    for p in _files("components"):
        for first, block in _notes(_read(p)):
            text = "".join(re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', block))
            text += "".join(re.findall(r"`([^`]*)`", block))
            if len(re.sub(r"\s+", " ", text)) > MAX_NOTE_CHARS:
                bad.append(f"{os.path.basename(p)}: {first[:60]} "
                           f"({len(text)} chars)")
    assert not bad, ("these descriptions are longer than two lines — move the "
                     "detail into `more`:\n  " + "\n  ".join(bad))


def test_the_hint_is_not_a_native_title_tooltip() -> None:
    """⚠️ THE TARGET IS A WALL-MOUNTED iPAD. `title=` needs a hover, so every
    explanation written that way is one a touch user cannot reach."""
    hint = _read(os.path.join(SRC, "components", "common", "InfoHint.tsx"))
    assert "onClick" in hint, "the hint cannot be opened by touch"
    assert 'role="tooltip"' in hint


def test_prose_beside_a_control_is_ALSO_two_lines() -> None:
    """⚠️ THE PIN WAS BLIND AND PASSING, WHICH IS WORSE THAN FAILING. Scoped to
    `note=`, it saw only the four wrapper components — so widening it from two
    directories to every component changed nothing and looked like proof the
    rest were clean. They were not: ten paragraphs of 200–321 characters sat
    beside controls in the Facility, Reports, Cockpit and Settings surfaces,
    written as raw markup rather than through a wrapper.

    A rule that only reaches the callers who already adopted the shared
    component is a rule that cannot find the ones who did not.
    """
    bad = []
    for p in _files("components"):
        src = _read(p)
        # only files that actually render a control — prose elsewhere is content
        if not re.search(r"<(input|select|textarea|ToggleField)\b", src):
            continue
        for m in re.finditer(r'<p className="muted body-text">(.*?)</p>', src, re.S):
            body = m.group(1)
            if "<InfoHint" in body:          # the detail already moved
                body = body[:body.index("<InfoHint")]
            # ⚠️ STRIP JSX EXPRESSIONS BEFORE COUNTING. `{Math.round(100 *
            # summary.total.cache_read / (…))}` renders as two or three
            # characters and is ninety of source — counting it flagged a
            # correct 180-character paragraph at 274. Fourth time in this
            # session that the instrument, not the code, was the finding.
            body = re.sub(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", "0", body)
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", body)).strip()
            if len(text) > MAX_NOTE_CHARS:
                bad.append(f"{os.path.basename(p)}: {len(text)}c — {text[:56]}…")
    assert not bad, ("prose beside a control, longer than two lines — shorten "
                     "it and move the rest into an <InfoHint>:\n  "
                     + "\n  ".join(bad))


def test_a_step_header_is_ONE_line_with_the_rest_behind_the_hint() -> None:
    """⚠️ THREE GREY BLOCKS STACKED IS WHAT WAS REPORTED, NOT ONE LONG ONE. A
    step tab renders the tier description, then a facts row, then the control's
    own note — so two-line descriptions became six lines of grey before the
    reader reached a switch. Each is short enough alone and the STACK is the
    defect, which is why this measures the header specifically."""
    src = _read(os.path.join(SRC, "components", "agent", "tiers.tsx"))
    longest = max(len(re.sub(r"\s+", " ", m))
                  for m in re.findall(r'what:\s*"([^"]*)"', src))
    assert longest <= 90, (
        f"a step description is {longest} chars — it wraps to two lines above "
        "a facts row and a control note; shorten it and use `more`")
    assert "more?" in src and "InfoHint" in src, (
        "TierIntro offers no hint, so shortening `what` would delete detail "
        "rather than move it")


# ── CSS custom properties that do not exist ─────────────────────────────────

#: Properties set from JavaScript at runtime, so the stylesheet legitimately
#: never declares them. ⚠️ DERIVED, NOT LISTED: the test greps the app for a
#: `setProperty` or a style-object key, so adding a runtime property needs no
#: edit here and REMOVING its writer makes the test fail — which is the case
#: that would otherwise go silent.
def _set_from_js(name: str) -> bool:
    for root, _d, names in os.walk(SRC):
        for n in names:
            if n.endswith((".ts", ".tsx")):
                src = _read(os.path.join(root, n))
                if f'"{name}"' in src or f"'{name}'" in src:
                    return True
    return False


def test_no_stylesheet_rule_reads_a_property_that_is_never_declared() -> None:
    """⚠️ AN UNDECLARED `var()` WITH NO FALLBACK IS AN INVALID VALUE, so the
    whole declaration is dropped — silently, and invisibly to tsc and to review.
    It is the CSS twin of a missing class, which this project already pins.

    ⚠️ AND IT HAS BEEN FOUND BEFORE AND NOT PINNED, WHICH IS WHY IT RECURRED.
    styles.css carries a comment reading "--text-muted / --border were never
    defined in either theme" — written while fixing ONE call site, the
    sparkline. Eight other uses of --text-muted survived it, plus four of
    --status-ok, and the (i) bubble added six more and shipped with no
    background at all: white text over the row beneath it, reported from a
    phone as unreadable. Rolling a fix out by call site instead of by what it
    applies to is `feedback_audit-applicable-set`; this is the test that ends it.
    """
    css = re.sub(r"/\*.*?\*/", "", _read(os.path.join(SRC, "styles.css")), flags=re.S)
    declared = set(re.findall(r"(--[a-zA-Z0-9-]+)\s*:", css))
    bad = sorted({m.group(1)
                  for m in re.finditer(r"var\(\s*(--[a-zA-Z0-9-]+)\s*\)", css)
                  if m.group(1) not in declared and not _set_from_js(m.group(1))})
    assert not bad, (
        "these custom properties are read with no fallback and never declared, "
        "so every rule using them is dropped: " + ", ".join(bad))


def test_the_master_switch_is_in_the_header_and_NOT_duplicated() -> None:
    """⚠️ ONE CONTROL PER STORED KEY. `enabled` is the only setting that zeroes
    all spending — `agent_config.trigger_enabled` reads "`enabled` gates all of
    them" — so it belongs where it is visible from every tab. Two controls over
    one key in one dialog is the lost update ActDeliverySection warns about."""
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    panel = _read(os.path.join(SRC, "components", "settings",
                               "AgentTuningPanel.tsx"))
    assert 'draft.edit({ enabled: e.target.checked })' in modal, (
        "the header has no master switch")
    assert "settings-header-control" in modal, (
        "not in the header slot SettingsModal already uses")
    assert "checked={draft.enabled}" not in panel, (
        "the Settings tab still renders a second control over `enabled`")


def test_the_advanced_opener_is_in_the_footer_so_every_tab_reaches_it() -> None:
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    i = modal.index("<ModalFooter")
    assert "Cost, people and advanced" in modal[i:i + 900], (
        "the advanced opener is not in the footer, so it is reachable from one "
        "tab only")


def test_every_blueprint_family_the_villa_reports_has_a_described_ROLE() -> None:
    """⚠️ A BLANK CELL READS AS "THIS FAMILY DOES NOTHING". `control` and `vesta`
    were absent from FAMILIES and rendered an empty role beside a real count.
    Same shape as an unlisted severity defaulting to the quietest value."""
    tiers = _read(os.path.join(SRC, "components", "agent", "tiers.tsx"))
    block = tiers[tiers.index("export const FAMILIES"):]
    block = block[:block.index("\n};")]
    named = set(re.findall(r"^  (\w+):", block, re.M))
    assert {"critical", "maintenance", "roi", "audit", "control", "vesta"} <= named, (
        f"families missing a role: {sorted({'critical','maintenance','roi',
        'audit','control','vesta'} - named)}")
    reflex = _read(os.path.join(SRC, "components", "agent", "ReflexObserve.tsx"))
    assert 'fam?.role ?? ""' not in reflex, (
        "an unlisted family still renders a blank role rather than saying so")


def test_the_briefing_tab_states_precedence_CONTEXTUALLY() -> None:
    """⚠️ THE TAB ASSERTED A FIXED HIERARCHY THAT `agent_owns_analysis` INVERTS.
    Its section order calls automations "the primary detection layer, which
    WINS" and the checks "the fallback", and the lead paragraph said the checks
    run "when they do not". With the agent owning detection the checks ALWAYS
    run and a rule wins only on a device it actually reported."""
    tab = _read(os.path.join(SRC, "components", "reports", "ModulesTab.tsx"))
    assert "agentOwns" in tab, "the tab cannot tell which layer is in charge"
    assert "loadAgentConfig" in tab, "it invents its own source for that fact"
    assert tab.count("{agentOws" if False else "{agentOwns") >= 2, (
        "only one sentence was made contextual — the precedence is stated in "
        "more than one place")
