"""The layout Home Assistant draws its own alerts with (homeassistant/custom_templates/vesta_message.jinja) is the
agent's: the same text as message_format.document and the same styles as its one style table, TELEGRAM.

Owner, 2026-10-12: the alerts a blueprint sends must look like the agent's — and must never depend on the agent being
there (so Home Assistant formats them itself, with Telegram's HTML). Two renderers, one layout: this test fails when
either side changes alone. The check sensor (homeassistant/packages/vesta_message.yaml) is held to the file too: a
blueprint sends the formatted alert only while it reads "ok".
"""
from __future__ import annotations

import html
import os
import re

import jinja2
import yaml
from jinja2.sandbox import ImmutableSandboxedEnvironment

from vesta_shared.message_format import STATUS, TELEGRAM, document, parts

HA = os.path.join(os.path.dirname(__file__), "..", "homeassistant")
#: Telegram's HTML tag for each MessageEntity type the style table names.
TAG = {"bold": "b", "blockquote": "blockquote", "italic": "i"}


def _env() -> jinja2.Environment:
    # Home Assistant renders templates in an immutable sandbox: a method or filter it refuses fails here too
    return ImmutableSandboxedEnvironment(loader=jinja2.FileSystemLoader(os.path.join(HA, "custom_templates")))


def _render(title, to, text, status) -> str:
    """The file drawn as a blueprint draws it: its variables set, then included."""
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = t, r, x, s -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    return _env().from_string(src).render(t=title, r=to, x=text, s=status)


def _styled(text: str, kind: str) -> str:
    out = html.escape(text, quote=False)
    for style in reversed(TELEGRAM[kind]):          # the table's first style is the outermost tag
        out = f"<{TAG[style]}>{out}</{TAG[style]}>"
    return out


def _expected(title, to, text, status) -> str:
    """The agent's layout of the same message in Telegram's HTML: its text is message_format.document's, each part
    styled by TELEGRAM (an alert's text is ONE quote, whatever it says: review 28)."""
    lines = [_styled(title.strip(), "title"), html.escape(f"To: {to}".rstrip(), quote=False)]
    if text.strip():
        lines.append(_styled(text.strip(), "item"))
    if status.strip():
        lines += ["", f"{STATUS}:", _styled(status.strip(), "note")]
    return "\n".join(lines)


CASES = [
    ("🔥 Mains phase overload", "Owner & FM", "Main Power Phase C 4450 W\nAbove 4000 W, Held 15 min",
     "⚠️ New alert"),
    ("✅ Entrance door unlocked", "Owner", "Entrance door is locked", "✅ Resolved after 12 min"),
    ("T <1> & co", "FM", "a < b > c & d", "s & <i>"),             # escaped once, never twice
    ("Only a title", "Owner", "", ""),
    ("No text", "Owner", "", "⚠️ New alert"),
]


def test_home_assistants_layout_is_the_agents_layout_and_style():
    for title, to, text, status in CASES:
        got = _render(title, to, text, status)
        assert got == _expected(title, to, text, status), (title, got)
        # the words without the tags are exactly the agent's layout
        plain = html.unescape(re.sub(r"</?(b|blockquote|i)>", "", got))
        assert plain == document(title, to, [(None, [text]), (STATUS, [status])]), plain


def test_the_styles_are_the_ones_the_agent_finds_in_the_same_text():
    # the agent reads its parts back from the plain text (title, "To:", the alert, "Status:", the note): the tags the
    # file draws sit over exactly those parts
    title, to, text, status = CASES[0]
    plain = document(title, to, [(None, [text]), (STATUS, [status])])
    kinds = [k for k, _, _ in parts(plain)]
    assert kinds == ["title", "to", "item", "label", "note"]
    for kind, start, end in parts(plain):
        piece = plain[start:end]
        assert (_styled(piece, kind) if TELEGRAM[kind] else html.escape(piece, quote=False)) in _render(*CASES[0])


def test_to_is_a_role_the_rules_own_else_the_villa_wide_audience_as_an_alert_card_says_it():
    # owner, 2026-10-12: "To:" is set in ONE place for every alert (input_text.vesta_alert_audience); a rule that names
    # its own audience keeps it. Owner, 2026-10-13: a role — never a name. Architecture review, 2026-10-17: said as the
    # agent's alert card says it ("Owner & FM"), however the rule or the helper wrote it — the villa's helper reads
    # "Owner, Facility Manager", which drew "Owner & Facility Manager", then the agent's edit "Owner & FM"
    from vesta_shared.message_format import ROLE_SHORT, ROLE_WORDS, audience
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', r, 'x', '' -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    t = _env().from_string(src)
    to = lambda roles: f"\nTo: {html.escape(audience(roles, short=True))}\n"
    fm = audience({"fm"})
    helper = lambda e: fm if e == "input_text.vesta_alert_audience" else "unknown"
    for roles in ({"owner"}, {"fm"}, {"owner", "fm"}):
        for words in (ROLE_WORDS, ROLE_SHORT):
            for joined in (" & ", ", ", ","):
                written = joined.join(w for r, w in words.items() if r in roles)
                assert to(roles) in t.render(r=written, states=helper), written
                assert to(roles) in t.render(r=written.upper(), states=helper), written
                assert to(roles) in t.render(r="", states=lambda e: written), written      # the villa-wide helper
    every = to({"owner", "fm"})
    assert to({"fm"}) in t.render(r="", states=helper)
    assert every in t.render(r="JM, Fabien", states=helper)                     # a name is never written
    assert every in t.render(r="", states=lambda e: "unknown")
    assert every in t.render(r="")                                              # no states() at all (not HA)


def test_the_templates_words_are_written_from_the_agents_never_by_hand():
    # architecture review, 2026-10-17: the file kept its own copy of the roles, icons and words — it said "Facility
    # Manager" a day after alert cards said "FM". Its words block is message_format.jinja_words, whole
    from vesta_shared.message_format import JINJA_BEGIN, JINJA_END, jinja_words
    with open(os.path.join(HA, "custom_templates", "vesta_message.jinja"), encoding="utf-8") as f:
        src = f.read()
    block = src[src.index(JINJA_BEGIN):src.index(JINJA_END) + len(JINJA_END)]
    assert block == jinja_words(), "run: python -m vesta_shared.message_format"
    rest = src.replace(block, "")
    for word in ("Facility Manager", "'FM'", '"FM"', "New alert", "Still open", "pressed by", "⚠️", "✅", "🆘"):
        assert word not in rest.split("-#}", 1)[1], f"{word!r} is written by hand outside the words block"


def test_a_missing_file_draws_nothing_so_the_blueprint_sends_plain_text():
    src = "{% include 'no_such_file.jinja' ignore missing %}"
    assert _env().from_string(src).render() == ""


def test_the_check_sensor_reads_ok_with_this_file_and_missing_without_it(tmp_path):
    with open(os.path.join(HA, "packages", "vesta_message.yaml"), encoding="utf-8") as f:
        pkg = yaml.safe_load(f)
    (sensor,) = pkg["template"][0]["sensor"]
    state = sensor["state"]
    assert _env().from_string(state).render() == "ok"
    empty = jinja2.Environment(loader=jinja2.FileSystemLoader(str(tmp_path)))
    assert empty.from_string(state).render() == "missing"
    (tmp_path / "vesta_message.jinja").write_text("<b>{{ vm_title }}</b>", encoding="utf-8")
    assert empty.from_string(state).render() == "changed"


def _status(stage, status="", who="", at=None) -> str:
    """The bottom line the file writes for a rule that gives its stage (vm_stage), in plain text."""
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', 'R', 'x', s -%}{%- set vm_stage, vm_who = g, w -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    out = _env().from_string(src).render(s=status, g=stage, w=who, **({"now": lambda: at} if at else {}))
    return html.unescape(re.sub(r"</?(b|blockquote|i)>", "", out)).split(f"\n{STATUS}:\n", 1)[1]


def test_the_bottom_line_is_said_in_the_agents_own_words_for_every_stage():
    # architecture review, 2026-10-13: the same Done read "✅ Done - JM" on a job Home Assistant sent and "✅ Done pressed
    # by JM on 12/10/2026 17:13." on the agent's alerts — Home Assistant copied the words by hand into every rule
    from datetime import datetime, timezone
    from vesta_agent.layout import stage_line
    from vesta_shared.message_format import PRESSED
    from vesta_shared.timeutil import moment_label
    head = {"new": "#1-P2 (new)", "existing": "#1-P2 (existing)", "closed": "#1-P2 (closed)", "help": "#1-P2 (existing)"}
    mark = {"help": "help"}
    for stage in head:
        for status in ("", "Reminder: no answer after 15 min"):
            if stage == "help" and not status:
                continue                                            # Need help is always said (who, or what to do)
            assert _status(stage, status) == stage_line(head[stage], status, mark.get(stage)), (stage, status)
    at = datetime(2026, 10, 13, 9, 2, tzinfo=timezone.utc)
    for stage, label in (("closed", "Done"), ("help", "Need help")):
        said = PRESSED.format(label=label, name="JM", time=moment_label(at, "UTC"))
        assert _status(stage, "", "JM", at) == stage_line(head[stage], said, mark.get(stage))
        assert _status(stage, "Tick it on the Jobs tab.", "JM", at) == \
            stage_line(head[stage], f"{said} Tick it on the Jobs tab.", mark.get(stage))
    assert _status("closed", "", "JM", at) == "✅ Done on 13/10/2026 09:02 (JM)."
    assert _status("", "⚠️ written by hand") == "⚠️ written by hand"         # a rule saved before: as it is
