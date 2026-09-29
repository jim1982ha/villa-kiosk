#!/usr/bin/env bash
# Run one test program; on failure, repeat its failing lines as GitHub error
# annotations. The job log needs a signed-in GitHub account to read, the
# annotations do not — so a red check says WHY in a place anyone (and the
# release tooling here) can read it.
# Usage: agent-host/tests/ci_run.sh python3 agent-host/tests/test_selftest.py
set -uo pipefail
out=$(mktemp)
"$@" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  grep -E '^(FAIL|ERROR):|Error:|assert|    FAIL|^  FAIL' "$out" | head -8 | while IFS= read -r line; do
    echo "::error title=$(basename "${@: -1}")::${line}"
  done
  # The last lines before the summary usually hold the assertion's detail.
  detail=$(grep -B12 -E '^Ran [0-9]+ tests' "$out" | head -12 | tr '\n' '|' | cut -c1-900)
  [ -n "$detail" ] && echo "::error title=$(basename "${@: -1}") detail::${detail}"
fi
rm -f "$out"
exit "$status"
