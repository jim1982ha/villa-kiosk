"""A skill script's result, carried out the same whoever ran it (vesta_agent.outcome), and the
one routing rule (vesta_agent.routing). Synthetic skills and data only."""
from __future__ import annotations

import asyncio
import json
import os

import pytest
import yaml

from helpers import settings
from test_telegram_events import BOT, FakeReader, FakeTelegram
from vesta_agent.app import Vesta
from vesta_agent.policy import Policy
from vesta_agent.routing import CONVERSATION, Origin, Routing
from vesta_shared.store import Store

GROUP, FM_PRIVATE, ASKER = -100777, 222, 333


class FakeKiosk:
    enabled = True

    def __init__(self):
        self.tickets, self.resolved = [], []

    async def add_ticket(self, title, entity_id=None, note=None):
        self.tickets.append((title, entity_id))
        self.notes = getattr(self, "notes", []) + [note]
        return f"t{len(self.tickets)}"

    async def resolve_ticket(self, uid, note=None):
        self.resolved.append(uid)
        return True

    async def ticket_states(self):
        return {uid: "resolved" if uid in self.resolved or uid in getattr(self, "closed_by_hand", ()) else "open"
                for uid in [f"t{i + 1}" for i in range(len(self.tickets))] + list(getattr(self, "known", ()))}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def agent(tmp_path):
    s = settings(str(tmp_path), VESTA_TELEGRAM_ENABLED="true", VESTA_TELEGRAM_BOT_TOKEN="42:TG-TEST")
    with open(s.policy_path, "w") as f:
        yaml.safe_dump({"people": [{"telegram_id": ASKER, "name": "Asker", "role": "fm", "language": "en"}],
                        "chats": {"owner": GROUP, "fm": FM_PRIVATE}}, f)
    # a skill whose script stores a task and asks for its ticket and a message, like the nightly check
    d = os.path.join(s.skills_dir, "checker")
    os.makedirs(os.path.join(d, "scripts"))
    open(os.path.join(d, "SKILL.md"), "w").write("# checker\n")
    open(os.path.join(d, "skill.yaml"), "w").write(yaml.safe_dump({"description": "t", "scripts": {"check.py": {"inject": ["store"]}}}))
    open(os.path.join(d, "scripts", "check.py"), "w").write(
        "import argparse, json\n"
        "from vesta_shared.store import Store\n"
        "ap = argparse.ArgumentParser(); ap.add_argument('--store'); a = ap.parse_args()\n"
        "tid = Store(a.store).add_task('PM-X', 'sensor.example_pump_power', 'Pump draws less power')\n"
        "print(json.dumps({'actions': [{'action': 'ticket', 'summary': 'Pump draws less power', 'task_id': tid,\n"
        "                  'entity_id': 'sensor.example_pump_power'}],\n"
        "                  'send': [{'to': 'fm', 'text': 'Pump draws less power'}], 'pad': 'x' * PAD}))\n"
        .replace("PAD", os.environ.get("PAD", "10")))
    k = FakeKiosk()
    v = Vesta(s, telegram=FakeTelegram(), reader=FakeReader(), kiosk=k)
    v.bot_username = BOT["username"]
    return v, k


def script_tool(v, chat):
    """The model's run_skill_script, as one conversation holds it (one toolbox per conversation)."""
    return next(t for t in v.toolbox().tool_objects(None, Origin(chat, CONVERSATION), False) if t.name == "run_skill_script")


def model_runs(v, chat, part=1, tool=None):
    tool = tool or script_tool(v, chat)
    return run(tool.handler({"skill": "checker", "script": "check.py", "args": [], "vesta_part": part}))


def test_a_script_the_model_runs_in_a_chat_is_carried_out_like_a_scheduled_one(agent):
    v, kiosk = agent
    res = model_runs(v, GROUP)
    text = res["content"][0]["text"]
    assert "Carried out by the VESTA Agent: 1 message(s) sent, 1 ticket(s) created" in text
    assert kiosk.tickets == [("Pump draws less power", "sensor.example_pump_power")]
    task = Store(v.s.store_path).tasks("open")[0]
    assert task["todo_uid"] == "t1"                                        # the task knows its ticket
    # its message: the chat of the conversation, not the fm chat (architecture review, 2026-10-01: the AI's
    # own messages were held to the asker's chat while the script's went to the fm chat, in one conversation)
    assert [c for c, _, _ in v.tg.sent] == [GROUP]


def test_the_next_part_of_a_long_answer_does_not_run_the_script_again(agent, monkeypatch):
    v, kiosk = agent
    script = os.path.join(v.s.skills_dir, "checker", "scripts", "check.py")
    src = open(script).read().replace("'x' * 10", "'x' * 130000")         # > two parts of 60,000 characters
    open(script, "w").write(src)
    tool = script_tool(v, GROUP)
    first = model_runs(v, GROUP, 1, tool)["content"][0]["text"]
    second = model_runs(v, GROUP, 2, tool)["content"][0]["text"]
    assert "Part 1 of" in first and "Part 2 of" in second
    assert len(kiosk.tickets) == 1 and len(Store(v.s.store_path).tasks("open")) == 1


def test_an_open_task_without_its_ticket_gets_one_once(agent):
    v, kiosk = agent
    st = Store(v.s.store_path)
    lost = st.add_task("PM-Y", "sensor.example_battery", "Battery low")
    has = st.add_task("PM-Z", "sensor.example_other", "Already filed")
    st.set_task_uid(has, "t-old")
    assert run(v.outcome.repair_tickets()) == 1
    assert kiosk.tickets == [("Battery low", "sensor.example_battery")]
    assert st.task(lost)["todo_uid"] == "t1"
    assert run(v.outcome.repair_tickets()) == 0                            # nothing left to repair


def test_the_tasks_and_the_kiosks_tickets_agree(agent):
    # villa, 2026-10-01: findings closed every night, their tickets stayed "Open fault" for ever and the
    # Kiosk's Cockpit only grew (22 faults for problems gone)
    from vesta_shared.problems import Problems
    v, kiosk = agent
    kiosk.known, kiosk.closed_by_hand = ["t-hand", "t-gone", "t-alert", "t-old"], ["t-hand", "t-alert"]
    st, pb = Store(v.s.store_path), Problems(Store(v.s.store_path))
    fid, _ = st.raise_finding("PM-A", "sensor.example_a", "level", "2026-09-30", "P3", "A", {})
    by_hand, _ = pb.open_task("finding", fid, "PM-A", "sensor.example_a", "Closed in the Kiosk"); st.set_task_uid(by_hand, "t-hand")
    gid, _ = st.raise_finding("PM-SILENT", "sensor.example_rain", "level", "2026-09-30", "P3", "silent", {})
    gone, _ = pb.open_task("finding", gid, "PM-SILENT", "sensor.example_rain", "Rain gauge silent"); st.set_task_uid(gone, "t-gone")
    st.close_finding("PM-SILENT", "sensor.example_rain", "2026-10-01")             # the check no longer sees it
    iid = st.new_incident("k", "automation.example_door", "lock.example_door", "P2", {"message": "Door left open"})
    st.update_incident(iid, state="asked")
    alert, _ = pb.open_task("incident", iid, "automation.example_door", "lock.example_door", "Door left open")
    st.set_task_uid(alert, "t-alert")
    run(v.outcome.carry_out({"send": [{"to": "fm", "text": f"Door left open. Incident #{iid}.", "keyboard": True}],
                             "incident_id": iid}, "alert-desk"))
    old = st.add_task("PM-B", "sensor.example_b", "Before sources were kept"); st.set_task_uid(old, "t-old")   # 0.6.15
    run(v.outcome.repair_tickets())
    assert st.task(by_hand)["status"] == "closed_in_kiosk"                          # a person closed it there
    assert st.task(gone)["status"] == "cleared" and kiosk.resolved == ["t-gone"]    # gone: closed with its ticket
    # an alert's fault closed in the Kiosk: its incident closes too — the desk stops chasing it — and the
    # alert's message loses its buttons (villa, 2026-10-01: it kept reminding, then escalated to the owner)
    assert st.task(alert)["status"] == "closed_in_kiosk" and st.incident(iid)["closed_at"]
    assert any("Closed in the VESTA Kiosk" in text for _, _, text in v.tg.edits)
    assert st.task(old)["status"] == "open"                                         # no finding of its own: stays


def test_a_task_from_before_sources_keeps_its_title_and_check_apart(agent):
    # owner, 2026-10-01: "<finding> Check: <what>" as one title filled a fault card with a paragraph. A task
    # written before 0.6.16 still has the sentence: its missing ticket is made with the two apart.
    v, kiosk = agent
    st = Store(v.s.store_path)
    st.add_task("PM-X", "sensor.example_rain", "Rain gauge has not reported for 2.0 days. Check: Check the sensor: battery.")
    run(v.outcome.repair_tickets())
    assert kiosk.tickets[-1] == ("Rain gauge has not reported for 2.0 days.", "sensor.example_rain")
    assert kiosk.notes[-1] == "Check: Check the sensor: battery."


def test_one_occasion_answers_every_routing_question():
    # architecture review, 2026-10-01: "who is asking" read in one place — what the AI is offered, where
    # each message lands, whether it may start a job — as a table, without building any tool
    from vesta_agent.routing import JOB, PRESS
    r = Routing(Policy({"chats": {"owner": GROUP, "fm": FM_PRIVATE}}))
    scheduled, talk, job, press = None, Origin(ASKER, CONVERSATION), Origin(ASKER, JOB), Origin(ASKER, PRESS)
    assert [Routing.offered(o) for o in (scheduled, talk, job, press)] == [
        ["owner", "fm"], ["here"], ["here"], ["here", "owner", "fm"]]
    assert [r.target("fm", o) for o in (scheduled, talk, job, press)] == [FM_PRIVATE, ASKER, ASKER, FM_PRIVATE]
    assert [r.target("owner", o) for o in (scheduled, talk, press)] == [GROUP, ASKER, GROUP]   # a button may escalate
    assert talk.is_conversation and not job.is_conversation and not press.is_conversation


def test_the_routing_rule():
    pol = Policy({"people": [{"telegram_id": ASKER, "name": "A", "role": "fm"}],
                  "chats": {"owner": GROUP, "fm": FM_PRIVATE}})
    r = Routing(pol)
    assert r.target("here", Origin(ASKER)) == ASKER                        # 1. a reply: where they wrote
    assert r.target("here") is None                                        #    no one asked: nowhere
    assert (r.target("owner"), r.target("fm")) == (GROUP, FM_PRIVATE)      # 2. scheduled / alert: the role's chat
    assert r.target("fm", Origin(ASKER)) == FM_PRIVATE                     #    whoever is being answered
    assert r.approver_chat("owner", ASKER) == GROUP                        # 3. owner only: the owner chat
    assert r.approver_chat("any", ASKER) == ASKER                          #    otherwise where it was asked
    assert r.approver_chat("any", -999) == GROUP                           #    an unknown chat: the owner chat


def test_a_message_for_both_roles_sharing_one_chat_is_sent_once(agent):
    v, _ = agent
    with open(v.s.policy_path, "w") as f:
        yaml.safe_dump({"chats": {"owner": GROUP, "fm": GROUP}}, f)
    done = run(v.outcome.carry_out({"send": [{"to": "owner", "text": "Siren off."}, {"to": "fm", "text": "Siren off."}]}))
    assert done["sent"] == 1 and [c for c, _, _ in v.tg.sent] == [GROUP]   # 4. one chat, one message


def test_the_alert_skill_cannot_be_run_by_the_model_to_raise_an_alert():
    import vesta_agent
    from vesta_agent.skills import Skills
    sk = Skills(os.path.join(os.path.dirname(vesta_agent.__file__), "..", "starter", "skills")).get("alert-desk")
    assert sk.scripts["desk.py"]["cmds"] == {"status"}                     # read only: intake, tick, reply are the engine's
    assert json.dumps(sorted(sk.on_event))                                  # the alert itself comes from Home Assistant


def test_the_model_saves_its_sentences_but_never_over_a_scripts_file(agent):
    v, _ = agent
    tool = next(t for t in v.toolbox().tool_objects(None, Origin(GROUP, CONVERSATION), False) if t.name == "save_file")
    ok = run(tool.handler({"name": "notes.json", "content": json.dumps({"headline": "All quiet."})}))
    assert not ok.get("is_error") and json.load(open(os.path.join(v.s.out_dir, "notes.json"))) == {"headline": "All quiet."}
    assert not run(tool.handler({"name": "notes.json", "content": "{}"})).get("is_error")      # its own file: again
    open(os.path.join(v.s.out_dir, "facts.json"), "w").write("{}")                           # a script's output
    assert run(tool.handler({"name": "facts.json", "content": "{}"})).get("is_error")
    assert run(tool.handler({"name": "../policy.yaml", "content": "x"})).get("is_error")
    assert run(tool.handler({"name": "page.html", "content": "x"})).get("is_error")
    assert run(tool.handler({"name": "bad.json", "content": "{nope"})).get("is_error")
