#!/bin/bash
# dev.sh — watch sources, rebuild, and relaunch dist/Index.app on every change.
cd "$(dirname "$0")/.." || exit 1

snapshot() {
  stat -f '%m %N' \
    scripts/assemble.py scripts/build.sh \
    src/index.html src/styles/*.css src/ui/**/*.jsx \
    Sources/*.swift Info.plist \
    api/*.mjs 2>/dev/null | md5
}

while true; do
  if ./build.sh; then
    if pkill -f 'Index.app/Contents/MacOS/Index' 2>/dev/null; then
      for _ in $(seq 1 50); do
        pgrep -f 'Index.app/Contents/MacOS/Index' >/dev/null || break
        sleep 0.1
      done
    fi
    if ! open -n dist/Index.app; then
      echo "==> open failed; launching Contents/MacOS/Index directly"
      dist/Index.app/Contents/MacOS/Index >/dev/null 2>&1 &
    fi
  else
    echo "==> build failed — waiting for the next change"
  fi
  s=$(snapshot)
  while [ "$(snapshot)" = "$s" ]; do sleep 1; done
  echo "==> change detected, rebuilding…"
done
