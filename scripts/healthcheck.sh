#!/usr/bin/env bash
# scripts/healthcheck.sh
# Quick smoke test against a deployed sandbox-hosting instance.

set -euo pipefail

BASE_URL="${SANDBOX_BASE_URL:-}"
TOKEN="${SANDBOX_TOKEN:-}"
USER_NAME="${SANDBOX_USER:-healthcheck}"

if [[ -z "$BASE_URL" || -z "$TOKEN" ]]; then
  echo "ERROR: set SANDBOX_BASE_URL and SANDBOX_TOKEN before running" >&2
  exit 2
fi

tmp_html="$(mktemp -t sandbox-healthcheck-XXXXXX.html)"
trap 'rm -f "$tmp_html"' EXIT
printf '<!doctype html><title>healthcheck</title><h1>%s</h1>' "$(date -u +%FT%TZ)" > "$tmp_html"

slug="healthcheck-$(date -u +%Y%m%d)"

echo "==> upload custom-path $slug"
resp=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Sandbox-User: $USER_NAME" \
  -H "X-Sandbox-Path: $slug" \
  -H "Content-Type: text/html" \
  --data-binary "@$tmp_html" \
  "$BASE_URL/api/upload")
echo "  $resp"

echo "==> verify GET /$slug/"
status=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/$slug/")
if [[ "$status" == "200" ]]; then
  echo "  HTTP 200 OK"
else
  echo "  HTTP $status (unexpected — check ALLOWED_IPS)"
fi

echo "==> list mine"
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Sandbox-User: $USER_NAME" \
  -H "Content-Type: application/json" \
  -d '{"scope":"mine"}' \
  "$BASE_URL/api/list" | head -c 400
echo
