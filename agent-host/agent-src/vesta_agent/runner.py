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
import os
from dataclasses import dataclass

from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher,
                              PermissionResultAllow, PermissionResultDeny, ResultMessage, TextBlock)

log = logging.getLogger("vesta.runner")

WEB_SEARCH = "WebSearch"

# Named anyway, in case a future CLI adds a tool while tools=[] is set.
BUILTIN_DENY = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep",
                "LS", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "Skill", "SlashCommand", "ExitPlanMode",
                "ListMcpResourcesTool", "ReadMcpResourceTool"]


# The CLI inherits this process's environment. Only neutral variables stay: a
# variable can switch on tools (for example a browser integration) or carry a
# token (SUPERVISOR_TOKEN in an add-on). Found by the end-to-end test.
KEEP_ENV = {"PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
            "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "ANTHROPIC_BASE_URL",
            "VESTA_CHROMIUM", "PYTHONPATH"}


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
                  resume: str | None, limit_usd: float) -> tuple[ClaudeAgentOptions, list[str]]:
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
        model=settings.model,
        effort=settings.effort,
        max_budget_usd=float(limit_usd),
        resume=resume,
    )
    return opts, denied


async def run(settings, system_prompt: str, prompt: str, server, allowed: set[str], state, who: str,
              resume: str | None = None, limit_usd: float | None = None) -> RunResult:
    clean_environ()
    opts, denied = build_options(settings, system_prompt, server, allowed, state, who, resume,
                                 limit_usd if limit_usd is not None else settings.reply_limit_usd)
    texts: list[str] = []
    session_id, stopped, cost, err = resume, False, None, None
    try:
        async with ClaudeSDKClient(options=opts) as client:
            await client.query(prompt)
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for b in msg.content:
                        if isinstance(b, TextBlock) and b.text.strip():
                            texts.append(b.text.strip())
                elif isinstance(msg, ResultMessage):
                    session_id = msg.session_id or session_id
                    cost = msg.total_cost_usd
                    stopped = msg.subtype == "error_max_budget_usd"
                    if msg.is_error and not stopped:
                        err = msg.subtype if msg.subtype != "success" else f"api error {msg.api_error_status}"
    except Exception as e:  # noqa: BLE001
        log.exception("agent run failed")
        err = type(e).__name__
    state.log("run", {"who": who, "cost_usd": cost, "stopped_at_limit": stopped, "denied": denied, "error": err})
    if err and resume and not texts:
        # the session could not be resumed (lost, or from an older version): answer in a new one
        return await run(settings, system_prompt, prompt, server, allowed, state, who, None, limit_usd)
    return RunResult("\n\n".join(texts).strip(), session_id, stopped, cost, denied, err)
