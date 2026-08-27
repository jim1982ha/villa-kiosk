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
        # ⚠️ A LITERAL, NOT A NAMED CONSTANT. The rule is that no page size is
        # scattered through a component — `PAGE_CARDS` is declared beside
        # `PAGE_ROWS` in this same module for a list whose entries are cards
        # rather than rows, so pagination still has ONE owner. A bare number
        # here is the drift; a second exported name is a decision.
        sizes |= set(re.findall(r"usePaged\([^,)]+,\s*(\d+)\s*\)", _read(p)))
    assert not sizes, f"a caller overrode the shared page size with a literal: {sizes}"
    assert "export const PAGE_CARDS" in paged


def test_a_flag_with_no_identifiable_check_is_still_RENDERED() -> None:
    """⚠️ THE REGRESSION 2.780.0 SHIPPED, FOUND BY THE OWNER LOOKING AT IT.
    Merging the two lists drew every flag INSIDE the check that raised it — and
    a check written before that release stored `run_id: ""`, so nothing can
    pair it with its flags. Fourteen waiting flags became invisible: the owner
    saw "Cancel all 14" and not one of the fourteen.

    ⚠️ HIDING SOMETHING THE READER CAN ACT ON IS WORSE THAN THE DUPLICATION THE
    MERGE REMOVED, and `tsc` cannot see it — the variable was computed and
    simply never rendered, which type-checks perfectly. So the pin asserts the
    RENDER, not the computation.
    """
    src = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    code = re.sub(r"\{/\*[\s\S]*?\*/\}", "", src)
    code = "\n".join(l for l in code.splitlines()
                      if not l.strip().startswith("//"))
    assert "orphans" in code, (
        "RecentChecks no longer separates flags whose check cannot be "
        "identified, so legacy flags are silently dropped")
    assert "orphans.map(" in code, (
        "the unmatched flags are computed and never rendered — the reader sees "
        "a Cancel-all button for items that appear nowhere")
    # ⚠️ THE CARD AND THE BULK BUTTON MUST COUNT THE SAME SET. They did not:
    # the button offered to cancel 14 while the card listed 54, because the card
    # took every unmatched flag and the button took only the waiting ones. Two
    # numbers for two different things on one screen reads as a broken button —
    # reported exactly that way. Both now filter on `awaiting-approval`.
    # ⚠️ THE SERVER'S OWN PENDING LIST, NOT A COPY OF ITS RULE. This asserted
    # the client re-derived `verdict === "awaiting-approval"`, which was the
    # defect: `audit.pending_escalations` ALSO excludes any run id with a
    # settling row, so eleven already-dismissed flags rendered as pending and
    # every cancel was refused. Both the card and the button now read
    # `pending`, which is `/agent-queue`'s answer.
    assert "pending.has(f.runId)" in code.split("const orphans")[1][:400], (
        "the unmatched-flags card no longer filters to the server's pending "
        "list, so its count disagrees with the Cancel-all button beside it")
    assert "orphans.length > 0 &&" in code, (
        "the unmatched-flags block is not conditional on there being any, so "
        "an empty card renders on every villa that has none")


def test_the_device_list_is_INERT_when_the_master_switch_is_off() -> None:
    """⚠️ AN ENABLED PICKER UNDER AN UNTICKED BOX INVITES A LIST THAT AUTHORISES
    NOTHING. Both are required — the switch AND a device on the list — so an
    owner who builds the list with the switch off has granted exactly nothing
    and the screen gave no sign of it. That is the shape 2.718.0 shipped, where
    `act_enabled` existed and no surface could see it.

    ⚠️ `pointerEvents` ALONE IS NOT ENOUGH. It stops a mouse and leaves the
    controls reachable by keyboard, so the `disabled` attribute has to follow
    the lock too — dimming something a Tab key can still operate is the
    accessible version of a lie.
    """
    src = _read(os.path.join(SRC, "components", "settings",
                             "ActuableDevicesPanel.tsx"))
    code = "\n".join(l for l in src.splitlines()
                      if not l.strip().startswith("//"))
    assert "locked" in code, "the panel cannot be locked at all"
    assert "pointerEvents: locked" in code, (
        "the group is not made inert when the switch is off")
    assert "disabled={disabled || locked}" in code, (
        "a control inside the group ignores the lock, so it stays operable by "
        "keyboard while the group looks disabled")

    caller = _read(os.path.join(SRC, "components", "agent",
                                "ActDeliverySection.tsx"))
    assert "locked={c.actEnabled !== true}" in caller, (
        "nothing passes the lock, so the panel is never inert — the helper "
        "honouring a prop nobody sets is this repository's most repeated defect")


def test_every_icon_only_concern_button_carries_a_TOOLTIP() -> None:
    """⚠️ TWO OF THE THREE HAD NONE. An icon-only control whose meaning lives
    only in `aria-label` is readable to a screen reader and to nobody using a
    mouse — which is everybody on the wall tablet. `test_modal_shell` already
    pins this for the footer's exits; the concern row had escaped it."""
    src = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    buttons = re.findall(r"<button\b[^>]*?>", src, re.S)
    icon_only = [b for b in buttons if "aria-label=" in b]
    assert icon_only, "no labelled buttons found; this test would be vacuous"
    missing = [b[:70] for b in icon_only if "title=" not in b]
    assert not missing, (
        f"{len(missing)} icon-only concern button(s) have no tooltip: {missing}")


def test_no_JSX_attribute_carries_an_UNPROCESSED_escape() -> None:
    """⚠️ JSX ATTRIBUTE STRINGS ARE NOT JAVASCRIPT STRINGS. `title="Don\\u2019t"`
    renders the six characters `\\u2019` to the reader, because a JSX attribute
    literal does not process backslash escapes. Found by /dry-audit on
    2026-08-26 in a tooltip I had just written — it type-checks, it builds, and
    it is only wrong on screen, which is this session's most repeated shape.

    Use the character itself, or an HTML entity, or a `{"..."}` expression."""
    bad = []
    for path in _files("components"):
        for n, line in enumerate(_read(path).splitlines(), 1):
            if not re.search(r'(title|placeholder|aria-label|alt)="', line):
                continue
            if re.search(r'="[^"]*\\(u[0-9a-fA-F]{4}|n|t)', line):
                bad.append(f"{os.path.basename(path)}:{n}")
    assert not bad, (
        f"JSX attribute(s) containing a backslash escape that will render "
        f"literally: {bad}")


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
    # ⚠️ HOISTED OUT OF THE f-STRING: a multi-line expression inside braces is
    # PEP 701 (Python 3.12+) and CI runs 3.11, where it is a SyntaxError that
    # kills COLLECTION of this whole file — every other test in it included.
    expected = {"critical", "maintenance", "roi", "audit", "control", "vesta"}
    assert expected <= named, (
        f"families missing a role: {sorted(expected - named)}")
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
    # ⚠️ THE ANCHOR IS THE QUIET-CHECK ROW, and its wording moved in 2.780.0
    # from "nothing to raise" to "nothing to flag" when the app settled on ONE
    # vocabulary — a CHECK raises FLAGS, a flag may become a CONCERN. `== 1`
    # catches both a second copy and a vanished anchor, so this cannot pass
    # vacuously if the wording moves again.
    hits = [p for p, src in _tsx_sources() if "Nothing to flag in this check" in src]
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


def test_no_tooltip_is_a_WALL_of_text() -> None:
    """⚠️ REPORTED THREE TIMES ON ONE HINT. The Home Assistant tools tooltip was
    rewritten twice and reported twice — the second version opened
    "**Either way** it can read …" and ran three ideas together with bold words
    inside them, which reads as one long sentence being shouted at intervals.

    ⚠️ THE MEASURE IS SENTENCE LENGTH, NOT TOTAL LENGTH, and that distinction is
    the whole rule. The fixed version of that hint is LONGER than the version
    that was reported (97 words against 71) and reads far more easily, because
    its longest sentence is 16 words rather than 32. A word budget would have
    forced the wrong edit — cutting content instead of cutting clauses.

    28 words is the bar: comfortably above every sentence that now ships, and
    below every one that was reported.
    """
    limit = 28
    offenders = []
    for path, src in _tsx_sources():
        for m in re.finditer(r"more=\{<>(.*?)</>\}", src, re.S):
            body = re.sub(r"\{/\*.*?\*/\}", "", m.group(1), flags=re.S)
            body = re.sub(r"<[^>]+>", "", body)
            body = re.sub(r"\{[^{}]*\}", " ", body)
            flat = " ".join(body.split())
            for sentence in re.split(r"(?<=[.!?])\s+", flat):
                words = len(sentence.split())
                if words > limit:
                    line = src[:m.start()].count("\n") + 1
                    offenders.append(
                        f"{os.path.relpath(path, SRC)}:{line} — {words} words")
    assert not offenders, (
        f"a tooltip sentence runs past {limit} words; split it rather than "
        "trimming it:\n  " + "\n  ".join(offenders))


def test_a_multi_paragraph_tooltip_is_SPACED() -> None:
    """⚠️ THE BROWSER DEFAULT IS 1em, WHICH IS ENORMOUS INSIDE A 10px BUBBLE.
    Splitting a wall into paragraphs only helps if the paragraphs are laid out;
    without this rule the fix reads worse than the wall it replaced."""
    css = _read(os.path.join(SRC, "styles.css"))
    assert ".info-hint-bubble p {" in css and ".info-hint-bubble p + p" in css, (
        "hint paragraphs have no spacing rule, so a split hint renders with "
        "browser-default 1em gaps or none at all")


def test_the_actuation_SWITCH_sits_with_the_LIST_it_is_anded_with() -> None:
    """⚠️ ITS TOOLTIP HAD TO END IN A CROSS-REFERENCE, AND THAT WAS THE TELL.
    The switch lived under Settings and the device allow-list on Act & Tell, so
    the hint finished "what it may touch is listed on Act & Tell, both must
    agree" — pointing at something the reader could not see, and after 2.759.0
    not even in the same dialog. Reported as "there is no list and the text is
    not clear about it".

    The fix was not better wording. Two halves of one authority decision on two
    screens is what the sentence existed to paper over.
    """
    act = _read(os.path.join(SRC, "components", "agent",
                             "ActDeliverySection.tsx"))
    tuning = _read(os.path.join(SRC, "components", "settings",
                                "AgentTuningPanel.tsx"))
    assert "draft.actEnabled" not in tuning and "actEnabled: c." not in tuning, (
        "the actuation switch is back on the tuning panel, away from the list "
        "it is AND-ed with")
    assert "actEnabled" in act and "ActuableDevicesPanel" in act, (
        "the switch and its allow-list are no longer on the same screen")
    assert act.index("actEnabled") < act.index("<ActuableDevicesPanel"), (
        "the switch renders after its own list, so the list appears before "
        "anything has said what it is for")


def test_the_concerns_list_says_WHAT_GETS_CHASED() -> None:
    """⚠️ "Nothing done yet" READS AS "SOMETHING IS STILL COMING" AND IT IS NOT.
    `route.escalate` refuses on its first line for anything that is not
    critical, so a warning is delivered once and then waits for a person — and
    no screen said so. An owner watching two delivered warnings sit at that
    state reasonably concluded a chase had failed or been switched off.

    ⚠️ THE COPY IS PINNED AGAINST THE RULE, NOT RESTATED. If `escalate` ever
    starts chasing warnings, this goes red rather than the screen quietly
    lying.
    """
    import re as _re
    root = os.path.dirname(SRC)
    with open(os.path.join(root, "rootfs", "usr", "bin", "agent", "route.py"),
              encoding="utf-8") as handle:
        route = handle.read()
    critical_only = _re.search(
        r'if str\(severity\)\.lower\(\) != "critical":\s*\n\s*return Escalation\(False',
        route)
    concerns = _read(os.path.join(SRC, "components", "agent",
                                  "AgentConcerns.tsx"))
    if critical_only:
        assert "waits for you" in concerns and "Only a critical" in concerns, (
            "only critical concerns are chased and no screen says so, so a "
            "delivered warning reads as a chase that failed")
    else:
        assert "Only a critical" not in concerns, (
            "the copy still says only a critical is chased, and the ladder no "
            "longer works that way")


def test_the_settled_record_survives_an_empty_OPEN_list() -> None:
    """⚠️ TWO TABS DISAGREEING ABOUT ONE VILLA, which is this subsystem's
    cardinal sin (2026-08-28). Triage totals "N raised as a concern" from the
    checks' own records; the Reason tab said "No concerns right now" whenever
    nothing was OPEN — because the early return for an empty list skipped the
    `SettledSummary` that only the main return rendered. Both sentences were
    true and only one was complete, so the owner reasonably read it as a
    concern that had gone missing.

    Pinned by SHAPE rather than by wording: the settled summary must be
    reachable from EVERY return path that renders the section, so a future
    early return cannot silently drop the record again.
    """
    src = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    body = src[src.index("if (rows.length === 0)"):]
    empty_branch = body[:body.index("return (\n    <>")] if "return (\n    <>" in body else body
    assert "<SettledSummary" in empty_branch, (
        "the empty-open branch drops the settled record, so a villa whose "
        "concerns have all been dealt with reads as a villa that never "
        "raised one — while the Triage tab still counts them")
    # ⚠️ AND THE COMPONENT MUST STILL RENDER IT ON THE POPULATED PATH, or this
    # pin would pass on a build that moved it and lost the other half.
    assert src.count("<SettledSummary") >= 2, (
        "the settled record no longer reaches both return paths")


def test_recent_checks_reloads_its_flags_when_a_new_check_arrives() -> None:
    """⚠️ "4 items flagged in this check" ABOVE AN EMPTY CARD (2026-08-28).
    The parent refetches `passes` when "Check the villa now" finishes, but
    `RecentChecks` fetched its flags, its pending queue and its concerns once,
    on mount — so every manual check drew a card whose own items were missing
    until the dialog was closed and reopened.

    The effect must therefore depend on something that CHANGES when a new
    check exists, not on the mount alone."""
    src = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    effect = re.search(r"useEffect\(\(\)\s*=>\s*\{\s*void load\(\);\s*\},\s*"
                        r"\[([^\]]*)\]\)", src)
    assert effect, "the flag-loading effect moved; this pin is blind"
    deps = effect.group(1)
    assert deps.strip() not in ("", "load"), (
        "RecentChecks still loads its flags on mount alone, so a check "
        "started from this dialog renders with no items under it")


def test_the_APP_never_shows_the_word_caretaker_either() -> None:
    """⚠️ THE THIRD TIME THIS RULE WAS BROKEN, AND THE FIRST IN THE UI. The
    owner's standing instruction is that this product says **Facility Manager**,
    because that is the profile name the kiosk uses everywhere else. It was
    applied to the brief renderer, then missed in `verify.EVIDENCE_TASK`, then
    missed again in 2.763.0 — a settings field labelled "Caretaker to-do list"
    and a whole new module written around the word.

    `test_inert` enforced it over `reports/` only, which is where the rule was
    born; nothing looked at the app at all. Two scans now, because a python AST
    walk cannot read TSX and a text scan of python would flag the twenty
    docstrings where `caretaker` is legitimate engineering shorthand.

    ⚠️ RENDERED TEXT AND LABELS, NOT COMMENTS — the header comments that RECORD
    this history name the word deliberately, and dry-audit Part 2 keeps them.
    """
    offenders = []
    for path, src in _tsx_sources():
        body = re.sub(r"\{?/\*[\s\S]*?\*/\}?", "", src)
        body = "\n".join(l for l in body.splitlines()
                         if not l.lstrip().startswith("//"))
        for n, line in enumerate(body.splitlines(), 1):
            if "caretaker" in line.lower():
                offenders.append(
                    f"{os.path.relpath(path, SRC)}:{n}: {line.strip()[:70]}")
    assert not offenders, (
        "the app says 'caretaker'; this product says Facility Manager:\n  "
        + "\n  ".join(offenders))


def test_the_reflex_tab_lists_ONLY_what_acts_by_itself() -> None:
    """⚠️ IT LISTED EVERY BLUEPRINT FAMILY, INCLUDING THE RETIRED ONES. Tier 0's
    whole definition is "acts on its own, in under a second, with no AI" — so
    `maintenance` and `roi`, which are retired DETECTION the assistant replaced,
    and `audit`, which is a channel test, have no business on that tab. Listing
    them invited the reader to think this tier still does the villa's detecting.
    Reported as confusing and irrelevant, and it was both."""
    src = _read(os.path.join(SRC, "components", "agent", "ReflexObserve.tsx"))
    code = "\n".join(l for l in src.splitlines()
                      if not l.strip().startswith("//"))
    assert "FAMILIES[cat]?.reflex" in code, (
        "the Reflex tab no longer filters to families that ACT, so retired "
        "detection rules are listed as things that act on their own")

    fam = _read(os.path.join(SRC, "components", "agent", "tiers.tsx"))
    # ⚠️ THE TWO THAT ACT. `critical` closes valves and sounds alarms; `control`
    # turns lights and fans on and off. Everything else only ever reported.
    for name in ("critical", "control"):
        block = fam[fam.index(f"  {name}: {{"):]
        assert "reflex: true" in block[:400], (
            f"{name} is no longer marked as a reflex, so it drops off the tab "
            "that exists to list what acts by itself")


def test_the_observe_tab_reads_the_JOURNAL_not_the_event_collector() -> None:
    """⚠️ THE TAB DESCRIBED A DIFFERENT SUBSYSTEM. It showed `collector`, which
    counts BLUEPRINT EVENTS (`vesta_*_event`, `telegram_text`) and is not
    subscribed to `state_changed` at all — under a heading claiming it was what
    the checks read. So a light turning on moved nothing, and the owner asked
    why. The checks read the JOURNAL: every entity polled on the observation
    cycle, every material change written down."""
    src = _read(os.path.join(SRC, "components", "agent", "ReflexObserve.tsx"))
    code = "\n".join(l for l in src.splitlines()
                      if not l.strip().startswith("//"))
    head = code[code.index("What the checks read"):]
    head = head[:head.index("</dl>")]
    assert "j?.entries" in head, (
        "the 'what the checks read' tiles no longer show the journal, so the "
        "screen is describing the blueprint-event collector again")
    assert "buffered" not in head, (
        "the collector's event buffer is back under a heading about what the "
        "checks read — those are different subsystems")


def test_the_triage_card_and_its_flags_share_ONE_clock() -> None:
    """⚠️ ONE CARD SHOWED TWO CLOCKS EIGHT HOURS APART (2026-08-27).

    `audit._now_iso` stamps every row in UTC (`%Y-%m-%dT%H:%M:%SZ`), which is
    the only sane thing to store. The FLAG rows rendered it through `whenOf`,
    so they read the viewer's local time; the CHECK heading printed the raw
    string with `T` swapped for a space. On a villa at UTC+8 that put
    `2026-08-27 03:35` as the heading of a card whose own flags said
    `27 Aug, 11:34`, and the owner reasonably reported the list as being out
    of ORDER. It was not — the checks were correctly newest-first, in UTC,
    which is invisible when half the card is in local time.

    ⚠️ PINNED AS "NO RAW STAMP REACHES THE SCREEN", NOT AS "whenOf IS CALLED".
    A test asserting the call site would pass the moment somebody added a
    second raw render elsewhere in the file, which is exactly how this arrived.
    """
    panel = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    # The fallback INSIDE whenOf is the one legitimate raw slice: an
    # unparseable stamp is better shown as itself than as "Invalid Date".
    body = panel[panel.index("const whenOf"):]
    body = body[body.index("\n};"):]
    offenders = re.findall(r'\breplace\("T", " "\)', body)
    assert not offenders, (
        "a timestamp is rendered raw (UTC) outside `whenOf`, so it will "
        "disagree with every other time on the same card by the viewer's "
        "UTC offset")
    assert "whenOf(pass.at)" in panel, (
        "the check heading no longer renders its time through the shared "
        "formatter, so it is back on a different clock from its flags")


def test_no_screen_points_the_reader_at_a_HEADING_that_was_deleted() -> None:
    """⚠️ A CROSS-SCREEN REFERENCE BY TITLE IS A PROMISE THE OTHER SCREEN KEEPS.

    The Triage summary told the reader that dealt-with concerns live "under
    'What came of them'" — a heading on the Reason tab. That heading was
    deleted on 2026-08-27 (it announced a second section where there is only a
    footer of counts), and nothing but a grep could have noticed the sentence
    on the OTHER tab going stale. Type-checking cannot see it; both files
    compile perfectly with one naming a heading the other no longer renders.

    Pinned as an equivalence, not as "the string is absent": if the heading
    ever comes back, pointing at it again is correct and this test says so.
    """
    def without_comments(src: str) -> str:
        """JSX `{/* … */}` blocks and `//` lines. ⚠️ BOTH, because the note
        RECORDING this deletion quotes the heading — a scan that read only one
        comment style would call the record itself a violation."""
        src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.DOTALL)
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
        return "\n".join(l for l in src.splitlines()
                         if not l.lstrip().startswith("//"))

    lifecycle = _read(os.path.join(SRC, "components", "agent",
                                   "ConcernLifecycle.tsx"))
    checks = _read(os.path.join(SRC, "components", "agent", "RecentChecks.tsx"))
    # The heading is RENDERED only if it appears outside a comment.
    rendered = re.search(r'settings-section-title">\s*What came of them',
                         without_comments(lifecycle)) is not None
    referenced = "What came of them" in without_comments(checks)
    assert referenced <= rendered, (
        "RecentChecks sends the reader to a heading ConcernLifecycle no longer "
        "renders — a screen describing another screen that has moved on")


def test_only_ACKNOWLEDGING_takes_a_concern_off_the_wall() -> None:
    """⚠️ THE OWNER'S RULING (2026-08-27), AFTER A THUMB UP EMPTIED THE CARD.

    The backend half is fixed in `concerns.feedback`; this is the screen half.
    A delivered concern stays on the list until somebody says they have SEEN
    it — no other verdict, opinion or count may remove it. Pinned on the
    predicate rather than on the JSX, because the filter is the rule.
    """
    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    assert "const needsAttention" in panel, (
        "the wall no longer has one predicate for 'is this still asking for "
        "attention', so the rule lives in whichever filter is read next")
    body = panel[panel.index("const needsAttention"):]
    body = body[:body.index(";")]
    assert "acknowledged_at" in body, (
        "acknowledgement is not what removes a card — some other verdict is")
    assert "setRows(found.filter(needsAttention)" in panel, (
        "the list is built from some other filter than the shared predicate")


def test_an_acknowledged_but_OPEN_concern_is_counted_not_dropped() -> None:
    """⚠️ "I HAVE SEEN IT" MUST NOT SILENTLY MEAN "IT IS GONE". Acknowledging
    is deliberately not resolving — `concerns.acknowledge` is emphatic that the
    villa keeps carrying the problem — so taking the card off the wall without
    counting it anywhere would lose it."""
    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    assert "setSeen(" in panel and "seen.length > 0" in panel, (
        "acknowledged-but-open concerns are dropped from the screen entirely")


def test_the_chase_line_matches_the_bands_the_BACKEND_actually_uses() -> None:
    """⚠️ A COPY OF A BACKEND TABLE, TOLERATED ONLY BECAUSE IT IS PINNED. The
    card predicts when an unacknowledged critical will be chased; the routing
    decision itself stays in `route.escalate`. If the two drift, the screen
    promises a time nothing will honour — which is worse than saying nothing.
    """
    import re as _re

    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    with open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                           "route.py"), encoding="utf-8") as handle:
        route = handle.read()
    # ⚠️ `[^"]+`, NOT `[a-z ]+`. The first draft of this scan read only two of
    # the three bands, because the third's label contains a COMMA ("every
    # configured target, once") — a pin that silently measured a subset and
    # reported the code as wrong. The instrument, not the code: this file's own
    # header records the same mistake being made with an end-marker regex.
    backend = [int(m) for m in _re.findall(r"\((\d+), \"[^\"]+\"\)", route)]
    shown = [int(m) for m in _re.findall(r"\[(\d+), \"", panel)]
    assert backend and shown, (backend, shown)
    assert shown == backend, (
        f"the card shows escalation bands {shown} but route.py uses {backend}")


def test_only_a_CRITICAL_shows_a_chase_time() -> None:
    """⚠️ `route.escalate`'s FIRST LINE refuses every severity below critical,
    so a countdown on a warning promises a chase that is never coming — the
    exact misreading the "What gets chased" hint had to be written to correct.
    """
    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    body = panel[panel.index("function chaseLine"):]
    body = body[:body.index("\n}")]
    assert 'severity) !== "critical"' in body and "return null" in body, (
        "the chase line is rendered for non-critical concerns, which are "
        "never chased")


def test_no_card_carries_a_chip_that_can_only_say_ONE_thing() -> None:
    """⚠️ A STATUS WITH ONE POSSIBLE VALUE IS DECORATION, NOT INFORMATION.

    The concern card showed a lifecycle chip to separate `open` from `acted` —
    "the single most useful thing to know about a concern that is still
    standing". Nothing in the backend has ever written `acted`: the string
    appears only in the enum that lists it. The wall shows live concerns only,
    so every card read "Nothing done yet", always, whatever anybody did — and
    on an informational row it contradicted the "nothing to do" mark beside it.

    ⚠️ PINNED ON THE PRODUCER, NOT ON THE JSX. The chip may legitimately return
    the day a transition to `acted` is implemented; what may not return is a
    chip rendering a state nothing can produce. So this fails if the card
    renders it WHILE the backend still writes only one live state.
    """
    import re as _re

    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    backend = ""
    for name in ("concerns.py", "outbox.py", "runtime.py"):
        with open(os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "agent",
                               name), encoding="utf-8") as handle:
            backend += handle.read()
    writes_acted = _re.search(r'transition\([^)]*"acted"', backend) is not None
    code = _re.sub(r"\{/\*[\s\S]*?\*/\}", "", panel)
    renders_chip = "<LifecycleChip" in code
    assert renders_chip <= writes_acted, (
        "the card renders a lifecycle chip, but nothing ever moves a concern "
        "off `open` — so it can only ever display one value")


def test_an_INFORMATIONAL_concern_can_still_be_cleared_from_the_wall() -> None:
    """⚠️ THE GATE THAT HID THE EYE ICON LEFT FYIs UNCLEARABLE (owner's
    instruction, 2026-08-27). It was justified by escalation — an FYI is never
    chased, so acknowledging "only records that it was pressed" — which was
    true of the CHASE and ignored what the press does on screen: since 2.808.0
    acknowledging is the one action that takes a card off the wall. Hiding it
    left informational concerns with no way off it at all."""
    panel = _read(os.path.join(SRC, "components", "agent", "AgentConcerns.tsx"))
    assert "canJudge && c.delivered_at && !c.informational" not in panel, (
        "the acknowledge button is hidden on informational concerns again, so "
        "they can never be cleared from the wall")
