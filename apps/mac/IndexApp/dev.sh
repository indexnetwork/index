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
    pkill -f 'index.app/Contents/MacOS/index' 2>/dev/null
    open dist/index.app
  else
    echo "==> build failed — waiting for the next change"
  fi
  s=$(snapshot)
  while [ "$(snapshot)" = "$s" ]; do sleep 1; done
  echo "==> change detected, rebuilding…"
done
