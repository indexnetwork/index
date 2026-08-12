#!/usr/bin/env bash
# Build, sign, notarize, package, and publish a dev-channel macOS prerelease.
# Intended only for the protected macos-dev-release GitHub Environment.
set -euo pipefail
set +x

MAC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MAC_ROOT"

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${INDEX_DEV_RELEASE_TAG:?INDEX_DEV_RELEASE_TAG is required}"
: "${INDEX_DEVELOPER_ID_CERTIFICATE_P12:?INDEX_DEVELOPER_ID_CERTIFICATE_P12 is required}"
: "${INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD:?INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD is required}"
: "${INDEX_APP_PROVISIONING_PROFILE_BASE64:?INDEX_APP_PROVISIONING_PROFILE_BASE64 is required}"
: "${INDEX_NOTARY_API_KEY_BASE64:?INDEX_NOTARY_API_KEY_BASE64 is required}"
: "${INDEX_NOTARY_KEY_ID:?INDEX_NOTARY_KEY_ID is required}"
: "${INDEX_NOTARY_ISSUER_ID:?INDEX_NOTARY_ISSUER_ID is required}"

[[ "$INDEX_DEV_RELEASE_TAG" =~ ^macos-dev-[0-9]{8}\.[1-9][0-9]*$ ]] || {
  echo "dev release tag must match macos-dev-YYYYMMDD.N" >&2
  exit 64
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "GITHUB_SHA must be a full lowercase commit" >&2; exit 64; }

source "$MAC_ROOT/scripts/link-host.sh"
source "$MAC_ROOT/scripts/provisioning-profile.sh"

work="$(mktemp -d "$RUNNER_TEMP/index-macos-dev.XXXXXX")"
keychain="$work/release.keychain-db"
keychain_password="$(openssl rand -hex 32)"
p12="$work/developer-id.p12"
profile="$work/app.provisionprofile"
notary_key="$work/notary.p8"
plist_backup="$work/Info.plist"
notary_profile="index-dev-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
release_created=0
plist_modified=0

cleanup() {
  local status=$?
  set +e
  set +x
  if [[ "$release_created" == 1 && "$status" -ne 0 ]]; then
    gh release delete "$INDEX_DEV_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --yes --cleanup-tag >/dev/null 2>&1 || true
    gh api --method DELETE "repos/$GITHUB_REPOSITORY/git/refs/tags/$INDEX_DEV_RELEASE_TAG" >/dev/null 2>&1 || true
  fi
  if [[ "$plist_modified" == 1 && -f "$plist_backup" ]]; then
    cp "$plist_backup" "$MAC_ROOT/Info.plist"
  fi
  security list-keychains -d user -s "$HOME/Library/Keychains/login.keychain-db" /Library/Keychains/System.keychain >/dev/null 2>&1 || true
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
  unset INDEX_DEVELOPER_ID_CERTIFICATE_P12 INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD
  unset INDEX_APP_PROVISIONING_PROFILE_BASE64 INDEX_NOTARY_API_KEY_BASE64
  unset INDEX_NOTARY_KEY_ID INDEX_NOTARY_ISSUER_ID
  exit "$status"
}
trap cleanup EXIT

python3 - "$p12" "$profile" "$notary_key" <<'PY'
import base64
import os
import sys

for variable, destination in zip(
    (
        "INDEX_DEVELOPER_ID_CERTIFICATE_P12",
        "INDEX_APP_PROVISIONING_PROFILE_BASE64",
        "INDEX_NOTARY_API_KEY_BASE64",
    ),
    sys.argv[1:],
):
    try:
        encoded = "".join(os.environ[variable].split())
        value = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise SystemExit(f"{variable} is not valid base64: {error}")
    if not value:
        raise SystemExit(f"{variable} decoded to an empty file")
    with open(destination, "wb") as output:
        output.write(value)
    os.chmod(destination, 0o600)
PY

security create-keychain -p "$keychain_password" "$keychain" >/dev/null
security set-keychain-settings -lut 21600 "$keychain" >/dev/null
security unlock-keychain -p "$keychain_password" "$keychain" >/dev/null
security import "$p12" -k "$keychain" -P "$INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" /Library/Keychains/System.keychain >/dev/null

security cms -D -i "$profile" -o "$work/profile.plist" >/dev/null 2>&1
team_id="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$work/profile.plist")"
[[ "$team_id" =~ ^[A-Z0-9]{10}$ ]] || { echo "profile TeamIdentifier is malformed" >&2; exit 1; }

identity=""
while IFS= read -r candidate; do
  if [[ "$(certificate_team_id "$candidate" || true)" == "$team_id" ]]; then
    identity="$candidate"
    break
  fi
done < <(security find-identity -v -p codesigning "$keychain" 2>/dev/null | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p')
[[ -n "$identity" ]] || { echo "no Developer ID Application identity matches the profile" >&2; exit 1; }

owner_group="${team_id}.network.index.system6.owner-credentials"
validate_profile_plist "$work/profile.plist" "$team_id" network.index.system6 dev.index.network "$owner_group"

xcrun notarytool store-credentials "$notary_profile" \
  --key "$notary_key" \
  --key-id "$INDEX_NOTARY_KEY_ID" \
  --issuer "$INDEX_NOTARY_ISSUER_ID" \
  --keychain "$keychain" >/dev/null

cp "$MAC_ROOT/Info.plist" "$plist_backup"
plist_modified=1
/usr/libexec/PlistBuddy -c 'Delete :API_URL' "$MAC_ROOT/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Delete :APP_URL' "$MAC_ROOT/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Add :API_URL string https://protocol.dev.index.network' "$MAC_ROOT/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :APP_URL string https://dev.index.network' "$MAC_ROOT/Info.plist"

INDEX_LINK_HOST=dev.index.network \
INDEX_DEVELOPMENT_BUILD=1 \
INDEX_APP_IDENTIFIER_PREFIX="${team_id}." \
CODESIGN_IDENTITY="$identity" \
PROVISIONING_PROFILE="$profile" \
  "$MAC_ROOT/scripts/build.sh"

cp "$plist_backup" "$MAC_ROOT/Info.plist"
plist_modified=0

app="$MAC_ROOT/dist/Index.app"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :API_URL' "$app/Contents/Info.plist")" == "https://protocol.dev.index.network" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :APP_URL' "$app/Contents/Info.plist")" == "https://dev.index.network" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :IndexDeepLinkHost' "$app/Contents/Info.plist")" == "dev.index.network" ]]

NOTARYTOOL_PROFILE="$notary_profile" "$MAC_ROOT/scripts/notarize.sh"
NOTARYTOOL_PROFILE="$notary_profile" "$MAC_ROOT/scripts/dmg.sh"

artifact="$MAC_ROOT/dist/Index-macOS-${INDEX_DEV_RELEASE_TAG}.dmg"
mv "$MAC_ROOT/dist/Index.dmg" "$artifact"
checksum="${artifact}.sha256"
(
  cd "$(dirname "$artifact")"
  shasum -a 256 "$(basename "$artifact")" >"$(basename "$checksum")"
)
xcrun stapler validate "$artifact"

if gh release view "$INDEX_DEV_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "release already exists: $INDEX_DEV_RELEASE_TAG" >&2
  exit 1
fi
if git ls-remote --exit-code --tags origin "refs/tags/$INDEX_DEV_RELEASE_TAG" >/dev/null 2>&1; then
  echo "tag already exists without a release: $INDEX_DEV_RELEASE_TAG" >&2
  exit 1
fi

notes="$work/release-notes.md"
cat >"$notes" <<EOF
Development prerelease from \`dev\` commit \`$GITHUB_SHA\`.

- Web: https://dev.index.network
- API: https://protocol.dev.index.network
- Channel: development; not for production distribution
EOF

release_created=1
gh release create "$INDEX_DEV_RELEASE_TAG" \
  --repo "$GITHUB_REPOSITORY" \
  --target "$GITHUB_SHA" \
  --title "Index macOS Dev ${INDEX_DEV_RELEASE_TAG#macos-dev-}" \
  --notes-file "$notes" \
  --draft \
  --prerelease
gh release upload "$INDEX_DEV_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" "$artifact" "$checksum"
gh release edit "$INDEX_DEV_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease --latest=false
release_created=0
printf 'published %s\n' "$INDEX_DEV_RELEASE_TAG"
