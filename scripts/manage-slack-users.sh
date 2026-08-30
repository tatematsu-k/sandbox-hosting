#!/usr/bin/env bash
# scripts/manage-slack-users.sh
# Allow, list, and revoke Slack-allowlist entries (slackUserId -> cached email).
# Talks directly to the slack-users DynamoDB table with the caller's own AWS
# credentials, and to the Slack Web API (users.info) to resolve the email at
# registration time. This does NOT go through the API Lambda.

set -euo pipefail
cd "$(dirname "$0")/.."

SLACK_USER_ID_RE='^U[A-Z0-9]+$'
USERNAME_RE='^[a-z0-9][a-z0-9_-]{0,38}$'
TABLE="${SLACK_USERS_TABLE:-$(terraform -chdir=terraform output -raw slack_users_table)}"
BOT_TOKEN_PARAM="${SLACK_BOT_TOKEN_PARAM:-/sandbox-hosting/SLACK_BOT_TOKEN}"

print_usage() {
  cat <<'EOF'
Usage:
  manage-slack-users.sh allow <slack_user_id>
  manage-slack-users.sh list
  manage-slack-users.sh revoke <slack_user_id>
  manage-slack-users.sh link <slack_user_id> <claude_code_username>
  manage-slack-users.sh unlink <slack_user_id>

<slack_user_id> is the Slack member ID (e.g. U0123ABCD), found via
Slack profile -> "..." -> Copy member ID.

link/unlink tie a Slack account to a Claude Code username issued by
manage-tokens.sh, so Slack uploads share the same owner (and show up
in that user's `list`) instead of being owned by the cached email.
EOF
}

require_valid_slack_user_id() {
  local id="$1"
  if ! [[ "$id" =~ $SLACK_USER_ID_RE ]]; then
    echo "invalid slack user id '$id' (expected e.g. U0123ABCD)" >&2
    exit 2
  fi
}

require_valid_username() {
  local username="$1"
  if ! [[ "$username" =~ $USERNAME_RE ]]; then
    echo "invalid username '$username' (must match $USERNAME_RE)" >&2
    exit 2
  fi
}

fetch_email() {
  local slack_user_id="$1" token resp ok email
  token="$(aws ssm get-parameter --name "$BOT_TOKEN_PARAM" --with-decryption \
    --query 'Parameter.Value' --output text)"
  if [[ -z "$token" || "$token" == "REPLACE_ME" ]]; then
    echo "SLACK_BOT_TOKEN is not configured (needs users:read.email scope)" >&2
    exit 1
  fi

  resp="$(curl -sf "https://slack.com/api/users.info?user=${slack_user_id}" \
    -H "Authorization: Bearer ${token}")"
  ok="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).ok))' "$resp")"
  if [[ "$ok" != "true" ]]; then
    echo "Slack API error: $resp" >&2
    exit 1
  fi

  email="$(node -e 'const d = JSON.parse(process.argv[1]); process.stdout.write(d.user && d.user.profile && d.user.profile.email || "")' "$resp")"
  if [[ -z "$email" ]]; then
    echo "no email visible for '$slack_user_id' (check the users:read.email scope)" >&2
    exit 1
  fi
  echo "$email"
}

cmd_allow() {
  local slack_user_id="$1" email now
  require_valid_slack_user_id "$slack_user_id"
  email="$(fetch_email "$slack_user_id")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # update-item (not put-item) so re-running `allow` to refresh the cached
  # email doesn't clobber an existing `link` to a Claude Code username.
  aws dynamodb update-item \
    --table-name "$TABLE" \
    --key "$(printf '{"slackUserId":{"S":"%s"}}' "$slack_user_id")" \
    --update-expression 'SET email = :email, createdAt = if_not_exists(createdAt, :now)' \
    --expression-attribute-values "$(printf '{":email":{"S":"%s"},":now":{"S":"%s"}}' "$email" "$now")" \
    >/dev/null

  echo "==> Allowed '$slack_user_id' (email: $email)"
}

cmd_list() {
  aws dynamodb scan \
    --table-name "$TABLE" \
    --query 'Items[].{slackUserId:slackUserId.S,email:email.S,linkedUsername:linkedUsername.S,createdAt:createdAt.S}' \
    --output table
}

cmd_link() {
  local slack_user_id="$1" username="$2"
  require_valid_slack_user_id "$slack_user_id"
  require_valid_username "$username"

  aws dynamodb update-item \
    --table-name "$TABLE" \
    --key "$(printf '{"slackUserId":{"S":"%s"}}' "$slack_user_id")" \
    --update-expression 'SET linkedUsername = :u' \
    --condition-expression 'attribute_exists(slackUserId)' \
    --expression-attribute-values "$(printf '{":u":{"S":"%s"}}' "$username")" \
    >/dev/null

  echo "==> Linked '$slack_user_id' to Claude Code user '$username'"
}

cmd_unlink() {
  local slack_user_id="$1"
  require_valid_slack_user_id "$slack_user_id"

  aws dynamodb update-item \
    --table-name "$TABLE" \
    --key "$(printf '{"slackUserId":{"S":"%s"}}' "$slack_user_id")" \
    --update-expression 'REMOVE linkedUsername' \
    --condition-expression 'attribute_exists(slackUserId)' \
    >/dev/null

  echo "==> Unlinked '$slack_user_id' (Slack uploads will show the cached email again)"
}

cmd_revoke() {
  local slack_user_id="$1"
  require_valid_slack_user_id "$slack_user_id"

  aws dynamodb delete-item \
    --table-name "$TABLE" \
    --key "$(printf '{"slackUserId":{"S":"%s"}}' "$slack_user_id")" \
    --condition-expression 'attribute_exists(slackUserId)' \
    >/dev/null
  echo "==> Revoked '$slack_user_id'"
}

case "${1:-}" in
  allow)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_allow "$2"
    ;;
  list)
    cmd_list
    ;;
  revoke)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_revoke "$2"
    ;;
  link)
    [[ -n "${2:-}" && -n "${3:-}" ]] || { print_usage >&2; exit 2; }
    cmd_link "$2" "$3"
    ;;
  unlink)
    [[ -n "${2:-}" ]] || { print_usage >&2; exit 2; }
    cmd_unlink "$2"
    ;;
  *)
    print_usage >&2
    exit 2
    ;;
esac
