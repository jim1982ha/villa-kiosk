"""Running one of a skill's commands, and what came of it: one module for the AI, the jobs and the page.

⚠️ ONE VERDICT, ONE RECORD (architecture review, 2026-10-06). Three callers ran a skill's script and each read
its result its own way: the scheduler and the hooks (app.code_command), the AI (tools.run_skill_script) and
Skills › Offline Test (app.try_command). Each repeated "exit 0 or 2 is fine", the last stderr line, the secret
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

from vesta_shared.ha_client import error_chars
from vesta_shared.limits import limit
from vesta_shared.script import READS

from .skills import run_command as _fill_and_run, run_script as _run, script_timeout_s

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
    def verdict_words(self) -> str:
        """The verdict as a person reads it (the page wrote these itself, architecture review 9)."""
        return {"done": "Done", "nothing": "Nothing to do, or a setting is missing"}.get(self.verdict, f"Stopped (exit {self.code})")

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


#: The exit a script gets when the agent stops (SIGTERM): stopped with it, never a failure.
STOPPED_BY_SIGTERM = -15

def run(settings, state, skill, script: str, args: list[str], *, by: str, timeout: int | None = None) -> ScriptAnswer:
    """One command with arguments already checked (skills.validate_script_args)."""
    t0 = time.monotonic()
    if by == AI:
        # ⚠️ A SCRIPT RUNNING IS SEEN WHILE IT RUNS (retro, 2026-10-15): only its end was logged ("took 40.9 s"), so a
        # script reading the logbook for minutes was invisible — and its calls were blamed on the AI's own tool
        log.info("Skill %s: %s %s started", skill.name, script, (args[0] if args else ""))
    code, out, err = _run(settings, skill, script, args, timeout or script_timeout_s())
    return _answer(settings, state, skill, script, args, code, out, err, time.monotonic() - t0, by)


def run_command(settings, state, skill, command: str, values: dict | None = None, *, by: str = JOB,
                timeout: int | None = None) -> ScriptAnswer:
    """A command the skill itself declares (skill.yaml: a code job, a hook, on_limit), its {placeholders} filled."""
    t0 = time.monotonic()
    script = command.split()[0] if command.split() else "?"
    try:
        code, out, err = _fill_and_run(settings, skill, command, values, timeout or script_timeout_s())
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
    elif code == STOPPED_BY_SIGTERM:
        # ⚠️ STOPPED WITH THE AGENT, NOT FAILED (owner, 2026-10-15: "2 failures" were the two investigations' scripts
        # ended by the agent's updates): its run is on the Costs tab as "stopped by a restart"
        state.log("script_stopped", record)
        log.info("Skill %s: %s stopped with the agent", skill.name, script)
    else:
        # every failure counts, whoever ran it (Overview → failures; agent_status)
        kept = limit("errors.script_stderr_chars", 800, unit="characters", group="keep", lo=100, hi=20000,
                     says="How much of a failed script's own error output is kept (Overview › failures).",
                     reached="Only its end is kept.", told="")
        state.log("script_failed", {**record, "stderr": ans.stderr[-kept:]})
        log.warning("Skill %s: %s failed (exit %s)%s", skill.name, script, code,
                    f": {ans.error[:error_chars()]}" if ans.error else "")
    if by == PAGE:
        log.info("UI: tried %s %s %s (exit %s, %.1f s)", skill.name, script, " ".join(args), code, ans.seconds)
    elif ans.ok:
        # ⚠️ WHERE AN ANSWER'S TIME GOES (owner, 2026-10-11: "i had to wait for almost 20 min"): each script's own
        # duration in the log, beside the run's total — the records hold it too, but the log is what can be read
        reads = next((ln[len(READS):] for ln in reversed(ans.stderr.splitlines()) if ln.startswith(READS)), "")
        log.info("Skill %s: %s %s took %.1f s%s", skill.name, script, (args[0] if args else ""), ans.seconds,
                 f" ({reads})" if reads else "")
    return ans
