#!/usr/bin/env sh
set -euo pipefail

# StaticForge generation-performance benchmark (spec §18.6 / §26.1 / §25.1).
#
# Runs the perf-gated GenerationBenchmark JUnit test against the real Spring context,
# timing a FULL then an INCREMENTAL generation. The 5,000- and 50,000-page fixtures are
# intended for the nightly CI job; the default here is a fast 500-page smoke.
#
# Usage:
#   infra/scripts/benchmark-generation.sh [pages] [locales]
#
# Examples:
#   infra/scripts/benchmark-generation.sh          # 500-page smoke
#   infra/scripts/benchmark-generation.sh 5000     # §18.6 target fixture
#   infra/scripts/benchmark-generation.sh 5000 2   # §18.6 target fixture in two languages (M24)
#   infra/scripts/benchmark-generation.sh 50000    # §18.6 heavy fixture (nightly)
#
# With several languages the plan holds pages x languages entries, so the number to compare across
# runs is the summary's msPerEntry, not its fullMs (§18.6's target is stated per plan entry).

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PAGES="${1:-500}"
LOCALES="${2:-1}"
OUT="$REPO/server/sf-app/build/perf-results/generation-summary.txt"

# The benchmark gate reads SF_PERF; SF_PERF_PAGES/SF_PERF_OUT configure the fixture size and
# the summary output location. SF_PERF_OUT is honoured because Gradle does not auto-forward
# -D system properties to the forked test JVM.
export SF_PERF=true
export SF_PERF_PAGES="$PAGES"
export SF_PERF_LOCALES="$LOCALES"
export SF_PERF_OUT="$OUT"

cd "$REPO"
./gradlew --no-daemon :server:sf-app:test \
    --tests '*GenerationBenchmark*' \
    --console=plain

if [ -f "$OUT" ]; then
    echo "--- generation benchmark summary ---"
    cat "$OUT"
else
    echo "No summary written; the benchmark test was skipped or failed. Ensure SF_PERF=true was set." >&2
    exit 1
fi
