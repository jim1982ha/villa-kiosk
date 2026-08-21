"""LLM narration must be incapable of making a report worse.

⚠️ EVERY TEST HERE IS A NEGATIVE ONE, AND THAT IS THE DESIGN. The deterministic
renderer is the product; this layer is an overlay on prose that already works.
So the question is never "does the provider produce good output" — it is "can
any state of this thing stop a report, leak a field, or spend without a
ceiling", and the answer has to be no on every path.

The paths, all covered below: no provider configured, no key, no WAN, a
provider that errors, one that times out, one that returns nothing usable, one
that has failed repeatedly, and a month's budget already spent.

⚠️ AND THE DEFAULT PATH IS THE MOST IMPORTANT ONE. Every existing install has
`narration.mode = "deterministic"`, so `shared()` returns None and nothing in
`providers.py` runs at all. A villa with no internet is not merely tolerated
here, it is the case that takes the shortest path — see CLAUDE.md's second hard
rule.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Mapping, Optional, Tuple

from reports import secrets
from reports.narrate import payload as P, providers as PR


# ── the budget ──────────────────────────────────────────────────────────────

def test_the_budget_blocks_at_its_limit() -> None:
    budget = PR.Budget(2)
    assert budget.allowed()
    budget.spend()
    budget.spend()
    assert not budget.allowed()


def test_the_budget_rolls_over_a_month_boundary() -> None:
    """⚠️ A CALENDAR MONTH, NOT A ROLLING WINDOW, because "at most N narrated
    briefs a month" is the sentence an owner can actually reason about. Two
    epoch seconds in different UTC months, so this does not depend on when the
    suite runs."""
    budget = PR.Budget(1)
    january = 1_767_225_600.0    # 2026-01-01
    february = 1_769_904_000.0   # 2026-02-01
    budget.spend(january)
    assert not budget.allowed(january)
    assert budget.allowed(february)


def test_a_zero_limit_permits_nothing() -> None:
    """The honest way to switch the provider off while leaving it configured."""
    assert not PR.Budget(0).allowed()


# ── the breaker ─────────────────────────────────────────────────────────────

def test_the_breaker_opens_after_consecutive_failures_and_recovers() -> None:
    breaker = PR.Breaker(failures=2, reset_s=100.0)
    assert not breaker.is_open(0.0)
    breaker.record_failure(0.0)
    assert not breaker.is_open(0.0)
    breaker.record_failure(0.0)
    assert breaker.is_open(0.0)
    assert breaker.is_open(50.0)
    assert not breaker.is_open(150.0)


def test_one_success_clears_the_count() -> None:
    """⚠️ CONSECUTIVE, NOT CUMULATIVE. A provider that fails once a week for a
    year must never end up permanently disabled by arithmetic."""
    breaker = PR.Breaker(failures=2, reset_s=100.0)
    breaker.record_failure(0.0)
    breaker.record_success()
    breaker.record_failure(0.0)
    assert not breaker.is_open(0.0)


# ── nothing leaves without being configured ─────────────────────────────────

def test_narration_is_off_unless_it_is_switched_on() -> None:
    """⚠️ THE PATH EVERY EXISTING INSTALL TAKES. `CONFIG_DEFAULTS` sets
    `deterministic`, so this is what runs on every villa that has never heard of
    the feature — and it must reach no code that could open a socket."""
    assert PR.shared({}) is None
    assert PR.shared({"mode": "deterministic"}) is None
    assert PR.shared({"mode": "nonsense"}) is None
    assert PR.shared("not a mapping") is None  # type: ignore[arg-type]


def test_the_process_keeps_ONE_narrator_so_the_ceiling_means_something() -> None:
    """⚠️ A NARRATOR PER REPORT IS NOT A CIRCUIT BREAKER AND NOT A CEILING —
    it starts with a closed breaker and a zero count every time, which is a
    provider hammered once per report forever and a runaway that never trips."""
    PR._SHARED.clear()
    first = PR.shared({"mode": "provider"})
    second = PR.shared({"mode": "provider"})
    assert first is not None and first is second


def test_raising_the_limit_does_not_refund_the_month() -> None:
    """⚠️ OTHERWISE THE CEILING IS LIFTABLE BY THE THING IT BOUNDS: a spending
    loop that writes config could zero its own counter by saving the settings
    page."""
    PR._SHARED.clear()
    narrator = PR.shared({"mode": "provider", "monthly_limit": 1})
    assert narrator is not None
    narrator.budget.spend()
    again = PR.shared({"mode": "provider", "monthly_limit": 5})
    assert again is not None
    assert again.budget.limit == 5 and again.budget.used == 1


# ── every refusal, with its reason ──────────────────────────────────────────

class _Secrets:
    """Stand in for the on-disk credential store, without touching /data."""

    def __init__(self, key: str = "") -> None:
        self.key = key

    def install(self, monkeypatch: Any) -> None:
        monkeypatch.setattr(secrets, "get", lambda name: self.key or None)
        monkeypatch.setattr(secrets, "configured", lambda name: bool(self.key))


def _payload() -> Dict[str, Any]:
    return P.build([{"ref": "g0", "kind": "ANOMALY", "severity": "warning",
                     "label": "Pump", "observed": 1.4}],
                   audience="owner", cadence="weekly", period="2026-W34")


def test_why_not_names_each_cause_separately(monkeypatch: Any) -> None:
    """⚠️ A REASON, NOT A BOOLEAN. "Not narrated" has five causes and they call
    for different actions — configure a key, wait, raise a limit, or nothing."""
    _Secrets("").install(monkeypatch)
    narrator = PR.ProviderNarrator("anthropic", 5)
    assert "API key" in narrator.why_not()

    _Secrets("sk-test-key").install(monkeypatch)
    assert narrator.why_not() == ""

    narrator.budget.limit = 0
    assert "limit" in narrator.why_not()
    narrator.budget.limit = 5

    for _ in range(PR.BREAKER_FAILURES):
        narrator.breaker.record_failure()
    assert "failed repeatedly" in narrator.why_not()

    assert "no adapter" in PR.ProviderNarrator("wat", 5).why_not()


def _run(coro: Any) -> Any:
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


def test_no_key_means_the_adapter_is_never_reached(monkeypatch: Any) -> None:
    """⚠️ THE STRONGEST FORM OF THE OFFLINE GUARANTEE: not "the request fails"
    but "no request is attempted". A villa with no WAN and no key does not sit
    through a 20-second timeout on every scheduled report."""
    _Secrets("").install(monkeypatch)
    calls: List[Any] = []

    async def never(*args: Any) -> Optional[str]:
        calls.append(args)
        return "should not happen"

    monkeypatch.setitem(PR.ADAPTERS, "anthropic", never)
    prose, why = _run(PR.ProviderNarrator("anthropic", 5).narrate(None, _payload()))  # type: ignore[arg-type]
    assert prose is None and "API key" in why
    assert calls == [], "the adapter was called with no credential configured"


def _narrator(monkeypatch: Any, adapter: Any) -> PR.ProviderNarrator:
    _Secrets("sk-test-key").install(monkeypatch)
    monkeypatch.setitem(PR.ADAPTERS, "anthropic", adapter)
    return PR.ProviderNarrator("anthropic", 50)


def test_an_adapter_that_raises_degrades_and_trips_the_breaker(monkeypatch: Any) -> None:
    async def boom(*args: Any) -> Optional[str]:
        raise ConnectionError("no route to host")

    narrator = _narrator(monkeypatch, boom)
    prose, why = _run(narrator.narrate(None, _payload()))  # type: ignore[arg-type]
    assert prose is None and "could not be reached" in why
    assert narrator.breaker._count == 1


def test_an_adapter_that_hangs_is_abandoned(monkeypatch: Any) -> None:
    """⚠️ A SCHEDULED REPORT IS COMPOSED INSIDE A 60-SECOND TICK. A provider
    that outlasts the timeout has already cost more than the prose is worth,
    and the deterministic body is sitting ready."""
    async def forever(*args: Any) -> Optional[str]:
        await asyncio.sleep(30)
        return "too late"

    monkeypatch.setattr(PR, "REQUEST_TIMEOUT_S", 0.05)
    narrator = _narrator(monkeypatch, forever)
    prose, why = _run(narrator.narrate(None, _payload()))  # type: ignore[arg-type]
    assert prose is None and "could not be reached" in why


def test_an_empty_answer_is_a_failure_not_an_empty_report(monkeypatch: Any) -> None:
    """⚠️ THE ARM THAT WOULD ACTUALLY DELIVER A BLANK BRIEF. Every other failure
    raises; this one returns successfully with nothing in it, and treating it as
    success would replace a good deterministic body with an empty string."""
    async def nothing(*args: Any) -> Optional[str]:
        return "   \n  "

    narrator = _narrator(monkeypatch, nothing)
    prose, why = _run(narrator.narrate(None, _payload()))  # type: ignore[arg-type]
    assert prose is None and "nothing usable" in why
    assert narrator.breaker._count == 1


def test_a_good_answer_is_used_and_clears_the_breaker(monkeypatch: Any) -> None:
    async def fine(*args: Any) -> Optional[str]:
        return "The pump ran longer than usual this week."

    narrator = _narrator(monkeypatch, fine)
    narrator.breaker.record_failure()
    prose, why = _run(narrator.narrate(None, _payload()))  # type: ignore[arg-type]
    assert prose == "The pump ran longer than usual this week."
    assert why == "" and narrator.breaker._count == 0
    assert narrator.budget.used == 1


# ── the privacy gate, at the last possible moment ───────────────────────────

def test_a_payload_that_fails_its_own_audit_is_never_sent(monkeypatch: Any) -> None:
    """⚠️ `payload.build` IS CORRECT AND THIS ASKS ANYWAY. The cost of the two
    disagreeing is not a bad report — it is a field that left the villa, which
    no later release un-sends. A non-empty audit must mean the adapter is not
    called at all."""
    calls: List[Any] = []

    async def never(*args: Any) -> Optional[str]:
        calls.append(args)
        return "sent anyway"

    narrator = _narrator(monkeypatch, never)
    tainted = _payload()
    tainted["findings"][0]["entity_id"] = "sensor.emmas_bedroom_window"
    prose, why = _run(narrator.narrate(None, tainted))  # type: ignore[arg-type]
    assert prose is None and "privacy audit" in why
    assert calls == [], "a payload that failed its audit was transmitted"


def test_the_budget_is_spent_before_the_call_not_after(monkeypatch: Any) -> None:
    """⚠️ OTHERWISE A PROVIDER THAT ERRORS IS FREE, and the ceiling does not
    bound the case it exists for: a loop that fails and retries forever. The
    request was made; it counts."""
    async def boom(*args: Any) -> Optional[str]:
        raise ConnectionError("nope")

    narrator = _narrator(monkeypatch, boom)
    _run(narrator.narrate(None, _payload()))  # type: ignore[arg-type]
    assert narrator.budget.used == 1


# ── whatever comes back is plain text ───────────────────────────────────────

def test_markdown_is_flattened_however_nicely_the_prompt_asked() -> None:
    """⚠️ `deliver.py` SENDS THE INTERSECTION OF WHAT NOTIFY PLATFORMS ACCEPT.
    A model that returns markdown produces literal asterisks and hashes on the
    platforms that do not parse it, and asking politely in a prompt is not a
    guarantee."""
    out = PR._flatten("## Summary\n**Pump** ran `14` times\n_soon_\n* item one\n")
    for markup in ("#", "*", "`", "_"):
        assert markup not in out, f"{markup!r} survived the flatten"
    assert "Summary" in out and "Pump" in out and "soon" in out
    # ⚠️ `•`, NOT `- `. The old normalisation turned a provider's `* item` into
    # `- item` — a LIST MARKER in every markdown dialect — so the flattener's
    # own output could be re-parsed by the destination it was protecting.
    from reports.narrate.style import BULLET
    assert f"{BULLET}item one" in out


def test_the_prompt_carries_the_payload_and_no_instructions_to_judge() -> None:
    """⚠️ THE PROVIDER IS ASKED FOR PROSE, NOT FOR JUDGEMENT. Every number and
    severity was decided by the villa's own automations; a prompt inviting the
    model to assess or rank would put an unaccountable opinion into a document
    the owner acts on, and would make the two renderers disagree about what
    happened."""
    text = PR._prompt(_payload())
    assert "Use ONLY the facts" in text
    assert "Pump" in text, "the payload is not in the prompt at all"
    for forbidden in ("decide", "judge", "assess", "prioriti", "recommend which"):
        assert forbidden not in text.lower(), forbidden


def test_the_only_hostname_lives_in_its_adapter() -> None:
    """⚠️ ONE PLACE, SO THE CHECK BELOW MEANS SOMETHING. A hostname repeated
    across a file cannot be derived from it, and a pin that has to be told what
    to look for goes stale the day a second provider is added."""
    import inspect
    source = inspect.getsource(PR)
    assert source.count("https://api.") == 1


# ── the offline hard rule, pinned across the language boundary ──────────────

def _provider_hosts() -> List[str]:
    """Every third-party host this add-on may contact, read from the adapters.

    Derived, not listed: the second provider is covered on the day it is added.
    """
    import inspect
    import re
    return re.findall(r"https://([a-z0-9.-]+)/", inspect.getsource(PR))


def test_no_provider_hostname_is_reachable_from_the_browser_bundle() -> None:
    """⚠️ CLAUDE.md's SECOND HARD RULE, IN THE ONE PLACE NOBODY WOULD LOOK.

    The target is an iPad in a villa that may have no WAN at all. Every rule in
    this subsystem is built around that, and all of it is undone if the SPA can
    talk to a provider directly: a page that fetches an LLM host works on a
    developer's desk and is simply missing on the wall, AND it would put an API
    key in a browser to do it.

    The design forbids it structurally — all provider traffic originates in the
    add-on process, and `/reports-secret` has no read path for the value — but
    "structurally forbidden" is a property of today's code. This is the check
    that keeps it true, and it is deliberately a SEPARATE assertion from
    `_provider_hosts` being derivable: one proves the list is real, the other
    proves the list is absent from the bundle.

    ⚠️ THE SAME SHAPE AS `test_store_envelope`: a rule spanning Python and
    TypeScript with nothing but a string literal between them. Here the rule is
    the inverse — the literal must NOT match.
    """
    import os

    hosts = _provider_hosts()
    assert hosts, "no provider hostnames found — this check's anchor moved"

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    offenders: List[str] = []
    for base, dirs, files in os.walk(os.path.join(root, "src")):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in files:
            if not name.endswith((".ts", ".tsx", ".css", ".html")):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            for host in hosts:
                if host in text:
                    offenders.append(f"{os.path.relpath(path, root)}: {host}")
    assert not offenders, (
        "a provider hostname appears in the SPA bundle — narration must "
        f"originate in the add-on process, never the browser: {offenders}")
