"""One AI turn: who asks → what the run may use, its brain, its limit, its record, its folder → the SDK → one result.

⚠️ DECIDED ONCE (architecture review 14, 2026-10-10). A chat's turn (app._converse) and a report (ai_jobs.AiJobs.run)
each assembled a run by hand: read the tool list, ask tool_access, build a Toolbox, read its names, pass who / limit
/ profile — and runner.run then chose the brain again itself (a profile, else the chat's model) and read the reply
limit a third time. A report asked for in the facility manager's chat was given the skill's tools, not the person's.
Here the TERMS of a run are decided from who asks (chat_terms, job_terms: plain values, tested as such), the run gets
its own folder (config.Settings.in_folder), and the caller gets one TurnResult: the answer, the pictures the AI
looked at, a problem in api_errors' words, whether it stopped at its limit. The owner is told here when no retry can
help (credit, key), whoever asked.

    Terms                              tools · profile (→ model, effort) · limit_usd · who (the record)
    chat_terms(settings, policy, …)    a person in a chat: their role, that chat, the villa's chat brain and limit
    job_terms(policy, …, cfg, origin)  a report: who asked it (origin.role), else SYSTEM; its own brain and limit
    Turns.chat(...) / Turns.job(...)   the run itself
"""
from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Awaitable, Callable

from vesta_shared import agent_records

from . import runner, tool_access
from .policy import PROFILES
from .routing import CONVERSATION, Origin


@dataclass(frozen=True)
class Terms:
    """What one run may do and how it is recorded: decided once, before the run."""
    tools: frozenset[str]          # tool_access keys this run may use (tool_access.allowed_for)
    profile: str                   # policy.PROFILES key: its model and effort
    limit_usd: float               # the run stops here (max_budget_usd)
    who: str                       # agent_records: whose run it is in the Costs tab
    # the skill the run was started for (a scheduled job's, or the command skill a person called): the first of the
    # Costs tab's "Skills" for that run, before those the AI read or ran (runner.Collector.skills)
    skill: str | None = None

    @property
    def model(self) -> str:
        return PROFILES[self.profile][0]

    @property
    def effort(self) -> str:
        return PROFILES[self.profile][1]


@dataclass
class TurnResult:
    text: str
    session_id: str | None
    stopped_at_limit: bool
    cost_usd: float | None
    problem: str | None            # api_errors' word for why it failed ("credit", "offline", …), None when it ran
    error: str | None
    photos: list[tuple[str, str]] = field(default_factory=list)   # (base64, mime) the AI looked at, each once
    limit_usd: float = 0.0         # the limit it ran under (its Terms): what "Stopped at the limit" says
    approvals: list[str] = field(default_factory=list)   # the approval requests it sent (Toolbox.approvals)
    sent: int = 0                  # messages its send_message delivered (Toolbox.sent)
    attached: list[str] = field(default_factory=list)   # the files they carried (Toolbox.attached)
    offered: int = 0               # faults it offered (Toolbox.offered)
    pages: dict[str, int] = field(default_factory=dict)   # a file sent → its message (Toolbox.pages)
    earlier: str = ""              # RunResult.earlier
    read: list[str] = field(default_factory=list)   # the reading tools it used, each once (Toolbox.read)

    @property
    def failed(self) -> bool:
        """Nothing usable came back: a known problem, or an error with no answer."""
        return bool(self.problem or (self.error and not self.text))

    def then(self, again: "TurnResult") -> "TurnResult":
        """This turn followed by `again`, a follow-up on the same request (app._delivered): one result, each field by
        its rule in THEN.

        ⚠️ EVERY FIELD HAS A RULE (architecture review, 2026-10-13): the follow-up was merged by hand, field by field —
        it once lost its stop at the limit (no Continue, review 32), and a field added later would have been dropped
        without a word. A field without a rule fails the test that holds THEN to this class."""
        return TurnResult(**{f.name: THEN[f.name](getattr(self, f.name), getattr(again, f.name)) for f in fields(self)})


def _first(a, b):
    return a or b


def _latest(a, b):
    return b or a


def _summed_cost(a, b):
    return (a or 0) + (b or 0) if (a or b) else None


#: How a follow-up turn's field joins the first turn's (TurnResult.then): what was said first is the answer, what the
#: follow-up ended on is where the request stands, what both did is added up.
THEN = {
    "text": _first, "earlier": _latest, "session_id": _latest, "limit_usd": _latest,
    "stopped_at_limit": lambda a, b: b, "problem": lambda a, b: b, "error": lambda a, b: b,
    "cost_usd": _summed_cost, "sent": lambda a, b: a + b, "offered": lambda a, b: a + b,
    "photos": lambda a, b: a + b, "approvals": lambda a, b: a + b, "attached": lambda a, b: a + b,
    "pages": lambda a, b: {**a, **b}, "read": lambda a, b: a + [t for t in b if t not in a],
}


def chat_terms(settings, policy, server_tools: list[dict], person, chat: int, brain: str | None = None,
               limit_usd: float | None = None, skill: str | None = None) -> Terms:
    """A person answered in a chat: what THEY may use there, the villa's chat brain and reply limit — or the brain and
    limit the command skill it was called for names (skills.Skill.brain / limit_usd)."""
    return Terms(frozenset(tool_access.allowed_for(policy, server_tools, person.role if person else None, chat)),
                 brain or settings.profile, float(limit_usd if limit_usd is not None else settings.reply_limit_usd),
                 agent_records.for_person(person.name if person else None, chat), skill)


def job_terms(policy, server_tools: list[dict], name: str, cfg: dict, origin: Origin | None,
              skill: str | None = None) -> Terms:
    """A skill's AI job: what the person who asked for it may use (origin.role, in origin.chat) — SYSTEM when it runs
    on schedule — never the skill's own list (owner, 2026-10-10); its brain and limit are policy.yaml's for the job."""
    role = (origin.role if origin else tool_access.SYSTEM)
    return Terms(frozenset(tool_access.allowed_for(policy, server_tools, role, origin.chat if origin else None)),
                 cfg["profile"], float(cfg["limit_usd"]), agent_records.for_job(name), skill)


class Turns:
    def __init__(self, settings, state, policy: Callable, *, server_tools: Callable[[], Awaitable[list]],
                 toolbox: Callable, system_prompt: Callable[[], str],
                 tell_owner: Callable[[str | None, list[int]], Awaitable[None]],
                 safe: Callable[[Awaitable], Awaitable[None]]):
        self.s, self.state, self.policy = settings, state, policy
        self.server_tools, self.toolbox, self.system_prompt = server_tools, toolbox, system_prompt
        self.tell_owner, self._safe = tell_owner, safe

    async def chat(self, person, chat: int, prompt: str, *, resume: str | None = None,
                   asked: str | None = None, image: tuple[str, str] | None = None,
                   request=None) -> TurnResult:
        """A person's message (or a Continue) answered in `chat`. The chat keeps one folder: its turns take turns
        (app.lock), and a Continue reads what the turn before it saved. `request`: the command skill's request it answers
        (command_request.Request): its skill's own brain and limit, its id and web searches for the toolbox."""
        terms = chat_terms(self.s, self.policy(), await self.server_tools(), person, chat,
                           request.brain if request else None, request.limit_usd if request else None,
                           request.name if request else None)
        return await self._run(terms, self.s.in_folder(f"chats/{chat}"), prompt, person,
                               Origin(chat, CONVERSATION, role=person.role if person else None),
                               resume, asked, [chat], image, request)

    async def job(self, name: str, cfg: dict, prompt: str, origin: Origin | None, run_settings,
                  told: list[int], skill: str | None = None) -> TurnResult:
        """A skill's AI job, in `run_settings`' folder (the one its code steps use after it). `told`: the chats its
        result goes to, so the owner is not told twice in the same chat. `skill`: the skill that declares it."""
        terms = job_terms(self.policy(), await self.server_tools(), name, cfg, origin, skill)
        return await self._run(terms, run_settings, prompt, None, origin, None, None, told)

    async def _run(self, terms: Terms, run_settings, prompt, person, origin, resume, asked, told: list[int],
                   image=None, request=None) -> TurnResult:
        tb = self.toolbox(set(terms.tools), run_settings, request)
        kit = tb.for_run(person, origin)
        res = await runner.run(run_settings, self.system_prompt(), prompt, kit, terms, self.state, resume=resume, asked=asked,
                               image=image)
        out = TurnResult(res.text, res.session_id, res.stopped_at_limit, res.cost_usd, res.problem, res.error,
                         list(tb.photos), terms.limit_usd, list(tb.approvals), sent=getattr(tb, "sent", 0),
                         earlier=getattr(res, "earlier", ""), attached=list(getattr(tb, "attached", [])),
                         offered=len(getattr(tb, "offered", [])), pages=dict(getattr(tb, "pages", {})),
                         read=list(getattr(tb, "read", [])))
        if out.problem:
            # no credit, a refused key: every reply and report stops until the owner acts (app._tell_owner decides)
            await self._safe(self.tell_owner(out.problem, told))
        return out
