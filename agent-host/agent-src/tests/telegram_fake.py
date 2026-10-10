"""The in-memory adapter of vesta_agent.telegram.Telegram: the one every test uses.

⚠️ ONE FAKE, HELD TO THE REAL ONE'S INTERFACE (architecture review, 2026-10-06). There were four hand-written
fakes; each new method (typing) or argument (photo_b64) had to be added to each by hand, and a fake left behind
hid failures. tests/test_telegram_fake.py fails when this class and Telegram stop having the same public methods
with the same parameters.

⚠️ IT SENDS WHAT telegram.layout SAYS, LIKE THE REAL ONE (architecture review 15): it kept rules of its own (one id,
the buttons kept with a file the real one dropped), so tests passed on what the villa never saw.

What it records, in the order it happened:
  sent       (chat, text, keyboard)      every message Telegram would show, each part of a long one, a caption included
  photos     (chat, (base64, mime))      documents  (chat, path)
  toasts     (callback id, text)         edits      (chat, message id, text)
  deleted    (chat, message id)          fetched    file ids     typing_in   chats
`refuse = {"send"}` makes send fail as Telegram does (TelegramError); `{"photo"}` only a message with a photo;
`{"second part"}` fails from a message's second part on, the first having arrived (TelegramError.delivered);
`{"delete"}` makes delete answer False (a message past Telegram's 48 hours). Anything else reached on it — getUpdates,
leaveChat — raises: the agent must never call them.
"""
from __future__ import annotations

from vesta_agent.telegram import TelegramError, layout

BOT = {"id": 8000, "username": "Villa_Test_bot"}


class FakeTelegram:
    def __init__(self, bot: dict | None = None, audio: bytes = b""):
        self.bot, self.audio = bot or BOT, audio
        self.sent, self.photos, self.documents = [], [], []
        self.toasts, self.edits, self.deleted, self.fetched, self.typing_in = [], [], [], [], []
        self.edit_keyboards = []
        self.refuse: set[str] = set()
        self.next_id = 1000

    async def open(self):
        return self.bot

    async def close(self):
        pass

    async def send(self, chat_id, text, keyboard=None, document=None, photo_b64=None, reply_to=None):
        if "send" in self.refuse:
            raise TelegramError("sendMessage: 400 refused by the test")
        if photo_b64 and "photo" in self.refuse:
            raise TelegramError("sendPhoto: 400 refused by the test")
        if document and photo_b64:
            raise TelegramError("one file or one photo per message")
        ids: list[int] = []
        for i, part in enumerate(layout(text, keyboard, "document" if document else "photo" if photo_b64 else None, reply_to)):
            if i and "second part" in self.refuse:
                raise TelegramError("sendMessage: 429 Too Many Requests (the test)", delivered=ids)
            self.next_id += 1
            self.sent.append((chat_id, part.text, part.keyboard))
            if part.media == "photo":
                self.photos.append((chat_id, photo_b64))
            if part.media == "document":
                self.documents.append((chat_id, document))
            ids.append(self.next_id)
        return ids

    async def download(self, file_id, limit=20 * 1024 * 1024):
        self.fetched.append(file_id)
        return self.audio

    async def answer_callback(self, callback_id, text):
        self.toasts.append((callback_id, text))

    async def delete(self, chat_id, message_id):
        if "delete" in self.refuse:          # Telegram's 48 hours are over: the message stays
            return False
        self.deleted.append((chat_id, message_id))
        return True

    async def typing(self, chat_id) -> bool:
        self.typing_in.append(chat_id)
        return True

    async def edit(self, chat_id, message_id, text, keyboard=None):
        self.edits.append((chat_id, message_id, text))
        self.edit_keyboards.append(keyboard)             # the buttons an edit gave the message (None: they went)
        return True

    def __getattr__(self, name):          # getUpdates, leaveChat... must never be reached
        raise AssertionError(f"Telegram.{name} must never be called")
