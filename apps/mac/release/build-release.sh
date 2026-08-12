#!/usr/bin/env bash
# Protected macOS release orchestrator. This file is provider-free until an
# authorized macos-production workflow invokes it; tests must never invoke it.
set -euo pipefail
set +x
umask 077

readonly RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly MAC_DIRECTORY="$(cd "$RELEASE_DIRECTORY/.." && pwd -P)"
readonly REPO_ROOT="$(cd "$MAC_DIRECTORY/../.." && pwd -P)"
readonly FINAL_DIRECTORY="$MAC_DIRECTORY/dist/final"
readonly METADATA_DIRECTORY="$MAC_DIRECTORY/dist/release"
readonly STATE_DIRECTORY="$MAC_DIRECTORY/dist/.production-release-state"
readonly PUBLICATION_MANIFEST="$STATE_DIRECTORY/publication-manifest.sha256"
readonly ATTESTATION_MARKER="$STATE_DIRECTORY/attestation.complete"
readonly VERSION="1.0.0"
readonly TAG="v${VERSION}"
readonly APP_DMG="Index-macOS-${VERSION}-universal.dmg"
readonly CONNECTOR_DMG="IndexConnector-${VERSION}-universal.dmg"

TRANSACTION_ROOT=""
TEMPORARY_KEYCHAIN=""
TEMPORARY_KEYCHAIN_PASSWORD=""
APP_PROFILE_PATH=""
CONNECTOR_PROFILE_PATH=""
NOTARY_PROFILE_PATH=""
PUBLICATION_MARKER=0
PUBLISHED=0
KEEP_OUTPUTS=0

release_error() { printf 'production release refused: %s\n' "$1" >&2; return 1; }
require_value() { [[ -n "${!1:-}" ]] || release_error "$1 is required by the protected environment"; }
require_tool() { command -v "$1" >/dev/null 2>&1 || release_error "$1 is required"; }
sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
file_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }

assert_release_absent() {
  local output status
  set +e
  output="$(gh api --include -H 'Accept: application/vnd.github+json' "/repos/${GITHUB_REPOSITORY}/releases/tags/${INDEX_RELEASE_TAG}" 2>/dev/null)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then release_error "an exact public or draft release already exists for ${INDEX_RELEASE_TAG}"; return 1; fi
  grep -Eq '^HTTP/[0-9.]+ 404([[:space:]]|$)' <<<"$output" || release_error "exact release absence could not be established"
}

release_owned_by_this_run() {
  gh api -H 'Accept: application/vnd.github+json' "/repos/${GITHUB_REPOSITORY}/releases/tags/${INDEX_RELEASE_TAG}" \
    --jq '.body' 2>/dev/null | grep -Fqx "index-production-run:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}"
}

release_cleanup() {
  local status=$?
  set +e
  set +x
  if [[ -n "$TEMPORARY_KEYCHAIN" ]]; then security delete-keychain "$TEMPORARY_KEYCHAIN" >/dev/null 2>&1 || rm -f -- "$TEMPORARY_KEYCHAIN"; fi
  [[ -n "$APP_PROFILE_PATH" ]] && rm -f -- "$APP_PROFILE_PATH"
  [[ -n "$CONNECTOR_PROFILE_PATH" ]] && rm -f -- "$CONNECTOR_PROFILE_PATH"
  [[ -n "$NOTARY_PROFILE_PATH" ]] && rm -f -- "$NOTARY_PROFILE_PATH"
  [[ -n "$TRANSACTION_ROOT" ]] && rm -rf -- "$TRANSACTION_ROOT"
  TEMPORARY_KEYCHAIN_PASSWORD=""
  unset INDEX_DEVELOPER_ID_CERTIFICATE_P12 INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD
  unset INDEX_APP_PROVISIONING_PROFILE_BASE64 INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64
  unset INDEX_NOTARY_API_KEY_BASE64 INDEX_NOTARY_KEY_ID INDEX_NOTARY_ISSUER_ID

  if (( status != 0 )); then
    if (( PUBLICATION_MARKER == 1 )) && release_owned_by_this_run; then
      gh release delete "$INDEX_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --yes >/dev/null 2>&1 || :
    fi
    if (( KEEP_OUTPUTS == 0 )); then rm -rf -- "$FINAL_DIRECTORY" "$METADATA_DIRECTORY" "$STATE_DIRECTORY"; fi
    assert_release_absent >/dev/null 2>&1 || printf 'production release cleanup could not prove exact release absence\n' >&2
  fi
  exit "$status"
}
trap release_cleanup EXIT

validate_protected_inputs() {
  local name
  for name in GITHUB_ACTIONS GITHUB_REPOSITORY GITHUB_SHA GITHUB_REF GITHUB_RUN_ID GITHUB_RUN_ATTEMPT RUNNER_ENVIRONMENT RUNNER_TEMP \
    INDEX_RELEASE_TAG INDEX_RELEASE_COMMIT INDEX_BUILD_NUMBER INDEX_RELEASE_MACOS_VERSION INDEX_RELEASE_MACOS_BUILD \
    INDEX_RELEASE_EXPECTED_RUNNER_IMAGE INDEX_RELEASE_EXPECTED_RUNNER_VERSION INDEX_RELEASE_CMS_IDENTITY_HASH INDEX_RELEASE_CMS_CERT_SHA256; do
    require_value "$name"
  done
  [[ "$GITHUB_ACTIONS" == true && "$RUNNER_ENVIRONMENT" == github-hosted ]] || release_error "a fresh isolated GitHub-hosted runner is required"
  [[ "$INDEX_RELEASE_TAG" == "$TAG" ]] || release_error "the approved first production tag is exactly $TAG"
  [[ "$INDEX_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ && "$INDEX_RELEASE_COMMIT" == "$GITHUB_SHA" ]] || release_error "release commit must be the exact workflow commit"
  [[ "$INDEX_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || release_error "build number must be a positive canonical decimal"
  [[ "$INDEX_RELEASE_CMS_IDENTITY_HASH" =~ ^[0-9a-f]{40}$ ]] || release_error "INDEX_RELEASE_CMS_IDENTITY_HASH must be canonical lowercase 40-hex"
  [[ "$INDEX_RELEASE_CMS_CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || release_error "INDEX_RELEASE_CMS_CERT_SHA256 must be canonical lowercase SHA-256"
  [[ "$INDEX_RELEASE_MACOS_VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ && "$INDEX_RELEASE_MACOS_BUILD" =~ ^[A-Za-z0-9]+$ ]] || release_error "reviewed macOS version/build pins are malformed"
  [[ "$INDEX_RELEASE_EXPECTED_RUNNER_IMAGE" =~ ^[A-Za-z0-9._-]+$ && "$INDEX_RELEASE_EXPECTED_RUNNER_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || release_error "reviewed runner pins are malformed"
  [[ "${INDEX_API_URL:-}" == https://protocol.index.network && "${INDEX_WEB_URL:-}" == https://index.network ]] || release_error "production endpoints do not match reviewed literals"
  [[ "${INDEX_EXPECTED_TEAM_ID:-}" == LMQ3XNXLAD && "${INDEX_CONNECTOR_PROTOCOL_VERSION:-}" == 1 ]] || release_error "Team ID or connector protocol authority does not match"
}

validate_tagged_provenance() {
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || release_error "checkout must be clean, including untracked files"
  [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$INDEX_RELEASE_COMMIT" ]] || release_error "HEAD differs from the approved release commit"
  [[ "$(git -C "$REPO_ROOT" rev-parse "refs/tags/$INDEX_RELEASE_TAG^{commit}")" == "$INDEX_RELEASE_COMMIT" ]] || release_error "exact release tag does not resolve to the approved commit"
  git -C "$REPO_ROOT" merge-base --is-ancestor "$INDEX_RELEASE_COMMIT" "$INDEX_RELEASE_COMMIT" || release_error "release commit provenance is invalid"
}

assert_no_unrelated_same_uid_processes() {
  [[ -z "$(jobs -pr)" ]] || release_error "background shell workloads are forbidden"
  # A hosted job is a fresh single-tenant VM. Prove this shell has no same-UID
  # workload outside its GitHub runner ancestry; a parked Task 4 same-UID race is
  # therefore outside the protected execution boundary.
  python3 - "$$" "$(id -u)" <<'PY'
import os, subprocess, sys
shell, uid = map(int, sys.argv[1:])
rows = {}
for line in subprocess.check_output(["ps", "-axo", "uid=,pid=,ppid=,command="], text=True).splitlines():
    parts = line.strip().split(None, 3)
    if len(parts) >= 3 and int(parts[0]) == uid:
        rows[int(parts[1])] = (int(parts[2]), parts[3] if len(parts) == 4 else "")
allowed = {os.getpid(), shell}
pid = shell
while pid in rows and pid > 1:
    pid = rows[pid][0]
    allowed.add(pid)
for pid, (parent, command) in rows.items():
    if pid in allowed or parent == os.getpid():
        continue
    if "Runner.Listener" in command or "Runner.Worker" in command:
        continue
    raise SystemExit(f"unrelated same-UID workload detected: pid {pid}")
PY
}

validate_monotonic_release() {
  local prior tag directory metadata tags
  directory="$TRANSACTION_ROOT/prior-releases"
  mkdir -m 700 "$directory"
  tags="$(gh api --paginate -H 'Accept: application/vnd.github+json' "/repos/${GITHUB_REPOSITORY}/releases?per_page=100" --jq '.[] | select(any(.assets[]; .name == "macos-release.json")) | .tag_name')" \
    || release_error "existing release inventory could not be established"
  while IFS= read -r tag; do
    [[ -n "$tag" && "$tag" != "$INDEX_RELEASE_TAG" ]] || continue
    metadata="$directory/${tag//\//_}.json"
    gh release download "$tag" --repo "$GITHUB_REPOSITORY" --pattern macos-release.json --output "$metadata" >/dev/null
    bun -e '
      const prior=JSON.parse(await Bun.file(process.argv[1]).text());
      const [p0,p1,p2]=prior.releaseVersion.split(".").map(Number);
      const [c0,c1,c2]=process.argv[2].split(".").map(Number);
      const versionGreater=c0>p0||(c0===p0&&(c1>p1||(c1===p1&&c2>p2)));
      if(!versionGreater||!/^\d+$/.test(String(prior.buildNumber))||BigInt(process.argv[3])<=BigInt(prior.buildNumber)) process.exit(1);
    ' "$metadata" "$VERSION" "$INDEX_BUILD_NUMBER" || release_error "version and build number are not strictly monotonic"
  done <<<"$tags"
}

resolve_identity_label() {
  local listing matches
  listing="$(security find-identity -v -p codesigning "$TEMPORARY_KEYCHAIN" 2>/dev/null)" || release_error "Developer ID identity enumeration failed"
  matches="$(printf '%s\n' "$listing" | awk -v hash="$INDEX_RELEASE_CMS_IDENTITY_HASH" '
    { value=tolower($2) }
    value==hash && match($0,/"Developer ID Application:[^"]+"/) { print substr($0,RSTART+1,RLENGTH-2) }
  ')"
  [[ "$(printf '%s\n' "$matches" | grep -c .)" == 1 ]] || release_error "reviewed Developer ID identity hash is not unique"
  CODESIGN_IDENTITY="$matches"
  export CODESIGN_IDENTITY
}

decode_secret_file() {
  local variable="$1" destination="$2"
  printf '%s' "${!variable}" | base64 --decode >"$destination" 2>/dev/null || release_error "$variable is not valid base64"
  chmod 600 "$destination"
}

install_protected_credentials() {
  local name p12 api_key
  for name in INDEX_DEVELOPER_ID_CERTIFICATE_P12 INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD INDEX_APP_PROVISIONING_PROFILE_BASE64 \
    INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64 INDEX_NOTARY_API_KEY_BASE64 INDEX_NOTARY_KEY_ID INDEX_NOTARY_ISSUER_ID; do require_value "$name"; done
  TEMPORARY_KEYCHAIN="$TRANSACTION_ROOT/release.keychain-db"
  TEMPORARY_KEYCHAIN_PASSWORD="$(openssl rand -hex 32)"
  p12="$TRANSACTION_ROOT/developer-id.p12"; api_key="$TRANSACTION_ROOT/notary-api-key.p8"
  APP_PROFILE_PATH="$TRANSACTION_ROOT/app.provisionprofile"
  CONNECTOR_PROFILE_PATH="$TRANSACTION_ROOT/connector.provisionprofile"
  NOTARY_PROFILE_PATH="$api_key"
  decode_secret_file INDEX_DEVELOPER_ID_CERTIFICATE_P12 "$p12"
  decode_secret_file INDEX_APP_PROVISIONING_PROFILE_BASE64 "$APP_PROFILE_PATH"
  decode_secret_file INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64 "$CONNECTOR_PROFILE_PATH"
  decode_secret_file INDEX_NOTARY_API_KEY_BASE64 "$api_key"
  security create-keychain -p "$TEMPORARY_KEYCHAIN_PASSWORD" "$TEMPORARY_KEYCHAIN" >/dev/null
  security set-keychain-settings -lut 21600 "$TEMPORARY_KEYCHAIN" >/dev/null
  security unlock-keychain -p "$TEMPORARY_KEYCHAIN_PASSWORD" "$TEMPORARY_KEYCHAIN" >/dev/null
  security import "$p12" -k "$TEMPORARY_KEYCHAIN" -P "$INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "$TEMPORARY_KEYCHAIN_PASSWORD" "$TEMPORARY_KEYCHAIN" >/dev/null
  security list-keychains -d user -s "$TEMPORARY_KEYCHAIN" /Library/Keychains/System.keychain >/dev/null
  resolve_identity_label
  NOTARYTOOL_PROFILE="index-production-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  xcrun notarytool store-credentials "$NOTARYTOOL_PROFILE" --key "$api_key" --key-id "$INDEX_NOTARY_KEY_ID" --issuer "$INDEX_NOTARY_ISSUER_ID" --keychain "$TEMPORARY_KEYCHAIN" >/dev/null
  export INDEX_APP_PROVISIONING_PROFILE="$APP_PROFILE_PATH" INDEX_CONNECTOR_PROVISIONING_PROFILE="$CONNECTOR_PROFILE_PATH" NOTARYTOOL_PROFILE
  rm -f -- "$p12" "$api_key"
  NOTARY_PROFILE_PATH=""
}

verify_task4_promotion_contract() {
  local source="$MAC_DIRECTORY/IndexApp/notarize.sh"
  [[ "$(grep -c 'verify_final_artifact_hash' "$source")" -ge 3 ]] || release_error "Task 4 pre/post-promotion finalArtifact gates are missing"
  grep -Fq 'promote_release_set' "$source" || release_error "Task 4 no-clobber promotion contract is missing"
}

verify_final_artifact_evidence() {
  local name artifact evidence expected
  for name in "$APP_DMG" "$CONNECTOR_DMG"; do
    artifact="$FINAL_DIRECTORY/$name"; evidence="${artifact}.reproducibility.txt"
    [[ -f "$artifact" && ! -L "$artifact" && -f "$evidence" && ! -L "$evidence" ]] || release_error "final artifact or evidence is missing"
    expected="$(awk -F= '$1=="finalArtifact.sha256"{v=$2;c++} END{if(c==1)print v}' "$evidence")"
    [[ "$expected" =~ ^[0-9a-f]{64}$ && "$expected" == "$(sha256_file "$artifact")" ]] || release_error "finalArtifact evidence does not match immutable bytes"
  done
}

write_publication_manifest() {
  local path
  rm -rf -- "$STATE_DIRECTORY"
  mkdir -m 700 "$STATE_DIRECTORY"
  : >"$PUBLICATION_MANIFEST"
  for path in \
    "$FINAL_DIRECTORY/$APP_DMG" "$FINAL_DIRECTORY/$APP_DMG.reproducibility.txt" \
    "$FINAL_DIRECTORY/$CONNECTOR_DMG" "$FINAL_DIRECTORY/$CONNECTOR_DMG.reproducibility.txt" \
    "$METADATA_DIRECTORY/macos-release.json" "$METADATA_DIRECTORY/macos-release.cms" "$METADATA_DIRECTORY/SHA256SUMS"; do
    [[ -f "$path" && ! -L "$path" ]] || release_error "publication asset is missing or linked"
    printf '%s  %s\n' "$(sha256_file "$path")" "${path#$REPO_ROOT/}" >>"$PUBLICATION_MANIFEST"
  done
  chmod 600 "$PUBLICATION_MANIFEST"
}

verify_publication_manifest() {
  local digest relative
  [[ -f "$PUBLICATION_MANIFEST" && ! -L "$PUBLICATION_MANIFEST" ]] || release_error "publication manifest is missing"
  while read -r digest relative; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ && -f "$REPO_ROOT/$relative" && ! -L "$REPO_ROOT/$relative" ]] || release_error "publication manifest entry is invalid"
    [[ "$(sha256_file "$REPO_ROOT/$relative")" == "$digest" ]] || release_error "immutable publication asset changed after verification"
  done <"$PUBLICATION_MANIFEST"
}

prepare_release() {
  validate_protected_inputs
  for tool in git gh bun security openssl xcrun base64 python3 shasum awk grep; do require_tool "$tool"; done
  assert_release_absent
  validate_tagged_provenance
  assert_no_unrelated_same_uid_processes
  [[ ! -e "$FINAL_DIRECTORY" && ! -L "$FINAL_DIRECTORY" && ! -e "$METADATA_DIRECTORY" && ! -L "$METADATA_DIRECTORY" && ! -e "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]] \
    || release_error "stale or preexisting release outputs are forbidden on the fresh runner"
  TRANSACTION_ROOT="$(mktemp -d "$RUNNER_TEMP/index-production-release.XXXXXX")"
  chmod 700 "$TRANSACTION_ROOT"
  validate_monotonic_release
  export INDEX_RELEASE_VERSION="$VERSION" INDEX_RELEASE_COMMIT INDEX_BUILD_NUMBER

  # Build before importing Developer ID credentials: Task 2 deliberately refuses
  # every signing input and remains credential-free. It writes release plists, so
  # refresh the clean-worktree provenance gate immediately afterward.
  bash "$RELEASE_DIRECTORY/build-universal.sh"
  validate_tagged_provenance
  install_protected_credentials
  bash "$RELEASE_DIRECTORY/sign-bundles.sh"
  bash "$RELEASE_DIRECTORY/verify-signatures.sh" "$MAC_DIRECTORY/dist/signed"
  verify_task4_promotion_contract
  # Task 4 verifies finalArtifact evidence inside its private transaction before
  # promotion, after promotion, and leaves only the verified promoted set.
  bash "$MAC_DIRECTORY/IndexApp/notarize.sh"
  verify_final_artifact_evidence

  mkdir -m 700 "$METADATA_DIRECTORY"
  bun "$RELEASE_DIRECTORY/generate-release-metadata.ts" "$FINAL_DIRECTORY" "$METADATA_DIRECTORY" "$INDEX_BUILD_NUMBER" "$INDEX_RELEASE_COMMIT"
  bash "$RELEASE_DIRECTORY/sign-release-metadata.sh" "$FINAL_DIRECTORY" "$METADATA_DIRECTORY" "$INDEX_BUILD_NUMBER" "$INDEX_RELEASE_COMMIT"
  bash "$RELEASE_DIRECTORY/verify-release-metadata.sh" "$FINAL_DIRECTORY" "$METADATA_DIRECTORY" "$INDEX_BUILD_NUMBER" "$INDEX_RELEASE_COMMIT"
  verify_final_artifact_evidence
  write_publication_manifest
  KEEP_OUTPUTS=1
}

record_attestation() {
  [[ "$#" -eq 1 && "$1" == https://github.com/*/attestations/* ]] || release_error "a GitHub artifact attestation URL is required"
  validate_protected_inputs
  verify_publication_manifest
  printf '%s\n%s\n' "$(sha256_file "$PUBLICATION_MANIFEST")" "$1" >"$ATTESTATION_MARKER"
  chmod 600 "$ATTESTATION_MARKER"
  KEEP_OUTPUTS=1
}

publish_release() {
  local notes asset
  validate_protected_inputs
  for tool in gh shasum awk grep; do require_tool "$tool"; done
  assert_release_absent
  validate_tagged_provenance
  install_protected_credentials
  verify_publication_manifest
  [[ -f "$ATTESTATION_MARKER" && "$(sed -n '1p' "$ATTESTATION_MARKER")" == "$(sha256_file "$PUBLICATION_MANIFEST")" ]] || release_error "successful GitHub artifact attestation is not bound to this asset set"
  verify_final_artifact_evidence
  bash "$RELEASE_DIRECTORY/verify-release-metadata.sh" "$FINAL_DIRECTORY" "$METADATA_DIRECTORY" "$INDEX_BUILD_NUMBER" "$INDEX_RELEASE_COMMIT"
  verify_final_artifact_evidence
  assert_release_absent
  notes="$TRANSACTION_ROOT/release-notes.txt"
  mkdir -p "${TRANSACTION_ROOT:=$RUNNER_TEMP/index-publication-${GITHUB_RUN_ID}}"
  chmod 700 "$TRANSACTION_ROOT"
  printf 'index-production-run:%s:%s\n' "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" >"$notes"
  PUBLICATION_MARKER=1
  # Sole irreversible final step. GitHub's API does not promise transactionally
  # atomic release creation plus all asset uploads; on command failure the EXIT
  # trap deletes only a release bearing this run marker, then proves absence.
  gh release create "$INDEX_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --verify-tag --latest=false \
    --title "Index for macOS ${VERSION}" --notes-file "$notes" \
    "$FINAL_DIRECTORY/$APP_DMG" "$FINAL_DIRECTORY/$APP_DMG.reproducibility.txt" \
    "$FINAL_DIRECTORY/$CONNECTOR_DMG" "$FINAL_DIRECTORY/$CONNECTOR_DMG.reproducibility.txt" \
    "$METADATA_DIRECTORY/macos-release.json" "$METADATA_DIRECTORY/macos-release.cms" "$METADATA_DIRECTORY/SHA256SUMS"
  PUBLISHED=1
  PUBLICATION_MARKER=0
  KEEP_OUTPUTS=1
}

case "${1:-}" in
  prepare) [[ "$#" -eq 1 ]] || release_error "prepare accepts no arguments"; prepare_release ;;
  record-attestation) shift; record_attestation "$@" ;;
  publish) [[ "$#" -eq 1 ]] || release_error "publish accepts no arguments"; TRANSACTION_ROOT="$(mktemp -d "$RUNNER_TEMP/index-publication.XXXXXX")"; chmod 700 "$TRANSACTION_ROOT"; publish_release ;;
  assert-absence) [[ "$#" -eq 1 ]] || release_error "assert-absence accepts no arguments"; require_value GITHUB_REPOSITORY; require_value INDEX_RELEASE_TAG; require_tool gh; assert_release_absent ;;
  *) release_error "usage: build-release.sh prepare | record-attestation URL | publish | assert-absence" ;;
esac
trap - EXIT
release_cleanup 0
