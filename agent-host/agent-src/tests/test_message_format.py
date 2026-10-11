"""The one shape of the agent's messages and the one place of their style (owner, 2026-10-11: "the formatting shall be
centrally defined and easily and fully re-configurable if we decide to change the delivery channel"). Invented villa."""
from __future__ import annotations

import asyncio
import os
import re

from helpers import make_agent
from vesta_shared import message_format as F

OWNER, FM = 111, 222
DAILY = F.document("The Lys House, daily report on 11/10/2026.", "", [
    ("New since yesterday", ["- P3 Onsen pump used 0.12 kWh/day (-76%)."]),
    ("Still open", ["- Incident #5 · ⚠️ House Pump Power has not run.", "- P2 Motion1 battery at 7%: replace now."])])


def test_a_report_is_written_in_the_owners_shape():
    assert DAILY == ("The Lys House, daily report on 11/10/2026.\nTo:\n\n"
                     "New since yesterday:\n- P3 Onsen pump used 0.12 kWh/day (-76%).\n\n"
                     "Still open:\n- Incident #5 · ⚠️ House Pump Power has not run.\n\n- P2 Motion1 battery at 7%: replace now.")


def test_its_parts_are_read_back_from_the_text_as_sent():
    text = F.fill_to(DAILY, ["JM"])
    got = [(k, text[a:b]) for k, a, b in F.parts(text)]
    assert got == [("title", "The Lys House, daily report on 11/10/2026."), ("to", "To: JM"),
                   ("label", "New since yesterday:"), ("item", "- P3 Onsen pump used 0.12 kWh/day (-76%)."),
                   ("label", "Still open:"), ("item", "- Incident #5 · ⚠️ House Pump Power has not run."),
                   ("item", "- P2 Motion1 battery at 7%: replace now.")]
    # an alert: its items under "Status:" are notes
    alert = "#1-P2 (existing)\nTo: Jim\n🚪 Gate relay released\nWhat to do: check it.\n\nStatus:\n- Alert sent …\n\n⚠️ ⚙️ Still open"
    assert [k for k, _, _ in F.parts(alert)] == ["title", "to", "item", "label", "note", "note"]
    # any other text: no parts, no style
    assert F.parts("For: JM\n-------\nWeekly report") == [] and F.parts("Done.") == [] and F.telegram_entities("x\ny") == []


def test_the_agent_fills_the_to_line_only_where_a_skill_left_it():
    assert F.fill_to(DAILY, ["JM", "Fabien"]).split("\n")[1] == "To: JM, Fabien"
    assert F.fill_to("A title\nTo: Jim\nbody", ["JM"]) is None                 # already says who
    assert F.fill_to("Just a line", ["JM"]) is None


def test_one_table_decides_every_style_and_a_new_channel_is_one_more_table():
    # every part kind has a rule in the table — a kind the reader finds and the table forgets fails here, never silently
    kinds = {k for text in (F.fill_to(DAILY, ["JM"]), "#1 (new)\nTo: Jim\nx\n\nStatus:\n⚠️ New alert")
             for k, _, _ in F.parts(text)}
    assert kinds <= set(F.TELEGRAM) and set(F.TELEGRAM) == {"title", "to", "label", "item", "note"}
    # a WhatsApp-like table, the same five keys: the same reader, other marks — nothing else changes
    other = {"title": ("bold",), "to": (), "label": ("bold",), "item": (), "note": ("italic",)}
    assert [e["type"] for e in F.entities(F.fill_to(DAILY, ["JM"]), other)] == ["bold", "bold", "bold"]
    assert [e["type"] for e in F.telegram_entities(F.fill_to(DAILY, ["JM"]))] == ["underline"] + ["blockquote"] * 3


def test_no_style_is_written_anywhere_else():
    # the style's names live in message_format only: no other module of the agent or of a skill names a Telegram style
    root = os.path.join(os.path.dirname(__file__), "..")
    offenders = []
    for d in ("vesta_agent", "vesta_shared", "starter/skills"):
        for base, _, files in os.walk(os.path.join(root, d)):
            for f in files:
                path = os.path.join(base, f)
                if f.endswith(".py") and not path.endswith("message_format.py") and \
                        re.search(r"[\"'](blockquote|underline|italic|parse_mode)[\"']", open(path, encoding="utf-8").read()):
                    offenders.append(os.path.relpath(path, root))
    assert offenders == []


def test_a_report_reaches_telegram_with_its_to_line_filled_and_no_other_heading(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"},
                                         {"telegram_id": FM, "name": "JM", "role": "fm"}]})
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": DAILY}]}, "reports"))
    (chat, text, _), = v.tg.sent
    assert chat == FM and text == F.fill_to(DAILY, ["JM"]) and "For:" not in text and "-------" not in text


def test_a_report_names_everyone_it_went_to_in_every_chat(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"},
                                         {"telegram_id": 333, "name": "JM", "role": "fm"}]})
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": DAILY}]}, "reports"))
    assert {c: t.split("\n")[1] for c, t, _ in v.tg.sent} == {FM: "To: Fabien, JM", 333: "To: Fabien, JM"}


# ---------------------------------------------------------------------- review 28
def test_a_report_asked_for_in_a_chat_names_its_reader(tmp_path):
    # its "To:" was empty: a reply in the asker's chat carries no heading, and the line was filled only with one
    from vesta_agent.routing import JOB, Origin
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"}]})
    asyncio.run(v.outcome.carry_out({"send": [{"to": "here", "text": DAILY}]}, "reports", Origin(OWNER, kind=JOB)))
    assert v.tg.sent[-1][1].split("\n")[1] == "To: Jim"


def test_a_report_titled_as_data_keeps_its_shape_whatever_the_ai_wrote(tmp_path):
    # the AI translated "To:" ("Kepada:"), or sent one quiet line: the report fell back to "For: JM / -------", unstyled
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    t = "The Lys House, daily report on 11/10/2026."
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": t, "text": "Vila tenang: tidak ada yang baru."}]}, "x"))
    text = v.tg.sent[-1][1]
    assert text == f"{t}\nTo: JM\nVila tenang: tidak ada yang baru." and F.telegram_entities(text)[0]["type"] == "underline"


def test_home_assistants_words_never_change_an_alerts_layout():
    # an alert whose own text holds "Status:" or "Water leak detected in:" drew a second "Status:" and italics
    alert = ("#9-P2 (new)\nTo: JM\nInverter fault\nStatus:\nOffline since 09:00\n\nWater leak detected in:\nLaundry"
             "\n\nStatus:\n⚠️ New alert")
    got = [(k, alert[a:b]) for k, a, b in F.parts(alert)]
    assert got == [("title", "#9-P2 (new)"), ("to", "To: JM"),
                   ("item", "Inverter fault\nStatus:\nOffline since 09:00\n\nWater leak detected in:\nLaundry"),
                   ("label", "Status:"), ("note", "⚠️ New alert")]


def test_a_long_report_goes_as_whole_messages_none_lost(tmp_path):
    # one long daily lost its whole "Still open" section, cut at Telegram's 4,096
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    t = "The Lys House, daily report on 11/10/2026."
    body = F.split_title(F.document(t, "", [("New since yesterday", [f"- P3 sensor {i} has been offline for 33 h, "
                                                                     f"{'x' * 90}." for i in range(40)]),
                                            ("Still open", ["- Incident #5 · ⚠️ House Pump Power has not run."])]))[1]
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": t, "text": body}]}, "reports"))
    texts = [m for c, m, _ in v.tg.sent]
    assert len(texts) >= 2 and all(len(m) <= 4096 for m in texts)
    assert [m.split("\n")[0] for m in texts] == [f"The Lys House, daily report on 11/10/2026 ({i}/{len(texts)})."
                                                  for i in range(1, len(texts) + 1)]
    assert all(m.split("\n")[1] == "To: JM" and F.telegram_entities(m) for m in texts)
    assert "Still open:\n- Incident #5" in texts[-1]
    assert "\n\nNew since yesterday:\n" in texts[1]                       # the section goes on: its label again
