resource "aws_cloudwatch_event_rule" "ttl_cron" {
  name                = "${local.name}-ttl-cron"
  description         = "Daily TTL expiry sweep"
  schedule_expression = var.cron_schedule_expression
}

resource "aws_cloudwatch_event_target" "ttl_cron" {
  rule      = aws_cloudwatch_event_rule.ttl_cron.name
  target_id = "${local.name}-cron"
  arn       = aws_lambda_function.cron.arn
}

resource "aws_lambda_permission" "cron_invoke" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cron.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ttl_cron.arn
}
