#!/bin/bash
# Copyright (c) Freelens Authors. All rights reserved.
# Licensed under MIT License. See LICENSE in root directory for more information.
#
# Measures the experimental build (spike) or the current build (electron) as
# specs/measure-baseline.sh does: time to the first window and RSS after an
# idle period, three times. Output: contracts/measurement-report.md.
#
# The app is started with `open -n`, so that LaunchServices makes it its own
# responsible process; started from a shell, the shell's application would be
# responsible for it and for its WebKit helpers (research R7).
#
# Mode spike-cluster launches the experimental build with the given kubeconfig
# and --open-cluster=kind-freelens-profile, times from Mark "cluster-opened" to
# Mark "namespaces-shown", and takes the RSS the idle seconds after that.
#
# The experimental build gets a data directory of its own in each run, so that
# it never uses the user's (spec 007). With MEASURE_DATA_DIR set, each run
# starts from a copy of that directory, as SC-006 of spec 007 measures startup
# with the five stores, `__RUN_DIR__` in its user store replaced with the run's
# directory; unset, the directory holds only a user store that syncs nothing.
#
# usage: [MEASURE_DATA_DIR=<seed>] measure.sh <spike|electron|spike-cluster> <app bundle or dmg> <runs> <idle seconds> [kubeconfig]
set -u
MODE=$1 SOURCE=$2 RUNS=$3 IDLE=$4 KUBECONFIG_FILE=${5-}
HERE=$(cd "$(dirname "$0")" && pwd)

case $MODE in
  spike) EXE=freelens-spike LOADED='Window "main" loaded' ;;
  spike-cluster) EXE=freelens-spike LOADED='Mark "namespaces-shown"' ;;
  electron) EXE=Freelens LOADED='"first-application-window" loaded' ;;
  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac

W=$(mktemp -d "${TMPDIR%/}/freelens-measure.XXXXXX")
echo "workdir=$W"
# A fresh copy per session, as the baseline measures a freshly unzipped bundle.
# From a dmg, the copy is what installing the app by dragging it would give.
if [[ $MODE == spike-cluster && ! -f $KUBECONFIG_FILE ]]; then
  echo "spike-cluster needs the kubeconfig of the reference cluster" >&2
  exit 2
fi
if [[ $SOURCE == *.dmg ]]; then
  echo "dmg_bytes=$(stat -f %z "$SOURCE")"
  echo "dmg_format=$(hdiutil imageinfo "$SOURCE" 2>/dev/null | sed -n 's/^Format Description: //p')"
  mkdir "$W/mnt"
  hdiutil attach -nobrowse -readonly -mountpoint "$W/mnt" "$SOURCE" >/dev/null 2>&1
  APP_IN_DMG=$(find "$W/mnt" -maxdepth 1 -name '*.app' | head -1)
  BUNDLE="$W/$(basename "$APP_IN_DMG")"
  ditto "$APP_IN_DMG" "$BUNDLE"
  hdiutil detach "$W/mnt" >/dev/null 2>&1
else
  BUNDLE="$W/$(basename "$SOURCE")"
  ditto "$SOURCE" "$BUNDLE"
fi
echo "app_kbytes=$(du -sk "$BUNDLE" | cut -f1)"

now() { perl -MTime::HiRes=time -e 'printf "%.3f", time'; }
main_pid() { pgrep -f -- "$BUNDLE/Contents/MacOS/$EXE" | head -1; }

for run in $(seq 1 "$RUNS"); do
  D="$W/run$run"
  mkdir -p "$D"
  touch "$D/stdout.log" "$D/stderr.log"

  if [[ $MODE != electron ]]; then
    if [[ -n ${MEASURE_DATA_DIR-} ]]; then
      ditto "$MEASURE_DATA_DIR" "$D/data"
      # A seed names its own files under __RUN_DIR__, the run's directory
      # (specs/008-main-catalog, research R12).
      if [[ -f "$D/data/lens-user-store.json" ]]; then
        perl -pi -e "s|__RUN_DIR__|$D|g" "$D/data/lens-user-store.json"
      fi
    else
      mkdir -p "$D/data"
      # No kubeconfig sync, so that no run reads the user's ~/.kube, as the
      # Electron baseline does (specs/008-main-catalog, research R10).
      printf '{"preferences":{"syncKubeconfigEntries":[]}}\n' >"$D/data/lens-user-store.json"
    fi
  fi

  t0=$(now)
  if [[ $MODE == spike ]]; then
    open -n -F --stdout "$D/stdout.log" --stderr "$D/stderr.log" "$BUNDLE" \
      --args --kubeconfig=none --data-dir="$D/data"
  elif [[ $MODE == spike-cluster ]]; then
    open -n -F --stdout "$D/stdout.log" --stderr "$D/stderr.log" "$BUNDLE" \
      --args --kubeconfig="$KUBECONFIG_FILE" --open-cluster=kind-freelens-profile --data-dir="$D/data"
  else
    mkdir -p "$D/Freelens"
    printf '{"preferences":{"syncKubeconfigEntries":[]}}\n' >"$D/Freelens/lens-user-store.json"
    open -n -F --env "FREELENS_INTEGRATION_TESTING_DIR=$D" --stdout "$D/stdout.log" --stderr "$D/stderr.log" \
      "$BUNDLE" --args --user-data-dir="$D/userdata"
  fi
  if [[ $MODE == spike-cluster ]]; then
    # Times the two marks to the millisecond; a grep loop is too coarse for them.
    opened_to_shown=$(python3 -I "$HERE/mark-interval.py" "$D/stdout.log" cluster-opened namespaces-shown)
  else
    for _ in $(seq 1 1200); do
      grep -qF -- "$LOADED" "$D/stdout.log" "$D/stderr.log" && break
      sleep 0.05
    done
  fi
  t1=$(now)
  loaded=$(cat "$D/stdout.log" "$D/stderr.log" | grep -cF -- "$LOADED")
  pid=$(main_pid)

  sleep "$IDLE"
  python3 -I "$HERE/responsible-rss.py" "$pid" >"$D/rss.txt"
  sed "s/^proc=/run=$run proc=/" "$D/rss.txt" | grep 'proc='
  rss=$(sed -n 's/^rss_mb=//p' "$D/rss.txt")
  procs=$(grep -c '^proc=' "$D/rss.txt")
  kube_refs=$(cat "$D/stdout.log" "$D/stderr.log" | grep -c '/\.kube')
  if [[ $MODE == spike-cluster ]]; then
    printf 'build=spike run=%s scenario=cluster namespaces_shown_s=%s rss_mb=%s procs=%s\n' \
      "$run" "$opened_to_shown" "$rss" "$procs"
  else
    printf 'build=%s run=%s loaded=%s startup_s=%.2f rss_mb=%s procs=%s kube_refs=%s\n' \
      "$MODE" "$run" "$loaded" "$(echo "$t1 - $t0" | bc)" "$rss" "$procs" "$kube_refs"
  fi

  kill "$pid"
  sleep 3
  left=$(python3 -I "$HERE/responsible-rss.py" "$pid" | grep -c '^proc=')
  if [[ $left -gt 0 ]]; then echo "warning: $left processes of run $run still running"; fi
done
