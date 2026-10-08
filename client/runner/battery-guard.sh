#!/bin/bash
# Park the lab before a low battery can put the Mac to sleep with the lab up (2026-09-30 incident).
# Paths: ROOT is this repository; LAB is the lab infrastructure checkout (override with C4_LAB_DIR).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="${C4_LAB_DIR:-$(dirname "$ROOT")/realtime-media-aws-lab}"
JOB="${C4_GUARD_JOB:-backlog.sh}"
while pgrep -f "$JOB" >/dev/null; do
  b=$(pmset -g batt); pct=$(echo "$b" | grep -o '[0-9]*%' | head -1 | tr -d '%')
  if echo "$b" | grep -q "Battery Power" && [ "${pct:-100}" -lt 20 ]; then
    echo "$(date -u +%FT%TZ) battery ${pct}% on battery power: stopping tests and parking"
    pkill -f "$JOB"; pkill -f "run.mjs"
    ( cd "$LAB" && make park; echo "GUARD_PARK_EXIT=$?" )
    exit 0
  fi
  sleep 60
done
echo "$(date -u +%FT%TZ) guard: job finished, guard exiting"
