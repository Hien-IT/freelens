#!/bin/bash
# Baseline of a packaged Freelens build: size, time to first window, idle RSS.
# usage: measure.sh <app zip> <runs> <idle seconds>
# Each run uses its own data dir and preseeds syncKubeconfigEntries: [] so the app never reads ~/.kube.
set -u
ZIP=$1 RUNS=$2 IDLE=$3
W=$(mktemp -d "${TMPDIR%/}/freelens-baseline.XXXXXX")
echo "workdir=$W"
ditto -x -k "$ZIP" "$W/app"
BUNDLE="$W/app/Freelens.app"
APP="$BUNDLE/Contents/MacOS/Freelens"
echo "zip_bytes=$(stat -f %z "$ZIP")"
echo "app_kbytes=$(du -sk "$BUNDLE" | cut -f1)"
echo "asar_bytes=$(stat -f %z "$BUNDLE/Contents/Resources/app.asar")"

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }

for run in $(seq 1 "$RUNS"); do
  D="$W/run$run"
  mkdir -p "$D/Freelens"
  printf '{"preferences":{"syncKubeconfigEntries":[]}}\n' >"$D/Freelens/lens-user-store.json"

  t0=$(now)
  FREELENS_INTEGRATION_TESTING_DIR="$D" "$APP" --user-data-dir="$D/userdata" >"$D/stdout.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 1200); do
    grep -q '"first-application-window" loaded' "$D/stdout.log" && break
    sleep 0.05
  done
  t1=$(now)
  loaded=$(grep -c '"first-application-window" loaded' "$D/stdout.log")

  sleep "$IDLE"
  # Only processes of this run: the main one has --user-data-dir, helpers inherit a path under $D.
  pids=$(pgrep -d, -f -- "$D/")
  rss_mb=$(ps -o rss= -p "$pids" | awk '{s+=$1} END {printf "%.0f", s/1024}')
  procs=$(pgrep -f -- "$D/" | wc -l | tr -d ' ')
  kube_refs=$(grep -c '/\.kube' "$D/stdout.log")
  printf 'run=%s loaded=%s startup_s=%.2f rss_mb=%s procs=%s kube_refs=%s\n' \
    "$run" "$loaded" "$(echo "$t1 - $t0" | bc)" "$rss_mb" "$procs" "$kube_refs"

  kill "$pid"
  wait "$pid" 2>/dev/null
  sleep 3
  left=$(pgrep -f -- "$D/" | wc -l | tr -d ' ')
  if [[ $left -gt 0 ]]; then echo "warning: $left processes of run $run still running"; fi
done
