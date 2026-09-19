#!/usr/bin/env python3
"""Proof that the AI layer's tests are capable of failing.

⚠️ A GREEN SUITE IS NOT A WORKING ONE. This repository has shipped a check that
printed SKIP and exited 0 on every runner, a regex that collapsed nine labels
into one set element, and four counters that read 0 for the very case they
existed to measure. All were green for their whole lives. So each load-bearing
claim in `agent/` is broken here on purpose and the suite is required to notice.

⚠️ AND IT IS A SCRIPT, NOT A PARAGRAPH IN A TICKET. A transcribed procedure goes
stale against the files it describes, silently; a mutation whose target has
moved reports itself as stale rather than as passing. Run it:

    npm run test:agent:mutations

Each mutation edits a real file, runs the suite, and restores the exact original
bytes in a `finally`. Do not interrupt it mid-mutation and then commit without
checking `git status`.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = sys.executable

#: (what is broken, which file, the text to replace, what to replace it with).
MUTATIONS = [
    ("meter: an unknown model costs zero instead of nothing",
     "agent/meter.py", "    if price is None:\n        return None",
     "    if price is None:\n        return 0.0"),
    ("meter: an unpriced call leaves the budget open",
     "agent/meter.py", "        if self.unpriced_calls:\n            return True",
     "        if False:\n            return True"),
    ("meter: cache reads billed at full input price",
     "agent/meter.py", "CACHE_READ_MULTIPLIER = 0.10", "CACHE_READ_MULTIPLIER = 1.0"),
    ("options: the api key prints itself",
     "agent/options.py", 'return "\'***\'" if self else "\'\'"', "return str.__repr__(self)"),
    ("options: a secret passed as a plain str stays plain",
     "agent/options.py",
     "            if not isinstance(value, Secret):\n                object.__setattr__(self, name, Secret(str(value)))",
     "            pass"),
    ("store: writes are no longer atomic",
     "agent/store.py", "            os.replace(tmp, path)",
     "            os.replace(tmp, path)\n            Path(str(path) + '.stray').write_text('x')"),
    ("store: a path-shaped key is accepted",
     "agent/store.py", '_KEY = re.compile(r"^[a-z0-9][a-z0-9_-]*$")',
     '_KEY = re.compile(r"^.*$")'),
    ("health: one link down rounds up to ok",
     "agent/health.py", "    if all(up):\n        return \"ok\"",
     "    if any(up):\n        return \"ok\""),
    ("health: unknown is treated as up",
     "agent/health.py", "    UNKNOWN = \"unknown\"", "    UNKNOWN = \"up\""),
    ("gateway: the tool catalogue is cached across reconnects",
     "agent/gateway.py",
     "            self._tools = {t[\"name\"]: t for t in tools if isinstance(t, dict)\n                           and \"name\" in t}",
     "            self._tools.update({t[\"name\"]: t for t in tools if isinstance(t, dict)\n                           and \"name\" in t})"),
    ("gateway: an unrecognised answer becomes an empty villa",
     "agent/gateway.py",
     '        raise GatewayError(\n            f"the gateway answered a shape this layer does not recognise "',
     '        return []\n        raise GatewayError(\n            f"the gateway answered a shape this layer does not recognise "'),
    ("gateway: a tool the server never advertised is called anyway",
     "agent/gateway.py", "        if name not in self._tools:", "        if False:"),
    ("gateway: an isError result is read as data",
     "agent/gateway.py", '        if isinstance(result, dict) and result.get("isError"):',
     "        if False:"),
    ("listener: a refused auth reads as connected",
     "agent/listener.py", '                if ack.get("type") != "auth_ok":', "                if False:"),
    ("listener: a closed socket still reads up",
     "agent/listener.py", '            self._link = Link(LinkState.DOWN, "the socket closed")',
     "            pass"),
    ("listener: a refused publish is assumed to have worked",
     "agent/listener.py", "        if status >= 400:", "        if False:"),
    ("listener: it asks a question over the listening socket",
     "agent/listener.py", '                await ws.send_json({"id": sub_id, "type": "subscribe_events",',
     '                await ws.send_json({"id": sub_id, "type": "get_states"})\n                await ws.send_json({"id": sub_id, "type": "subscribe_events",'),
    ("runtime: a failed publish takes the layer down again",
     "agent/runtime.py", "        except Exception as exc:\n            self.last_publish_error =",
     "        except ValueError as exc:\n            self.last_publish_error ="),
    ("runtime: a dropped connection ends the add-on",
     "agent/runtime.py", "        while attempts is None or n < attempts:\n            await self.world.hass.listen(self.on_event)",
     "        while n < 1:\n            await self.world.hass.listen(self.on_event)"),
    ("runtime: reconnect stops re-reading the gateway",
     "agent/runtime.py", "            await self.world.hass.connect_gateway()\n            n += 1",
     "            n += 1"),
    ("runtime: it spins instead of waiting between attempts",
     "agent/runtime.py", "            await self.world.clock.sleep(RECONNECT_SECONDS)", "            pass"),
    ("runtime: the meter is not published to the entity",
     "agent/runtime.py", '            "usd_today": round(meter.spent_usd, 4),', '            "usd_today": 0,'),
    ("manifest: an option the code reads is dropped from the manifest",
     "vesta-ai/config.yaml", "  timezone: \"\"\n", ""),
    ("manifest: a default drifts from the code's default",
     "vesta-ai/config.yaml", "  daily_usd_limit: 1.0", "  daily_usd_limit: 2.0"),
    ("manifest: a secret is declared as a plain text field",
     "vesta-ai/config.yaml", "  anthropic_api_key: password?", "  anthropic_api_key: str?"),
    ("log: raising the level no longer silences anything",
     "agent/log.py", "    if LEVELS.index(level) >= _threshold:", "    if True:"),
    ("log: lowering the level no longer reveals anything",
     "agent/log.py", "    if LEVELS.index(level) >= _threshold:", "    if level == 'error':"),
    ("clock: the configured time zone is ignored",
     "agent/clock.py", "                self._tz = ZoneInfo(wanted)\n                self._name = wanted",
     "                pass"),
    ("clock: an unknown zone is swallowed instead of named",
     "agent/clock.py", '                log.warning(f"  time zone {wanted!r} is not one this system knows "',
     '                _ = (f"  time zone {wanted!r} is not one this system knows "'),
    ("meter: a model call prints nothing",
     "agent/meter.py", '        log.info(f"  model call: {usage.model} in={usage.input_tokens} "',
     '        _ = (f"  model call: {usage.model} in={usage.input_tokens} "'),
    ("runtime: the property is never enumerated at start",
     "agent/runtime.py", "        await self.count_entities()", "        pass"),
    ("runtime: a gateway that cannot be asked reports ZERO entities",
     "agent/runtime.py", "            self.entities_seen = None\n            log.warning(",
     "            self.entities_seen = 0\n            log.warning("),
    ("runtime: nothing is written to the add-on's own volume",
     "agent/runtime.py", "        self.record_start()\n\n    async def count_entities",
     "        pass\n\n    async def count_entities"),
    ("runtime: a reporting failure is silenced by a quiet log level",
     "agent/runtime.py", '            log.error(f"  could not publish the status entity: "',
     '            log.debug(f"  could not publish the status entity: "'),
    ("fakes: the stubs stop matching the ports they define",
     "agent/fakes.py", "    async def send(self, target: str, title: str, body: str) -> None:",
     "    def send(self, target: str, title: str, body: str) -> None:"),
    ("manifest: a target ships seeded",
     "vesta-ai/config.yaml", '  owner_target: ""', '  owner_target: "notify.somebody"'),
]

failures, ran = [], 0
for name, rel, old, new in MUTATIONS:
    path = ROOT / rel
    saved = path.read_text()
    ran += 1
    try:
        if saved.count(old) < 1:
            failures.append(f"{name}: TARGET NOT FOUND in {rel} — this sweep is stale")
            continue
        path.write_text(saved.replace(old, new, 1))
        r = subprocess.run([PY, "-m", "pytest", "agent/tests", "-q", "-x"],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0:
            failures.append(f"{name}: SUITE STILL PASSED — nothing tests this")
        else:
            print(f"  RED   {name}")
    finally:
        path.write_text(saved)

print()
if failures:
    print("\n".join(f"    GAP   {f}" for f in failures))
    print(f"  {len(failures)} of {ran} mutations went unnoticed")
    sys.exit(1)
print(f"  PASS  all {ran} mutations were caught by the suite")
