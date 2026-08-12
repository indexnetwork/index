#!/usr/bin/env bash
set -euo pipefail

resolve_link_host() {
  local host
  if [ "$#" -eq 0 ]; then
    host="${INDEX_LINK_HOST:-index.network}"
  else
    host="$1"
  fi
  case "$host" in
    index.network|dev.index.network) printf '%s\n' "$host" ;;
    *) printf 'INDEX_LINK_HOST must be index.network or dev.index.network\n' >&2; return 64 ;;
  esac
}

write_associated_domains_entitlements() {
  local host="$1" destination="$2" owner_group="${3:-}"
  if [[ -n "$owner_group" && ! "$owner_group" =~ ^[A-Za-z0-9]+\.network\.index\.system6\.owner-credentials$ ]]; then
    printf 'app Keychain group must be an identifier prefix plus network.index.system6.owner-credentials\n' >&2
    return 64
  fi
  cat >"$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
EOF
  if [[ -n "$owner_group" ]]; then
    cat >>"$destination" <<EOF
  <key>keychain-access-groups</key>
  <array><string>${owner_group}</string></array>
EOF
  fi
  cat >>"$destination" <<EOF
  <key>com.apple.developer.associated-domains</key>
  <array><string>applinks:${host}</string></array>
</dict></plist>
EOF
}

case "${1:-}" in
  --resolve)
    if [ "$#" -eq 1 ]; then
      resolve_link_host
    else
      resolve_link_host "$2"
    fi
    ;;
  --write-entitlements) host="$(resolve_link_host "${2-}")"; write_associated_domains_entitlements "$host" "${3:?destination required}" "${4-}" ;;
  '') : ;;
  *) printf 'unknown command: %s\n' "$1" >&2; exit 64 ;;
esac
