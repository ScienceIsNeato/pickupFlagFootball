#!/usr/bin/env bash
# Run the full-stack e2e suite (desktop + mobile story report).
#
#   scripts/run_e2e_tests.sh                      # just run the suite
#   scripts/run_e2e_tests.sh --open-report        # run, then open the HTML report
#   scripts/run_e2e_tests.sh --project=mobile     # forward args to the runner
#   scripts/run_e2e_tests.sh --open-report -g "pauses and resumes"
#
# --open-report is consumed here; every other arg is passed through to
# tests/e2e/run.sh (and on to Playwright). The report opens even when the run
# fails — that's exactly when you want to look at the failing beats.
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

open_report=0
args=()
for arg in "$@"; do
  case "$arg" in
    --open-report) open_report=1 ;;
    *) args+=("$arg") ;;
  esac
done

# "${args[@]}" is guarded so an empty array is safe on macOS's bash 3.2.
npm run test:e2e -- ${args[@]+"${args[@]}"}
code=$?

if [ "$open_report" -eq 1 ]; then
  report="tests/e2e/report/output/index.html"
  if [ -f "$report" ]; then
    open "$report"
  else
    echo "run_e2e_tests: no report at $report (did the build fail before any test ran?)" >&2
  fi
fi

exit "$code"
