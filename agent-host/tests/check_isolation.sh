#!/usr/bin/env bash
# SPEC 17 "Isolation": the agent-host work never adds or changes a VESTA Kiosk file.
#
# ⚠️ AGAINST THE MERGE BASE WITH main, not main's tip: main moves on its own
# (the dev2 channel sync, Kiosk releases), and a diff against its tip would
# blame this branch for every Kiosk change made since it forked.
# Deletions are allowed: this branch dropped its stale copy of the Kiosk tree
# (the Kiosk lives on dev2), and agent-dev is never merged into main.
#
# Usage: agent-host/tests/check_isolation.sh [base-ref]   (default origin/main)
set -euo pipefail
BASE_REF="${1:-origin/main}"
base=$(git merge-base "$BASE_REF" HEAD)
touched=$(git diff --diff-filter=d --name-only "$base" HEAD | grep -E \
  '^(villa-kiosk/|villa-kiosk-dev2/|Dockerfile$|rootfs/|src/|\.github/workflows/(build|ci)\.yaml$)' || true)
if [ -n "$touched" ]; then
  echo "  FAIL  the VESTA Kiosk was touched since $(git rev-parse --short "$base"):"
  sed 's/^/          /' <<<"$touched"
  exit 1
fi
echo "  PASS  no VESTA Kiosk file added or changed since $(git rev-parse --short "$base")"
