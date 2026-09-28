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
  docker run --rm "${PLATFORM[@]}" --entrypoint /bin/rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/config >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ⚠️ NEVER `docker logs | grep -q` UNDER pipefail: grep -q exits at its first
# match, docker logs dies of SIGPIPE, and the pipeline reports failure for a
# line that IS there — the longer the log, the likelier. Read it, then search.
has()  { local logs; logs=$(docker logs vesta-ct 2>&1); grep -qE -- "$1" <<<"$logs"; }
hasf() { local logs; logs=$(docker logs vesta-ct 2>&1); grep -qF -- "$1" <<<"$logs"; }
ok()   { echo "  PASS  $*"; }
bad()  { echo "  FAIL  $*"; FAILED=1; }
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
{"agent_mode":"stub","ha_url":"http://homeassistant:8123","ha_mcp_mode":"sidecar",
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
has "stub: environment contract received: 17/17" && ok "stub received the full contract" || bad "stub contract incomplete"
[ -s "$WORK/data/host/selftest.json" ] && grep -q '"summary"' "$WORK/data/host/selftest.json" && ok "selftest.json written" || bad "selftest.json missing"
grep -qF "$HATOKEN" "$WORK/data/host/selftest.json" && bad "a secret in selftest.json" || ok "no secret in selftest.json"
has "time zone: Asia/Bangkok" && ok "banner: time zone from TZ" || bad "banner lacks TZ"
no_secret "stub"
[ -f "$WORK/config/skills/README.md" ] && [ -d "$WORK/data/agent" ] && ok "folders created" || bad "folders missing"
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

echo "== 3. HA app, agent mode, no API key: must not start"
fresh
echo '{"agent_mode":"agent","ha_url":"http://homeassistant:8123","ha_mcp_mode":"sidecar","kiosk_url":"http://e66a2348-villa-kiosk:8099","telegram_takeover":false,"stub_heartbeat":false,"log_level":"info"}' \
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

echo
if [ "$FAILED" = 0 ]; then echo "✅ container checks passed"; else echo "❌ container checks FAILED"; docker logs vesta-ct 2>&1 | tail -30; fi
exit "$FAILED"
