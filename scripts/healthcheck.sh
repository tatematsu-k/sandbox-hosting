#!/usr/bin/env bash
# scripts/healthcheck.sh
# Smoke test against a deployed AWS sandbox-hosting instance.
# Requires SANDBOX_API_URL (API GW) and SANDBOX_VIEW_URL (CloudFront) to be set,
# or sources ~/.config/sandbox-hosting/env.

set -euo pipefail

CONFIG_FILE="${SANDBOX_CONFIG:-$HOME/.config/sandbox-hosting/env}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

API_URL="${SANDBOX_API_URL:-${SANDBOX_BASE_URL:-}}"
VIEW_URL="${SANDBOX_VIEW_URL:-$API_URL}"
TOKEN="${SANDBOX_TOKEN:-}"
USER_NAME="${SANDBOX_USER:-healthcheck}"

if [[ -z "$API_URL" || -z "$TOKEN" ]]; then
  echo "ERROR: set SANDBOX_API_URL (or SANDBOX_BASE_URL) and SANDBOX_TOKEN" >&2
  exit 2
fi

tmp_html="$(mktemp -t sandbox-healthcheck-XXXXXX.html)"
trap 'rm -f "$tmp_html"' EXIT
printf '<!doctype html><title>healthcheck</title><h1>%s</h1>' "$(date -u +%FT%TZ)" > "$tmp_html"

slug="healthcheck-$(date -u +%Y%m%d)"

echo "==> upload custom-path $slug"
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Sandbox-User: $USER_NAME" \
  -H "X-Sandbox-Path: $slug" \
  -H "Content-Type: text/html" \
  --data-binary "@$tmp_html" \
  "$API_URL/upload"
echo

echo "==> verify GET $VIEW_URL/$slug/"
status=$(curl -sS -o /dev/null -w "%{http_code}" "$VIEW_URL/$slug/")
if [[ "$status" == "200" ]]; then
  echo "  HTTP 200 OK"
else
  echo "  HTTP $status (check ALLOWED_IPS / CloudFront propagation)"
fi

echo "==> list mine"
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Sandbox-User: $USER_NAME" \
  -H "Content-Type: application/json" \
  -d '{"scope":"mine"}' \
  "$API_URL/list" | head -c 400
echo
