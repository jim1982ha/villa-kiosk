#!/usr/bin/env bash
# Runs the built image the way the Supervisor does and checks what a person
# would see in the app's log. Used locally and by CI after each image push.
#
# ⚠️ THE IMAGE, NOT THE SOURCE. test_host.py proves the programs; this proves
# the s6 wiring around them — that init-vesta runs before the slot, that a
# failed validation really stops the container, and that nothing in the whole
# log (s6's own lines included) carries a secret.
#
# Usage: agent-host/tests/container_test.sh <image> [--platform linux/arm64]
set -euo pipefail

IMAGE="$1"; shift
PLATFORM=("$@")
WORK=$(mktemp -d)
FAILED=0
KEY="sk-ant-CONTAINERTEST-0123456789"
HATOKEN="eyJhbGciOiJIUzI1NiJ9.CONTAINERTEST"
TGTOKEN="123456:TELEGRAM-CONTAINERTEST"

cleanup() {
  docker rm -f vesta-ct >/dev/null 2>&1 || true
  # Files in the mounts were written by root inside the container.
  docker run --rm "${PLATFORM[@]}" --entrypoint /bin/rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/config /w/stub >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ⚠️ NEVER `docker logs | grep -q` UNDER pipefail: grep -q exits at its first
# match, docker logs dies of SIGPIPE, and the pipeline reports failure for a
# line that IS there — the longer the log, the likelier. Read it, then search.
has()  { local logs; logs=$(docker logs vesta-ct 2>&1); grep -qE -- "$1" <<<"$logs"; }
hasf() { local logs; logs=$(docker logs vesta-ct 2>&1); grep -qF -- "$1" <<<"$logs"; }
ok()   { echo "  PASS  $*"; }
bad()  {
  echo "  FAIL  $*"; FAILED=1
  # The job log needs a signed-in GitHub account; an annotation does not.
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=container_test ${PLATFORM[*]:-}::$*"
  return 0
}
wait_log() {  # wait_log <text> <seconds>
  for _ in $(seq 1 $(( $2 * 2 ))); do
    hasf "$1" && return 0
    sleep 0.5
  done
  return 1
}
no_secret() {
  local logs; logs=$(docker logs vesta-ct 2>&1)
  for s in "$KEY" "$HATOKEN" "$TGTOKEN"; do
    if grep -qF "$s" <<<"$logs"; then bad "a secret appears in the log ($1)"; return; fi
  done
  ok "no secret in the log ($1)"
}
fresh() {
  docker rm -f vesta-ct >/dev/null 2>&1 || true
  docker run --rm "${PLATFORM[@]}" --entrypoint /bin/rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/config >/dev/null 2>&1 || true
  mkdir -p "$WORK/data" "$WORK/config"
}

echo "== 1. HA app, stub mode, secrets set, Telegram takeover off"
fresh
cat > "$WORK/data/options.json" <<EOF
{"agent_mode":"stub","ha_url":"http://homeassistant:8123",
 "kiosk_url":"http://e66a2348-villa-kiosk:8099","telegram_takeover":false,
 "stub_heartbeat":false,"log_level":"info",
 "ha_token":"$HATOKEN","telegram_bot_token":"$TGTOKEN"}
EOF
docker run -d --name vesta-ct "${PLATFORM[@]}" -e TZ=Asia/Bangkok \
  -v "$WORK/data:/data" -v "$WORK/config:/config" "$IMAGE" >/dev/null
if wait_log "stub: no heartbeat" 90; then ok "started: banner, self-test, stub"; else bad "the stub never started"; fi
has "deployment ha_app" && ok "banner: deployment ha_app" || bad "banner lacks deployment"
has "link Home Assistant: http://homeassistant:8123 · token set" && ok "banner: token set (value hidden)" || bad "banner lacks the HA token state"
for link in "Home Assistant" "HA MCP" "VESTA Kiosk" "Anthropic" "Telegram" "Presence"; do
  has "self-test ${link}: (pass|fail|skipped)" && ok "self-test line: ${link}" || bad "no self-test line for ${link}"
done
has "self-test Telegram: skipped — telegram_takeover is off" && ok "Telegram skipped, no call" || bad "Telegram not skipped"
has "stub: environment contract received: 16/16" && ok "stub received the full contract" || bad "stub contract incomplete"
[ -s "$WORK/data/host/selftest.json" ] && grep -q '"summary"' "$WORK/data/host/selftest.json" && ok "selftest.json written" || bad "selftest.json missing"
grep -qF "$HATOKEN" "$WORK/data/host/selftest.json" && bad "a secret in selftest.json" || ok "no secret in selftest.json"
has "time zone: Asia/Bangkok" && ok "banner: time zone from TZ" || bad "banner lacks TZ"
no_secret "stub"
[ -f "$WORK/config/skills/README.md" ] && [ -d "$WORK/data/agent" ] && ok "folders created" || bad "folders missing"
# The agent's UI (Home Assistant sidebar): beside the stub too, reachable only
# through Home Assistant's Ingress gateway, and holding no secret.
wait_log "UI: listening on port 8095" 60 && ok "the UI runs beside the stub" || bad "the UI did not start"
ui=$(docker exec vesta-ct python3 -c '
import urllib.request, urllib.error
try:
    urllib.request.urlopen("http://127.0.0.1:8095/api/policy", timeout=5); print("OPEN")
except urllib.error.HTTPError as e:
    print(e.code)' 2>&1)
[ "$(tail -1 <<<"$ui")" = "403" ] && ok "the UI refuses a process inside the container (not the Ingress gateway)" \
  || bad "the UI answered a local process: $(tail -1 <<<"$ui")"
# ⚠️ THE UI'S OWN PROCESS, BY ITS ARGUMENTS: this probe's command line contains the words too, and matching
# on a substring once read this probe's own environment — both checks below passed on the wrong process.
uienv=$(docker exec vesta-ct python3 -c '
import os
for pid in os.listdir("/proc"):
    try:
        args = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
        if pid != str(os.getpid()) and b"-m" in args and b"vesta_agent.ui" in args:
            print(open(f"/proc/{pid}/environ", "rb").read().replace(b"\0", b"\n").decode()); break
    except OSError:
        pass')
if [ -z "$uienv" ]; then bad "the UI process was not found"
elif grep -qF "$HATOKEN" <<<"$uienv" || grep -qF "$TGTOKEN" <<<"$uienv" || grep -q "SUPERVISOR_TOKEN" <<<"$uienv"; then
  bad "a secret in the UI's environment"
else ok "no secret in the UI's environment"; fi
grep -q "^VESTA_APP_VERSION=[0-9]" <<<"$uienv" && ok "the UI knows the app's version" \
  || bad "the UI process has no VESTA_APP_VERSION (the page cannot show the app's version)"
env_json=$(docker exec vesta-ct cat /run/vesta/agent-env.json)
grep -q '"VESTA_TELEGRAM_ENABLED": "false"' <<<"$env_json" && ! grep -qF "$TGTOKEN" <<<"$env_json" \
  && ok "Telegram token not exported" || bad "Telegram token exported with takeover off"
grep -qF "$KEY" "$WORK"/config -r 2>/dev/null && bad "a secret was written under /config" || ok "no secret under /config"
start=$(date +%s)
docker stop -t 30 vesta-ct >/dev/null
took=$(( $(date +%s) - start ))
code=$(docker inspect vesta-ct --format '{{.State.ExitCode}}')
[ "$took" -lt 30 ] && [ "$code" = "0" ] && ok "clean stop in ${took} s" || bad "stop took ${took} s, exit ${code}"

echo "== 2. README kept on restart"
# Written as root through a container, as Home Assistant's file editors do:
# the file was created by root inside the app.
docker run --rm "${PLATFORM[@]}" --entrypoint /bin/sh -v "$WORK/config:/config" "$IMAGE" \
  -c 'echo "edited by a person" > /config/skills/README.md'
docker start vesta-ct >/dev/null
wait_log "stub: no heartbeat" 90 >/dev/null || true
docker stop -t 30 vesta-ct >/dev/null
[ "$(cat "$WORK/config/skills/README.md")" = "edited by a person" ] && ok "README not overwritten" || bad "README overwritten"

echo "== 2b. Live skills: a file added from Home Assistant is visible without a restart"
docker start vesta-ct >/dev/null
wait_log "stub: no heartbeat" 90 >/dev/null || true
docker run --rm "${PLATFORM[@]}" --entrypoint /bin/sh -v "$WORK/config:/config" "$IMAGE" \
  -c 'mkdir -p /config/skills/pool-care && echo "# pool care" > /config/skills/pool-care/SKILL.md'
docker exec vesta-ct test -f /config/skills/pool-care/SKILL.md && ok "new skill visible in the running app" || bad "new skill not visible"
docker stop -t 30 vesta-ct >/dev/null

echo "== 3. HA app, agent mode, no API key: must not start"
fresh
echo '{"agent_mode":"agent","ha_url":"http://homeassistant:8123","kiosk_url":"http://e66a2348-villa-kiosk:8099","telegram_takeover":false,"stub_heartbeat":false,"log_level":"info"}' \
  > "$WORK/data/options.json"
docker run -d --name vesta-ct "${PLATFORM[@]}" -v "$WORK/data:/data" -v "$WORK/config:/config" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do [ "$(docker inspect vesta-ct --format '{{.State.Running}}')" = "false" ] && break; sleep 0.5; done
if [ "$(docker inspect vesta-ct --format '{{.State.Running}}')" = "false" ]; then ok "container stopped by itself"; else bad "container kept running"; fi
has "agent mode needs anthropic_api_key" && ok "clear message in the log" || bad "no message"
has "self-test" && bad "the agent slot started anyway" || ok "agent slot never started"

echo "== 4. Standalone: VESTA_OPT_* variables, no options.json"
fresh
docker run -d --name vesta-ct "${PLATFORM[@]}" \
  -e VESTA_OPT_HA_TOKEN="$HATOKEN" -e VESTA_OPT_KIOSK_URL=https://kiosk.example.test \
  -v "$WORK/data:/data" -v "$WORK/config:/config" "$IMAGE" >/dev/null
wait_log "stub: no heartbeat" 90 && ok "standalone started" || bad "standalone did not start"
has "deployment standalone" && ok "banner: deployment standalone" || bad "banner lacks standalone"
has "link VESTA Kiosk: https://kiosk.example.test" && ok "option read from environment" || bad "VESTA_OPT_KIOSK_URL ignored"
no_secret "standalone"
docker stop -t 30 vesta-ct >/dev/null

echo "== 5. HA MCP sidecar: starts with a token, loopback only, answers the self-test"
# The options an 0.8.x install still holds for the removed external mode
# (decision D2) are part of this run: they must change nothing.
fresh
cat > "$WORK/data/options.json" <<EOF
{"agent_mode":"stub","ha_url":"http://homeassistant:8123","ha_mcp_mode":"external","ha_mcp_url":"http://127.0.0.1:9/mcp",
 "kiosk_url":"http://e66a2348-villa-kiosk:8099","telegram_takeover":false,
 "stub_heartbeat":false,"log_level":"info","ha_token":"$HATOKEN"}
EOF
docker run -d --name vesta-ct "${PLATFORM[@]}" -v "$WORK/data:/data" -v "$WORK/config:/config" "$IMAGE" >/dev/null
wait_log "stub: no heartbeat" 180 || true
has "self-test HA MCP: pass — ha-mcp [0-9.]+, [0-9]+ tools" && ok "HA MCP self-test passes against the sidecar" || bad "HA MCP self-test did not pass"
# /proc/net/tcp: port 9583 = 256F, listening = state 0A. 0100007F = 127.0.0.1.
tcp=$(docker exec vesta-ct cat /proc/net/tcp /proc/net/tcp6 2>/dev/null)
grep -qE ":256F [0-9A-F:]+ 0A" <<<"$tcp" && ! grep -qE "^ *[0-9]+: 0+:256F .* 0A" <<<"$tcp" \
  && grep -qE "0100007F:256F [0-9A-F:]+ 0A" <<<"$tcp" && ok "sidecar listens on 127.0.0.1 only" || bad "sidecar not loopback-only"
has "pypi.org" && bad "the sidecar called PyPI (update check not disabled)" || ok "no update check"
# ⚠️ THE AGENT'S CALLS HAVE THE SHAPE OF THIS SERVER'S TOOL. The agent's tests check
# its ha_call_service arguments against a saved copy of the tool's input schema
# (agent-src/tests/fixtures); an HA MCP release that changes it fails here, before
# it can reach the Yellow. (0.9.1: a list where 8.5.0 takes one string, and the
# first approved action on the villa failed.)
live=$(docker exec -i vesta-ct /opt/vesta/ha-mcp/bin/python - <<'EOF' 2>&1
import json, urllib.request
def post(body):
    r = urllib.request.Request("http://127.0.0.1:9583/mcp", json.dumps(body).encode(),
                               {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    return urllib.request.urlopen(r, timeout=10).read().decode()
post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26",
      "capabilities": {}, "clientInfo": {"name": "container-test", "version": "1"}}})
raw = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
data = [l[5:] for l in raw.splitlines() if l.startswith("data:")]
tools = json.loads(data[0] if data else raw)["result"]["tools"]
print(json.dumps(next(t for t in tools if t["name"] == "ha_call_service")["inputSchema"], sort_keys=True))
EOF
)
saved=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' \
        "$(dirname "$0")/../agent-src/tests/fixtures/ha_mcp_ha_call_service.schema.json")
[ "$(tail -1 <<<"$live")" = "$saved" ] && ok "ha_call_service takes the arguments the agent's tests check" \
  || bad "ha_call_service's input schema changed in this HA MCP: update agent-src/tests/fixtures and the agent — $(tail -3 <<<"$live" | cut -c1-400)"
no_secret "sidecar"
start=$(date +%s); docker stop -t 30 vesta-ct >/dev/null; took=$(( $(date +%s) - start ))
has "ha-mcp stopped cleanly" && [ "$took" -lt 30 ] && ok "sidecar stopped cleanly after the agent (${took} s)" || bad "sidecar stop (${took} s)"

echo "== 6. The VESTA Agent itself, in this image, against a fake villa"
# The real engine and its starter skills, started directly (the slot's gate
# wants Home Assistant AND Anthropic to pass, and a CI run has neither): its
# settings from the environment contract, its folders under /tmp, the fake
# villa of tests/fake_remote.py on the host network (HA MCP, the Kiosk).
FAKE_PORT=18080
python3 "$(dirname "$0")/fake_remote.py" "$FAKE_PORT" >/dev/null 2>&1 &
FAKE_PID=$!
sleep 1
docker rm -f vesta-ct >/dev/null 2>&1 || true
docker run -d --name vesta-ct "${PLATFORM[@]}" --network host --entrypoint /opt/vesta/agent/.venv/bin/python \
  -w /opt/vesta/agent \
  -e ANTHROPIC_API_KEY="$KEY" -e VESTA_HA_MCP_URL="http://127.0.0.1:${FAKE_PORT}/mcp" \
  -e VESTA_HA_URL="http://127.0.0.1:${FAKE_PORT}" -e VESTA_HA_TOKEN="$HATOKEN" \
  -e VESTA_KIOSK_URL="http://127.0.0.1:${FAKE_PORT}" -e VESTA_KIOSK_TOKEN="kiosk-TOKEN-123456" \
  -e VESTA_TELEGRAM_ENABLED=false -e VESTA_TELEGRAM_BOT_TOKEN="$TGTOKEN" \
  -e VESTA_SKILLS_DIR=/tmp/skills -e VESTA_AGENT_CONFIG_DIR=/tmp/agent-config -e VESTA_DATA_DIR=/tmp/agent-data \
  -e TZ=Asia/Bangkok "$IMAGE" -m vesta_agent >/dev/null
if wait_log "Acting on the villa is OFF" 120; then ok "the VESTA Agent started"; else bad "the VESTA Agent did not start"; fi
hasf "Starter skills copied to the skills folder (first start): alert-desk, preventive-maintenance, reports, roi-energy, villa-concierge" \
  && ok "starter skills seeded once" || bad "starter skills not seeded"
hasf "Skills: alert-desk, preventive-maintenance, reports, roi-energy, villa-concierge" && ok "five skills loaded" || bad "skills not loaded"
hasf "VESTA Kiosk: agreement 1" && ok "Kiosk agreement checked" || bad "Kiosk not checked"
hasf "HA MCP: 2 tools on the server" && ok "HA MCP read through the client" || bad "HA MCP not read"
hasf "Telegram: off" && ok "Telegram off: nothing sent" || bad "Telegram not off"
docker exec vesta-ct test -f /tmp/agent-config/policy.yaml && docker exec vesta-ct test -f /tmp/skills/.seeded \
  && ok "policy.yaml and the seed marker written" || bad "config not seeded"
docker exec vesta-ct sh -c 'grep -q "people: \[\]" /tmp/agent-config/policy.yaml' && ok "the example policy ships empty" || bad "policy not empty"
no_secret "agent"
start=$(date +%s); docker stop -t 30 vesta-ct >/dev/null; took=$(( $(date +%s) - start ))
hasf "Stopped" && [ "$took" -lt 20 ] && ok "the agent stopped cleanly on SIGTERM (${took} s)" || bad "agent stop (${took} s)"
kill "$FAKE_PID" 2>/dev/null || true

echo "== 6b. The agent in the image: its libraries, its code, nothing else"
# The code and the libraries now come from different stages (the layer order
# that keeps updates small): check they met, and that tests and the old PDF
# browser stayed out.
got=$(docker run --rm "${PLATFORM[@]}" --entrypoint sh "$IMAGE" -c '
cd /opt/vesta/agent && .venv/bin/python -c "import vesta_agent, claude_agent_sdk, jinja2, aiohttp, yaml; print(\"IMPORTS\")"
test -f starter/shipped-skills.json && test -f starter/skills/reports/templates/report.html && echo STARTER
test ! -e tests && test ! -e README.md && test ! -e install.sh && echo CLEAN
command -v chromium-headless-shell chromium >/dev/null || echo NOBROWSER' 2>&1)
for w in IMPORTS STARTER CLEAN NOBROWSER; do
  grep -qx "$w" <<<"$got" && ok "agent image: $w" || bad "agent image: $w missing — $(tr '\n' ' ' <<<"$got" | cut -c1-600)"
done

# A stand-in agent mounted over the stub, to exercise the slot's policy.
mkstub() {  # mkstub <start command> <grace>
  mkdir -p "$WORK/stub"
  printf 'name: test-stub\nversion: "0"\nruntime: python\nstart: "%s"\nstop_grace_seconds: %s\n' "$1" "$2" \
    > "$WORK/stub/vesta-agent.yaml"
}
DEFAULT_OPTS='{"agent_mode":"stub","ha_url":"http://homeassistant:8123","kiosk_url":"http://e66a2348-villa-kiosk:8099","telegram_takeover":false,"stub_heartbeat":false,"log_level":"info"}'

echo "== 7. Stop grace: an agent that needs 15 s to stop gets them, all within 30 s"
fresh; echo "$DEFAULT_OPTS" > "$WORK/data/options.json"
mkstub "trap 'echo saving; sleep 15; echo saved; exit 0' TERM; echo up; while :; do sleep 1; done" 20
docker run -d --name vesta-ct "${PLATFORM[@]}" -v "$WORK/data:/data" -v "$WORK/config:/config" \
  -v "$WORK/stub:/opt/vesta/stub:ro" "$IMAGE" >/dev/null
wait_log "[agent] up" 90 || true
start=$(date +%s); docker stop -t 30 vesta-ct >/dev/null; took=$(( $(date +%s) - start ))
has "\[agent\] saved" && [ "$took" -ge 15 ] && [ "$took" -lt 30 ] \
  && ok "agent finished its 15 s shutdown; container stopped in ${took} s" || bad "grace not honoured (${took} s)"

echo "== 8. Crash: restarted after 5 s, the app keeps running"
fresh; echo "$DEFAULT_OPTS" > "$WORK/data/options.json"
mkstub "echo boom; exit 3" 5
docker run -d --name vesta-ct "${PLATFORM[@]}" -v "$WORK/data:/data" -v "$WORK/config:/config" \
  -v "$WORK/stub:/opt/vesta/stub:ro" "$IMAGE" >/dev/null
wait_log "crash 2 of 5" 90 || true
has "exited with code 3 \(crash 1 of 5 allowed in 10 min\) — restarting in 5 s" && ok "first crash: restart in 5 s" || bad "no 5 s restart"
has "crash 2 of 5 allowed in 10 min\) — restarting in 10 s" && ok "second crash: restart in 10 s (doubling)" || bad "backoff not doubling"
[ "$(docker inspect vesta-ct --format '{{.State.Running}}')" = "true" ] && ok "container still running" || bad "container died"
docker stop -t 30 vesta-ct >/dev/null

echo
if [ "$FAILED" = 0 ]; then echo "✅ container checks passed"; else
  echo "❌ container checks FAILED"; tail_log=$(docker logs vesta-ct 2>&1 | tail -30); echo "$tail_log"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=container_test last log lines::$(tr '\n' '|' <<<"$tail_log" | cut -c1-1500)"
fi
exit "$FAILED"
