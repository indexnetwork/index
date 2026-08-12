#!/usr/bin/env bash
set -euo pipefail
set +x
export BUILD_RELEASE_SOURCE_ONLY=1
# shellcheck source=build-release.sh
source "$(cd "$(dirname "$0")" && pwd -P)/build-release.sh"
assert_no_unrelated_same_uid_processes
