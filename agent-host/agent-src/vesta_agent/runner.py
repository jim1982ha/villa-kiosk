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

import logging
from dataclasses import dataclass

import json

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher,
                              PermissionResultAllow, PermissionResultDeny, ResultMessage, TextBlock, ToolUseBlock)

from .api_errors import NO_RETRY, classify
from .policy import PROFILES  # noqa: E402
from .redact import scrub

log = logging.getLogger("vesta.runner")

WEB_SEARCH = "WebSearch"
MAX_STEPS = 40          # the tools one run used, as the Costs tab shows them (a report uses about 20)

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


class Collector:
    """What one run's message stream says: the answer, and — when Anthropic failed — why.

    ⚠️ A FAILED API CALL ALSO ARRIVES AS TEXT: the CLI turns it into an AssistantMessage whose
    `error` is set and whose text is the raw "API Error: 400 {...credit balance is too low...}".
    That text is the error's, never the answer: it is read for the reason and never sent."""

    def __init__(self, session_id: str | None = None):
        self.texts: list[str] = []
        self.steps: list[dict] = []          # each tool the AI called: its name, and what it asked, in short
        self.session_id, self.stopped, self.cost, self.err = session_id, False, None, None
        self.usage, self.turns, self.ms = {}, None, None
        self.kind, self.status, self.exc_name, self.raw = None, None, None, ""

    def feed(self, msg) -> None:
        if isinstance(msg, AssistantMessage):
            for b in msg.content:
                if isinstance(b, ToolUseBlock) and len(self.steps) < MAX_STEPS:
                    self.steps.append(step(b.name, b.input))
            words = [b.text.strip() for b in msg.content if isinstance(b, TextBlock) and b.text.strip()]
            if getattr(msg, "error", None):
                self.kind = msg.error
                self.raw += " ".join(words)
                return
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
    """One tool call, for the record: what was called and, in a line, with what. Never more: an answer can hold
    anything, and the record is read on the Costs tab."""
    args = dict(args or {}) if isinstance(args, dict) else {}
    args.pop("vesta_part", None)
    key = tool_key(name)
    if key == "run_skill_script":
        said = " ".join([str(args.get("script") or ""), *map(str, args.get("args") or [])]).strip()
    elif key == "ha_call_service":
        said = f"{args.get('domain', '')}.{args.get('service', '')} {args.get('entity_id') or ''}".strip()
    elif key == "web_search":
        said = str(args.get("query") or "")
    elif key == "send_message":
        said = f"to {args.get('to', '?')}" + (f", {args['attachment']}" if args.get("attachment") else "")
    elif key == "save_file":
        said = str(args.get("name") or "")
    else:
        said = json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)[1:-1] if args else ""
    return {"tool": key, "input": said[:160]}


def make_guard(allowed: set[str], state, who: str):
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
            return {}
        if name not in denied:
            denied.append(name)
            state.log("tool_denied", {"tool": name, "who": who, "by": "hook"})
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                       "permissionDecisionReason": f"{name} does not exist for VESTA."}}

    return can_use_tool, pre_tool_use, denied


def build_options(settings, system_prompt: str, server, allowed: set[str], state, who: str,
                  resume: str | None, limit_usd: float, profile: str | None = None) -> tuple[ClaudeAgentOptions, list[str]]:
    can_use_tool, pre_hook, denied = make_guard(allowed, state, who)
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
        # an AI job's own profile (policy.yaml settings.jobs), else the villa's chat profile
        model=PROFILES[profile][0] if profile in PROFILES else settings.model,
        effort=PROFILES[profile][1] if profile in PROFILES else settings.effort,
        max_budget_usd=float(limit_usd),
        resume=resume,
    )
    return opts, denied


def kept_steps(steps: list[dict], secrets: list[str]) -> list[dict]:
    """The tool calls kept with a run (the Costs tab), through the one scrubber (redact.py)."""
    return [{**st, "input": scrub(st["input"], secrets)} for st in steps]


async def run(settings, system_prompt: str, prompt: str, server, allowed: set[str], state, who: str,
              resume: str | None = None, limit_usd: float | None = None, profile: str | None = None,
              asked: str | None = None) -> RunResult:
    clean_environ()
    opts, denied = build_options(settings, system_prompt, server, allowed, state, who, resume,
                                 limit_usd if limit_usd is not None else settings.reply_limit_usd, profile)
    c = Collector(resume)
    try:
        async with ClaudeSDKClient(options=opts) as client:
            await client.query(prompt)
            async for msg in client.receive_response():
                c.feed(msg)
    except Exception as e:  # noqa: BLE001
        c.fail(e)
        # a known kind is one line (the warning below); anything else keeps its traceback for the log
        if c.problem == "unknown":
            log.exception("agent run failed")
    texts, session_id, stopped, cost, usage, turns, ms = c.texts, c.session_id, c.stopped, c.cost, c.usage, c.turns, c.ms
    steps = kept_steps(c.steps, settings.secrets() if hasattr(settings, "secrets") else [])
    err, problem = c.err or (f"api {c.kind}" if c.kind else None), c.problem
    if problem:
        # the kind and the status only: the raw prose may quote the request
        log.warning("Anthropic: %s (%s%s)", problem, c.kind or c.exc_name or "error",
                    f", HTTP {c.status}" if c.status else "")
    # ⚠️ WHAT THE COSTS TAB SHOWS (owner, 2026-10-01): the brain, the model and the tokens of each run, with
    # what was asked — never the answer, never a secret. Before 0.6.9 only who and the cost were kept.
    tokens = {k: usage.get(k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                         "cache_creation_input_tokens") if isinstance(usage.get(k), int)}
    state.log("run", {"who": who, "cost_usd": cost, "stopped_at_limit": stopped, "denied": denied, "error": err,
                      "profile": profile if profile in PROFILES else getattr(settings, "profile", None), "model": opts.model, "tokens": tokens,
                      "turns": turns, "ms": ms, "asked": (asked or "")[:160] or None, "problem": problem,
                      # ⚠️ THE TOOLS IT USED (0.6.42): the Costs tab's "Tools used", and how often each tool is used
                      "steps": steps})
    if err and resume and not texts and problem not in NO_RETRY:
        # the session could not be resumed (lost, or from an older version): answer in a new one
        # the same run for the Costs tab: what was asked goes with it (it was dropped, so the answered run had none)
        return await run(settings, system_prompt, prompt, server, allowed, state, who, None, limit_usd, profile, asked)
    return RunResult("\n\n".join(texts).strip(), session_id, stopped, cost, denied, err, problem)

