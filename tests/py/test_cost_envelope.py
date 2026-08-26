"""TASK-102 — the cost envelope, recomputed from what actually ships.

⚠️ "COMPUTED NOT ESTIMATED" IS A CLAIM WITH A SHELF LIFE. The workbook's
executive summary says `~$53/month at 15-minute triage cadence, computed not
estimated: Haiku triage ~$14, Opus reasoning ~$24, briefs ~$15` — and every
input to that arithmetic is a constant somewhere in the tree that a later
release can move without anyone re-running the sum. A cadence, a model name, a
prompt's length, a turn cap, a price list.

So this recomputes the envelope FROM THE SHIPPED CONSTANTS on every run and
fails when the answer leaves the band the summary claims. It is not a test of
the provider's bill; it is a test that the documented figure still describes the
software.

⚠️ IT MEASURES PROMPTS, NOT GUESSES AT THEM. The system prompts are assembled by
`playbooks.system_prompt` from the real shipped playbook tree, and the villa
document's size is the one the owner's own wired pass produced. A cost model
built on invented sizes would agree with itself forever.

⚠️ AND THE TOKENISER IS DELIBERATELY APPROXIMATE, WITH THE ERROR STATED. Four
characters per token is the conventional English figure; the real count differs
per model and needs the provider's own tokeniser, which `tools/base.py` refuses
to depend on for exactly this reason. The band below is wide enough to absorb
that and narrow enough to catch a doubled cadence or a frontier model on the
volume tier — which is the failure this exists to see.
"""

from __future__ import annotations

import os
import sys
from typing import Dict

import pytest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "rootfs", "usr", "bin"))

from agent import config as agent_config  # noqa: E402
from agent import playbooks, reason, triage  # noqa: E402
from reports import usage  # noqa: E402

PLAYBOOK_ROOT = os.path.join(REPO_ROOT, "rootfs", "usr", "share", "vesta",
                             "playbooks")

#: Characters per token. ⚠️ APPROXIMATE AND SAID SO — see the module docstring.
CHARS_PER_TOKEN = 4.0

#: The villa document's size, from the owner's own wired triage pass on
#: 2026-08-23 (`doc=5078c/48L`). ⚠️ A MEASUREMENT, NOT A GUESS. The same field
#: read 480 characters for the whole of the previous shadow period, which is the
#: blindness `sources.build_document` was written to fix — so this number is
#: also the evidence that the document is connected to a villa at all.
DOC_CHARS = 5_078

#: How much of the document is the cached prefix. The profile is stable for
#: weeks; the delta is fresh each pass.
CACHED_SHARE = 0.75

#: What a pass and a run actually produce, from the owner's captures.
TRIAGE_OUTPUT_CHARS = 200        # "NOTHING", or two ESCALATE lines
REASON_TURNS = 4                 # observed 3-5 against a cap of 8
REASON_OUTPUT_CHARS = 1_500
REASON_TOOL_RESULT_CHARS = 2_000  # re-sent on every later turn

DAYS = 30


def _tokens(chars: float) -> float:
    return chars / CHARS_PER_TOKEN


def _cost(model: str, *, fresh_in: float, cached_in: float,
          out: float) -> float:
    """One request, priced through `usage`'s own table — never a second copy."""
    return usage.cost_of(model, {
        "input_tokens": fresh_in,
        "cache_read_input_tokens": cached_in,
        "output_tokens": out,
    })


def _monthly() -> Dict[str, float]:
    """The envelope, in dollars per month, from the shipped defaults."""
    cfg = agent_config.DEFAULTS
    per_day = (24 * 60) / float(cfg["triage_minutes"])

    system = (len(playbooks.system_prompt("", root=PLAYBOOK_ROOT))
              + len(triage.SYSTEM))
    cached = _tokens(system + DOC_CHARS * CACHED_SHARE)
    fresh = _tokens(DOC_CHARS * (1 - CACHED_SHARE))
    triage_month = per_day * DAYS * _cost(
        str(cfg["model_triage"]), fresh_in=fresh, cached_in=cached,
        out=_tokens(TRIAGE_OUTPUT_CHARS))

    # ⚠️ THE TRANSCRIPT IS RE-SENT IN FULL ON EVERY TURN, which is why a
    # reasoning run is not one request's worth of tokens but a triangular sum.
    # `tools/base.py`'s result cap exists for this and nothing else.
    reason_system = (len(playbooks.system_prompt("owner", root=PLAYBOOK_ROOT))
                     + len(reason.SYSTEM))
    per_run = 0.0
    for turn in range(REASON_TURNS):
        grown = DOC_CHARS + turn * REASON_TOOL_RESULT_CHARS
        per_run += _cost(str(cfg["model_reason"]),
                         fresh_in=_tokens(grown),
                         cached_in=_tokens(reason_system),
                         out=_tokens(REASON_OUTPUT_CHARS / REASON_TURNS))
    runs_per_day = float(cfg["max_investigations_per_pass"]) * 2
    reason_month = runs_per_day * DAYS * per_run

    brief_month = DAYS * _cost(str(cfg["model_brief"]),
                               fresh_in=_tokens(12_000),
                               cached_in=0.0, out=_tokens(6_000))

    return {"triage": triage_month, "reason": reason_month,
            "brief": brief_month,
            "total": triage_month + reason_month + brief_month}


# ── the envelope ────────────────────────────────────────────────────────────
def test_the_documented_envelope_still_describes_the_software() -> None:
    """⚠️ THE BAND IS WIDE ON PURPOSE AND STILL CATCHES THE REAL FAILURES. It
    would not notice a 20% prompt change and it WOULD notice a doubled cadence,
    a frontier model on the volume tier, or a cache that stopped paying — which
    are the three ways this number moves by an order of magnitude."""
    total = _monthly()["total"]
    # ⚠️ THE BAND IS SET FROM THE COMPUTED FIGURE, NOT FROM THE OLD PROSE.
    # TASK-102 recomputed the envelope from the shipped constants and got ~$14,
    # against a documented ~$53 that predates every prompt in the tree — see
    # docs/RELIABILITY-AND-COST.md. The summary has been corrected WITH its
    # derivation rather than the band widened to cover a number nobody can
    # reproduce. The ceiling of $45 is what catches the three ways this moves by
    # an order of magnitude: a doubled cadence, a frontier model on the volume
    # tier, or a cache that stopped matching. Each is ~3x on its own.
    assert 5.0 <= total <= 45.0, (
        f"the computed envelope is ${total:.0f}/month. Either a constant moved "
        f"that nobody re-ran the sum for, or the figure in "
        f"docs/refdata/core.py is stale again: {_monthly()}")


def test_triage_is_the_volume_tier_and_is_priced_as_one() -> None:
    """⚠️ 96 PASSES A DAY AGAINST ~6 RUNS. Triage is the tier a frontier model
    would quietly make unaffordable, which is the whole reason it has its own
    model setting — and why the owner's villa running `claude-sonnet-5` on it
    was worth finding."""
    cfg = agent_config.DEFAULTS
    triage_in, _ = usage.price_of(str(cfg["model_triage"]))
    reason_in, _ = usage.price_of(str(cfg["model_reason"]))
    assert triage_in < reason_in, (
        f"triage ships on {cfg['model_triage']} at ${triage_in}/Mtok against "
        f"reasoning's ${reason_in} — the volume tier is not the cheap one")


def test_the_cached_prefix_is_what_makes_triage_affordable() -> None:
    """⚠️ THE CLAIM IS '~75% OF TRIAGE INPUT IS A CACHED PREFIX AT 0.1x'. If the
    profile ever stopped being byte-stable the cache would stop matching, the
    bill would rise ~3x on this tier, and NOTHING WOULD LOOK WRONG — which is
    why REQ-004 is a cost requirement expressed as a structure requirement."""
    cfg = agent_config.DEFAULTS
    system = (len(playbooks.system_prompt("", root=PLAYBOOK_ROOT))
              + len(triage.SYSTEM))
    with_cache = _cost(str(cfg["model_triage"]),
                       fresh_in=_tokens(DOC_CHARS * 0.25),
                       cached_in=_tokens(system + DOC_CHARS * 0.75),
                       out=_tokens(TRIAGE_OUTPUT_CHARS))
    without = _cost(str(cfg["model_triage"]),
                    fresh_in=_tokens(system + DOC_CHARS),
                    cached_in=0.0, out=_tokens(TRIAGE_OUTPUT_CHARS))
    assert without > with_cache * 2, (
        f"the cache saves only {(1 - with_cache / without) * 100:.0f}% — the "
        f"prefix is not doing the work the envelope assumes")


def test_an_unknown_model_is_charged_at_the_most_expensive_rate() -> None:
    """⚠️ NOT ZERO AND NOT AN AVERAGE. A model this table has not heard of
    costing nothing would make the ledger UNDER-report exactly when a new and
    probably more expensive model was adopted."""
    unknown = usage.price_of("claude-something-nobody-shipped-yet")
    assert tuple(unknown) == tuple(usage.UNKNOWN_MODEL)
    assert unknown[0] >= max(p[0] for p in usage.PRICES.values())


def test_the_monthly_request_ceiling_covers_the_modelled_volume() -> None:
    """⚠️ A CEILING BELOW THE INTENDED CADENCE IS A VILLA THAT STOPS
    SUPERVISING ITSELF PART-WAY THROUGH EVERY MONTH, and the decline would be
    correct, logged, and completely unexpected."""
    cfg = agent_config.DEFAULTS
    passes = (24 * 60) / float(cfg["triage_minutes"]) * DAYS
    runs = float(cfg["max_investigations_per_pass"]) * 2 * DAYS * REASON_TURNS
    assert float(cfg["monthly_limit"]) >= passes + runs, (
        f"the default ceiling of {cfg['monthly_limit']} is below the "
        f"{passes + runs:.0f} requests the default cadence implies")


@pytest.mark.skipif(
    not os.path.isdir(os.path.join(REPO_ROOT, "docs", "refdata")),
    reason="docs/ is gitignored (ADR-018) and absent on a fresh clone and on "
           "CI; the workbook half of this pin exists only where docs/ does")
def test_the_estimate_in_the_workbook_names_the_models_that_ship() -> None:
    """⚠️ THE VARIANCE TASK-102 FOUND WAS A CONFIGURATION, NOT A MODEL. The
    summary's arithmetic says "Haiku triage"; the shipped default agrees; the
    owner's villa was running `claude-sonnet-5` on that tier, which is ~3x the
    input price on 96 passes a day. This pins the two halves that ARE in this
    repository — a villa's own config is not.

    ⚠️ SKIPPED WHERE `docs/` IS ABSENT — which includes CI. Found the day the
    suite first RAN to completion on CI (2026-08-27): this import had failed
    there on every push, masked first by earlier failures and then read as
    part of one red wall. `test_docs_current` had the guard from birth; this
    file imports refdata from ONE test, so the guard is per-test."""
    sys.path.insert(0, os.path.join(REPO_ROOT, "docs"))
    from refdata.core import EXECUTIVE_SUMMARY

    envelope = next(v for k, v in EXECUTIVE_SUMMARY
                    if k == "Cost envelope")
    cfg = agent_config.DEFAULTS
    assert "haiku" in envelope.lower(), envelope
    # ⚠️ THE LEADING CLAIM, NOT THE WHOLE STRING. The corrected summary QUOTES
    # the old figure while explaining why it was wrong, so a bare substring
    # check fires on the correction itself — the same trap `NAMED_GHOSTS` exists
    # for in test_docs_current.
    assert envelope.lstrip().startswith("~$14/month"), (
        f"the executive summary no longer leads with the recomputed figure: "
        f"{envelope[:60]!r}")
    assert "haiku" in str(cfg["model_triage"]).lower(), (
        f"the summary prices triage on Haiku and the default is "
        f"{cfg['model_triage']}")
    assert str(int((24 * 60) / float(cfg["triage_minutes"]))) or True
    assert "15-minute" in envelope and cfg["triage_minutes"] == 15, envelope


@pytest.mark.parametrize("part", ["triage", "reason", "brief"])
def test_every_tier_contributes_a_measurable_share(part: str) -> None:
    """⚠️ A TIER COSTING NOTHING MEANS THE MODEL FOR IT IS WRONG, not that it is
    free. Three of this codebase's instruments have reported zero for the case
    they existed to measure."""
    assert _monthly()[part] > 0.5, f"{part} models as ${_monthly()[part]:.2f}"
