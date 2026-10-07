"""What the agent records about the work it did, in the shapes the Costs tab reads back: one module for both sides.

⚠️ WRITTEN HERE, READ HERE (architecture review 5, 2026-10-07). app.py wrote "job:<name>" and "<person>@<chat>"
as a run's `who`, and status.py and state.py each took those strings apart their own way; the record of a job made
without the AI was a second shape written in app.py and read in status.py.
"""
from __future__ import annotations

JOB = "job:"
WITHOUT_AI = "without_ai"        # the record's kind (state.log): a job made by its code steps, the AI unavailable


def for_job(name: str) -> str:
    return JOB + name


def for_person(name: str | None, chat) -> str:
    return f"{name or 'system'}@{chat}"


def job_of(who: str) -> str | None:
    """The job a run was for; None for a conversation."""
    return who[len(JOB):] if who.startswith(JOB) else None


def person_of(who: str) -> tuple[str | None, str]:
    """(the person's name, the chat id as written) of a conversation's run."""
    name, _, chat = who.partition("@")
    return name or None, chat


def without_ai(job: str, problem: str, sent: int, failed: str | None) -> dict:
    return {"job": job, "problem": problem, "sent": sent, "failed": failed}
