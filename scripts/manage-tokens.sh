#!/usr/bin/env bash
# scripts/manage-tokens.sh
# Issue, list, and revoke per-user sandbox-hosting upload tokens.
# Talks directly to the tokens DynamoDB table with the caller's own AWS
# credentials — this does NOT go through the API Lambda.

set -euo pipefail
cd "$(dirname "$0")/.."

USERNAME_RE='^[a-z0-9][a-z0-9_-]{0,38}$'
TABLE="${TOKENS_TABLE:-$(terraform -chdir=terraform output -raw tokens_table)}"

print_usage() {
  cat <<'EOF'
Usage:
  manage-tokens.sh issue <username>
  manage-tokens.sh list
  manage-tokens.sh revoke <username>
EOF
}

require_valid_username() {
  local username="$1"
  if ! [[ "$username" =~ $USERNAME_RE ]]; then
    echo "invalid username '$username' (must match $USERNAME_RE)" >&2
    exit 2
  fi
}

sha256_hex() {
  node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"
}

cmd_issue() {
  local username="$1" token hash now
  require_valid_username "$username"
  token="$(openssl rand -hex 32)"
  hash="$(sha256_hex "$token")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  aws dynamodb put-item \
    --table-name "$TABLE" \
    --item "$(printf '{"tokenHash":{"S":"%s"},"owner":{"S":"%s"},"createdAt":{"S":"%s"}}' "$hash" "$username" "$now")" \
    >/dev/null

  echo "==> Issued a token for '$username'. This is shown once — save it now:"
  echo "$token"
}

cmd_list() {
  aws dynamodb scan \
    --table-name "$TABLE" \
    --query 'Items[].{owner:owner.S,createdAt:createdAt.S}' \
    --output table
}

cmd_revoke() {
  local username="$1" hashes hash
  require_valid_username "$username"

  hashes="$(aws dynamodb scan \
    --table-name "$TABLE" \
    --filter-expression '#o = :u' \
    --expression-attribute-names '{"#o":"owner"}' \
    --expression-attribute-values "$(printf '{":u":{"S":"%s"}}' "$username")" \
    --query 'Items[].tokenHash.S' \
    --output text)"
  hashes="$(tr '\t' '\n' <<< "$hashes")"

  if [[ -z "$hashes" ]]; then
    echo "no tokens found for '$username'" >&2
    exit 1
  fi

  while IFS= read -r hash; do
    [[ -z "$hash" ]] && continue
    aws dynamodb delete-item \
      --table-name "$TABLE" \
      --key "$(printf '{"tokenHash":{"S":"%s"}}' "$hash")" \
      --condition-expression 'attribute_exists(tokenHash)' \
      >/dev/null
    echo "==> Revoked token (hash: ${hash:0:12}...) for '$username'"
  done <<< "$hashes"
}

case "${1:-}" in
  issue)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_issue "$2"
    ;;
  list)
    cmd_list
    ;;
  revoke)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_revoke "$2"
    ;;
  *)
    print_usage >&2
    exit 2
    ;;
esac
