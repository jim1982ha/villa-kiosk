"""A fault offered in a chat, from start to end: made, its page kept, shown, pressed.

⚠️ ONE HOME FOR THE OFFER (architecture review 32, 2026-10-11). Its life was in ten places of seven files — the tool
made it, app._converse copied the page and placed the buttons, app._delivered made the agent's own offer, app._press_ticket
created it — and three faults came from the spread: a pressed offer on a page's message lost its own result line (the
caption limit), an offer was marked shown before the answer went out (a refused answer lost it for good), and a Continue
after a limit offered a second fault for the same investigation. Approvals and incidents each have one module
(approvals.Approvals, incident_thread.IncidentThread); the offer has this one.

  made        Toolbox's create_ticket in a chat (state.new_ticket_offer, tied to its investigation `inv`), or `ensure`
              here — one per investigation, from its saved account, and only an account written for it
  its page    `keep_page`: each offer of the investigation its own copy, so a later one can never change it
  shown       `show`: under the page's own message, or under the answer, or alone and named — marked once delivered
  pressed     `press`: Create (the fault, with its page) or Don't create, said under the message, within its limit
"""
from __future__ import annotations

import json
import logging
import os
import shutil
from typing import Callable

from . import button_data
from vesta_shared.messaging import uncited

from .kiosk import fault_note_chars, fault_title_chars

log = logging.getLogger("vesta")

#: the words on the buttons under an answer that offers a fault (tools._ticket in a chat)
CREATE = "Create this fault for the facility manager"
DECLINE = "Don't create it"


class FaultOffers:
    def __init__(self, state, delivery, tickets, folder: Callable[[int], str], facts=None):
        """`folder(chat)`: the chat's out folder, where its run saved the page and the account. `facts`:
        chat_facts.ChatFacts — what a press decided is told to the AI with the chat's next message."""
        self.state, self.delivery, self.tickets, self.folder = state, delivery, tickets, folder
        self.facts = facts

    # ------------------------------------------------------------------ made
    def ensure(self, chat: int, inv: str | None, account: str, asked: str, since: float) -> None:
        """An investigation always offers a fault (skill.yaml `deliver.fault_offer`): none offered for `inv` — by this
        turn or the one it continues — one is, from its saved `account` ("title", "summary"). ⚠️ ONLY AN ACCOUNT WRITTEN
        FOR IT (`since`, the investigation's start): the chat's folder keeps an earlier investigation's file."""
        if inv and self.state.offers_of(inv):
            return
        notes = {}
        path = os.path.join(self.folder(chat), account)
        try:
            if os.path.getmtime(path) >= since:
                with open(path, encoding="utf-8") as f:
                    notes = json.load(f)
        except (OSError, ValueError):
            pass
        notes = notes if isinstance(notes, dict) else {}
        title = str(notes.get("title") or "").strip() or f"Check on site: {asked.strip()}"
        # its note is read in the Kiosk, where "[2]" leads to no page (architecture review 4, 2026-10-13)
        self.state.new_ticket_offer(chat, title[:fault_title_chars()], None,
                                    uncited(str(notes.get("summary") or ""))[:fault_note_chars()] or None, inv)

    def keep_page(self, chat: int, page: str) -> None:
        """The page goes with the fault if a person creates it (owner, 2026-10-11): each offer waiting in this chat its
        own copy, so a later investigation can never put another page on it."""
        out = self.folder(chat)
        for o in self.state.pending_offers(chat):
            if o.get("document"):
                continue
            copy = os.path.join(out, f"report-{o['id']}.html")
            try:
                shutil.copyfile(os.path.join(out, page), copy)
                self.state.set_offer_document(o["id"], copy)
            except OSError as e:
                log.warning("Chat %s: the report could not be kept for its fault (%s)", chat, type(e).__name__)

    # ------------------------------------------------------------------ shown
    async def show(self, chat: int, page_mid: int | None, answer: str) -> tuple[str, list, list[str]]:
        """Where the offers waiting in this chat go: (the answer, now; the button rows to put under it; the offers those
        rows carry — `delivered` marks them once the answer arrived). Under a page's own message when the answer IS
        that message; else under the answer; else alone, named."""
        offers = self.state.pending_offers(chat)
        if not offers:
            return answer, [], []
        rows = [[{"text": CREATE, "callback_data": button_data.make(button_data.TICKET, o["id"], "y")},
                 {"text": DECLINE, "callback_data": button_data.make(button_data.TICKET, o["id"], "n")}] for o in offers]
        ids = [o["id"] for o in offers]
        if page_mid and not answer and await self.delivery.buttons(chat, page_mid, {"inline_keyboard": rows}):
            self.state.offers_shown(ids)                  # one message, the whole answer
            return answer, [], []
        if not answer:
            # the answer was a message of its own the buttons could not join: the offer comes alone, named
            answer = "A fault for the facility manager, if you want one:\n" + "\n".join(f"- {o['title']}" for o in offers)
        return answer, rows, ids

    def delivered(self, ids: list[str], message_id: int | None) -> None:
        if ids and message_id:
            self.state.offers_shown(ids)

    # ------------------------------------------------------------------ pressed
    async def press(self, p) -> None:
        """Create (the fault, with its page) or Don't create — once, whoever presses first — said under the message."""
        offer = self.state.claim_ticket_offer(p.parts[0], p.chat)
        if not offer:
            return await p.toast("Already decided.")
        # ⚠️ TOLD TO THE AI (owner, 2026-10-23): the AI offered it in the conversation, the press decided it outside —
        # it could still say "press Create if you want one" of a fault already created, or declined
        on = f"the fault offered here (“{offer['title']}”)"
        if p.parts[1] == "n":
            await p.toast("No fault created.")
            if self.facts is not None:
                self.facts.pressed(p.chat, DECLINE, on, p.person.name, "no fault was created")
            return await self._say(p, f"No fault created: declined by {p.person.name}.")
        try:
            await self.tickets.create(offer["title"], offer.get("entity_id"), offer.get("note"),
                                      document=offer.get("document"))
        except Exception as e:  # noqa: BLE001
            self.state.release_ticket_offer(offer["id"])            # the button still works
            log.warning("The offered fault could not be created (%s)", type(e).__name__)
            return await p.toast("The VESTA Kiosk did not record it. Try again in a moment.")
        await p.toast("Fault created.")
        if self.facts is not None:
            self.facts.pressed(p.chat, CREATE, on, p.person.name, "the fault was created")
        await self._say(p, f"Fault created for the facility manager by {p.person.name}: {offer['title']}")

    async def _say(self, p, said: str) -> None:
        """The message stays whole, its buttons gone, the decision under it (Delivery.settle, within its own limit)."""
        await self.delivery.settle(p.chat, p.mid, p.msg, said)
