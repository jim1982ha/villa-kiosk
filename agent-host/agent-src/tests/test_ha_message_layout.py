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

from vesta_shared.message_format import STATUS, TELEGRAM, document, parts, status_head

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
    tail = f"{status_head()}{_styled(status.strip(), 'note')}" if status.strip() else ""
    return "\n".join(lines) + tail


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


def test_to_is_a_role_the_rule_names_else_every_role_as_an_alert_card_says_it():
    # owner, 2026-10-13: a role — never a name. Architecture review, 2026-10-17: said as the agent's alert card says it
    # ("Owner & FM"), however the rule wrote it. Owner, 2026-11-03: the villa-wide "VESTA alert audience" helper is
    # gone (who each role IS is the villa's two lists, read by the blueprints): a rule naming nobody is for every role,
    # whatever the villa holds
    from vesta_shared.message_format import ROLE_SHORT, ROLE_WORDS, audience
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', r, 'x', '' -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    t = _env().from_string(src)
    to = lambda roles: f"\nTo: {html.escape(audience(roles, short=True))}\n"
    old_helper = lambda e: audience({"fm"}) if e == "input_text.vesta_alert_audience" else "unknown"
    for roles in ({"owner"}, {"fm"}, {"owner", "fm"}):
        for words in (ROLE_WORDS, ROLE_SHORT):
            for joined in (" & ", ", ", ","):
                written = joined.join(w for r, w in words.items() if r in roles)
                assert to(roles) in t.render(r=written, states=old_helper), written
                assert to(roles) in t.render(r=written.upper()), written
    every = to({"owner", "fm"})
    assert every in t.render(r="", states=old_helper)                           # the retired helper is not read
    assert every in t.render(r="JM, Fabien")                                    # a name is never written
    assert every in t.render(r="")


def test_the_templates_words_are_written_from_the_agents_never_by_hand():
    # architecture review, 2026-10-17: the file kept its own copy of the roles, icons and words — it said "Facility
    # Manager" a day after alert cards said "FM". Its words block is message_format.jinja_words, whole
    from vesta_shared.message_format import JINJA_BEGIN, JINJA_END, jinja_words
    with open(os.path.join(HA, "custom_templates", "vesta_message.jinja"), encoding="utf-8") as f:
        src = f.read()
    block = src[src.index(JINJA_BEGIN):src.index(JINJA_END) + len(JINJA_END)]
    assert block == jinja_words(), "run: python -m vesta_shared.message_format"
    rest = src.replace(block, "")
    # owner, 2026-10-19: whom a priority reaches ("P1" → the roles), the closing words and the clock's format are the
    # agent's too — and the press's labels and its hand-written date went with the press
    for word in ("Facility Manager", "'FM'", '"FM"', "New alert", "Still open", "pressed by", "⚠️", "✅", "🆘",
                 "P1", "'digest'", "Cleared", "Closed", "%d", "%H", "'Done'", "Need help"):
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


def _status(stage, status="", at=None) -> str:
    """The bottom line the file writes for a rule that gives its stage (vm_stage), in plain text; `at`: the villa's
    clock (now()), absent outside Home Assistant."""
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', 'R', 'x', s -%}{%- set vm_stage = g -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    out = _env().from_string(src).render(s=status, g=stage, **({"now": lambda: at} if at else {}))
    return html.unescape(re.sub(r"</?(b|blockquote|i)>", "", out)).split(f"\n{STATUS}:\n", 1)[1]


def test_the_bottom_line_is_said_in_the_agents_own_words_for_every_stage():
    # architecture review, 2026-10-13: the same Done read "✅ Done - JM" on a job Home Assistant sent and "✅ Done pressed
    # by JM on 12/10/2026 17:13." on the agent's alerts — Home Assistant copied the words by hand into every rule
    from datetime import datetime, timezone
    from vesta_agent.layout import fill_time, stage_line
    head = {"new": "#1-P2 (new)", "existing": "#1-P2 (existing)", "closed": "#1-P2 (closed)"}
    at = datetime(2026, 10, 13, 9, 2, tzinfo=timezone.utc)
    for stage in head:
        for status in ("", "Still not clear after 30 min: no longer tracking this incident"):
            # the agent fills "{time}" before it lays a message out (posting, the thread's close): the same moment
            said = stage_line(head[stage], fill_time(status or _words(stage), at, "UTC"))
            assert _status(stage, status, at) == said, (stage, status)
    assert _status("", "⚠️ written by hand") == "⚠️ written by hand"         # a rule saved before: as it is


def _words(stage):
    from vesta_shared.message_format import STAGE_WORDS
    return STAGE_WORDS[stage]


def test_an_all_clear_says_the_agents_closing_with_the_villas_clock():
    # owner, 2026-10-19 (one closing wording, recommended and approved): the villa's own all-clear said "Resolved after
    # 12 min", "Cleared just inside the 30 min limit…" or no status at all, the desk "Cleared on …" / "Closed on …". A
    # rule now gives the stage alone; the file writes the desk's words with its own clock, as the desk's end reads them
    from datetime import datetime, timezone
    from vesta_shared.message_format import STAGE_WORDS, closing
    from vesta_shared.timeutil import moment_label
    at = datetime(2026, 10, 19, 14, 5, tzinfo=timezone.utc)
    assert STAGE_WORDS["closed"] == closing()
    assert _status("closed", "", at) == "✅ " + closing().replace("{time}", moment_label(at, "UTC"))
    assert _status("closed", "", at) == "✅ Cleared on 19/10/2026 14:05."
    assert _status("closed") == "✅ Cleared."                     # no clock (never in Home Assistant): no "{time}"


def _desk():
    import importlib.util
    from helpers import STARTER_SKILLS
    spec = importlib.util.spec_from_file_location("desk_for_jinja", os.path.join(STARTER_SKILLS, "alert-desk",
                                                                                 "scripts", "desk.py"))
    desk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(desk)
    return desk


def test_to_follows_the_priority_by_the_alert_desks_own_table():
    # owner, 2026-10-19 (recommended and approved): every critical blueprint wrote "P1 → Owner, Facility Manager, else
    # Facility Manager" by hand, so a changed people_roles made the villa's first message say one "To:" and the
    # agent's rewrite another a second later. A rule passes its priority; the file says whom the desk reaches with it
    # (desk.reaches), as the agent's card does — the roles, else what the priority does ("To: digest", 0.12.265)
    from vesta_shared.message_format import audience
    from vesta_shared.result import PRIORITIES
    desk = _desk()
    src = ("{%- set vm_title, vm_to, vm_text, vm_status = 'T', r, 'x', '' -%}{%- set vm_priority = p -%}"
           "{% include 'vesta_message.jinja' ignore missing %}")
    t = _env().from_string(src)
    helper = lambda e: "Owner" if e == "input_text.vesta_alert_audience" else "unknown"
    for p in PRIORITIES:
        reached = desk.reaches(p)
        roles = [r for r in reached if r in ("owner", "fm")]
        said = audience(roles, short=True) if roles else reached[0]
        for given in (p, p.lower(), f" {p} "):
            assert t.render(r="", p=given, states=helper).split("\n")[1] == f"To: {html.escape(said)}", (p, given)
    assert [t.render(r="", p=p).split("\n")[1] for p in PRIORITIES] == \
        ["To: Owner &amp; FM", "To: FM", "To: digest", "To: log"]
    # no priority (a notice names its own "To:", or names nobody: every role)
    assert t.render(r="", p="agent", states=helper).split("\n")[1] == "To: Owner &amp; FM"
    assert t.render(r="FM", p="").split("\n")[1] == "To: FM"
    assert t.render(r="Owner", p="").split("\n")[1] == "To: Owner"
    assert _env().from_string("{%- set vm_title, vm_to, vm_text, vm_status = 'T', 'Owner', 'x', '' -%}"
                              "{% include 'vesta_message.jinja' ignore missing %}").render().split("\n")[1] == "To: Owner"


def test_the_priority_table_is_read_from_the_alert_desks_settings_never_typed(tmp_path, monkeypatch):
    # skills before code: a villa whose desk sends P2 to the owner too reads it so in the template's words
    import vesta_shared.message_format as mf
    with open(mf.ALERT_DESK_RULES, encoding="utf-8") as f:
        rules = yaml.safe_load(f)
    rules["people_roles"]["owner"] = ["P1", "P2"]
    rules["priority_does"]["P4"] = "digest"
    alt = tmp_path / "rules.yaml"
    alt.write_text(yaml.safe_dump(rules), encoding="utf-8")
    monkeypatch.setattr(mf, "ALERT_DESK_RULES", str(alt))
    assert '"P2": "Owner & FM"' in mf.jinja_words() and '"P4": "digest"' in mf.jinja_words()


def test_the_stage_marks_are_the_agreements_one_for_every_title_word():
    # review Q 3 (2026-10-28): the Kiosk reads an announcement's stage back from these marks; both read the agreement
    import json
    from pathlib import Path
    from vesta_shared.message_format import STAGE_ICONS, STEPS
    path = Path(__file__).resolve().parents[2] / "rootfs" / "opt" / "vesta" / "host" / "agent-contract.json"
    marks = {k: v for k, v in json.loads(path.read_text(encoding="utf-8"))["stageMarks"].items() if not k.startswith("_")}
    assert STAGE_ICONS == marks
    # every word a title can say has its mark (notice.Notices.word: a step's title word, "existing", "watch", "closed")
    assert {s.title for s in STEPS.values()} | {"existing", "watch", "closed"} <= set(STAGE_ICONS)


def test_every_rule_sends_to_the_chats_of_its_priority_written_once_from_the_alert_desks_table():
    # owner, 2026-11-04 ("do this consistently"; then "keep the configuration how it was before", "Follow VESTA Agent
    # skill" kept): 8 blueprints kept their own "P1 the owner and the facility manager" table. The villa's sensor holds
    # each priority's chats and what Follow means, written from the desk's people_roles and routes
    from vesta_shared import villa_recipients
    from vesta_shared.message_format import FOLLOW_PRIORITY, PACKAGE_BEGIN, PACKAGE_END, package_chats
    path = os.path.join(HA, "packages", "vesta_message.yaml")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    assert src[src.index(PACKAGE_BEGIN):src.index(PACKAGE_END) + len(PACKAGE_END)] == package_chats(), \
        "run: python -m vesta_shared.message_format"
    (sensor,) = [s for t in yaml.safe_load(src)["template"] for s in t.get("sensor", [])
                 if s["unique_id"] == "vesta_chats_by_priority"]
    owner, fm = villa_recipients.HELPERS["owner"], villa_recipients.HELPERS["fm"]
    lists = {owner: "notify.Example_Group, light.x, notify.gone", fm: " notify.example_a,notify.example_b , notify.example_a"}

    class States:
        notify = [{"entity_id": e} for e in ("notify.example_group", "notify.example_a", "notify.example_b")]

        def __call__(self, e):
            return lists.get(e, "unknown")
    env = _env()
    env.tests["match"] = lambda v, pattern: re.match(pattern, str(v)) is not None      # Home Assistant's own test
    env.globals["integration_entities"] = lambda d: ["notify.example_group", "notify.example_a", "sensor.x"] \
        if d == "telegram_bot" else []
    render = lambda p: env.from_string(sensor["attributes"][p]).render(states=States())
    desk = _desk()
    assert desk.recipients("P1") == ["owner", "fm"] and desk.recipients("P2") == ["fm"]
    assert [render(p) for p in ("P1", "P2", "P3", "P4")] == [
        "['notify.example_group', 'notify.example_a', 'notify.example_b']", "['notify.example_a', 'notify.example_b']",
        "[]", "[]"]
    lists[fm] = "light.x, notify., nonsense"                   # nobody set (or nothing valid): every Telegram chat
    assert render("P2") == "['notify.example_group', 'notify.example_a']"
    lists.clear()
    assert render("P1") == render("P2") == "['notify.example_group', 'notify.example_a']"
    # ⚠️ NEITHER THE KIOSK APP NOR THE AGENT IN AN ALERT'S PATH (owner, 2026-11-04: "I am concerned … that makes VESTA
    # KIOSK in the critical path"): the sensor reads the villa's two lists, its notify entities and its Telegram chats
    read = set(re.findall(r"[a-z_]+\.[a-z0-9_]+", " ".join(v for k, v in sensor["attributes"].items() if k != "follow")))
    assert read - {"ns.t", "states.notify"} <= {owner, fm}, read
    # "Follow the VESTA Agent skill": the villa's answer is the desk's (route_for), for every kind and by name; its own
    # P1-P4 wins; the sensor missing, P1 (everyone)
    import ast
    follow = ast.literal_eval(env.from_string(sensor["attributes"]["follow"]).render())

    class This:
        def __init__(self, eid):
            self.entity_id = eid

    def villa(given, blueprint, rule, table):
        t = env.from_string(FOLLOW_PRIORITY.replace("{blueprint}", blueprint))
        return t.render(vesta_priority=given, this=This(rule), state_attr=lambda e, a: table)
    kinds = [r["blueprint"] for r in desk.RULES["routes"] if r.get("blueprint")] + ["audit_coverage", "roi_runtime_cap"]
    for bp in kinds:
        for rule in (f"automation.{bp}---x", "automation.critical_other---x", "automation.other---x"):
            assert villa("follow", bp, rule, follow) == desk.priority({}, desk.route_for(rule, bp)), (bp, rule)
    assert villa("p3", "critical_binary_trip", "automation.x", follow) == "P3"
    assert villa("follow", "critical_condition", "automation.x", None) == "P1"


def test_the_villas_visit_words_are_the_desks_written_once_into_the_visit_package():
    # owner, 2026-11-06 (one visit, one story): while VESTA is away the villa's presence automation writes a visit
    # itself, in the desk's English. A blueprint cannot read a variable set inside the template it includes, so the
    # words are the attributes of the package's "VESTA visit words" sensor, written by message_format — never by hand
    import ast
    from vesta_shared.message_format import (JINJA_BEGIN, JINJA_END, VISIT_BEGIN, VISIT_END, VISIT_WORDS,
                                             package_visit_words)
    from vesta_shared.timeutil import MOMENT_FORMAT
    path = os.path.join(HA, "packages", "vesta_visit.yaml")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    assert src[src.index(VISIT_BEGIN):src.index(VISIT_END) + len(VISIT_END)] == package_visit_words(), \
        "run: python -m vesta_shared.message_format"
    (sensor,) = [s for t in yaml.safe_load(src)["template"] for s in t.get("sensor", [])
                 if s["unique_id"] == "vesta_visit_words"]
    def native(text):                     # what Home Assistant keeps of a rendered attribute: its value's type
        try:
            return ast.literal_eval(text)
        except (ValueError, SyntaxError):
            return text
    got = {k: native(_env().from_string(v).render()) for k, v in sensor["attributes"].items()}
    skills = os.path.join(os.path.dirname(__file__), "..", "starter", "skills", "alert-desk")
    with open(os.path.join(skills, "words.yaml"), encoding="utf-8") as f:
        words = yaml.safe_load(f)
    with open(os.path.join(skills, "skill.yaml"), encoding="utf-8") as f:
        buttons = yaml.safe_load(f)["buttons"]
    assert got["words"] == {k: words[k]["en"] for k in VISIT_WORDS}
    assert {"visit_title_opened", "visit_noted"} <= set(got["words"]), "the two words only the villa writes"
    assert got["buttons"] == [[b["option"], b["label"]] for b in buttons], "the desk's buttons, in its order"
    assert got["closes"] == [b["option"] for b in buttons if b.get("closes")] == ["done", "not_a_problem"]
    assert got["pressed"] == {"done": "Done on Telegram", "not_a_problem": "Not a problem on Telegram",
                              "open_ticket": "Ticket opened on Telegram", "need_help": "Need help on Telegram"}
    assert got["moment"] == MOMENT_FORMAT
    # ONE mechanism: the template no longer carries a copy the blueprint could never read
    with open(os.path.join(HA, "custom_templates", "vesta_message.jinja"), encoding="utf-8") as f:
        jinja = f.read()
    assert "visit" not in jinja[jinja.index(JINJA_BEGIN):jinja.index(JINJA_END)]
