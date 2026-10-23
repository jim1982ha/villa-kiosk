"""A command skill offered under a chat reply, from start to end: shown, pressed.

⚠️ THE BUTTON THE REPLY ALREADY SUGGESTS (owner, 2026-10-19, a Telegram screenshot): asked about the pool pump in a
private chat, the reply ended "write /investigate followed by your question about the pool pump history…". He wanted
that reply to carry a button that starts the investigation itself.

  which      a skill whose skill.yaml has `offer:` (skills.Skill.offer) and whose "/command" the reply names — the
             skill decides whether it can be offered, the engine never names one
  who        whoever may write that command in that chat: the button is what typing "/<command> <question>" there would
             be, judged by intake.gate itself — at the reply AND again at the press (no second copy of the rule)
  what       the PERSON'S question that turn answered (the turn's `asked`), never the AI's paraphrase; kept in State
             (`command_offer:`, pruned with the records), the button holding only its id — Telegram allows 64 bytes
  about      what that turn READ to answer it (the devices and periods of its readings that earn the button, subject()),
             kept beside the question and handed to the request at the press — never shown, never a value read
  declined   its second button, when the skill names one (`offer: decline`): used up the same way, nothing runs
  pressed    once (State.claim_command_offer): said under the message, that button gone and the others kept, then
             app.handle_message runs the typed command — the same intake, the same command_request, the same reply
             (with its `about`); an offer pruned with the records is said to be too old, never "already started"

⚠️ A FOLLOW-UP HAS NO SUBJECT OF ITS OWN (review, 2026-10-23): "how did the House Pump run this afternoon?", then
"and why did it keep starting?" — the second answer earned "Investigate this", and the press started the
investigation in a fresh conversation (a command's rule, app._converse) with only "and why did it keep starting?":
the pump was nowhere in it. The offer now keeps what the turn read, and the request is told it.

In a conversation the AI only offers: nothing runs before a person presses.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from vesta_shared.limits import limit

from . import button_data, intake
from .telegram import toast_chars

log = logging.getLogger("vesta")

#: the event the press stands for: what Home Assistant fires when a person types a command
TYPED = "telegram_command"


def question_max() -> int:
    """A question kept for a press (a Telegram message is at most 4,096)."""
    return limit("chat.offered_question_chars", 3500, unit="characters", group="ai", lo=200, hi=4000,
                 says="How much of a question an \"Investigate this\" button keeps for the investigation it starts.",
                 reached="The rest of the question is not passed on; nobody is told.", told="")


def subject(reads: list[dict], tools=()) -> str:
    """What a turn read, in one line for the request a press starts: each reading's devices (by name where the pack
    named them, with their ids) and period, once each — only the readings of `tools` (the skill's `after_reading`;
    every reading when it names none). "" when it read none."""
    parts: list[str] = []
    for r in reads or []:
        if tools and r.get("tool") not in tools:
            continue
        said = ", ".join(r.get("entities") or []) + (f" ({r['period']})" if r.get("period") else "")
        if said and said not in parts:
            parts.append(said)
    return "; ".join(parts)[:question_max()]


def typed(chat: int, user_id: int | None, name: str | None, command: str, question: str) -> dict:
    """"/<command> <question>" written by `user_id` in `chat`, as Home Assistant fires it (its words in `args`)."""
    return {"chat_id": chat, "user_id": user_id, "from_first": name, "command": f"/{command}",
            "args": question.split()}


class CommandOffers:
    def __init__(self, state, skills, gate: Callable[[str, dict], intake.Intake],
                 run: Callable[[str, dict], Awaitable], delivery):
        """`gate(event_type, message)`: intake.gate with the villa's rules (app.Vesta.gate); `run(event_type, message)`:
        what the agent does with a message that arrived (app.Vesta.handle_message)."""
        self.state, self.skills, self.gate, self.run, self.delivery = state, skills, gate, run, delivery

    def _may(self, chat: int, user_id: int | None, name: str | None, sk, question: str) -> bool:
        got = self.gate(TYPED, typed(chat, user_id, name, sk.command, question))
        return got.action == "converse" and got.invoked == sk.name

    # ------------------------------------------------------------------ shown
    def rows(self, chat: int, answer: str, asked: str, person_id: int | None, request=None,
             read=(), about: list[dict] | None = None) -> list[list[dict]]:
        """The buttons under `answer`: one per offerable command skill it names, or whose `after_reading` tools the
        turn used (`read`), for the person who asked `asked`; each keeps what those readings were about (`about`:
        Toolbox.about). None under an answer of that same skill's request (it is that investigation), none without a
        question."""
        question = " ".join((asked or "").split())[:question_max()]
        if not answer or not question:
            return []
        on = self.skills.commands()
        named: list[str] = []
        for m in intake.SKILL_TOKEN.finditer(answer):
            name = on.get(m.group(1).lower())
            if name and name not in named:
                named.append(name)
        for name in on.values():
            sk = self.skills.get(name)
            if sk is not None and set(sk.offer_after) & set(read) and name not in named:
                named.append(name)
        rows = []
        for name in named:
            sk = self.skills.get(name)
            if sk is None or not sk.offer or (request is not None and request.name == name):
                continue
            if not self._may(chat, person_id, None, sk, question):
                continue
            oid = self.state.new_command_offer(chat, name, question, person_id,
                                               subject(about or [], sk.offer_after))
            row = [{"text": sk.offer["label"], "callback_data": button_data.make(button_data.COMMAND, oid)}]
            if sk.offer.get("decline"):
                # ⚠️ IT CAN BE SAID NO TO (owner, 2026-10-20: "add a button to reject the Investigation"): the offer is
                # used up, both its buttons go, nothing runs
                row.append({"text": sk.offer["decline"], "callback_data": button_data.make(button_data.DECLINE, oid)})
            rows.append(row)
        return rows

    # ------------------------------------------------------------------ pressed
    async def press(self, p) -> None:
        """What typing "/<command> <question>" in this chat would do — once, whoever presses first, if they may."""
        offer = self.state.command_offer(p.parts[0], p.chat)
        if not offer:
            return await p.toast(_spent(self.state, p.parts[0], "Already started."))
        sk = self.skills.get(offer["skill"])
        if sk is None or not sk.command:
            return await p.toast(f"The {offer['skill']} skill is not available on this villa now.")
        if not self._may(p.chat, p.presser, p.q.get("from_first"), sk, offer["question"]):
            # judged again at the press, for the person pressing: one who may not write its command here starts nothing
            return await p.toast(f"You cannot start /{sk.command} here.")
        if not self.state.claim_command_offer(p.parts[0], p.chat):
            return await p.toast(_spent(self.state, p.parts[0], "Already started."))
        said = f"{(sk.offer or {}).get('pressed') or '/' + sk.command}: “{offer['question']}”"
        await p.toast(said[:toast_chars()])
        kept = _without_offer(p.msg, p.parts[0])
        await self.delivery.settle(p.chat, p.mid, p.msg, f"{said} ({p.person.name})",
                                   {"inline_keyboard": kept} if kept else None)
        log.info("Chat %s: %s pressed /%s on the question asked", p.chat, p.person.name, sk.command)
        await self.run(TYPED, typed(p.chat, p.presser, p.q.get("from_first"), sk.command, offer["question"]),
                       about=offer.get("about") or None)

    async def decline(self, p) -> None:
        """The offer's "No" (skill.yaml `offer: decline`): used up like a press, both its buttons gone, nothing run."""
        offer = self.state.command_offer(p.parts[0], p.chat)
        if not offer or not self.state.claim_command_offer(p.parts[0], p.chat):
            return await p.toast(_spent(self.state, p.parts[0], "Already answered."))
        sk = self.skills.get(offer["skill"])
        said = ((sk.offer or {}).get("decline") if sk else None) or "Declined"
        await p.toast(said[:toast_chars()])
        kept = _without_offer(p.msg, p.parts[0])
        await self.delivery.settle(p.chat, p.mid, p.msg, f"{said} ({p.person.name})",
                                   {"inline_keyboard": kept} if kept else None)
        log.info("Chat %s: %s declined /%s", p.chat, p.person.name, sk.command if sk else offer["skill"])


#: What a press of an offer no longer on record reads (pruned with the records): nothing ran, and nothing will.
TOO_OLD = "This button is too old now: nothing was started. Ask your question again."


def _spent(state, oid: str, used: str) -> str:
    """What a press of an offer that cannot run reads: `used` when it was used (pressed or declined), TOO_OLD when it is
    no longer on record. ⚠️ (review, 2026-10-23): an offer pruned with the records read "Already started." though
    nothing had run."""
    return used if state.command_offer_kept(oid) else TOO_OLD


def _without_offer(msg: dict, oid: str) -> list[list[dict]]:
    """The message's buttons without offer `oid`'s two (Investigate and its No): the others stay."""
    mine = {button_data.make(button_data.COMMAND, oid), button_data.make(button_data.DECLINE, oid)}
    return [r for r in [[b for b in row if b.get("callback_data") not in mine]
                        for row in ((msg.get("reply_markup") or {}).get("inline_keyboard") or [])] if r]
