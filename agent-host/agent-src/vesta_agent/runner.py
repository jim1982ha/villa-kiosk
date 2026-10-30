"""One run of the model: a message from a person, a scheduled job, or a Continue.

The model process (the Claude CLI started by the Agent SDK) gets:
  - no built-in tool (tools=[]): no shell, no file, no web fetch — except Claude's own
    WebSearch when policy.yaml's `settings.web_search` is on (an Anthropic server tool:
    it reads the web, never this machine);
  - one MCP server, VESTA's own, built for this run (tools.py);
  - a can_use_tool callback and a PreToolUse hook, both default-deny, which allow
    only the names that server offers for this run;
  - an empty working directory and no settings files (setting_sources=[]);
  - only the Anthropic key in its environment.
Every tool call is therefore decided by the code, never pre-approved.
"""

from __future__ import annotations

import asyncio
import time
import logging
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import json

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher,
                              PermissionResultAllow, PermissionResultDeny, ResultMessage, TextBlock, ToolUseBlock)

from .api_errors import NO_RETRY, classify
from .redact import scrub
from vesta_shared.limits import limit
from vesta_shared.agent_records import RUN, RUN_CUT, run_cost, session_before, turn_cost

log = logging.getLogger("vesta.runner")

WEB_SEARCH = "WebSearch"


def max_steps() -> int:
    """The tools one run used, as the Costs tab shows them (a report uses about 20)."""
    return limit("costs.steps_kept", 40, unit="steps", group="keep", lo=5, hi=1000,
                 says="The steps of one AI run kept for the Costs tab.",
                 reached="Later steps of that run are not listed.", told="")
# the tools that use a skill, their `skill` argument naming it (tools.Toolbox: read_skill, run_skill_script)
SKILL_TOOLS = ("read_skill", "run_skill_script")

# Named anyway, in case a future CLI adds a tool while tools=[] is set.
BUILTIN_DENY = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep",
                "LS", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "Skill", "SlashCommand", "ExitPlanMode",
                "ListMcpResourcesTool", "ReadMcpResourceTool"]


# The CLI inherits this process's environment. Only neutral variables stay: a
# variable can switch on tools (for example a browser integration) or carry a
# token (SUPERVISOR_TOKEN in an add-on). Found by the end-to-end test.
KEEP_ENV = {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
            "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "ANTHROPIC_BASE_URL",
            "PYTHONPATH"}


def clean_environ() -> list[str]:
    import os
    removed = [k for k in list(os.environ) if k not in KEEP_ENV]
    for k in removed:
        os.environ.pop(k, None)
    return removed


@dataclass
class RunResult:
    text: str
    session_id: str | None
    stopped_at_limit: bool
    cost_usd: float | None
    denied: list[str]
    error: str | None = None
    # why it failed, in one word (api_errors.classify): what the person is told, never the raw error
    problem: str | None = None
    earlier: str = ""              # Collector.earlier: the last text before a tool call, for a run that sent nothing


class Collector:
    """What one run's message stream says: the answer, and — when Anthropic failed — why.

    ⚠️ A FAILED API CALL ALSO ARRIVES AS TEXT: the CLI turns it into an AssistantMessage whose
    `error` is set and whose text is the raw "API Error: 400 {...credit balance is too low...}".
    That text is the error's, never the answer: it is read for the reason and never sent."""

    def __init__(self, session_id: str | None = None):
        self.texts: list[str] = []
        # ⚠️ THE ANSWER IS WHAT IT WRITES AFTER ITS LAST TOOL CALL (owner, 2026-10-11): every text of the run was joined,
        # so the person read "Let me first read the investigate skill… Now let me send this to the FM…" and the report
        # twice. A text followed by a tool call is the AI working; a new tool call starts the answer afresh.
        self.segments: list[list[str]] = [[]]
        self.steps: list[dict] = []          # each tool the AI called: its name, and what it asked, in short
        self.skills: list[str] = []          # the skills it read or ran a script of, in order, once each (skills_of)
        self.session_id, self.stopped, self.cost, self.err = session_id, False, None, None
        self.usage, self.turns, self.ms = {}, None, None
        self.kind, self.status, self.exc_name, self.raw = None, None, None, ""
        # each model message's own token counts, by message — what a run cut before its end had used (partial_tokens)
        self.by_message: dict[str, dict] = {}

    def feed(self, msg) -> None:
        if isinstance(msg, AssistantMessage):
            if isinstance(getattr(msg, "usage", None), dict):
                self.by_message[getattr(msg, "message_id", None) or str(len(self.by_message))] = msg.usage
            words = [b.text.strip() for b in msg.content if isinstance(b, TextBlock) and b.text.strip()]
            if getattr(msg, "error", None):
                self.kind = msg.error
                self.raw += " ".join(words)
                return
            for b in msg.content:
                if isinstance(b, ToolUseBlock):
                    if len(self.steps) < max_steps():
                        self.steps.append(step(b.name, b.input))
                    if tool_key(b.name) in SKILL_TOOLS and isinstance(b.input, dict) and b.input.get("skill"):
                        self.skills.append(str(b.input["skill"])[:60])
                    if self.segments[-1]:
                        self.segments.append([])
                elif isinstance(b, TextBlock) and b.text.strip():
                    self.segments[-1].append(b.text.strip())
            self.texts += words
        elif isinstance(msg, ResultMessage):
            self.session_id = msg.session_id or self.session_id
            self.cost = msg.total_cost_usd
            self.usage, self.turns, self.ms = msg.usage or {}, msg.num_turns, msg.duration_ms
            self.stopped = msg.subtype == "error_max_budget_usd"
            if msg.is_error and not self.stopped:
                self.err = msg.subtype if msg.subtype != "success" else f"api error {msg.api_error_status}"
                self.status = getattr(msg, "api_error_status", None) or self.status
                self.raw += " " + (msg.result or "") + " " + " ".join(getattr(msg, "errors", None) or [])

    def partial_tokens(self) -> dict:
        """The tokens of the model messages received so far — a run cut before its end gets no final count."""
        keys = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        return {k: sum(int(u.get(k) or 0) for u in self.by_message.values()) for k in keys}

    @property
    def answer(self) -> str:
        """The text written after the last tool call ("" when the run ended on one: its message said it all)."""
        return "\n\n".join(self.segments[-1]).strip()

    @property
    def earlier(self) -> str:
        """The last text written before a tool call: said only when nothing else reached the person (app._converse)."""
        return "\n\n".join(next((seg for seg in reversed(self.segments[:-1]) if seg), [])).strip()

    def fail(self, e: BaseException) -> None:
        """An exception from the SDK or the network. ResultError carries the API's status and prose."""
        self.err = type(e).__name__
        self.exc_name = type(e).__name__
        self.status = getattr(e, "api_error_status", None) or self.status
        self.raw += " " + str(getattr(e, "result", "") or "") + " " + str(e)

    @property
    def problem(self) -> str | None:
        if not (self.err or self.kind):
            return None
        return classify(self.kind, self.status, self.raw, self.exc_name)


def tool_key(name: str) -> str:
    """A tool as the page names it: "mcp__vesta__ha_get_state" → "ha_get_state", "WebSearch" → "web_search"."""
    if name == WEB_SEARCH:
        return "web_search"
    return name.rsplit("__", 1)[-1]


def step(name: str, args) -> dict:
    """One tool call, for the record: what was called and with what — its arguments kept as they were, each value
    bounded (an answer or a file's content can hold anything). The Costs tab says them in a line
    (status.step_summary); the record keeps the arguments, so a better line never needs a new record.

    ⚠️ ARGUMENTS, NOT A LINE (owner, 2026-10-19): the record held a 160-character line made here, a script's string
    `args` spread letter by letter ("[ " - - p e r i o d …") and every other tool as cut JSON."""
    args = dict(args or {}) if isinstance(args, dict) else {}
    args.pop("vesta_part", None)
    return {"tool": tool_key(name), "args": _bounded(args)}




def arg_chars() -> int:
    """One argument value as a run's record keeps it (a file's content, a message's text: their start)."""
    return limit("costs.arg_chars", 300, unit="characters", group="keep", lo=40, hi=20000,
                 says="How much of each value a step of a run used is kept for the Costs tab.",
                 reached="The rest is cut, with \"…\".", told="person")


def arg_items() -> int:
    """The items of a list argument kept (a service call's entities)."""
    return limit("costs.arg_items", 25, unit="items", group="keep", lo=5, hi=1000,
                 says="How many items of a list a step of a run used are kept for the Costs tab.",
                 reached="Later items are not kept.", told="")


def _bounded(v, depth: int = 0):
    """`v` with every text cut to arg_chars(), every list to arg_items(), nothing deeper than three levels."""
    if isinstance(v, str):
        most = arg_chars()
        return v if len(v) <= most else v[:most] + "…"
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    if depth >= 3:
        return _bounded(json.dumps(v, ensure_ascii=False, default=str), depth)
    if isinstance(v, dict):
        return {str(k): _bounded(x, depth + 1) for k, x in list(v.items())[:arg_items()]}
    if isinstance(v, (list, tuple)):
        return [_bounded(x, depth + 1) for x in list(v)[:arg_items()]]
    return _bounded(str(v), depth)


def make_guard(allowed: set[str], state, who: str, searched: list | None = None):
    """`searched`: the run's web searches, each query added as it is made (tools.Kit.searched)."""
    denied: list[str] = []

    async def can_use_tool(tool_name, tool_input, context):
        if tool_name in allowed:
            return PermissionResultAllow()
        denied.append(tool_name)
        state.log("tool_denied", {"tool": tool_name, "who": who})
        return PermissionResultDeny(message=f"{tool_name} does not exist for VESTA.", interrupt=False)

    async def pre_tool_use(input_data, tool_use_id, context):
        name = (input_data or {}).get("tool_name", "")
        if name in allowed:
            if name == WEB_SEARCH and searched is not None:
                searched.append(str(((input_data or {}).get("tool_input") or {}).get("query") or "")[:limit(
                    "ai.web_search_chars", 160, unit="characters", group="keep", lo=40, hi=2000,
                    says="How much of each web search's words is kept as a page's source.",
                    reached="The rest of the words is cut.", told="")])
            return {}
        if name not in denied:
            denied.append(name)
            state.log("tool_denied", {"tool": name, "who": who, "by": "hook"})
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                       "permissionDecisionReason": f"{name} does not exist for VESTA."}}

    return can_use_tool, pre_tool_use, denied


def build_options(settings, system_prompt: str, kit, terms, state,
                  resume: str | None) -> tuple[ClaudeAgentOptions, list[str]]:
    """The SDK's options for one run: `kit` the tools it was built (tools.Kit), `terms` what it may do (turn.Terms) —
    the brain and the limit are the terms', never chosen here (architecture review 14)."""
    server, allowed = kit.server, kit.names
    can_use_tool, pre_hook, denied = make_guard(allowed, state, terms.who, getattr(kit, "searched", None))
    # WebSearch exists for the CLI only when this run allows it; every other built-in stays off and denied.
    web = WEB_SEARCH in allowed
    opts = ClaudeAgentOptions(
        tools=[WEB_SEARCH] if web else [],
        allowed_tools=[],
        disallowed_tools=[t for t in BUILTIN_DENY if not (web and t == WEB_SEARCH)],
        mcp_servers={"vesta": server},
        strict_mcp_config=True,
        can_use_tool=can_use_tool,
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[pre_hook])]},
        system_prompt=system_prompt,
        setting_sources=[],
        cwd=settings.work_dir,
        env={"ANTHROPIC_API_KEY": settings.anthropic_api_key,
             # sessions kept under the data folder so a conversation survives a restart of the app
             "CLAUDE_CONFIG_DIR": settings.claude_dir,
             "DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"},
        model=terms.model,
        effort=terms.effort,
        max_budget_usd=float(terms.limit_usd),
        resume=resume,
    )
    return opts, denied


def skills_of(started_for: str | None, used: list[str]) -> list[str]:
    """The Costs tab's "Skills" of a run (owner, 2026-10-19): the skill it was started for (a job's, a command's), then
    each one the AI read or ran a script of — in order, once each."""
    return list(dict.fromkeys([*([started_for] if started_for else []), *used]))


def _secrets(settings) -> list[str]:
    return settings.secrets() if hasattr(settings, "secrets") else []


def kept_steps(steps: list[dict], secrets: list[str]) -> list[dict]:
    """The tool calls kept with a run (the Costs tab), through the one scrubber (redact.py). Scrubbed as one text,
    so a "password" key and its value are caught together; each text again if that text no longer reads back."""
    out = []
    for st in steps:
        text = json.dumps(st.get("args") or {}, ensure_ascii=False, default=str)
        try:
            args = json.loads(scrub(text, secrets))
        except ValueError:
            args = _scrub_each(st.get("args") or {}, secrets)
        out.append({**st, "args": args})
    return out


def _scrub_each(v, secrets: list[str]):
    if isinstance(v, str):
        return scrub(v, secrets)
    if isinstance(v, dict):
        return {k: _scrub_each(x, secrets) for k, x in v.items()}
    if isinstance(v, list):
        return [_scrub_each(x, secrets) for x in v]
    return v


# ⚠️ THE QUESTION WHOLE (owner, 2026-10-19): the Costs tab showed what was asked cut at 160 characters, mid-word, its
# tooltip too. 2,000 keeps any question a person types or says whole (a long voice message is about 1,000), and still
# bounds a pasted page in a record kept for a year (runs_days) and served 300 rows at a time.


def asked_chars() -> int:
    return limit("costs.asked_chars", 2000, unit="characters", group="keep", lo=200, hi=50000,
                 says="How much of a question is kept with its run, as the Costs tab shows it.",
                 reached="The rest of the question is not kept.", told="")


def kept_asked(asked: str | None, secrets: list[str]) -> str | None:
    """What was asked, as a run's record keeps it: whole up to asked_chars(), through the one scrubber."""
    return scrub((asked or "")[:asked_chars()], secrets) or None


def with_time(settings, prompt: str, now: datetime | None = None) -> str:
    """The message with the villa's date and time at its head. ⚠️ HERE, NOT IN THE INSTRUCTIONS (2026-10-09): the
    instructions are the cached prefix of every run; a clock in them changed it every minute, and each message of a
    chat re-sent the whole conversation at full price instead of reading it from the cache."""
    now = now or datetime.now(ZoneInfo(settings.timezone))
    return f"[Villa time: {now:%A %d %B %Y, %H:%M}]\n{prompt}"


def message(prompt: str, image: tuple[str, str] | None = None):
    """What the SDK is sent: the text, or — with a photo a person sent (base64, mime) — one message holding the picture
    and the text, so the AI looks at it (owner, 2026-10-10)."""
    if image is None:
        return prompt

    async def one():
        data, mime = image
        yield {"type": "user", "parent_tool_use_id": None,
               "message": {"role": "user", "content": [
                   {"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}},
                   {"type": "text", "text": prompt}]}}
    return one()


async def run(settings, system_prompt: str, prompt: str, kit, terms, state, resume: str | None = None,
              asked: str | None = None, image: tuple[str, str] | None = None) -> RunResult:
    """One run: `kit` its built tools (tools.Toolbox.for_run), `terms` its brain, limit and record (turn.Terms);
    `image` a photo the person sent with the message (base64, mime)."""
    clean_environ()
    opts, denied = build_options(settings, system_prompt, kit, terms, state, resume)
    c = Collector(resume)
    # ⚠️ THE AI'S OWN START, TIMED (owner, 2026-10-30: about 5 s passed before a spoken question's first step): the AI
    # program started and ready (`ready`), its first reply after the question (`first`), the run whole
    began = time.monotonic()
    ready = first = None
    try:
        async with ClaudeSDKClient(options=opts) as client:
            ready = time.monotonic()
            await client.query(message(with_time(settings, prompt), image))
            async for msg in client.receive_response():
                if first is None and type(msg).__name__ == "AssistantMessage":
                    first = time.monotonic()
                c.feed(msg)
    except asyncio.CancelledError:
        # ⚠️ A RUN CUT BY A STOP IS A RUN (owner, 2026-10-15: two /investigate cut by updates were missing from the Costs
        # tab, though Anthropic billed them): recorded with what it had used — its tokens so far; its cost is reported
        # by Anthropic only at a run's end, so the record says it was cut rather than guess a price
        state.log(RUN_CUT, {"who": terms.who, "cost_usd": None, "stopped_at_limit": False, "denied": [],
                        "error": None, "profile": terms.profile, "model": opts.model, "tokens": c.partial_tokens(),
                        "turns": None, "ms": None, "asked": kept_asked(asked, _secrets(settings)), "problem": None,
                        "steps": kept_steps(c.steps, _secrets(settings)),
                        "skills": skills_of(terms.skill, c.skills)})
        raise
    except Exception as e:  # noqa: BLE001
        c.fail(e)
        # a known kind is one line (the warning below); anything else keeps its traceback for the log
        if c.problem == "unknown":
            log.exception("agent run failed")
    texts, session_id, stopped, cost, usage, turns, ms = c.texts, c.session_id, c.stopped, c.cost, c.usage, c.turns, c.ms
    if ready is not None:
        log.info("AI run (%s): ready in %.1f s, first reply %s, %.1f s in all", terms.who, ready - began,
                 f"after {first - ready:.1f} s" if first is not None else "none", time.monotonic() - began)
    steps = kept_steps(c.steps, _secrets(settings))
    err, problem = c.err or (f"api {c.kind}" if c.kind else None), c.problem
    if problem:
        # the kind and the status only: the raw prose may quote the request
        log.warning("Anthropic: %s (%s%s)", problem, c.kind or c.exc_name or "error",
                    f", HTTP {c.status}" if c.status else "")
    # ⚠️ WHAT THE COSTS TAB SHOWS (owner, 2026-10-01): the brain, the model and the tokens of each run, with
    # what was asked — never the answer, never a secret. Before 0.6.9 only who and the cost were kept.
    tokens = {k: usage.get(k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                         "cache_creation_input_tokens") if isinstance(usage.get(k), int)}
    # ⚠️ THIS RUN'S COST, NOT THE CONVERSATION'S (owner, 2026-10-19): the SDK's figure is the resumed conversation's
    # running total (agent_records.session_before); the record keeps both, the next run of the conversation reads it
    total = cost
    if total is not None:
        cost = turn_cost(total, session_before(state.runs_of(resume, terms.who), resume, terms.who) if resume else 0.0)
    # no tokens, no cost (agent_records.run_cost): a refused request is not 0.033 USD in the log or the record
    cost = run_cost({"cost_usd": cost, "tokens": tokens}) if cost is not None else None
    retrying = bool(err and resume and not texts and problem not in NO_RETRY)
    if not (retrying and not cost):
        # a resume that failed before doing anything is retried below as the same run: one row for one question
        state.log(RUN, {"who": terms.who, "cost_usd": cost, "stopped_at_limit": stopped, "denied": denied, "error": err,
                        "profile": terms.profile,
                        "model": opts.model, "tokens": tokens, "turns": turns, "ms": ms,
                        "asked": kept_asked(asked, _secrets(settings)), "problem": problem,
                        # ⚠️ THE TOOLS IT USED (0.6.42): the Costs tab's "Tools used", and how often each tool is used
                        "steps": steps, "skills": skills_of(terms.skill, c.skills),
                        "session": session_id, "session_total_usd": total})
    if retrying:
        # the session could not be resumed (lost, or from an older version): answer in a new one
        # the same run for the Costs tab: what was asked goes with it (it was dropped, so the answered run had none)
        return await run(settings, system_prompt, prompt, kit, terms, state, None, asked, image)
    return RunResult(c.answer, session_id, stopped, cost, denied, err, problem, c.earlier)

