#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${SANDBOX_CONFIG:-$HOME/.config/sandbox-hosting/env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

: "${SANDBOX_BASE_URL:?Set SANDBOX_BASE_URL (or put it in $CONFIG_FILE)}"
: "${SANDBOX_TOKEN:?Set SANDBOX_TOKEN (or put it in $CONFIG_FILE)}"
SANDBOX_USER="${SANDBOX_USER:-${USER:-anon}}"

CUSTOM_PATH=""
SUBCMD=""
TARGET=""

print_usage() {
  cat <<'EOF'
Usage:
  upload.sh [--path SLUG] <file-or-dir>
  upload.sh list
  upload.sh activate <path>
  upload.sh delete <path>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      CUSTOM_PATH="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    list|activate|delete)
      SUBCMD="$1"
      shift
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

curl_common=(
  -sS
  -H "Authorization: Bearer ${SANDBOX_TOKEN}"
  -H "X-Sandbox-User: ${SANDBOX_USER}"
)

case "$SUBCMD" in
  list)
    curl "${curl_common[@]}" -X POST \
      -H "Content-Type: application/json" \
      -d '{"scope":"mine"}' \
      "${SANDBOX_BASE_URL}/api/list"
    echo
    exit 0
    ;;
  activate)
    [[ -n "${TARGET}" ]] || { echo "missing path" >&2; exit 2; }
    curl "${curl_common[@]}" -X POST \
      -H "Content-Type: application/json" \
      -d "$(printf '{"path":"%s"}' "$TARGET")" \
      "${SANDBOX_BASE_URL}/api/activate"
    echo
    exit 0
    ;;
  delete)
    [[ -n "${TARGET}" ]] || { echo "missing path" >&2; exit 2; }
    curl "${curl_common[@]}" -X POST \
      -H "Content-Type: application/json" \
      -d "$(printf '{"path":"%s"}' "$TARGET")" \
      "${SANDBOX_BASE_URL}/api/delete"
    echo
    exit 0
    ;;
esac

[[ -n "$TARGET" ]] || { print_usage >&2; exit 2; }
[[ -e "$TARGET" ]] || { echo "not found: $TARGET" >&2; exit 2; }

path_header=()
if [[ -n "$CUSTOM_PATH" ]]; then
  path_header=(-H "X-Sandbox-Path: ${CUSTOM_PATH}")
fi

if [[ -d "$TARGET" ]]; then
  if [[ ! -f "${TARGET}/index.html" ]]; then
    echo "directory must contain index.html at root" >&2
    exit 2
  fi
  tmp_zip="$(mktemp -t sandbox-upload-XXXXXX.zip)"
  trap 'rm -f "$tmp_zip"' EXIT
  ( cd "$TARGET" && zip -qr "$tmp_zip" . )
  curl "${curl_common[@]}" "${path_header[@]}" -X POST \
    -H "Content-Type: application/zip" \
    --data-binary "@${tmp_zip}" \
    "${SANDBOX_BASE_URL}/api/upload"
else
  curl "${curl_common[@]}" "${path_header[@]}" -X POST \
    -H "Content-Type: text/html; charset=utf-8" \
    --data-binary "@${TARGET}" \
    "${SANDBOX_BASE_URL}/api/upload"
fi
echo
