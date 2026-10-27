"""What the agent says of a person's act in the VESTA Kiosk — closing a fault, reopening it — the ONE wording, with who
and when the Kiosk recorded (architecture review 29: "Reopened in the Kiosk by Owner on <the tick's time>" for an alert,
"Reopened in the VESTA Kiosk by Owner on <the real time>: …" for a night fault, and "Closed in the Kiosk" without its
person when the device was still bad)."""
from __future__ import annotations

from datetime import datetime

from . import status_words as SW
from .timeutil import moment_label


# ⚠️ ONE NAME FOR THE PLACE (architecture review, 2026-10-15): one Status list read "Closed in the VESTA Kiosk by …" and
# "Ticket opened in the Cockpit by …" — the same place, two names. It is "the Cockpit", where the person did it.


def when(iso: str | None, zone: str) -> str:
    """The Kiosk's moment ("…Z") in the villa's time, as every notice writes one; "{time}" (now, filled when sent)
    when the Kiosk gave none."""
    try:
        return moment_label(datetime.fromisoformat(str(iso).replace("Z", "+00:00")), zone)
    except (TypeError, ValueError):
        return "{time}"


class Words(str):
    """A Cockpit line: the English it always was (a plain str to every reader), knowing its other languages (`langs`:
    {code: text}, status_words.LANGS) — handed on as a card's `note_in` / `status_in`, each chat showing its own
    (owner, 2026-10-23: "each chat's copy … in that chat's language"; architecture review O, 2026-10-27: the Cockpit's
    lines came in English on a card whose chat read another language)."""
    langs: dict

    def __new__(cls, en: str, langs: dict | None = None):
        out = super().__new__(cls, en)
        out.langs = {k: v for k, v in (langs or {}).items() if k != "en" and isinstance(v, str) and v}
        return out


def _every(line) -> Words:
    """`line(lang)` in every language status_words writes."""
    return Words(line("en"), {lang: line(lang) for lang in SW.LANGS if lang != "en"})


def stored(value):
    """A line as a store note keeps it: {code: text} with its "en" when it knows other languages, else its text."""
    return {"en": str(value), **value.langs} if isinstance(value, Words) and value.langs else value


def read(value) -> Words:
    """A line kept by `stored` as Words again. ⚠️ A NOTE KEPT BEFORE 0.12.364 is its English text: read as written."""
    if isinstance(value, dict):
        return Words(str(value.get("en") or ""), value)
    return value if isinstance(value, Words) else Words(str(value or ""))


def closed(by: str, iso: str | None, zone: str, end: bool = False) -> Words:
    """"Closed in the Cockpit on 11/10/2026 07:05 (Fabien)" in every language — no full stop unless `end` (a sentence
    may go on after it)."""
    at = when(iso, zone)
    return _every(lambda lang: SW.cockpit("closed", at, by, lang) + (SW.stop(lang) if end else ""))


def taken(by: str, iso: str | None, zone: str) -> Words:
    """"Ticket opened in the Cockpit on 15/10/2026 00:40 (Facility manager)." in every language — someone took an
    alert's fault on in the VESTA Kiosk ("Open Ticket"): its Telegram chase stops (owner, 2026-10-15)."""
    at = when(iso, zone)
    return _every(lambda lang: SW.cockpit("taken", at, by, lang) + SW.stop(lang))


def reopened(by: str, iso: str | None, zone: str, what: str | None = None) -> Words:
    """"Reopened in the Cockpit on 11/10/2026 07:05 (Owner): Pump weak. Please look again." in every language —
    `what` (as written) when the message carries no alert of its own (a night check's fault)."""
    at = when(iso, zone)
    return _every(lambda lang: SW.cockpit("reopened", at, by, lang)
                  + (f"{SW.colon(lang)}{what}{SW.stop(lang)}" if what else SW.stop(lang))
                  + SW.space(lang) + SW.look_again(lang))
