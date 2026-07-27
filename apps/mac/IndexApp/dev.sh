#!/bin/bash
# dev.sh — watch sources, rebuild, and relaunch dist/index.app on every change.
# Zero dependencies: polls file mtimes once a second (no fswatch/entr needed).
cd "$(dirname "$0")" || exit 1

snapshot() {
  stat -f '%m %N' \
    assemble.py build.sh \
    src/*.html src/index-amiga/*.jsx \
    Sources/*.swift Info.plist \
    ../api/*.mjs 2>/dev/null | md5
}

while true; do
  if ./build.sh; then
    if pkill -f 'index.app/Contents/MacOS/index' 2>/dev/null; then
      # let the old instance fully exit — opening too soon makes
      # LaunchServices target the dying process (error -600)
      for _ in $(seq 1 50); do
        pgrep -f 'index.app/Contents/MacOS/index' >/dev/null || break
        sleep 0.1
      done
    fi
    open -n dist/index.app
  else
    echo "==> build failed — waiting for the next change"
  fi
  s=$(snapshot)
  while [ "$(snapshot)" = "$s" ]; do sleep 1; done
  echo "==> change detected, rebuilding…"
done
