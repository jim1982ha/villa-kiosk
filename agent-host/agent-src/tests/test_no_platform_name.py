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
    # the report pages (villa, week 42: the page's footer said "read through Home Assistant" — the pages were named
    # above and never read)
    "starter/skills/reports/scripts/facts.py", "starter/skills/reports/scripts/playbook.py",
    "starter/skills/reports/scripts/compose.py",
]
#: The report page's own template, read without its Jinja comments.
REPORT_PAGE = "starter/skills/reports/templates/report.html"
from wording import BANNED  # noqa: E402  (the one list of wording rules)
NAMED = BANNED["the platform's name (say \"the villa's system\")"]
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
    page = re.sub(r"\{#.*?#\}|<!--.*?-->", " ", open(os.path.join(ROOT, REPORT_PAGE), encoding="utf-8").read(), flags=re.S)
    assert not NAMED.findall(page), [ln for ln in page.splitlines() if NAMED.search(ln)]


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
PAGE_SPOKEN = ["vesta_agent/places.py", "vesta_agent/tool_access.py", "vesta_agent/ui/server.py",
               "vesta_agent/ui/setup_copy.py"]       # the setup preview's misfits (said "this Home Assistant's MCP server")


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


# --- the engine's guarantee: what the AI writes to a person never names the platform -------------------------------
# owner, 2026-10-20: a chat read "The investigate skill will trace through Home Assistant's history and logs around that
# time…" although the instructions' rule 6 forbids it — the skills it read named Home Assistant, and a model's choice
# is not a guarantee (owner rule "don't rely on the model choosing"). vesta_shared.messaging.no_platform_name says it.

def test_the_platform_name_is_said_as_the_villas_system_and_code_and_links_stay():
    from vesta_shared.messaging import no_platform_name as said
    for text, want in [
        ("The investigate skill will trace through Home Assistant's history and logs around that time.",
         "The investigate skill will trace through the villa's history and logs around that time."),
        ("Home Assistant recorded no run.", "The villa's system recorded no run."),
        ("It is not in HA.", "It is not in the villa's system."),
        ("HA's logbook shows it.", "The villa's logbook shows it."),
        ("Check your Home Assistant first.", "Check the villa's system first."),
        ("The home  assistant restarted.\n- HA was down", "The villa's system restarted.\n- The villa's system was down"),
        ("In HA: 3 rules.", "In the villa's system: 3 rules."),
        # never inside another word, an id, a tool's name, a link or code
        ("Install HACS, then ha_get_history, HA_TOKEN and HA-MCP.", "Install HACS, then ha_get_history, HA_TOKEN and HA-MCP."),
        ("See https://www.home-assistant.io/docs/HA and www.example.org/search?q=HA&lang=en.",
         "See https://www.home-assistant.io/docs/HA and www.example.org/search?q=HA&lang=en."),
        ("Run `Home Assistant` or ```\nHA restart\n``` then.", "Run `Home Assistant` or ```\nHA restart\n``` then."),
        ("Ha, a shark.", "Ha, a shark."),
        ("", ""),
    ]:
        assert said(text) == want, text


def test_a_chat_answer_naming_home_assistant_reaches_telegram_as_the_villas_system(tmp_path, monkeypatch):
    import asyncio
    from ai_fake import FakeAI
    from helpers import make_agent
    owner = 111
    v = make_agent(tmp_path, {"people": [{"telegram_id": owner, "name": "JM", "role": "owner"}]})

    async def sends(call):        # what the AI sends itself (send_message) goes the same way
        await call["call"]("send_message", {"to": "here", "text": "First, HA restarted at 03:00."})
    FakeAI("The investigate skill will trace through Home Assistant's history and logs around that time.",
           act=sends).install(monkeypatch)
    asyncio.run(v.converse(owner, v.policy().person(owner), "why did the pump stop?"))
    said = [text for chat, text, _ in v.tg.sent if chat == owner]
    assert said[-1] == "The investigate skill will trace through the villa's history and logs around that time."
    assert any(t.endswith("First, the villa's system restarted at 03:00.") for t in said), said
    assert not [t for t in said if NAMED.search(t)], said


def test_the_pages_the_ai_writes_never_name_it():
    import sys
    from helpers import STARTER_SKILLS
    sys.path.insert(0, os.path.join(STARTER_SKILLS, "reports", "scripts"))
    import compose
    facts = {"zone": "UTC", "order": ["headline"], "to_write": [{"id": "headline", "kind": "reading"}],
             "sections": {"headline": {"colour": "amber", "text": "Amber"}}}
    page = compose.page(facts, {"headline": "Home Assistant shows the pump ran 9 h."})
    assert "The villa&#39;s system shows the pump ran 9 h." in page and "Home Assistant" not in page


def test_the_investigation_page_and_its_message_never_name_it(tmp_path):
    from test_investigate import _page
    notes = {"title": "The heater on 9 October", "summary": "HA shows the heater ran 3 h.",
             "cannot_tell": ["Whether Home Assistant's clock was right."]}
    code, err, page, out = _page(tmp_path, notes, readings=False)
    assert code == 0, err
    assert "The villa&#39;s system shows the heater ran 3 h." in page and "the villa&#39;s clock" in page
    assert out["message"]["text"].startswith("The villa's system shows the heater ran 3 h.")
    assert not NAMED.search(re.sub(r"<!--.*?-->", "", page, flags=re.S))


# --- the skills' own words: what the Agent page shows and what the AI reads to speak from ---------------------------

def _front_matter(path: str) -> dict:
    """A SKILL.md's front matter, line by line ("key: value"): its description is prose with colons, not YAML."""
    text = open(path, encoding="utf-8").read()
    head = text.split("---")[1] if text.startswith("---") else ""
    return dict(ln.split(":", 1) for ln in head.strip().splitlines() if ":" in ln)


def test_the_starter_skills_describe_themselves_without_the_platform_name():
    # owner, 2026-10-20: preventive-maintenance's line on the Agent page read "Nightly maintenance checks on Home
    # Assistant's history", investigate's SKILL.md "from Home Assistant's records" — words the AI repeats to a person
    skills = os.path.join(ROOT, "starter", "skills")
    hits = []
    for name in sorted(os.listdir(skills)):
        said = []
        y = os.path.join(skills, name, "skill.yaml")
        if os.path.exists(y):
            sk = yaml.safe_load(open(y, encoding="utf-8")) or {}
            said += [("skill.yaml", sk.get("description") or "")]
            said += [(f"skill.yaml {s}", (d or {}).get("description") or "") for s, d in (sk.get("scripts") or {}).items()]
            said += [(f"skill.yaml {s} {c}", w) for s, d in (sk.get("scripts") or {}).items()
                     for c, w in ((d or {}).get("commands") or {}).items()]
        md = os.path.join(skills, name, "SKILL.md")
        if os.path.exists(md):
            said += [("SKILL.md", str(_front_matter(md).get("description") or ""))]
        hits += [f"{name} {where}: {text[:70]!r}" for where, text in said if NAMED.search(str(text))]
    assert hits == [], hits
    # and the investigation page's own words (it was read nowhere: "rests only on Home Assistant's records")
    page = re.sub(r"\{#.*?#\}|<!--.*?-->", " ",
                  open(os.path.join(skills, "investigate", "templates", "investigation.html"), encoding="utf-8").read(),
                  flags=re.S)
    assert not NAMED.findall(page), [ln for ln in page.splitlines() if NAMED.search(ln)]


def test_the_instructions_say_what_the_villas_system_is_once():
    rules_text = open(os.path.join(ROOT, "starter/config/instructions.md"), encoding="utf-8").read()
    named = [ln for ln in rules_text.splitlines() if NAMED.search(ln)]
    assert len(named) == 2 and "the villa's system (Home Assistant underneath)" in named[0], named
    assert named[1].startswith("6. ")             # the rule that forbids it to a person
