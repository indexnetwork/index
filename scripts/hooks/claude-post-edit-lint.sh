#!/usr/bin/env bash
# PostToolUse hook: auto-fix lint on .ts/.tsx files after Edit/Write

filepath="$CLAUDE_FILE_PATH"
[ -z "$filepath" ] && exit 0
echo "$filepath" | grep -qE '\.tsx?$' || exit 0

root=$(git -C "$(dirname "$filepath")" rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

cd "$root" && npx eslint --fix "$filepath" 2>/dev/null
exit 0
