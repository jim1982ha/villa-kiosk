"""What a person reads from the VESTA Agent never names the platform underneath (owner, 2026-10-15: "never mention
Home Assistant" — the Kiosk's screens first, then Telegram). Every string literal of the files whose words reach a
person — Telegram messages, the Kiosk's fault notes, report pages, answers to a press or a request, the model's own
rules to speak by — is read with the code's docstrings and its log lines left out; "Home Assistant" or "HA" in one
fails, naming file and line. A rule FOR the model about Home Assistant (its data, its tools) is not text a person reads:
the instructions are checked only on what they tell the model to SAY."""
from __future__ import annotations

import ast
import os
import re

import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPOKEN = [
    "starter/skills/alert-desk/scripts/desk.py", "starter/skills/preventive-maintenance/scripts/recheck.py",
    "starter/skills/villa-concierge/scripts/voice.py", "starter/skills/investigate/scripts/investigation_facts.py",
    "starter/skills/roi-energy/scripts/proposals.py", "starter/skills/roi-energy/scripts/energy_period.py",
    "vesta_agent/actions.py", "vesta_agent/api_errors.py",
    "vesta_shared/kiosk_words.py", "vesta_shared/result.py", "vesta_agent/notice.py", "vesta_agent/layout.py",
]
NAMED = re.compile(r"Home\s+Assistant|\bHA\b")
LOGS = {"log", "logger", "debug", "info", "warning", "error", "exception", "critical"}


def _spoken_strings(path: str):
    tree = ast.parse(open(os.path.join(ROOT, path), encoding="utf-8").read())
    skip = set()
    for node in ast.walk(tree):
        # docstrings
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body \
                and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant):
            skip.add(id(node.body[0].value))
        # log lines: log.info("…"), state.log("…")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LOGS:
            for sub in ast.walk(node):
                skip.add(id(sub))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            yield node.lineno, node.value


def test_no_text_a_person_reads_names_home_assistant():
    hits = [f"{p}:{line}: {text[:60]!r}" for p in SPOKEN for line, text in _spoken_strings(p) if NAMED.search(text)]
    assert hits == [], hits


def test_the_sent_yaml_texts_and_the_models_speaking_rule():
    rules = yaml.safe_load(open(os.path.join(ROOT, "starter/skills/alert-desk/rules.yaml"), encoding="utf-8"))
    checks = [r.get("check") or "" for r in rules["routes"]]
    words = yaml.safe_load(open(os.path.join(ROOT, "starter/skills/reports/reports.yaml"), encoding="utf-8"))
    said = checks + [str(v) for v in (words.get("incident_words") or {}).values()]
    assert not [s for s in said if NAMED.search(s)]
    rules_text = open(os.path.join(ROOT, "starter/config/instructions.md"), encoding="utf-8").read()
    assert 'Never name Home Assistant (or HA) to a person: say "the villa\'s system".' in rules_text
    assert "say which Home Assistant helper" not in rules_text


#: The Agent's page: every file the browser shows a person (its JS and HTML), read without its code comments.
PAGE = os.path.join(ROOT, "vesta_agent", "ui", "static")
#: The page's words served from Python: the place names (tabs and titles), the tools' lines, the sign-in refusal.
PAGE_SPOKEN = ["vesta_agent/places.py", "vesta_agent/tool_access.py", "vesta_agent/ui/server.py"]


def _without_comments(src: str, html: bool = False) -> str:
    """The text of a JS (or HTML) file with its comments blanked — what the browser can show a person. Strings and
    template literals are kept whole: a "//" inside one (a URL) is no comment."""
    if html:
        src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
        return re.sub(r"(<script[^>]*>)(.*?)(</script>)", lambda m: m[1] + _without_comments(m[2]) + m[3], src, flags=re.S)
    out, i, n, quote = [], 0, len(src), None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == quote:
                quote = None
            i += 1
        elif c in "\"'`":
            quote = c; out.append(c); i += 1
        elif src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2
        else:
            out.append(c); i += 1
    return "".join(out)


def test_the_agents_page_never_names_home_assistant():
    # owner, 2026-10-15 ("never mention Home Assistant") — the page was outside this guard until 2026-10-17: 13 names
    # had stayed on it ("Not on this Home Assistant:", "The Home Assistant session has ended")
    hits = []
    for name in sorted(os.listdir(PAGE)):
        if not name.endswith((".js", ".html")):
            continue
        text = _without_comments(open(os.path.join(PAGE, name), encoding="utf-8").read(), html=name.endswith(".html"))
        hits += [f"{name}:{ln + 1}: {line.strip()[:80]!r}" for ln, line in enumerate(text.split("\n")) if NAMED.search(line)]
    hits += [f"{p}:{line}: {text[:60]!r}" for p in PAGE_SPOKEN for line, text in _spoken_strings(p) if NAMED.search(text)]
    assert hits == [], hits


def test_the_page_reader_keeps_strings_and_drops_comments():
    js = 'a = "x // Home Assistant"; // Home Assistant\n/* HA */ b = `HA`;'
    kept = _without_comments(js)
    assert "x // Home Assistant" in kept and "`HA`" in kept and "/* HA */" not in kept and kept.count("Home Assistant") == 1
