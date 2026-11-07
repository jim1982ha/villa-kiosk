"""What a person reads from the VESTA Agent never names the platform underneath (owner, 2026-10-15: "never mention
Home Assistant" — the Kiosk's screens first, then Telegram). Every string literal of the files whose words reach a
person — Telegram messages, the Kiosk's fault notes, report pages, answers to a press or a request, the model's own
rules to speak by — is read with the code's docstrings and its log lines left out; "Home Assistant" or "HA" in one
fails, naming file and line. A rule FOR the model about Home Assistant (its data, its tools) is not text a person reads:
the instructions are checked only on what they tell the model to SAY."""
from __future__ import annotations

import os
import re

from vesta_agent.roster import Roster

ROOT = os.path.join(os.path.dirname(__file__), "..")
#: The report page's own template, read without its Jinja comments.
from wording import BANNED  # noqa: E402  (the one list of wording rules)
NAMED = BANNED["the platform's name (say \"the villa's system\")"]
LOGS = {"log", "logger", "debug", "info", "warning", "error", "exception", "critical"}


#: The Agent's page: every file the browser shows a person (its JS and HTML), read without its code comments.
PAGE = os.path.join(ROOT, "vesta_agent", "ui", "static")
#: The page's words served from Python: the place names (tabs and titles), the tools' lines, the sign-in refusal.
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
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(owner, "JM")]))

    async def sends(call):        # what the AI sends itself (send_message) goes the same way
        await call["call"]("send_message", {"to": "here", "text": "First, HA restarted at 03:00."})
    FakeAI("The investigate skill will trace through Home Assistant's history and logs around that time.",
           act=sends).install(monkeypatch)
    asyncio.run(v.converse(owner, v.policy().roster.person(owner), "why did the pump stop?"))
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

