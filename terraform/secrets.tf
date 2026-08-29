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
