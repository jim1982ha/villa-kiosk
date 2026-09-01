"""LLM narration: optional, budgeted, and incapable of stopping a report.

⚠️ THE DETERMINISTIC RENDERER IS THE PRODUCT. Everything here sits ON TOP of
prose that already works — read one; it is good. So the bar for this layer is
not "does it produce nice output", it is "can it ever make things worse", and
the answer has to be no on every path: no provider configured, no internet, a
provider that is down, a provider that is slow, a provider that answers with
something unusable, a monthly budget already spent. Every one of those ends with
the deterministic report going out on time.

⚠️ HARD RULE #2 — NO INTERNET DEPENDENCY, EVER. The target is an iPad in a villa
that may have no WAN at all. This is opt-in, degrades to `null` on ANY failure,
is never required for delivery, and never reachable from the SPA bundle: all
provider traffic originates in this process. A CI grep asserts no provider
hostname appears under `src/`.

⚠️ AND A NARRATOR MUST NOT RAISE — `narrate/base.py`'s own contract. Every
failure mode below is caught and turned into "no narration", which the pipeline
already handles because that is what it did before this file existed.

## What a provider is given

`payload.build()`'s output and nothing else — see that module, which is the file
where a mistake is unrecoverable. Notably NOT the report context, NOT the prose
the deterministic renderer wrote, and NOT any free text: the provider receives
NUMBERS and writes sentences from them.

## What comes back

Plain text, used as the report BODY. It is not trusted with structure, links or
markup — `deliver.py` sends the intersection of what notify platforms accept, so
anything a provider returns is flattened to that same plain text.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from aiohttp import ClientSession
from vesta.shared.breaker import Breaker, BREAKER_FAILURES, BREAKER_RESET_S
from vesta.adapters import secrets
from vesta.adapters import usage
from vesta.shared.contracts import NARRATION_MODE
from vesta.adapters.log import log, swallow, warn
from . import payload as payload_mod
from vesta.shared.style import BULLET

#: One request's ceiling. ⚠️ SHORT ON PURPOSE. A scheduled report is composed
#: inside a 60-second tick; a provider that takes longer than this has already
#: cost more than the prose is worth, and the deterministic body is sitting
#: ready. Nothing here is worth making the owner wait for.
REQUEST_TIMEOUT_S = 20.0

#: Consecutive failures before the provider is left alone for a while, and how
#: long that is. Same shape as `hass.py`'s breaker, for the same reason: a
#: provider that is down stays down for minutes, and retrying every report is
#: how a rate limit becomes a ban.

#: ⚠️ THE COST CEILING IS COUNTED IN REQUESTS, NOT TOKENS, AND THAT IS
#: DELIBERATE. Token accounting needs the provider's own reply to be trusted for
#: billing, differs per provider, and is the kind of thing that silently stops
#: being accurate. A request count is exact, provider-agnostic, and an owner can
#: reason about it: "at most N narrated reports a month" is a sentence with a
#: number in it. A daily schedule for two audiences is ~62 requests a month, so
#: the default is above ordinary use and far below a runaway loop.
DEFAULT_MONTHLY_LIMIT = 200


class Budget:
    """Requests used this calendar month, and whether another is allowed.

    ⚠️ IN MEMORY, AND THAT IS A STATED LIMITATION RATHER THAN AN OVERSIGHT. A
    restart forgets the count. The alternative is a fifth `/data` store written
    on every narration, and the ceiling exists to stop a RUNAWAY — a loop, a
    misconfigured cadence, a retry storm — all of which happen inside one
    process lifetime. It is not an accounting record and must never be described
    as one.
    """

    def __init__(self, limit: int = DEFAULT_MONTHLY_LIMIT) -> None:
        self.limit = max(0, int(limit))
        self._month = ""
        self._used = 0

    def _roll(self, now: Optional[float] = None) -> None:
        stamp = time.strftime("%Y-%m", time.gmtime(now))
        if stamp != self._month:
            self._month, self._used = stamp, 0

    def allowed(self, now: Optional[float] = None) -> bool:
        self._roll(now)
        return self._used < self.limit

    def spend(self, now: Optional[float] = None) -> None:
        self._roll(now)
        self._used += 1

    @property
    def used(self) -> int:
        self._roll()
        return self._used




#: A provider adapter: given a session and a payload, return prose or None.
#: ⚠️ RETURNS None RATHER THAN RAISING. An adapter that raises would put the
#: burden of "must not stop the report" on every future adapter author; here it
#: is on the two lines below and nowhere else.
#: ⚠️ `Callable[..., Any]` BECAUSE THE THIRD ARGUMENT IS POSITIONAL AND THE
#: FOURTH IS KEYWORD-ONLY. The precise form was
#: `Callable[[ClientSession, Mapping[str, Any], str], Any]`, which cannot
#: express `actor=` — and widening it to a fourth POSITIONAL parameter would
#: put two bare strings (`key`, `actor`) next to each other, where swapping
#: them type-checks and sends the API key to the usage ledger as an actor name.
#: Looseness here buys a mistake that cannot be made.
Adapter = Callable[..., Any]

#: ⚠️ NAMED ONCE, BECAUSE THE USAGE LEDGER MUST PRICE THE MODEL THAT WAS
#: ACTUALLY CALLED. It was a literal inside the request body; a second literal
#: in the accounting call would be one edit away from billing a brief at the
#: wrong rate, which is the class of drift /dry-audit exists for.
NARRATION_MODEL = "claude-sonnet-5"


async def _anthropic(session: ClientSession, body: Mapping[str, Any],
                     key: str, *, actor: str = "schedule") -> Optional[str]:
    """The one adapter that ships.

    ⚠️ THE HOSTNAME LIVES HERE AND NOWHERE ELSE, and specifically not under
    `src/` — a CI grep asserts that, because a provider hostname in the bundle
    would mean the browser could reach it, which is the offline rule failing in
    the one place nobody would look for it.
    """
    request = {
        "model": NARRATION_MODEL,
        "max_tokens": 1200,
        "messages": [{"role": "user", "content": _prompt(body)}],
    }
    async with session.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=request,
    ) as response:
        if response.status != 200:
            # ⚠️ STATUS AND NOTHING ELSE. A provider's error body routinely
            # echoes the request, headers included — see `secrets.redact`.
            warn(f"narration provider returned {response.status}")
            return None
        data: Any = await response.json()
    # ⚠️ ACCOUNTED AT THE ADAPTER, WHICH IS THE ONLY PLACE THE COUNTS EXIST.
    # `narrate` sees a string; the token counters are in this response object
    # and nowhere else, so recording anywhere further out would mean guessing
    # them from the prose. A second adapter must do the same — pinned by
    # `test_agent_usage.test_every_provider_call_site_records_usage`, because
    # the failure is a silent zero in a ledger an owner is reading to find out
    # where their money went.
    #
    # ⚠️ THE ACTOR TRAVELS, AND IT USED TO BE THE LITERAL "schedule". The note
    # here read "a brief is originated by the villa; attributing it to whoever
    # last logged in would put somebody's name on spend they did not cause" —
    # sound reasoning, wrongly scoped: it assumed the scheduler was the only
    # caller. `reports_run_now_handler` is owner-only and is a PERSON pressing
    # a button, so its narration spend was filed against the schedule and
    # disappeared from the one breakdown this ledger exists for. Same root cause
    # as `triage.run`'s hardcoded trigger, a different subsystem. The default
    # keeps the clock's rows byte-identical.
    counted = data.get("usage") if isinstance(data, dict) else None
    usage.record(source="brief", model=NARRATION_MODEL, actor=actor,
                 counts=counted if isinstance(counted, Mapping) else {})
    blocks = data.get("content") if isinstance(data, dict) else None
    if not isinstance(blocks, list):
        return None
    parts = [b.get("text") for b in blocks
             if isinstance(b, dict) and isinstance(b.get("text"), str)]
    text = "\n".join(p for p in parts if p).strip()
    return text or None


#: ⚠️ ADDING ONE IS A TABLE ENTRY, NOT A BRANCH. The same rule `deliver.py`
#: follows for notify targets: no platform name appears anywhere except in its
#: own adapter, so a property using a different provider needs a config change
#: rather than a code path.
ADAPTERS: Dict[str, Adapter] = {"anthropic": _anthropic}

#: ⚠️ THE DEFAULT PROVIDER IS DERIVED, NOT NAMED. Two places used to spell
#: `"anthropic"` as a fallback — this class's `__init__` and `shared()` — which
#: made the claim above ("no platform name anywhere except in its own adapter")
#: false in the same file that states it, and expressed one preference in three
#: places. Found by /dry-audit Part 3. Deriving it means adding a second adapter
#: cannot leave a stale default behind, and the claim becomes structural.
DEFAULT_PROVIDER = next(iter(ADAPTERS))


def _prompt(body: Mapping[str, Any]) -> str:
    """What the provider is asked to do.

    ⚠️ IT IS ASKED FOR PROSE, NOT FOR JUDGEMENT. Every number, threshold and
    severity in the payload was decided by the villa's own automations and this
    add-on's analysis; the provider's job is to say them well. A prompt that
    invited it to assess, rank or conclude would put an unaccountable opinion
    into a document the owner acts on — and would make the deterministic
    renderer and the narrated version disagree about what happened.

    ⚠️ AND IT NO LONGER ASKS FOR A DOCUMENT. Until v2.592.0 narration REPLACED
    the whole body, so a third of this prompt was format rules — headings,
    bullets, emoji, "no markdown" — restating `style.py` in English where the
    two could drift, and asking a language model to retype sparklines, aligned
    columns and every figure. One weak answer cost the entire brief.

    Now the renderer keeps the document and the provider writes ONE sentence:
    the lead a push notification shows before it truncates. Every format rule
    above is gone because the model no longer emits structure, and an unusable
    answer costs that sentence rather than the report.
    """
    return (
        "You are writing the opening line of a property report for the owner "
        "of a villa. It arrives as a phone notification, which shows about two "
        "lines before it truncates.\n\n"
        "Below is JSON describing what automated checks found this period. "
        "Write ONE sentence naming the single most important thing in it.\n\n"
        "Rules:\n"
        "- Use ONLY the facts in the JSON. Do not infer causes, do not "
        "estimate, do not add advice the data does not support.\n"
        "- Do not invent equipment, rooms or numbers that are not present.\n"
        "- Prefer a finding whose `zone` is `needs_you`: those need a person "
        "today. `about_report` items are about the monitoring system and must "
        "never lead.\n"
        "- `trend_direction` and `trend_pct` say whether a number is worse than "
        "usual. That is often the most useful thing to say about it.\n"
        "- `age_days` distinguishes something new from something outstanding.\n"
        "- Plain text. No markdown, no emoji, no bullet, no heading, no line "
        "break. One sentence, under 140 characters.\n"
        "- Reply with the sentence and nothing else.\n\n"
        + json.dumps(body, indent=1, sort_keys=True)
    )



class ProviderNarrator:
    """Narrates through a provider, or declines. Never raises, never blocks.

    Holds the breaker and the budget, so both survive across reports within one
    process — which is the lifetime that matters for a runaway.
    """

    name = NARRATION_MODE[1]  # "provider"

    def __init__(self, provider: str = DEFAULT_PROVIDER,
                 monthly_limit: int = DEFAULT_MONTHLY_LIMIT) -> None:
        self.provider = provider
        self.budget = Budget(monthly_limit)
        self.breaker = Breaker()

    def why_not(self) -> str:
        """The reason narration will not be attempted, or "".

        ⚠️ A REASON, NOT A BOOLEAN. "The report was not narrated" has five
        causes and they call for different actions — configure a key, wait for a
        provider to recover, raise a limit, or nothing at all. A caller that can
        only see false cannot tell an owner which.
        """
        if self.provider not in ADAPTERS:
            return f"no adapter for provider {self.provider!r}"
        if not secrets.configured(self.provider):
            return "no API key is configured"
        if self.breaker.is_open():
            return "the provider failed repeatedly and is being left alone"
        if not self.budget.allowed():
            return f"this month's limit of {self.budget.limit} was reached"
        return ""

    async def narrate(self, session: ClientSession,
                      body: Mapping[str, Any],
                      *, actor: str = "schedule") -> Tuple[Optional[str], str]:
        """(prose, reason). Prose is None whenever anything at all went wrong.

        ⚠️ THE PAYLOAD IS AUDITED IMMEDIATELY BEFORE IT LEAVES. `payload.build`
        is correct; this asks the finished object anyway, because the cost of
        the two disagreeing is not a bad report — it is a field that left the
        villa. A non-empty audit means DO NOT SEND, and says so in the log
        without printing the payload.
        """
        blocked = self.why_not()
        if blocked:
            return None, blocked

        problems: List[str] = payload_mod.audit(body)
        if problems:
            warn(f"narration payload refused by its own audit: {problems[:3]}")
            return None, "the payload failed its privacy audit"

        key = secrets.get(self.provider)
        if not key:
            return None, "no API key is configured"

        adapter = ADAPTERS[self.provider]
        self.budget.spend()
        try:
            text: Optional[str] = await asyncio.wait_for(
                adapter(session, body, key, actor=actor),
                timeout=REQUEST_TIMEOUT_S)
        except Exception as err:  # noqa: BLE001 - a narrator MUST NOT raise
            self.breaker.record_failure()
            # ⚠️ REDACTED, AND THIS IS THE LINE THAT MATTERS. An HTTP client
            # that fails mid-request echoes the request — `x-api-key` included —
            # into the exception, and `swallow` writes exceptions down.
            swallow("narration failed",
                    RuntimeError(secrets.redact(f"{type(err).__name__}: {err}")))
            return None, "the provider could not be reached"

        # ⚠️ JUDGED ON WHAT WOULD ACTUALLY BE DELIVERED, WHICH IS THE FLATTENED
        # TEXT — not on what arrived. Testing `text` first passes a reply of
        # `"   \n  "` (truthy) and passes a reply of pure markup, both of which
        # flatten to nothing; `narrate` would then report SUCCESS, spend the
        # budget, log "narrated by …", and hand back an empty string that the
        # pipeline's own `if prose:` quietly declines. The report would be
        # correct and every instrument describing it would be wrong — which is
        # the failure `feedback_instruments-never-skip` is about. Found by
        # `test_an_empty_answer_is_a_failure_not_an_empty_report`, not by review.
        prose = _flatten(text or "")
        if not prose:
            self.breaker.record_failure()
            return None, "the provider returned nothing usable"

        self.breaker.record_success()
        log(f"narrated by {self.provider} ({self.budget.used} this month)")
        return prose, ""


#: ⚠️ ONE INSTANCE PER PROCESS, BECAUSE THE BREAKER AND THE BUDGET ARE THE
#: WHOLE POINT. A narrator constructed per report starts with a closed breaker
#: and a zero count every time, which is not a circuit breaker and not a
#: ceiling — it is a provider hammered once per report forever, and a runaway
#: that never trips. The state has to outlive the report; this is where it does.
_SHARED: Dict[str, ProviderNarrator] = {}


def shared(settings: Mapping[str, Any]) -> Optional[ProviderNarrator]:
    """The process's narrator for this config, or None if narration is off.

    `settings` is the `narration` slice of the reports config —
    `{"mode": "provider", "provider": "anthropic", "monthly_limit": 200}`.

    ⚠️ ABSENT MEANS OFF. `NARRATION_MODE[0]` is "deterministic" and is the
    default in `store.CONFIG_DEFAULTS`, so a property that has never heard of
    this feature — every existing install — takes the first branch and nothing
    below it ever runs.
    """
    if not isinstance(settings, Mapping):
        return None
    if str(settings.get("mode") or NARRATION_MODE[0]) != NARRATION_MODE[1]:
        return None

    provider = str(settings.get("provider") or DEFAULT_PROVIDER)
    raw_limit = settings.get("monthly_limit")
    limit = (int(raw_limit) if isinstance(raw_limit, int)
             and not isinstance(raw_limit, bool) else DEFAULT_MONTHLY_LIMIT)

    existing = _SHARED.get(provider)
    if existing is None:
        existing = ProviderNarrator(provider, limit)
        _SHARED[provider] = existing
    else:
        # ⚠️ THE LIMIT IS UPDATED IN PLACE, THE COUNT IS NOT RESET. An owner
        # raising the ceiling mid-month should get the extra headroom; an owner
        # who could zero the count by saving the settings page would have a
        # ceiling that any spending loop's own config write could lift.
        existing.budget.limit = max(0, limit)
    return existing


def _flatten(text: str) -> str:
    """Provider output as plain text, whatever it sent.

    ⚠️ `deliver.py` SENDS THE INTERSECTION OF WHAT NOTIFY PLATFORMS ACCEPT, so
    a model that returns markdown produces literal asterisks and hashes on the
    platforms that do not parse them. Asking nicely in the prompt is not a
    guarantee; this is.

    ⚠️ NOT CONVERGED WITH `style.inert`, AND THE REASON IS THAT THEY ANSWER
    DIFFERENT QUESTIONS. This one turns a model's markdown STRUCTURE into this
    project's own — headings dropped, `* `/`- ` normalised to `BULLET`, per line
    — and it is the only place that can, because only here is the text known to
    be a model's answer. `inert` neutralises markup-active CHARACTERS in the
    finished message and is the guarantee (2.573.0); it now runs over this
    output too, so the character-stripping below is a belt beside a brace rather
    than the enforcement. Deleting it would still be wrong: `**bold**` left for
    `inert` becomes `bold` with no space problem, but `### ` would survive as a
    literal `### ` on a platform that does not parse headings.
    """
    out: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        for marker in ("### ", "## ", "# ", "**", "__", "`"):
            stripped = stripped.replace(marker, "")
        # ⚠️ SINGLE UNDERSCORES TOO, AND THAT IS NOT PEDANTRY. `_word_` is
        # italic in the same dialects `**word**` is bold, and this project has
        # already had a delivered brief mangled by exactly that character — a
        # platform parsing by default ate every underscore and italicised whole
        # paragraphs between them. Stripping `**` and leaving `_` would defend
        # against the rarer of the two.
        stripped = stripped.replace("_", "")
        # ⚠️ NORMALISED TO `BULLET`, NOT TO `- `. The old form turned a
        # provider's `* item` into `- item`, which is a LIST MARKER in every
        # markdown dialect — so the flattener's own output could be re-parsed
        # by the destination. `•` is a character and nothing parses it.
        if stripped.startswith(("* ", "- ")):
            stripped = BULLET + stripped[2:]
        out.append(stripped)
    return "\n".join(out).strip()
