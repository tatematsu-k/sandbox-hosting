data "archive_file" "api" {
  type        = "zip"
  source_dir  = local.api_dist_path
  output_path = "${path.module}/.terraform/build/api.zip"
}

data "archive_file" "cron" {
  type        = "zip"
  source_dir  = local.cron_dist_path
  output_path = "${path.module}/.terraform/build/cron.zip"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "cron" {
  name              = "/aws/lambda/${local.name}-cron"
  retention_in_days = var.log_retention_days
}

locals {
  lambda_env = {
    CONTENT_BUCKET             = aws_s3_bucket.content.bucket
    META_TABLE                 = aws_dynamodb_table.meta.name
    PUBLIC_BASE_URL            = local.effective_public_base_url
    TOKENS_TABLE               = aws_dynamodb_table.tokens.name
    SLACK_USERS_TABLE          = aws_dynamodb_table.slack_users.name
    SLACK_SIGNING_SECRET_PARAM = aws_ssm_parameter.slack_signing_secret.name
    SLACK_BOT_TOKEN_PARAM      = aws_ssm_parameter.slack_bot_token.name
  }
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api_lambda.arn
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = var.lambda_memory
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.lambda_env
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function" "cron" {
  function_name    = "${local.name}-cron"
  role             = aws_iam_role.cron_lambda.arn
  filename         = data.archive_file.cron.output_path
  source_code_hash = data.archive_file.cron.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 256
  timeout          = 300

  environment {
    variables = local.lambda_env
  }

  depends_on = [aws_cloudwatch_log_group.cron]
}
