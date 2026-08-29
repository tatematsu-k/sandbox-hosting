#!/usr/bin/env bash
# scripts/setup-slack-secrets.sh
# Interactively populate the Slack SSM parameters (SLACK_SIGNING_SECRET,
# SLACK_BOT_TOKEN) that Terraform creates as REPLACE_ME placeholders.
# Values are read with a hidden prompt so they never touch shell history.

set -euo pipefail
cd "$(dirname "$0")/.."

SIGNING_SECRET_PARAM="${SLACK_SIGNING_SECRET_PARAM:-/sandbox-hosting/SLACK_SIGNING_SECRET}"
BOT_TOKEN_PARAM="${SLACK_BOT_TOKEN_PARAM:-/sandbox-hosting/SLACK_BOT_TOKEN}"

read_secret() {
  local prompt="$1" value
  read -r -s -p "$prompt: " value
  echo >&2
  echo "$value"
}

put_secret() {
  local name="$1" value="$2"
  aws ssm put-parameter \
    --name "$name" \
    --type SecureString --overwrite \
    --value "$value" \
    >/dev/null
  echo "==> Updated $name"
}

echo "Slack signing secret: Settings -> Basic Information -> App Credentials -> Signing Secret"
signing_secret="$(read_secret "Signing secret (blank to skip)")"
if [[ -z "$signing_secret" ]]; then
  echo "==> skipped $SIGNING_SECRET_PARAM (empty input)"
else
  put_secret "$SIGNING_SECRET_PARAM" "$signing_secret"
fi

echo
echo "Slack bot token: OAuth & Permissions -> Bot User OAuth Token (xoxb-...)"
echo "Requires the users:read.email scope (needed for manage-slack-users.sh allow)."
bot_token="$(read_secret "Bot token (blank to skip)")"
if [[ -z "$bot_token" ]]; then
  echo "==> skipped $BOT_TOKEN_PARAM (empty input)"
else
  put_secret "$BOT_TOKEN_PARAM" "$bot_token"
fi
