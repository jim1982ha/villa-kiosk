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

from vesta_shared.message_format import STATUS, TELEGRAM, document, parts

HA = os.path.join(os.path.dirname(__file__), "..", "homeassistant")
#: Telegram's HTML tag for each MessageEntity type the style table names.
TAG = {"underline": "u", "blockquote": "blockquote", "italic": "i"}


def _env() -> jinja2.Environment:
    return jinja2.Environment(loader=jinja2.FileSystemLoader(os.path.join(HA, "custom_templates")))


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
    ("🔥 Mains phase overload", "Owner, Facility Manager", "Main Power Phase C 4450 W\nAbove 4000 W, Held 15 min",
     "⚠️ New alert"),
    ("✅ Entrance door unlocked", "Owner", "Entrance door is locked", "✅ Resolved after 12 min"),
    ("T <1> & co", "R", "a < b > c & d", "s & <i>"),             # escaped once, never twice
    ("Only a title", "Owner", "", ""),
    ("No text", "Owner", "", "⚠️ New alert"),
]


def test_home_assistants_layout_is_the_agents_layout_and_style():
    for title, to, text, status in CASES:
        got = _render(title, to, text, status)
        assert got == _expected(title, to, text, status), (title, got)
        # the words without the tags are exactly the agent's layout
        plain = html.unescape(re.sub(r"</?(u|blockquote|i)>", "", got))
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


def test_to_is_the_rules_own_else_the_villa_wide_audience_else_the_roles():
    # owner, 2026-10-12: "To:" is set in ONE place for every alert (input_text.vesta_alert_audience); a rule that names
    # its own audience keeps it; without the helper (or before HA has it) the roles
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', r, 'x', '' -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    t = _env().from_string(src)
    helper = lambda e: "JM, Fabien" if e == "input_text.vesta_alert_audience" else "unknown"
    assert "\nTo: Owner\n" in t.render(r="Owner", states=helper)
    assert "\nTo: JM, Fabien\n" in t.render(r="", states=helper)
    assert "\nTo: Owner, Facility Manager\n" in t.render(r="", states=lambda e: "unknown")
    assert "\nTo: Owner, Facility Manager\n" in t.render(r="")                  # no states() at all (not HA)


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
