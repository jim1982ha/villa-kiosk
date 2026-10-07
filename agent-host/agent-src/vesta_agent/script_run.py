"""Running one of a skill's commands, and what came of it: one module for the AI, the jobs and the page.

⚠️ ONE VERDICT, ONE RECORD (architecture review, 2026-10-06). Three callers ran a skill's script and each read
its result its own way: the scheduler and the hooks (app.code_command), the AI (tools.run_skill_script) and
Skills → Try a command (app.try_command). Each repeated "exit 0 or 2 is fine", the last stderr line, the secret
scrub and the JSON; each logged its own kind of record, and only one of them counted as a failure on the
Overview. The page then said "the answer the AI would get" of an answer made a different way.

What stays with the callers, on purpose: checking the arguments (skills.validate_script_args, before the run)
and the rules of who asks — in a chat a report runs as its job, a skill missing a tool is not run for the AI
(tools.py) — which the page does not apply: trying a command is how its owner finds out what it does.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from .skills import run_command as _fill_and_run, run_script as _run

log = logging.getLogger("vesta")

NOTHING_TO_DO = 2                 # a script's "nothing to do / a setting is missing": not a failure
AI, JOB, PAGE = "ai", "job", "page"   # who asked: the record says it


@dataclass
class ScriptAnswer:
    code: int
    stdout: str                   # secrets removed
    stderr: str                   # its last lines, secrets removed
    seconds: float

    @property
    def ok(self) -> bool:
        return self.code == 0 or (self.code == NOTHING_TO_DO and not self.usage_error)

    @property
    def usage_error(self) -> bool:
        """Python's argparse also exits 2, when the command itself is wrong ("usage: … error: the following
        arguments are required"): that is a script that did not run, not one with nothing to do. ⚠️ 0.12.67–68 ran
        every script without --pack, and the night check's refusal looked like "nothing to do" (2026-10-07)."""
        return self.code == NOTHING_TO_DO and "usage:" in self.stderr and "error:" in self.stderr

    @property
    def verdict(self) -> str:
        """done · nothing (to do, or a setting is missing) · stopped — the page shows it as it is."""
        return "done" if self.code == 0 else "nothing" if self.ok else "stopped"

    @property
    def error(self) -> str | None:
        """Why it stopped, in its own last line; None when it did not."""
        if self.ok:
            return None
        lines = self.stderr.strip().splitlines()
        return lines[-1] if lines else f"exit {self.code}"

    def result(self) -> dict:
        """Its decision (the JSON it printed), or {} when it failed or printed none."""
        if not self.ok:
            return {}
        try:
            res = json.loads(self.stdout or "{}")
        except ValueError:
            return {}
        return res if isinstance(res, dict) else {}

    def text(self) -> str:
        """What a reader gets: its output, and when it stopped, why."""
        return self.stdout if self.ok else (self.stdout + "\n" + self.stderr).strip()


def run(settings, state, skill, script: str, args: list[str], *, by: str, timeout: int = 900) -> ScriptAnswer:
    """One command with arguments already checked (skills.validate_script_args)."""
    t0 = time.monotonic()
    code, out, err = _run(settings, skill, script, args, timeout)
    return _answer(settings, state, skill, script, args, code, out, err, time.monotonic() - t0, by)


def run_command(settings, state, skill, command: str, values: dict | None = None, *, by: str = JOB,
                timeout: int = 900) -> ScriptAnswer:
    """A command the skill itself declares (skill.yaml: a code job, a hook, on_limit), its {placeholders} filled."""
    t0 = time.monotonic()
    script = command.split()[0] if command.split() else "?"
    try:
        code, out, err = _fill_and_run(settings, skill, command, values, timeout)
    except (KeyError, ValueError, IndexError) as e:
        code, out, err = 1, "", f"the command {command!r} cannot be filled ({type(e).__name__})"
    return _answer(settings, state, skill, script, command.split()[1:], code, out, err, time.monotonic() - t0, by)


def _answer(settings, state, skill, script, args, code, out, err, seconds, by) -> ScriptAnswer:
    from .tools import scrub     # tools.py runs scripts through here: imported when needed
    secrets = settings.secrets()
    ans = ScriptAnswer(code, scrub(out or "", secrets), scrub(err or "", secrets), round(seconds, 1))
    record = {"by": by, "skill": skill.name, "script": script, "args": list(args), "exit": code, "seconds": ans.seconds}
    if ans.ok:
        state.log("script", record)
    else:
        # every failure counts, whoever ran it (Overview → failures; agent_status)
        state.log("script_failed", {**record, "stderr": ans.stderr[-800:]})
        log.warning("Skill %s: %s failed (exit %s)%s", skill.name, script, code,
                    f": {ans.error[:300]}" if ans.error else "")
    if by == PAGE:
        log.info("UI: tried %s %s %s (exit %s, %.1f s)", skill.name, script, " ".join(args), code, ans.seconds)
    return ans
