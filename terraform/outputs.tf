output "api_endpoint" {
  description = "API Gateway endpoint (use as SANDBOX_BASE_URL for upload calls)."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "cdn_domain" {
  description = "CloudFront distribution domain — public viewer URL."
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "public_base_url_in_use" {
  description = "PUBLIC_BASE_URL applied to the Lambdas."
  value       = local.effective_public_base_url
}

output "content_bucket" {
  value = aws_s3_bucket.content.bucket
}

output "meta_table" {
  value = aws_dynamodb_table.meta.name
}

output "tokens_table" {
  value = aws_dynamodb_table.tokens.name
}
