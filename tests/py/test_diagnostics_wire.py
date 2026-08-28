"""Every key the diagnostics endpoint sends is one the client reads.

⚠️ SHIPPED BROKEN AND REPORTED WITHIN THE HOUR (2026-08-28). The Observe tab
was given `journal.last_seen` so it could stop reporting the collector's clock
as the villa's. The backend produced it correctly — the live villa answered
`2026-08-28T03:42:42Z`, fresh — and the tab still said "Connected, but nothing
has been written down yet" above 51,579 recorded changes.

The proxy emitted it as `lastSeen`; the client camelCases every key on the way
in, exactly as it does for `at_bound` and `span_days`, so it looked for
`last_seen` in a payload that no longer had one. Two correct halves and a join
nobody owned. CLAUDE.md calls this the envelope bug one level down and the
mechanism is identical: **a key that differs is ACCEPTED AND IGNORED rather
than refused**, so the field simply reads as absent and the screen renders the
"we have nothing" branch — which is indistinguishable from a real fault.

⚠️ THE FIX WAS ONE WORD; THE POINT OF THIS FILE IS THAT NOTHING COULD HAVE
CAUGHT IT. The backend had a test, the component had a test, and both passed
throughout. `test_store_envelope.py` pins the OUTER key of each store for
exactly this reason; this pins the inner keys of the one payload that is
assembled by hand rather than stored.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Set

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "rootfs", "usr", "bin"))

PROXY = os.path.join(REPO, "rootfs", "usr", "bin", "supervisor-proxy.py")
CLIENT = os.path.join(REPO, "src", "reports", "reportsApi.ts")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _journal_keys_sent() -> Set[str]:
    """The keys the proxy puts in the `journal` block, from the proxy itself."""
    proxy = _read(PROXY)
    block = proxy[proxy.index("snap = observe_heartbeat.snapshot()"):]
    block = block[:block.index("except Exception")]
    return set(re.findall(r'"([a-z_]+)": snap\.get\(', block))


def _journal_keys_read() -> Set[str]:
    """The keys the client pulls out of that block."""
    client = _read(CLIENT)
    block = client[client.index("      journal: {"):]
    block = block[:block.index("\n      },")]
    return set(re.findall(r"journal\.([a-z_]+)", block))


def test_every_journal_key_the_proxy_SENDS_is_one_the_client_READS() -> None:
    sent, read = _journal_keys_sent(), _journal_keys_read()
    assert sent, "no journal keys found in the proxy — this test is blind"
    assert read, "no journal keys found in the client — this test is blind"
    unread = sent - read
    assert not unread, (
        f"the proxy sends journal key(s) nothing reads: {sorted(unread)}. A key "
        f"that differs is accepted and ignored, so the field reads as absent "
        f"and the screen renders its 'we have nothing' branch.")


def test_every_journal_key_the_client_READS_is_one_the_proxy_SENDS() -> None:
    """⚠️ THE OTHER DIRECTION, AND IT IS THE ONE THAT BIT. The client asking for
    a key nobody sends is the exact failure: silent, and shaped like health."""
    sent, read = _journal_keys_sent(), _journal_keys_read()
    missing = read - sent
    assert not missing, (
        f"the client reads journal key(s) the proxy never sends: "
        f"{sorted(missing)}. It will be `undefined` and fall to a default.")


def test_the_PROXY_speaks_snake_case_like_the_stores_do() -> None:
    """⚠️ THE CONVENTION IS THE THING, not any one key. The client camelCases on
    the way in; a proxy key already in camelCase is read as a different name and
    silently dropped. Asserting the convention catches the NEXT one too."""
    proxy = _read(PROXY)
    block = proxy[proxy.index("snap = observe_heartbeat.snapshot()"):]
    block = block[:block.index("except Exception")]
    camel = [k for k in re.findall(r'"([A-Za-z_]+)": snap\.get\(', block)
             if any(c.isupper() for c in k)]
    assert not camel, (
        f"these diagnostics keys are camelCase on the wire: {camel}. Every "
        f"other key in this payload is snake_case and the client converts.")


def test_the_JOURNAL_S_CLOCK_survives_the_whole_round_trip() -> None:
    """⚠️ END TO END, BECAUSE THE TWO HALVES WERE INDIVIDUALLY CORRECT. The
    backend produces it, the wire carries it under the name the client asks
    for, and the component reads that name. Any one of the three moving alone
    is the defect."""
    from vesta.supervise.observe import heartbeat
    assert "last_seen" in heartbeat.snapshot({}), "the backend stopped producing it"
    assert "last_seen" in _journal_keys_sent(), "the proxy stopped sending it"
    assert "last_seen" in _journal_keys_read(), "the client stopped reading it"
    observe = _read(os.path.join(REPO, "src", "components", "agent",
                                 "ReflexObserve.tsx"))
    assert "lastSeen" in observe, "the Observe tab stopped reading it"
