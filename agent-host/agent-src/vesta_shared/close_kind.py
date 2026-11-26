"""A person's close of an alert — ONE place says what each kind promises: Done, No action needed, Not a problem.

Telegram's buttons, the VESTA UI's notice and the Cockpit's card hand over only which kind was pressed (`of_button`,
`of_step`); the alert's life (alert_watch.close), its task (Problems) and the alert desk read the promise from it.
The words stay where they are (message_format's tables, status_words, the desk's words.yaml), keyed by `words`.

⚠️ ONE KIND OF CLOSE, NOT A YES/NO IN SIX PLACES (architecture review, 2026-11-26): "Not a problem" travelled as
`lasting=True` here, `read_again=False` there, turned back into `lasting=not read_again` four times, and the
Cockpit's "No action needed" was a third flag (`nothing`) the reply's words never read ("Done in the Cockpit" for it).
In the week to 2026-11-23 "Not a problem" changed six times, each one editing the desk, the alert's life, the faults
and the engine; one change (watch it again at the next repeat) was undone the next day.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Close:
    """A kind of close by a person. `name`: the button's option, as Telegram and the VESTA UI send it. `words`: its key
    in the wording tables (message_format.COCKPIT, status_words "cockpit"). `read_again`: the desk reads the alert again
    after its wait (quiet_after_done; still there, it reopens) and it is watched as every close. `holds`: it holds while
    the problem lasts — never watched, never read again, its rule's repeats recorded only (alert_watch.LASTING), the
    rule told to stop repeating it (the desk's quiet_rule), its task closed "Not a problem" — until the villa's
    all-clear, or a day with no repeat and the device no longer read bad."""
    name: str
    words: str
    read_again: bool
    holds: bool

    def __str__(self) -> str:
        return self.name


#: "Done": the person fixed it; read again after the desk's wait, watched for coming back
DONE = Close("done", "closed", read_again=True, holds=False)
#: "No action needed" (the Cockpit's own button): closed with nothing done, read again and watched as a Done
NOTHING = Close("nothing", "nothing", read_again=True, holds=False)
#: "Not a problem" (while it lasts): the person accepts it as it is (owner, 2026-11-20 to 2026-11-23, #201, #210, #225)
NOT_A_PROBLEM = Close("not_a_problem", "lasting", read_again=False, holds=True)
KINDS = (DONE, NOTHING, NOT_A_PROBLEM)


def of_button(option: str) -> Close | None:
    """The kind of close a button of an alert stands for (Telegram, the VESTA UI's notice), None for a button that does
    not close it (Need help, Open Ticket)."""
    return next((k for k in (DONE, NOT_A_PROBLEM) if k.name == option), None)


def of_step(lasting: bool, cleared: bool) -> Close:
    """The kind of a person's close on a Cockpit card, from its step: `lasting` "Not a problem", else `cleared` (the
    agreement's close with no work done) "No action needed", else a Done."""
    return NOT_A_PROBLEM if lasting else NOTHING if cleared else DONE
