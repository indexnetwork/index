#!/usr/bin/env bash
# Notary auth for notarize.sh and dmg.sh. Source this file; do not execute it.
#
# CI: NOTARYTOOL_KEY (path to .p8) + NOTARYTOOL_KEY_ID + NOTARYTOOL_ISSUER
# Local: NOTARYTOOL_PROFILE (keychain profile from `notarytool store-credentials`)

require_notary_auth() {
  if [ -n "${NOTARYTOOL_KEY:-}" ]; then
    : "${NOTARYTOOL_KEY_ID:?set NOTARYTOOL_KEY_ID with NOTARYTOOL_KEY}"
    : "${NOTARYTOOL_ISSUER:?set NOTARYTOOL_ISSUER with NOTARYTOOL_KEY}"
    [ -f "$NOTARYTOOL_KEY" ] || {
      echo "notary API key file not found: $NOTARYTOOL_KEY" >&2
      return 1
    }
    return 0
  fi
  : "${NOTARYTOOL_PROFILE:?set NOTARYTOOL_PROFILE or NOTARYTOOL_KEY}"
}

# Submit an artifact and wait for Apple's notarization result.
# @param $1 Path to the zip or DMG to submit.
notary_submit() {
  local artifact="${1:?artifact path required}"
  require_notary_auth
  if [ -n "${NOTARYTOOL_KEY:-}" ]; then
    xcrun notarytool submit "$artifact" --key "$NOTARYTOOL_KEY" --key-id "$NOTARYTOOL_KEY_ID" --issuer "$NOTARYTOOL_ISSUER" --wait
  else
    xcrun notarytool submit "$artifact" --keychain-profile "$NOTARYTOOL_PROFILE" --wait
  fi
}
