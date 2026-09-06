"""One owner per /data document.

⚠️ FOUR DOCUMENTS HAD TWO HOMES EACH: the writer in supervisor-proxy.py and the
reader in an adapter, each naming the file with its own string literal, and
nothing pinning the pair. The proxy's `FM_RECORD_COLLECTIONS` was likewise
byte-identical to `adapters/ledger.COLLECTIONS`, and a grep for either name
across tests/ returned nothing at all.

Contrast `adapters/devices.py`, which IS a deliberate second implementation and
IS pinned by test_consistency_parity.py — that is the honest shape for holding
one fact in two places, and these four never had it.

The consequence was concrete: add a sixth collection to the SPA and you had to
find both lists. Miss the proxy's and `_fm_guest_write_ok`'s "any key this
server version doesn't know about must also be untouched" loop silently refuses
every guest fault report.
"""

import importlib.util
import os

import pytest

from conftest import REPO_ROOT

PROXY = os.path.join(REPO_ROOT, "rootfs", "usr", "bin", "supervisor-proxy.py")


@pytest.fixture(scope="module")
def proxy():
    spec = importlib.util.spec_from_file_location("_proxy_under_test", PROXY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_proxy_and_the_adapters_name_the_same_documents(proxy):
    from vesta.adapters import devices, ledger, people
    from vesta.supervise.agent import concerns

    assert proxy.DEVICE_CONFIG_FILE == devices.DEVICE_CONFIG_FILE
    assert proxy.FM_DATA_FILE == ledger.FM_DATA_FILE
    assert proxy.AGENT_CONFIG_FILE == people.CONFIG_PATH
    assert proxy.AGENT_CONCERNS_FILE == concerns.CONCERNS_FILE


def test_the_record_collections_have_one_owner(proxy):
    """⚠️ IDENTITY, NOT EQUALITY. Equal tuples would pass while still being two
    literals drifting apart one edit at a time; `is` proves there is one list."""
    from vesta.adapters import ledger

    assert proxy.FM_RECORD_COLLECTIONS is ledger.COLLECTIONS


def test_the_guest_write_guard_and_the_briefing_read_the_same_list(proxy):
    """The two consumers whose disagreement was the actual hazard."""
    from vesta.adapters import ledger

    assert set(proxy.FM_RECORD_COLLECTIONS) == set(ledger.COLLECTIONS)
    assert "savedDocuments" in proxy.FM_RECORD_COLLECTIONS


def test_the_proxy_holds_no_second_literal_for_a_document_an_adapter_owns():
    """Pins the direction this was fixed in, so the literals cannot creep back."""
    import io

    src = io.open(PROXY, encoding="utf-8").read()
    from conftest import strip_prose
    code = strip_prose(src)
    for owned in ("/data/device-config.json", "/data/fm-data.json",
                  "/data/vesta/agent-config.json", "/data/vesta/concerns.json"):
        assert owned not in code, (
            "supervisor-proxy.py names %s directly; the adapter that reads it "
            "owns that path" % owned)
