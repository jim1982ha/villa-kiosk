"""The gateway, pinned by what it ASKED — never by a live property's answer."""
import json

import pytest

from agent.gateway import Gateway, GatewayError, endpoint
from agent.health import LinkState


def transport_for(replies, asked=None, headers=None):
    """A stubbed MCP server.

    ⚠️ IT ANSWERS A NOTIFICATION WITH NOTHING, LIKE A REAL ONE. The first
    version of this stub returned a JSON body for every method including
    `notifications/initialized`, so the client was never exercised against the
    empty 202 a real server sends — and the first real gateway it met answered
    exactly that and was reported as "Expecting value: line 1 column 1".
    """
    async def transport(url, body, extra=None):
        if asked is not None:
            asked.append((url, body, extra or {}))
        method = body["method"]
        if method.startswith("notifications/"):
            assert "id" not in body, "a notification must carry no id"
            return None, (headers or {})
        reply = replies.get(method)
        if callable(reply):
            reply = reply(body)
        if reply is None:
            raise AssertionError(f"nothing stubbed for {method}")
        return reply, (headers or {})
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
    assert [b["method"] for _, b, _ in asked] == [
        "initialize", "notifications/initialized", "tools/list"]
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
    async def transport(url, body, extra=None):
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


# ── reading the property: the S0 acceptance test ───────────────────────────

#: What a real ha-mcp answers `ha_get_overview` with — MEASURED, not imagined:
#: a total, per-domain counts, and TRUNCATED ten-entity samples carrying
#: friendly names and no ids.
OVERVIEW = {"result": {"content": [{"type": "text", "text": json.dumps({
    "system_summary": {"total_entities": 1327, "total_domains": 37},
    "domain_stats": {"sensor": {"count": 581, "truncated": True,
                                "entities": [{"friendly_name": "A"}]}},
})}]}}


@pytest.mark.asyncio
async def test_the_entity_count_is_the_gateways_own_total():
    """⚠️ NOT A LENGTH THIS LAYER COUNTED. The per-domain `entities` lists are
    truncated samples of ten; counting those would under-report a 1,327-entity
    property as a handful and look entirely plausible doing it."""
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS, "tools/call": OVERVIEW}))
    await g.connect()
    assert await g.entity_count() == 1327


@pytest.mark.asyncio
async def test_a_reply_without_a_summary_REFUSES():
    """⚠️ THE STATE THE TEST BUTTON FOUND ON ITS FIRST REAL RUN. A gateway can
    connect, advertise forty tools, and answer a shape this layer does not
    know — and "I could not read it" must never be rendered as an empty
    property."""
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"content": [
                   {"type": "text", "text": json.dumps({"ai_insights": {}})}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    with pytest.raises(GatewayError, match="without a system summary"):
        await g.entity_count()


@pytest.mark.asyncio
async def test_a_structuredContent_envelope_is_unwrapped_too():
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"structuredContent": {
                   "system_summary": {"total_entities": 7}}}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert await g.entity_count() == 7


@pytest.mark.asyncio
async def test_a_property_with_nothing_on_it_is_ZERO_not_a_refusal():
    replies = {"initialize": OK, "tools/list": TOOLS,
               "tools/call": {"result": {"content": [{"type": "text", "text": json.dumps(
                   {"system_summary": {"total_entities": 0}})}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    assert await g.entity_count() == 0


@pytest.mark.asyncio
async def test_a_gateway_without_the_summary_tool_REFUSES():
    replies = {"initialize": OK,
               "tools/list": {"result": {"tools": [{"name": "ha_restart"}]}}}
    g = Gateway("http://h", "s", transport_for(replies))
    await g.connect()
    with pytest.raises(GatewayError, match="does not offer"):
        await g.entity_count()



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



# ── the MCP session, which a real server requires ──────────────────────────

@pytest.mark.asyncio
async def test_the_session_id_is_echoed_on_every_later_request():
    """⚠️ THE STREAMABLE-HTTP TRANSPORT HANDS ONE OUT AND THEN REQUIRES IT. A
    client that drops it gets one good handshake and nothing after."""
    asked = []
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS}, asked,
        headers={"mcp-session-id": "sess-1"}))
    await g.connect()
    # The handshake cannot carry an id it has not been given yet; everything
    # after it must.
    assert "Mcp-Session-Id" not in asked[0][2]
    assert all(a[2].get("Mcp-Session-Id") == "sess-1" for a in asked[1:])


@pytest.mark.asyncio
async def test_the_protocol_version_is_declared_on_every_request():
    asked = []
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS}, asked))
    await g.connect()
    assert all(a[2].get("MCP-Protocol-Version") for a in asked)


@pytest.mark.asyncio
async def test_a_reconnect_starts_a_NEW_session():
    """Carrying an id across a reconnect is how a client ends up talking to a
    session the server has already forgotten."""
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS}, headers={"mcp-session-id": "sess-1"}))
    await g.connect()
    asked = []
    g._transport = transport_for({"initialize": OK, "tools/list": TOOLS}, asked,
                                 headers={"mcp-session-id": "sess-2"})
    await g.connect()
    assert "Mcp-Session-Id" not in asked[0][2], "a stale session id was replayed"


@pytest.mark.asyncio
async def test_an_EMPTY_body_to_a_real_call_is_named_not_a_parse_error():
    """⚠️ WHAT THE OWNER ACTUALLY HIT. The gateway answered with nothing and the
    error read "Expecting value: line 1 column 1 (char 0)" — a true sentence
    about a JSON parser that tells an operator nothing about their gateway."""
    async def transport(url, body, extra=None):
        return None, {"x-vesta-status": "202", "content-type": "text/plain"}
    g = Gateway("http://h", "s", transport)
    link = await g.connect()
    assert link.state is LinkState.DOWN
    assert "body was empty" in link.detail
    assert "Expecting value" not in link.detail
    # ⚠️ AND IT SAYS WHAT THE SERVER ANSWERED WITH. "Empty body" alone sends an
    # operator looking at their secret when the answer is in the status line.
    assert "202" in link.detail and "text/plain" in link.detail


@pytest.mark.asyncio
async def test_ids_are_unique_across_a_session():
    """Reusing id 1 for every call is legal until two are in flight, and then
    it is a bug nobody can see."""
    asked = []
    g = Gateway("http://h", "s", transport_for(
        {"initialize": OK, "tools/list": TOOLS}, asked))
    await g.connect()
    ids = [b["id"] for _, b, _ in asked if "id" in b]
    assert len(ids) == len(set(ids)), f"duplicate request ids: {ids}"
