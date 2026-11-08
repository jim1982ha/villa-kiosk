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
  media_edits (chat, message id, jpeg, caption, keyboard): a picture replaced (a message sent without one: "not_media")
  deleted    (chat, message id)          fetched    file ids     typing_in   chats
`refuse = {"send"}` makes send fail as Telegram does (TelegramError); `{"blocked"}` as Telegram refuses a chat (a person
who never sent /start: 403, `refused`) — `{"blocked <chat id>"}` that one chat only; `{"photo"}` only a message with a photo;
`{"second part"}` fails from a message's second part on, the first having arrived (TelegramError.delivered);
`{"delete"}` makes delete answer False (a message past Telegram's 48 hours); `{"edit"}` makes edit answer False (a network
blip); `gone` holds the messages deleted in their chat by someone else (an edit answers GONE, a delete True). Anything else reached on it — getUpdates,
leaveChat — raises: the agent must never call them.
"""
from __future__ import annotations

from vesta_agent.telegram import GONE, TelegramError, layout
from vesta_shared.messaging import tight_punctuation

BOT = {"id": 8000, "username": "Villa_Test_bot"}


class FakeTelegram:
    def __init__(self, bot: dict | None = None, audio: bytes = b""):
        self.bot, self.audio = bot or BOT, audio
        self.sent, self.photos, self.documents = [], [], []
        self.buttoned: list = []         # (chat, message, keyboard): buttons put under a message already sent
        self.toasts, self.edits, self.deleted, self.fetched, self.typing_in = [], [], [], [], []
        self.edit_keyboards = []
        self.replies: list = []            # (chat, message id, the message it answers): a send with reply_to
        self.media_edits: list = []       # (chat, message, jpeg bytes, caption, keyboard): editMessageMedia
        self.albums: list = []            # (chat, [caption, ...], the message it answers): sendMediaGroup
        self.with_photo: set = set()      # (chat, message) of every message sent with a picture (a test may add the villa's)
        self.silent: set = set()          # (chat, message) of every message sent without a sound (disable_notification)
        self.gone: set = set()            # (chat, message) deleted in the chat by someone else: Telegram finds it no more
        self.refuse: set[str] = set()
        self.next_id = 1000

    async def open(self):
        return self.bot

    async def close(self):
        pass

    async def send(self, chat_id, text, keyboard=None, document=None, photo_b64=None, reply_to=None, silent=False):
        if "blocked" in self.refuse or f"blocked {chat_id}" in self.refuse:
            raise TelegramError("sendMessage: 403 Forbidden: bot can't initiate conversation with a user", refused=True)
        if "send" in self.refuse:
            raise TelegramError("sendMessage: 400 refused by the test")
        if photo_b64 and "photo" in self.refuse:
            raise TelegramError("sendPhoto: 400 refused by the test")
        if document and photo_b64:
            raise TelegramError("one file or one photo per message")
        ids: list[int] = []
        for i, part in enumerate(layout(text, keyboard, "document" if document else "photo" if photo_b64 else None, reply_to,
                                        silent)):
            if i and "second part" in self.refuse:
                raise TelegramError("sendMessage: 429 Too Many Requests (the test)", delivered=ids)
            self.next_id += 1
            self.sent.append((chat_id, part.text, part.keyboard))
            if part.silent:
                self.silent.add((chat_id, self.next_id))
            if part.media == "photo":
                self.photos.append((chat_id, photo_b64))
                self.with_photo.add((chat_id, self.next_id))
            if part.media == "document":
                self.documents.append((chat_id, document))
            ids.append(self.next_id)
        if reply_to and ids:
            self.replies.append((chat_id, ids[0], int(reply_to)))
        return ids

    async def album(self, chat_id, photos, reply_to=None):
        """sendMediaGroup (one photo alone: a photo message, as the real one sends it)."""
        if "send" in self.refuse:
            raise TelegramError("sendMediaGroup: 400 refused by the test")
        ids = []
        for _jpeg, _cap in photos:
            self.next_id += 1
            self.with_photo.add((chat_id, self.next_id))
            ids.append(self.next_id)
        if photos:
            self.albums.append((chat_id, [cap for _j, cap in photos], reply_to))
        return ids

    async def download(self, file_id, limit=20 * 1024 * 1024):
        self.fetched.append(file_id)
        return self.audio

    async def answer_callback(self, callback_id, text):
        self.toasts.append((callback_id, text))

    async def delete(self, chat_id, message_id):
        if (chat_id, message_id) in self.gone:
            return True                      # already gone (the real one says so: telegram.Telegram.delete)
        if "delete" in self.refuse:          # Telegram's 48 hours are over: the message stays
            return False
        self.deleted.append((chat_id, message_id))
        return True

    async def typing(self, chat_id) -> bool:
        self.typing_in.append(chat_id)
        return True

    async def buttons(self, chat_id, message_id, keyboard):
        if "buttons" in self.refuse:
            return False
        self.buttoned.append((chat_id, message_id, keyboard))
        return True

    async def edit(self, chat_id, message_id, text, keyboard=None):
        if (chat_id, message_id) in self.gone:
            return GONE                      # "message to edit not found"
        if "edit" in self.refuse:
            return False
        text = tight_punctuation(text)        # as the real one (telegram.Telegram.edit)
        self.edits.append((chat_id, message_id, text))
        self.edit_keyboards.append(keyboard)             # the buttons an edit gave the message (None: they went)
        return True

    async def edit_media(self, chat_id, message_id, photo, caption, keyboard=None):
        """editMessageMedia: refused on a message that carries no picture, as Telegram refuses it ("not_media")."""
        if (chat_id, message_id) in self.gone:
            return "gone"
        if "edit" in self.refuse:
            return "refused"
        if (chat_id, message_id) not in self.with_photo:
            return "not_media"
        self.media_edits.append((chat_id, message_id, photo, tight_punctuation(caption), keyboard))
        return "shown"

    def __getattr__(self, name):          # getUpdates, leaveChat... must never be reached
        raise AssertionError(f"Telegram.{name} must never be called")
