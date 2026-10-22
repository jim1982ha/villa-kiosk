"""Every shipped text a person reads keeps the wording rules — ONE list, tests/wording.py (architecture review,
2026-10-22: "never Home Assistant", "no ' — '", "an automation, never a rule" were each a hand sweep of ~40 files).

What is read, each by what a person can be shown of it:
  - the Python files whose strings reach a person (test_no_platform_name.SPOKEN, PAGE_SPOKEN): their string literals,
    docstrings and log lines left out;
  - the Agent page (vesta_agent/ui/static: its JS string literals, its HTML text) and the HTML templates of the skills
    (the report page, the investigation page): their text, comments left out;
  - the skills' own words: every string value of their YAML files (a route's check, a report's words, a cleared note,
    a description, a command's label) and the description of each SKILL.md;
  - the Limits tab: what each limit says and what happens when it is reached.
A string with no space in it is a key, an id or a file name, never words. Every message the Telegram fake shows in the
whole suite is read too (tests/conftest.py).

⚠️ TEXT FOR THE AI ONLY IS EXEMPT BY NAME, NEVER SILENTLY: FOR_THE_AI lists each such piece with why.
"""
from __future__ import annotations

import glob
import os
import re

import yaml

from test_no_platform_name import PAGE, PAGE_SPOKEN, ROOT, SPOKEN, _front_matter, _spoken_strings, _without_comments
from wording import BANNED, broken

SKILLS = os.path.join(ROOT, "starter", "skills")

#: (file relative to agent-src, the text's start) → why a person never reads it. Matched on the text's beginning.
FOR_THE_AI: dict[tuple[str, str], str] = {
    ("starter/skills/reports/reports.yaml", "Home Assistant starting"):
        "matched against the logbook's own words (an older system's start), never shown",
}


def _words(s: str) -> bool:
    return bool(re.search(r"\s", s))


def _js_strings(src: str):
    """(line, text) of every string literal of a JS source with its comments blanked: what the page can show."""
    for m in re.finditer(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`(?:\\.|[^`\\])*`', src, flags=re.S):
        yield src.count("\n", 0, m.start()) + 1, m.group(0)[1:-1]


def _html_text(src: str):
    """(line, text) of each piece of text an HTML page or template shows: comments, scripts and styles left out; a tag,
    template code or a {place:key} placeholder ends a piece (a "—" alone in a cell is no " — " between words)."""
    src = re.sub(r"\{#.*?#\}|<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"<script[^>]*>.*?</script>|<style[^>]*>.*?</style>", lambda m: "\n" * m.group(0).count("\n"), src,
                 flags=re.S)
    for n, line in enumerate(src.split("\n"), 1):
        for piece in re.split(r"\{\{.*?\}\}|\{%.*?%\}|<[^>]*>|\{\w+:\w+\}", line):
            if piece.strip():
                yield n, piece.strip()


def _yaml_strings(node, where=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _yaml_strings(v, f"{where}.{k}" if where else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _yaml_strings(v, f"{where}[{i}]")
    elif isinstance(node, str):
        yield where, node


def texts():
    """(file, where, text) of every shipped text a person reads."""
    for p in SPOKEN + PAGE_SPOKEN:
        for line, text in _spoken_strings(p):
            yield p, line, text
    for name in sorted(os.listdir(PAGE)):
        path = os.path.join(PAGE, name)
        rel = os.path.relpath(path, ROOT)
        if name.endswith(".js"):
            for line, text in _js_strings(_without_comments(open(path, encoding="utf-8").read())):
                yield rel, line, text
        elif name.endswith(".html"):
            src = open(path, encoding="utf-8").read()
            for line, text in _html_text(src):
                yield rel, line, text
            for m in re.finditer(r"<script[^>]*>(.*?)</script>", src, flags=re.S):
                for line, text in _js_strings(_without_comments(m.group(1))):
                    yield rel, line, text
    for path in sorted(glob.glob(os.path.join(SKILLS, "*", "templates", "*.html"))):
        for line, text in _html_text(open(path, encoding="utf-8").read()):
            yield os.path.relpath(path, ROOT), line, text
    for path in sorted(glob.glob(os.path.join(SKILLS, "*", "*.yaml"))):
        for where, text in _yaml_strings(yaml.safe_load(open(path, encoding="utf-8")) or {}):
            yield os.path.relpath(path, ROOT), where, text
    for path in sorted(glob.glob(os.path.join(SKILLS, "*", "SKILL.md"))):
        yield os.path.relpath(path, ROOT), "description", str(_front_matter(path).get("description") or "")
    from vesta_shared.limits import scan
    for d in scan([os.path.join(ROOT, d) for d in ("vesta_shared", "vesta_agent", "starter")])[0].values():
        for part in ("says", "reached"):
            yield f"limit {d.key}", part, getattr(d, part)


def _exempt(path: str, text: str) -> bool:
    return any(path == p and text.startswith(start) for p, start in FOR_THE_AI)


def test_every_text_a_person_reads_keeps_the_wording_rules():
    hits = [f"{path}:{where}: {', '.join(b)}: {text.strip()[:90]!r}"
            for path, where, text in texts() if _words(text) and not _exempt(path, text) and (b := broken(text))]
    assert hits == [], "\n".join(hits)


def test_the_list_is_read_in_every_kind_of_text():
    # each kind of source is really read (an empty source would pass any rule)
    seen = {p.split("/")[0] if not p.startswith("limit ") else "limit" for p, _, _ in texts()}
    assert {"starter", "vesta_agent", "vesta_shared", "limit"} <= seen, seen
    kinds = {os.path.splitext(p)[1] for p, _, _ in texts()}
    assert {".py", ".js", ".html", ".yaml", ".md"} <= kinds, kinds
    assert len(BANNED) >= 3
    # each exemption still names a text that is there (one left behind would hide nothing, and lie)
    assert all(any(p == path and t.startswith(s) for path, _, t in texts()) for p, s in FOR_THE_AI)


def test_one_rule_is_one_line():
    # a new rule is one line in tests/wording.py: each pattern says what it bans, and finds it
    for text, rule in [("Home Assistant restarted", "the platform's name"), ("on, then off — twice", "a long dash"),
                       ("the villa's low-battery rule fired", "an automation called a rule")]:
        assert [b for b in broken(text) if b.startswith(rule)], text
    for text in ["Refused by the agent's rules.", "Agent rules", "Rules tab", "rules.yaml", "rule_id", "Ha, a shark."]:
        assert broken(text) == [], text

