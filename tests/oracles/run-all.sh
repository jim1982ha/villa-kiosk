#!/bin/sh
# Every backport oracle. LOCAL ONLY — tests/ is gitignored and main keeps no
# tracked test suite (see .scratch/backport-main/spec.md). Each oracle
# discriminates the OLD rule from the NEW, so a pass means the fix changed
# something, not merely that the code runs.
#
# ⚠️ `open/` HOLDS ORACLES THAT ARE SUPPOSED TO FAIL — each pins a defect that
# is found, reproduced and NOT YET FIXED. They are run and reported separately
# rather than deleted or left to redden the gate, because a suite that goes
# green by dropping the case it could not satisfy is worse than no suite.
cd "$(dirname "$0")" || exit 1
fail=0
for f in *.mjs; do
  printf '\n═══ %s ═══\n' "$f"
  node "$f" 2>/dev/null || { echo "  ^ FAILED"; fail=1; }
done
printf '\n%s\n' "$([ $fail -eq 0 ] && echo '✅ all fixed-defect oracles pass' || echo '❌ SOME ORACLES FAILED')"
if [ -d open ]; then
  printf '\n──────── known-open defects (expected to fail) ────────\n'
  for f in open/*.mjs; do
    [ -e "$f" ] || continue
    printf '\n═══ %s ═══\n' "$f"
    node "$f" 2>/dev/null && echo "  ⚠️ THIS NOW PASSES — the defect is fixed; move it out of open/"
  done
fi
exit $fail
