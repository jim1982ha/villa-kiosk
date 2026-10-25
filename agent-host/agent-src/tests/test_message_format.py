"""The one shape of the agent's messages and the one place of their style (owner, 2026-10-11: "the formatting shall be
centrally defined and easily and fully re-configurable if we decide to change the delivery channel"). Invented villa."""
from __future__ import annotations

import asyncio
import os
import re

from helpers import make_agent
from vesta_shared import message_format as F

OWNER, FM = 111, 222
DAILY = F.document("Villa Example, daily report on 11/10/2026.", "", [
    ("New since yesterday", ["- P3 Onsen pump used 0.12 kWh/day (-76%)."]),
    ("Still open", ["- Incident #5 · ⚠️ House Pump Power has not run.", "- P2 Motion1 battery at 7%: replace now."])])


def test_a_report_is_written_in_the_owners_shape():
    assert DAILY == ("Villa Example, daily report on 11/10/2026.\nTo:\n\n"
                     "New since yesterday:\n- P3 Onsen pump used 0.12 kWh/day (-76%).\n\n"
                     "Still open:\n- Incident #5 · ⚠️ House Pump Power has not run.\n- P2 Motion1 battery at 7%: replace now.")


def test_its_parts_are_read_back_from_the_text_as_sent():
    text = F.fill_to(DAILY, "Facility Manager")
    got = [(k, text[a:b]) for k, a, b in F.parts(text)]
    # owner, 2026-10-13: ONE quote block per section — its items together
    assert got == [("title", "Villa Example, daily report on 11/10/2026."), ("to", "To: Facility Manager"),
                   ("label", "New since yesterday:"), ("item", "- P3 Onsen pump used 0.12 kWh/day (-76%)."),
                   ("label", "Still open:"),
                   ("item", "- Incident #5 · ⚠️ House Pump Power has not run.\n- P2 Motion1 battery at 7%: replace now.")]
    # items an AI wrote apart are one block too
    apart = text.replace("run.\n- P2", "run.\n\n- P2")
    assert [k for k, _, _ in F.parts(apart)] == [k for k, _ in got]
    # an alert: its history and where it stands under "Status:" are ONE note — an older text written apart too
    alert = "#1-P2 (existing)\nTo: Owner\n🚪 Gate relay released\nWhat to do: check it.\nStatus:\n- Alert sent …\n\n⚠️ ⚙️ Still open"
    assert [(k, alert[a:b]) for k, a, b in F.parts(alert)][3:] == [("label", "Status:"),
                                                                   ("note", "- Alert sent …\n\n⚠️ ⚙️ Still open")]
    # any other text: no parts, no style
    assert F.parts("For: JM\n-------\nWeekly report") == [] and F.parts("Done.") == [] and F.telegram_entities("x\ny") == []


def test_the_agent_fills_the_to_line_only_where_a_skill_left_it():
    assert F.fill_to(DAILY, F.audience({"fm", "owner"})).split("\n")[1] == "To: Owner & Facility Manager"
    assert F.fill_to("A title\nTo: Owner\nbody", "Owner") is None             # already says who
    assert F.fill_to("Just a line", "Owner") is None


def test_to_is_a_role_never_a_name():
    # owner, 2026-10-13: "To: Owner", "To: Facility Manager", "To: Owner & Facility Manager" — and nothing else
    assert [F.audience(r) for r in ({"owner"}, {"fm"}, {"fm", "owner"}, set(), {"someone"})] == \
        ["Owner", "Facility Manager", "Owner & Facility Manager", "", ""]


def test_one_table_decides_every_style_and_a_new_channel_is_one_more_table():
    # every part kind has a rule in the table — a kind the reader finds and the table forgets fails here, never silently
    kinds = {k for text in (F.fill_to(DAILY, "Owner"), "#1 (new)\nTo: Owner\nx\nStatus:\n⚠️ New alert",
                            "#1-P2 (closed)\nTo: Owner\nx\nStatus:\n- y\n✅ Closed on …")
             for k, _, _ in F.parts(text)}
    assert kinds <= set(F.TELEGRAM) and set(F.TELEGRAM) == {"title", "to", "label", "item", "struck", "note", "struck_lines"}
    # a WhatsApp-like table, the same seven keys: the same reader, other marks — nothing else changes
    other = {"title": ("bold",), "to": (), "label": ("bold",), "item": (), "struck": (), "note": ("italic",), "struck_lines": ()}
    assert [e["type"] for e in F.entities(F.fill_to(DAILY, "Owner"), other)] == ["bold", "bold", "bold"]
    # owner, 2026-10-13: the title in bold (underlined, it read as a link), one quote per section
    assert [e["type"] for e in F.telegram_entities(F.fill_to(DAILY, "Owner"))] == ["bold"] + ["blockquote"] * 2


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
    assert chat == FM and text == F.fill_to(DAILY, "Facility Manager") and "For:" not in text and "-------" not in text


def test_a_report_names_every_role_it_went_to_in_every_chat(tmp_path):
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "Fabien", "role": "fm"},
                                         {"telegram_id": 333, "name": "JM", "role": "fm"}]})
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": DAILY}]}, "reports"))
    assert {c: t.split("\n")[1] for c, t, _ in v.tg.sent} == {FM: "To: Facility Manager", 333: "To: Facility Manager"}


# ---------------------------------------------------------------------- review 28
def test_a_report_asked_for_in_a_chat_names_its_readers_role(tmp_path):
    # its "To:" was empty: a reply in the asker's chat carries no heading, and the line was filled only with one
    from vesta_agent.routing import JOB, Origin
    v = make_agent(tmp_path, {"people": [{"telegram_id": OWNER, "name": "Jim", "role": "owner"}]})
    asyncio.run(v.outcome.carry_out({"send": [{"to": "here", "text": DAILY}]}, "reports", Origin(OWNER, kind=JOB)))
    assert v.tg.sent[-1][1].split("\n")[1] == "To: Owner"


def test_a_report_titled_as_data_keeps_its_shape_whatever_the_ai_wrote(tmp_path):
    # the AI translated "To:" ("Kepada:"), or sent one quiet line: the report fell back to "For: JM / -------", unstyled
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    t = "Villa Example, daily report on 11/10/2026."
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": t, "text": "Vila tenang: tidak ada yang baru."}]}, "x"))
    text = v.tg.sent[-1][1]
    assert text == f"{t}\nTo: Facility Manager\nVila tenang: tidak ada yang baru." and F.telegram_entities(text)[0]["type"] == "bold"


def test_home_assistants_words_never_change_an_alerts_layout():
    # an alert whose own text holds "Status:" or "Water leak detected in:" drew a second "Status:" and italics
    alert = ("#9-P2 (new)\nTo: JM\nInverter fault\nStatus:\nOffline since 09:00\n\nWater leak detected in:\nLaundry"
             "\nStatus:\n⚠️ New alert")
    got = [(k, alert[a:b]) for k, a, b in F.parts(alert)]
    assert got == [("title", "#9-P2 (new)"), ("to", "To: JM"),
                   ("item", "Inverter fault\nStatus:\nOffline since 09:00\n\nWater leak detected in:\nLaundry"),
                   ("label", "Status:"), ("note", "⚠️ New alert")]


def test_a_message_without_a_heading_has_its_status_styled_as_every_other():
    # owner, 2026-10-23: a press under a plain answer wrote "Status:" and its line as bare text — only a message with a
    # title and "To:" was styled. The shape layout.render writes without a heading is its Status section, styled alike
    from vesta_agent import layout
    for body in ("The pump ran for three hours.\n\nIt stopped at 04:00.", ""):
        text = layout.render(layout.parts(body=body, status="Fault created for the facility manager by JM."))
        got = [(k, text[a:b]) for k, a, b in F.parts(text)]
        assert got == [("label", "Status:"), ("note", "Fault created for the facility manager by JM.")], text
        assert [e["type"] for e in F.telegram_entities(text)] == ["blockquote", "italic"]
    # a titled message's Status section is drawn the same way: one style for one section
    titled = layout.render(layout.parts(body="b", status="s", head=layout.head("A title", "Owner")))
    assert [k for k, _, _ in F.parts(titled)][-2:] == ["label", "note"]
    # never a person's or the AI's own text that merely holds "Status:": inside a line, a section with a paragraph after
    # it, a label with nothing under it, or an empty line under it
    for plain in ("Status: all good.", "The pump\nStatus:\nrunning\n\nAsk me again tomorrow.", "Pump\nStatus:",
                  "Pump\nStatus:\n\nrunning"):
        assert F.parts(plain) == [] and F.telegram_entities(plain) == [], plain
    # ⚠️ NO EMPTY LINE BEFORE "Status:" (owner, 2026-10-25), and a message sent before (with one) still reads
    for text in ("Pump\nStatus:\nrunning", "Pump\n\nStatus:\nrunning"):
        assert [e["type"] for e in F.telegram_entities(text)] == ["blockquote", "italic"], text


def test_a_long_report_goes_as_whole_messages_none_lost(tmp_path):
    # one long daily lost its whole "Still open" section, cut at Telegram's 4,096
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    t = "Villa Example, daily report on 11/10/2026."
    body = F.split_title(F.document(t, "", [("New since yesterday", [f"- P3 sensor {i} has been offline for 33 h, "
                                                                     f"{'x' * 90}." for i in range(40)]),
                                            ("Still open", ["- Incident #5 · ⚠️ House Pump Power has not run."])]))[1]
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": t, "text": body}]}, "reports"))
    texts = [m for c, m, _ in v.tg.sent]
    assert len(texts) >= 2 and all(len(m) <= 4096 for m in texts)
    assert [m.split("\n")[0] for m in texts] == [f"Villa Example, daily report on 11/10/2026 ({i}/{len(texts)})."
                                                  for i in range(1, len(texts) + 1)]
    assert all(m.split("\n")[1] == "To: Facility Manager" and F.telegram_entities(m) for m in texts)
    assert "Still open:\n- Incident #5" in texts[-1]
    assert "\n\nNew since yesterday:\n" in texts[1]                       # the section goes on: its label again


def test_a_long_report_in_paragraphs_loses_nothing(tmp_path):
    # architecture review 3 (2026-10-13): six paragraphs under "Findings:" (4,400 characters) went as ONE message cut with
    # "…" — a labelled section's paragraphs are one item, and an item longer than a message was shortened
    v = make_agent(tmp_path, {"people": [{"telegram_id": FM, "name": "JM", "role": "fm"}]})
    paragraphs = [f"Paragraph {i}. " + "word " * 180 + f"end of {i}." for i in range(6)] + ["x" * 5000]
    body = "Findings:\n" + "\n\n".join(paragraphs)
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": "Weekly report", "text": body}]}, "reports"))
    texts = [m for c, m, _ in v.tg.sent]
    assert len(texts) >= 3 and all(F.tg_len(m) <= 4096 for m in texts) and not any(m.endswith("…") for m in texts)
    assert all(m.split("\n")[3] == "Findings:" for m in texts)            # the section goes on: its label again
    sent = "".join("".join(m.split("\n")[4:]) for m in texts).replace(" ", "")
    assert sent == "".join(body.split("\n")[1:]).replace(" ", "")        # every character, in order


def test_an_alert_is_struck_once_its_watch_is_over_never_while_it_is_watched():
    # owner, 2026-10-25: "(watch)" while it can come back; "(closed)" with its alert's text struck once it is fully over
    body = "🔓 Laundry Room door unlocked\nWhat to do: check it."
    styles = lambda word: [e["type"] for e in F.telegram_entities(f"#86-P2 ({word})\nTo: Owner & FM\n{body}\nStatus:\n- x\n✅ y")]
    assert styles("watch") == ["bold", "blockquote", "blockquote", "italic"]
    assert styles("closed") == ["bold", "blockquote", "strikethrough", "blockquote", "italic", "strikethrough"]
    # …its Status lines struck too, all but the last: where it ended (owner, 2026-10-25)
    text = f"#86-P2 (closed)\nTo: Owner & FM\n{body}\nStatus:\n- Alert sent\n- Cleared on x. Watch 1h\n✅ Closed on y."
    (struck,) = [e for e in F.telegram_entities(text)[4:] if e["type"] == "strikethrough"]
    lines = text.split("\nStatus:\n")[1]
    assert F.telegram_entities(text)[-1] == struck and struck["length"] == len("- Alert sent\n- Cleared on x. Watch 1h"), struck
    assert lines.endswith("✅ Closed on y.")
    assert styles("existing") == styles("watch")
