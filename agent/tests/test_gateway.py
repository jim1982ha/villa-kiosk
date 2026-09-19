"""The gateway, pinned by what it ASKED — never by a live property's answer."""
import pytest

from agent.gateway import Gateway, GatewayError, endpoint
from agent.health import LinkState


def transport_for(replies, asked=None):
    async def transport(url, body):
        if asked is not None:
            asked.append((url, body))
        reply = replies.get(body["method"])
        if callable(reply):
            return reply(body)
        if reply is None:
            raise AssertionError(f"nothing stubbed for {body['method']}")
        return reply
    return transport


TOOLS = {"result": {"tools": [{"name": "ha_get_overview"}, {"name": "ha_search"}]}}
OK = {"result": {"protocolVersion": "2025-06-18"}}


# ── addressing ─────────────────────────────────────────────────────────────

def test_the_secret_is_a_path_prefix():
    assert endpoint("http://host:9583", "s3cret") == "http://host:9583/s3cret"


def test_a_pasted_url_that_already_carries_the_secret_is_not_doubled():
    assert endpoint("http://host:9583/s3cret/", "s3cret") == "http://host:9583/s3cret"


def test_no_address_is_no_endpoint_rather_than_a_broken_one():
    assert endpoint("", "s3cret") == ""
    assert endpoint("http://host:9583", "") == "http://host:9583"


# ── the handshake ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_connecting_handshakes_then_reads_the_catalogue():
    asked = []
    g = Gateway("http://host:9583", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS}, asked))
    link = await g.connect()
    assert link.state is LinkState.UP
    assert [b["method"] for _, b in asked] == ["initialize", "tools/list"]
    assert g.tools == ("ha_get_overview", "ha_search")


@pytest.mark.asyncio
async def test_the_catalogue_is_RE_READ_not_merged():
    """⚠️ ADR-0012's named trap. ha-mcp moves its tool set in minor releases and
    auto-updates; a client that keeps a tool the server dropped calls something
    that no longer exists, and finds out at the worst moment."""
    replies = {"initialize": OK, "tools/list": TOOLS}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert "ha_search" in g.tools
    replies["tools/list"] = {"result": {"tools": [{"name": "ha_get_overview"}]}}
    await g.connect()
    assert "ha_search" not in g.tools, "a removed tool survived a reconnect"


@pytest.mark.asyncio
async def test_a_gateway_that_advertises_nothing_is_DOWN_not_up():
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": {"result": {"tools": []}}}))
    assert (await g.connect()).state is LinkState.DOWN


@pytest.mark.asyncio
async def test_a_refused_connection_is_DOWN_and_carries_the_reason():
    async def transport(url, body):
        raise ConnectionRefusedError("nobody is listening on 9583")
    g = Gateway("http://h", "s", transport)
    link = await g.connect()
    assert link.state is LinkState.DOWN
    assert "nobody is listening" in link.detail


@pytest.mark.asyncio
async def test_an_unconfigured_gateway_says_so_rather_than_calling_nothing():
    g = Gateway("", "", transport_for({}))
    link = await g.connect()
    assert link.state is LinkState.DOWN
    assert "Configuration page" in link.detail


# ── calling ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_tool_the_server_does_not_advertise_is_REFUSED_before_the_wire():
    g = Gateway("http://h", "s", transport_for({"initialize": OK, "tools/list": TOOLS}))
    await g.connect()
    with pytest.raises(GatewayError, match="does not offer"):
        await g.call_tool("ha_invented_tool", {})


@pytest.mark.asyncio
async def test_an_isError_result_raises_rather_than_being_read_as_data():
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"isError": True,
                                         "content": [{"text": "entity not found"}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    with pytest.raises(GatewayError, match="entity not found"):
        await g.call_tool("ha_search", {})


@pytest.mark.asyncio
async def test_a_jsonrpc_error_becomes_a_GatewayError():
    replies = {"initialize": {"error": {"message": "Method not found"}}}
    g = Gateway("http://h", "s", transport_for(replies))
    link = await g.connect()
    assert link.state is LinkState.DOWN and "Method not found" in link.detail


# ── enumerating the villa: the S0 acceptance test ──────────────────────────

@pytest.mark.asyncio
async def test_entities_come_back_from_the_first_tool_the_server_offers():
    rows = [{"entity_id": "a.b"}, {"entity_id": "c.d"}]
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"entities": rows}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert await g.entities() == rows


@pytest.mark.asyncio
async def test_entities_are_also_found_inside_an_mcp_content_block():
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"content": [
                   {"type": "text", "text": '{"entities": [{"entity_id": "a.b"}]}'}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert await g.entities() == [{"entity_id": "a.b"}]


@pytest.mark.asyncio
async def test_a_villa_with_no_entities_is_an_EMPTY_LIST_not_a_refusal():
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"entities": []}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert await g.entities() == []


@pytest.mark.asyncio
async def test_an_UNRECOGNISED_shape_REFUSES_it_does_not_report_an_empty_villa():
    """⚠️ THE DIFFERENCE THAT MATTERS. 'The villa has no entities' is a sentence
    this layer would act on. 'I could not read the answer' is not."""
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"surprise": 1}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    with pytest.raises(GatewayError, match="does not recognise"):
        await g.entities()


@pytest.mark.asyncio
async def test_a_server_offering_no_enumeration_tool_REFUSES_too():
    replies = {"initialize": OK,
               "tools/list": {"result": {"tools": [{"name": "ha_restart"}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    with pytest.raises(GatewayError, match="cannot enumerate"):
        await g.entities()


# ── a saved address must actually arrive ───────────────────────────────────

@pytest.mark.asyncio
async def test_a_new_address_replaces_the_old_one():
    """⚠️ THE DEFECT THE OWNER FOUND. The settings screen wrote the address, the
    layer re-read it, and this object went on holding the one it was built with
    — so the screen showed a saved address beside a connection insisting none
    was configured."""
    g = Gateway("", "", transport_for({"initialize": OK, "tools/list": TOOLS}))
    assert (await g.connect()).state is LinkState.DOWN
    assert g.reconfigure("http://h", "s") is True
    assert g.url == "http://h/s"
    assert (await g.connect()).state is LinkState.UP


@pytest.mark.asyncio
async def test_reconfiguring_to_the_same_address_changes_nothing():
    """A heartbeat that reconnects every five minutes for no reason is churn."""
    g = Gateway("http://h", "s", transport_for({"initialize": OK, "tools/list": TOOLS}))
    await g.connect()
    assert g.reconfigure("http://h", "s") is False
    assert g.link.state is LinkState.UP, "an unchanged address dropped the link"


@pytest.mark.asyncio
async def test_a_NEW_server_does_not_inherit_the_old_ones_tools():
    """ADR-0012 forbids carrying a tool catalogue across a reconnect; pointing
    at a different server is the strongest case of that."""
    g = Gateway("http://a", "s", transport_for({"initialize": OK, "tools/list": TOOLS}))
    await g.connect()
    assert g.tools
    g.reconfigure("http://b", "s")
    assert g.tools == (), "the new server inherited the old one's tools"
    assert g.link.state is LinkState.UNKNOWN
