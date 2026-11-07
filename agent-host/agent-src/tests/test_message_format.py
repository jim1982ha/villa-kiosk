"""The one shape of the agent's messages and the one place of their style (owner, 2026-10-11: "the formatting shall be
centrally defined and easily and fully re-configurable if we decide to change the delivery channel"). Invented villa."""
from __future__ import annotations

import asyncio

from helpers import make_agent
from vesta_shared import message_format as F
from vesta_agent.roster import Roster

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


def test_a_report_reaches_telegram_with_its_to_line_filled_and_no_other_heading(tmp_path):
    v = make_agent(tmp_path, {}, roster=Roster.of(owner=[(OWNER, "Jim")], fm=[(FM, "JM")]))
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "text": DAILY}]}, "reports"))
    (chat, text, _), = v.tg.sent
    assert chat == FM and text == F.fill_to(DAILY, "Facility Manager") and "For:" not in text and "-------" not in text


# ---------------------------------------------------------------------- review 28
def test_a_long_report_goes_as_whole_messages_none_lost(tmp_path):
    # one long daily lost its whole "Still open" section, cut at Telegram's 4,096
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]))
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
    v = make_agent(tmp_path, {}, roster=Roster.of(fm=[(FM, "JM")]))
    paragraphs = [f"Paragraph {i}. " + "word " * 180 + f"end of {i}." for i in range(6)] + ["x" * 5000]
    body = "Findings:\n" + "\n\n".join(paragraphs)
    asyncio.run(v.outcome.carry_out({"send": [{"to": "fm", "title": "Weekly report", "text": body}]}, "reports"))
    texts = [m for c, m, _ in v.tg.sent]
    assert len(texts) >= 3 and all(F.tg_len(m) <= 4096 for m in texts) and not any(m.endswith("…") for m in texts)
    assert all(m.split("\n")[3] == "Findings:" for m in texts)            # the section goes on: its label again
    sent = "".join("".join(m.split("\n")[4:]) for m in texts).replace(" ", "")
    assert sent == "".join(body.split("\n")[1:]).replace(" ", "")        # every character, in order


