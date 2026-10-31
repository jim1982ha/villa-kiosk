"""What VESTA raises is a FAULT, never a ticket (owner, 2026-11-01: "make sure everything is consistently labeled and
accounted as such everywhere"). A reported issue is a fault in the Kiosk's Open issues; it becomes a ticket only when a
person presses Open Ticket in the Kiosk. Every text the model or a person reads about what the Agent makes says so:
the starter instructions, every starter skill's SKILL.md, YAML values and page templates, the AI's tool descriptions
and results, and the labels of the AI tools page. Synthetic villa; ids invented."""
from __future__ import annotations

import asyncio
import glob
import os
import re

import yaml

from helpers import make_agent
from kiosk_fake import FakeKiosk
from vesta_agent.config import STARTER_DIR
from vesta_agent.policy import Person
from vesta_agent.routing import CONVERSATION, Origin
from vesta_agent.tool_access import OWN
from vesta_agent.tools import SKILL_PREFACE

FM, FM_CHAT = 222, -100222
#: the only ways "ticket" may be said: the tool's own name, the Kiosk's button, and what a person's press does
ALLOWED = re.compile(r"create_ticket|Open Ticket|(?:makes?|made) it a ticket", re.I)
TICKET = re.compile(r"\btickets?\b", re.I)


def said_ticket(text: str) -> list[str]:
    """Each line of `text` that calls something a ticket outside ALLOWED."""
    return [line.strip() for line in str(text).splitlines() if TICKET.search(ALLOWED.sub("", line))]


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def _starter_texts() -> dict[str, str]:
    out = {"config/instructions.md": open(os.path.join(STARTER_DIR, "config", "instructions.md"), encoding="utf-8").read()}
    skills = os.path.join(STARTER_DIR, "skills")
    for path in sorted(glob.glob(os.path.join(skills, "*", "SKILL.md")) + glob.glob(os.path.join(skills, "*", "templates", "*"))):
        out[os.path.relpath(path, STARTER_DIR)] = open(path, encoding="utf-8").read()
    for path in sorted(glob.glob(os.path.join(skills, "*", "*.yaml"))):
        # the values only: a comment is the developer's, never read by the model
        out[os.path.relpath(path, STARTER_DIR)] = "\n".join(_strings(yaml.safe_load(open(path, encoding="utf-8"))))
    return out


def test_the_rule_finds_a_ticket_and_lets_the_kiosks_own_words_pass():
    assert said_ticket("A P1 also becomes a Facility ticket in the Kiosk.") and said_ticket("2 tickets created")
    assert not said_ticket("A fault (create_ticket); only a person makes it a ticket, with Open Ticket in the Kiosk.")


def test_no_starter_text_calls_what_vesta_raises_a_ticket():
    texts = _starter_texts()
    # the whole applicable set: the instructions, and every starter skill's SKILL.md and skill.yaml
    names = {os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(STARTER_DIR, "skills", "*", "SKILL.md"))}
    assert names and {f"skills/{n}/SKILL.md" for n in names} <= set(texts)
    assert {f"skills/{n}/skill.yaml" for n in names} <= set(texts)
    found = {name: lines for name, text in texts.items() if (lines := said_ticket(text))}
    assert found == {}


def test_no_tool_text_or_label_calls_what_vesta_raises_a_ticket(tmp_path):
    k = FakeKiosk()
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}], "chats": {"fm": FM_CHAT}},
                   kiosk=k)
    texts = [SKILL_PREFACE] + [f"{label}\n{what}" for label, what, _ in OWN.values()]
    tb = v.toolbox()
    on_schedule = {t.name: t for t in tb.tool_objects(None, None)}
    in_chat = {t.name: t for t in v.toolbox().tool_objects(Person(FM, "JM", "fm"), Origin(FM_CHAT, CONVERSATION))}
    assert "create_ticket" in on_schedule and "create_ticket" in in_chat and "agent_status" in on_schedule
    texts += [t.description for t in [*on_schedule.values(), *in_chat.values()]]
    # what the tool answers: no title, and a Kiosk that cannot record it
    texts.append(asyncio.run(on_schedule["create_ticket"].handler({}))["content"][0]["text"])
    k.refuses("t1", 403, "no")
    texts.append(asyncio.run(on_schedule["create_ticket"].handler({"title": "Pump weak"}))["content"][0]["text"])

    async def unreachable(**_):
        raise ConnectionError
    tb.ticket = unreachable
    texts.append(asyncio.run(on_schedule["create_ticket"].handler({"title": "Pump weak"}))["content"][0]["text"])
    assert all(t for t in texts[-3:])
    found = [line for text in texts for line in said_ticket(text)]
    assert found == []
