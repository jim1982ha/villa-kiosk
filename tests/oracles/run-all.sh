#!/bin/sh
# Every oracle — `npm run test:oracles`, a CI gate (.github/workflows/ci.yaml).
# TRACKED despite tests/ being gitignored (negation patterns in .gitignore;
# verify with `git ls-files`). Each oracle discriminates the OLD rule from the
# NEW, so a pass means the fix changed something, not merely that the code runs.
#
# ⚠️ STDERR IS SHOWN (round 11, 2.496.173). It went to /dev/null, so an oracle
# that CRASHED — an import that throws, a missing export — printed only
# "^ FAILED" with its cause discarded, locally and in the CI log alike.
# `--no-warnings` drops only Node's type-stripping ExperimentalWarning.
#
# ⚠️ `open/` HOLDS ORACLES THAT ARE SUPPOSED TO FAIL — each pins a defect that
# is found, reproduced and NOT YET FIXED. They are run and reported separately
# rather than deleted or left to redden the gate, because a suite that goes
# green by dropping the case it could not satisfy is worse than no suite.
#
# ⚠️ IN PARALLEL, PRINTED IN ORDER (2026-10-05): one oracle at a time was 74 s of
# the 108 s gate run. No oracle writes a file, opens a port or reads dist/, so
# they run side by side (one per core); each one's output is kept and printed in
# file order with its own verdict, exactly as before. VK_ORACLE_JOBS=1 runs
# them one at a time again (to bisect an interference, should one ever appear).
cd "$(dirname "$0")" || exit 1
out=$(mktemp -d) || exit 1
trap 'rm -rf "$out"' EXIT
jobs=${VK_ORACLE_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
# `--changed` (`npm run oracles:changed`, retro 2026-10-24: four ships failed this way in one day, each a full gate
# run): only the oracles that NAME a file changed since the last commit (its path or its name, staged or not, new
# files included), and any oracle changed itself — seconds, before `ship`. A pre-check only: an oracle reaching the
# file through another module is not picked, so `ship` still runs them all.
if [ "$1" = "--changed" ]; then
  changed=$(cd ../.. && { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
  picked=$(for f in $changed; do
    case $f in tests/oracles/*.mjs) basename "$f"; continue ;; tests/oracles/*) continue ;; src/*|rootfs/*|tests/*) ;; *) continue ;; esac
    stem=$(basename "$f"); stem=${stem%.*}
    [ ${#stem} -ge 4 ] && grep -l -F -- "$stem" *.mjs
  done | sort -u)
  [ -n "$picked" ] || { echo "no oracle names a changed file"; exit 0; }
  printf 'oracles naming a changed file: %s\n' "$(echo $picked)"
  set -- --failed
else
  picked=$(ls *.mjs)
fi
echo "$picked" | xargs -P "$jobs" -I{} sh -c 'node --no-warnings "$1" > "$2/$1.out" 2>&1; echo $? > "$2/$1.rc"' _ {} "$out"
# `--failed` (`npm run test:oracles -- --failed`): only the oracles that failed, each with its FAIL lines — or, for
# one that crashed, the end of its output — and a count. The default prints everything, as CI's log wants (2026-10-14:
# finding the failures in ~180 oracles' output was a loop rewritten by hand every time).
quiet=0; [ "$1" = "--failed" ] && quiet=1
fail=0; failed=0; total=0
for f in $picked; do
  total=$((total + 1))
  ok=1; [ "$(cat "$out/$f.rc" 2>/dev/null)" = "0" ] || ok=0
  if [ $quiet -eq 1 ]; then
    [ $ok -eq 1 ] && continue
    printf '\n═══ %s ═══\n' "$f"
    grep -E '^\s*FAIL\b' "$out/$f.out" || tail -n 15 "$out/$f.out"
  else
    printf '\n═══ %s ═══\n' "$f"
    cat "$out/$f.out"
    [ $ok -eq 1 ] || echo "  ^ FAILED"
  fi
  [ $ok -eq 1 ] || { fail=1; failed=$((failed + 1)); }
done
printf '\n%s\n' "$([ $fail -eq 0 ] && echo "✅ all fixed-defect oracles pass ($total)" || echo "❌ SOME ORACLES FAILED ($failed of $total)")"
if [ -d open ] && [ $quiet -eq 0 ]; then
  printf '\n──────── known-open defects (expected to fail) ────────\n'
  for f in open/*.mjs; do
    [ -e "$f" ] || continue
    printf '\n═══ %s ═══\n' "$f"
    node --no-warnings "$f" && echo "  ⚠️ THIS NOW PASSES — the defect is fixed; move it out of open/"
  done
fi
exit $fail
