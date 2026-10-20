"""What a chat turn's reply is: from what the AI's turn produced, the text and the buttons the person receives.

⚠️ ONE PLACE, IN ORDER (architecture review, 2026-10-17: these rules were written one after another inside app._converse
— 34 changes in two weeks, each owner-dated, and the only way to check one was to start a whole agent). app.py runs the
turn and sends what this decides; nothing here talks to Telegram. The rules, in the order they apply:

    1. the answer — the AI's text; when it ended on a tool call with nothing sent, its last words
    2. a page's message IS the answer: text the AI wrote after its page is not sent
    3. a failure is said in plain words, never the raw error
    4. the AI cannot answer: a report asked for is still made from its figures, or offered
    5. stopped at the limit: a Continue button
    6. the faults the AI offered: their buttons under the answer (or under the page's message)
    7. a command the answer tells the person to write ("/investigate …"): its button, on their own question
    8. a request for approval shown in this chat IS the answer: no other text under it — unless buttons must go
    9. the platform underneath is never named: "the villa's system" (messaging.no_platform_name)

The ORDER is the design: 8 looks at the buttons 4–7 left; 6 can replace an empty answer with the offers named; 7 reads
the answer as it will be sent.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable

from . import ai_down, button_data
from .api_errors import AI_DOWN, FOR_PERSON
from vesta_shared.messaging import no_platform_name

log = logging.getLogger("vesta.reply")


@dataclass
class Reply:
    text: str
    keyboard: dict | None = None
    offered: list[str] = field(default_factory=list)    # the fault offers its buttons carry (FaultOffers.delivered)


class TurnReply:
    def __init__(self, *, jobs, state, fault_offers, approvals, command_offers):
        self.jobs = jobs                    # ai_jobs.AiJobs: the reports that can be made without the AI
        self.state = state                  # state.State: a Continue's record
        self.fault_offers = fault_offers    # fault_offers.FaultOffers: the faults the AI offered in this chat
        self.approvals = approvals          # approvals.Approvals: the requests shown in a chat
        self.command_offers = command_offers  # command_offers.CommandOffers: a command skill the answer names

    async def compose(self, cid: int, res, *, asked: str = "", page: str | None = None,
                      may_start_job: Callable[[], bool] = lambda: False, is_continue: bool = False,
                      person_id: int | None = None, request=None) -> Reply:
        """The reply to turn `res` (turn.TurnResult) in chat `cid`. `asked`: what the person wrote; `page`: the file a
        command skill's answer must carry (skill.yaml deliver.page); `may_start_job`: whether this person may start a
        job here (asked only when the AI cannot answer); `request`: the command request a Continue carries on."""
        failed = bool(res.problem or res.error)
        # 1. the answer; an empty one sends nothing (a request said it all)
        answer = (res.text or "").strip()
        if not answer and not res.sent and not res.approvals and res.earlier:
            answer = res.earlier                        # ended on a tool call with nothing sent: its last words
        # 2. ⚠️ THE PAGE'S MESSAGE IS THE ANSWER (owner, 2026-10-11: "the response … shall be all in 1 message, the
        # details being in the HTML file"): told to write nothing after it, the AI still added a long second message
        page_mid = res.pages.get(page) if page else None
        if page_mid and answer and not failed:
            log.info("Chat %s: the AI's text after its page is not sent (%d characters): the page's message is the "
                     "answer", cid, len(answer))
            answer = ""
        # 3. ⚠️ NEVER THE RAW ERROR (owner, 2026-10-06): the reason in plain words (api_errors); the owner was told by
        # the turn when no retry can help (no credit, a refused key)
        if failed:
            said = FOR_PERSON.get(res.problem or "unknown", FOR_PERSON["unknown"])
            answer = f"{answer}\n\n{said}" if answer else said
        # ⚠️ THE BUTTONS ARE ADDED, NEVER REPLACED (architecture review, 2026-10-13): each offer below put its own
        # keyboard, and a Continue silently took the place of "a report can still be made without the AI"
        rows: list[list[dict]] = []
        # 4. the AI cannot answer: a report asked for is still made from its figures (ai_down.py decides)
        if res.problem in AI_DOWN and not is_continue and may_start_job():
            off = ai_down.offer(asked, res.problem, self.jobs.without_ai_able())
            if off.start:
                answer += "\n\n" + self.jobs.start_without_ai(off.start["name"], res.problem, cid)
            elif off.buttons:
                answer += "\n\nA report can still be made without the AI, from its figures and charts:"
                rows += ai_down.keyboard(res.problem, off.buttons)["inline_keyboard"]
        # 5. stopped at the limit: Continue carries the command request on (state.new_continuation)
        if res.stopped_at_limit and res.session_id:
            cont = self.state.new_continuation(cid, res.session_id, person_id,
                                               invoked=request.name if request else None,
                                               inv=request.inv if request else None)
            answer = (answer + "\n\n" if answer else "") + \
                f"Stopped: this answer reached the {res.limit_usd:g} USD limit per reply."
            rows.append([{"text": "Continue", "callback_data": button_data.make(button_data.CONTINUE, cont)}])
        # 6. a fault the AI offered in this answer (tools._ticket): its button goes under it; only a press creates it
        if page_mid:
            self.fault_offers.keep_page(cid, page)
        answer, offer_rows, offered = await self.fault_offers.show(cid, page_mid, answer)
        rows += offer_rows
        # 7. ⚠️ THE COMMAND THE ANSWER SUGGESTS, A BUTTON (owner, 2026-10-19: "write /investigate followed by your
        # question…" — "a button that directly triggers the suggested investigation"): on the PERSON'S question, for a
        # person who may write it here; nothing runs before the press
        # — and the one a skill offers after the readings it names (`offer: after_reading`, owner 2026-10-20: the reply
        # skipped the line, so no button came)
        rows += self.command_offers.rows(cid, answer, asked, person_id, request, read=res.read)
        keyboard = {"inline_keyboard": rows} if rows else None
        # 8. ⚠️ A REQUEST SHOWN HERE IS THE ANSWER (owner, 2026-10-10: "Approval request sent." under it, twice
        # "redundant"): told not to, the AI still wrote it — and pressed at once, the request was decided before that line
        # came, so nothing removed it. No written reply after a request put in this chat (anything else the person
        # asked, the AI answers with send_message — tools.ha_call_service tells it so).
        if not keyboard and not failed and self.approvals.shown_in(res.approvals, cid):
            if answer:
                log.info("Chat %s: the AI's reply not sent, the approval request shown there says it all", cid)
            answer = ""
        # 9. ⚠️ NEVER THE PLATFORM'S NAME (owner, 2026-10-15; a chat read "… trace through Home Assistant's history and
        # logs" on 2026-10-20 although the instructions forbid it): the engine says it, not the model's choice
        return Reply(no_platform_name(answer), keyboard, offered)
