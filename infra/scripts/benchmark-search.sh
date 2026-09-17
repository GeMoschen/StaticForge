#!/usr/bin/env sh
set -euo pipefail

# StaticForge search benchmark (M23.5.1, spec §26.1).
#
# Runs the perf-gated SearchBenchmark JUnit test against the real Spring context on a filesystem index: a full
# rebuild of an N-page project (default 5,000, the generation benchmark's fixture size), p50/p95 of 200 representative
# queries, and the indexing lag around a burst of 100 page saves.
#
# Usage:
#   infra/scripts/benchmark-search.sh [pages]
#
# Examples:
#   infra/scripts/benchmark-search.sh          # 5,000-page target fixture
#   infra/scripts/benchmark-search.sh 500      # quick smoke

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PAGES="${1:-5000}"
OUT="$REPO/server/sf-app/build/perf-results/search-summary.txt"

export SF_PERF=true
export SF_PERF_PAGES="$PAGES"
export SF_PERF_OUT="$OUT"

cd "$REPO"
./gradlew --no-daemon :server:sf-app:test \
    --tests '*SearchBenchmark*' \
    -Pfrontend.skip=true \
    --console=plain

if [ -f "$OUT" ]; then
    echo "--- search benchmark summary ---"
    cat "$OUT"
else
    echo "No summary written; the benchmark test was skipped or failed. Ensure SF_PERF=true was set." >&2
    exit 1
fi
