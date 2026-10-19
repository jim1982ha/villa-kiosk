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


#: ⚠️ ONE TABLE OF CAUSES (architecture review scan 4, 2026-10-19): kind → (the cause in a few words, what the person
#: who asked can do, what the OWNER must do when nothing else helps — None for a kind a retry fixes). FOR_PERSON,
#: why_job and NEEDS_THE_OWNER were three tables keyed by the same kinds, each wording the cause its own way, and the
#: Costs tab's tooltip showed the first-person sentence ("I cannot answer right now…") on the owner's own page.
CAUSES: dict[str, tuple[str, str, str | None]] = {
    CREDIT: ("the Anthropic account has run out of credit",
             "The owner can add credit in the Anthropic Console (Billing).",
             "Add credit in the Anthropic Console (Billing); nothing else needs changing."),
    KEY: ("Anthropic refused the API key",
          "The owner can check it in the VESTA Agent app's Configuration.",
          "Check \"Anthropic API key\" in the VESTA Agent app's Configuration, then restart the app."),
    RATE: ("too many requests to Anthropic at the moment", "Try again in a minute.", None),
    BUSY: ("Anthropic's servers are overloaded or down at the moment", "Try again in a few minutes.", None),
    OFFLINE: ("Anthropic could not be reached (the villa's internet connection may be down)",
              "Try again in a few minutes.", None),
    TOO_LONG: ("the work has grown too long for the model", "Send /new to start a new one, then ask again.", None),
    UNKNOWN: ("an unexpected error stopped it", "Try again in a moment.", None),
}


def cause(problem: str) -> str:
    """The cause of a failed run, in a few words — the one wording every sentence about it uses."""
    return CAUSES.get(problem, CAUSES[UNKNOWN])[0]


def what_to_do(problem: str) -> str:
    return CAUSES.get(problem, CAUSES[UNKNOWN])[1]


#: What the person who asked reads. Never the raw error: no status code, no JSON, no request id.
FOR_PERSON = {k: f"I cannot answer right now: {c}. {do}" for k, (c, do, _) in CAUSES.items()}

#: Kinds no retry fixes and that stop EVERY reply and report: the owner is told even when someone else asked.
NEEDS_THE_OWNER = {k: f"The VESTA Agent has stopped answering: {c}. {owner}" for k, (c, _, owner) in CAUSES.items()
                   if owner}

#: A failed resume is retried once in a new conversation — never for these: a new conversation fails the same way.
NO_RETRY = {CREDIT, KEY, RATE, BUSY, OFFLINE}

#: The AI cannot answer anyone now (ai_down.py offers the reports that need no AI). The same kinds today, a
#: different question: kept apart so that changing one never changes the other.
AI_DOWN = frozenset({CREDIT, KEY, RATE, BUSY, OFFLINE})


def why_job(problem: str) -> str:
    """Why an AI job could not run, in a few words (a report made without the AI says it too)."""
    return cause(problem)


def why_job_sentence(problem: str) -> str:
    """The same, as a sentence: what a report made without the AI, and its row on the Costs tab, say."""
    why = why_job(problem)
    return why[:1].upper() + why[1:] + "."


#: Who asked for a report, and so how "it did not come" ends: asked in a chat, run on schedule, cut by a restart
CHAT, SCHEDULE, CUT, NO_RESULT = "chat", "schedule", "cut", "no_result"


def NOT_COME(name: str, cause_: str, asked: str, when: str | None = None) -> str:  # noqa: N802 — a sentence's name
    """⚠️ ONE SENTENCE FOR "THE REPORT YOU ASKED FOR DID NOT COME" (architecture review scan 4, 2026-10-19). A job
    asked for in a chat read "It will run again at its next time" (it would not: nobody scheduled it), a job whose
    AI sent nothing "ended without a result", a cut one "was stopped by a restart", and "job" and "report" took
    turns. One shape, one noun: "The {name} report … could not be prepared: {cause}. {what now}."

    `asked`: CHAT (asked for in a chat: ask again), SCHEDULE (it runs again at its next time), CUT (a restart cut the
    one asked for at `when`: ask again), NO_RESULT (its AI ended without sending it, whoever asked: ask for it again)."""
    if asked == SCHEDULE:
        return f"The {name} report could not be prepared: {cause_}. It will run again at its next time."
    if asked == CUT:
        return f"The {name} report you asked for at {when} could not be prepared: {cause_}. Ask again to have it."
    if asked == NO_RESULT:
        return f"The {name} report could not be prepared: {cause_}. Ask for it again in a moment."
    return f"The {name} report you asked for could not be prepared: {cause_}. Ask again in a moment."


def for_job(name: str, problem: str, origin=None) -> str:
    """What the chat a report goes to reads when its AI could not run: asked for in a chat (`origin`), or on schedule."""
    return NOT_COME(name, why_job(problem), CHAT if origin else SCHEDULE)
