#!/usr/bin/env bash
# scripts/setup-vercel.sh
# Initial Vercel project provisioning for sandbox-hosting.
# Idempotent: re-running on a configured project only patches missing env vars.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not found. Install it: npm i -g vercel" >&2
  exit 1
fi

if [[ ! -d ".vercel" ]]; then
  echo "==> Linking Vercel project (interactive)"
  vercel link
else
  echo "==> .vercel/ already present, skipping link"
fi

random_hex() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

ensure_env() {
  local key="$1"
  local target="$2"
  local prompt="$3"
  local default="${4:-}"

  if vercel env ls "$target" 2>/dev/null | grep -q "^[[:space:]]*${key}[[:space:]]"; then
    echo "  - ${key} already set in ${target}, skip"
    return
  fi

  local value
  if [[ -n "$default" ]]; then
    read -rp "  ${prompt} [default: ${default}]: " value
    value="${value:-$default}"
  else
    read -rp "  ${prompt}: " value
  fi

  if [[ -z "$value" ]]; then
    echo "  ! ${key} skipped (empty)"
    return
  fi

  printf "%s" "$value" | vercel env add "$key" "$target" >/dev/null
  echo "  + ${key} set in ${target}"
}

echo
echo "==> Required env vars (production)"
ensure_env ALLOWED_IPS production \
  "Comma-separated CIDRs/IPs allowed to view published sites"
ensure_env UPLOAD_TOKEN production \
  "Bearer token for Claude Code upload (random 32 bytes recommended)" \
  "$(random_hex)"
ensure_env SLACK_SIGNING_SECRET production \
  "Slack Signing Secret"
ensure_env CRON_SECRET production \
  "Random secret used to authenticate the daily TTL cron" \
  "$(random_hex)"
ensure_env PUBLIC_BASE_URL production \
  "Public site base URL (no trailing slash)"

echo
echo "==> Optional env vars"
ensure_env SLACK_BOT_TOKEN production \
  "Slack bot token (only required for files.slack.com uploads). Leave empty to skip"

echo
echo "==> Vercel Blob store"
if vercel env ls production 2>/dev/null | grep -q BLOB_READ_WRITE_TOKEN; then
  echo "  BLOB_READ_WRITE_TOKEN already injected — Blob store linked."
else
  cat <<'EOM'
  Open https://vercel.com/dashboard/stores → Create Blob store → connect to this project.
  Vercel will auto-inject BLOB_READ_WRITE_TOKEN into production / preview / development.
  Re-run this script after creating the store to verify.
EOM
fi

echo
echo "==> Pulling production env to .env.local for verification"
vercel env pull .env.local --environment=production
echo "==> Done. Verify .env.local then run: npm run dev"
