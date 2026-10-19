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
  pressed    once (State.claim_command_offer): said under the message, that button gone and the others kept, then
             app.handle_message runs the typed command — the same intake, the same command_request, the same reply

In a conversation the AI only offers: nothing runs before a person presses.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from . import button_data, intake

log = logging.getLogger("vesta")

#: the event the press stands for: what Home Assistant fires when a person types a command
TYPED = "telegram_command"
QUESTION_MAX = 3500                      # a question kept for a press (a Telegram message is at most 4,096)


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
    def rows(self, chat: int, answer: str, asked: str, person_id: int | None, request=None) -> list[list[dict]]:
        """The buttons under `answer`: one per offerable command skill it names, for the person who asked `asked`.
        None under an answer of that same skill's request (it is that investigation), none without a question."""
        question = " ".join((asked or "").split())[:QUESTION_MAX]
        if not answer or not question:
            return []
        on = self.skills.commands()
        named: list[str] = []
        for m in intake.SKILL_TOKEN.finditer(answer):
            name = on.get(m.group(1).lower())
            if name and name not in named:
                named.append(name)
        rows = []
        for name in named:
            sk = self.skills.get(name)
            if sk is None or not sk.offer or (request is not None and request.name == name):
                continue
            if not self._may(chat, person_id, None, sk, question):
                continue
            oid = self.state.new_command_offer(chat, name, question, person_id)
            rows.append([{"text": sk.offer["label"], "callback_data": button_data.make(button_data.COMMAND, oid)}])
        return rows

    # ------------------------------------------------------------------ pressed
    async def press(self, p) -> None:
        """What typing "/<command> <question>" in this chat would do — once, whoever presses first, if they may."""
        offer = self.state.command_offer(p.parts[0], p.chat)
        if not offer:
            return await p.toast("Already started.")
        sk = self.skills.get(offer["skill"])
        if sk is None or not sk.command:
            return await p.toast(f"The {offer['skill']} skill is not available on this villa now.")
        if not self._may(p.chat, p.presser, p.q.get("from_first"), sk, offer["question"]):
            # judged again at the press, for the person pressing: one who may not write its command here starts nothing
            return await p.toast(f"You cannot start /{sk.command} here.")
        if not self.state.claim_command_offer(p.parts[0], p.chat):
            return await p.toast("Already started.")
        said = f"{(sk.offer or {}).get('pressed') or '/' + sk.command}: “{offer['question']}”"
        await p.toast(said[:190])
        pressed = p.q.get("data")
        kept = [r for r in [[b for b in row if b.get("callback_data") != pressed]
                            for row in ((p.msg.get("reply_markup") or {}).get("inline_keyboard") or [])] if r]
        await self.delivery.settle(p.chat, p.mid, p.msg, f"{said} ({p.person.name})",
                                   {"inline_keyboard": kept} if kept else None)
        log.info("Chat %s: %s pressed /%s on the question asked", p.chat, p.person.name, sk.command)
        await self.run(TYPED, typed(p.chat, p.presser, p.q.get("from_first"), sk.command, offer["question"]))
