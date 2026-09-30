#!/usr/bin/env bash
# M6: the same image, run by `docker compose` outside Home Assistant, passes
# the self-test the way a remote deployment would (SPEC 13, H1).
#
# ⚠️ THE SHIPPED COMPOSE FILE, VERBATIM. It is copied next to a filled-in
# vesta-agent.env and an override that adds one more service: a fake of every
# remote end (tests/fake_remote.py) acting as Cloudflare Access — it refuses
# any request without the service-token headers. So a pass here means the
# options came from VESTA_OPT_*, the Cloudflare variables reached every
# request, and the stop fits compose's grace — not merely that it started.
#
# Usage: agent-host/tests/standalone_test.sh <image>
set -euo pipefail

IMAGE="$1"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
PROJECT="vesta-standalone-test-$$"
FAILED=0
HA_TOKEN=ha-TOKEN-123456 KIOSK_TOKEN=kiosk-TOKEN-123456
CF_ID=cf-client-id.access CF_SECRET=cf-SECRET-123456

ok()  { echo "  PASS  $*"; }
bad() { echo "  FAIL  $*"; FAILED=1; }
compose() { docker compose -p "$PROJECT" --project-directory "$WORK" \
              -f "$WORK/docker-compose.yaml" -f "$WORK/override.yaml" "$@"; }
logs() { compose logs --no-color --no-log-prefix vesta-agent 2>&1; }
has()  { local l; l=$(logs); grep -qE -- "$1" <<<"$l"; }
wait_log() {
  for _ in $(seq 1 $(( $2 * 2 ))); do has "$1" && return 0; sleep 0.5; done
  return 1
}
cleanup() {
  compose down -v -t 30 >/dev/null 2>&1 || true
  docker run --rm --entrypoint /bin/rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/config >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cp "$HERE/../standalone/docker-compose.yaml" "$WORK/"
cat > "$WORK/override.yaml" <<EOF
services:
  vesta-agent:
    image: $IMAGE
    depends_on: [villa]
  villa:
    image: $IMAGE
    entrypoint: ["python3", "/tests/fake_remote.py", "8080"]
    environment:
      FAKE_REQUIRE_CF: "1"
    volumes:
      - $HERE:/tests:ro
EOF
write_env() {  # write_env <cf id> <cf secret>
  cat > "$WORK/vesta-agent.env" <<EOF
VESTA_OPT_AGENT_MODE=stub
VESTA_OPT_HA_URL=http://villa:8080
VESTA_OPT_HA_TOKEN=$HA_TOKEN
VESTA_OPT_KIOSK_URL=http://villa:8080
VESTA_OPT_KIOSK_AGENT_TOKEN=$KIOSK_TOKEN
VESTA_OPT_STUB_HEARTBEAT=true
VESTA_OPT_TELEGRAM_TAKEOVER=false
VESTA_CF_ACCESS_CLIENT_ID=$1
VESTA_CF_ACCESS_CLIENT_SECRET=$2
VESTA_INSTANCE=prod
TZ=Asia/Bangkok
EOF
}

echo "== 1. Remote deployment with the Cloudflare Access service token"
write_env "$CF_ID" "$CF_SECRET"
compose up -d >/dev/null 2>&1
wait_log "stub: heartbeat" 180 || true
has "deployment standalone · instance prod" && ok "banner: standalone, prod" || bad "banner"
for line in "Home Assistant: pass" "HA MCP: pass — ha-mcp" "VESTA Kiosk: pass — contract 1" \
            "Presence: pass" "Anthropic: skipped" "Telegram: skipped"; do
  has "self-test $line" && ok "self-test $line" || bad "self-test $line"
done
has "stub: heartbeat: HTTP 200" && ok "stub heartbeats through Cloudflare Access" || bad "stub heartbeat"
l=$(logs); leaked=0
for s in "$HA_TOKEN" "$KIOSK_TOKEN" "$CF_SECRET"; do grep -qF "$s" <<<"$l" && leaked=1; done
[ "$leaked" = 0 ] && ok "no secret in the log" || bad "a secret in the log"
[ -s "$WORK/data/host/selftest.json" ] && [ -f "$WORK/config/skills/README.md" ] \
  && ok "state in ./data, skills in ./config" || bad "folders"
start=$(date +%s); compose stop -t 30 vesta-agent >/dev/null 2>&1; took=$(( $(date +%s) - start ))
has "agent stopped cleanly" && [ "$took" -lt 30 ] && ok "compose stop: clean, ${took} s" || bad "stop (${took} s)"
compose down -v >/dev/null 2>&1
docker run --rm --entrypoint /bin/rm -v "$WORK:/w" "$IMAGE" -rf /w/data /w/config >/dev/null 2>&1 || true

echo "== 2. Same, without the service token: refused, reported as fail"
write_env "" ""
compose up -d >/dev/null 2>&1
wait_log "starting vesta-agent-stub" 180 || true
has "self-test Home Assistant: fail — HTTP 403" && ok "Home Assistant refused (403) → fail" || bad "HA not refused"
has "self-test VESTA Kiosk: fail — HTTP 403" && ok "VESTA Kiosk refused (403) → fail" || bad "Kiosk not refused"
has "starting vesta-agent-stub" && ok "stub mode still starts" || bad "stub did not start"

echo
[ "$FAILED" = 0 ] && echo "✅ standalone checks passed" || { echo "❌ standalone checks FAILED"; logs | tail -40; }
exit "$FAILED"
