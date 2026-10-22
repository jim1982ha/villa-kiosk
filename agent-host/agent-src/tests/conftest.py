"""The VESTA Agent's synthetic tests: invented entities only, run by CI.

⚠️ NOTHING FROM A REAL VILLA HERE. The tests that replay a villa's own data live
in tests/villa/ (gitignored) and run locally only.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

collect_ignore_glob = []
if not os.path.isdir(os.path.join(os.path.dirname(__file__), "villa", "fixtures")):
    collect_ignore_glob.append("villa/*")


# ⚠️ EVERY MESSAGE A PERSON IS SHOWN KEEPS THE WORDING RULES (tests/wording.py, architecture review 2026-10-22): each
# text the Telegram fake shows in any test — a message, an edit, a button, a toast — is read against the one list.
import functools  # noqa: E402

import pytest  # noqa: E402


def _shown(keyboard) -> list[str]:
    rows = (keyboard or {}).get("inline_keyboard") or [] if isinstance(keyboard, dict) else []
    return [str(b.get("text") or "") for row in rows for b in row if isinstance(b, dict)]


@pytest.fixture(autouse=True)
def _wording_of_every_message(monkeypatch, request):
    if request.node.get_closest_marker("wording_unchecked"):
        yield
        return
    from telegram_fake import FakeTelegram
    from wording import broken
    shown: list[str] = []
    send, edit, toast, buttons = FakeTelegram.send, FakeTelegram.edit, FakeTelegram.answer_callback, FakeTelegram.buttons

    @functools.wraps(send)
    async def sent(self, chat_id, text, keyboard=None, *a, **k):
        shown.extend([text, *_shown(keyboard)])
        return await send(self, chat_id, text, keyboard, *a, **k)

    @functools.wraps(edit)
    async def edited(self, chat_id, message_id, text, keyboard=None):
        shown.extend([text, *_shown(keyboard)])
        return await edit(self, chat_id, message_id, text, keyboard)

    @functools.wraps(toast)
    async def toasted(self, callback_id, text):
        shown.append(text)
        return await toast(self, callback_id, text)

    @functools.wraps(buttons)
    async def buttoned(self, chat_id, message_id, keyboard):
        shown.extend(_shown(keyboard))
        return await buttons(self, chat_id, message_id, keyboard)
    monkeypatch.setattr(FakeTelegram, "send", sent)
    monkeypatch.setattr(FakeTelegram, "edit", edited)
    monkeypatch.setattr(FakeTelegram, "answer_callback", toasted)
    monkeypatch.setattr(FakeTelegram, "buttons", buttoned)
    yield
    bad = [(t[:160], b) for t in shown if (b := broken(t))]
    assert not bad, f"a message shown on Telegram breaks the wording rules (tests/wording.py): {bad}"


def pytest_configure(config):
    config.addinivalue_line("markers", "wording_unchecked(why): a test whose messages are not held to tests/wording.py "
                                       "(it feeds a broken wording on purpose, to see it rewritten or refused)")
