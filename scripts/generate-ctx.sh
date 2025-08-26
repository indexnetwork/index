#!/usr/bin/env bash
set -euo pipefail

# Generate ctx files from llms.txt and copy them to frontend/public
# - Minimal: llms-ctx.txt (excludes Optional)
# - Full:    llms-ctx-full.txt (includes Optional)
#
# Usage:
#   scripts/generate-ctx.sh
#   LLMSTXT_FILE=llms.txt scripts/generate-ctx.sh   # alternate source file

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_FILE="${LLMSTXT_FILE:-llms.txt}"
OUT_MIN="${ROOT_DIR}/llms-ctx.txt"
OUT_FULL="${ROOT_DIR}/llms-ctx-full.txt"
PUB_DIR="${ROOT_DIR}/frontend/public"

echo "[llms] Using source: ${SRC_FILE}"
if [[ ! -f "${ROOT_DIR}/${SRC_FILE}" ]]; then
  echo "[llms] Error: ${SRC_FILE} not found in repo root" >&2
  exit 1
fi

ensure_cli() {
  if command -v llms_txt2ctx >/dev/null 2>&1; then
    return 0
  fi
  # Prefer project-local venv to avoid polluting global env
  VENV_DIR="${ROOT_DIR}/.venv"
  if [[ ! -d "${VENV_DIR}" ]]; then
    echo "[llms] Creating venv at ${VENV_DIR}"
    python3 -m venv "${VENV_DIR}"
  fi
  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"
  python -m pip install -q --upgrade pip
  python -m pip install -q llms-txt
}

generate_ctx() {
  local src_path="${ROOT_DIR}/${SRC_FILE}"
  echo "[llms] Generating minimal ctx -> ${OUT_MIN}"
  if ! llms_txt2ctx "${src_path}" > "${OUT_MIN}"; then
    echo "[llms] Warning: minimal ctx generation failed; leaving previous file if present" >&2
  fi

  echo "[llms] Generating full ctx -> ${OUT_FULL}"
  if ! llms_txt2ctx --optional True "${src_path}" > "${OUT_FULL}"; then
    echo "[llms] Warning: full ctx generation failed; leaving previous file if present" >&2
  fi
}

copy_public() {
  mkdir -p "${PUB_DIR}"
  if [[ -f "${OUT_MIN}" ]]; then
    cp "${OUT_MIN}" "${PUB_DIR}/llms-ctx.txt"
  fi
  if [[ -f "${OUT_FULL}" ]]; then
    cp "${OUT_FULL}" "${PUB_DIR}/llms-ctx-full.txt"
  fi
}

ensure_cli
generate_ctx
copy_public

echo "[llms] Done. Public endpoints: /llms-ctx.txt, /llms-ctx-full.txt"

