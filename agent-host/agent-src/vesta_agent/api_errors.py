"""Why a run of the model failed, in one word, and what a person reads about it (owner, 2026-10-06).

The Agent SDK reports a failed Anthropic call three ways: an AssistantMessage whose
`error` names the kind (billing_error, authentication_failed, rate_limit,
server_error, invalid_request, unknown) and whose TEXT is the raw "API Error: …" —
which must never reach a person as if it were the answer —; a ResultMessage with
`is_error` and `api_error_status`; or an exception (ResultError carries the same
fields, CLIConnectionError / a network error carries none). Every path ends here.
"""

from __future__ import annotations

#: The kinds, in the order they are tried.
CREDIT, KEY, RATE, BUSY, OFFLINE, TOO_LONG, UNKNOWN = (
    "credit", "key", "rate_limit", "busy", "offline", "too_long", "unknown")

_OFFLINE_WORDS = ("connection error", "econnrefused", "enotfound", "etimedout", "econnreset", "eai_again",
                  "getaddrinfo", "fetch failed", "network", "timed out", "timeout", "socket hang up",
                  "unable to connect", "name resolution")
_OFFLINE_EXC = ("CLIConnectionError", "ClientConnectorError", "ClientConnectorDNSError", "ServerDisconnectedError",
                "TimeoutError", "ConnectionError", "ConnectionRefusedError", "ConnectionResetError", "OSError")


def classify(kind: str | None = None, status: int | None = None, text: str | None = None,
             exc_name: str | None = None) -> str:
    t = (text or "").lower()
    if kind == "billing_error" or status == 402 or "credit balance" in t or "billing" in t:
        return CREDIT
    if kind == "authentication_failed" or status in (401, 403) or "x-api-key" in t or "api key" in t \
            or "authentication" in t:
        return KEY
    if kind == "rate_limit" or status == 429 or "rate limit" in t:
        return RATE
    if "prompt is too long" in t or "context window" in t or "too many tokens" in t:
        return TOO_LONG
    if kind == "server_error" or status in (500, 502, 503, 504, 529) or "overloaded" in t:
        return BUSY
    if exc_name in _OFFLINE_EXC or any(w in t for w in _OFFLINE_WORDS):
        return OFFLINE
    return UNKNOWN


#: What the person who asked reads. Never the raw error: no status code, no JSON, no request id.
FOR_PERSON = {
    CREDIT: "I cannot answer right now: the Anthropic account behind the VESTA Agent has run out of credit. "
            "The owner can add credit in the Anthropic Console (Billing).",
    KEY: "I cannot answer right now: Anthropic refused the VESTA Agent's API key. The owner can check it in "
         "the VESTA Agent app's Configuration in Home Assistant.",
    RATE: "Too many requests to Anthropic at the moment. Try again in a minute.",
    BUSY: "Anthropic's servers are overloaded or down at the moment. Try again in a few minutes.",
    OFFLINE: "I cannot reach Anthropic at the moment: the villa's internet connection may be down. "
             "Try again in a few minutes.",
    TOO_LONG: "This conversation has become too long for me. Send /new to start a new one, then ask again.",
    UNKNOWN: "The VESTA Agent could not answer this time. Try again in a moment.",
}

#: Kinds no retry fixes and that stop EVERY reply and report: the owner is told even when someone else asked.
NEEDS_THE_OWNER = {
    CREDIT: "The VESTA Agent has stopped answering: the Anthropic account has run out of credit. "
            "Add credit in the Anthropic Console (Billing); nothing else needs changing.",
    KEY: "The VESTA Agent has stopped answering: Anthropic refuses its API key. Check \"Anthropic API key\" in "
         "the VESTA Agent app's Configuration in Home Assistant, then restart the app.",
}

#: A failed resume is retried once in a new conversation — never for these: a new conversation fails the same way.
NO_RETRY = {CREDIT, KEY, RATE, BUSY, OFFLINE}

#: The AI cannot answer anyone now (ai_down.py offers the reports that need no AI). The same kinds today, a
#: different question: kept apart so that changing one never changes the other.
AI_DOWN = frozenset({CREDIT, KEY, RATE, BUSY, OFFLINE})


def why_job(problem: str) -> str:
    """Why an AI job could not run, in a few words (a report made without the AI says it too)."""
    return {CREDIT: "the Anthropic account has run out of credit", KEY: "Anthropic refused the API key",
            RATE: "too many requests to Anthropic", BUSY: "Anthropic's servers were overloaded or down",
            OFFLINE: "Anthropic could not be reached (internet down?)",
            TOO_LONG: "its work grew too long for the model"}.get(problem, "an unexpected error")


def why_job_sentence(problem: str) -> str:
    """The same, as a sentence: what a report made without the AI, and its row on the Costs tab, say."""
    why = why_job(problem)
    return why[:1].upper() + why[1:] + "."


def for_job(name: str, problem: str) -> str:
    """What the chat a report goes to reads when the job could not run."""
    return f"The {name} report could not be prepared: {why_job(problem)}. It will run again at its next time."
