resource "random_password" "upload_token" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "upload_token" {
  name        = "${local.ssm_prefix}/UPLOAD_TOKEN"
  description = "Bearer token for Claude Code upload."
  type        = "SecureString"
  value       = random_password.upload_token.result

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "slack_signing_secret" {
  name        = "${local.ssm_prefix}/SLACK_SIGNING_SECRET"
  description = "Slack signing secret (populate manually after first apply)."
  type        = "SecureString"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "slack_bot_token" {
  name        = "${local.ssm_prefix}/SLACK_BOT_TOKEN"
  description = "Optional Slack bot token (xoxb-...). Leave REPLACE_ME to disable."
  type        = "SecureString"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}
