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
CREATED_RELEASE_ID=""
KEEP_OUTPUTS=0
readonly SECRET_ENV_NAMES=(GH_TOKEN GITHUB_TOKEN INDEX_DEVELOPER_ID_CERTIFICATE_P12 INDEX_DEVELOPER_ID_CERTIFICATE_PASSWORD INDEX_APP_PROVISIONING_PROFILE_BASE64 INDEX_CONNECTOR_PROVISIONING_PROFILE_BASE64 INDEX_NOTARY_API_KEY_BASE64 INDEX_NOTARY_KEY_ID INDEX_NOTARY_ISSUER_ID)

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

cleanup_created_release() {
  [[ -n "$CREATED_RELEASE_ID" && "$CREATED_RELEASE_ID" =~ ^[1-9][0-9]*$ ]] || return 1
  if [[ "${INDEX_RELEASE_TEST_RELEASE_MODE:-}" == replaced ]]; then return 1; fi
  local release
  release="$(gh api -H 'Accept: application/vnd.github+json' "/repos/${GITHUB_REPOSITORY}/releases/${CREATED_RELEASE_ID}")" || return 1
  bun -e 'const r=JSON.parse(process.argv[1]); if(String(r.id)!==process.argv[2]||r.tag_name!==process.argv[3]||r.target_commitish!==process.argv[4]||r.body!==process.argv[5])process.exit(1)' \
    "$release" "$CREATED_RELEASE_ID" "$INDEX_RELEASE_TAG" "$INDEX_RELEASE_COMMIT" "index-production-run:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}" || return 1
  gh api --method DELETE "/repos/${GITHUB_REPOSITORY}/releases/${CREATED_RELEASE_ID}"
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
    if (( PUBLICATION_MARKER == 1 )); then
      cleanup_created_release >/dev/null 2>&1 || printf 'created release numeric ID could not be safely revalidated/deleted\n' >&2
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
    INDEX_RELEASE_EXPECTED_RUNNER_IMAGE INDEX_RELEASE_EXPECTED_RUNNER_VERSION INDEX_RELEASE_CMS_IDENTITY_HASH INDEX_RELEASE_CMS_CERT_SHA256 INDEX_RELEASE_TAG_RULESET_ID; do
    require_value "$name"
  done
  [[ "$GITHUB_ACTIONS" == true && "$RUNNER_ENVIRONMENT" == github-hosted ]] || release_error "a fresh isolated GitHub-hosted runner is required"
  [[ "$INDEX_RELEASE_TAG" == "$TAG" ]] || release_error "the approved first production tag is exactly $TAG"
  [[ "$INDEX_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ && "$INDEX_RELEASE_COMMIT" == "$GITHUB_SHA" ]] || release_error "release commit must be the exact workflow commit"
  [[ "$INDEX_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || release_error "build number must be a positive canonical decimal"
  [[ "$INDEX_RELEASE_CMS_IDENTITY_HASH" =~ ^[0-9a-f]{40}$ ]] || release_error "INDEX_RELEASE_CMS_IDENTITY_HASH must be canonical lowercase 40-hex"
  [[ "$INDEX_RELEASE_CMS_CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || release_error "INDEX_RELEASE_CMS_CERT_SHA256 must be canonical lowercase SHA-256"
  [[ "$INDEX_RELEASE_TAG_RULESET_ID" =~ ^[1-9][0-9]*$ ]] || release_error "reviewed immutable-tag ruleset ID must be a positive integer"
  [[ "$INDEX_RELEASE_MACOS_VERSION" =~ ^[0-9]+(\.[0-9]+){1,2}$ && "$INDEX_RELEASE_MACOS_BUILD" =~ ^[A-Za-z0-9]+$ ]] || release_error "reviewed macOS version/build pins are malformed"
  [[ "$INDEX_RELEASE_EXPECTED_RUNNER_IMAGE" =~ ^[A-Za-z0-9._-]+$ && "$INDEX_RELEASE_EXPECTED_RUNNER_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || release_error "reviewed runner pins are malformed"
  [[ "${INDEX_API_URL:-}" == https://protocol.index.network && "${INDEX_WEB_URL:-}" == https://index.network ]] || release_error "production endpoints do not match reviewed literals"
  [[ "${INDEX_EXPECTED_TEAM_ID:-}" == LMQ3XNXLAD && "${INDEX_CONNECTOR_PROTOCOL_VERSION:-}" == 1 ]] || release_error "Team ID or connector protocol authority does not match"
}

validate_remote_annotated_tag() {
  if [[ -n "${INDEX_RELEASE_TEST_TAG_MODE:-}" ]]; then
    [[ "$INDEX_RELEASE_TEST_TAG_MODE" == valid ]] || release_error "test fixture refused tag provenance"
    return
  fi
  [[ "$(git -C "$REPO_ROOT" cat-file -t "refs/tags/$INDEX_RELEASE_TAG")" == tag ]] || release_error "release tag must be annotated"
  local remote direct peeled ruleset
  remote="$(git -C "$REPO_ROOT" ls-remote --refs origin "refs/tags/$INDEX_RELEASE_TAG" "refs/tags/$INDEX_RELEASE_TAG^{}")" || release_error "remote tag could not be resolved"
  direct="$(awk -v ref="refs/tags/$INDEX_RELEASE_TAG" '$2==ref{print $1;c++}END{if(c!=1)exit 1}' <<<"$remote")" || release_error "remote annotated tag object is missing or ambiguous"
  peeled="$(git -C "$REPO_ROOT" ls-remote origin "refs/tags/$INDEX_RELEASE_TAG^{}" | awk -v ref="refs/tags/$INDEX_RELEASE_TAG^{}" '$2==ref{print $1;c++}END{if(c!=1)exit 1}')" || release_error "remote peeled tag is missing or ambiguous"
  [[ "$direct" == "$(git -C "$REPO_ROOT" rev-parse "refs/tags/$INDEX_RELEASE_TAG")" && "$peeled" == "$INDEX_RELEASE_COMMIT" ]] || release_error "remote annotated tag drifted"
  ruleset="$(gh api "/repos/${GITHUB_REPOSITORY}/rulesets/${INDEX_RELEASE_TAG_RULESET_ID}")" || release_error "immutable-tag ruleset is unavailable"
  bun -e 'const r=JSON.parse(process.argv[1]);const tag=process.argv[2];if(String(r.id)!==process.argv[3]||r.enforcement!=="active"||r.target!=="tag"||!r.conditions?.ref_name?.include?.some(x=>x===`refs/tags/${tag}`||x==="~ALL")||!r.rules?.some(x=>x.type==="deletion")||!r.rules?.some(x=>x.type==="update"))process.exit(1)' "$ruleset" "$INDEX_RELEASE_TAG" "$INDEX_RELEASE_TAG_RULESET_ID" || release_error "reviewed ruleset does not actively prevent tag update/deletion"
}
validate_tagged_provenance() {
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain=v1 --untracked-files=all)" ]] || release_error "checkout must be clean, including untracked files"
  [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$INDEX_RELEASE_COMMIT" ]] || release_error "HEAD differs from the approved release commit"
  [[ "$(git -C "$REPO_ROOT" rev-parse "refs/tags/$INDEX_RELEASE_TAG^{commit}")" == "$INDEX_RELEASE_COMMIT" ]] || release_error "exact release tag does not resolve to the approved commit"
  validate_remote_annotated_tag
}

assert_no_unrelated_same_uid_processes() {
  [[ -z "$(jobs -pr)" ]] || release_error "background shell workloads are forbidden"
  local shell_pid="${INDEX_RELEASE_TEST_SHELL_PID:-$$}"
  python3 - "$shell_pid" "$(id -u)" "${INDEX_RELEASE_PS_FIXTURE:-}" <<'PY'
import os, pathlib, subprocess, sys
shell, uid, fixture = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
rows={}
if fixture:
 for line in pathlib.Path(fixture).read_text().splitlines():
  pid,ppid,_rowuid,exe=line.split(":",3); rows[int(pid)]=(int(ppid),uid,exe)
else:
 for line in subprocess.check_output(["ps","-axo","uid=,pid=,ppid=,comm="],text=True).splitlines():
  parts=line.strip().split(None,3)
  if len(parts)==4: rows[int(parts[1])]=(int(parts[2]),int(parts[0]),parts[3])
allowed=set(); pid=shell
while pid in rows and pid>1: allowed.add(pid); pid=rows[pid][0]
allowed.add(pid)
reviewed={"/sbin/launchd","/usr/libexec/UserEventAgent","/usr/sbin/distnoted","/opt/actions-runner/bin/Runner.Listener","/opt/actions-runner/bin/Runner.Worker"}
for pid,(ppid,rowuid,exe) in rows.items():
 if rowuid!=uid or pid in allowed or exe in reviewed: continue
 raise SystemExit(f"unrelated same-UID workload detected: pid {pid}")
PY
}

validate_monotonic_release() {
  local directory releases row tag assets metadata cms
  directory="$TRANSACTION_ROOT/prior-releases-$(date +%s%N)"; mkdir -m 700 "$directory"
  releases="$(gh api --paginate -H 'Accept: application/vnd.github+json' "/repos/${GITHUB_REPOSITORY}/releases?per_page=100" --jq '.[] | [.tag_name, ([.assets[].name]|join(","))] | @tsv')" || release_error "existing release inventory could not be established"
  while IFS=$'\t' read -r tag assets; do
    [[ -n "$tag" && "$tag" != "$INDEX_RELEASE_TAG" ]] || continue
    if [[ "$assets" == *macos-release.json* || "$assets" == *macos-release.cms* || "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      [[ ",$assets," == *,macos-release.json,* && ",$assets," == *,macos-release.cms,* ]] || release_error "historical macOS release lacks exact JSON/CMS pair"
      metadata="$directory/${tag//\//_}.json"; cms="$directory/${tag//\//_}.cms"
      gh release download "$tag" --repo "$GITHUB_REPOSITORY" --pattern macos-release.json --output "$metadata" >/dev/null || release_error "historical JSON download failed"
      gh release download "$tag" --repo "$GITHUB_REPOSITORY" --pattern macos-release.cms --output "$cms" >/dev/null || release_error "historical CMS download failed"
      bash "$RELEASE_DIRECTORY/verify-prior-release-metadata.sh" "$metadata" "$cms" || release_error "historical signed metadata verification failed"
      bun -e 'const p=JSON.parse(await Bun.file(process.argv[1]).text()),a=p.releaseVersion.split(".").map(BigInt),b=process.argv[2].split(".").map(BigInt);const greater=b[0]>a[0]||(b[0]===a[0]&&(b[1]>a[1]||(b[1]===a[1]&&b[2]>a[2])));if(!greater||BigInt(process.argv[3])<=BigInt(p.buildNumber))process.exit(1)' "$metadata" "$VERSION" "$INDEX_BUILD_NUMBER" || release_error "version and build number are not strictly monotonic"
    fi
  done <<<"$releases"
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
  (umask 077; printf '%s' "${!variable}" | base64 --decode >"$destination") 2>/dev/null || release_error "$variable is not valid base64"
  chmod 600 "$destination"
}
run_credential_free_build() {
  local name; local -a clean=()
  for name in "${SECRET_ENV_NAMES[@]}"; do clean+=(-u "$name"); done
  env "${clean[@]}" "$@"
}
validate_release_host() {
  [[ "$(sw_vers -productVersion)" == "$INDEX_RELEASE_MACOS_VERSION" && "$(sw_vers -buildVersion)" == "$INDEX_RELEASE_MACOS_BUILD" ]] || release_error "actual macOS version/build differs from reviewed pins"
  [[ "${ImageOS:-}" == "$INDEX_RELEASE_EXPECTED_RUNNER_IMAGE" && "${ImageVersion:-}" == "$INDEX_RELEASE_EXPECTED_RUNNER_VERSION" ]] || release_error "actual runner image/version differs from reviewed pins"
}
run_precredential_phases() {
  validate_release_host
  run_credential_free_build "$@"
  validate_release_host
  install_protected_credentials
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

  # Actual host pins and the credential-free build are proven before any secret
  # is decoded/imported. The child environment explicitly removes all Apple/GH secrets.
  run_precredential_phases bash "$RELEASE_DIRECTORY/build-universal.sh"
  validate_tagged_provenance
  bash "$RELEASE_DIRECTORY/sign-bundles.sh"
  bash "$RELEASE_DIRECTORY/verify-signatures.sh" "$MAC_DIRECTORY/dist/signed"
  validate_release_host
  assert_no_unrelated_same_uid_processes
  INDEX_RELEASE_ISOLATION_GUARD="$RELEASE_DIRECTORY/build-release-isolation-guard.sh"
  export INDEX_RELEASE_ISOLATION_GUARD
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
  validate_monotonic_release
  validate_tagged_provenance
  assert_no_unrelated_same_uid_processes
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
  local create_status release_result
  set +e
  gh release create "$INDEX_RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --verify-tag --target "$INDEX_RELEASE_COMMIT" --latest=false \
    --title "Index for macOS ${VERSION}" --notes-file "$notes" \
    "$FINAL_DIRECTORY/$APP_DMG" "$FINAL_DIRECTORY/$APP_DMG.reproducibility.txt" \
    "$FINAL_DIRECTORY/$CONNECTOR_DMG" "$FINAL_DIRECTORY/$CONNECTOR_DMG.reproducibility.txt" \
    "$METADATA_DIRECTORY/macos-release.json" "$METADATA_DIRECTORY/macos-release.cms" "$METADATA_DIRECTORY/SHA256SUMS"
  create_status=$?
  set -e
  # Capture the numeric database ID immediately even when gh failed after
  # creating a partial release; cleanup never resolves deletion authority by tag.
  release_result="$(gh api "/repos/${GITHUB_REPOSITORY}/releases/tags/${INDEX_RELEASE_TAG}")" || release_error "created release numeric ID capture failed"
  CREATED_RELEASE_ID="$(bun -e 'const r=JSON.parse(process.argv[1]);if(r.tag_name!==process.argv[2]||r.target_commitish!==process.argv[3]||r.body!==process.argv[4])process.exit(1);console.log(r.id)' "$release_result" "$INDEX_RELEASE_TAG" "$INDEX_RELEASE_COMMIT" "index-production-run:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}")" || release_error "created release identity capture failed"
  [[ "$CREATED_RELEASE_ID" =~ ^[1-9][0-9]*$ ]] || release_error "created release numeric ID is invalid"
  (( create_status == 0 )) || release_error "release creation or asset upload failed"
  PUBLICATION_MARKER=0
  KEEP_OUTPUTS=1
}

if [[ "${BUILD_RELEASE_SOURCE_ONLY:-}" == 1 ]]; then trap - EXIT; return 0 2>/dev/null || exit 0; fi
case "${1:-}" in
  prepare) [[ "$#" -eq 1 ]] || release_error "prepare accepts no arguments"; prepare_release ;;
  record-attestation) shift; record_attestation "$@" ;;
  publish) [[ "$#" -eq 1 ]] || release_error "publish accepts no arguments"; TRANSACTION_ROOT="$(mktemp -d "$RUNNER_TEMP/index-publication.XXXXXX")"; chmod 700 "$TRANSACTION_ROOT"; publish_release ;;
  assert-absence) [[ "$#" -eq 1 ]] || release_error "assert-absence accepts no arguments"; require_value GITHUB_REPOSITORY; require_value INDEX_RELEASE_TAG; require_tool gh; assert_release_absent ;;
  *) release_error "usage: build-release.sh prepare | record-attestation URL | publish | assert-absence" ;;
esac
trap - EXIT
release_cleanup 0
