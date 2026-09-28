#!/usr/bin/env bash
# SPEC 17 "Isolation": the agent-host work never touches the VESTA Kiosk.
#
# ⚠️ AGAINST THE MERGE BASE WITH main, not main's tip: main moves on its own
# (the dev2 channel sync, Kiosk releases), and a diff against its tip would
# blame this branch for every Kiosk change made since it forked.
#
# Usage: agent-host/tests/check_isolation.sh [base-ref]   (default origin/main)
set -euo pipefail
BASE_REF="${1:-origin/main}"
base=$(git merge-base "$BASE_REF" HEAD)
touched=$(git diff --name-only "$base" HEAD | grep -E \
  '^(villa-kiosk/|villa-kiosk-dev2/|Dockerfile$|rootfs/|src/|\.github/workflows/(build|ci)\.yaml$)' || true)
if [ -n "$touched" ]; then
  echo "  FAIL  the VESTA Kiosk was touched since $(git rev-parse --short "$base"):"
  sed 's/^/          /' <<<"$touched"
  exit 1
fi
echo "  PASS  no VESTA Kiosk file changed since $(git rev-parse --short "$base") ($(git diff --name-only "$base" HEAD | wc -l) files changed, all outside it)"
