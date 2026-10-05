#!/usr/bin/env python3
"""The app's own store doors — /device-config and /fm-data — over real HTTP.

⚠️ THESE WERE PINNED ONLY BY SOURCE TEXT. The security suite asserted that the
factory's source contained "expected_rev" and "async with lock"; nothing ever
sent a stale revision, a corrupt file or two racing writes at the doors the
kiosk actually uses. Served here by `build_app(data_dir=<a temp dir>)`, the
function main() serves, so a door that is unrouted or routed wrong fails too.

Run: python3 tests/store-doors.py   (also part of `npm run test:proxy`)
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

try:
    from aiohttp.test_utils import TestClient, TestServer
except ModuleNotFoundError:
    print("  FAIL  aiohttp is not installed — `python3 -m pip install aiohttp`")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PROXY = ROOT / "rootfs" / "usr" / "bin" / "supervisor-proxy.py"
TMP = Path(tempfile.mkdtemp(prefix="vk-stores-"))
DATA = TMP / "data"
DATA.mkdir()
(DATA / "options.json").write_text(json.dumps({"owner_pin": "1234"}))

_spec = importlib.util.spec_from_file_location("vk_store_proxy", PROXY)
proxy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(proxy)

FAIL = 0


def ck(name: str, ok: bool, detail: object = "") -> None:
    global FAIL
    print(f"    {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAIL += 1
        if detail != "":
            print(f"          got: {detail}")


def cookie(role: str) -> dict:
    return {"Cookie": f"{proxy.SESSION_COOKIE}={proxy._make_session_token(role)}"}


def on_disk(name: str):
    return json.loads((DATA / name).read_text())


async def main() -> None:
    client = TestClient(TestServer(proxy.build_app(data_dir=str(DATA))))
    await client.start_server()
    owner, guest, ops = cookie("owner"), cookie("guest"), cookie("ops")

    async def call(method, path, headers, body=None):
        r = await client.request(method, path, headers=headers, json=body)
        return r.status, (await r.json() if r.content_type == "application/json" else None)

    # ── /device-config: the owner's shared settings ──────────────────────
    print("  /device-config:")
    status, body = await call("GET", "/device-config", guest)
    ck("never written: any session reads an empty document and a string rev",
       status == 200 and body == {"config": {}, "rev": "0"}, (status, body))
    status, _ = await call("PUT", "/device-config", guest, {"config": {"a": 1}})
    ck("a guest may not write it: 403", status == 403, status)
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 1}})
    rev1 = (body or {}).get("rev")
    ck("the owner writes it: 200 and the new rev", status == 200 and isinstance(rev1, str)
       and rev1 != "0" and on_disk("device-config.json") == {"a": 1}, (status, body))
    status, body = await call("GET", "/device-config", guest)
    ck("  ...and every session reads that document at that rev",
       body == {"config": {"a": 1}, "rev": rev1}, body)
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 2}, "rev": rev1})
    rev2 = (body or {}).get("rev")
    ck("a write naming the current rev lands", status == 200 and rev2 != rev1, (status, body))
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 3}, "rev": rev1})
    ck("a write naming a STALE rev: 409 with the current document and rev, nothing written",
       status == 409 and body == {"error": "conflict", "config": {"a": 2}, "rev": rev2}
       and on_disk("device-config.json") == {"a": 2}, (status, body))
    status, _ = await call("PUT", "/device-config", owner, {"config": [1, 2]})
    ck("the wrong top-level type: 400", status == 400, status)
    status, _ = await call("PUT", "/device-config", owner,
                           {"config": {"x": "y" * (proxy.DEVICE_CONFIG_MAX_BYTES + 1)}})
    ck("past the byte cap: 413, nothing written", status == 413
       and on_disk("device-config.json") == {"a": 2}, status)
    (DATA / "device-config.json").write_text("{not json")
    status, body = await call("PUT", "/device-config", owner, {"config": {"a": 9}})
    ck("a CORRUPT file refuses the write (409) and stays on disk to recover",
       status == 409 and (DATA / "device-config.json").read_text() == "{not json", (status, body))
    status, body = await call("GET", "/device-config", guest)
    ck("  ...while the GET degrades to empty, so a client can still render",
       status == 200 and body["config"] == {}, (status, body))
    (DATA / "device-config.json").unlink()

    # Two writes on ONE rev, sent together: the lock makes exactly one win.
    _, body = await call("PUT", "/device-config", owner, {"config": {"n": 0}})
    base = body["rev"]
    results = await asyncio.gather(*(
        call("PUT", "/device-config", owner, {"config": {"n": i}, "rev": base}) for i in (1, 2)))
    ck("two writes naming the same rev at once: exactly one lands",
       sorted(s for s, _ in results) == [200, 409], [s for s, _ in results])

    # ── /fm-data: the Facility record ────────────────────────────────────
    print("\n  /fm-data:")
    record = {"schedules": [], "completions": [], "costs": [], "savedDocuments": [],
              "tickets": [{"id": "t1", "status": "open", "reportedBy": "owner"}]}
    (DATA / "fm-data.json").write_text(json.dumps(record))
    status, body = await call("GET", "/fm-data", guest)
    ck("a guest reads an EMPTY record, with the real rev",
       status == 200 and body["data"]["tickets"] == [] and body["rev"] != "0", (status, body))
    guest_rev = body["rev"]
    report = {"id": "g1", "status": "open", "reportedBy": "guest", "title": "AC drips"}
    status, body = await call("PUT", "/fm-data", guest,
                              {"data": {**body["data"], "tickets": [report]}, "rev": guest_rev})
    ck("a guest's fault report is filed onto the REAL record, which keeps its tickets",
       status == 200 and [t["id"] for t in on_disk("fm-data.json")["tickets"]] == ["t1", "g1"],
       (status, body))
    status, body = await call("PUT", "/fm-data", guest, {"data": {
        "tickets": [{**report, "id": "g2", "status": "resolved"}]}})
    ck("  ...but not a pre-resolved one: 403", status == 403, (status, body))
    status, body = await call("PUT", "/fm-data", guest,
                              {"data": {"tickets": [{**report, "id": "g3"}]}, "rev": guest_rev})
    ck("a guest's STALE write gets the empty view back in its 409, not the record",
       status == 409 and body["data"]["tickets"] == [] and body["rev"] != guest_rev, (status, body))
    status, body = await call("GET", "/fm-data", ops)
    ck("a facility manager reads the whole record", len(body["data"]["tickets"]) == 2, body)
    status, body = await call("PUT", "/fm-data", ops, {"data": {**body["data"], "tickets": []},
                                                       "rev": body["rev"]})
    ck("deleting evidence without the superadmin code: 403, nothing deleted",
       status == 403 and len(on_disk("fm-data.json")["tickets"]) == 2, (status, body))

    # The app's door and the agent's door open ONE store, so they share ONE lock.
    options = on_disk("options.json")
    options["agent_enabled"] = True
    options["vesta_agent"] = {"token": "agent-token-for-tests-0123456789"}
    (DATA / "options.json").write_text(json.dumps(options))
    _, body = await call("GET", "/fm-data", ops)
    shared_rev, doc = body["rev"], body["data"]
    agent = {"Authorization": "Bearer agent-token-for-tests-0123456789", "X-VK-Peer": "10.0.0.9"}
    extra = {"id": "a1", "status": "open", "reportedBy": "owner"}
    results = await asyncio.gather(
        call("PUT", "/fm-data", ops, {"data": {**doc, "tickets": doc["tickets"] + [
            {"id": "o1", "status": "open", "reportedBy": "owner"}]}, "rev": shared_rev}),
        call("PUT", "/agent/v1/fm-data", agent, {"data": {**doc, "tickets": doc["tickets"] + [extra]},
                                                 "rev": shared_rev}))
    ck("the app and the agent writing on one rev at once: exactly one lands",
       sorted(s for s, _ in results) == [200, 409], results)

    await client.close()


asyncio.run(main())
shutil.rmtree(TMP, ignore_errors=True)
if FAIL:
    print(f"\n❌ {FAIL} store-door check(s) failed")
    sys.exit(1)
print("\n✅ the store doors hold")
