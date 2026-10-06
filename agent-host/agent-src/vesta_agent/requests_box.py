"""What the VESTA Agent page asks the running agent to do: a folder of small files (0.6.42).

⚠️ THE PAGE HOLDS NO SECRET AND NEVER TALKS TO HOME ASSISTANT (agent-host CLAUDE.md, contract.ui_env). Two things
on the page need Home Assistant all the same — "Try a command" (a skill's script, run on the live villa) and "Read
the list again" (HA MCP's tools) — so the page writes a request here and the agent, which has the access, carries
it out and writes the answer beside it. The agent decides everything a request may do (app.Vesta.on_request): a
command is checked exactly as when the AI asks for it, and nothing is ever sent or recorded in the Kiosk.

  <data>/requests/<id>.json        written by the page: {"kind": ..., ...}
  <data>/requests/<id>.done.json   written by the agent: the answer; the page reads it, then deletes both
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time

log = logging.getLogger("vesta.requests")

KINDS = ("try", "refresh_tools")
ID = re.compile(r"^[A-Za-z0-9_-]{8,40}$")
STALE_SECONDS = 300            # a request nobody answered, or an answer nobody read: removed after this
POLL = 0.3


def folder(data_dir: str) -> str:
    return os.path.join(data_dir, "requests")


def _write(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)            # whole or not at all: the other side never reads half a request


# ---------------------------------------------------------------------- the page's side
async def ask(data_dir: str, kind: str, payload: dict, timeout: float = 60.0) -> dict | None:
    """The agent's answer, or None when it did not answer in time (it is stopped, or waiting for a setting)."""
    if kind not in KINDS:
        raise ValueError(kind)
    d = folder(data_dir)
    os.makedirs(d, exist_ok=True)
    rid = secrets.token_urlsafe(12)
    req, done = os.path.join(d, f"{rid}.json"), os.path.join(d, f"{rid}.done.json")
    _write(req, {**payload, "kind": kind, "at": time.time()})
    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            if os.path.exists(done):
                with open(done, encoding="utf-8") as f:
                    return json.load(f)
            await asyncio.sleep(POLL)
        return None
    finally:
        for p in (req, done):
            try:
                os.remove(p)
            except OSError:
                pass


# ---------------------------------------------------------------------- the agent's side
def pending(data_dir: str, now: float | None = None) -> list[tuple[str, dict]]:
    """The requests waiting for an answer, oldest first; stale files removed."""
    d = folder(data_dir)
    now = now or time.time()
    out = []
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for name in names:
        path = os.path.join(d, name)
        try:
            age = now - os.path.getmtime(path)
        except OSError:
            continue
        if age > STALE_SECONDS:
            try:
                os.remove(path)
            except OSError:
                pass
            continue
        rid = name[:-len(".json")] if name.endswith(".json") and not name.endswith(".done.json") else None
        if not rid or not ID.match(rid) or os.path.exists(os.path.join(d, f"{rid}.done.json")):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("kind") in KINDS:
            out.append((rid, data))
    return out


def answer(data_dir: str, rid: str, data: dict) -> None:
    _write(os.path.join(folder(data_dir), f"{rid}.done.json"), data)


async def serve(data_dir: str, handle, stop: asyncio.Event) -> None:
    """Answer the page's requests, one at a time, while the agent runs."""
    while not stop.is_set():
        for rid, data in pending(data_dir):
            try:
                res = await handle(data)
            except Exception as e:  # noqa: BLE001 — the page gets a reason, the agent goes on
                log.exception("page request %s failed", data.get("kind"))
                res = {"ok": False, "error": f"The agent could not do it ({type(e).__name__})."}
            answer(data_dir, rid, res)
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL)
        except asyncio.TimeoutError:
            pass
