"""What a chat turn's reply is (vesta_agent/turn_reply.py): each rule as a table of cases, without an agent.

Architecture review, 2026-10-17: these rules lived inside app._converse and could only be checked by starting a whole
agent; the end-to-end tests (test_people_routing, test_api_errors, test_investigate…) still drive them through it.
"""
from __future__ import annotations

import asyncio
from dataclasses import replace

from vesta_agent import button_data
from vesta_agent.api_errors import FOR_PERSON
from vesta_agent.turn import TurnResult
from vesta_agent.turn_reply import TurnReply

CHAT = -100


def res(**kw) -> TurnResult:
    return replace(TurnResult(text="", session_id="s1", stopped_at_limit=False, cost_usd=0.01, problem=None,
                              error=None), **kw)


class Jobs:
    def __init__(self, able=()):
        self.able, self.started = list(able), []

    def without_ai_able(self):
        return self.able

    def start_without_ai(self, name, problem, chat):
        self.started.append(name)
        return f"Making the {name} report from its figures."


class State:
    def __init__(self):
        self.made = []

    def new_continuation(self, chat, session, by, invoked=None, inv=None):
        self.made.append((chat, session, by, invoked, inv))
        return "c1"


class Offers:
    def __init__(self, waiting=()):
        self.waiting, self.kept = list(waiting), []

    def keep_page(self, chat, page):
        self.kept.append(page)

    async def show(self, chat, page_mid, answer):
        if not self.waiting:
            return answer, [], []
        rows = [[{"text": "Create", "callback_data": f"t:{o}:y"}] for o in self.waiting]
        return (answer or "A fault for the facility manager, if you want one:"), rows, list(self.waiting)


class Approvals:
    def __init__(self, shown=False):
        self.shown = shown

    def shown_in(self, ids, chat):
        return self.shown and bool(ids)


class Commands:
    """command_offers.CommandOffers: a button under every answer naming "/go", on the question asked."""
    def rows(self, chat, answer, asked, person_id, request=None):
        return [[{"text": "Go", "callback_data": f"o:{asked}"}]] if "/go" in answer and asked else []


def compose(r, *, jobs=None, offers=None, approvals=None, state=None, commands=None, **kw):
    tr = TurnReply(jobs=jobs or Jobs(), state=state or State(), fault_offers=offers or Offers(),
                   approvals=approvals or Approvals(), command_offers=commands or Commands())
    return asyncio.run(tr.compose(CHAT, r, **kw))


def test_1_the_answer_is_the_text_else_the_last_words_when_nothing_was_sent():
    for r, want in [
        (res(text="  Pump is fine.  "), "Pump is fine."),
        (res(text="", earlier="Reading the pump…"), "Reading the pump…"),
        (res(text="", earlier="Reading…", sent=1), ""),                  # a message was sent: it said it
        (res(text="", earlier="Reading…", approvals=["a1"]), ""),        # a request went: it said it
    ]:
        assert compose(r).text == want, r


def test_2_a_pages_message_is_the_answer():
    page = "report.html"
    for r, want in [
        (res(text="Long summary", pages={page: 77}), ""),
        (res(text="Long summary", pages={"other.html": 77}), "Long summary"),
        (res(text="Long summary"), "Long summary"),
    ]:
        assert compose(r, page=page).text == want, r
    # a failure is still said under the page
    failed = compose(res(text="Half", pages={page: 77}, problem="offline"), page=page).text
    assert failed == f"Half\n\n{FOR_PERSON['offline']}"                  # the AI's words kept, then why it stopped


def test_3_a_failure_is_said_in_plain_words_never_raw():
    for r, want in [
        (res(problem="credit"), FOR_PERSON["credit"]),
        (res(error="Traceback: boom"), FOR_PERSON["unknown"]),
        (res(text="Partly", problem="offline"), f"Partly\n\n{FOR_PERSON['offline']}"),
    ]:
        got = compose(r).text
        assert got == want and "Traceback" not in got, (r, got)


def test_4_the_ai_down_a_named_report_is_made_another_offered_only_to_who_may_start_one():
    able = [{"name": "weekly", "button": "Weekly report"}, {"name": "energy", "button": "Energy report"}]
    jobs = Jobs(able)
    got = compose(res(problem="credit"), jobs=jobs, asked="send the weekly report", may_start_job=lambda: True)
    assert jobs.started == ["weekly"] and got.text.endswith("Making the weekly report from its figures.")
    got = compose(res(problem="credit"), jobs=Jobs(able), asked="a report please", may_start_job=lambda: True)
    assert "A report can still be made without the AI" in got.text
    assert [button_data.read(b["callback_data"])[0] for row in got.keyboard["inline_keyboard"] for b in row] == \
        [button_data.REPORT] * 2
    for kw in ({"may_start_job": lambda: False}, {"may_start_job": lambda: True, "is_continue": True}):
        jobs = Jobs(able)
        got = compose(res(problem="credit"), jobs=jobs, asked="send the weekly report", **kw)
        assert not jobs.started and got.keyboard is None, kw
    # a problem the AI can still answer through (not AI_DOWN) offers nothing
    asked = []
    compose(res(error="x"), jobs=Jobs(able), asked="weekly report", may_start_job=lambda: asked.append(1) or True)
    assert not asked


def test_5_stopped_at_the_limit_a_continue_carries_the_request_on():
    class Req:
        name, inv = "investigate", "1760000000"
    st = State()
    got = compose(res(text="Half way", stopped_at_limit=True, limit_usd=0.5), state=st, person_id=7, request=Req())
    assert got.text == "Half way\n\nStopped: this answer reached the 0.5 USD limit per reply."
    assert got.keyboard["inline_keyboard"][-1][0]["text"] == "Continue"
    assert st.made == [(CHAT, "s1", 7, "investigate", "1760000000")]
    assert compose(res(text="x", stopped_at_limit=True, session_id=None)).keyboard is None   # nothing to continue


def test_6_offered_faults_go_under_the_answer_and_a_page_is_kept_for_them():
    offers = Offers(["o1"])
    got = compose(res(text="", pages={"report.html": 9}), offers=offers, page="report.html")
    assert offers.kept == ["report.html"] and got.offered == ["o1"] and got.keyboard
    assert compose(res(text="Answer"), offers=Offers()).offered == []
    # buttons are ADDED to a Continue, never replace it
    got = compose(res(text="x", stopped_at_limit=True, limit_usd=1), offers=Offers(["o1"]))
    assert [r[0]["text"] for r in got.keyboard["inline_keyboard"]] == ["Continue", "Create"]


def test_7_a_command_the_answer_names_is_a_button_added_to_the_others():
    got = compose(res(text="For more, write /go and your question.", stopped_at_limit=True, limit_usd=1),
                  offers=Offers(["o1"]), asked="the pump?")
    assert [r[0]["text"] for r in got.keyboard["inline_keyboard"]] == ["Continue", "Create", "Go"]
    assert got.keyboard["inline_keyboard"][-1][0]["callback_data"] == "o:the pump?"     # the person's own question
    assert compose(res(text="The pump is fine."), asked="the pump?").keyboard is None
    # under an approval request shown here, the answer that names it is kept with its button
    got = compose(res(text="Write /go for more.", approvals=["a1"]), approvals=Approvals(shown=True), asked="pump")
    assert got.text == "Write /go for more." and got.keyboard


def test_8_an_approval_request_shown_here_is_the_answer_unless_buttons_must_go():
    shown = Approvals(shown=True)
    assert compose(res(text="Approval request sent.", approvals=["a1"]), approvals=shown).text == ""
    assert compose(res(text="Approval request sent.", approvals=["a1"])).text == "Approval request sent."
    # a failure is always said; buttons always go, with their words
    assert compose(res(problem="offline", approvals=["a1"]), approvals=shown).text == FOR_PERSON["offline"]
    got = compose(res(text="Half", approvals=["a1"], stopped_at_limit=True, limit_usd=1), approvals=shown)
    assert got.text.startswith("Half") and got.keyboard
