"""What a person gets when the AI cannot answer at all: a report they name starts, a report they ask about is
offered as buttons, anything else gets only the reason. Pure: app.py carries it out.

⚠️ A BUTTON NEEDS NO AI (villa, 2026-10-07): "Generate the weekly report" met "out of credit", and only the AI could
have understood the words. A report's own button words (skill.yaml `button`) are what is matched — no list here:
  - the whole button text in the message ("weekly report") starts that report (0.12.73);
  - a word of 4+ letters of any button ("report", "digest") offers them all (0.12.72; 0.12.75: not for "what do you
    see in the living camera?");
  - nothing else offers anything.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import button_data
from .api_errors import AI_DOWN


@dataclass
class Offer:
    start: dict | None = None                # the job to start now
    buttons: list[dict] | None = None        # the jobs to offer, one button each


def offer(text: str, problem: str | None, jobs: list[dict]) -> Offer:
    if problem not in AI_DOWN or not jobs or not text:
        return Offer()
    low = text.lower()
    named = [j for j in jobs if j["button"].lower() in low]
    if len(named) == 1:
        return Offer(start=named[0])
    words = set(re.findall(r"\w+", low))
    if words & {w for j in jobs for w in re.findall(r"\w{4,}", j["button"].lower())}:
        return Offer(buttons=jobs)
    return Offer()


def keyboard(problem: str, jobs: list[dict]) -> dict:
    return {"inline_keyboard": [[{"text": j["button"], "callback_data": button_data.make(button_data.REPORT, problem, j["name"])}]
                                for j in jobs]}
