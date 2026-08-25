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
    assert "draft.edit({ enabled: on })" in modal, (
        "the header has no master switch")
    assert "settings-header-control" in modal, (
        "not in the header slot SettingsModal already uses")
    assert "checked={draft.enabled}" not in panel, (
        "the Settings tab still renders a second control over `enabled`")


def test_the_advanced_opener_is_in_the_footer_so_every_tab_reaches_it() -> None:
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    i = modal.index("<ModalFooter")
    # ⚠️ RENAMED IN 2.759.0 WHEN "Settings" MOVED INTO IT. The property is
    # unchanged — the opener lives in the FOOTER so every tier tab reaches it —
    # and it matters more now, because the settings pane is behind this button
    # rather than being a tab of its own.
    assert "Settings &amp; others" in modal[i:i + 900], (
        "the settings opener is not in the footer, so it is reachable from one "
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


def test_switching_supervision_off_dims_ONLY_the_tiers_that_stop() -> None:
    """⚠️ THREE OF SIX, AND THE OTHER THREE MUST STAY LIVE. `scheduler`,
    `runtime` and `outbox` each refuse on `enabled`, so Triage, Reason and Act
    really do go inert. REFLEX does not — those are Home Assistant blueprints
    that fire with no add-on and no model. OBSERVE does not either:
    `observe/cycle.py` contains no `enabled` check, so the journal keeps
    recording and costs nothing. SETTINGS must stay editable or supervision
    could never be configured before being switched on.

    Dimming a tier that is still working is the lie this subsystem keeps paying
    for — an owner reading a greyed Observe tab concludes the villa recorded
    nothing while it was off. It recorded everything.
    """
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    block = modal[modal.index("INERT_WHEN_OFF"):]
    listed = set(re.findall(r'"(\w+)"', block[:block.index("]")]))
    assert listed == {"triage", "reason", "act"}, (
        f"wrong tiers dimmed: {sorted(listed)}")

    # and the claim is checked against the backend, not against this list
    root = os.path.dirname(SRC)
    bins = os.path.join(root, "rootfs", "usr", "bin")
    for mod, stops in (("agent/scheduler.py", True), ("agent/runtime.py", True),
                       ("agent/outbox.py", True), ("observe/cycle.py", False)):
        src = _read(os.path.join(bins, *mod.split("/")))
        gates = 'cfg.get("enabled")' in src or 'get("enabled")' in src
        assert gates is stops, (
            f"{mod} " + ("no longer refuses on `enabled`, so a tier is dimmed "
                         "while still running" if stops else
                         "now refuses on `enabled`, so a live tier should be "
                         "dimmed and is not"))


def test_the_header_switch_is_not_a_bare_checkbox() -> None:
    """Reported from the screen: a checkbox with a word beside it read as a form
    field dropped into a title bar. The app already has a header-control idiom."""
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    head = modal[modal.index("settings-header-control"):][:1200]
    assert "segmented-icons" in head, "not the app's header-control idiom"
    assert 'type="checkbox"' not in head, "still a raw checkbox"
    assert "aria-label" in head and "title=" in head, (
        "icon-only with no accessible name — the meaning has nowhere to live")


def _tsx_sources():
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if name.endswith((".tsx", ".ts")):
                path = os.path.join(root, name)
                yield path, _read(path)


def test_every_status_banner_variant_a_component_asks_for_is_DECLARED() -> None:
    """⚠️ `cockpit-health-unknown` SHIPPED AND WAS NEVER A CLASS. ShadowDiffPanel
    built its headline class as `cockpit-health-${verdict === ... : "unknown"}`,
    and nothing in styles.css declared it — so the two states that used it
    rendered with no background and no colour, on the page they were the
    headline OF. tsc cannot see inside a template literal and review reads the
    ternary as obviously fine.

    The generic form is checked, not the one class: a variant assembled from a
    ternary is exactly the shape that escapes both the compiler and the eye.
    """
    css = _read(os.path.join(SRC, "styles.css"))
    for base in ("cockpit-health", "fm-banner", "sev"):
        declared = set(re.findall(rf"\.{base}-([a-z0-9-]+)", css))
        for path, src in _tsx_sources():
            for expr in re.findall(rf"{base}-\$\{{([^}}]*)\}}", src):
                for variant in re.findall(r'"([a-z0-9-]+)"', expr):
                    assert variant in declared, (
                        f"{os.path.relpath(path, SRC)} renders "
                        f"`{base}-{variant}` and styles.css declares no such "
                        f"class, so that element is painted as nothing")


def test_a_pass_that_never_RAN_is_not_reported_as_a_quiet_one() -> None:
    """⚠️ THREE OUTCOMES, AND THE STORE HOLDS TWO. `audit.record_pass` writes
    `verdict = "escalated" if escalated else "quiet"`, so "agent disabled", "no
    model provider configured" and "budget: …" — passes in which the assistant
    did not look at all — were all labelled **quiet** on the panel, with the
    real reason buried mid-string in `detail`.

    One value for the two outcomes an instrument exists to separate is this
    project's most repeated defect, and it was inside the panel built to resolve
    it. So the panel must derive the outcome from the REASON and must not render
    the stored verdict.
    """
    panel = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    assert "export function outcomeOf" in panel, "no derived outcome"
    body = panel[panel.index("export function outcomeOf"):]
    body = body[:body.index("\n}")]
    assert "verdict" not in body, (
        "the outcome is read off the stored two-valued verdict, which cannot "
        "express `blocked`")
    for word in ('"raised"', '"quiet"', '"blocked"'):
        assert word in body, f"outcomeOf cannot return {word}"
    assert not re.search(r"\bpass\.verdict\b|\bp\.verdict\b", panel), (
        "the panel still renders the stored verdict somewhere, so a pass that "
        "never ran reads as a quiet one")


def test_an_absent_document_size_is_not_read_as_an_empty_document() -> None:
    """⚠️ `undefined` IS NOT 0 HERE, AND 0 IS THE LOUDEST ALARM ON THE PAGE.
    Audit rows written before v2.685.0 carry no `doc_chars` at all; treating
    that as "the assistant was handed nothing to read" would accuse a pass that
    was probably fine, which is the same class of error the field exists to
    report honestly."""
    panel = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    # ⚠️ THE FACTS ROW THAT PRINTED "? or N char" WENT WITH THE HANDOVER PAGE,
    # but the property it guarded did not: a row whose size is UNKNOWN must not
    # be accused of having run on nothing. `=== 0` is what keeps that true —
    # `undefined === 0` is false — and a falsy test would collapse the two.
    assert "docChars === 0" in panel, "nothing detects the empty-document fault"
    assert not re.search(r"!\s*\w+\.docChars|docChars\s*\|\|", panel), (
        "a falsy test collapses `undefined` and 0, which are opposite claims")


def test_every_list_class_used_on_a_UL_resets_its_marker() -> None:
    """⚠️ FOUR OF FIVE AGREED AND ONE DID NOT — the applicable-set defect in its
    purest form. `.reports-list`, `.reports-tasks`, `.reports-deliveries` and
    `.first-run-tip-list` all set `list-style: none`; `.fm-list` did not, and it
    is laid out as flex ROWS, so every row drew a bullet beside a design that
    never expected one. Reported as clutter on the Handover tab.

    Rolled out by call site rather than by what it applies to, which is what
    /dry-audit exists to catch — so this asks the question the other way round:
    take every class the markup puts on a `<ul>`, and require it.
    """
    css = _read(os.path.join(SRC, "styles.css"))
    used = set()
    for _path, src in _tsx_sources():
        used.update(re.findall(r'<ul className="([a-z0-9 -]+)"', src))
    classes = {c for group in used for c in group.split() if c != "body-text"}
    assert classes, "no <ul> classes found — the scan anchor moved"
    for name in sorted(classes):
        block = re.search(rf"\.{re.escape(name)}\s*\{{(.*?)\}}", css, re.S)
        assert block, f".{name} is used on a <ul> and is not declared"
        assert "list-style" in block.group(1), (
            f".{name} is used on a <ul> and never resets its marker, so every "
            "row draws a bullet")


def test_the_segmented_control_is_sized_by_a_TOKEN_and_grows_for_a_finger() -> None:
    """⚠️ A `min-height` IS NOT A QUANTITY A RULE CAN VARY — the same lesson
    `--toggle-pad` records four fields above it. `.segmented button` carried a
    flat 40px which drew a 48px slab inside its track; reported from a laptop,
    where nothing is operated by finger.

    ⚠️ AND SHRINKING IT MUST NOT SHRINK THE TOUCH TARGET. A coarse pointer gets
    `--touch-min` back, declared as the token so every variant follows without
    naming itself.
    """
    css = _read(os.path.join(SRC, "styles.css"))
    seg = re.search(r"\.segmented button \{(.*?)\}", css, re.S)
    assert seg and "var(--segmented-h)" in seg.group(1), (
        "the segmented control is sized by a literal again")
    coarse = re.search(r"@media \(pointer: coarse\) \{[^}]*--segmented-h:\s*"
                       r"var\(--touch-min\)", css)
    assert coarse, (
        "a touchscreen no longer gets the full target back, so the dialog on "
        "the wall tablet shrank with the laptop")
    # ⚠️ `min-height` SPECIFICALLY, NOT "the token appears somewhere in the
    # block". The first version passed when min-height was mutated back to a
    # literal, because the WIDTH line still mentioned the token — a pin reading
    # a whole block cannot say which declaration it checked.
    icons = re.search(r"\.segmented-icons button \{(.*?)\}", css, re.S)
    assert icons, ".segmented-icons button is no longer declared"
    assert re.search(r"min-height:\s*var\(--segmented-h\)", icons.group(1)), (
        "the icon variant's height is a literal again and will drift from its "
        "sibling")


def test_a_field_puts_its_NAME_directly_under_its_CONTROL() -> None:
    """⚠️ `.fm-field` IS A PLAIN COLUMN WITH NO `order` RULES, so DOM order is
    what the reader sees. `Choice` rendered note → buttons → chosen-hint → label,
    which put a paragraph between a field and its own name — the label then read
    as a heading for whatever came next. Reported: "How it should work" floating
    under a sentence about Live mode."""
    panel = _read(os.path.join(SRC, "components", "settings",
                               "AgentTuningPanel.tsx"))
    # ⚠️ THE WHOLE COMPONENT, not up to the first `\n}` — `Choice` contains
    # nested braces (the options map), so that anchor stopped inside the JSX and
    # the label was simply not in the slice. A slice that misses what it is
    # looking for raises rather than passing, which is the only reason this was
    # caught rather than being a vacuous green.
    body = panel[panel.index("function Choice"):panel.index("function Text")]
    label_at = body.index("<span>{label}</span>")
    hint_at = body.index("{chosen.hint}")
    assert label_at < hint_at, (
        "the field's name is rendered after the chosen option's explanation, "
        "so it reads as a heading for the next section")


def test_the_triage_tab_is_never_a_heading_over_nothing() -> None:
    """⚠️ `AgentQueue` RETURNS null IN `auto` MODE, CORRECTLY — its own comment
    says an empty approval queue on a villa that investigates by itself is the
    permanent and correct state. True in the Cockpit, where it is one block among
    many; on a tab whose entire job is this tier it left a step header over an
    empty pane, which reads as a broken tier. The passes were being recorded the
    whole time and were visible only under Advanced."""
    modal = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    tab = modal[modal.index('tab === "triage"'):]
    tab = tab[:tab.index("tab === \"reason\"")]
    # ⚠️ THE ELEMENT, WITH ITS BOUNDARY. `"RecentChecks" in tab` is TRUE for
    # `<RecentChecksX>` too — a substring match passed a mutation that renamed
    # the component away, which is the same shape as the symbol-regex false
    # positives /dry-audit's step 7 warns about.
    assert re.search(r"<RecentChecks[\s/>]", tab), (
        "the triage tab renders only the approval queue, which is null on a "
        "villa running Live — so the tab is blank")


def test_recent_checks_has_ONE_implementation() -> None:
    """⚠️ TWO TABS, ONE COMPONENT — and the pass→outcome rules stay in
    ShadowDiffPanel where `test_pass_reason_contract.py` pins them. A second copy
    of "what does `nothing to escalate` mean" is exactly the drift that pin
    exists to stop."""
    shared = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    assert "outcomeOf" in shared and "import" in shared
    # ⚠️ THE SECOND CALL SITE WAS THE HANDOVER TAB, DELETED IN 2.756.0. What is
    # still worth pinning is that the row rendering exists ONCE — a copy would
    # be a second answer to "what does `nothing to escalate` mean", which is
    # what `test_pass_reason_contract.py` exists to keep singular.
    hits = [p for p, src in _tsx_sources() if "Looked, nothing to raise" in src]
    assert len(hits) == 1, f"the row rendering is written {len(hits)} times"


def test_the_source_legend_lives_in_ADVANCED_and_only_there() -> None:
    """⚠️ ITS JOURNEY IS THE ARGUMENT. It started under three tier tabs, where it
    restated the one chip already in each header (reported as a redundant badge),
    then moved to Settings — correct, but still on the daily path below the dials
    people tune. It is reference material: read once, consulted rarely."""
    main = _read(os.path.join(SRC, "components", "agent", "AgentModal.tsx"))
    adv = _read(os.path.join(SRC, "components", "agent",
                             "AgentAdvancedModal.tsx"))
    assert "<SourceLegend" not in main, "the legend is back on the daily path"
    assert "<SourceLegend" in adv, "the legend is not in Advanced either"


def test_a_component_lives_where_it_is_RENDERED() -> None:
    """⚠️ FIVE COMPONENTS NAMED `Cockpit*` WERE RENDERED ONLY BY THE AGENT
    MODAL, AND THE COCKPIT RENDERED NONE OF THEM. `AgentQueue`, `AgentConcerns`,
    `AgentProposals`, `AgentMemories` and `AgentReview` sat in
    `components/cockpit/` under a name they had presumably earned once and kept
    after moving. Every one of them imports only from `@/agent/*`.

    It cost a real misunderstanding: explaining why the Triage tab was blank, I
    wrote "CockpitQueue returns nothing in Live mode" and the owner reasonably
    read it as an option in the Cockpit dialog reaching into the agent —
    "Nothing in the Cockpit modal shall act on VESTA Agent modal, right?" Right,
    and nothing does. The names said otherwise.

    A misnamed file is not cosmetic: it is a claim about ownership that review
    reads as true. This pin is the cheap half — nothing under
    `components/cockpit/` may be imported by the agent surfaces.
    """
    agent_dir = os.path.join(SRC, "components", "agent")
    offenders = []
    for name in sorted(os.listdir(agent_dir)):
        if not name.endswith((".tsx", ".ts")):
            continue
        src = _read(os.path.join(agent_dir, name))
        for hit in re.findall(r'from "@/components/cockpit/(\w+)"', src):
            offenders.append(f"agent/{name} imports cockpit/{hit}")
    assert not offenders, (
        "a component the agent renders lives in the cockpit folder, which is a "
        "claim about ownership that is not true: " + "; ".join(offenders))


def test_a_tier_fact_ICON_follows_its_VALUE() -> None:
    """⚠️ THE PICTURE SAID THE OPPOSITE OF THE WORDS BESIDE IT. Both glyphs were
    fixed: `WifiOff` rendered next to "Needs internet" and a plain `Sparkles`
    next to "No AI", so on three of the five tier tabs a reader glancing at the
    row read the negation of what it said. Reported from a screenshot.

    ⚠️ ONE STRIKE RULE, NOT A SECOND GLYPH. lucide ships `WifiOff` but no
    `SparklesOff`, and `Sparkles` is this app's AI mark everywhere else — using
    a different icon for the negative case alone would mean two metaphors for
    one fact. So both facts render their PLAIN glyph and `.tier-fact-off` draws
    the diagonal, which is also why the CSS has to exist for this to work at all.
    """
    tiers = _read(os.path.join(SRC, "components", "agent", "tiers.tsx"))
    css = _read(os.path.join(SRC, "styles.css"))
    # ⚠️ CODE ONLY, AND THIS IS THE FOURTH TIME IN ONE SESSION THAT A FIRST-CUT
    # PIN MATCHED THE COMMENT RECORDING ITS OWN FIX. The header above `TierIntro`
    # names `WifiOff` deliberately — it is the record of what was wrong — and
    # dry-audit Part 2 says that record stays. Strip blocks as BLOCKS: a filter
    # keyed on the first character passes a `{/*` opener and then flags every
    # continuation line, which starts with an ordinary word.
    code = re.sub(r"\{?/\*[\s\S]*?\*/\}?", "", tiers)
    code = "\n".join(l for l in code.splitlines()
                      if not l.lstrip().startswith("//"))
    assert "WifiOff" not in code, (
        "the offline glyph is fixed again, so it contradicts 'Needs internet'")
    assert "tier-fact-off" in code, "nothing marks the negative case"
    assert ".tier-fact-off::after" in css, (
        "the strike has no CSS, so the negative case renders identically to the "
        "positive one — the exact defect this replaced")
    # both facts must be conditional, not one of them
    assert code.count("tier-fact-off") >= 2, (
        "only one of the two facts follows its value")


def test_the_tier_FACTS_sit_above_the_description() -> None:
    """⚠️ THEY ARE A HEADER, NOT A FOOTNOTE. How fast, what it costs and whether
    it survives an outage belong with the step number and the name — a reader
    who stops after the first line should still have them. They used to sit
    after a paragraph of prose."""
    tiers = _read(os.path.join(SRC, "components", "agent", "tiers.tsx"))
    body = tiers[tiers.index("export function TierIntro"):]
    assert body.index('<dl className="tier-facts">') < body.index("{tier.what}"), (
        "the facts row is below the description again")
