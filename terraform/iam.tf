data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api_lambda" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "cron_lambda" {
  name               = "${local.name}-cron"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_basic" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "cron_basic" {
  role       = aws_iam_role.cron_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_app" {
  statement {
    sid = "S3Objects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.content.arn,
      "${aws_s3_bucket.content.arn}/*",
    ]
  }

  statement {
    sid = "DynamoTable"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
    ]
    resources = [
      aws_dynamodb_table.meta.arn,
      "${aws_dynamodb_table.meta.arn}/index/*",
    ]
  }

  statement {
    sid = "TokensTableRead"
    actions = [
      "dynamodb:GetItem",
    ]
    resources = [
      aws_dynamodb_table.tokens.arn,
    ]
  }

  statement {
    sid = "SsmRead"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      aws_ssm_parameter.slack_signing_secret.arn,
      aws_ssm_parameter.slack_bot_token.arn,
    ]
  }
}

resource "aws_iam_policy" "lambda_app" {
  name   = "${local.name}-lambda-app"
  policy = data.aws_iam_policy_document.lambda_app.json
}

resource "aws_iam_role_policy_attachment" "api_app" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = aws_iam_policy.lambda_app.arn
}

resource "aws_iam_role_policy_attachment" "cron_app" {
  role       = aws_iam_role.cron_lambda.name
  policy_arn = aws_iam_policy.lambda_app.arn
}
