#!/usr/bin/env bash
# The shared rules are dev2's (owner, 2026-10-25: "his claude agent and you always share the same rules"): CLAUDE.md,
# rules/ and the git guards (tools/hooks/) are written on dev2, and this branch carries the same files. A rule edited
# here first, or a copy left behind, stops the release with the command that copies dev2's.
#
# Usage: agent-host/tests/check_shared_rules.sh [ref]   (default origin/dev2, fetched when absent: a CI checkout)
set -euo pipefail
REF="${1:-origin/dev2}"
git rev-parse -q --verify "$REF^{commit}" >/dev/null || git fetch -q --depth=1 origin "dev2:refs/remotes/origin/dev2"
PATHS=(CLAUDE.md rules tools/hooks)
differ=$( { git diff --name-only "$REF" -- "${PATHS[@]}"; git ls-files --others --exclude-standard -- "${PATHS[@]}"; } | sort -u)
if [ -n "$differ" ]; then
  echo "  FAIL  the shared rules differ from $REF's:"
  sed 's/^/          /' <<<"$differ"
  echo "        Rules are written on dev2. Take dev2's:  git checkout $REF -- ${PATHS[*]}"
  exit 1
fi
echo "  PASS  CLAUDE.md, rules/ and tools/hooks/ are $REF's"
